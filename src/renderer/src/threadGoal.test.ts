import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ThreadGoalBar,
  ThreadGoalReplaceDialog,
  ThreadGoalResumeDialog
} from './ThreadGoalBar'
import { ThreadGoalCompletion } from './ThreadGoalCompletion'
import {
  EMPTY_THREAD_GOAL_STATE,
  clearCurrentThreadGoal,
  formatThreadGoalDuration,
  formatThreadGoalProgress,
  formatThreadGoalUpdatedLabel,
  hydrateThreadGoalState,
  mergeThreadGoalCompletionAnchor,
  mergeThreadGoalState,
  nextThreadGoalStatus,
  threadGoalAutomaticClearKey,
  threadGoalCompletionAnchorTurnId,
  threadGoalMatchesCompletedAt,
  threadGoalElapsedMs,
  threadGoalNeedsResumeConfirmation,
  threadGoalStatusLabel,
  type ThreadGoal,
  type ThreadGoalStatus
} from './threadGoal'

const threadGoalStyles = readFileSync(new URL('./threadGoal.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: 'thread-1',
    objective: 'Match the native Codex app',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 800,
    timeUsedSeconds: 5,
    createdAt: 80,
    updatedAt: 100,
    ...overrides
  }
}

describe('thread goal model', () => {
  it('uses the native status labels', () => {
    const expected: Record<ThreadGoalStatus, string> = {
      active: '进行中的目标',
      paused: '已暂停的目标',
      blocked: '目标已停滞',
      usageLimited: '目标使用受限',
      budgetLimited: '目标受限',
      complete: '已达成目标'
    }
    for (const [status, label] of Object.entries(expected)) {
      expect(threadGoalStatusLabel(status as ThreadGoalStatus)).toBe(label)
    }
  })

  it('matches the native pause and resume state transitions', () => {
    expect(nextThreadGoalStatus('active')).toBe('paused')
    expect(nextThreadGoalStatus('paused')).toBe('active')
    expect(nextThreadGoalStatus('blocked')).toBe('active')
    expect(nextThreadGoalStatus('usageLimited')).toBe('active')
    expect(nextThreadGoalStatus('budgetLimited')).toBeNull()
    expect(nextThreadGoalStatus('complete')).toBeNull()
    expect(threadGoalNeedsResumeConfirmation('paused')).toBe(true)
    expect(threadGoalNeedsResumeConfirmation('blocked')).toBe(true)
    expect(threadGoalNeedsResumeConfirmation('usageLimited')).toBe(true)
    expect(threadGoalNeedsResumeConfirmation('active')).toBe(false)
  })

  it('advances elapsed time only for an active goal', () => {
    expect(threadGoalElapsedMs(goal(), 120_000)).toBe(25_000)
    expect(threadGoalElapsedMs(goal({ status: 'paused' }), 120_000)).toBe(5_000)
    expect(formatThreadGoalDuration(62_000, 'zh-CN')).toBe('1分钟 2秒')
  })

  it('shows token progress only for active and budget-limited goals', () => {
    const budgeted = goal({ tokenBudget: 10_000, tokensUsed: 1_200 })
    expect(formatThreadGoalProgress(budgeted, { nowMs: 120_000, locale: 'en' }))
      .toBe('1.2K / 10K')
    expect(formatThreadGoalProgress(
      { ...budgeted, status: 'budgetLimited' },
      { nowMs: 120_000, locale: 'en' }
    )).toBe('1.2K / 10K')
    expect(formatThreadGoalProgress(
      { ...budgeted, status: 'paused' },
      { nowMs: 120_000, locale: 'en' }
    )).toBe('5s')
  })

  it('formats native edit metadata labels', () => {
    expect(formatThreadGoalUpdatedLabel(100, 120_000, 'zh-CN')).toBe('刚刚更新')
    expect(formatThreadGoalUpdatedLabel(100, 220_000, 'zh-CN')).toBe('2 分钟前更新')
  })

  it('deduplicates automatic clear by goal lifecycle identity', () => {
    expect(threadGoalAutomaticClearKey(goal({ createdAt: 80, updatedAt: 130 })))
      .toBe('thread-1:80:130')
    expect(threadGoalAutomaticClearKey(goal({ createdAt: 130, updatedAt: 130 })))
      .toBe('thread-1:130:130')
  })

  it('preserves a known completion turn when a duplicate omits it', () => {
    const completed = goal({ status: 'complete', createdAt: 80, updatedAt: 130 })
    const known = mergeThreadGoalCompletionAnchor(null, completed, 'turn-1')
    expect(mergeThreadGoalCompletionAnchor(known, completed, null)).toBe(known)
    expect(mergeThreadGoalCompletionAnchor(known, completed, undefined)).toBe(known)
    expect(threadGoalCompletionAnchorTurnId(known, completed)).toBe('turn-1')
    expect(threadGoalCompletionAnchorTurnId(known, goal({
      status: 'complete',
      createdAt: 130,
      updatedAt: 130
    }))).toBeNull()
  })

  it('matches completion timestamps returned in seconds or milliseconds', () => {
    const completed = goal({ status: 'complete', updatedAt: 1_800_000_123 })
    expect(threadGoalMatchesCompletedAt(completed, 1_800_000_123)).toBe(true)
    expect(threadGoalMatchesCompletedAt(completed, 1_800_000_123_900)).toBe(true)
    expect(threadGoalMatchesCompletedAt(completed, 1_800_000_124)).toBe(false)
  })

  it('merges duplicate responses and notifications by updatedAt', () => {
    const first = goal({ updatedAt: 100 })
    const newer = goal({ status: 'paused', updatedAt: 110 })
    const withFirst = mergeThreadGoalState(EMPTY_THREAD_GOAL_STATE, first)
    expect(withFirst).toEqual({ current: first, completed: null })
    expect(mergeThreadGoalState(withFirst, first)).toBe(withFirst)
    expect(mergeThreadGoalState(withFirst, { ...first })).toBe(withFirst)

    const withNewer = mergeThreadGoalState(withFirst, newer)
    expect(withNewer).toEqual({ current: newer, completed: null })
    expect(mergeThreadGoalState(withNewer, first)).toBe(withNewer)
  })

  it('retains a completed goal after clear and drops it for the next goal', () => {
    const completed = goal({ status: 'complete', updatedAt: 130, timeUsedSeconds: 42 })
    const completedState = mergeThreadGoalState(EMPTY_THREAD_GOAL_STATE, completed)
    expect(completedState).toEqual({ current: completed, completed })

    const cleared = clearCurrentThreadGoal(completedState, completed.threadId)
    expect(cleared).toEqual({ current: null, completed })
    expect(clearCurrentThreadGoal(cleared, completed.threadId)).toBe(cleared)

    const next = goal({ objective: 'A new goal', createdAt: 140, updatedAt: 140 })
    expect(mergeThreadGoalState(cleared, next)).toEqual({ current: next, completed: null })
  })

  it('does not let an equal-timestamp non-complete response regress completion', () => {
    const completed = goal({ status: 'complete', updatedAt: 130 })
    const state = mergeThreadGoalState(EMPTY_THREAD_GOAL_STATE, completed)
    expect(mergeThreadGoalState(state, goal({ status: 'active', updatedAt: 130 }))).toBe(state)
  })

  it('accepts a new lifecycle created in the same second as the previous completion', () => {
    const completed = goal({ status: 'complete', createdAt: 80, updatedAt: 130 })
    const cleared = clearCurrentThreadGoal(
      mergeThreadGoalState(EMPTY_THREAD_GOAL_STATE, completed),
      completed.threadId
    )
    const next = goal({
      objective: 'Start the next goal',
      createdAt: 130,
      updatedAt: 130
    })

    expect(mergeThreadGoalState(cleared, next)).toEqual({ current: next, completed: null })
  })

  it('does not reopen an already-cleared completion on a duplicate notification', () => {
    const completed = goal({ status: 'complete', updatedAt: 130 })
    const cleared = clearCurrentThreadGoal(
      mergeThreadGoalState(EMPTY_THREAD_GOAL_STATE, completed),
      completed.threadId
    )

    expect(mergeThreadGoalState(cleared, { ...completed })).toBe(cleared)
  })

  it('hydrates null by clearing only the current goal', () => {
    const completed = goal({ status: 'complete', updatedAt: 130 })
    const state = mergeThreadGoalState(EMPTY_THREAD_GOAL_STATE, completed)
    expect(hydrateThreadGoalState(state, null)).toEqual({ current: null, completed })
  })

  it('keeps App goal mutations race-safe and restores failed new-goal mode', () => {
    expect(appSource).toContain("origin: 'automatic'")
    expect(appSource).not.toContain('compatibility retry')
    expect(appSource).not.toContain('if (response.cleared) clearThreadGoal')
    expect(appSource).toContain("[failedThreadId]: 'goal'")
    expect(appSource).toMatch(
      /const revisionAtStart = threadGoalRevisions\.current\.get\(threadId\)[\s\S]*=== revisionAtStart/
    )
  })
})

describe('ThreadGoalBar', () => {
  const callbacks = {
    onClear: vi.fn(),
    onStatusChange: vi.fn(),
    onSaveObjective: vi.fn()
  }

  it('renders native summary, progress, and active actions', () => {
    const html = renderToStaticMarkup(createElement(ThreadGoalBar, {
      goal: goal(),
      nowMs: 120_000,
      locale: 'zh-CN',
      ...callbacks
    }))
    expect(html).toContain('aria-label="线程目标"')
    expect(html).toContain('进行中的目标')
    expect(html).toContain('Match the native Codex app')
    expect(html).toContain('25秒')
    expect(html).toContain('aria-label="清除目标"')
    expect(html).toContain('aria-label="暂停目标"')
    expect(html).toContain('aria-label="编辑目标"')
  })

  it('renders Resume goal only for a resumable status', () => {
    const html = renderToStaticMarkup(createElement(ThreadGoalBar, {
      goal: goal({ status: 'blocked' }),
      nowMs: 120_000,
      ...callbacks
    }))
    expect(html).toContain('目标已停滞')
    expect(html).toContain('aria-label="恢复目标"')
    expect(html).not.toContain('aria-label="暂停目标"')
  })

  it('omits a state action for budget-limited and completed goals', () => {
    const limited = renderToStaticMarkup(createElement(ThreadGoalBar, {
      goal: goal({ status: 'budgetLimited', tokenBudget: 10_000 }),
      nowMs: 120_000,
      ...callbacks
    }))
    expect(limited).toContain('目标受限')
    expect(limited).not.toContain('aria-label="暂停目标"')
    expect(limited).not.toContain('aria-label="恢复目标"')

    expect(renderToStaticMarkup(createElement(ThreadGoalBar, {
      goal: goal({ status: 'complete' }),
      ...callbacks
    }))).toBe('')
  })

  it('disables every action while a request is busy', () => {
    const html = renderToStaticMarkup(createElement(ThreadGoalBar, {
      goal: goal(),
      busy: true,
      busyAction: 'clear',
      ...callbacks
    }))
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/disabled=""/g)?.length).toBe(4)
  })

  it('stacks the goal strip above the composer', () => {
    expect(threadGoalStyles).toMatch(
      /\.composer-dock:has\(> \.thread-goal-bar\)\s*\{[^}]*flex-direction: column;[^}]*align-items: center;/s
    )
  })
})

describe('ThreadGoalResumeDialog', () => {
  it('uses the paused confirmation copy', () => {
    const html = renderToStaticMarkup(createElement(ThreadGoalResumeDialog, {
      goal: goal({ status: 'paused' }),
      onDismiss: vi.fn(),
      onResume: vi.fn()
    }))
    expect(html).toContain('恢复已暂停的目标吗？')
    expect(html).toContain('聊天处于空闲状态时，ChatGPT 会继续推进此目标')
    expect(html).toContain('保持已暂停')
    expect(html).toContain('继续目标')
    expect(html).toContain('Match the native Codex app')
  })

  it('uses the resumable copy for blocked and usage-limited goals', () => {
    for (const status of ['blocked', 'usageLimited'] as const) {
      const html = renderToStaticMarkup(createElement(ThreadGoalResumeDialog, {
        goal: goal({ status }),
        busy: true,
        onDismiss: vi.fn(),
        onResume: vi.fn()
      }))
      expect(html).toContain('恢复目标？')
      expect(html).toContain('以后再说')
      expect(html).toContain('aria-busy="true"')
    }
    expect(renderToStaticMarkup(createElement(ThreadGoalResumeDialog, {
      goal: goal({ status: 'active' }),
      onDismiss: vi.fn(),
      onResume: vi.fn()
    }))).toBe('')
  })
})

describe('ThreadGoalReplaceDialog', () => {
  it('uses the native replacement copy and previews the submitted objective', () => {
    const html = renderToStaticMarkup(createElement(ThreadGoalReplaceDialog, {
      objective: 'Use the current composer objective',
      onDismiss: vi.fn(),
      onReplace: vi.fn()
    }))
    expect(html).toContain('替换当前目标吗？')
    expect(html).toContain('这会保留聊天，但会用你当前在输入框中的文本替换已保存的目标')
    expect(html).toContain('Use the current composer objective')
    expect(html).toContain('取消')
    expect(html).toContain('替换目标')
  })

  it('does not render without a pending objective', () => {
    expect(renderToStaticMarkup(createElement(ThreadGoalReplaceDialog, {
      objective: null,
      onDismiss: vi.fn(),
      onReplace: vi.fn()
    }))).toBe('')
  })
})

describe('ThreadGoalCompletion', () => {
  it('renders only a completed goal with total elapsed time', () => {
    const complete = renderToStaticMarkup(createElement(ThreadGoalCompletion, {
      goal: goal({ status: 'complete', timeUsedSeconds: 62 }),
      locale: 'zh-CN'
    }))
    expect(complete).toContain('已在 1分钟 2秒 内达成目标')
    expect(complete).toContain('thread-goal-completion-separator')
    expect(renderToStaticMarkup(createElement(ThreadGoalCompletion, { goal: goal() }))).toBe('')
  })
})

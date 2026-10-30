import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { partitionTurnActivity, TurnBlock } from './App'
import { formatTurnDuration } from './activityStatus'
import type { ThreadItem, Turn } from './protocol'

function runtimeItem(value: Record<string, unknown>): ThreadItem {
  return value as unknown as ThreadItem
}

function command(id: string): ThreadItem {
  return {
    type: 'commandExecution',
    id,
    command: 'pwd',
    status: 'completed'
  }
}

function renderTurn(
  turn: Turn,
  active = false,
  options: {
    interruptedByThisClient?: boolean
    latestUserItemId?: string | null
    timestampSeparatorAtMs?: number | null
  } = {}
): string {
  return renderToStaticMarkup(createElement(TurnBlock, {
    turn,
    active,
    interruptedByThisClient: options.interruptedByThisClient,
    latestUserItemId: options.latestUserItemId ?? null,
    timestampSeparatorAtMs: options.timestampSeparatorAtMs,
    revertReason: null,
    starting: false,
    thinking: false,
    onRevert: () => undefined
  }))
}

describe('shipped turn activity partition', () => {
  it('separates pre-toggle, persistent, collapsible and worked-for units', () => {
    const partition = partitionTurnActivity([
      runtimeItem({ type: 'realtime-transcript', id: 'transcript' }),
      command('command'),
      runtimeItem({
        type: 'mcpToolCall',
        id: 'denied-mcp',
        result: {
          type: 'error',
          error: 'MCP tool call requires approval, but approval policy is never'
        }
      }),
      runtimeItem({
        type: 'dynamicToolCall',
        id: 'persistent-tool',
        namespace: 'codex_app',
        tool: 'finalize_environment',
        standaloneInConversation: true
      }),
      runtimeItem({ type: 'user-input-response', id: 'input', completed: false }),
      runtimeItem({ type: 'worked-for', id: 'duration' })
    ])

    expect(partition.preToggleUnits.map((item) => item.id)).toEqual(['transcript'])
    expect(partition.collapsibleUnits.map((item) => item.id)).toEqual(['command'])
    expect(partition.persistentUnits.map((item) => item.id)).toEqual([
      'denied-mcp',
      'persistent-tool',
      'input'
    ])
    expect(partition.expandedUnits.map((item) => item.id)).toEqual([
      'command',
      'denied-mcp',
      'persistent-tool',
      'input'
    ])
    expect(partition.workedForItem?.id).toBe('duration')
  })

  it('keeps all units after the final answer persistent while a turn is still running', () => {
    const partition = partitionTurnActivity(
      [command('post-final-command')],
      {
        afterFinalAnswer: true,
        hasFollowingFinalAnswer: false,
        isTurnInProgress: true
      }
    )
    expect(partition.collapsibleUnits).toEqual([])
    expect(partition.persistentUnits.map((item) => item.id)).toEqual(['post-final-command'])
  })
})

describe('turn activity partition rendering', () => {
  it('renders a lone context compaction directly without a turn disclosure', () => {
    const html = renderTurn({
      id: 'compaction-turn',
      status: 'completed',
      durationMs: 4_000,
      items: [
        { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Continue', text_elements: [] }] },
        { type: 'reasoning', id: 'hidden-reasoning', summary: ['Compacting'], content: [] },
        { type: 'contextCompaction', id: 'compaction', status: 'completed' },
        { type: 'agentMessage', id: 'final', phase: 'final_answer', text: 'Done.' }
      ]
    })

    expect(html).toContain('data-activity-toggle="none"')
    expect(html).toContain('上下文已自动压缩')
    expect(html).not.toContain('class="activity-disclosure"')
    expect(html).not.toContain('用时 4秒')
  })

  it('keeps a pending steering message visible outside one collapsed work disclosure', () => {
    const steering = runtimeItem({
      type: 'userMessage',
      id: 'steering',
      content: [{ type: 'text', text: 'Also inspect tests', text_elements: [] }],
      steeringStatus: 'pending'
    })
    const html = renderTurn({
      id: 'steering-turn',
      status: 'completed',
      durationMs: 5_000,
      items: [
        { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Inspect', text_elements: [] }] },
        command('before'),
        steering,
        command('after'),
        { type: 'agentMessage', id: 'final', phase: 'final_answer', text: 'Done.' }
      ]
    })

    expect(html.match(/class="activity-disclosure"/g)).toHaveLength(1)
    expect(html).toContain('data-turn-activity-region="persistent"')
    expect(html).toContain('Also inspect tests')
    expect(html).not.toContain('data-command-activity-kind=')
  })

  it('keeps an MCP App visible while ordinary work starts collapsed', () => {
    const html = renderTurn({
      id: 'mcp-app-turn',
      status: 'completed',
      durationMs: 6_000,
      items: [
        { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Open app', text_elements: [] }] },
        command('command'),
        {
          type: 'mcpToolCall',
          id: 'mcp-app',
          server: 'example',
          tool: 'open',
          status: 'completed',
          mcpAppResourceUri: 'ui://example/app'
        },
        { type: 'agentMessage', id: 'final', phase: 'final_answer', text: 'Done.' }
      ]
    })

    expect(html).toContain('class="activity-disclosure"')
    expect(html).toContain('data-turn-activity-region="persistent"')
    expect(html).toContain('data-tool-family="mcpToolCall"')
    expect(html).not.toContain('data-command-activity-kind=')
  })

  it('uses worked-for lifecycle timing for the completed disclosure label', () => {
    const html = renderTurn({
      id: 'worked-for-turn',
      status: 'completed',
      durationMs: 99_000,
      items: [
        { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Inspect', text_elements: [] }] },
        command('command'),
        runtimeItem({
          type: 'worked-for',
          id: 'worked-for',
          status: 'worked',
          startedAtMs: 1_000,
          completedAtMs: 4_250
        }),
        { type: 'agentMessage', id: 'final', phase: 'final_answer', text: 'Done.' }
      ]
    })

    expect(html).toContain(`用时 ${formatTurnDuration(3_250, 'zh-CN')}`)
    expect(html).not.toContain('用时 1分钟 39秒')
    expect(html).not.toContain('已使用 worked-for')
  })

  it('renders realtime transcript entries with the original handoff rail', () => {
    const html = renderTurn({
      id: 'realtime-turn',
      status: 'interrupted',
      items: [
        { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Start voice', text_elements: [] }] },
        runtimeItem({
          type: 'realtime-transcript',
          id: 'transcript',
          handoffId: 'handoff-1',
          entries: [
            { role: 'user', text: 'Hello from voice' },
            { role: 'assistant', text: 'Hello back' }
          ]
        })
      ]
    })

    expect(html).toContain('class="realtime-transcript"')
    expect(html).toContain('data-realtime-handoff-id="handoff-1"')
    expect(html).toContain('Hello from voice')
    expect(html).toContain('Hello back')
    expect(html).not.toContain('已使用 realtime transcript')
  })

  it('renders request-user-input status instead of a generic tool fallback', () => {
    const html = renderTurn({
      id: 'user-input-turn',
      status: 'interrupted',
      items: [
        { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Ask me', text_elements: [] }] },
        runtimeItem({
          type: 'user-input-response',
          id: 'input',
          completed: true,
          questionsAndAnswers: [{ id: 'question', question: 'Which option?', answers: ['A'] }]
        })
      ]
    })

    expect(html).toContain('已询问')
    expect(html).toContain('1 个问题')
    expect(html).not.toContain('已使用 user-input-response')
  })

  it('keeps interrupted commentary inside an expanded Activity section', () => {
    const html = renderTurn({
      id: 'interrupted-commentary-turn',
      status: 'interrupted',
      durationMs: 14_000,
      items: [
        {
          type: 'userMessage',
          id: 'user',
          content: [{ type: 'text', text: 'Update Codex', text_elements: [] }]
        },
        {
          type: 'agentMessage',
          id: 'commentary',
          phase: 'commentary',
          text: 'I will inspect the repository first.'
        },
        command('command')
      ]
    })

    expect(html).toContain('class="turn-activity is-open is-terminal"')
    expect(html).toContain('<span>活动</span>')
    expect(html).not.toContain('你在 14秒 后停止了')
    expect(html).toContain('activity-commentary')
    expect(html.indexOf('<span>活动</span>')).toBeLessThan(html.indexOf('activity-commentary'))
    expect(html.indexOf('activity-commentary')).toBeLessThan(html.indexOf('运行了命令'))
    expect(html).not.toContain('class="agent-message-group"')
  })

  it('uses a terminal worked-for item as the Activity heading without duplicating it', () => {
    const html = renderTurn({
      id: 'interrupted-work-status-turn',
      status: 'interrupted',
      durationMs: 14_000,
      items: [
        {
          type: 'userMessage',
          id: 'user',
          content: [{ type: 'text', text: 'Update Codex', text_elements: [] }]
        },
        runtimeItem({ type: 'worked-for', id: 'worked-for', status: 'unknown' }),
        command('command')
      ]
    })

    expect(html.match(/<span>活动<\/span>/g)).toHaveLength(1)
    expect(html).not.toContain('worked-for-activity')
    expect(html).toContain('运行了命令')
  })

  it('shows the stopped duration only for an interrupt issued by this client', () => {
    const turn: Turn = {
      id: 'locally-interrupted-turn',
      status: 'interrupted',
      durationMs: 14_000,
      items: [
        {
          type: 'userMessage',
          id: 'user',
          content: [{ type: 'text', text: 'Stop this', text_elements: [] }]
        },
        command('command')
      ]
    }

    expect(renderTurn(turn)).toContain('<span>活动</span>')
    expect(renderTurn(turn)).not.toContain('你在 14秒 后停止了')
    expect(renderTurn(turn, false, { interruptedByThisClient: true }))
      .toContain('你在 14秒 后停止了')
  })

  it('keeps actions visible for the latest completed user message', () => {
    const html = renderTurn({
      id: 'latest-completed-turn',
      status: 'interrupted',
      items: [
        {
          type: 'userMessage',
          id: 'latest-user',
          content: [{ type: 'text', text: 'Latest message', text_elements: [] }]
        },
        command('command')
      ]
    }, false, { latestUserItemId: 'latest-user' })

    expect(html).toContain('class="message-actions is-persistent"')
    expect(html).toContain('aria-label="Copy message"')
  })

  it('does not duplicate an inline sent time when the turn has a timestamp header', () => {
    const startedAt = 1_700_000_000_000
    const html = renderTurn({
      id: 'timestamped-turn',
      status: 'completed',
      startedAt,
      items: [
        {
          type: 'userMessage',
          id: 'timestamped-user',
          content: [{ type: 'text', text: 'Earlier message', text_elements: [] }]
        }
      ]
    }, false, {
      latestUserItemId: 'timestamped-user',
      timestampSeparatorAtMs: startedAt
    })

    expect(html).toContain('class="conversation-timestamp-separator"')
    expect(html).not.toContain('class="user-message-sent-at"')
  })
})

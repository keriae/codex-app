import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TurnBlock } from './App'
import { CommandActivity, ConversationActivityItems } from './ConversationActivity'
import { conversationActivityProjection, conversationTurnActivityPhase } from './conversationActivityModel'
import type { ThreadItem, Turn } from './protocol'

const renderItem = (item: ThreadItem) => createElement('span', { 'data-item': item.id }, item.id)
const command = (id: string, status: 'inProgress' | 'completed'): ThreadItem => ({ type: 'commandExecution', id, command: 'pwd', status })
const subagent = (id: string, threadId: string, path: string, kind: string): ThreadItem => ({
  type: 'subAgentActivity', id, agentThreadId: threadId, agentPath: path, kind
})
const spawn = (id: string, receiverThreadIds: string[], prompt: string | null = null): ThreadItem => ({
  type: 'collabAgentToolCall', id, tool: 'spawnAgent', status: 'completed', receiverThreadIds, prompt
})
const activityStyles = readFileSync(new URL('./conversationActivity.css', import.meta.url), 'utf8')

describe('conversation activity disclosure ordering', () => {
  it('keeps commentary between separate detailed singleton commands', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, {
      items: [command('before', 'completed'), { type: 'agentMessage', id: 'commentary', text: 'Continue', phase: 'commentary' }, command('after', 'completed')], renderItem
    }))
    expect(html).not.toContain('conversation-activity-group')
    expect(html.indexOf('data-item="before"')).toBeLessThan(html.indexOf('data-item="commentary"'))
    expect(html.indexOf('data-item="after"')).toBeGreaterThan(html.indexOf('data-item="commentary"'))
  })

  it('renders an isolated completed command with its elapsed time and command text', () => {
    const item: ThreadItem = {
      type: 'commandExecution', id: 'capture', command: 'node capture.mjs', status: 'completed',
      durationMs: 1_000, commandActions: [{ type: 'unknown', command: 'node capture.mjs' }]
    }
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, {
      items: [item],
      renderItem: (entry, grouped) => entry.type === 'commandExecution'
        ? createElement(CommandActivity, { item: entry, compact: !grouped })
        : null
    }))

    expect(html).not.toContain('conversation-activity-group')
    expect(html).toContain('已在 1s 内运行')
    expect(html).toContain('node capture.mjs')
    expect(html).not.toContain('运行了命令')
  })
  it('shows only the latest active action without duplicating live reasoning', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { live: true, items: [
      command('older-command', 'inProgress'),
      { type: 'reasoning', id: 'displayed-reasoning', summary: ['Thinking'], content: [] },
      { type: 'reasoning', id: 'private-reasoning', summary: [], content: ['raw'] },
      command('latest-command', 'inProgress')
    ], renderItem }))
    expect(html).toContain('data-item="latest-command"')
    expect(html).not.toContain('data-item="displayed-reasoning"')
    expect(html).not.toContain('data-item="older-command"')
    expect(html).not.toContain('data-item="private-reasoning"')
  })

  it('uses the latest displayable reasoning only when no concrete action is running', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { live: true, items: [
      command('completed-command', 'completed'),
      { type: 'reasoning', id: 'displayed-reasoning', summary: ['Thinking'], content: [] },
      { type: 'reasoning', id: 'private-reasoning', summary: [], content: ['raw'] }
    ], renderItem }))
    expect(html).toContain('data-item="displayed-reasoning"')
    expect(html).not.toContain('data-item="private-reasoning"')
  })

  it('does not duplicate live reasoning beside active subagent work', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { live: true, items: [
      { type: 'reasoning', id: 'reasoning', summary: ['Delegating'], content: [] },
      subagent('agent-start', 'thread-audit', '/root/audit', 'started')
    ], renderItem }))
    expect(html).toContain('data-testid="subagent-activity-inline-group"')
    expect(html).not.toContain('data-item="reasoning"')
  })

  it('puts commands, MCP calls, dynamic tools and web searches in one completed group', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { items: [
      command('command', 'completed'),
      { type: 'mcpToolCall', id: 'mcp', server: 'github', tool: 'search_issues', status: 'completed', appContext: { appName: 'GitHub' } },
      { type: 'webSearch', id: 'web', query: 'Codex', status: 'completed' },
      { type: 'dynamicToolCall', id: 'dynamic', namespace: 'codex_app', tool: 'read_thread_terminal', status: 'completed' }
    ], renderItem }))
    expect(html.match(/class="conversation-activity-group"/g)).toHaveLength(1)
    expect(html).toContain('已使用 GitHub 集成')
    expect(html).toContain('运行了命令')
    expect(html).toContain('已搜索网页')
    expect(html).toContain('已读取终端')
  })

  it('keeps an interactive MCP App between detailed singleton commands', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { items: [
      command('before', 'completed'),
      { type: 'mcpToolCall', id: 'app', server: 'example', tool: 'open', status: 'completed', mcpAppResourceUri: 'ui://example/app' },
      command('after', 'completed')
    ], renderItem }))
    expect(html).not.toContain('conversation-activity-group')
    expect(html).toContain('data-item="before"')
    expect(html).toContain('data-item="app"')
    expect(html).toContain('data-item="after"')
  })

  it('projects both subagent event tracks onto stable source anchors', () => {
    const projection = conversationActivityProjection([
      spawn('duplicate-spawn', ['thread-audit']),
      subagent('z-anchor', 'thread-audit', '/root/audit', 'started'),
      { type: 'agentMessage', id: 'commentary', text: 'Next' },
      subagent('a-anchor', 'thread-tests', '/root/tests', 'started'),
      subagent('tests-complete', 'thread-tests', '/root/tests', 'completed')
    ])
    expect(projection.items.map((item) => item.id)).toEqual(['z-anchor', 'commentary', 'a-anchor', 'tests-complete'])
    expect(projection.subagentGroups.map((group) => group.anchorItemId)).toEqual(['z-anchor', 'a-anchor'])
    expect(projection.subagentGroups[1]).toMatchObject({
      itemIds: ['a-anchor', 'tests-complete'],
      items: [{ id: 'tests-complete', kind: 'completed' }]
    })
  })

  it('deduplicates repeated agent states while preserving first-seen name order', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { items: [
      spawn('duplicate-spawn', ['thread-audit', 'thread-tests']),
      subagent('audit-start', 'thread-audit', '/root/audit', 'started'),
      subagent('tests-start', 'thread-tests', '/root/tests', 'started'),
      subagent('audit-complete', 'thread-audit', '/root/audit', 'completed')
    ], renderItem }))
    expect(html.match(/data-testid="subagent-activity-inline-group"/gu)).toHaveLength(1)
    expect(html).toContain('Audit和Tests开始工作')
    expect(html).not.toContain('data-item="duplicate-spawn"')
    expect(html).not.toContain('data-item="audit-start"')
    expect(html).not.toContain('data-item="audit-complete"')
  })

  it('keeps meaningful or only partially covered spawn actions', () => {
    const prompted = conversationActivityProjection([
      spawn('prompted-spawn', ['thread-audit'], 'Audit the renderer'),
      subagent('audit-start', 'thread-audit', '/root/audit', 'started')
    ])
    const partiallyCovered = conversationActivityProjection([
      spawn('partial-spawn', ['thread-audit', 'thread-tests']),
      subagent('audit-start', 'thread-audit', '/root/audit', 'started')
    ])
    expect(prompted.items.map((item) => item.id)).toEqual(['prompted-spawn', 'audit-start'])
    expect(partiallyCovered.items.map((item) => item.id)).toEqual(['partial-spawn', 'audit-start'])
  })

  it('caps expanded groups at the shipped 224px scroll region with edge fades', () => {
    const bodyRule = activityStyles.match(/\.conversation-activity-group-body\s*\{([^}]*)\}/)?.[1] || ''
    expect(bodyRule).toContain('max-height: 224px')
    expect(bodyRule).toContain('overflow-y: auto')
    expect(bodyRule).toContain('margin-inline-start: -8px')
    expect(bodyRule).toContain('--edge-fade-distance: 1.5rem')
    expect(activityStyles).toContain('animation-timeline: scroll(self y)')
  })

  it('derives compact command tones from the active theme text token', () => {
    const rowRule = activityStyles.match(/\.conversation-command-item\.is-compact \.conversation-command-row\s*\{([^}]*)\}/)?.[1] || ''
    const detailRule = activityStyles.match(/\.conversation-command-item\.is-compact \.conversation-command-row:not\(\[data-command-activity-kind='command'\]\) \.activity-item-copy\s*\{([^}]*)\}/)?.[1] || ''
    expect(rowRule).toContain('var(--text) 40%')
    expect(detailRule).toContain('var(--text) 30%')
    expect(`${rowRule}${detailRule}`).not.toContain('rgb(252 252 252')
  })

  it('matches the shipped activity-header icon, label and disclosure spacing', () => {
    const commandRule = activityStyles.match(/\.conversation-command-row\s*\{([^}]*)\}/)?.[1] || ''
    const summaryRule = activityStyles.match(/\.conversation-command-summary\s*\{([^}]*)\}/)?.[1] || ''
    const groupIconRule = activityStyles.match(/\.conversation-activity-group-heading > \.conversation-activity-icon\s*\{([^}]*)\}/)?.[1] || ''
    const chevronRule = activityStyles.match(/\.activity-group-chevron\s*\{([^}]*)\}/)?.[1] || ''

    expect(commandRule).toContain('gap: 4px')
    expect(summaryRule).toContain('gap: 6px')
    expect(groupIconRule).toContain('margin-right: 2px')
    expect(chevronRule).toContain('var(--text) 60%')
    expect(activityStyles).toContain('.conversation-command-summary > .conversation-activity-icon')
  })
})

describe('turn activity lifecycle', () => {
  const phase = (overrides: Partial<Parameters<typeof conversationTurnActivityPhase>[0]> = {}) =>
    conversationTurnActivityPhase({
      active: true,
      finalAnswerStarted: false,
      hasVisibleActivity: false,
      interrupted: false,
      starting: false,
      thinking: false,
      ...overrides
    })

  it('replaces startup with thinking and then one live activity group', () => {
    expect(phase({ starting: true })).toBe('starting')
    expect(phase()).toBe('thinking')
    expect(phase({ hasVisibleActivity: true })).toBe('live')
  })

  it('collapses visible work when the final answer starts', () => {
    expect(phase({ finalAnswerStarted: true, hasVisibleActivity: true })).toBe('complete')
    expect(phase({ finalAnswerStarted: true, hasVisibleActivity: true, interrupted: true })).toBe('terminal')
    expect(phase({ active: false, hasVisibleActivity: false })).toBe('idle')
  })

  it('renders exactly one turn-level group as work becomes live and then complete', () => {
    const base: Turn = {
      id: 'turn',
      status: 'inProgress',
      items: [{ type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'Inspect' }] }]
    }
    const render = (turn: Turn, starting: boolean, thinking: boolean) => renderToStaticMarkup(createElement(TurnBlock, {
      turn,
      active: turn.status === 'inProgress',
      latestUserItemId: null,
      revertReason: null,
      starting,
      thinking,
      onRevert: () => undefined
    }))

    const starting = render(base, true, false)
    expect(starting).toContain('data-phase="starting"')
    expect(starting).toContain('正在开启聊天')
    expect(starting).not.toContain('data-activity-group="turn"')

    const live = render({
      ...base,
      items: [...base.items, { type: 'agentMessage', id: 'commentary', phase: 'commentary', text: 'Checking.' }, command('command', 'inProgress')]
    }, false, true)
    expect(live.match(/data-activity-group="turn"/g)).toHaveLength(1)
    expect(live).toContain('turn-activity is-open is-live')

    const complete = render({
      ...base,
      status: 'completed',
      durationMs: 5_000,
      items: [...base.items, command('command', 'completed'), { type: 'agentMessage', id: 'final', phase: 'final_answer', text: 'Done.' }]
    }, false, false)
    expect(complete.match(/data-activity-group="turn"/g)).toHaveLength(1)
    expect(complete).toContain('用时 5秒')
    expect(complete).toContain('aria-expanded="false"')
    expect(complete).toContain('Done.')
  })
})

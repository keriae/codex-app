import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  conversationTimestampMilliseconds,
  conversationTimestampSeparatorAt,
  formatConversationTimestampSeparator,
  formatUserMessageSentAt,
  TurnBlock
} from './App'
import { ConversationActivityItems } from './ConversationActivity'
import { completedActivityBatches } from './commandActivity'
import { conversationActivityItems, latestConversationReasoning } from './conversationActivityModel'
import type { ThreadItem, Turn } from './protocol'

// The two observed rollout sequences, with all identities and text replaced.
// r: empty reasoning; R/D/T: one/two/three summary parts; c: failed command.
const historyOrder = [
  'URArArrCRACCCrCRACCCRrrACrRcCCCrCCCrrrACrCCCCRRF',
  'UTRACCrcTRrADACRCRCTRACRrrArRCrrrCrrRArrrrrrrCRCCCCrArrCrCTRF'
]
const commandGroupIndices = [
  [[7], [10, 11, 12, 14], [17, 18, 19], [24, 27, 28, 29, 30, 32, 33, 34], [39, 41, 42, 43, 44]],
  [[4, 5, 7], [14, 16, 18], [22], [29, 33], [45, 47, 48, 49, 50], [55, 57]]
]

const repeatedShellCommand = '/bin/zsh -lc "printf repeated-script"'

function historyItem(code: string, turnIndex: number, itemIndex: number): ThreadItem {
  const id = `history-${turnIndex}-item-${itemIndex}`
  if (code === 'U') return { type: 'userMessage', id, content: [{ type: 'text', text: `User request ${turnIndex}` }] }
  if (code === 'A' || code === 'F') return {
    type: 'agentMessage', id, phase: code === 'F' ? 'final_answer' : 'commentary',
    text: code === 'F' ? `Final answer ${turnIndex}` : `Commentary ${turnIndex}.${itemIndex}`
  }
  if (code === 'C' || code === 'c') return {
    type: 'commandExecution', id, command: repeatedShellCommand,
    commandActions: [{ type: 'unknown', command: 'printf repeated-script' }],
    status: code === 'c' ? 'failed' : 'completed', exitCode: code === 'c' ? 1 : 0,
    durationMs: 2000, aggregatedOutput: 'Synthetic output'
  }
  const partCount = { r: 0, R: 1, D: 2, T: 3 }[code]
  if (partCount === undefined) throw new Error(`Unexpected history code ${code}`)
  return {
    type: 'reasoning', id,
    summary: Array.from({ length: partCount }, (_, index) => `Reasoning summary ${turnIndex}.${itemIndex}.${index}`),
    content: []
  }
}

const turns: Turn[] = historyOrder.map((order, turnIndex) => ({
  id: `history-turn-${turnIndex}`, status: 'completed',
  durationMs: turnIndex === 0 ? 603930 : 1109683,
  items: [...order].map((code, itemIndex) => historyItem(code, turnIndex, itemIndex))
}))
const allItems = turns.flatMap((turn) => turn.items)
const reasoningItems = allItems.filter((item) => item.type === 'reasoning')
const singletonCommandIds = new Set(commandGroupIndices.flatMap((groups, turnIndex) =>
  groups.filter((indices) => indices.length === 1).map((indices) => turns[turnIndex].items[indices[0]!]!.id)
))
const countClass = (html: string, name: string): number =>
  (html.match(new RegExp(`class="${name}(?:"|\\s)`, 'g')) || []).length

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('conversation timestamps', () => {
  const at = (year: number, month: number, day: number, hour: number, minute: number): number =>
    new Date(year, month - 1, day, hour, minute).getTime()
  const timestampTurn = (id: string, startedAtMs: number, completedAtMs?: number): Turn => ({
    id,
    status: 'completed',
    startedAt: startedAtMs / 1_000,
    completedAt: completedAtMs === undefined ? null : completedAtMs / 1_000,
    items: [
      { type: 'userMessage', id: `${id}-user`, content: [{ type: 'text', text: id }] },
      { type: 'agentMessage', id: `${id}-agent`, phase: 'final_answer', text: 'Done' }
    ]
  })

  it('normalizes app-server seconds and renderer milliseconds', () => {
    const timestamp = at(2026, 10, 25, 0, 19)
    expect(conversationTimestampMilliseconds(timestamp)).toBe(timestamp)
    expect(conversationTimestampMilliseconds(timestamp / 1_000)).toBe(timestamp)
    expect(conversationTimestampMilliseconds(null)).toBeNull()
    expect(conversationTimestampMilliseconds(Number.NaN)).toBeNull()
  })

  it('uses the original one-hour separator threshold', () => {
    const now = at(2026, 10, 26, 14, 0)
    const recent = timestampTurn('recent', now - 60 * 60 * 1_000)
    const old = timestampTurn('old', now - 60 * 60 * 1_000 - 1_000)
    expect(conversationTimestampSeparatorAt(recent, null, now)).toBeNull()
    expect(conversationTimestampSeparatorAt(old, null, now)).toBe(old.startedAt! * 1_000)
    expect(conversationTimestampSeparatorAt(old, null, now, false)).toBeNull()

    const previousAt = at(2026, 10, 25, 12, 0)
    const previous = timestampTurn('previous', previousAt - 30_000, previousAt)
    const exactGap = timestampTurn('exact-gap', previousAt + 60 * 60 * 1_000)
    const longGap = timestampTurn('long-gap', previousAt + 60 * 60 * 1_000 + 1_000)
    expect(conversationTimestampSeparatorAt(exactGap, previous, now, false)).toBeNull()
    expect(conversationTimestampSeparatorAt(longGap, previous, now, false)).toBe(longGap.startedAt! * 1_000)
  })

  it('formats centered separators and hover timestamps like zh-CN Codex', () => {
    const now = at(2026, 10, 26, 22, 0)
    expect(formatConversationTimestampSeparator(at(2026, 10, 25, 0, 19), now)).toBe('昨天 0:19')
    expect(formatConversationTimestampSeparator(at(2026, 10, 19, 0, 19), now)).toBe('星期一 0:19')
    expect(formatConversationTimestampSeparator(at(2026, 10, 18, 0, 19), now)).toBe('10月18日周日 0:19')
    expect(formatConversationTimestampSeparator(at(2025, 10, 18, 0, 19), now)).toBe('2025年10月18日 0:19')

    expect(formatUserMessageSentAt(at(2026, 10, 26, 21, 0), now)).toBe('21:00')
    expect(formatUserMessageSentAt(at(2026, 10, 25, 0, 19), now)).toBe('星期日00:19')
    expect(formatUserMessageSentAt(at(2026, 10, 19, 0, 19), now)).toBe('10月19日 0:19')
  })

  it('renders the semantic separator without duplicating an inline user timestamp', () => {
    const now = at(2026, 10, 26, 22, 0)
    const sentAt = at(2026, 10, 25, 0, 19)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const nativeAccess = vi.fn(() => { throw new Error('Static timestamp rendering must not access the native bridge') })
    const localStorage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('window', { localStorage, matchMedia: () => ({ matches: true }), codex: new Proxy({}, { get: nativeAccess }) })
    const turn = timestampTurn('timestamp-render', sentAt, sentAt + 15_000)
    const html = renderToStaticMarkup(createElement(TurnBlock, {
      turn,
      active: false,
      timestampSeparatorAtMs: sentAt,
      latestUserItemId: null,
      revertReason: null,
      starting: false,
      thinking: false,
      onRevert: vi.fn()
    }))
    expect(html).toContain('class="conversation-timestamp-separator"')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-label="昨天 0:19"')
    expect(html).toContain(`dateTime="${new Date(sentAt).toISOString()}"`)
    expect(html).not.toContain('class="user-message-sent-at"')
    expect(html).not.toContain('星期日00:19')
    expect(html).toContain('class="message-action-controls"')
    expect(nativeAccess).not.toHaveBeenCalled()
  })
})

describe('long completed conversation history layout', () => {
  it('retains the observed two-turn structure without using private content or identities', () => {
    expect(turns.map((turn) => turn.items.length)).toEqual([48, 61])
    expect(allItems).toHaveLength(109)
    expect(new Set(allItems.map((item) => item.id)).size).toBe(109)
    expect(reasoningItems).toHaveLength(55)
    expect(reasoningItems.filter((item) => item.summary.length === 0 && item.content.length === 0)).toHaveLength(33)
    expect(reasoningItems.flatMap((item) => item.summary)).toHaveLength(31)
    expect(allItems.filter((item) => item.type === 'agentMessage')).toHaveLength(15)
    expect(allItems.filter((item) => item.type === 'agentMessage' && item.phase === 'final_answer')).toHaveLength(2)
    const commands = allItems.filter((item) => item.type === 'commandExecution')
    expect(commands).toHaveLength(37)
    expect(commands.filter((item) => item.status === 'failed')).toHaveLength(2)
    expect(new Set(commands.map((item) => item.command)).size).toBe(1)
  })

  it('filters reasoning before batching, preserving every command and each commentary boundary', () => {
    const visible = conversationActivityItems(allItems)
    expect(visible).toHaveLength(54)
    expect(visible.some((item) => item.type === 'reasoning')).toBe(false)
    turns.forEach((turn, turnIndex) => {
      const batches = completedActivityBatches(conversationActivityItems(turn.items))
      expect(batches.map((batch) => batch.itemIds)).toEqual(
        commandGroupIndices[turnIndex].map((indices) => indices.map((index) => turn.items[index].id))
      )
      expect(batches.flatMap((batch) => batch.itemIds)).toEqual(
        turn.items.filter((item) => item.type === 'commandExecution').map((item) => item.id)
      )
      expect(batches.every((batch) => batch.summary.kind === 'commands')).toBe(true)
    })
    expect(completedActivityBatches(visible).flatMap((batch) => batch.itemIds)).toHaveLength(37)
  })

  it('renders multi-command groups while keeping singleton commands detailed', () => {
    const renderItem = vi.fn((item: ThreadItem) => createElement('span', {
      'data-history-item': item.id, 'data-history-type': item.type
    }, item.id))
    const html = turns.map((turn) => renderToStaticMarkup(createElement(ConversationActivityItems, {
      items: turn.items, renderItem
    }))).join('')
    expect(countClass(html, 'conversation-activity-group')).toBe(9)
    expect(countClass(html, 'conversation-activity-unit')).toBe(19)
    expect(countClass(html, 'conversation-thinking-status')).toBe(0)
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(9)
    expect(html).not.toContain('data-history-type="reasoning"')
    expect(html.match(/data-history-type="commandExecution"/g)).toHaveLength(2)
    expect(renderItem.mock.calls).toHaveLength(19)
    expect(renderItem.mock.calls.every(([item]) => item.type !== 'reasoning')).toBe(true)
    expect(renderItem.mock.calls.map(([item]) => item.id)).toEqual(
      allItems.filter((item) => item.type === 'userMessage' || item.type === 'agentMessage' || singletonCommandIds.has(item.id)).map((item) => item.id)
    )
  })

  it('does not create empty activity units for hidden rows or completed reasoning', () => {
    const renderItem = vi.fn((_item: ThreadItem) => null)
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, {
      items: [
        ...reasoningItems,
        { type: 'agentMessage', id: 'blank-commentary', phase: 'commentary', text: ' \n ' },
        { type: 'unknown', id: 'unsupported-row' }
      ], renderItem
    }))
    expect(countClass(html, 'conversation-activity-unit')).toBe(0)
    expect(countClass(html, 'conversation-activity-group')).toBe(0)
    expect(countClass(html, 'conversation-thinking-status')).toBe(0)
    expect(renderItem.mock.calls.map(([item]) => item.id)).toEqual(['unsupported-row'])
  })

  it('uses only the latest displayable live reasoning at the tail after the actual long command history', () => {
    const items = turns[1].items.slice(0, -1)
    const renderItem = vi.fn((item: ThreadItem) => createElement('span', {
      'data-history-item': item.id, 'data-history-type': item.type
    }, item.id))
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { items, live: true, renderItem }))
    expect(latestConversationReasoning(items)?.id).toBe('history-1-item-59')
    expect(countClass(html, 'conversation-thinking-status')).toBe(1)
    expect(html.match(/data-history-type="reasoning"/g)).toHaveLength(1)
    expect(html.indexOf('data-history-item="history-1-item-59"')).toBeGreaterThan(html.lastIndexOf('conversation-activity-group-heading'))
    expect(renderItem.mock.calls.filter(([item]) => item.type === 'reasoning').map(([item]) => item.id)).toEqual(['history-1-item-59'])
  })

  it('renders real completed TurnBlocks with collapsed work, visible final answers and no native effects', () => {
    const nativeAccess = vi.fn(() => { throw new Error('Static history rendering must not access the native bridge') })
    const localStorage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('window', { localStorage, matchMedia: () => ({ matches: true }), codex: new Proxy({}, { get: nativeAccess }) })
    const onRevert = vi.fn()
    const html = turns.map((turn) => renderToStaticMarkup(createElement(TurnBlock, {
      turn, active: false, latestUserItemId: null, revertReason: null,
      starting: false, thinking: false, onRevert
    }))).join('')
    expect(countClass(html, 'turn-block')).toBe(2)
    expect(countClass(html, 'activity-disclosure')).toBe(2)
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2)
    expect(html).toContain('User request 0')
    expect(html).toContain('User request 1')
    expect(html).toContain('Final answer 0')
    expect(html).toContain('Final answer 1')
    expect(html).not.toContain('Commentary')
    expect(html).not.toContain('Reasoning summary')
    expect(countClass(html, 'activity-collapse')).toBe(0)
    expect(countClass(html, 'conversation-activity-unit')).toBe(0)
    expect(countClass(html, 'turn-start-status')).toBe(0)
    expect(onRevert).not.toHaveBeenCalled()
    expect(nativeAccess).not.toHaveBeenCalled()
  })
})

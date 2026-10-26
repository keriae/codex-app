import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SubagentActivity, SubagentActivityContext, SubagentActivityGroup } from './SubagentActivity'
import { readSubagentThread, subagentModelDetail, type SubagentThreadRequest } from './subagentThreadModel'
import { subagentActivityBatches, subagentGroupEntries, subagentGroupStatus } from './subagentActivityModel'
import { ConversationActivityItems } from './ConversationActivity'
import type { Thread, Turn } from './protocol'

const thread: Thread = { id: 'child', cwd: '/tmp/project', createdAt: 1, updatedAt: 1, preview: '', model: 'gpt-6.1-sol', reasoningEffort: 'high', turns: [] }
const turn = (id: string): Turn => ({ id, status: 'completed', items: [{ id: `message-${id}`, type: 'agentMessage', text: id }] })

describe('background subagent transcript hydration', () => {
  it('reads legacy history without resuming or changing the selected conversation', async () => {
    const request = vi.fn().mockResolvedValue({ thread: { ...thread, turns: [turn('one')] } })
    expect((await readSubagentThread(request as SubagentThreadRequest, 'child')).turns.map((value) => value.id)).toEqual(['one'])
    expect(request.mock.calls).toEqual([['thread/read', { threadId: 'child', includeTurns: true }]])
  })
  it('loads every full page in chronological order when the server only returns metadata', async () => {
    const request = vi.fn().mockResolvedValueOnce({ thread: { ...thread, historyMode: 'paginated' } })
      .mockResolvedValueOnce({ data: [turn('one')], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: [turn('two')], nextCursor: null })
    const loaded = await readSubagentThread(request as SubagentThreadRequest, 'child')
    expect(loaded.turns.map((value) => value.id)).toEqual(['one', 'two'])
    expect(request.mock.calls[1]).toEqual(['thread/turns/list', { threadId: 'child', cursor: null, limit: 50, sortDirection: 'asc', itemsView: 'full' }])
    expect(request.mock.calls[2][1].cursor).toBe('next')
  })
  it('falls back after includeTurns is rejected and fails on repeated cursors', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('Use pagination'))
      .mockResolvedValueOnce({ thread })
      .mockResolvedValueOnce({ data: [turn('one')], nextCursor: 'stuck' })
      .mockResolvedValueOnce({ data: [turn('two')], nextCursor: 'stuck' })
    await expect(readSubagentThread(request as SubagentThreadRequest, 'child')).rejects.toThrow('重复分页游标')
    expect(request.mock.calls[1]).toEqual(['thread/read', { threadId: 'child', includeTurns: false }])
  })
  it('uses the native model and effort spelling in the transcript header', () => {
    expect(subagentModelDetail(thread)).toBe('GPT-6.1 Sol · 高')
    expect(subagentModelDetail({ ...thread, reasoningEffort: null })).toBe('GPT-6.1 Sol')
  })
  it('provides agent row navigation through the conversation context with proper Chinese spacing', () => {
    const html = renderToStaticMarkup(createElement(SubagentActivityContext.Provider, { value: { onOpen: vi.fn() } }, createElement(SubagentActivity, {
      item: { type: 'subAgentActivity', id: 'activity', agentThreadId: 'child', agentPath: '/root/audit', kind: 'completed' }
    })))
    expect(html).toContain('aria-label="打开子智能体 Audit"')
    expect(html).toContain('<span> 已完成</span>')
    expect(html).not.toContain('disabled=')
  })

  it('deduplicates adjacent agent updates and preserves commentary as a group boundary', () => {
    const first = { type: 'subAgentActivity' as const, id: 'started', agentThreadId: 'child', agentPath: '/root/audit', kind: 'started' }
    const second = { ...first, id: 'finished', kind: 'completed' }
    expect(subagentGroupEntries([first, second])).toEqual([{ threadId: 'child', name: 'Audit', status: 'completed' }])
    expect(subagentActivityBatches([first, second, { type: 'agentMessage', id: 'commentary', text: 'Continue' }, { ...first, id: 'new-event' }]).map((batch) => batch.itemIds)).toEqual([['started', 'finished']])
    expect(subagentGroupStatus([{ threadId: 'child', name: 'Audit', status: 'completed' }, { threadId: 'other', name: 'Other', status: 'updated' }])).toBe('updated')
  })

  it('renders the native grouped avatar limit and first-two-name overflow sentence', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ type: 'subAgentActivity' as const, id: `activity-${index}`, agentThreadId: `child-${index}`, agentPath: `/root/agent_${index + 1}`, kind: 'started' }))
    const html = renderToStaticMarkup(createElement(SubagentActivityGroup, { items, onOpen: vi.fn() }))
    expect(html).toContain('data-testid="subagent-activity-inline-group"')
    expect(html.match(/data-avatar-index=/gu)).toHaveLength(4)
    expect(html).toContain('另外3个子智能体')
    expect(html).toContain('开始工作')
    expect(html.match(/class="subagent-inline-name"/gu)).toHaveLength(3)
  })

  it('shows one grouped activity in the conversation for adjacent agent events', () => {
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, { items: [
      { type: 'subAgentActivity', id: 'first', agentThreadId: 'a', agentPath: '/root/audit', kind: 'started' },
      { type: 'subAgentActivity', id: 'second', agentThreadId: 'b', agentPath: '/root/tests', kind: 'started' }
    ], renderItem: (item) => createElement('span', { 'data-item': item.id }, item.id) }))
    expect(html.match(/data-testid="subagent-activity-inline-group"/gu)).toHaveLength(1)
    expect(html).toContain('Audit和Tests开始工作')
    expect(html).not.toContain('data-item=')
  })
})

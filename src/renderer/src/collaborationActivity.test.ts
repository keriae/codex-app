import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollaborationActivity } from './CollaborationActivity'
import { collaborationActivityGroups, collaborationHeader, collaborationModelLabel, collaborationRows } from './collaborationActivityModel'
import type { ToolItem } from './protocol'

function action(tool: string, fields: Record<string, unknown> = {}): ToolItem {
  return { type: 'collabAgentToolCall', id: tool, tool, status: 'completed', ...fields }
}

describe('native multi-agent action activity', () => {
  it('hides wait and preserves standalone actions instead of merging native subagent completion rows', () => {
    const spawn = action('spawnAgent')
    const message = action('sendInput')
    expect(collaborationActivityGroups([spawn, action('wait'), { type: 'subAgentActivity', id: 'activity', kind: 'completed' }, message])).toEqual([[spawn], [message]])
    expect(collaborationHeader([action('wait')])).toBeNull()
    expect(collaborationRows([action('wait')])).toEqual([])
  })

  it('counts distinct receivers from nested thread data and states, with source Chinese concatenation', () => {
    const header = collaborationHeader([
      action('spawnAgent', { receiverThreads: [{ threadId: 'b', thread: { agentNickname: 'B' } }], agentsStates: { a: { status: 'running' }, b: { status: 'running' } } }),
      action('spawnAgent', { id: 'spawn-2', receiverThreadIds: ['a'] })
    ])
    expect(header).toEqual({ action: '已创建', countLabel: '2 个智能体', label: '已创建2 个智能体', status: 'completed' })
    expect(collaborationHeader([action('spawnAgent')])?.label).toBe('已创建1 个智能体')
  })

  it('uses in-progress, failed, interrupted, completed aggregate precedence', () => {
    expect(collaborationHeader([action('closeAgent', { status: 'interrupted' }), action('closeAgent', { id: 'failed', status: 'failed' })])?.action).toBe('无法关闭')
    expect(collaborationHeader([action('closeAgent', { status: 'failed' }), action('closeAgent', { id: 'running', status: 'inProgress' })])?.action).toBe('正在关闭')
    expect(collaborationHeader([action('resumeAgent', { status: 'interrupted' })])?.action).toBe('已中断')
    expect(collaborationHeader([action('listAgents', { status: 'inProgress' })])?.action).toBe('房源')
  })

  it('uses named receivers in sorted ID order and strips only a leading nickname @', () => {
    const rows = collaborationRows([action('spawnAgent', { receiverThreads: [
      { threadId: 'z', thread: { agentNickname: ' @Late ', agentRole: 'default' } },
      { threadId: 'a', thread: { source: { subAgent: { thread_spawn: { agent_nickname: 'From source', agent_role: 'reviewer' } } } } },
      { threadId: 'unknown', thread: null }
    ] })])
    expect(rows.map((row) => row.agent?.name)).toEqual(['From source', 'Late'])
    expect(rows[0].agent?.role).toBe('reviewer')
    expect(rows[1].agent?.role).toBeNull()
    expect(collaborationRows([action('spawnAgent', { receiverThreadIds: ['unresolved'] })])[0].kind).toBe('generic')
  })

  it('uses completed spawn instructions and message prompts inline, with other prompts as wrapping metadata', () => {
    const receiverThreads = [{ threadId: 'one', thread: { agentNickname: 'One' } }]
    expect(collaborationRows([action('spawnAgent', { receiverThreads, prompt: 'Run the audit' })])[0]).toMatchObject({ kind: 'spawn', prompt: 'Run the audit' })
    expect(collaborationRows([action('spawnAgent', { receiverThreads, status: 'inProgress', prompt: 'Run the audit' })]).map((row) => row.kind)).toEqual(['agent', 'prompt'])
    expect(collaborationRows([action('sendInput', { receiverThreads, status: 'failed', prompt: 'Try again' })])[0]).toMatchObject({ kind: 'message', action: '无法发送消息', prompt: 'Try again' })
    expect(collaborationRows([action('closeAgent', { receiverThreads, prompt: '  first\nsecond  ' })])[1]).toMatchObject({ kind: 'prompt', action: '输入：', prompt: '  first\nsecond  ' })
    // Native completed-spawn generic fallback does not append a duplicate prompt metadata row.
    expect(collaborationRows([action('spawnAgent', { prompt: 'No known receiver yet' })]).map((row) => row.kind)).toEqual(['generic'])
  })

  it('shows status/message suffixes for ordinary actions and omits them for close/resume', () => {
    const fields = { receiverThreadIds: ['agent'], agentsStates: { agent: { status: 'errored', message: 'exit 1' } } }
    const names = new Map([['agent', 'Auditor']])
    expect(collaborationRows([action('interruptAgent', fields)], undefined, names)[0].stateSuffix).toBe(' (出错: exit 1)')
    expect(collaborationRows([action('closeAgent', fields)], undefined, names)[0].stateSuffix).toBe('')
    expect(collaborationRows([action('resumeAgent', fields)], undefined, names)[0].stateSuffix).toBe('')
  })

  it('inherits spawn models for the same receiver without adding a model text row', () => {
    const receiverThreads = [{ threadId: 'one', thread: { agentNickname: 'One' } }]
    const rows = collaborationRows([action('spawnAgent', { receiverThreads }), action('sendInput', { receiverThreads, prompt: 'Continue' })], 'gpt-6.1-sol')
    expect(rows.map((row) => row.agent?.model)).toEqual(['gpt-6.1-sol', 'gpt-6.1-sol'])
    expect(collaborationRows([action('sendInput', { receiverThreads })], 'gpt-6.1-sol')[0].agent?.model).toBeNull()
    expect(collaborationRows([action('spawnAgent', { agentsStates: { one: { agentNickname: 'One' } } })], 'gpt-6.1-sol')[0].agent?.model).toBeNull()
    expect(collaborationModelLabel('gpt-6.1-sol')).toBe('GPT-6.1 Sol')
    expect(collaborationModelLabel('o3')).toBe('o3')
  })

  it('renders an initially collapsed disclosure with source icon, named receiver link, and model tooltip', () => {
    const html = renderToStaticMarkup(createElement(CollaborationActivity, {
      items: [action('spawnAgent', { receiverThreads: [{ threadId: 'auditor', thread: { agentNickname: 'Auditor' } }], prompt: 'Audit the code' })],
      parentModel: 'gpt-6.1-sol', onOpen: vi.fn()
    }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('已创建')
    expect(html).toContain('1 个智能体')
    expect(html).toContain('lucide-bot')
    expect(html).toContain('class="collaboration-agent-name"')
    expect(html).toContain('data-tooltip="使用 GPT-6.1 Sol"')
    expect(html).toContain('aria-label="打开子智能体 Auditor"')
    expect(html).toContain('已使用以下指令创建')
    expect(html).toContain('Audit the code')
    expect(html).not.toContain('Auditor 已完成')
  })

  it('uses the native sweep overlay only for active action text', () => {
    const running = renderToStaticMarkup(createElement(CollaborationActivity, { items: [action('spawnAgent', { status: 'inProgress' })] }))
    const complete = renderToStaticMarkup(createElement(CollaborationActivity, { items: [action('spawnAgent')] }))
    expect(running).toContain('cadenced-shimmer-sweep')
    expect(running).toContain('aria-hidden="true"')
    expect(complete).not.toContain('cadenced-shimmer-sweep')
  })
})

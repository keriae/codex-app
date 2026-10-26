import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ToolActivity, ToolResultContent } from './ToolActivity'
import { isConversationActivityItem } from './conversationActivityModel'
import { formatWebSearchQuery, normalizedToolName, rawToolCallOutput, safeToolResourceUrl, toolActivityLabel, toolActivityStatus, toolDisplayResult, toolErrorText, toolResultBlocks, webSearchDetail } from './toolActivityModel'
import type { ToolItem } from './protocol'

const tool = (fields: Partial<ToolItem> = {}): ToolItem => ({ type: 'mcpToolCall', id: 'call', server: 'example', tool: 'read_info', status: 'completed', ...fields })
const toolStyles = readFileSync(new URL('./toolActivity.css', import.meta.url), 'utf8')

describe('shipped tool invocation labels', () => {
  it('uses active/invoked metadata and avoids a success invocation label for failures', () => {
    const fields = { toolDefinition: { title: 'Read account', _meta: { 'openai/toolInvocation/invoking': 'Reading account', 'openai/toolInvocation/invoked': 'Account read' } } }
    expect(toolActivityLabel(tool({ ...fields, status: 'inProgress' }))).toBe('Reading account')
    expect(toolActivityLabel(tool(fields))).toBe('Account read')
    expect(toolActivityLabel(tool({ ...fields, status: 'failed' }))).toBe('Read account')
  })
  it('prioritizes native Codex actions and handles opposite boolean actions', () => {
    expect(toolActivityLabel(tool({ server: 'codex_app', tool: 'set_thread_archived', arguments: { archived: false }, status: 'inProgress' }))).toBe('正在恢复聊天')
    expect(toolActivityLabel(tool({ server: 'codex_app', tool: 'set_thread_pinned', arguments: { pinned: false } }))).toBe('已取消置顶聊天')
    expect(toolActivityLabel(tool({ type: 'dynamicToolCall', server: undefined, namespace: 'codex_app', tool: 'read_thread_terminal', status: 'inProgress' }))).toBe('正在读取终端')
  })
  it('uses native JavaScript titles with normalized whitespace and the 80-character boundary', () => {
    expect(toolActivityLabel(tool({ server: 'node_repl', tool: 'js', arguments: { title: '  Inspect \n layout   state ' } }))).toBe('Inspect layout state')
    expect(toolActivityLabel(tool({ tool: 'js', arguments: { title: 'a'.repeat(90) } }))).toBe(`${'a'.repeat(79)}…`)
  })
  it('resolves connector prefixes and the retained registry across tool families', () => {
    const item = tool({ server: 'codex_apps', tool: 'github_mcp_server_search_issues', appContext: { connectorId: 'connector_github', appName: 'GitHub' } })
    expect(normalizedToolName(item)).toBe('search_issues')
    expect(toolActivityLabel(item)).toBe('已搜索问题')
    expect(toolActivityLabel(tool({ server: 'google_drive', tool: 'create_file', status: 'inProgress' }))).toBe('正在创建文件')
    expect(toolActivityLabel(tool({ server: 'slack', tool: 'delete_message' }))).toBe('已删除消息')
  })
  it('keeps readable generic calls and browser source fallbacks', () => {
    expect(toolActivityLabel(tool({ tool: 'example_unknown_action' }))).toBe('Example unknown action')
    expect(toolActivityLabel(tool({ source: { kind: 'browserUse', backend: 'chrome' } }))).toBe('使用了 Chrome')
    expect(toolActivityStatus(tool({ result: { isError: true } }))).toBe('failed')
  })
})

describe('native web search detail conversion', () => {
  it('separates repeated site restrictions and preserves a query made only of restrictions', () => {
    expect(formatWebSearchQuery('codex site:www.github.com OR site:openai.com site:github.com')).toBe('codex | github.com · openai.com')
    expect(formatWebSearchQuery('site:github.com')).toBe('site:github.com')
  })
  it('shows the first query with the native multiple-query suffix', () => {
    expect(webSearchDetail(tool({ type: 'webSearch', query: 'fallback', action: { type: 'search', queries: ['first site:github.com', 'second'] } }))).toBe('first | github.com ...')
    expect(webSearchDetail(tool({ type: 'webSearch', action: { type: 'findInPage', url: 'https://example.com', pattern: 'Codex' } }))).toBe("'Codex' in https://example.com")
  })
  it('omits empty searches and internal status tools from visible activity', () => {
    expect(isConversationActivityItem(tool({ type: 'webSearch', query: '  ' }))).toBe(false)
    expect(isConversationActivityItem(tool({ type: 'dynamicToolCall', namespace: 'codex_app', tool: 'update_up_next' }))).toBe(false)
  })
  it('renders source Chinese summary/details and a live sweep', () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, { item: tool({ type: 'webSearch', query: 'Codex', status: 'inProgress' }) }))
    expect(html).toContain('正在搜索网页')
    expect(html).toContain('：Codex')
    expect(html).toContain('cadenced-shimmer-sweep')
  })
  it('keeps the source web-search emphasis when the live row is compact', () => {
    const compactToolRule = toolStyles.match(/\.tool-activity\.is-compact\s*\{([^}]*)\}/)?.[1] || ''
    const detailRule = toolStyles.match(/\.tool-web-search-detail\s*\{([^}]*)\}/)?.[1] || ''
    expect(compactToolRule).toContain('var(--text) 40%')
    expect(detailRule).toContain('var(--text) 40%')
    expect(toolStyles).not.toContain('.tool-web-search.is-compact')
  })
})

describe('MCP result content and raw output', () => {
  it('does not duplicate equivalent JSON text and structured output', () => {
    expect(toolDisplayResult(tool({ result: { content: [{ type: 'text', text: '{"count": 3}' }], structuredContent: { count: 3 } } }))).toEqual({ blocks: [], structuredJson: '{\n  "count": 3\n}' })
    const separate = toolDisplayResult(tool({ result: { content: [{ type: 'text', text: 'Found three entries' }], structuredContent: { count: 3 } } }))
    expect(separate.blocks).toEqual([{ type: 'text', text: 'Found three entries' }])
    expect(separate.structuredJson).toContain('"count": 3')
  })
  it('retains image/audio/resource/link families without treating unknown blocks as text', () => {
    const blocks = toolResultBlocks(tool({ result: { content: [
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'audio', mimeType: 'audio/wav', data: 'BBBB' },
      { type: 'resource_link', uri: 'https://example.com/report', name: 'Report' },
      { type: 'resource', resource: { uri: 'file:///tmp/report', text: 'Content', mimeType: 'text/plain' } },
      { type: 'custom', value: 'Unsupported' }
    ] } }))
    expect(blocks.map((block) => block.type)).toEqual(['image', 'audio', 'resourceLink', 'resource', 'unknown'])
    expect(blocks[0]).toMatchObject({ source: 'data:image/png;base64,AAAA' })
    expect(blocks[1]).toMatchObject({ source: 'data:audio/wav;base64,BBBB' })
  })
  it('does not mount image result content until its activity disclosure opens', () => {
    const source = 'data:image/png;base64,QUJDRA=='
    const html = renderToStaticMarkup(createElement(ToolActivity, {
      item: tool({ result: { content: [{ type: 'image', mimeType: 'image/png', data: 'QUJDRA==' }] } })
    }))

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('tool-activity-body')
    expect(html).not.toContain('tool-result-image')
    expect(html).not.toContain(source)
  })
  it('makes protocol and tool failures visible', () => {
    expect(toolErrorText(tool({ error: { message: 'Server unavailable' } }))).toBe('Server unavailable')
    expect(toolErrorText(tool({ status: 'failed', result: { content: [{ type: 'text', text: 'Permission denied' }] } }))).toBe('Permission denied')
  })
  it('preserves invocation parameters, duration, and output in the raw dialog payload', () => {
    const raw = JSON.parse(rawToolCallOutput(tool({ arguments: { query: 'Codex' }, durationMs: 120, result: { content: [{ type: 'text', text: 'Done' }] } })))
    expect(raw).toEqual({ callId: 'call', invocation: { server: 'example', tool: 'read_info', arguments: { query: 'Codex' } }, durationMs: 120, result: { content: [{ type: 'text', text: 'Done' }] } })
  })
  it('escapes tool text and does not activate non-web resource URLs', () => {
    expect(safeToolResourceUrl('javascript:alert(1)')).toBeNull()
    const textHtml = renderToStaticMarkup(createElement(ToolResultContent, { block: { type: 'text', text: '<script>alert(1)</script>' } }))
    expect(textHtml).toContain('&lt;script&gt;')
    expect(textHtml).not.toContain('<script>')
    const resourceHtml = renderToStaticMarkup(createElement(ToolResultContent, { block: { type: 'resourceLink', uri: 'file:///tmp/report', name: 'Report', description: null, mimeType: null } }))
    expect(resourceHtml).not.toContain('href=')
    expect(resourceHtml).toContain('Report')
  })
  it('starts collapsed with the source activity label and renders retry errors directly', () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, { item: tool({ server: 'slack', tool: 'delete_message' }) }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('已删除消息')
    const errorHtml = renderToStaticMarkup(createElement(ToolActivity, { item: tool({ type: 'error', message: 'Reconnecting 1/3', willRetry: true }) }))
    expect(errorHtml).toContain('is-retrying')
    expect(errorHtml).toContain('Reconnecting 1/3')
    expect(errorHtml).not.toContain('aria-expanded')
  })
})

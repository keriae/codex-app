import type { ToolItem } from './protocol'
import { codexActivityLabels, connectorActivityLabels } from './toolActivityCatalog'

export type ToolActivityStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted'
export type ToolResultBlock =
  | { type: 'text'; text: string; annotations?: string }
  | { type: 'image' | 'audio'; source: string; mimeType: string; annotations?: string }
  | { type: 'resourceLink'; uri: string; name: string; description: string | null; mimeType: string | null; annotations?: string }
  | { type: 'resource'; uri: string; mimeType: string | null; text: string | null; annotations: string | null }
  | { type: 'unknown'; json: string }

export function toolRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function toolJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try { return JSON.stringify(value, null, 2) ?? null } catch { return String(value) }
}

export function toolActivityStatus(item: ToolItem, live?: boolean): ToolActivityStatus {
  if (item.status === 'inProgress' || item.completed === false || live === true && item.type === 'webSearch' && !item.status) return 'inProgress'
  if (item.status === 'interrupted' || item.status === 'declined') return 'interrupted'
  if (item.status === 'failed' || item.error != null || item.success === false || item.result?.isError === true) return 'failed'
  return 'completed'
}

function words(value: string): string[] { return value.trim().toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean) }
export function readableToolName(value: string): string {
  const normalized = words(value).join(' ')
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : value
}

/** Na/La/ka in the shipped label module remove connector prefixes repeatedly. */
export function normalizedToolName(item: ToolItem): string {
  const context = toolRecord(item.appContext)
  const app = toolRecord(item.matchingApp)
  const identifiers = [context?.appName, context?.connectorId, app?.name, app?.id, ...(connectorFamily(item) ? [item.server] : []),
    ...(Array.isArray(app?.pluginDisplayNames) ? app.pluginDisplayNames : [])]
    .filter((value): value is string => typeof value === 'string')
  const prefixes = identifiers.flatMap((value) => {
    const prefix = words(value.replace(/^connector[_-]/iu, ''))
    return [prefix, [...prefix, 'mcp'], [...prefix, 'mcp', 'server']]
  }).filter((prefix) => prefix.length).sort((a, b) => b.length - a.length)
  let parts = words(text(context?.actionName) || item.tool || '')
  while (parts.length) {
    const prefix = prefixes.find((prefix) => prefix.length < parts.length && prefix.every((value, index) => value === parts[index]))
    if (!prefix) break
    parts = parts.slice(prefix.length)
  }
  return parts.join('_')
}

function connectorFamily(item: ToolItem): string | null {
  const context = toolRecord(item.appContext)
  const app = toolRecord(item.matchingApp)
  const source = [context?.connectorId, context?.appName, app?.id, app?.name, item.server].filter((value) => typeof value === 'string').join(' ').toLowerCase()
  const aliases: Array<[string, string]> = [['google_calendar', 'googleCalendar'], ['google calendar', 'googleCalendar'], ['google_drive', 'googleDrive'], ['google drive', 'googleDrive'], ['linear_mcp_server', 'linear'], ['notion_mcp_server', 'notion']]
  for (const [alias, family] of aliases) if (source.includes(alias)) return family
  return Object.keys(connectorActivityLabels).find((family) => source.includes(family.toLowerCase())) || null
}

function codexToolName(item: ToolItem): string | null {
  const context = toolRecord(item.appContext)
  const tool = text(context?.actionName) || item.tool || ''
  if (item.server === 'codex_app' || item.namespace === 'codex_app' || item.type === 'dynamicToolCall' && item.namespace == null) return tool
  if (item.server === 'codex_apps' && (tool.startsWith('cloud_threads.') || tool.startsWith('cloud_threads_'))) return tool.replace(/^cloud_threads[._]/u, 'cloud_threads.')
  return null
}

function selectedCodexAction(tool: string, args: Record<string, unknown>): string {
  if (tool === 'set_thread_archived' && args.archived === false) return 'restore_chat'
  if (tool === 'set_thread_pinned' && args.pinned === false) return 'unpin_chat'
  if (tool === 'automation_update' && typeof args.mode === 'string' && args.mode !== 'create') return args.mode === 'update' ? 'automation_mode_update' : `automation_${args.mode}`
  if (tool === 'open_in_codex') return `open_${text(toolRecord(args.target)?.type) || 'file'}`
  return tool
}

/** xa/wa: native action, JS title, tool metadata, connector, then readable tool name. */
export function toolActivityLabel(item: ToolItem, live?: boolean): string {
  const state = toolActivityStatus(item, live)
  const completed = state !== 'inProgress'
  const args = toolRecord(item.arguments) || {}
  const codexTool = codexToolName(item)
  if (codexTool) {
    const catalog = codexActivityLabels[selectedCodexAction(codexTool, args)]
    const label = catalog?.[state === 'inProgress' ? 'active' : state === 'failed' ? 'failed' : 'completed']
    if (label) return label
    if (codexTool === 'read_thread_terminal') return completed ? '已读取聊天终端' : '正在读取聊天终端'
    if (codexTool === 'load_workspace_dependencies') return completed ? 'Loaded workspace dependencies' : 'Loading workspace dependencies'
    if (codexTool === 'pia_slackbot_dm') return 'Pia Slackbot DM'
  }
  const normalized = normalizedToolName(item)
  if (normalized === 'js') {
    const title = text(args.title)?.replace(/\s+/gu, ' ')
    if (title) return title.length <= 80 ? title : `${title.slice(0, 79).trimEnd()}…`
  }
  const display = toolRecord(item.toolDisplay) || {}
  const definition = toolRecord(item.toolDefinition) || {}
  const meta = toolRecord(definition._meta) || {}
  const invoked = completed ? display.invoked ?? meta['openai/toolInvocation/invoked'] : display.invoking ?? meta['openai/toolInvocation/invoking']
  const invocationLabel = state !== 'failed' ? text(invoked) : null
  const metadataLabel = invocationLabel || text(display.title) || text(definition.title)
  if (metadataLabel) return metadataLabel
  const family = connectorFamily(item)
  const registryLabel = family ? connectorActivityLabels[family]?.[normalized]?.[completed ? 'completed' : 'active'] : null
  if (registryLabel) return registryLabel
  const source = toolRecord(item.source)
  if (source?.kind === 'browserUse') return source.backend === 'chrome' ? '使用了 Chrome' : '使用了浏览器'
  return readableToolName(normalized || item.tool || item.type)
}

/** tO/nO/rO/iO: retain the first query, site restrictions, URL and find pattern. */
export function webSearchDetail(item: ToolItem): string {
  const action = toolRecord(item.action)
  let detail = ''
  if (action?.type === 'openPage') detail = text(action.url) || ''
  else if (action?.type === 'findInPage') {
    const pattern = text(action.pattern), url = text(action.url)
    detail = pattern && url ? `'${pattern}' in ${url}` : pattern ? `'${pattern}'` : url || ''
  } else if (action?.type === 'search') {
    const queries = Array.isArray(action.queries) ? action.queries.filter((value): value is string => typeof value === 'string' && !!value.trim()) : []
    const query = text(action.query) || queries[0] || ''
    detail = formatWebSearchQuery(query)
    if (!text(action.query) && queries.length > 1 && detail) detail += ' ...'
  }
  return detail.trim() || text(item.query) || ''
}

export function formatWebSearchQuery(query: string): string {
  const domains: string[] = []
  const rest = query.replace(/\bsite:([^\s]+)/giu, (full, domain: string) => {
    try {
      const hostname = new URL(`https://${domain}`).hostname.replace(/^www\./u, '')
      if (!domains.includes(hostname)) domains.push(hostname)
      return ''
    } catch { return full }
  }).replace(/\b(?:OR|AND)\b/gu, ' ').replace(/\s+/gu, ' ').trim()
  return domains.length && rest ? `${rest} | ${domains.join(' · ')}` : query
}

export function toolErrorText(item: ToolItem): string | null {
  if (text(item.error?.message)) return text(item.error?.message)
  if (toolActivityStatus(item) !== 'failed') return null
  const blocks = toolResultBlocks(item)
  return blocks.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n') || toolJson(item.result?.structuredContent) || '工具调用失败'
}

function mediaSource(data: unknown, mimeType: unknown, kind: 'image' | 'audio'): string | null {
  const mime = text(mimeType)
  if (typeof data !== 'string' || !mime?.startsWith(`${kind}/`)) return null
  return `data:${mime};base64,${data}`
}

/** ka/Oa in the shipped MCP renderer show the three MCP annotation fields. */
export function toolResultAnnotations(value: unknown): string | null {
  const annotations = toolRecord(value)
  if (!annotations) return null
  const fields: string[] = []
  const audience = Array.isArray(annotations.audience)
    ? annotations.audience.filter((value): value is string => typeof value === 'string') : []
  if (audience.length) fields.push(`audience=${audience.join(', ')}`)
  if (typeof annotations.priority === 'number' && Number.isFinite(annotations.priority)) fields.push(`priority=${annotations.priority}`)
  if (typeof annotations.lastModified === 'string' && annotations.lastModified) fields.push(`lastModified=${annotations.lastModified}`)
  return fields.length ? fields.join('; ') : null
}

export function safeToolResourceUrl(uri: string): string | null {
  try {
    const url = new URL(uri)
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null
  } catch { return null }
}

export function toolResultBlocks(item: ToolItem): ToolResultBlock[] {
  const content = item.type === 'dynamicToolCall' ? item.contentItems : item.result?.content
  if (!Array.isArray(content)) return []
  return content.map((value): ToolResultBlock => {
    const block = toolRecord(value)
    const annotationText = toolResultAnnotations(block?.annotations)
    const annotations = annotationText ? { annotations: annotationText } : {}
    if (block?.type === 'text' && typeof block.text === 'string' || block?.type === 'inputText' && typeof block.text === 'string') return { type: 'text', text: String(block.text), ...annotations }
    if (block?.type === 'image' || block?.type === 'audio') {
      const source = mediaSource(block.data, block.mimeType, block.type)
      if (source) return { type: block.type, source, mimeType: String(block.mimeType), ...annotations }
    }
    if (block?.type === 'resource_link') return {
      type: 'resourceLink', uri: typeof block.uri === 'string' ? block.uri : '',
      // Ea uses nullish title/name/URI precedence, preserving even empty titles.
      name: typeof block.title === 'string' ? block.title : typeof block.name === 'string' ? block.name : typeof block.uri === 'string' ? block.uri : '',
      description: text(block.description), mimeType: text(block.mimeType), ...annotations
    }
    if (block?.type === 'resource' || block?.type === 'embedded_resource') {
      const resource = toolRecord(block.resource)
      if (resource) return {
        type: 'resource', uri: typeof resource.uri === 'string' ? resource.uri : '',
        mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : null,
        text: typeof resource.text === 'string' ? resource.text : typeof resource.blob === 'string' ? resource.blob : null,
        annotations: toolResultAnnotations(resource.annotations)
      }
    }
    return { type: 'unknown', json: toolJson(value) || '' }
  })
}

/** Ta: don't render the same JSON twice as a text block and structured output. */
export function toolDisplayResult(item: ToolItem): { blocks: ToolResultBlock[]; structuredJson: string | null } {
  const blocks = toolResultBlocks(item)
  const structuredJson = toolJson(item.result?.structuredContent)
  if (blocks.length === 1 && blocks[0].type === 'text' && !blocks[0].annotations) {
    try {
      const json = JSON.stringify(JSON.parse(blocks[0].text), null, 2)
      if (structuredJson === null || structuredJson === json) return { blocks: [], structuredJson: json }
    } catch { /* Text output remains text. */ }
  }
  return { blocks, structuredJson }
}

export function rawToolCallOutput(item: ToolItem): string {
  return toolJson({ callId: item.id, invocation: { server: item.server || item.namespace || null, tool: item.tool, arguments: item.arguments }, durationMs: item.durationMs, result: item.result ?? (item.contentItems ? { content: item.contentItems, success: item.success } : null) }) || ''
}

export function isSpecializedToolActivity(item: ToolItem): boolean {
  return ['mcpToolCall', 'dynamicToolCall', 'webSearch', 'contextCompaction', 'enteredReviewMode', 'exitedReviewMode'].includes(item.type)
}

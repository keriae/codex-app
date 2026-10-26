import { commandDurationMs, normalizeCommandActions } from './commandActions'
import type { CommandAction, CommandItem, ThreadItem } from './protocol'
import {
  conversationActivityGrouping,
  conversationActivityItems,
  isConversationActivityInProgress
} from './conversationActivityModel'
import { toolActivityLabel, toolRecord } from './toolActivityModel'

export type CommandActivityKind = 'read' | 'search' | 'listFiles' | 'command'

export interface CommandActivityCopy {
  kind: CommandActivityKind
  action: string
  detail: string | null
}

export interface CommandActivityRow extends CommandActivityCopy {
  command: string | null
  durationMs: number | null
  path: string | null
}

export interface CompletedCommandActivitySummary {
  kind: 'exploration' | 'commands'
  label: string
}

export interface CompletedCommandActivityBatch {
  firstItemId: string
  itemIds: string[]
  summary: CompletedCommandActivitySummary
}

export interface CompletedActivitySummary {
  kind: 'edits' | 'exploration' | 'commands' | 'tools' | 'webSearch'
  label: string
}

export interface CompletedActivityBatch {
  firstItemId: string
  itemIds: string[]
  items: ThreadItem[]
  summary: CompletedActivitySummary
}

export type ConversationActivityUnit =
  | { kind: 'group'; key: string; items: ThreadItem[]; summary: CompletedActivitySummary }
  | { kind: 'standalone'; key: string; item: ThreadItem }

export interface ConversationActivityUnitOptions {
  /** Keep source groups intact even when a completed group contains one item. */
  preserveSingleItemGroups?: boolean
  /** The shipped terminal view attaches its completed header to the final group. */
  completedHeader?: boolean
}

const shellLauncherPattern = /^(?:.*[/\\])?(?:bash|cmd(?:\.exe)?|fish|powershell(?:\.exe)?|pwsh(?:\.exe)?|sh|zsh)(?:\s|$)/i

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\/+/, '').replaceAll('\\', '/')
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').at(-1) || path
}

function actionDisplayLabel(action: CommandAction): string | null {
  const label = (action as unknown as Record<string, unknown>).displayLabel
  return typeof label === 'string' ? label : null
}

function meaningfulActions(item: CommandItem): CommandAction[] {
  return normalizeCommandActions(item.commandActions).filter(
    (action) => !shellLauncherPattern.test(action.command.trim())
  )
}

function isInterrupted(item: CommandItem): boolean {
  return (item as unknown as Record<string, unknown>).executionStatus === 'interrupted'
}

function unwrapCompletedSingleton(item: ThreadItem): boolean {
  if (isConversationActivityInProgress(item)) return false
  if (item.type !== 'fileChange') return true
  const visualizationActivities = (item as unknown as Record<string, unknown>).visualizationActivities
  return (item.changes?.length || 0) === 1 &&
    (!Array.isArray(visualizationActivities) || visualizationActivities.length === 0)
}

export function commandElapsedLabel(durationMs: unknown): string | null {
  const duration = commandDurationMs(durationMs)
  if (duration === null) return null
  const seconds = Math.floor(duration / 1000)
  if (seconds < 1) return null
  const unit = (value: number, name: 'day' | 'hour' | 'minute' | 'second'): string =>
    new Intl.NumberFormat('en', { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value)
  if (seconds < 60) return unit(seconds, 'second')
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds / 3600) % 24
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60
  if (days > 0 || hours > 0) {
    return [days > 0 ? unit(days, 'day') : null, unit(hours, 'hour'), unit(minutes, 'minute'), unit(remainder, 'second')].filter(Boolean).join(' ')
  }
  return `${unit(minutes, 'minute')} ${unit(remainder, 'second')}`
}

function activeCopy(item: CommandItem, action: CommandAction | null): CommandActivityCopy {
  const active = item.status === 'inProgress'
  if (action?.type === 'read') {
    const target = actionDisplayLabel(action) ?? basename(normalizePath(action.path || action.name))
    return { kind: 'read', action: active ? '正在读取' : '已读取', detail: target || null }
  }
  if (action?.type === 'search') {
    const path = nonEmpty(action.path)
    return {
      kind: 'search',
      action: active ? '正在搜索' : '已搜索',
      detail: path ? `${normalizePath(path)} 文件夹中的文件` : nonEmpty(action.query) || '文件'
    }
  }
  if (action?.type === 'listFiles') {
    const path = nonEmpty(action.path)
    return {
      kind: 'listFiles',
      action: active ? '正在列出' : '已列出',
      detail: path ? `${normalizePath(path)} 文件夹中的文件` : '文件'
    }
  }
  const detail = nonEmpty(action?.command) ||
    (nonEmpty(item.command) && !shellLauncherPattern.test(item.command.trim()) ? item.command.trim() : null)
  const verb = isInterrupted(item) ? '已停止' : active ? '正在运行' : '已运行'
  return { kind: 'command', action: detail ? verb : `${verb}命令`, detail }
}

export function commandActivityCopy(item: CommandItem): CommandActivityCopy {
  const actions = meaningfulActions(item)
  return activeCopy(item, actions.at(-1) || null)
}

function rowCopy(item: CommandItem, action: CommandAction): CommandActivityCopy {
  const active = item.status === 'inProgress'
  if (action.type === 'read') {
    return {
      kind: 'read',
      action: active ? '正在读取' : '已读取',
      detail: actionDisplayLabel(action) ?? (normalizePath(action.name) || null)
    }
  }
  if (action.type === 'search') {
    const path = nonEmpty(action.path)
    const query = nonEmpty(action.query)
    if (path && query) {
      return { kind: 'search', action: active ? '正在' : '已在', detail: `${path} 中搜索“${query}”` }
    }
    if (query) {
      return { kind: 'search', action: active ? '正在搜索' : '已对', detail: `“${query}”${active ? '' : '进行搜索'}` }
    }
    return { kind: 'search', action: active ? '正在搜索' : '已搜索', detail: '文件' }
  }
  if (action.type === 'listFiles') {
    const path = nonEmpty(action.path)
    return {
      kind: 'listFiles',
      action: active ? '正在列出' : path ? '已列出' : '已列出的',
      detail: path ? `${path} 中的文件` : '文件'
    }
  }
  const command = nonEmpty(action.command)
  if (item.status === 'declined') {
    return { kind: 'command', action: command ? '命令被自动审核拒绝：' : '命令被自动审核拒绝', detail: command }
  }
  const elapsed = commandElapsedLabel(item.durationMs)
  if (active) return { kind: 'command', action: elapsed ? `命令已运行 ${elapsed}` : '正在运行命令', detail: null }
  if (elapsed) {
    if (isInterrupted(item)) return { kind: 'command', action: `运行 ${elapsed} 后停止${command ? '' : '命令'}`, detail: command }
    return { kind: 'command', action: command ? `已在 ${elapsed} 内运行` : `命令已在 ${elapsed} 内运行完成`, detail: command }
  }
  const verb = isInterrupted(item) ? '已停止' : '已运行'
  return { kind: 'command', action: command ? verb : `${verb}命令`, detail: command }
}

export function commandActivityRows(item: CommandItem): CommandActivityRow[] {
  const actions = meaningfulActions(item)
  if (actions.length === 0 && normalizeCommandActions(item.commandActions).length === 0) {
    const command = nonEmpty(item.command)
    if (!command || !shellLauncherPattern.test(command)) {
      actions.push({ type: 'unknown', command: item.command || '' })
    }
  }
  return actions.map((action) => ({
    ...rowCopy(item, action),
    command: typeof action.command === 'string' ? action.command : null,
    durationMs: commandDurationMs(item.durationMs),
    path: action.type === 'unknown' ? null : nonEmpty(action.path)
  }))
}

function summaryKinds(item: CommandItem): Set<'exploration' | 'commands'> {
  const actions = meaningfulActions(item)
  if (actions.length === 0) return new Set(['commands'])
  return new Set(actions.map((action) => action.type === 'unknown' ? 'commands' : 'exploration'))
}

function sourceDisplayName(value: string): string {
  const normalized = value
    .replace(/^connector[_-]/iu, '')
    .replace(/[_-]mcp[_-]server$/iu, '')
    .replace(/[_-]+/gu, ' ')
    .trim()
  return normalized.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) || value
}

function toolSource(item: ThreadItem): { name: string; integration: boolean } | null {
  if (item.type !== 'mcpToolCall') return null
  const context = toolRecord(item.appContext)
  const matchingApp = toolRecord(item.matchingApp)
  const source = toolRecord(item.source)
  const appName = nonEmpty(context?.appName) || nonEmpty(matchingApp?.name) || nonEmpty(matchingApp?.title)
  if (appName) return { name: appName, integration: true }
  if (source?.kind === 'browserUse') {
    return { name: source.backend === 'chrome' ? 'Chrome' : '浏览器', integration: false }
  }
  const sourceName = nonEmpty(source?.name) || nonEmpty(source?.displayName) || nonEmpty(source?.label)
  if (sourceName) return { name: sourceName, integration: false }
  const connectorId = nonEmpty(context?.connectorId)
  return connectorId ? { name: sourceDisplayName(connectorId), integration: true } : null
}

function isNativeToolSummary(item: ThreadItem): boolean {
  if (item.type === 'dynamicToolCall') return true
  return item.type === 'mcpToolCall' && (item.server === 'codex_app' || item.namespace === 'codex_app')
}

function formatSourceList(names: string[]): string {
  return new Intl.ListFormat('zh-CN', { type: 'conjunction' }).format(names)
}

export function completedActivitySummary(items: ThreadItem[]): CompletedActivitySummary | null {
  const changedPaths = { add: new Set<string>(), update: new Set<string>(), delete: new Set<string>() }
  const sources = new Map<string, { name: string; integration: boolean }>()
  const nativeToolLabels = new Set<string>()
  let unnamedToolCalls = 0
  let exploration = false
  let commands = false
  let webSearches = 0
  for (const item of items) {
    if (isConversationActivityInProgress(item)) continue
    if (item.type === 'commandExecution') {
      const kinds = summaryKinds(item)
      exploration ||= kinds.has('exploration')
      commands ||= kinds.has('commands')
    } else if (item.type === 'fileChange') {
      for (const change of Array.isArray(item.changes) ? item.changes : []) {
        if (!change || typeof change !== 'object') continue
        const path = nonEmpty(change.path)
        const kind = change.kind?.type
        if (path && (kind === 'add' || kind === 'update' || kind === 'delete')) changedPaths[kind].add(path)
      }
    } else if (item.type === 'webSearch') {
      webSearches += 1
    } else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
      if (isNativeToolSummary(item)) {
        nativeToolLabels.add(toolActivityLabel(item))
        continue
      }
      const source = toolSource(item)
      if (source) sources.set(source.name, source)
      else unnamedToolCalls += 1
    }
  }
  const editedCount = changedPaths.add.size + changedPaths.update.size + changedPaths.delete.size
  const parts: Array<{ kind: CompletedActivitySummary['kind']; label: string }> = []
  if (sources.size > 0) {
    const values = [...sources.values()]
    const suffix = values.every(({ integration }) => integration) ? ' 集成' : ''
    parts.push({ kind: 'tools', label: `已使用 ${formatSourceList(values.map(({ name }) => name))}${suffix}` })
  }
  if (unnamedToolCalls > 0) parts.push({
    kind: 'tools',
    label: unnamedToolCalls === 1 ? '调用了一个工具' : '调用了工具'
  })
  if (editedCount > 0) parts.push({
    kind: 'edits',
    label: editedCount === 1 ? '编辑了一个文件' : parts.length === 0 ? '编辑了文件' : '编辑了多个文件'
  })
  if (exploration) parts.push({ kind: 'exploration', label: parts.length === 0 ? '已读取文件' : '读取文件' })
  if (commands) parts.push({ kind: 'commands', label: '运行了命令' })
  if (webSearches > 0) {
    const titledSearch = items.length === 1 && items[0]?.type === 'webSearch' ? nonEmpty(items[0].title) : null
    parts.push({ kind: 'webSearch', label: titledSearch || '已搜索网页' })
  }
  for (const label of nativeToolLabels) parts.push({ kind: 'tools', label })
  if (parts.length === 0) return null
  return {
    kind: parts[0].kind,
    label: new Intl.ListFormat('zh-CN', { type: 'unit' }).format(parts.map((part) => part.label))
  }
}

export function completedCommandActivitySummary(items: ThreadItem[]): CompletedCommandActivitySummary | null {
  return completedActivitySummary(items.filter((item) => item.type === 'commandExecution')) as CompletedCommandActivitySummary | null
}

export function completedActivityBatches(items: ThreadItem[]): CompletedActivityBatch[] {
  const batches: CompletedActivityBatch[] = []
  let batch: ThreadItem[] = []
  const flush = (): void => {
    if (batch.length === 0) return
    const summary = completedActivitySummary(batch)
    if (summary) batches.push({ firstItemId: batch[0].id, itemIds: batch.map((item) => item.id), items: batch, summary })
    batch = []
  }
  for (const item of conversationActivityItems(items)) {
    if (conversationActivityGrouping(item) === 'groupable' && !isConversationActivityInProgress(item)) batch.push(item)
    else flush()
  }
  flush()
  return batches
}

/**
 * Mirrors the shipped `group`/`standalone` projection while keeping the latest
 * live tool row visible. Hidden reasoning does not split a group; commentary,
 * MCP Apps and other persistent rows do.
 */
export function conversationActivityUnits(
  items: ThreadItem[],
  live = false,
  {
    preserveSingleItemGroups = false,
    completedHeader = false
  }: ConversationActivityUnitOptions = {}
): ConversationActivityUnit[] {
  const visibleItems = conversationActivityItems(items)
  const latestActiveGroupableId = live ? [...visibleItems].reverse().find((item) =>
    conversationActivityGrouping(item) === 'groupable' && isConversationActivityInProgress(item, true)
  )?.id : null
  const units: ConversationActivityUnit[] = []
  let group: ThreadItem[] = []
  const flush = (): void => {
    if (group.length === 0) return
    const summary = completedActivitySummary(group)
    if (summary) units.push({ kind: 'group', key: `agent-activity-group:${group[0].id}`, items: group, summary })
    else units.push(...group.map((item) => ({ kind: 'standalone' as const, key: `agent-activity-standalone:${item.id}`, item })))
    group = []
  }
  for (const item of visibleItems) {
    const grouping = conversationActivityGrouping(item)
    if (grouping === 'groupable' && !isConversationActivityInProgress(item, live)) {
      group.push(item)
      continue
    }
    flush()
    if (grouping === 'groupable' && live && item.id !== latestActiveGroupableId) continue
    units.push({ kind: 'standalone', key: `agent-activity-standalone:${item.id}`, item })
  }
  flush()
  return units.map((unit, index) => {
    if (
      unit.kind !== 'group' ||
      unit.items.length !== 1 ||
      preserveSingleItemGroups ||
      (completedHeader && index === units.length - 1) ||
      !unwrapCompletedSingleton(unit.items[0]!)
    ) return unit
    const item = unit.items[0]!
    return {
      kind: 'standalone',
      key: `agent-activity-standalone:${item.id}`,
      item
    }
  })
}

export function completedCommandActivityBatches(items: ThreadItem[]): CompletedCommandActivityBatch[] {
  const batches: CompletedCommandActivityBatch[] = []
  let batch: CommandItem[] = []
  const flush = (): void => {
    if (batch.length === 0) return
    const summary = completedCommandActivitySummary(batch)
    if (summary) batches.push({ firstItemId: batch[0].id, itemIds: batch.map((item) => item.id), summary })
    batch = []
  }
  for (const item of conversationActivityItems(items)) {
    if (item.type === 'commandExecution' && item.status !== 'inProgress') batch.push(item)
    else flush()
  }
  flush()
  return batches
}

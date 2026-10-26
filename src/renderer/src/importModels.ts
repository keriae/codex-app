import type { ExternalAgentConnector, ExternalAgentImportHistory, ExternalAgentImportResult, ExternalAgentMigrationItem, ExternalAgentMigrationItemType, ExternalAgentProviderId } from '../../shared/api'
import messages from './importMessages.json'

export const IMPORT_PROVIDERS: ExternalAgentProviderId[] = ['claude-code', 'claude-cowork', 'cursor']
export const IMPORT_CATEGORIES: ExternalAgentMigrationItemType[] = ['CONFIG', 'AGENTS_MD', 'SKILLS', 'COMMANDS', 'SUBAGENTS', 'HOOKS', 'PLUGINS', 'MCP_SERVER_CONFIG', 'MEMORY', 'SESSIONS']
export const IMPORT_PROVIDER_LABELS: Record<ExternalAgentProviderId, string> = { 'claude-code': 'Claude Code', 'claude-cowork': 'Claude Cowork', cursor: 'Cursor' }
const categoryKeys: Record<ExternalAgentMigrationItemType, string> = { CONFIG: 'config', AGENTS_MD: 'agentsMd', SKILLS: 'skills', COMMANDS: 'commands', SUBAGENTS: 'subagents', HOOKS: 'hooks', PLUGINS: 'plugins', MCP_SERVER_CONFIG: 'mcpServerConfig', MEMORY: 'memory', SESSIONS: 'sessions' }

/** The original zh-CN messages use ICU plurals, including nested arguments. */
export function importMessage(id: keyof typeof messages, values: Record<string, string | number> = {}): string {
  const format = (source: string, pluralValue?: number): string => {
    let result = ''
    for (let index = 0; index < source.length;) {
      if (source[index] !== '{') { result += source[index] === '#' && pluralValue !== undefined ? pluralValue : source[index]; index += 1; continue }
      let end = index + 1; let depth = 1
      for (; end < source.length && depth; end++) { if (source[end] === '{') depth++; else if (source[end] === '}') depth-- }
      const argument = source.slice(index + 1, end - 1)
      const plural = /^(\w+),\s*plural,\s*/.exec(argument)
      if (!plural) result += String(values[argument] ?? `{${argument}}`)
      else {
        const count = Number(values[plural[1]] ?? 0); const branches = argument.slice(plural[0].length)
        let cursor = 0; const options: Record<string, string> = {}
        while (cursor < branches.length) {
          const match = /^\s*(=\d+|\w+)\s*\{/.exec(branches.slice(cursor)); if (!match) break
          const start = cursor + match[0].length; let stop = start; let nested = 1
          for (; stop < branches.length && nested; stop++) { if (branches[stop] === '{') nested++; else if (branches[stop] === '}') nested-- }
          options[match[1]] = branches.slice(start, stop - 1); cursor = stop
        }
        result += format(options[`=${count}`] ?? options.other ?? options.one ?? '', count)
      }
      index = end
    }
    return result
  }
  return format(messages[id])
}

export function importCategoryLabel(category: ExternalAgentMigrationItemType): string {
  return importMessage(`externalAgentConfig.itemType.${categoryKeys[category]}` as keyof typeof messages)
}

export function importItemKey(item: ExternalAgentMigrationItem): string {
  return `${item.itemType}:${item.providerId}:${item.cwd ?? 'home'}:${item.description}`
}
export function importProjectItemKey(item: ExternalAgentMigrationItem): string { return `projects:${importItemKey(item)}` }

export interface ImportChoice {
  key: string
  kind: 'setup' | 'projects' | 'chats'
  label: string
  description: string
  items: ExternalAgentMigrationItem[]
  count: number
  providerId?: ExternalAgentProviderId
}
export interface ImportReviewModel {
  choices: ImportChoice[]
  projectItems: ExternalAgentMigrationItem[]
  projectRoots: string[]
  sessionItems: ExternalAgentMigrationItem[]
}
export type ImportSelection = Record<string, boolean>

export function importProjectRoots(items: ExternalAgentMigrationItem[]): string[] {
  return [...new Set(items.flatMap((item) => [
    ...(item.cwd ? [item.cwd] : []),
    ...(item.details?.sessions.filter((session) => session.workspaceKind !== 'projectless' && session.cwd).map((session) => session.cwd) ?? [])
  ]))].sort((a, b) => a.localeCompare(b))
}

/** Reconstruct Irs/Rrs: home setup, project-scoped setup and home chat sessions. */
export function createImportReview(items: ExternalAgentMigrationItem[], providers: ExternalAgentProviderId[]): ImportReviewModel {
  const filtered = items.filter((item) => providers.includes(item.providerId))
  const home = filtered.filter((item) => !item.cwd)
  const projectItems = filtered.filter((item) => item.cwd && item.itemType !== 'SESSIONS').sort((a, b) => IMPORT_CATEGORIES.indexOf(a.itemType) - IMPORT_CATEGORIES.indexOf(b.itemType))
  const sessionItems = home.filter((item) => item.itemType === 'SESSIONS')
  const groups = new Map<string, ExternalAgentMigrationItem[]>()
  for (const item of home.filter((entry) => entry.itemType !== 'SESSIONS').sort((a, b) => IMPORT_CATEGORIES.indexOf(a.itemType) - IMPORT_CATEGORIES.indexOf(b.itemType))) {
    const key = item.providerId === 'claude-cowork' ? `${item.itemType}:${item.providerId}:home` : importItemKey(item)
    groups.set(key, [...groups.get(key) ?? [], item])
  }
  const choices: ImportChoice[] = [...groups].map(([key, grouped]) => ({ key, kind: 'setup', label: importCategoryLabel(grouped[0].itemType), description: grouped[0].description, items: grouped, count: grouped.length, providerId: grouped[0].providerId }))
  const projectRoots = importProjectRoots([...projectItems, ...sessionItems])
  if (projectItems.length || projectRoots.length) choices.push({ key: 'projects', kind: 'projects', label: importMessage('electron.onboarding.welcomeV2.externalAgentImport.customize.projects', { count: projectRoots.length }), description: importMessage('electron.onboarding.welcomeV2.externalAgentImport.customize.projectsDescription'), items: projectItems, count: projectRoots.length })
  const chatCount = sessionItems.reduce((sum, item) => sum + (item.details?.sessions.length ?? 0), 0)
  if (chatCount) choices.push({ key: 'chats', kind: 'chats', label: importMessage('electron.onboarding.welcomeV2.externalAgentImport.customize.chats', { count: chatCount }), description: importMessage('electron.onboarding.welcomeV2.externalAgentImport.customize.chatsDescription'), items: sessionItems, count: chatCount })
  return { choices, projectItems, projectRoots, sessionItems }
}

export function initialImportSelection(model: ImportReviewModel): ImportSelection { return Object.fromEntries(model.choices.map((choice) => [choice.key, true])) }

/** zrs preserves original items; deselecting Projects never discards selected chats. */
export function selectedImportItems(model: ImportReviewModel, selection: ImportSelection): ExternalAgentMigrationItem[] {
  const hasProjectSelection = model.projectItems.some((item) => Object.hasOwn(selection, importProjectItemKey(item)))
  return model.choices.flatMap((choice) => {
    if (!selection[choice.key]) return []
    return choice.kind === 'projects' && hasProjectSelection ? choice.items.filter((item) => selection[importProjectItemKey(item)]) : choice.items
  })
}

export function importItemDetailNames(item: ExternalAgentMigrationItem): string[] {
  const details = item.details
  if (!details) return []
  if (item.itemType === 'PLUGINS') return [...new Set(details.plugins.flatMap((entry) => entry.pluginNames))]
  if (item.itemType === 'SESSIONS') return details.sessions.map((entry) => entry.title || entry.path)
  if (item.itemType === 'MEMORY') return details.memory
  const field = ({ SKILLS: 'skills', COMMANDS: 'commands', SUBAGENTS: 'subagents', HOOKS: 'hooks', MCP_SERVER_CONFIG: 'mcpServers' } as const)[item.itemType as 'SKILLS' | 'COMMANDS' | 'SUBAGENTS' | 'HOOKS' | 'MCP_SERVER_CONFIG']
  return field ? details[field].map((entry) => entry.name) : []
}

export function importResultCounts(result: Pick<ExternalAgentImportResult, 'itemTypeResults'> | Pick<ExternalAgentImportHistory, 'successes' | 'failures'>): { imported: number; failed: number } {
  if ('itemTypeResults' in result) return result.itemTypeResults.reduce((count, group) => ({ imported: count.imported + group.successes.length, failed: count.failed + group.failures.length }), { imported: 0, failed: 0 })
  return { imported: result.successes.length, failed: result.failures.length }
}

export function importResultOutcome(result: ExternalAgentImportResult): 'success' | 'partial' | 'failed' | 'stopped' | 'empty' {
  const count = importResultCounts(result)
  if (result.canceled) return 'stopped'
  if (count.failed) return count.imported ? 'partial' : 'failed'
  return count.imported || result.importedProjectIds.length || result.importedSessionThreadIds.length ? 'success' : 'empty'
}

export function safeImportExternalUrl(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}

export interface ImportedAppLink { id: string; name: string; connectionUrl: string | null; connected: boolean }
function importRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
export async function loadImportedAppLinks(connectors: ExternalAgentConnector[], invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>): Promise<ImportedAppLink[]> {
  const catalog: Record<string, unknown>[] = []
  const seen = new Set<string>(); let cursor: string | null = null
  const installedPromise = invoke('app/installed', { forceRefresh: true, threadId: null })
  // Retain a rejection handler while pagination is pending.
  const installedRead = installedPromise.then((value) => ({ value }), (error: unknown) => ({ error }))
  for (let page = 0; page < 25; page++) {
    const response = await invoke('app/list', { cursor, forceRefetch: true, limit: 100, threadId: null })
    if (!importRecord(response) || !Array.isArray(response.data) || response.data.length > 100) throw new Error('Invalid imported app catalog response')
    catalog.push(...response.data.filter(importRecord))
    if (response.nextCursor == null) { cursor = null; break }
    if (typeof response.nextCursor !== 'string' || !response.nextCursor || seen.has(response.nextCursor)) throw new Error('Invalid imported app pagination cursor')
    cursor = response.nextCursor; seen.add(cursor)
  }
  if (cursor) throw new Error('Imported app catalog exceeded its page limit')
  const installedResult = await installedRead
  if ('error' in installedResult) throw installedResult.error
  const installed = importRecord(installedResult.value) && Array.isArray(installedResult.value.apps) ? installedResult.value.apps.filter(importRecord) : []
  const matched = new Map<string, ImportedAppLink>()
  for (const connector of connectors) {
    const app = catalog.find((entry) => connector.codexAppId ? entry.id === connector.codexAppId : typeof entry.name === 'string' && entry.name.trim().toLocaleLowerCase() === connector.name.trim().toLocaleLowerCase())
    if (!app || typeof app.id !== 'string' || typeof app.name !== 'string') continue
    const runtime = installed.find((entry) => entry.id === app.id)
    matched.set(app.id, { id: app.id, name: app.name, connectionUrl: typeof app.installUrl === 'string' && app.isAccessible !== false ? safeImportExternalUrl(app.installUrl) : null, connected: runtime?.enabled === true && runtime?.callable === true })
  }
  return [...matched.values()]
}

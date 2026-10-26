export type SkillScope = 'user' | 'repo' | 'system' | 'admin'

export interface SkillDependencySummary {
  type: string
  value: string
}

export interface SkillSummary {
  id: string
  name: string
  scope: SkillScope
  enabled: boolean
  dependencies: SkillDependencySummary[]
}

export interface SkillErrorSummary {
  message: string
}

export interface SkillInventory {
  skills: SkillSummary[]
  errors: SkillErrorSummary[]
}

export type McpAuthStatus =
  | 'unknown'
  | 'unsupported'
  | 'notLoggedIn'
  | 'bearerToken'
  | 'oAuth'

export type McpRuntimeStatus =
  | 'notStarted'
  | 'starting'
  | 'connected'
  | 'authenticationRequired'
  | 'failed'
  | 'cancelled'
  | 'disabled'
  | 'unavailable'

export interface McpServerSummary {
  name: string
  displayName: string
  version: string | null
  authStatus: McpAuthStatus
  runtimeStatus: McpRuntimeStatus
  toolNames: string[]
  resourceNames: string[]
  resourceTemplateNames: string[]
  toolsError: string | null
}

export interface McpInventoryPage {
  servers: McpServerSummary[]
  nextCursor: string | null
}

export const APP_CATALOG_PAGE_LIMIT = 100
export const MAX_APP_CATALOG_PAGES = 25

export interface AppCatalogEntry {
  id: string
  name: string
  developer: string | null
  version: string | null
  category: string | null
  source: string | null
  accessible: boolean
  configEnabled: boolean
}

export interface InstalledAppSummary {
  id: string
  runtimeName: string | null
  enabled: boolean
  callable: boolean
}

export interface AppSummary extends AppCatalogEntry {
  installed: boolean | null
  runtimeEnabled: boolean | null
  callable: boolean | null
}

export interface AppCatalogPage {
  apps: AppCatalogEntry[]
  nextCursor: string | null
}

export type PluginSourceKind = 'local' | 'git' | 'npm' | 'remote' | 'unknown'
export type PluginAvailability = 'AVAILABLE' | 'DISABLED_BY_ADMIN' | 'unknown'
export type PluginInstallPolicy = 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'unknown'

export interface PluginSummary {
  id: string
  name: string
  developer: string | null
  category: string | null
  version: string | null
  localVersion: string | null
  source: PluginSourceKind
  installed: boolean
  enabled: boolean
  featured: boolean
  availability: PluginAvailability
  disabledReason: string | null
  installPolicy: PluginInstallPolicy
}

export interface PluginInventory {
  plugins: PluginSummary[]
  marketplaceCount: number
  loadErrorCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const MAX_DIAGNOSTIC_SOURCE_LENGTH = 4_096
const MAX_INTEGRATION_NAME_LENGTH = 256
const MAX_INTEGRATION_VALUE_LENGTH = 1_024
const MAX_NORMALIZED_TEXT_LENGTH = 512_000

interface NormalizationBudget {
  method: string
  textLength: number
}

function consumeTextBudget(text: string, budget?: NormalizationBudget): string {
  if (!budget) return text
  budget.textLength += text.length
  if (budget.textLength > MAX_NORMALIZED_TEXT_LENGTH) {
    throw new Error(`The app-server returned too much ${budget.method} text.`)
  }
  return text
}

function safeTruncationEnd(value: string, requestedEnd: number): number {
  if (requestedEnd <= 0 || requestedEnd >= value.length) return requestedEnd
  const previousCodeUnit = value.charCodeAt(requestedEnd - 1)
  return previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff
    ? requestedEnd - 1
    : requestedEnd
}

/**
 * Integration labels are presentation-only. Keep a bounded prefix instead of
 * retaining an arbitrarily large app-server string in React state.
 */
function boundedDisplayText(
  value: unknown,
  maxLength = MAX_INTEGRATION_NAME_LENGTH,
  budget?: NormalizationBudget
): string | null {
  if (typeof value !== 'string') return null
  const truncated = value.length > maxLength
  const requestedEnd = truncated ? maxLength - 1 : value.length
  const end = safeTruncationEnd(value, requestedEnd)
  const text = value.slice(0, end).trim()
  if (!text) return null
  return consumeTextBudget(truncated ? `${text}…` : text, budget)
}

/** Identifiers must remain exact; overlong values reject the response. */
function boundedIdentifier(
  value: unknown,
  maxLength: number,
  label: string,
  budget: NormalizationBudget
): string | null {
  if (typeof value !== 'string') return null
  if (value.length > maxLength) {
    throw new Error(`The app-server returned an overlong ${label}.`)
  }
  const text = value.trim()
  return text ? consumeTextBudget(text, budget) : null
}

/**
 * App-server diagnostics can repeat the absolute path already present in their
 * structured `path` field. The settings surface deliberately does not retain
 * either that path or skill descriptions/content in its presentation model.
 */
export function sanitizeIntegrationDiagnostic(message: unknown, path?: unknown): string {
  const raw = boundedDisplayText(message, MAX_DIAGNOSTIC_SOURCE_LENGTH) ||
    'Integration metadata could not be loaded.'
  const structuredPath = boundedDisplayText(path, MAX_DIAGNOSTIC_SOURCE_LENGTH)
  const withoutStructuredPath = structuredPath
    ? raw.replaceAll(structuredPath, '<path>')
    : raw
  const withoutFileUrls = withoutStructuredPath.replace(/file:\/\/\/[^\s)'"\]]+/giu, '<path>')
  const withoutUris = withoutFileUrls.replace(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"\]]+/giu,
    '<uri>'
  )
  const withoutAbsolutePaths = withoutUris.replace(
    /(^|[\s('"`])\/(?:[^\s)'"`:]+\/)*[^\s)'"`:]+/gu,
    '$1<path>'
  )
  const withoutBearerTokens = withoutAbsolutePaths.replace(
    /\bBearer\s+[a-z0-9._~+\/-]+=*/giu,
    'Bearer <redacted>'
  )
  const withoutNamedTokens = withoutBearerTokens.replace(
    /\b((?:access[_-]?token|refresh[_-]?token|api[_-]?key|token)\s*[=:]\s*)[^\s,;)'"\]]+/giu,
    '$1<redacted>'
  )
  const compact = withoutNamedTokens.replace(/\s+/gu, ' ').trim()
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact
}

const MAX_SKILL_GROUPS = 64
const MAX_SKILLS_PER_GROUP = 1_000
const MAX_TOTAL_SKILLS = 1_000
const MAX_SKILL_ERRORS_PER_GROUP = 256
const MAX_TOTAL_SKILL_ERRORS = 256
const MAX_DEPENDENCIES_PER_SKILL = 128
const MAX_TOTAL_SKILL_DEPENDENCIES = 5_000

interface SkillNormalizationBudget extends NormalizationBudget {
  dependencyCount: number
}

function normalizeDependencies(
  value: unknown,
  budget: SkillNormalizationBudget
): SkillDependencySummary[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) return []
  if (value.tools.length > MAX_DEPENDENCIES_PER_SKILL) {
    throw new Error('The app-server returned too many dependencies for one skill.')
  }
  budget.dependencyCount += value.tools.length
  if (budget.dependencyCount > MAX_TOTAL_SKILL_DEPENDENCIES) {
    throw new Error('The app-server returned too many skill dependencies.')
  }

  const seen = new Set<string>()
  const dependencies: SkillDependencySummary[] = []
  for (const dependency of value.tools) {
    if (!isRecord(dependency)) continue
    const type = boundedDisplayText(dependency.type, MAX_INTEGRATION_NAME_LENGTH, budget)
    const dependencyValue = boundedDisplayText(
      dependency.value,
      MAX_INTEGRATION_VALUE_LENGTH,
      budget
    )
    if (!type || !dependencyValue) continue
    const key = `${type}\u0000${dependencyValue}`
    if (seen.has(key)) continue
    seen.add(key)
    dependencies.push({ type, value: dependencyValue })
  }
  return dependencies
}

const skillScopes = new Set<SkillScope>(['user', 'repo', 'system', 'admin'])
const scopeOrder: Record<SkillScope, number> = {
  repo: 0,
  user: 1,
  system: 2,
  admin: 3
}

export function normalizeSkillsListResponse(value: unknown): SkillInventory {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('The app-server returned an invalid skills/list response.')
  }
  if (value.data.length > MAX_SKILL_GROUPS) {
    throw new Error('The app-server returned too many skills/list groups.')
  }

  const skills: SkillSummary[] = []
  const errors: SkillErrorSummary[] = []
  const duplicateCounts = new Map<string, number>()
  const budget: SkillNormalizationBudget = {
    method: 'skills/list',
    textLength: 0,
    dependencyCount: 0
  }
  let rawSkillCount = 0
  let rawErrorCount = 0

  for (const entry of value.data) {
    if (!isRecord(entry)) continue

    if (Array.isArray(entry.errors)) {
      if (entry.errors.length > MAX_SKILL_ERRORS_PER_GROUP) {
        throw new Error('The app-server returned too many skill discovery errors in one group.')
      }
      rawErrorCount += entry.errors.length
      if (rawErrorCount > MAX_TOTAL_SKILL_ERRORS) {
        throw new Error('The app-server returned too many skill discovery errors.')
      }
      for (const error of entry.errors) {
        if (!isRecord(error)) continue
        errors.push({
          message: consumeTextBudget(
            sanitizeIntegrationDiagnostic(error.message, error.path),
            budget
          )
        })
      }
    }

    if (!Array.isArray(entry.skills)) continue
    if (entry.skills.length > MAX_SKILLS_PER_GROUP) {
      throw new Error('The app-server returned too many skills in one group.')
    }
    rawSkillCount += entry.skills.length
    if (rawSkillCount > MAX_TOTAL_SKILLS) {
      throw new Error('The app-server returned too many skills.')
    }
    for (const skill of entry.skills) {
      if (!isRecord(skill)) continue
      if (typeof skill.enabled !== 'boolean' || !skillScopes.has(skill.scope as SkillScope)) {
        continue
      }
      const name = boundedIdentifier(
        skill.name,
        MAX_INTEGRATION_NAME_LENGTH,
        'skill name',
        budget
      )
      if (!name) continue
      const scope = skill.scope as SkillScope
      const duplicateKey = `${scope}\u0000${name}`
      const duplicateIndex = duplicateCounts.get(duplicateKey) ?? 0
      duplicateCounts.set(duplicateKey, duplicateIndex + 1)
      skills.push({
        id: `${scope}:${name}:${duplicateIndex}`,
        name,
        scope,
        enabled: skill.enabled,
        dependencies: normalizeDependencies(skill.dependencies, budget)
      })
    }
  }

  skills.sort(
    (left, right) =>
      scopeOrder[left.scope] - scopeOrder[right.scope] ||
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
  return { skills, errors }
}

const authStatuses = new Set<McpAuthStatus>([
  'unknown',
  'unsupported',
  'notLoggedIn',
  'bearerToken',
  'oAuth'
])
const runtimeStatuses = new Set<Exclude<McpRuntimeStatus, 'unavailable'>>([
  'notStarted',
  'starting',
  'connected',
  'authenticationRequired',
  'failed',
  'cancelled',
  'disabled'
])

const MAX_MCP_SERVERS_PER_PAGE = 100
const MAX_MCP_COLLECTION_ITEMS_PER_SERVER = 512
const MAX_MCP_INVENTORY_ITEMS_PER_PAGE = 5_000
const MAX_MCP_CURSOR_LENGTH = 8_192
const MAX_MCP_MERGED_SERVERS = 1_000
const MAX_MCP_MERGED_INVENTORY_ITEMS = 20_000

interface McpNormalizationBudget extends NormalizationBudget {
  inventoryItemCount: number
}

function reserveMcpInventoryItems(count: number, budget: McpNormalizationBudget): void {
  if (count > MAX_MCP_COLLECTION_ITEMS_PER_SERVER) {
    throw new Error('The app-server returned too many MCP inventory items for one server.')
  }
  budget.inventoryItemCount += count
  if (budget.inventoryItemCount > MAX_MCP_INVENTORY_ITEMS_PER_PAGE) {
    throw new Error('The app-server returned too many MCP inventory items in one page.')
  }
}

function namesFromArray(value: unknown, budget: McpNormalizationBudget): string[] {
  if (!Array.isArray(value)) return []
  reserveMcpInventoryItems(value.length, budget)
  return value
    .map((entry) => isRecord(entry)
      ? boundedDisplayText(entry.title, MAX_INTEGRATION_NAME_LENGTH, budget) ||
        boundedDisplayText(entry.name, MAX_INTEGRATION_NAME_LENGTH, budget)
      : null)
    .filter((name): name is string => Boolean(name))
}

function toolNames(value: unknown, budget: McpNormalizationBudget): string[] {
  if (!isRecord(value)) return []
  const keys: string[] = []
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (keys.length >= MAX_MCP_COLLECTION_ITEMS_PER_SERVER) {
      throw new Error('The app-server returned too many MCP inventory items for one server.')
    }
    keys.push(key)
  }
  reserveMcpInventoryItems(keys.length, budget)
  const names: string[] = []
  for (const key of keys) {
    const tool = value[key]
    const name = isRecord(tool)
      ? boundedDisplayText(tool.title, MAX_INTEGRATION_NAME_LENGTH, budget) ||
        boundedDisplayText(tool.name, MAX_INTEGRATION_NAME_LENGTH, budget) ||
        boundedDisplayText(key, MAX_INTEGRATION_NAME_LENGTH, budget)
      : boundedDisplayText(key, MAX_INTEGRATION_NAME_LENGTH, budget)
    if (name) names.push(name)
  }
  return names.sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  )
}

function normalizeMcpServer(
  value: unknown,
  budget: McpNormalizationBudget
): McpServerSummary | null {
  if (!isRecord(value)) return null
  const name = boundedIdentifier(
    value.name,
    MAX_INTEGRATION_VALUE_LENGTH,
    'MCP server name',
    budget
  )
  if (!name) return null

  const serverInfo = isRecord(value.serverInfo) ? value.serverInfo : null
  const authStatus = authStatuses.has(value.authStatus as McpAuthStatus)
    ? (value.authStatus as McpAuthStatus)
    : 'unknown'
  const runtimeStatus = runtimeStatuses.has(value.runtimeStatus as Exclude<McpRuntimeStatus, 'unavailable'>)
    ? (value.runtimeStatus as Exclude<McpRuntimeStatus, 'unavailable'>)
    : 'unavailable'

  return {
    name,
    displayName: boundedDisplayText(serverInfo?.title, MAX_INTEGRATION_NAME_LENGTH, budget) || name,
    version: boundedDisplayText(serverInfo?.version, MAX_INTEGRATION_NAME_LENGTH, budget),
    authStatus,
    runtimeStatus,
    toolNames: toolNames(value.tools, budget),
    resourceNames: namesFromArray(value.resources, budget),
    resourceTemplateNames: namesFromArray(value.resourceTemplates, budget),
    toolsError: value.toolsError == null
      ? null
      : consumeTextBudget(sanitizeIntegrationDiagnostic(value.toolsError), budget)
  }
}

export function normalizeMcpServerStatusResponse(value: unknown): McpInventoryPage {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('The app-server returned an invalid mcpServerStatus/list response.')
  }
  if (value.data.length > MAX_MCP_SERVERS_PER_PAGE) {
    throw new Error('The app-server exceeded the requested MCP server page limit.')
  }

  const budget: McpNormalizationBudget = {
    method: 'mcpServerStatus/list',
    textLength: 0,
    inventoryItemCount: 0
  }
  const servers = value.data
    .map((server) => normalizeMcpServer(server, budget))
    .filter((server): server is McpServerSummary => Boolean(server))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }))
  const nextCursor = value.nextCursor == null
    ? null
    : boundedIdentifier(
        value.nextCursor,
        MAX_MCP_CURSOR_LENGTH,
        'MCP pagination cursor',
        budget
      )
  if (value.nextCursor != null && (!nextCursor || nextCursor.includes('\0'))) {
    throw new Error('The app-server returned an invalid MCP pagination cursor.')
  }
  return { servers, nextCursor }
}

export function mergeMcpServerPages(pages: McpServerSummary[][]): McpServerSummary[] {
  const byName = new Map<string, McpServerSummary>()
  for (const page of pages) {
    for (const server of page) {
      byName.set(server.name, server)
      if (byName.size > MAX_MCP_MERGED_SERVERS) {
        throw new Error('The app-server returned too many MCP servers across pages.')
      }
    }
  }
  let inventoryItemCount = 0
  for (const server of byName.values()) {
    inventoryItemCount +=
      server.toolNames.length +
      server.resourceNames.length +
      server.resourceTemplateNames.length
    if (inventoryItemCount > MAX_MCP_MERGED_INVENTORY_ITEMS) {
      throw new Error('The app-server returned too many MCP inventory items across pages.')
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
  )
}

const MAX_CATALOG_ID_LENGTH = 1_024
const MAX_CATALOG_LABEL_LENGTH = 256
const MAX_CATALOG_CURSOR_LENGTH = 8_192
const MAX_INSTALLED_APPS = 2_500
const MAX_PLUGIN_MARKETPLACES = 200
const MAX_PLUGINS_PER_MARKETPLACE = 1_000
const MAX_TOTAL_PLUGINS = 5_000
const MAX_PLUGIN_LOAD_ERRORS = 1_000
const MAX_FEATURED_PLUGIN_IDS = 5_000

function safeCatalogText(value: unknown, maxLength = MAX_CATALOG_LABEL_LENGTH): string | null {
  const text = nonEmptyString(value)
  if (
    !text ||
    text.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(text) ||
    text.startsWith('/') ||
    /^(?:file:|[a-z][a-z0-9+.-]*:)/iu.test(text) ||
    /(^|[\s('"`])\/(?:[^\s)'"`:]+\/)*[^\s)'"`:]+/u.test(text)
  ) {
    return null
  }
  return text
}

function safeCatalogId(value: unknown): string | null {
  return safeCatalogText(value, MAX_CATALOG_ID_LENGTH)
}

function optionalCatalogCursor(value: unknown, method: string): string | null {
  if (value == null) return null
  const cursor = nonEmptyString(value)
  if (!cursor || cursor.length > MAX_CATALOG_CURSOR_LENGTH || cursor.includes('\0')) {
    throw new Error(`The app-server returned an invalid ${method} pagination cursor.`)
  }
  return cursor
}

function firstSafeCatalogText(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const item of value) {
    const text = safeCatalogText(item)
    if (text) return text
  }
  return null
}

function normalizeAppCatalogEntry(value: unknown): AppCatalogEntry | null {
  if (!isRecord(value)) return null
  const id = safeCatalogId(value.id)
  const name = safeCatalogText(value.name)
  if (!id || !name) return null

  const metadata = isRecord(value.appMetadata) ? value.appMetadata : null
  const branding = isRecord(value.branding) ? value.branding : null
  return {
    id,
    name,
    developer: safeCatalogText(metadata?.developer) || safeCatalogText(branding?.developer),
    version: safeCatalogText(metadata?.version),
    category: safeCatalogText(branding?.category) || firstSafeCatalogText(metadata?.categories),
    source: safeCatalogText(value.distributionChannel),
    accessible: typeof value.isAccessible === 'boolean' ? value.isAccessible : false,
    configEnabled: typeof value.isEnabled === 'boolean' ? value.isEnabled : true
  }
}

export function normalizeAppsListResponse(value: unknown): AppCatalogPage {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('The app-server returned an invalid app/list response.')
  }
  if (value.data.length > APP_CATALOG_PAGE_LIMIT) {
    throw new Error('The app-server exceeded the requested app/list page limit.')
  }

  return {
    apps: value.data
      .map(normalizeAppCatalogEntry)
      .filter((app): app is AppCatalogEntry => Boolean(app)),
    nextCursor: optionalCatalogCursor(value.nextCursor, 'app/list')
  }
}

export function mergeAppCatalogPages(pages: AppCatalogEntry[][]): AppCatalogEntry[] {
  const byId = new Map<string, AppCatalogEntry>()
  for (const page of pages) {
    for (const app of page) byId.set(app.id, app)
  }
  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
}

export async function collectAppCatalog(
  fetchPage: (cursor: string | null) => Promise<unknown>,
  maxPages = MAX_APP_CATALOG_PAGES
): Promise<AppCatalogEntry[]> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_APP_CATALOG_PAGES) {
    throw new Error('The app catalog pagination limit is invalid.')
  }

  const pages: AppCatalogEntry[][] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = normalizeAppsListResponse(await fetchPage(cursor))
    pages.push(page.apps)
    if (!page.nextCursor) return mergeAppCatalogPages(pages)
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('The app-server repeated an app/list pagination cursor.')
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new Error('The app catalog exceeded the safe pagination limit.')
}

export function normalizeAppsInstalledResponse(value: unknown): InstalledAppSummary[] {
  if (!isRecord(value) || !Array.isArray(value.apps)) {
    throw new Error('The app-server returned an invalid app/installed response.')
  }
  if (value.apps.length > MAX_INSTALLED_APPS) {
    throw new Error('The app-server returned too many installed apps.')
  }

  const byId = new Map<string, InstalledAppSummary>()
  for (const entry of value.apps) {
    if (!isRecord(entry)) continue
    const id = safeCatalogId(entry.id)
    if (!id || typeof entry.enabled !== 'boolean' || typeof entry.callable !== 'boolean') continue
    byId.set(id, {
      id,
      runtimeName: safeCatalogText(entry.runtimeName),
      enabled: entry.enabled,
      callable: entry.callable
    })
  }
  return [...byId.values()]
}

export function mergeAppsWithInstalledState(
  catalog: AppCatalogEntry[],
  installedSnapshot: InstalledAppSummary[] | null
): AppSummary[] {
  const installedById = installedSnapshot
    ? new Map(installedSnapshot.map((app) => [app.id, app]))
    : null
  const merged = new Map<string, AppSummary>()

  for (const app of catalog) {
    const installed = installedById?.get(app.id)
    merged.set(app.id, {
      ...app,
      installed: installedById ? Boolean(installed) : null,
      runtimeEnabled: installed?.enabled ?? null,
      callable: installed?.callable ?? null
    })
  }

  for (const installed of installedSnapshot ?? []) {
    if (merged.has(installed.id)) continue
    merged.set(installed.id, {
      id: installed.id,
      name: installed.runtimeName || 'Installed app',
      developer: null,
      version: null,
      category: null,
      source: 'Installed runtime',
      accessible: installed.callable,
      configEnabled: installed.enabled,
      installed: true,
      runtimeEnabled: installed.enabled,
      callable: installed.callable
    })
  }

  return [...merged.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
}

const pluginSourceKinds = new Set<Exclude<PluginSourceKind, 'unknown'>>([
  'local',
  'git',
  'npm',
  'remote'
])
const pluginAvailability = new Set<Exclude<PluginAvailability, 'unknown'>>([
  'AVAILABLE',
  'DISABLED_BY_ADMIN'
])
const pluginInstallPolicies = new Set<Exclude<PluginInstallPolicy, 'unknown'>>([
  'NOT_AVAILABLE',
  'AVAILABLE',
  'INSTALLED_BY_DEFAULT'
])
const pluginDisabledReasons = new Set([
  'disabled_by_admin',
  'plan_not_eligible',
  'required_app_unavailable',
  'unknown'
])

function normalizePluginSummary(value: unknown, featuredIds: Set<string>): PluginSummary | null {
  if (!isRecord(value)) return null
  const id = safeCatalogId(value.id)
  const fallbackName = safeCatalogText(value.name)
  const pluginInterface = isRecord(value.interface) ? value.interface : null
  const name = safeCatalogText(pluginInterface?.displayName) || fallbackName
  if (
    !id ||
    !name ||
    typeof value.installed !== 'boolean' ||
    typeof value.enabled !== 'boolean'
  ) {
    return null
  }

  const sourceRecord = isRecord(value.source) ? value.source : null
  const source = pluginSourceKinds.has(sourceRecord?.type as Exclude<PluginSourceKind, 'unknown'>)
    ? (sourceRecord?.type as Exclude<PluginSourceKind, 'unknown'>)
    : 'unknown'
  const availability = pluginAvailability.has(
    value.availability as Exclude<PluginAvailability, 'unknown'>
  )
    ? (value.availability as Exclude<PluginAvailability, 'unknown'>)
    : 'unknown'
  const installPolicy = pluginInstallPolicies.has(
    value.installPolicy as Exclude<PluginInstallPolicy, 'unknown'>
  )
    ? (value.installPolicy as Exclude<PluginInstallPolicy, 'unknown'>)
    : 'unknown'
  const disabledReason = pluginDisabledReasons.has(value.disabledReason as string)
    ? (value.disabledReason as string)
    : null

  return {
    id,
    name,
    developer: safeCatalogText(pluginInterface?.developerName),
    category: safeCatalogText(pluginInterface?.category),
    version: safeCatalogText(value.version),
    localVersion: safeCatalogText(value.localVersion),
    source,
    installed: value.installed,
    enabled: value.enabled,
    featured: featuredIds.has(id),
    availability,
    disabledReason,
    installPolicy
  }
}

export function normalizePluginListResponse(value: unknown): PluginInventory {
  if (!isRecord(value) || !Array.isArray(value.marketplaces)) {
    throw new Error('The app-server returned an invalid plugin/list response.')
  }
  if (value.marketplaces.length > MAX_PLUGIN_MARKETPLACES) {
    throw new Error('The app-server returned too many plugin marketplaces.')
  }
  if (
    value.marketplaceLoadErrors !== undefined &&
    (!Array.isArray(value.marketplaceLoadErrors) ||
      value.marketplaceLoadErrors.length > MAX_PLUGIN_LOAD_ERRORS)
  ) {
    throw new Error('The app-server returned invalid plugin marketplace diagnostics.')
  }
  if (
    value.featuredPluginIds !== undefined &&
    (!Array.isArray(value.featuredPluginIds) ||
      value.featuredPluginIds.length > MAX_FEATURED_PLUGIN_IDS)
  ) {
    throw new Error('The app-server returned invalid featured plugin metadata.')
  }

  const featuredIds = new Set<string>()
  if (Array.isArray(value.featuredPluginIds)) {
    for (const idValue of value.featuredPluginIds) {
      const id = safeCatalogId(idValue)
      if (id) featuredIds.add(id)
    }
  }

  const byId = new Map<string, PluginSummary>()
  let marketplaceCount = 0
  let totalPluginCount = 0
  for (const marketplace of value.marketplaces) {
    if (!isRecord(marketplace) || !Array.isArray(marketplace.plugins)) continue
    if (marketplace.plugins.length > MAX_PLUGINS_PER_MARKETPLACE) {
      throw new Error('The app-server returned too many plugins in one marketplace.')
    }
    marketplaceCount += 1
    totalPluginCount += marketplace.plugins.length
    if (totalPluginCount > MAX_TOTAL_PLUGINS) {
      throw new Error('The app-server returned too many plugins.')
    }
    for (const pluginValue of marketplace.plugins) {
      const plugin = normalizePluginSummary(pluginValue, featuredIds)
      if (!plugin) continue
      const existing = byId.get(plugin.id)
      if (!existing || (plugin.installed && !existing.installed)) byId.set(plugin.id, plugin)
    }
  }

  const plugins = [...byId.values()].sort(
    (left, right) =>
      Number(right.featured) - Number(left.featured) ||
      Number(right.installed) - Number(left.installed) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
  return {
    plugins,
    marketplaceCount,
    loadErrorCount: Array.isArray(value.marketplaceLoadErrors)
      ? value.marketplaceLoadErrors.length
      : 0
  }
}

import { isAbsolute, normalize, relative } from 'node:path'
import type { ExternalAgentDetectOptions, ExternalAgentImportOptions, ExternalAgentImportReadOptions, ExternalAgentImportPreferences } from '../shared/api'

export const MAX_RENDERER_RPC_BYTES = 4 * 1024 * 1024

const externalAgentProviderIds = new Set(['claude-code', 'cursor', 'claude-cowork'])
const externalAgentItemTypes = new Set(['AGENTS_MD', 'CONFIG', 'SKILLS', 'PLUGINS', 'MCP_SERVER_CONFIG', 'SUBAGENTS', 'HOOKS', 'COMMANDS', 'MEMORY', 'SESSIONS'])

function externalAgentProviders(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 3 && value.every(provider => typeof provider === 'string' && externalAgentProviderIds.has(provider))
}
function isAbsolutePath(value: unknown): value is string { return isNormalizedAbsolutePath(value) }
function externalAgentLimits(value: unknown): boolean {
  return value === undefined || (isRecord(value) && hasAllowedKeys(value, ['maxSessionAgeMs', 'maxSessionsPerSpace']) && Object.values(value).every(limit => Number.isSafeInteger(limit) && (limit as number) >= 0 && (limit as number) <= 31_536_000_000))
}
function externalAgentSized(value: unknown): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_RENDERER_RPC_BYTES } catch { return false }
}
export function isExternalAgentDetectOptions(value: unknown): value is ExternalAgentDetectOptions {
  return isRecord(value) && value.hostId === 'local' && hasAllowedKeys(value, ['hostId', 'includeHome', 'providers', 'sessionLimits', 'workspaceRoots']) && externalAgentProviders(value.providers) && (value.includeHome === undefined || typeof value.includeHome === 'boolean') && externalAgentLimits(value.sessionLimits) && (value.workspaceRoots === undefined || (Array.isArray(value.workspaceRoots) && value.workspaceRoots.length <= 100 && value.workspaceRoots.every(isAbsolutePath))) && externalAgentSized(value)
}
export function isExternalAgentImportOptions(value: unknown): value is ExternalAgentImportOptions {
  if (!isRecord(value) || value.hostId !== 'local' || !hasAllowedKeys(value, ['hostId', 'importAttemptId', 'items', 'projectId', 'sessionLimits']) || !isIdentifier(value.importAttemptId) || !isOptionalNullableIdentifier(value.projectId) || !externalAgentLimits(value.sessionLimits) || !Array.isArray(value.items) || value.items.length > 1_000 || !externalAgentSized(value)) return false
  return value.items.every(item => {
    if (!isRecord(item) || !hasAllowedKeys(item, ['providerId', 'cwd', 'description', 'itemType', 'details', 'sourcePath']) || !externalAgentProviderIds.has(String(item.providerId)) || !externalAgentItemTypes.has(String(item.itemType)) || !(item.cwd === null || item.cwd === '' || isAbsolutePath(item.cwd)) || !isBoundedString(item.description, 10_000) || !(item.sourcePath === undefined || isAbsolutePath(item.sourcePath))) return false
    if (item.details === null) return true
    if (!isRecord(item.details) || !hasAllowedKeys(item.details, ['commands', 'hooks', 'mcpServers', 'plugins', 'skills', 'subagents', 'memory', 'sessions'])) return false
    for (const key of ['commands', 'hooks', 'mcpServers', 'skills', 'subagents']) {
      const list = item.details[key]
      if (!Array.isArray(list) || list.length > 1_000 || !list.every(entry => isRecord(entry) && hasOnlyKeys(entry, ['name']) && isBoundedString(entry.name, 1_024))) return false
    }
    const memory = item.details.memory, plugins = item.details.plugins, sessions = item.details.sessions
    return Array.isArray(memory) && memory.length <= 1_000 && memory.every(path => isBoundedString(path, 4_096)) && Array.isArray(plugins) && plugins.length <= 1_000 && plugins.every(plugin => isRecord(plugin) && hasOnlyKeys(plugin, ['marketplaceName', 'pluginNames']) && isIdentifier(plugin.marketplaceName) && Array.isArray(plugin.pluginNames) && plugin.pluginNames.length <= 1_000 && plugin.pluginNames.every(isIdentifier)) && Array.isArray(sessions) && sessions.length <= 1_000 && sessions.every(session => isRecord(session) && hasAllowedKeys(session, ['cwd', 'path', 'title', 'workspaceKind']) && isAbsolutePath(session.cwd) && isAbsolutePath(session.path) && (session.title === null || isBoundedString(session.title, 10_000, { allowEmpty: true })) && (session.workspaceKind === undefined || session.workspaceKind === 'projectless'))
  })
}
export function isExternalAgentReadOptions(value: unknown): value is ExternalAgentImportReadOptions {
  return isRecord(value) && hasAllowedKeys(value, ['hostId', 'providers']) && value.hostId === 'local' && (value.providers === undefined || externalAgentProviders(value.providers))
}
export function isExternalAgentSyncOptions(value: unknown): value is { syncEnabled: boolean; providers?: ExternalAgentImportPreferences['providers']; syncItemTypes?: ExternalAgentImportPreferences['syncItemTypes'] } {
  if (!isRecord(value) || !hasAllowedKeys(value, ['syncEnabled', 'providers', 'syncItemTypes']) || typeof value.syncEnabled !== 'boolean' || !(value.providers === undefined || externalAgentProviders(value.providers))) return false
  return value.syncItemTypes === undefined || value.syncItemTypes === null || value.syncItemTypes === 'all' || (isRecord(value.syncItemTypes) && Object.entries(value.syncItemTypes).every(([key, entry]) => externalAgentItemTypes.has(key) && (typeof entry === 'boolean' || entry === 'original')))
}
export function isExternalAgentImportIdentifier(value: unknown): value is string { return isIdentifier(value) }
export function isExternalAgentMcpAuthenticationUrl(value: unknown): value is string { return parseSafeHttpsUrl(value) != null }

const MAX_IDENTIFIER_LENGTH = 1024
const MAX_CURSOR_LENGTH = 8192
const MAX_PATH_LENGTH = 4096
const MAX_FILTER_LENGTH = 10_000
const MAX_NAME_LENGTH = 512
const MAX_LIST_ITEMS = 100
const MAX_TURN_INPUT_ITEMS = 21

const threadSourceKinds = new Set([
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown'
])

const reasoningEfforts = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
])

export function isTrustedRendererUrl(
  senderUrl: string,
  configuredDevelopmentUrl: string | null = process.env.ELECTRON_RENDERER_URL ?? null
): boolean {
  let sender: URL
  try {
    sender = new URL(senderUrl)
  } catch {
    return false
  }

  if (configuredDevelopmentUrl) {
    try {
      const configured = new URL(configuredDevelopmentUrl)
      return (
        (configured.protocol === 'http:' || configured.protocol === 'https:') &&
        configured.username === '' &&
        configured.password === '' &&
        sender.username === '' &&
        sender.password === '' &&
        sender.origin === configured.origin
      )
    } catch {
      return false
    }
  }

  return sender.href === 'app://-/index.html'
}

const rendererRpcMethods = new Set([
  'thread/list',
  'thread/read',
  'thread/resume',
  'thread/turns/list',
  'thread/search',
  'thread/start',
  'thread/name/set',
  'thread/archive',
  'thread/unarchive',
  'thread/delete',
  'thread/fork',
  'thread/revert',
  'thread/compact/start',
  'thread/queue/add',
  'thread/queue/list',
  'thread/queue/update',
  'thread/queue/delete',
  'thread/queue/reorder',
  'thread/queue/start',
  'thread/goal/set',
  'thread/goal/get',
  'thread/goal/clear',
  'thread/backgroundTerminals/clean',
  'thread/backgroundTerminals/list',
  'thread/backgroundTerminals/terminate',
  'project/list',
  'project/create',
  'model/list',
  'permissionProfile/list',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
  'account/read',
  'account/login/start',
  'account/logout',
  'account/rateLimits/read',
  'skills/list',
  'skills/config/write',
  'app/list',
  'app/installed',
  'plugin/list',
  'plugin/read',
  'plugin/install',
  'plugin/uninstall',
  'marketplace/add',
  'marketplace/remove',
  'mcpServerStatus/list',
  'config/read',
  'config/value/write',
  'config/mcpServer/reload'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isBoundedString(
  value: unknown,
  maxLength: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {}
): value is string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) return false
  const candidate = options.trim ? value.trim() : value
  return options.allowEmpty === true || candidate.length > 0
}

function isIdentifier(value: unknown): value is string {
  return isBoundedString(value, MAX_IDENTIFIER_LENGTH, { trim: true })
}

function isOptionalNullableIdentifier(value: unknown): boolean {
  return value === undefined || value === null || isIdentifier(value)
}

function isCursor(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    isBoundedString(value, MAX_CURSOR_LENGTH)
  )
}

function isPageLimit(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 100)
  )
}

function isDenseArray<T>(
  value: unknown,
  maxLength: number,
  itemGuard: (item: unknown) => item is T,
  minLength = 0
): value is T[] {
  if (
    !Array.isArray(value) ||
    value.length < minLength ||
    value.length > maxLength ||
    Object.keys(value).length !== value.length
  ) {
    return false
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index) || !itemGuard(value[index])) {
      return false
    }
  }
  return true
}

function isOptionalNullableArray<T>(
  value: unknown,
  maxLength: number,
  itemGuard: (item: unknown) => item is T
): boolean {
  return value === undefined || value === null || isDenseArray(value, maxLength, itemGuard)
}

function isThreadIdOnly(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasOnlyKeys(params, ['threadId']) &&
    isIdentifier(params.threadId)
  )
}

function isNormalizedAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    normalize(value) === value
  )
}

/**
 * Workspace browsing is deliberately exposed through a dedicated IPC surface
 * rather than the renderer's generic app-server bridge.  Both paths must be
 * normalized absolutes and the requested path must remain inside the selected
 * workspace root before the main process performs canonical-path checks.
 */
export function isAllowedWorkspacePathRequest(
  value: unknown
): value is { root: string; path: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['root', 'path']) ||
    !isNormalizedAbsolutePath(value.root) ||
    !isNormalizedAbsolutePath(value.path)
  ) {
    return false
  }

  const relativePath = relative(value.root, value.path)
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('../'))
  )
}

function isThreadListCwd(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    isNormalizedAbsolutePath(value) ||
    isDenseArray(value, MAX_LIST_ITEMS, isNormalizedAbsolutePath)
  )
}

function isThreadListParams(params: unknown): boolean {
  if (
    !isRecord(params) ||
    !hasAllowedKeys(params, [
      'ancestorThreadId',
      'archived',
      'cursor',
      'cwd',
      'excludedThreadIds',
      'limit',
      'modelProviders',
      'originators',
      'parentThreadId',
      'projectId',
      'searchTerm',
      'sectionId',
      'sortDirection',
      'sortKey',
      'sourceKinds',
      'useStateDbOnly'
    ])
  ) {
    return false
  }

  if (
    !isOptionalNullableIdentifier(params.ancestorThreadId) ||
    !isOptionalNullableIdentifier(params.parentThreadId) ||
    (params.ancestorThreadId != null && params.parentThreadId != null) ||
    !isOptionalNullableIdentifier(params.projectId) ||
    !isOptionalNullableIdentifier(params.sectionId) ||
    !isCursor(params.cursor) ||
    !isPageLimit(params.limit) ||
    !isThreadListCwd(params.cwd)
  ) {
    return false
  }

  if (
    params.archived !== undefined &&
    params.archived !== null &&
    typeof params.archived !== 'boolean'
  ) {
    return false
  }
  if (params.useStateDbOnly !== undefined && typeof params.useStateDbOnly !== 'boolean') {
    return false
  }
  if (
    params.searchTerm !== undefined &&
    params.searchTerm !== null &&
    !isBoundedString(params.searchTerm, MAX_FILTER_LENGTH, { allowEmpty: true })
  ) {
    return false
  }
  if (
    params.sortKey !== undefined &&
    params.sortKey !== null &&
    !['created_at', 'updated_at', 'recency_at', 'section_position'].includes(
      params.sortKey as string
    )
  ) {
    return false
  }
  if (
    params.sortDirection !== undefined &&
    params.sortDirection !== null &&
    params.sortDirection !== 'asc' &&
    params.sortDirection !== 'desc'
  ) {
    return false
  }

  const namedFilter = (value: unknown): value is string =>
    isBoundedString(value, MAX_NAME_LENGTH, { trim: true })
  const sourceKind = (value: unknown): value is string =>
    typeof value === 'string' && threadSourceKinds.has(value)
  return (
    isOptionalNullableArray(
      params.excludedThreadIds,
      MAX_LIST_ITEMS,
      isIdentifier
    ) &&
    isOptionalNullableArray(params.modelProviders, MAX_LIST_ITEMS, namedFilter) &&
    isOptionalNullableArray(params.originators, MAX_LIST_ITEMS, namedFilter) &&
    isOptionalNullableArray(params.sourceKinds, threadSourceKinds.size, sourceKind)
  )
}

function isThreadReadParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['threadId', 'includeTurns']) &&
    isIdentifier(params.threadId) &&
    (params.includeTurns === undefined || typeof params.includeTurns === 'boolean')
  )
}

function isThreadResumeParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['threadId', 'excludeTurns']) &&
    isIdentifier(params.threadId) &&
    (params.excludeTurns === undefined || typeof params.excludeTurns === 'boolean')
  )
}

function isThreadTurnsListParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['threadId', 'cursor', 'limit', 'sortDirection', 'itemsView']) &&
    isIdentifier(params.threadId) &&
    isCursor(params.cursor) &&
    isPageLimit(params.limit) &&
    (params.sortDirection === undefined ||
      params.sortDirection === null ||
      params.sortDirection === 'asc' ||
      params.sortDirection === 'desc') &&
    (params.itemsView === undefined ||
      params.itemsView === null ||
      params.itemsView === 'notLoaded' ||
      params.itemsView === 'summary' ||
      params.itemsView === 'full')
  )
}

function isOptionalProfileId(value: unknown): boolean {
  return value === undefined || isBoundedString(value, MAX_NAME_LENGTH, { trim: true })
}

function isOptionalApprovalsReviewer(value: unknown): boolean {
  return value === undefined ||
    value === 'user' ||
    value === 'auto_review' ||
    value === 'guardian_subagent'
}

function isThreadStartParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, [
      'cwd',
      'model',
      'permissions',
      'approvalsReviewer',
      'ephemeral',
      'projectId'
    ]) &&
    isNormalizedAbsolutePath(params.cwd) &&
    isBoundedString(params.model, MAX_NAME_LENGTH, { trim: true }) &&
    isOptionalProfileId(params.permissions) &&
    isOptionalApprovalsReviewer(params.approvalsReviewer) &&
    isOptionalNullableIdentifier(params.projectId) &&
    typeof params.ephemeral === 'boolean'
  )
}

function isTurnInput(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.type !== 'string') return false

  if (value.type === 'text') {
    return (
      hasAllowedKeys(value, ['type', 'text', 'text_elements']) &&
      isBoundedString(value.text, MAX_RENDERER_RPC_BYTES, { trim: true }) &&
      (value.text_elements === undefined ||
        isDenseArray(value.text_elements, 0, (_item): _item is never => false))
    )
  }

  if (value.type === 'localImage') {
    return (
      hasAllowedKeys(value, ['type', 'path', 'detail']) &&
      isNormalizedAbsolutePath(value.path) &&
      (value.detail === undefined ||
        value.detail === 'auto' ||
        value.detail === 'low' ||
        value.detail === 'high' ||
        value.detail === 'original')
    )
  }

  if (value.type === 'mention') {
    return (
      hasOnlyKeys(value, ['type', 'name', 'path']) &&
      isBoundedString(value.name, MAX_NAME_LENGTH, { trim: true }) &&
      isNormalizedAbsolutePath(value.path)
    )
  }

  return false
}

function isTurnStartParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, [
      'threadId',
      'clientUserMessageId',
      'input',
      'cwd',
      'permissions',
      'approvalsReviewer',
      'model',
      'effort',
      'collaborationMode'
    ]) &&
    isIdentifier(params.threadId) &&
    isIdentifier(params.clientUserMessageId) &&
    isDenseArray(params.input, MAX_TURN_INPUT_ITEMS, isTurnInput, 1) &&
    isNormalizedAbsolutePath(params.cwd) &&
    isOptionalProfileId(params.permissions) &&
    isOptionalApprovalsReviewer(params.approvalsReviewer) &&
    isBoundedString(params.model, MAX_NAME_LENGTH, { trim: true }) &&
    typeof params.effort === 'string' &&
    reasoningEfforts.has(params.effort) &&
    (params.collaborationMode === undefined || isPlanCollaborationMode(params.collaborationMode))
  )
}

function isThreadQueueAddParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasOnlyKeys(params, ['threadId', 'clientUserMessageId', 'input']) &&
    isIdentifier(params.threadId) &&
    isIdentifier(params.clientUserMessageId) &&
    isDenseArray(params.input, MAX_TURN_INPUT_ITEMS, isTurnInput, 1)
  )
}

function isThreadQueueListParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['threadId', 'cursor', 'limit']) &&
    isIdentifier(params.threadId) &&
    isCursor(params.cursor) &&
    isPageLimit(params.limit)
  )
}

function isThreadQueueUpdateParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasOnlyKeys(params, ['threadId', 'queuedSubmissionId', 'input']) &&
    isIdentifier(params.threadId) &&
    isIdentifier(params.queuedSubmissionId) &&
    isDenseArray(params.input, MAX_TURN_INPUT_ITEMS, isTurnInput, 1)
  )
}

function isThreadQueueSubmissionParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasOnlyKeys(params, ['threadId', 'queuedSubmissionId']) &&
    isIdentifier(params.threadId) &&
    isIdentifier(params.queuedSubmissionId)
  )
}

function isThreadQueueReorderParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasOnlyKeys(params, ['threadId', 'queuedSubmissionIds']) &&
    isIdentifier(params.threadId) &&
    isDenseArray(params.queuedSubmissionIds, MAX_LIST_ITEMS, isIdentifier)
  )
}

function isPlanCollaborationMode(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['mode', 'settings']) ||
    value.mode !== 'plan' ||
    !isRecord(value.settings) ||
    !hasOnlyKeys(value.settings, ['model', 'reasoning_effort'])
  ) {
    return false
  }

  return (
    isBoundedString(value.settings.model, MAX_NAME_LENGTH, { trim: true }) &&
    typeof value.settings.reasoning_effort === 'string' &&
    reasoningEfforts.has(value.settings.reasoning_effort)
  )
}

const threadGoalStatuses = new Set([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete'
])

function isThreadGoalObjective(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !value.includes('\0') &&
    value.trim().length > 0 &&
    Array.from(value).length <= 4_000
  )
}

function isThreadGoalSetParams(params: unknown): boolean {
  if (
    !isRecord(params) ||
    !hasAllowedKeys(params, ['threadId', 'objective', 'origin', 'status', 'tokenBudget']) ||
    !isIdentifier(params.threadId) ||
    (params.objective !== undefined &&
      params.objective !== null &&
      !isThreadGoalObjective(params.objective)) ||
    (params.origin !== undefined &&
      params.origin !== null &&
      params.origin !== 'user' &&
      params.origin !== 'automatic') ||
    (params.status !== undefined &&
      params.status !== null &&
      (typeof params.status !== 'string' || !threadGoalStatuses.has(params.status)))
  ) {
    return false
  }

  return (
    params.tokenBudget === undefined ||
    params.tokenBudget === null ||
    (Number.isSafeInteger(params.tokenBudget) && (params.tokenBudget as number) > 0)
  )
}

function isThreadGoalClearParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['threadId', 'origin']) &&
    isIdentifier(params.threadId) &&
    (params.origin === undefined ||
      params.origin === null ||
      params.origin === 'user' ||
      params.origin === 'automatic')
  )
}

function isTurnSteerParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, [
      'threadId',
      'input',
      'expectedTurnId',
      'clientUserMessageId'
    ]) &&
    isIdentifier(params.threadId) &&
    isDenseArray(params.input, MAX_TURN_INPUT_ITEMS, isTurnInput, 1) &&
    isIdentifier(params.expectedTurnId) &&
    isOptionalNullableIdentifier(params.clientUserMessageId)
  )
}

function isTurnInterruptParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasOnlyKeys(params, ['threadId', 'turnId']) &&
    isIdentifier(params.threadId) &&
    isIdentifier(params.turnId)
  )
}

function isModelListParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['cursor', 'includeHidden', 'limit']) &&
    isCursor(params.cursor) &&
    isPageLimit(params.limit) &&
    (params.includeHidden === undefined ||
      params.includeHidden === null ||
      typeof params.includeHidden === 'boolean')
  )
}

function isPermissionProfileListParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['cursor', 'cwd', 'limit']) &&
    isCursor(params.cursor) &&
    isPageLimit(params.limit) &&
    (params.cwd === undefined || params.cwd === null || isNormalizedAbsolutePath(params.cwd))
  )
}

function isProjectListParams(params: unknown): boolean {
  return (
    isRecord(params) &&
    hasAllowedKeys(params, ['cursor', 'limit', 'sortKey', 'sortDirection']) &&
    isCursor(params.cursor) &&
    isPageLimit(params.limit) &&
    (params.sortKey === undefined ||
      params.sortKey === null ||
      params.sortKey === 'position' ||
      params.sortKey === 'recencyAt') &&
    (params.sortDirection === undefined ||
      params.sortDirection === null ||
      params.sortDirection === 'asc' ||
      params.sortDirection === 'desc') &&
    (params.sortDirection === undefined ||
      params.sortDirection === null ||
      params.sortKey !== undefined)
  )
}

function isProjectRoot(value: unknown): value is { path: string } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['path']) &&
    isNormalizedAbsolutePath(value.path)
  )
}

function isProjectCreateParams(params: unknown): boolean {
  if (
    !isRecord(params) ||
    !hasAllowedKeys(params, ['name', 'roots', 'metadata', 'idempotencyKey']) ||
    !isBoundedString(params.name, MAX_NAME_LENGTH, { trim: true }) ||
    !isDenseArray(params.roots, MAX_LIST_ITEMS, isProjectRoot, 1) ||
    !isIdentifier(params.idempotencyKey)
  ) {
    return false
  }

  if (params.metadata === undefined || params.metadata === null) return true
  if (!isRecord(params.metadata) || Object.keys(params.metadata).length > MAX_LIST_ITEMS) {
    return false
  }
  return Object.entries(params.metadata).every(
    ([key, value]) =>
      isBoundedString(key, MAX_NAME_LENGTH, { trim: true }) &&
      isBoundedString(value, MAX_FILTER_LENGTH, { allowEmpty: true })
  )
}

function hasAllowedSerializedSize(method: string, params: unknown): boolean {
  try {
    const serialized = JSON.stringify({ method, params })
    return Buffer.byteLength(serialized, 'utf8') <= MAX_RENDERER_RPC_BYTES
  } catch {
    return false
  }
}

function hasAllowedRendererRpcShape(method: string, params: unknown): boolean {
  if (method === 'thread/list') return isThreadListParams(params)
  if (method === 'thread/read') return isThreadReadParams(params)
  if (method === 'thread/resume') return isThreadResumeParams(params)
  if (method === 'thread/turns/list') return isThreadTurnsListParams(params)
  if (method === 'thread/start') return isThreadStartParams(params)
  if (method === 'thread/queue/add') return isThreadQueueAddParams(params)
  if (method === 'thread/queue/list') return isThreadQueueListParams(params)
  if (method === 'thread/queue/update') return isThreadQueueUpdateParams(params)
  if (method === 'thread/queue/delete' || method === 'thread/queue/start') {
    return isThreadQueueSubmissionParams(params)
  }
  if (method === 'thread/queue/reorder') return isThreadQueueReorderParams(params)
  if (method === 'turn/start') return isTurnStartParams(params)
  if (method === 'turn/steer') return isTurnSteerParams(params)
  if (method === 'turn/interrupt') return isTurnInterruptParams(params)
  if (method === 'thread/goal/set') return isThreadGoalSetParams(params)
  if (method === 'thread/goal/get') return isThreadIdOnly(params)
  if (method === 'thread/goal/clear') return isThreadGoalClearParams(params)
  if (method === 'project/list') return isProjectListParams(params)
  if (method === 'project/create') return isProjectCreateParams(params)
  if (method === 'model/list') return isModelListParams(params)
  if (method === 'permissionProfile/list') return isPermissionProfileListParams(params)

  if (method === 'account/read') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['refreshToken']) &&
      params.refreshToken === false
    )
  }

  if (method === 'account/login/start') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['type', 'useHostedLoginSuccessPage', 'appBrand']) &&
      params.type === 'chatgpt' &&
      params.useHostedLoginSuccessPage === true &&
      params.appBrand === 'codex'
    )
  }

  if (method === 'account/logout' || method === 'account/rateLimits/read') {
    return params === undefined || (isRecord(params) && Object.keys(params).length === 0)
  }

  if (method === 'skills/list') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['cwds', 'forceReload']) &&
      isDenseArray(params.cwds, 1, isNormalizedAbsolutePath, 1) &&
      typeof params.forceReload === 'boolean'
    )
  }

  if (method === 'skills/config/write') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['path', 'enabled']) &&
      isNormalizedAbsolutePath(params.path) &&
      typeof params.enabled === 'boolean'
    )
  }

  if (method === 'config/read') {
    return (
      isRecord(params) &&
      hasAllowedKeys(params, ['cwd', 'includeLayers']) &&
      (params.cwd === undefined || params.cwd === null || isNormalizedAbsolutePath(params.cwd)) &&
      (params.includeLayers === undefined || typeof params.includeLayers === 'boolean')
    )
  }

  if (method === 'config/value/write') return isConfigurationSettingWrite(params)

  if (method === 'app/list') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['cursor', 'forceRefetch', 'limit', 'threadId']) &&
      isCursor(params.cursor) &&
      typeof params.forceRefetch === 'boolean' &&
      params.limit === 100 &&
      params.threadId === null
    )
  }

  if (method === 'app/installed') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['forceRefresh', 'threadId']) &&
      typeof params.forceRefresh === 'boolean' &&
      params.threadId === null
    )
  }

  if (method === 'plugin/list') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['cwds', 'forceRefetch']) &&
      isDenseArray(params.cwds, 1, isNormalizedAbsolutePath, 1) &&
      typeof params.forceRefetch === 'boolean'
    )
  }

  if (method === 'plugin/read' || method === 'plugin/install') {
    if (!isRecord(params) || !hasAllowedKeys(params, ['pluginName', 'marketplacePath', 'remoteMarketplaceName', 'installAttemptId']) || !isIdentifier(params.pluginName)) return false
    const local = isNormalizedAbsolutePath(params.marketplacePath) && params.remoteMarketplaceName === undefined
    const remote = isIdentifier(params.remoteMarketplaceName) && params.marketplacePath === undefined
    return (local || remote) && (params.installAttemptId === undefined || (method === 'plugin/install' && isIdentifier(params.installAttemptId)))
  }
  if (method === 'plugin/uninstall') return isRecord(params) && hasOnlyKeys(params, ['pluginId']) && isIdentifier(params.pluginId)
  if (method === 'marketplace/remove') return isRecord(params) && hasOnlyKeys(params, ['marketplaceName']) && isIdentifier(params.marketplaceName)
  if (method === 'marketplace/add') return isRecord(params) && hasAllowedKeys(params, ['source', 'refName', 'sparsePaths']) &&
    isBoundedString(params.source, MAX_PATH_LENGTH, { trim: true }) &&
    (params.refName === undefined || params.refName === null || isIdentifier(params.refName)) &&
    (params.sparsePaths === undefined || params.sparsePaths === null || isDenseArray(params.sparsePaths, MAX_LIST_ITEMS, (value): value is string => isBoundedString(value, MAX_PATH_LENGTH, { trim: true })))

  if (method === 'mcpServerStatus/list') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['cursor', 'detail', 'limit']) &&
      isCursor(params.cursor) &&
      params.detail === 'full' &&
      params.limit === 100
    )
  }

  if (method === 'config/mcpServer/reload') return params === undefined

  if (
    method === 'thread/archive' ||
    method === 'thread/unarchive' ||
    method === 'thread/delete' ||
    method === 'thread/compact/start' ||
    method === 'thread/backgroundTerminals/clean'
  ) {
    return isThreadIdOnly(params)
  }

  if (method === 'thread/backgroundTerminals/list') {
    return (
      isRecord(params) &&
      hasAllowedKeys(params, ['threadId', 'cursor', 'limit']) &&
      isIdentifier(params.threadId) &&
      isCursor(params.cursor) &&
      isPageLimit(params.limit)
    )
  }

  if (method === 'thread/backgroundTerminals/terminate') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['threadId', 'processId']) &&
      isIdentifier(params.threadId) &&
      isIdentifier(params.processId)
    )
  }

  if (method === 'thread/name/set') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['threadId', 'name']) &&
      isIdentifier(params.threadId) &&
      isBoundedString(params.name, 200, { trim: true })
    )
  }

  if (method === 'thread/fork') {
    if (
      !isRecord(params) ||
      !hasAllowedKeys(params, [
        'threadId',
        'excludeTurns',
        'lastTurnId',
        'beforeTurnId',
        'ephemeral',
        'approvalsReviewer',
        'experimentalPredictionMode'
      ]) ||
      !isIdentifier(params.threadId) ||
      typeof params.excludeTurns !== 'boolean' ||
      (params.lastTurnId !== undefined && !isIdentifier(params.lastTurnId)) ||
      (params.beforeTurnId !== undefined && !isIdentifier(params.beforeTurnId)) ||
      (params.ephemeral !== undefined && typeof params.ephemeral !== 'boolean') ||
      !isOptionalApprovalsReviewer(params.approvalsReviewer) ||
      (params.experimentalPredictionMode !== undefined &&
        params.experimentalPredictionMode !== true)
    ) {
      return false
    }
    if (params.lastTurnId !== undefined && params.beforeTurnId !== undefined) return false
    if (params.ephemeral === true && params.excludeTurns !== true) return false
    if (params.ephemeral === true &&
        (params.lastTurnId !== undefined || params.beforeTurnId !== undefined)) return false
    if (
      params.experimentalPredictionMode === true &&
      (params.ephemeral !== true || params.excludeTurns !== true ||
        params.lastTurnId !== undefined || params.beforeTurnId !== undefined)
    ) {
      return false
    }
    return true
  }

  if (method === 'thread/revert') {
    return (
      isRecord(params) &&
      hasOnlyKeys(params, ['threadId', 'beforeTurnId']) &&
      isIdentifier(params.threadId) &&
      isIdentifier(params.beforeTurnId)
    )
  }

  if (method === 'thread/search') {
    if (
      !isRecord(params) ||
      !hasAllowedKeys(params, [
        'searchTerm',
        'cursor',
        'limit',
        'sortKey',
        'sortDirection',
        'sourceKinds',
        'archived'
      ]) ||
      !isBoundedString(params.searchTerm, MAX_FILTER_LENGTH, { trim: true }) ||
      !isCursor(params.cursor) ||
      !isPageLimit(params.limit)
    ) {
      return false
    }
    if (
      params.sortKey !== undefined &&
      params.sortKey !== 'created_at' &&
      params.sortKey !== 'updated_at' &&
      params.sortKey !== 'recency_at'
    ) {
      return false
    }
    if (
      params.sortDirection !== undefined &&
      params.sortDirection !== 'asc' &&
      params.sortDirection !== 'desc'
    ) {
      return false
    }
    if (params.archived !== undefined && params.archived !== null && typeof params.archived !== 'boolean') {
      return false
    }
    const sourceKind = (value: unknown): value is string =>
      typeof value === 'string' && threadSourceKinds.has(value)
    return isOptionalNullableArray(params.sourceKinds, threadSourceKinds.size, sourceKind)
  }

  return false
}

/** Settings UI edits user defaults; arbitrary file destinations and key paths are excluded. */
function isConfigurationSettingWrite(params: unknown): boolean {
  if (
    !isRecord(params) ||
    !hasAllowedKeys(params, ['keyPath', 'value', 'mergeStrategy', 'expectedVersion']) ||
    !Object.hasOwn(params, 'value') ||
    (params.mergeStrategy !== 'replace' && params.mergeStrategy !== 'upsert') ||
    (params.expectedVersion !== undefined &&
      params.expectedVersion !== null &&
      !isBoundedString(params.expectedVersion, MAX_CURSOR_LENGTH))
  ) {
    return false
  }
  if (typeof params.keyPath === 'string' && /^(?:plugins|mcp_servers)\.[A-Za-z0-9_@/-]+\.enabled$/.test(params.keyPath)) return typeof params.value === 'boolean'
  if (params.mergeStrategy !== 'replace') return false
  const values: Record<string, readonly unknown[]> = {
    approval_policy: ['on-request', 'never'],
    sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
    web_search: [null, 'disabled', 'cached', 'live'],
    model_verbosity: [null, 'low', 'medium', 'high'],
    model_reasoning_summary: [null, 'auto', 'concise', 'detailed', 'none'],
    'sandbox_workspace_write.network_access': [true, false]
  }
  return typeof params.keyPath === 'string' && Object.hasOwn(values, params.keyPath) &&
    values[params.keyPath].includes(params.value)
}

/**
 * Keep renderer-accessible authentication RPCs intentionally narrower than
 * the app-server protocol. In particular, this desktop surface never accepts
 * or persists an API key supplied by renderer code.
 */
export function isAllowedRendererRpc(method: unknown, params: unknown): method is string {
  if (typeof method !== 'string' || !rendererRpcMethods.has(method)) return false
  return hasAllowedRendererRpcShape(method, params) && hasAllowedSerializedSize(method, params)
}

const allowedAuthenticationHosts = new Set([
  'chatgpt.com',
  'auth.openai.com',
  'platform.openai.com'
])

const allowedExternalHosts = new Set([
  'github.com',
  'gist.github.com',
  'learn.chatgpt.com',
  'help.openai.com',
  'developers.openai.com',
  'openai.com',
  'www.openai.com'
])

const MAX_EXTERNAL_URL_LENGTH = 8_192

function parseSafeHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_EXTERNAL_URL_LENGTH) {
    return null
  }

  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.port === '' || url.port === '443') &&
      url.username === '' &&
      url.password === ''
    ) ? url : null
  } catch {
    return null
  }
}

/**
 * Renderer-originated links are deliberately limited to reviewed product,
 * documentation, and source-code destinations. Authentication origins are
 * excluded here so they can only be opened through AuthenticationUrlBroker.
 */
export function isAllowedExternalUrl(value: unknown): value is string {
  const url = parseSafeHttpsUrl(value)
  return Boolean(url && allowedExternalHosts.has(url.hostname))
}

export function isAllowedAuthenticationUrl(value: unknown): value is string {
  const url = parseSafeHttpsUrl(value)
  return Boolean(url && allowedAuthenticationHosts.has(url.hostname))
}

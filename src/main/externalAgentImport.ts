import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type {
  ExternalAgentConnector, ExternalAgentDetectOptions, ExternalAgentDetection,
  ExternalAgentImportHistories, ExternalAgentImportOptions, ExternalAgentImportPreferences,
  ExternalAgentImportProgress, ExternalAgentImportReadOptions, ExternalAgentImportResult,
  ExternalAgentImportStatus, ExternalAgentImportTypeResult, ExternalAgentMigrationDetails,
  ExternalAgentMigrationItem, ExternalAgentProviderId, JsonMap, RpcNotification
} from '../shared/api'
import { CoworkImportAdapter } from './externalAgentImportCowork'

export interface ExternalAgentServer {
  request<T = unknown>(method: string, params?: JsonMap): Promise<T>
  on(event: 'notification', listener: (notification: RpcNotification) => void): unknown
  removeListener(event: 'notification', listener: (notification: RpcNotification) => void): unknown
}
export interface ProjectlessImportPaths { cwd: string; workspaceRoot: string; outputDirectory: string }
export const EXTERNAL_AGENT_PROVIDERS: ExternalAgentProviderId[] = ['claude-code', 'cursor', 'claude-cowork']
export const DEFAULT_IMPORT_PREFERENCES: ExternalAgentImportPreferences = {
  syncEnabled: false, providers: [],
  sessionLimits: { maxSessionAgeMs: 2_592_000_000, maxSessionsPerSpace: 50 },
  syncItemTypes: null, lastSyncAtMs: null, lastSyncError: null
}
export const emptyMigrationDetails = (): ExternalAgentMigrationDetails => ({
  commands: [], hooks: [], mcpServers: [], plugins: [], skills: [], subagents: [], memory: [], sessions: []
})
export function cursorProjectlessSource(path: string): string | null {
  return /(?:^|[\\/])projects[\\/]empty-window[\\/]agent-transcripts[\\/](.+)$/u.exec(path)?.[1]?.replaceAll('\\', '/') ?? null
}
export function normalizeMigrationItem(value: Omit<ExternalAgentMigrationItem, 'providerId'>, providerId: ExternalAgentProviderId): ExternalAgentMigrationItem {
  return { ...value, providerId, cwd: value.cwd ?? null, details: value.details == null ? null : {
    ...emptyMigrationDetails(), ...value.details,
    sessions: (value.details.sessions ?? []).map(session => ({
      ...session, title: session.title ?? null,
      ...(providerId === 'cursor' && cursorProjectlessSource(session.path) != null ? { workspaceKind: 'projectless' as const } : {})
    }))
  } }
}
function projectRoots(items: ExternalAgentMigrationItem[]): string[] {
  return [...new Set(items.flatMap(item => [
    ...(item.cwd ? [item.cwd] : []),
    ...(item.details?.sessions ?? []).filter(session => session.workspaceKind !== 'projectless').map(session => session.cwd)
  ]))].sort()
}
function dedupe(items: ExternalAgentMigrationItem[]): ExternalAgentMigrationItem[] {
  const seen = new Set<string>()
  return items.filter(item => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true })
}
function isRecord(value: unknown): value is Record<string, unknown> { return value != null && typeof value === 'object' && !Array.isArray(value) }
function hasUnknownImportOutcome(error: unknown): boolean { return isRecord(error) && error.method === 'externalAgentConfig/import' && error.stage === 'outcome-unknown' }
function completion(value: unknown): { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] } | null {
  if (!isRecord(value) || typeof value.importId !== 'string' || !Array.isArray(value.itemTypeResults)) return null
  if (!value.itemTypeResults.every(result => isRecord(result) && typeof result.itemType === 'string' && Array.isArray(result.successes) && Array.isArray(result.failures))) return null
  return value as unknown as { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }
}
export class ExternalAgentImportTimeout extends Error {
  constructor(readonly importId: string, timeoutMs: number) {
    super(`External agent import ${importId} did not complete within ${timeoutMs}ms; the server may still be importing`)
    this.name = 'ExternalAgentImportTimeout'
  }
}
export class ExternalAgentImportDisposed extends Error {
  readonly method = 'externalAgentConfig/import'
  constructor(readonly stage: 'not-sent' | 'outcome-unknown') {
    super(stage === 'outcome-unknown'
      ? 'Import service closed after submission; the server outcome remains unknown and must not be retried blindly'
      : 'Import service closed before submission')
    this.name = 'ExternalAgentImportDisposed'
  }
}

/** The listener precedes the import RPC. A completion can arrive before its response. */
export function createImportCompletionWaiter(server: ExternalAgentServer, timeoutMs = 120_000,
  onProgress?: (value: { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }) => void) {
  const buffered = new Map<string, { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }>()
  const progress = new Map<string, { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }>()
  let target: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false
  let resolveWait!: (value: { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }) => void
  let rejectWait!: (error: Error) => void
  const promise = new Promise<{ importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }>((res, rej) => { resolveWait = res; rejectWait = rej })
  // If the request itself fails, disposal must not create an unhandled rejection.
  void promise.catch(() => {})
  const dispose = (): void => { if (timer) clearTimeout(timer); timer = null; server.removeListener('notification', listener); buffered.clear(); progress.clear() }
  const finish = (value: { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }): void => { if (settled) return; settled = true; dispose(); resolveWait(value) }
  const listener = (notification: RpcNotification): void => {
    if (notification.method !== 'externalAgentConfig/import/completed' && notification.method !== 'externalAgentConfig/import/progress') return
    const value = completion(notification.params)
    if (!value) return
    if (notification.method.endsWith('/progress')) {
      if (target === value.importId) onProgress?.(value)
      else if (!target && progress.size < 100) progress.set(value.importId, value)
    } else if (target === value.importId) finish(value)
    else if (!target && buffered.size < 100) buffered.set(value.importId, value)
  }
  server.on('notification', listener)
  return {
    waitFor(importId: string) {
      if (target != null && target !== importId) throw new Error('Import waiter already assigned')
      target = importId
      if (progress.has(importId)) onProgress?.(progress.get(importId)!)
      const existing = buffered.get(importId)
      if (existing) finish(existing)
      else if (!settled) timer = setTimeout(() => { if (settled) return; settled = true; dispose(); rejectWait(new ExternalAgentImportTimeout(importId, timeoutMs)) }, timeoutMs)
      return promise
    },
    cancel(error = new Error('Import completion wait canceled')) { if (!settled) { settled = true; dispose(); rejectWait(error) } }
  }
}

interface ActiveImport {
  options: ExternalAgentImportOptions
  startedAtMs: number
  stopRequested: boolean
  inFlight: boolean
  nativeSubmitted?: boolean
  cancelCompletionWait?: (error: Error) => void
  progress: ExternalAgentImportProgress
  promise: Promise<ExternalAgentImportResult>
  uncertain?: boolean
  nativePending?: NativePendingImport
  collected?: { results: ExternalAgentImportTypeResult[]; roots: Set<string>; threadRoots: Map<string, string>; threads: Set<string>; providers: Set<ExternalAgentProviderId> }
}
interface NativePendingImport {
  items: ExternalAgentMigrationItem[]
  pathsBySource: Map<string, ProjectlessImportPaths>
  pathsByCwd: Map<string, ProjectlessImportPaths>
  sourceRoots: Map<string, string>
}
interface ImportProfile {
  preferences: ExternalAgentImportPreferences
  originalItemTypes: string[]
  projectlessThreads: Record<string, ProjectlessImportPaths>
}
interface ServiceOptions {
  server: ExternalAgentServer
  profileDirectory: string
  homeDirectory?: string
  codexHome?: string
  coworkUserDataDirectory?: string
  timeoutMs?: number
  syncIntervalMs?: number
  onTrustedResult?: (method: string, result: unknown) => Promise<void> | void
}

export class ExternalAgentImportService extends EventEmitter {
  private readonly server: ExternalAgentServer
  private readonly profilePath: string
  private readonly homeDirectory: string
  private readonly codexHome: string
  private readonly cowork: CoworkImportAdapter
  private profile: ImportProfile = { preferences: structuredClone(DEFAULT_IMPORT_PREFERENCES), originalItemTypes: [], projectlessThreads: {} }
  private readonly loaded: Promise<void>
  private active: ActiveImport | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private syncGeneration = 0
  private saveTail = Promise.resolve()
  private readonly notificationListener = (notification: RpcNotification): void => {
    const active = this.active
    if (!active?.uncertain || notification.method !== 'externalAgentConfig/import/completed') return
    const done = completion(notification.params)
    if (!done || done.importId !== active.progress.importId || !active.nativePending || !active.collected) return
    active.uncertain = false
    void this.completeLateImport(active, done).catch(error => {
      if (this.disposed) return
      this.publish(active, { phase: 'failed', message: `Import completed, but finalization failed: ${error instanceof Error ? error.message : 'unknown error'}` })
      if (this.active === active) this.active = null
    })
  }

  constructor(private readonly options: ServiceOptions) {
    super()
    this.server = options.server
    this.homeDirectory = options.homeDirectory ?? homedir()
    this.codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(this.homeDirectory, '.codex')
    this.profilePath = join(options.profileDirectory, 'external-agent-import.json')
    this.cowork = new CoworkImportAdapter({
      server: this.server, homeDirectory: this.homeDirectory, codexHome: this.codexHome,
      userDataDirectory: options.coworkUserDataDirectory ?? join(this.homeDirectory, 'Library/Application Support/Claude'),
      createProjectlessPaths: title => this.createProjectlessPaths(title),
      recordProjectlessThread: (threadId, paths) => this.recordProjectlessThread(threadId, paths),
      isDisposed: () => this.disposed,
      onMutationSubmitted: () => { if (this.active) this.active.nativeSubmitted = true }
    })
    this.server.on('notification', this.notificationListener)
    this.loaded = this.load().then(() => { if (this.profile.preferences.syncEnabled) this.scheduleSync(1_000) })
  }
  private async load(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.profilePath, 'utf8'))
      if (isRecord(value) && isRecord(value.preferences) && typeof value.preferences.syncEnabled === 'boolean') {
        this.profile = {
          preferences: { ...structuredClone(DEFAULT_IMPORT_PREFERENCES), ...value.preferences,
            providers: Array.isArray(value.preferences.providers) ? value.preferences.providers.filter((provider: unknown) => EXTERNAL_AGENT_PROVIDERS.includes(provider as ExternalAgentProviderId)) : [...EXTERNAL_AGENT_PROVIDERS] },
          originalItemTypes: Array.isArray(value.originalItemTypes) ? value.originalItemTypes : [],
          projectlessThreads: isRecord(value.projectlessThreads) ? value.projectlessThreads as Record<string, ProjectlessImportPaths> : {}
        } as ImportProfile
      }
    } catch { /* A new independent replica profile starts with sync disabled. */ }
  }
  private save(): Promise<void> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const snapshot = JSON.stringify(this.profile)
    const next = this.saveTail.catch(() => {}).then(async () => {
      this.assertOpen()
      await mkdir(resolve(this.profilePath, '..'), { recursive: true })
      const temporary = `${this.profilePath}.${randomUUID()}.tmp`
      await writeFile(temporary, `${snapshot}\n`, { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.profilePath)
    })
    this.saveTail = next
    return next
  }
  private assertLocal(hostId: string): void { if (hostId !== 'local') throw new Error('External agent import is only supported on the local host') }
  private disposedError(): ExternalAgentImportDisposed { return new ExternalAgentImportDisposed(this.active?.nativeSubmitted ? 'outcome-unknown' : 'not-sent') }
  private assertOpen(): void { if (this.disposed) throw this.disposedError() }
  async detect(options: ExternalAgentDetectOptions): Promise<ExternalAgentDetection> {
    this.assertLocal(options.hostId)
    const providers = [...new Set(options.providers)]
    const results = await Promise.all(providers.map(async providerId => {
      try {
        const detection = providerId === 'claude-cowork' ? await this.cowork.detect(options) : await this.detectNative(providerId, options)
        return { ...detection, provider: { providerId, status: 'available' as const, ...(detection.warnings?.length ? { warnings: detection.warnings } : {}) } }
      } catch (error) {
        return { items: [] as ExternalAgentMigrationItem[], unsupportedProjects: [], connectors: [], provider: { providerId, status: 'error' as const, message: error instanceof Error ? error.message : 'Provider detection failed' } }
      }
    }))
    let items = results.flatMap(result => result.items)
    // Original XCe/$Ce expands all discovered project roots across native providers.
    if (options.includeHome !== false) {
      const explicitlyScanned = new Set((options.workspaceRoots ?? []).map(root => resolve(root)))
      const roots = projectRoots(items).filter(root => !explicitlyScanned.has(resolve(root)))
      if (roots.length) {
        const extra = await Promise.all(results.filter(result => result.provider.status === 'available' && result.provider.providerId !== 'claude-cowork').map(async result => {
          try { return (await this.detectNative(result.provider.providerId as 'claude-code' | 'cursor', { ...options, includeHome: false, workspaceRoots: roots })).items } catch { return [] }
        }))
        items = dedupe([...items, ...extra.flat()])
      }
    }
    return { items, unsupportedProjects: results.flatMap(result => result.unsupportedProjects), providers: results.map(result => result.provider), connectors: results.flatMap(result => result.connectors) }
  }
  private async detectNative(providerId: 'claude-code' | 'cursor', options: ExternalAgentDetectOptions) {
    if (options.includeHome === false && options.workspaceRoots == null) return { items: [], unsupportedProjects: [], connectors: [], warnings: [] }
    const result = await this.server.request<{ items: Omit<ExternalAgentMigrationItem, 'providerId'>[]; connectors?: ExternalAgentConnector[] }>('externalAgentConfig/detect', {
      includeHome: options.includeHome !== false,
      ...(options.workspaceRoots == null ? {} : { cwds: options.workspaceRoots }),
      ...(providerId === 'cursor' ? { migrationSource: 'cursor' } : {}),
      ...(options.sessionLimits?.maxSessionAgeMs == null ? {} : { maxSessionAgeDays: Math.ceil(options.sessionLimits.maxSessionAgeMs / 86_400_000) }),
      ...(options.sessionLimits?.maxSessionsPerSpace == null ? {} : { maxSessions: options.sessionLimits.maxSessionsPerSpace })
    })
    if (!Array.isArray(result.items)) throw new Error('Invalid external agent detection response')
    return { items: result.items.map(item => normalizeMigrationItem(item, providerId)), unsupportedProjects: [], connectors: result.connectors ?? [], warnings: [] }
  }
  async import(options: ExternalAgentImportOptions): Promise<ExternalAgentImportResult> {
    this.assertLocal(options.hostId)
    await this.loaded
    this.assertOpen()
    if (this.active) {
      if (this.active.options.importAttemptId === options.importAttemptId) return this.active.promise
      throw new Error('Another external agent import is still running')
    }
    const active: ActiveImport = { options: structuredClone(options), startedAtMs: Date.now(), stopRequested: false, inFlight: false,
      progress: { importAttemptId: options.importAttemptId, phase: 'starting' }, promise: Promise.resolve(null as unknown as ExternalAgentImportResult) }
    this.active = active
    active.promise = this.runImport(active).finally(() => { if (this.active === active && !active.uncertain) this.active = null })
    return active.promise
  }
  cancel(importAttemptId: string): { stopRequested: boolean; inFlight: boolean } {
    const active = this.active
    if (!active || active.options.importAttemptId !== importAttemptId) return { stopRequested: false, inFlight: false }
    active.stopRequested = true
    this.publish(active, { phase: 'stopping', message: active.inFlight ? 'The server is completing the current import; subsequent providers will be skipped.' : 'Stopping before the next provider.' })
    return { stopRequested: true, inFlight: active.inFlight }
  }
  private publish(active: ActiveImport, value: Omit<ExternalAgentImportProgress, 'importAttemptId'>): void {
    active.progress = { ...active.progress, ...value, importAttemptId: active.options.importAttemptId }
    this.emit('progress', structuredClone(active.progress))
  }
  private async runImport(active: ActiveImport): Promise<ExternalAgentImportResult> {
    const results: ExternalAgentImportTypeResult[] = []
    const roots = new Set<string>()
    const threadRoots = new Map<string, string>()
    const threads = new Set<string>()
    active.collected = { results, roots, threadRoots, threads, providers: new Set() }
    try {
      for (const providerId of EXTERNAL_AGENT_PROVIDERS) {
        this.assertOpen()
        if (active.stopRequested) break
        const items = active.options.items.filter(item => item.providerId === providerId)
        if (!items.length) continue
        active.inFlight = providerId === 'claude-cowork'
        active.nativeSubmitted = false
        this.publish(active, { phase: 'importing', providerId, importId: undefined, itemTypeResults: undefined, message: undefined })
        const imported = providerId === 'claude-cowork'
          ? await this.cowork.import(items, () => active.stopRequested)
          : await this.importNative(active, providerId, items)
        active.inFlight = false
        results.push(...imported.itemTypeResults)
        if (imported.itemTypeResults.some(result => result.successes.length)) active.collected.providers.add(providerId)
        for (const root of imported.projectRoots) roots.add(root)
        for (const id of imported.importedSessionThreadIds) threads.add(id)
        for (const [id, root] of imported.threadRoots) threadRoots.set(id, root)
      }
      this.assertOpen()
      this.publish(active, { phase: 'finalizing' })
      const importedProjectIds = await this.finalizeProjects([...roots], threadRoots, active.options.projectId)
      this.assertOpen()
      await this.rememberImportedPreferences(active)
      const result = { importedProjectIds, importedSessionThreadIds: [...threads], projectRoots: [...roots], itemTypeResults: results, canceled: active.stopRequested }
      this.publish(active, { phase: 'completed', itemTypeResults: results, result })
      this.emit('completed', result)
      return result
    } catch (error) {
      active.uncertain = error instanceof ExternalAgentImportTimeout || hasUnknownImportOutcome(error)
      active.inFlight = active.uncertain
      this.publish(active, { phase: active.uncertain ? 'stopping' : 'failed', itemTypeResults: results, message: error instanceof Error ? error.message : 'Import failed' })
      throw error
    }
  }
  private async importNative(active: ActiveImport, providerId: 'claude-code' | 'cursor', items: ExternalAgentMigrationItem[]) {
    const pathsBySource = new Map<string, ProjectlessImportPaths>()
    const pathsByCwd = new Map<string, ProjectlessImportPaths>()
    const sourceRoots = new Map<string, string>()
    const migrationItems = await Promise.all(items.map(async item => {
      const sessions = await Promise.all((item.details?.sessions ?? []).map(async session => {
        if (providerId === 'cursor' && session.workspaceKind === 'projectless') {
          const source = cursorProjectlessSource(session.path)
          if (!source) throw new Error('Invalid projectless Cursor session path')
          const paths = await this.createProjectlessPaths(session.title)
          pathsBySource.set(source, paths); pathsByCwd.set(paths.cwd, paths)
          return { cwd: paths.cwd, path: session.path, title: session.title }
        }
        sourceRoots.set(session.path, session.cwd)
        return { cwd: session.cwd, path: session.path, title: session.title }
      }))
      return { cwd: item.cwd, description: item.description, itemType: item.itemType, details: item.details == null ? null : { ...item.details, sessions } }
    }))
    this.assertOpen()
    if (active.stopRequested) return { itemTypeResults: [], projectRoots: [], importedSessionThreadIds: [], threadRoots: new Map<string, string>() }
    const waiter = createImportCompletionWaiter(this.server, this.options.timeoutMs, value => this.publish(active, { phase: active.stopRequested ? 'stopping' : 'importing', providerId, importId: value.importId, itemTypeResults: value.itemTypeResults }))
    active.cancelCompletionWait = error => waiter.cancel(error)
    active.nativePending = { items, pathsBySource, pathsByCwd, sourceRoots }
    try {
      this.assertOpen()
      active.inFlight = true
      active.nativeSubmitted = true
      const response = await this.server.request<{ importId: string }>('externalAgentConfig/import', {
        migrationItems, providerId, source: 'app', ...(providerId === 'cursor' ? { migrationSource: 'cursor' } : {})
      })
      this.assertOpen()
      if (typeof response.importId !== 'string' || !response.importId) throw new Error('Invalid external agent import response')
      this.publish(active, { phase: active.stopRequested ? 'stopping' : 'importing', importId: response.importId, providerId })
      const done = await waiter.waitFor(response.importId)
      this.assertOpen()
      return await this.applyNativeCompletion(active.nativePending, done)
    } catch (error) { waiter.cancel(error instanceof Error ? error : new Error('Import failed')); throw error }
    finally { active.cancelCompletionWait = undefined }
  }
  private async applyNativeCompletion(pending: NativePendingImport, done: { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }) {
      this.assertOpen()
      const { items, pathsBySource, pathsByCwd, sourceRoots } = pending
      const roots = new Set<string>()
      const threadRoots = new Map<string, string>()
      const importedSessionThreadIds: string[] = []
      for (const result of done.itemTypeResults) for (const success of result.successes) {
        this.assertOpen()
        const sourceId = success.source ? cursorProjectlessSource(success.source) : null
        const paths = (sourceId ? pathsBySource.get(sourceId) : undefined) ?? (success.cwd ? pathsByCwd.get(success.cwd) : undefined)
        const root = success.cwd || (success.source ? sourceRoots.get(success.source) : undefined)
        if (result.itemType === 'SESSIONS' && success.itemType === 'SESSIONS' && success.target) {
          importedSessionThreadIds.push(success.target)
          if (paths) await this.recordProjectlessThread(success.target, paths)
          else if (root) threadRoots.set(success.target, root)
        }
        if (root && !paths) roots.add(root)
      }
      const selectedSessions = items.flatMap(item => item.details?.sessions ?? [])
      const failedSessions = done.itemTypeResults.filter(result => result.itemType === 'SESSIONS').flatMap(result => result.failures)
      if (!failedSessions.length && importedSessionThreadIds.length >= selectedSessions.length) for (const session of selectedSessions) if (session.workspaceKind !== 'projectless') roots.add(session.cwd)
      return { itemTypeResults: done.itemTypeResults, projectRoots: [...roots], importedSessionThreadIds, threadRoots }
  }
  private async completeLateImport(active: ActiveImport, done: { importId: string; itemTypeResults: ExternalAgentImportTypeResult[] }): Promise<void> {
    this.assertOpen()
    const imported = await this.applyNativeCompletion(active.nativePending!, done)
    const collected = active.collected!
    collected.results.push(...imported.itemTypeResults)
    for (const root of imported.projectRoots) collected.roots.add(root)
    for (const id of imported.importedSessionThreadIds) collected.threads.add(id)
    for (const [id, root] of imported.threadRoots) collected.threadRoots.set(id, root)
    if (active.progress.providerId && imported.itemTypeResults.some(result => result.successes.length)) collected.providers.add(active.progress.providerId)
    this.publish(active, { phase: 'finalizing', message: 'The server completed the import after the timeout.' })
    const importedProjectIds = await this.finalizeProjects([...collected.roots], collected.threadRoots, active.options.projectId)
    this.assertOpen()
    await this.rememberImportedPreferences(active)
    const result = { importedProjectIds, importedSessionThreadIds: [...collected.threads], projectRoots: [...collected.roots], itemTypeResults: collected.results, canceled: true }
    active.inFlight = false
    this.publish(active, { phase: 'completed', itemTypeResults: collected.results, result })
    this.emit('completed', result)
    if (this.active === active) this.active = null
  }
  private async rememberImportedPreferences(active: ActiveImport): Promise<void> {
    this.assertOpen()
    if (!active.collected?.providers.size) return
    this.profile.preferences.providers = [...new Set([...this.profile.preferences.providers, ...active.collected.providers])]
    if (this.profile.preferences.syncItemTypes == null && !this.profile.originalItemTypes.length) this.profile.originalItemTypes = [...new Set(active.options.items.map(item => item.itemType))]
    await this.save()
  }
  private async createProjectlessPaths(title: string | null): Promise<ProjectlessImportPaths> {
    this.assertOpen()
    const name = (title?.trim() || 'Imported chat').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'imported-chat'
    const workspaceRoot = join(this.homeDirectory, 'Documents', 'Codex', `${name}-${randomUUID().slice(0, 8)}`)
    const outputDirectory = join(workspaceRoot, 'outputs')
    const cwd = join(workspaceRoot, 'work')
    await mkdir(outputDirectory, { recursive: true })
    this.assertOpen()
    await mkdir(cwd, { recursive: true })
    return { cwd, workspaceRoot, outputDirectory }
  }
  private async recordProjectlessThread(threadId: string, paths: ProjectlessImportPaths): Promise<void> {
    this.assertOpen()
    this.profile.projectlessThreads[threadId] = paths
    await this.save()
  }
  private async finalizeProjects(roots: string[], threadRoots: Map<string, string>, projectId?: string): Promise<string[]> {
    this.assertOpen()
    if (!roots.length) return []
    const canonical = async (path: string): Promise<string> => realpath(path).catch(() => resolve(path))
    const existing: { id: string; roots: { path: string }[] }[] = []
    let cursor: string | undefined
    do {
      this.assertOpen()
      const page = await this.server.request<{ data: typeof existing; nextCursor?: string | null }>('project/list', cursor ? { cursor, limit: 100 } : { limit: 100 })
      this.assertOpen()
      existing.push(...page.data); cursor = page.nextCursor ?? undefined
    } while (cursor)
    const selected = projectId ? existing.find(project => project.id === projectId) : undefined
    if (projectId && !selected) return []
    const byCanonical = new Map<string, string>()
    for (const project of existing) for (const root of project.roots) byCanonical.set(await canonical(root.path), project.id)
    if (selected) {
      const selectedRoots = await Promise.all(selected.roots.map(root => canonical(root.path)))
      if (!(await Promise.all(roots.map(canonical))).some(root => selectedRoots.includes(root))) return []
      for (const root of selectedRoots) byCanonical.set(root, selected.id)
    }
    const rootProjects = new Map<string, string>()
    for (const root of roots) {
      const key = await canonical(root)
      this.assertOpen()
      let id = byCanonical.get(key)
      if (!id) {
        const result = await this.server.request<{ project: { id: string } }>('project/create', {
          idempotencyKey: `external-agent-import:${key}`, name: basename(root), roots: [{ path: resolve(root) }], metadata: { importedFromExternalAgent: 'true' }
        })
        this.assertOpen()
        await this.options.onTrustedResult?.('project/create', result)
        id = result.project.id; byCanonical.set(key, id)
      }
      rootProjects.set(root, id)
    }
    for (const [threadId, root] of threadRoots) {
      this.assertOpen()
      if (this.profile.projectlessThreads[threadId]) continue
      const result = await this.server.request<{ thread: { projectId?: string | null } }>('thread/read', { threadId, includeTurns: false })
      this.assertOpen()
      await this.options.onTrustedResult?.('thread/read', result)
      this.assertOpen()
      if (!result.thread.projectId && rootProjects.has(root)) await this.server.request('thread/metadata/update', { threadId, projectId: rootProjects.get(root)! })
    }
    return [...new Set(rootProjects.values())]
  }
  async readHistory(options: ExternalAgentImportReadOptions): Promise<ExternalAgentImportHistories> {
    this.assertLocal(options.hostId)
    const result = await this.server.request<ExternalAgentImportHistories>('externalAgentConfig/import/readHistories')
    const providers = options.providers == null ? null : new Set(options.providers)
    return { data: result.data.filter(history => !providers || providers.has(history.providerId as ExternalAgentProviderId)), connectors: result.connectors ?? [] }
  }
  async readStatus(options: ExternalAgentImportReadOptions): Promise<ExternalAgentImportStatus> {
    const { data } = await this.readHistory(options)
    const pending = this.active
    if (pending?.uncertain && pending.progress.importId) {
      const recorded = data.find(history => history.importId === pending.progress.importId)
      if (recorded && pending.nativePending && pending.collected) {
        pending.uncertain = false
        const grouped = new Map<ExternalAgentImportTypeResult['itemType'], ExternalAgentImportTypeResult>()
        const group = (itemType: ExternalAgentImportTypeResult['itemType']): ExternalAgentImportTypeResult => { let value = grouped.get(itemType); if (!value) { value = { itemType, successes: [], failures: [] }; grouped.set(itemType, value) } return value }
        for (const success of recorded.successes) group(success.itemType).successes.push(success)
        for (const failure of recorded.failures) group(failure.itemType).failures.push(failure)
        await this.completeLateImport(pending, { importId: recorded.importId, itemTypeResults: [...grouped.values()] })
      }
    }
    const successes = data.flatMap(history => history.successes.filter(success => success.itemType === 'SESSIONS' && success.target))
    return { importedSessionCount: new Set(successes.map(success => success.target)).size,
      latestImportedAtMs: data.length ? Math.max(...data.map(history => history.completedAtMs)) : null,
      ...(this.active ? { runningImport: { importAttemptId: this.active.options.importAttemptId, items: structuredClone(this.active.options.items), startedAtMs: this.active.startedAtMs, progress: structuredClone(this.active.progress) } } : {}) }
  }
  async readImportedConnectors(options: ExternalAgentImportReadOptions): Promise<{ connectors: ExternalAgentConnector[] }> {
    const native = await this.readHistory(options)
    const cowork = !options.providers || options.providers.includes('claude-cowork') ? await this.cowork.readConnectors() : []
    const map = new Map<string, ExternalAgentConnector>()
    for (const connector of [...native.connectors, ...cowork]) map.set(`${connector.source}:${connector.name}`, connector)
    return { connectors: [...map.values()] }
  }
  async getPreferences(): Promise<ExternalAgentImportPreferences> { await this.loaded; return structuredClone(this.profile.preferences) }
  async setSync(options: { syncEnabled: boolean; providers?: ExternalAgentProviderId[]; syncItemTypes?: ExternalAgentImportPreferences['syncItemTypes'] }): Promise<ExternalAgentImportPreferences> {
    await this.loaded
    this.assertOpen()
    this.syncGeneration++
    this.profile.preferences = { ...this.profile.preferences, ...options, providers: options.providers ? [...new Set(options.providers)] : this.profile.preferences.providers }
    await this.save()
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = null
    if (!options.syncEnabled && this.active?.options.importAttemptId.startsWith('sync-')) this.cancel(this.active.options.importAttemptId)
    if (options.syncEnabled) this.scheduleSync(1_000)
    return this.getPreferences()
  }
  private scheduleSync(delay: number): void {
    if (this.disposed || !this.profile.preferences.syncEnabled) return
    this.syncTimer = setTimeout(() => { this.syncTimer = null; void this.runSync().catch(error => { if (!this.disposed) this.emit('sync-error', error) }).finally(() => this.scheduleSync(this.options.syncIntervalMs ?? 60_000)) }, delay)
    this.syncTimer.unref?.()
  }
  async runSync(): Promise<void> {
    await this.loaded
    if (this.disposed || !this.profile.preferences.syncEnabled || this.active) return
    try {
      const generation = this.syncGeneration
      const preferences = this.profile.preferences
      const detected = await this.detect({ hostId: 'local', includeHome: true, providers: preferences.providers, sessionLimits: preferences.sessionLimits })
      if (generation !== this.syncGeneration || !this.profile.preferences.syncEnabled || this.disposed) return
      const types = preferences.syncItemTypes
      const items = detected.items.filter(item => types === 'all' || (types == null ? this.profile.originalItemTypes.includes(item.itemType) : types[item.itemType] === true || (types[item.itemType] === 'original' && this.profile.originalItemTypes.includes(item.itemType))))
      const failures = detected.providers.filter(provider => provider.status === 'error')
      if (!items.length && failures.length) throw new Error(failures.map(provider => `${provider.providerId}: ${provider.message}`).join('; '))
      if (items.length) await this.import({ hostId: 'local', importAttemptId: `sync-${randomUUID()}`, items })
      this.profile.preferences.lastSyncAtMs = Date.now(); this.profile.preferences.lastSyncError = null
    } catch (error) { if (this.disposed) return; this.profile.preferences.lastSyncError = error instanceof Error ? error.message : 'Sync failed' }
    if (this.disposed) return
    await this.save()
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.syncGeneration++
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = null
    this.server.removeListener('notification', this.notificationListener)
    if (this.active) this.cancel(this.active.options.importAttemptId)
    this.active?.cancelCompletionWait?.(this.disposedError())
    await this.cowork.dispose()
    await this.saveTail.catch(() => {})
  }
}

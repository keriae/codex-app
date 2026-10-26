import { describe, expect, it, vi } from 'vitest'
import type { ExternalAgentImportApi, ExternalAgentImportPreferences, ExternalAgentImportProgress, ExternalAgentImportResult, ExternalAgentMigrationItem } from '../../shared/api'
import { ImportController, isImportRunning } from './importController'

const preferences: ExternalAgentImportPreferences = { syncEnabled: false, syncItemTypes: null, providers: [], sessionLimits: { maxSessionAgeMs: 2592000000, maxSessionsPerSpace: 50 }, lastSyncAtMs: null, lastSyncError: null }
const item: ExternalAgentMigrationItem = { itemType: 'CONFIG', providerId: 'claude-code', cwd: null, description: 'Fixture configuration', details: null }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject }); return { promise, resolve, reject } }
function fixtureApi() {
  let listener: ((value: ExternalAgentImportProgress) => void) | undefined
  const api: ExternalAgentImportApi = {
    detect: vi.fn(async () => ({ items: [item], providers: [{ providerId: 'claude-code' as const, status: 'available' as const }], unsupportedProjects: [], connectors: [] })),
    import: vi.fn(async () => ({ importedProjectIds: [], importedSessionThreadIds: [], projectRoots: [], itemTypeResults: [], canceled: false })),
    cancel: vi.fn(async () => ({ stopRequested: true, inFlight: true })),
    readHistory: vi.fn(async () => ({ data: [], connectors: [] })),
    readStatus: vi.fn(async () => ({ importedSessionCount: 0, latestImportedAtMs: null })),
    readImportedConnectors: vi.fn(async () => ({ connectors: [] })),
    getPreferences: vi.fn(async () => preferences),
    setSync: vi.fn(async (options) => ({ ...preferences, ...options })),
    authenticateMcp: vi.fn(async () => ({ authorizationUrl: 'https://example.invalid' })),
    onProgress: vi.fn((callback) => { listener = callback; return () => { listener = undefined } })
  }
  return { api, emit: (progress: ExternalAgentImportProgress) => listener?.(progress) }
}

describe('native-backed import page controller', () => {
  it('renders detection without waiting for import history', async () => {
    const { api } = fixtureApi(); const history = deferred<Awaited<ReturnType<ExternalAgentImportApi['readHistory']>>>()
    api.readHistory = vi.fn(() => history.promise)
    const controller = new ImportController(api, ['/synthetic/project']); controller.attach()
    const read = controller.refresh()
    await vi.waitFor(() => expect(controller.getSnapshot().detection?.items).toEqual([item]))
    expect(controller.getSnapshot().loading.history).toBe(true)
    expect(controller.getSnapshot().loading.detection).toBe(false)
    expect(api.detect).toHaveBeenCalledWith({ hostId: 'local', includeHome: true, providers: ['claude-code', 'claude-cowork', 'cursor'], workspaceRoots: ['/synthetic/project'], sessionLimits: preferences.sessionLimits })
    history.resolve({ data: [], connectors: [] }); await read; controller.dispose()
  })

  it('loads Cowork connector candidates independently without hiding fast history', async () => {
    const { api } = fixtureApi(); const connectors = deferred<Awaited<ReturnType<ExternalAgentImportApi['readImportedConnectors']>>>()
    api.readImportedConnectors = vi.fn(() => connectors.promise)
    const controller = new ImportController(api, []); controller.attach(); const read = controller.refresh()
    await vi.waitFor(() => expect(controller.getSnapshot().loading.history).toBe(false))
    expect(controller.getSnapshot().loading.connectors).toBe(true)
    const native = { name: 'fixture-app', source: 'remoteMcpServersConfig' as const, sessionCount: 1 }
    const cowork = { ...native, codexAppId: 'fixture-canonical-app' }
    connectors.resolve({ connectors: [native, cowork] }); await read
    expect(controller.getSnapshot().connectors).toEqual([cowork])
    expect(api.readImportedConnectors).toHaveBeenCalledWith({ hostId: 'local', providers: ['claude-code', 'claude-cowork', 'cursor'] })
    controller.dispose()
  })

  it('does not invent completion while the native import promise is pending', async () => {
    const { api, emit } = fixtureApi(); const completion = deferred<ExternalAgentImportResult>()
    api.import = vi.fn(() => completion.promise)
    const controller = new ImportController(api, []); controller.attach(); await controller.refresh()
    const operation = controller.start([item]); const attempt = controller.getSnapshot().operation!.importAttemptId
    emit({ importAttemptId: 'other-attempt', phase: 'completed' })
    expect(controller.getSnapshot().operation!.progress.phase).toBe('starting')
    emit({ importAttemptId: attempt, phase: 'importing', providerId: 'claude-code', importId: 'native-id' })
    expect(controller.getSnapshot().operation!.progress.importId).toBe('native-id')
    await controller.cancel()
    expect(controller.getSnapshot().operation!.progress.phase).toBe('stopping')
    expect(isImportRunning(controller.getSnapshot().operation)).toBe(true)
    expect(controller.getSnapshot().operation!.result).toBeUndefined()
    completion.resolve({ importedProjectIds: [], importedSessionThreadIds: [], projectRoots: [], itemTypeResults: [], canceled: true })
    await operation
    expect(controller.getSnapshot().operation!.result?.canceled).toBe(true)
    expect(isImportRunning(controller.getSnapshot().operation)).toBe(false)
    controller.dispose()
  })

  it('preserves native partial failures and refreshes projects after a completed write', async () => {
    const { api } = fixtureApi(); const callback = vi.fn()
    const result: ExternalAgentImportResult = { importedProjectIds: ['project-a'], importedSessionThreadIds: ['thread-a'], projectRoots: ['/synthetic/project'], itemTypeResults: [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG', title: 'Example' }], failures: [{ itemType: 'CONFIG', failureStage: 'write', message: 'Fixture failure' }] }], canceled: false }
    api.import = vi.fn(async () => result)
    const controller = new ImportController(api, [], callback); controller.attach(); await controller.refresh(); await controller.start([item])
    expect(controller.getSnapshot().operation!.result).toEqual(result)
    expect(callback).toHaveBeenCalledWith(result)
    expect(api.readHistory).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('waits for its result after terminal progress and refreshes only once', async () => {
    const { api, emit } = fixtureApi(); const completion = deferred<ExternalAgentImportResult>()
    api.import = vi.fn(() => completion.promise)
    const controller = new ImportController(api, []); controller.attach(); await controller.refresh()
    const operation = controller.start([item]); const attempt = controller.getSnapshot().operation!.importAttemptId
    emit({ importAttemptId: attempt, phase: 'completed', itemTypeResults: [] })
    expect(isImportRunning(controller.getSnapshot().operation)).toBe(true)
    expect(controller.getSnapshot().operation!.result).toBeUndefined()
    expect(api.readHistory).toHaveBeenCalledTimes(1)
    completion.resolve({ importedProjectIds: [], importedSessionThreadIds: [], projectRoots: [], itemTypeResults: [], canceled: false })
    await operation
    expect(api.readHistory).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().operation!.result).toBeDefined()
    controller.dispose()
  })

  it('refreshes catalogs for actual projects imported before a stop request completed', async () => {
    const { api } = fixtureApi(); const callback = vi.fn()
    const result: ExternalAgentImportResult = { importedProjectIds: ['project-a'], importedSessionThreadIds: [], projectRoots: ['/synthetic/project'], itemTypeResults: [], canceled: true }
    api.import = vi.fn(async () => result)
    const controller = new ImportController(api, [], callback); controller.attach(); await controller.refresh(); await controller.start([item])
    expect(callback).toHaveBeenCalledWith(result)
    controller.dispose()
  })

  it('keeps previous sync preferences when a native write fails', async () => {
    const { api } = fixtureApi(); api.setSync = vi.fn(async () => { throw new Error('Fixture save failure') })
    const controller = new ImportController(api, []); controller.attach(); await controller.refresh()
    expect(await controller.setSync(true, { SKILLS: true })).toBe(false)
    expect(controller.getSnapshot().preferences?.syncEnabled).toBe(false)
    expect(controller.getSnapshot().errors.sync).toBe('Fixture save failure')
    expect(controller.getSnapshot().savingSync).toBe(false)
    controller.dispose()
  })

  it('ignores stale read results after leaving the page', async () => {
    const { api } = fixtureApi(); const detection = deferred<Awaited<ReturnType<ExternalAgentImportApi['detect']>>>()
    api.detect = vi.fn(() => detection.promise)
    const controller = new ImportController(api, []); controller.attach(); const read = controller.refresh()
    await vi.waitFor(() => expect(api.detect).toHaveBeenCalled())
    controller.dispose(); const snapshot = controller.getSnapshot()
    detection.resolve({ items: [], unsupportedProjects: [], providers: [], connectors: [] }); await read
    expect(controller.getSnapshot()).toBe(snapshot)
  })

  it('recovers a real in-progress import returned by native status after navigation', async () => {
    const { api } = fixtureApi()
    api.readStatus = vi.fn(async () => ({ importedSessionCount: 0, latestImportedAtMs: null, runningImport: { importAttemptId: 'running-id', items: [item], startedAtMs: 100, progress: { importAttemptId: 'running-id', phase: 'importing' as const } } }))
    const controller = new ImportController(api, []); controller.attach(); await controller.refresh()
    expect(isImportRunning(controller.getSnapshot().operation)).toBe(true)
    await controller.start([item]); expect(api.import).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('uses trusted late completion and invokes catalog completion only once', async () => {
    const { api, emit } = fixtureApi(); const callback = vi.fn(); const completion = deferred<ExternalAgentImportResult>()
    api.import = vi.fn(() => completion.promise)
    const result: ExternalAgentImportResult = { importedProjectIds: ['project-a'], importedSessionThreadIds: [], projectRoots: ['/synthetic/project'], itemTypeResults: [], canceled: false }
    const controller = new ImportController(api, [], callback); controller.attach(); await controller.refresh()
    const operation = controller.start([item]); const attempt = controller.getSnapshot().operation!.importAttemptId
    emit({ importAttemptId: attempt, phase: 'completed', result })
    expect(controller.getSnapshot().operation!.result).toEqual(result)
    expect(callback).toHaveBeenCalledTimes(1)
    completion.resolve(result); await operation
    expect(callback).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('replaces an earlier completed import with a different active native attempt', async () => {
    const { api } = fixtureApi()
    const controller = new ImportController(api, []); controller.attach(); await controller.refresh(); await controller.start([item])
    const earlier = controller.getSnapshot().operation!.importAttemptId
    const running = { importAttemptId: 'sync-new-attempt', items: [item], startedAtMs: Date.now(), progress: { importAttemptId: 'sync-new-attempt', phase: 'importing' as const } }
    api.readStatus = vi.fn(async () => ({ importedSessionCount: 0, latestImportedAtMs: null, runningImport: running }))
    await controller.refresh()
    expect(controller.getSnapshot().operation?.importAttemptId).not.toBe(earlier)
    expect(controller.getSnapshot().operation).toEqual(running)
    expect(isImportRunning(controller.getSnapshot().operation)).toBe(true)
    await controller.start([item]); expect(api.import).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not overwrite trusted terminal completion with an older caller timeout rejection', async () => {
    const { api, emit } = fixtureApi(); const callback = vi.fn(); const completion = deferred<ExternalAgentImportResult>()
    api.import = vi.fn(() => completion.promise)
    const result: ExternalAgentImportResult = { importedProjectIds: ['project-a'], importedSessionThreadIds: [], projectRoots: ['/synthetic/project'], itemTypeResults: [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG', title: 'Fixture completed' }], failures: [] }], canceled: false }
    const controller = new ImportController(api, [], callback); controller.attach(); await controller.refresh()
    const operation = controller.start([item]); const attempt = controller.getSnapshot().operation!.importAttemptId
    emit({ importAttemptId: attempt, phase: 'completed', result, itemTypeResults: result.itemTypeResults })
    completion.reject(new Error('Fixture caller timeout; server outcome was initially uncertain')); await operation
    expect(controller.getSnapshot().operation?.result).toEqual(result)
    expect(controller.getSnapshot().operation?.error).toBeUndefined()
    expect(controller.getSnapshot().operation?.progress.phase).toBe('completed')
    expect(callback).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})

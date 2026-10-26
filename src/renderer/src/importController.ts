import type { ExternalAgentConnector, ExternalAgentDetection, ExternalAgentImportApi, ExternalAgentImportHistories, ExternalAgentImportPreferences, ExternalAgentImportProgress, ExternalAgentImportResult, ExternalAgentImportStatus, ExternalAgentMigrationItem, ExternalAgentProviderId } from '../../shared/api'
import { IMPORT_PROVIDERS } from './importModels'
import { sanitizeIntegrationDiagnostic } from './integrationModels'

type ImportRead = 'detection' | 'history' | 'preferences' | 'status' | 'connectors'
export interface ImportOperation {
  importAttemptId: string
  items: ExternalAgentMigrationItem[]
  startedAtMs: number
  progress: ExternalAgentImportProgress
  result?: ExternalAgentImportResult
  error?: string
}
export interface ImportState {
  detection: ExternalAgentDetection | null
  history: ExternalAgentImportHistories | null
  connectors: ExternalAgentConnector[] | null
  preferences: ExternalAgentImportPreferences | null
  status: ExternalAgentImportStatus | null
  loading: Record<ImportRead, boolean>
  errors: Partial<Record<ImportRead | 'sync' | 'cancel', string>>
  operation: ImportOperation | null
  savingSync: boolean
}
export const INITIAL_IMPORT_STATE: ImportState = { detection: null, history: null, connectors: null, preferences: null, status: null, loading: { detection: false, history: false, preferences: false, status: false, connectors: false }, errors: {}, operation: null, savingSync: false }
export function importError(error: unknown): string { return sanitizeIntegrationDiagnostic(error instanceof Error ? error.message : String(error)) }
export function isImportRunning(operation: ImportOperation | null): boolean { return Boolean(operation && !operation.result && !operation.error && !['completed', 'failed'].includes(operation.progress.phase)) }

/** Page state follows native completion; changing routes does not cancel imports. */
export class ImportController {
  private state: ImportState = INITIAL_IMPORT_STATE
  private listeners = new Set<() => void>()
  private generation = 0
  private disposed = false
  private pendingAttempt: string | null = null
  private completedAttempts = new Set<string>()
  private unsubscribeProgress?: () => void
  constructor(private readonly api: ExternalAgentImportApi, private readonly workspaceRoots: string[], private readonly onImportCompleted?: (result: ExternalAgentImportResult) => void) {}
  getSnapshot = (): ImportState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(change: Partial<ImportState>): void { if (this.disposed) return; this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()) }
  private reportCompletion(importAttemptId: string, result: ExternalAgentImportResult): void {
    if (this.completedAttempts.has(importAttemptId)) return
    this.completedAttempts.add(importAttemptId)
    if (result.importedProjectIds.length || result.projectRoots.length || result.importedSessionThreadIds.length) this.onImportCompleted?.(result)
  }
  attach(): void {
    this.disposed = false
    this.unsubscribeProgress = this.api.onProgress((progress) => {
      const operation = this.state.operation
      if (!operation || operation.importAttemptId !== progress.importAttemptId || operation.result || operation.error && !progress.result) return
      const awaitingResult = this.pendingAttempt === progress.importAttemptId
      this.update({ operation: { ...operation, ...(progress.result ? { result: progress.result, error: undefined } : {}), progress: awaitingResult && progress.phase === 'completed' && !progress.result ? { ...progress, phase: 'finalizing' } : progress } })
      if (progress.result) this.reportCompletion(progress.importAttemptId, progress.result)
      if (!awaitingResult && ['completed', 'failed'].includes(progress.phase)) void this.refresh()
    })
  }
  dispose(): void { this.disposed = true; this.generation++; this.unsubscribeProgress?.(); this.unsubscribeProgress = undefined }

  async refresh(): Promise<void> {
    const current = ++this.generation
    const isCurrent = (): boolean => !this.disposed && current === this.generation
    this.update({ loading: { detection: true, preferences: true, history: true, status: true, connectors: true }, errors: {} })
    const settle = async <T>(section: ImportRead, read: () => Promise<T>, apply: (value: T) => void): Promise<T | null> => {
      try { const value = await read(); if (isCurrent()) apply(value); return value }
      catch (error) { if (isCurrent()) this.update({ errors: { ...this.state.errors, [section]: importError(error) } }); return null }
      finally { if (isCurrent()) this.update({ loading: { ...this.state.loading, [section]: false } }) }
    }
    const preferences = settle('preferences', () => this.api.getPreferences(), (value) => this.update({ preferences: value }))
    const history = settle('history', () => this.api.readHistory({ hostId: 'local', providers: IMPORT_PROVIDERS }), (value) => this.update({ history: value }))
    const connectors = settle('connectors', () => this.api.readImportedConnectors({ hostId: 'local', providers: IMPORT_PROVIDERS }), (value) => this.update({ connectors: [...new Map(value.connectors.map((connector) => [`${connector.source}:${connector.name}`, connector])).values()] }))
    const status = settle('status', () => this.api.readStatus({ hostId: 'local', providers: IMPORT_PROVIDERS }), (value) => {
      const running = value.runningImport
      this.update({ status: value, ...(running && (running.importAttemptId !== this.state.operation?.importAttemptId || !this.state.operation?.result) ? { operation: running } : {}) })
    })
    const detection = (async () => {
      const preference = await preferences
      if (!isCurrent()) return
      await settle('detection', () => this.api.detect({ hostId: 'local', includeHome: true, providers: IMPORT_PROVIDERS, sessionLimits: preference?.sessionLimits, ...(this.workspaceRoots.length ? { workspaceRoots: this.workspaceRoots } : {}) }), (value) => this.update({ detection: value }))
    })()
    await Promise.all([preferences, history, status, detection, connectors])
  }

  async start(items: ExternalAgentMigrationItem[]): Promise<void> {
    if (this.pendingAttempt || isImportRunning(this.state.operation) || !items.length || this.disposed) return
    const importAttemptId = crypto.randomUUID()
    this.pendingAttempt = importAttemptId
    const operation: ImportOperation = { importAttemptId, items, startedAtMs: Date.now(), progress: { importAttemptId, phase: 'starting' } }
    this.update({ operation, errors: { ...this.state.errors, cancel: undefined } })
    try {
      const result = await this.api.import({ hostId: 'local', importAttemptId, items, sessionLimits: this.state.preferences?.sessionLimits })
      if (!this.disposed && this.state.operation?.importAttemptId === importAttemptId) this.update({ operation: { ...this.state.operation, result, progress: { ...this.state.operation.progress, phase: 'completed' } } })
      this.pendingAttempt = null
      this.reportCompletion(importAttemptId, result)
      if (!this.disposed) await this.refresh()
    } catch (error) {
      this.pendingAttempt = null
      if (!this.disposed && this.state.operation?.importAttemptId === importAttemptId && !this.state.operation.result) this.update({ operation: { ...this.state.operation, error: importError(error), progress: { ...this.state.operation.progress, phase: 'failed' } } })
      if (!this.disposed) await this.refresh()
    }
  }

  async cancel(): Promise<void> {
    const operation = this.state.operation
    if (!isImportRunning(operation) || !operation) return
    try {
      const result = await this.api.cancel(operation.importAttemptId)
      if (result.stopRequested && this.state.operation?.importAttemptId === operation.importAttemptId) this.update({ operation: { ...this.state.operation, progress: { ...this.state.operation.progress, phase: 'stopping' } } })
    } catch (error) { this.update({ errors: { ...this.state.errors, cancel: importError(error) } }) }
  }

  async setSync(syncEnabled: boolean, syncItemTypes?: ExternalAgentImportPreferences['syncItemTypes'], providers?: ExternalAgentProviderId[]): Promise<boolean> {
    if (this.state.savingSync) return false
    this.update({ savingSync: true, errors: { ...this.state.errors, sync: undefined } })
    try {
      const value = await this.api.setSync({ syncEnabled, ...(syncItemTypes !== undefined ? { syncItemTypes } : {}), ...(providers ? { providers } : {}) })
      this.update({ preferences: value }); return true
    } catch (error) { this.update({ errors: { ...this.state.errors, sync: importError(error) } }); return false }
    finally { this.update({ savingSync: false }) }
  }
}

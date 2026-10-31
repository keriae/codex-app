export type RpcId = number | string
export type JsonMap = Record<string, unknown>
export type AppCommand = 'new-chat' | 'toggle-sidebar' | 'focus-search' | 'show-settings'

export type BackendState = 'starting' | 'ready' | 'stopped' | 'error'
export type BackendMode = 'daemon' | 'direct'
export type HostId = 'local' | string

export interface BackendStatus {
  state: BackendState
  mode: BackendMode
  message?: string
}

export type RemoteConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error'

export interface RemoteConnection {
  hostId: string
  displayName: string
  host: string
  sshAlias?: string
  port?: number
  identityFile?: string
  state: RemoteConnectionState
  message?: string
}

export interface SaveRemoteConnectionOptions {
  hostId?: string
  /** SSH config alias. When omitted, host/port/identityFile are passed directly to ssh. */
  sshAlias?: string
  host?: string
  /** Null explicitly clears a previously saved direct-host port. */
  port?: number | null
  identityFile?: string
  displayName?: string
}

export interface DiscoveredSshConnection {
  displayName: string
  sshAlias: string
  host: string
  port?: number
  identityFile?: string
}

export interface ActiveHostInvalidated {
  hostId: string
  reason: 'disconnected' | 'deleted'
}

export interface RemoteProject {
  id: string
  hostId: string
  label: string
  remotePath: string
}

export interface CreateRemoteProjectOptions {
  hostId: string
  label?: string
  remotePath: string
}

export interface RemotePathValidation {
  requestedPath: string
  path: string | null
  exists: boolean
  isDirectory: boolean
}

export interface RemoteDirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface RemoteDirectoryListing {
  path: string
  parentPath: string | null
  entries: RemoteDirectoryEntry[]
}

export interface DesktopPreferences {
  /** Optional for compatibility with replica profiles saved before theme syncing. */
  appearance?: 'system' | 'light' | 'dark'
  permissionNotifications: boolean
  questionNotifications: boolean
  dotNotifications: boolean
  turnCompletionNotifications: 'always' | 'unfocused' | 'never'
  preventSleepWhileRunning: boolean
  /** Optional for compatibility with replica profiles saved before this setting. */
  closeWindowConfirmation?: 'shortcut' | 'always' | 'never'
}

export type ScheduledTaskStatus = 'active' | 'paused' | 'completed'
export type ScheduledTaskFrequency = 'daily' | 'weekdays' | 'weekly' | 'custom'
export type ScheduledTaskCustomUnit = 'day' | 'week' | 'month'

/**
 * Persisted scheduling data owned by the replica main process.  Weekdays use
 * JavaScript's local-calendar numbering (Sunday = 0, Monday = 1, … Saturday =
 * 6), which keeps renderer labels independent from the scheduler.
 */
export interface ScheduledTaskDefinition {
  id: string
  title: string
  prompt: string
  frequency: ScheduledTaskFrequency
  /** Local wall-clock time in 24-hour HH:mm form. */
  time: string
  status: ScheduledTaskStatus
  notification: 'important' | 'failed'
  newChatEachRun: boolean
  model: string
  effort: string
  /** Custom schedules repeat every N calendar units from the task's anchor. */
  customUnit?: ScheduledTaskCustomUnit
  customInterval?: number
  /** Renderer numbering: Monday = 1, … Sunday = 7. */
  customWeekdays?: number[]
  /** Optional execution context captured when the task is created. */
  cwd?: string
  hostId?: HostId
  createdAt: number
  updatedAt: number
  lastRunAt?: number | null
  nextRunAt?: number | null
  /** Reused only when newChatEachRun is disabled. */
  lastThreadId?: string
}

export interface ScheduledTaskRunRequest {
  runId: string
  taskId: string
  title: string
  prompt: string
  notification: ScheduledTaskDefinition['notification']
  newChatEachRun: boolean
  model: string
  effort: string
  origin: 'scheduled' | 'manual'
  cwd?: string
  hostId?: HostId
  threadId?: string
  scheduledFor: number
  createdAt: number
}

export type WindowCloseOrigin = 'shortcut' | 'window'

export interface WindowCloseRequest {
  id: string
  origin: WindowCloseOrigin
}

export interface WindowCloseResponse {
  confirmed: boolean
  doNotAskAgain?: boolean
}

export interface OpenThreadRequest {
  id: string
  threadId: string
  /** Omitted routes target the local app-server for profile compatibility. */
  hostId?: HostId
}

export interface TerminalSize {
  cols: number
  rows: number
}

export interface TerminalOpenOptions extends TerminalSize {
  cwd: string
}

export interface TerminalSession {
  id: string
}

export type TerminalEvent =
  | { id: string; type: 'output'; data: string }
  | { id: string; type: 'exit'; exitCode: number | null }
  | { id: string; type: 'error'; message: string }

export interface BrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserFindResult {
  requestId: number
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}
export type BrowserShortcut = 'address' | 'find' | 'find-next' | 'find-previous' | 'close-tab' | 'new-tab'

export interface BrowserViewState {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoomFactor?: number
  error: string | null
}

export interface BrowserTopSite {
  url: string
  title: string
  visitCount: number
  lastVisitTime: number
}

export type BrowserViewEvent =
  | { type: 'state'; state: BrowserViewState }
  | { type: 'find-result'; id: string; result: BrowserFindResult }
  | { type: 'shortcut'; id: string; shortcut: BrowserShortcut }
  | { type: 'open-new-tab'; sourceId: string; url: string }

export interface AppContext {
  cwd: string
  folderName: string
  branch: string | null
  platform: 'darwin'
  initialCwdSource?: 'argument' | 'environment' | 'process' | 'home'
  hostId?: HostId
  hostDisplayName?: string
  projectKind?: 'local' | 'remote' | 'projectless'
  projectId?: string | null
}

export interface AppInfo {
  implementationVersion: string
  targetVersion: string
  targetBuild: string
  targetAppServerVersion: string
}

export interface GitDirtySummary {
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  total: number
}

export interface GitWorktreeMetadata {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
  current: boolean
}

export type GitMetadataFailure =
  | 'invalid-path'
  | 'not-directory'
  | 'not-repository'
  | 'timeout'
  | 'git-unavailable'
  | 'unavailable'

export interface GitRepositoryMetadata {
  requestedPath: string
  isRepository: true
  root: string
  branch: string | null
  head: string | null
  detached: boolean
  dirty: GitDirtySummary | null
  remotes: string[]
  remoteCount: number
  remoteNamesRedacted: boolean
  worktrees: GitWorktreeMetadata[]
}

export interface GitUnavailableMetadata {
  requestedPath: string
  isRepository: false
  reason: GitMetadataFailure
}

export type GitMetadata = GitRepositoryMetadata | GitUnavailableMetadata

export interface GitMetadataOptions {
  redactRemoteNames?: boolean
}

export interface GitBranches {
  currentBranch: string | null
  /** A cached remote-qualified ref such as origin/main; null when unknown. */
  defaultBranch: string | null
  localBranches: string[]
  remoteBranches: string[]
}

export interface ManagedWorktreeCreateOptions {
  cwd: string
  name?: string
  startingState?:
    | { type: 'branch'; branchName: string }
    | { type: 'working-tree' }
}

export interface ForkThreadInNewWorktreeOptions {
  threadId: string
  cwd: string
  startingState?: ManagedWorktreeCreateOptions['startingState']
}

export interface ManagedWorktree {
  id: string
  worktreeGitRoot: string
  worktreeWorkspaceRoot: string
  sourceRepositoryRoot: string
  createdAt: number
  head: string | null
  branch: string | null
  detached: boolean
  ownerThreadId: null
  setupError: null
}

export interface ForkThreadInNewWorktreeResult<Thread = unknown> {
  thread: Thread
  worktree: ManagedWorktree
}

export type ComposerAttachmentKind = 'file' | 'image'

export interface ComposerAttachmentSelection {
  kind: ComposerAttachmentKind
  name: string
  /** Native filesystem path. Directory mention paths add a trailing separator. */
  fsPath?: string
  path: string
}

export interface WorkspacePathRequest {
  root: string
  path: string
}

export interface WorkspaceWatchRequest {
  root: string
  directories: string[]
  files: string[]
}
export interface WorkspaceFilesChanged extends WorkspaceWatchRequest { id: string }
export type WorkspaceOpenTargetId = 'finder' | 'terminal' | 'vscode' | 'cursor' | 'zed' | 'windsurf'
export interface WorkspaceOpenTarget { id: WorkspaceOpenTargetId; label: string; iconDataUrl?: string }
export interface WorkspaceSaveCopyRequest extends WorkspacePathRequest { text?: string }

export interface WorkspaceDirectoryEntry {
  fileName: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface WorkspaceDirectoryResult {
  path: string
  entries: WorkspaceDirectoryEntry[]
  truncated: boolean
}

export interface WorkspaceTextFileResult {
  path: string
  kind: 'text'
  mimeType: string
  text: string
  sizeBytes: number
}

export interface WorkspaceImageFileResult {
  path: string
  kind: 'image'
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
  sizeBytes: number
}

export type WorkspaceFileResult = WorkspaceTextFileResult | WorkspaceImageFileResult

export interface WorkspaceFileSaveRequest extends WorkspacePathRequest {
  text: string
  expectedText: string
}

export interface WorkspaceFileSaveResult {
  outcome: 'saved' | 'conflict'
  file: WorkspaceTextFileResult
}

export interface ThreadImageResult {
  path: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
  sizeBytes: number
}

export interface RpcNotification {
  method: string
  params?: unknown
  emittedAtMs?: number
  hostId?: HostId
}

export interface RpcServerRequest {
  id: RpcId
  method: string
  params?: unknown
  hostId?: HostId
  desktopContext?: {
    ephemeralThread?: boolean
  }
}

export interface RpcServerResponse {
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type ExternalAgentProviderId = 'claude-code' | 'cursor' | 'claude-cowork'
export type ExternalAgentMigrationItemType = 'AGENTS_MD' | 'CONFIG' | 'SKILLS' | 'PLUGINS' | 'MCP_SERVER_CONFIG' | 'SUBAGENTS' | 'HOOKS' | 'COMMANDS' | 'MEMORY' | 'SESSIONS'
export interface ExternalAgentSessionMigration {
  cwd: string
  path: string
  title: string | null
  workspaceKind?: 'projectless'
}
export interface ExternalAgentMigrationDetails {
  commands: { name: string }[]
  hooks: { name: string }[]
  mcpServers: { name: string }[]
  plugins: { marketplaceName: string; pluginNames: string[] }[]
  skills: { name: string }[]
  subagents: { name: string }[]
  memory: string[]
  sessions: ExternalAgentSessionMigration[]
}
export interface ExternalAgentMigrationItem {
  providerId: ExternalAgentProviderId
  cwd: string | null
  description: string
  details: ExternalAgentMigrationDetails | null
  itemType: ExternalAgentMigrationItemType
  /** Cowork account/org setup source; native server items omit this field. */
  sourcePath?: string
}
export interface ExternalAgentSessionLimits {
  maxSessionAgeMs: number
  maxSessionsPerSpace: number
}
export interface ExternalAgentDetectOptions {
  hostId: 'local'
  includeHome?: boolean
  providers: ExternalAgentProviderId[]
  sessionLimits?: Partial<ExternalAgentSessionLimits>
  workspaceRoots?: string[]
}
export interface ExternalAgentConnector {
  name: string
  sessionCount: number
  source: 'remoteMcpServersConfig' | 'sessionToolUse'
  codexAppId?: string | null
  importedAtMs?: number
}
export interface ExternalAgentDetection {
  items: ExternalAgentMigrationItem[]
  unsupportedProjects: { name: string; reason: string; sourceFolders: string[]; spaceId?: string; spaceConfigPath?: string }[]
  providers: { providerId: ExternalAgentProviderId; status: 'available' | 'unavailable' | 'error'; message?: string; warnings?: string[] }[]
  connectors: ExternalAgentConnector[]
}
export interface ExternalAgentImportSuccess {
  itemType: ExternalAgentMigrationItemType
  cwd?: string | null
  source?: string | null
  target?: string | null
  title?: string | null
}
export interface ExternalAgentImportFailure {
  itemType: ExternalAgentMigrationItemType
  cwd?: string | null
  source?: string | null
  failureStage: string
  message: string
  errorType?: string | null
  subErrorType?: string | null
}
export interface ExternalAgentImportTypeResult {
  itemType: ExternalAgentMigrationItemType
  successes: ExternalAgentImportSuccess[]
  failures: ExternalAgentImportFailure[]
}
export interface ExternalAgentImportOptions {
  hostId: 'local'
  importAttemptId: string
  items: ExternalAgentMigrationItem[]
  projectId?: string
  sessionLimits?: Partial<ExternalAgentSessionLimits>
}
export interface ExternalAgentImportResult {
  importedProjectIds: string[]
  importedSessionThreadIds: string[]
  projectRoots: string[]
  itemTypeResults: ExternalAgentImportTypeResult[]
  canceled: boolean
}
export interface ExternalAgentImportProgress {
  importAttemptId: string
  providerId?: ExternalAgentProviderId
  importId?: string
  phase: 'starting' | 'importing' | 'stopping' | 'finalizing' | 'completed' | 'failed'
  itemTypeResults?: ExternalAgentImportTypeResult[]
  message?: string
  /** Final result also reaches listeners when completion follows a caller timeout. */
  result?: ExternalAgentImportResult
}
export interface ExternalAgentImportHistory {
  completedAtMs: number
  importId: string
  providerId: string | null
  successes: ExternalAgentImportSuccess[]
  failures: ExternalAgentImportFailure[]
}
export interface ExternalAgentImportReadOptions { hostId: 'local'; providers?: ExternalAgentProviderId[] }
export interface ExternalAgentImportHistories { data: ExternalAgentImportHistory[]; connectors: ExternalAgentConnector[] }
export interface ExternalAgentImportStatus {
  importedSessionCount: number
  latestImportedAtMs: number | null
  runningImport?: { importAttemptId: string; items: ExternalAgentMigrationItem[]; startedAtMs: number; progress: ExternalAgentImportProgress }
}
export interface ExternalAgentImportPreferences {
  syncEnabled: boolean
  providers: ExternalAgentProviderId[]
  sessionLimits: ExternalAgentSessionLimits
  lastSyncAtMs: number | null
  lastSyncError: string | null
  syncItemTypes: null | 'all' | Partial<Record<ExternalAgentMigrationItemType, boolean | 'original'>>
}
export interface ExternalAgentImportApi {
  detect(options: ExternalAgentDetectOptions): Promise<ExternalAgentDetection>
  import(options: ExternalAgentImportOptions): Promise<ExternalAgentImportResult>
  cancel(importAttemptId: string): Promise<{ stopRequested: boolean; inFlight: boolean }>
  readHistory(options: ExternalAgentImportReadOptions): Promise<ExternalAgentImportHistories>
  readStatus(options: ExternalAgentImportReadOptions): Promise<ExternalAgentImportStatus>
  readImportedConnectors(options: ExternalAgentImportReadOptions): Promise<{ connectors: ExternalAgentConnector[] }>
  getPreferences(): Promise<ExternalAgentImportPreferences>
  setSync(options: { syncEnabled: boolean; providers?: ExternalAgentProviderId[]; syncItemTypes?: ExternalAgentImportPreferences['syncItemTypes'] }): Promise<ExternalAgentImportPreferences>
  authenticateMcp(name: string): Promise<{ authorizationUrl: string }>
  onProgress(listener: (progress: ExternalAgentImportProgress) => void): () => void
}

export interface WorkspaceTextDiffOptions {
  ignoreWhitespace: boolean
}

export interface CodexDesktopApi {
  externalAgentImport: ExternalAgentImportApi
  invoke<T = unknown>(method: string, params?: JsonMap, hostId?: HostId): Promise<T>
  getBackendStatus(hostId?: HostId): Promise<BackendStatus>
  restartBackend(hostId?: HostId): Promise<void>
  setActiveHost(hostId: HostId): Promise<void>
  getAppContext(cwd?: string): Promise<AppContext>
  discoverSshConnections(): Promise<DiscoveredSshConnection[]>
  listRemoteConnections(): Promise<RemoteConnection[]>
  saveRemoteConnection(options: SaveRemoteConnectionOptions): Promise<RemoteConnection>
  deleteRemoteConnection(hostId: string): Promise<void>
  connectRemoteConnection(hostId: string): Promise<RemoteConnection>
  disconnectRemoteConnection(hostId: string): Promise<RemoteConnection>
  listRemoteProjects(): Promise<RemoteProject[]>
  createRemoteProject(options: CreateRemoteProjectOptions): Promise<RemoteProject>
  deleteRemoteProject(id: string): Promise<void>
  validateRemotePath(hostId: string, path: string): Promise<RemotePathValidation>
  createRemoteDirectory(hostId: string, path: string): Promise<RemotePathValidation>
  listRemoteDirectory(hostId: string, path?: string): Promise<RemoteDirectoryListing>
  getRemoteAppContext(hostId: string, cwd: string, projectId?: string): Promise<AppContext>
  getAppInfo(): Promise<AppInfo>
  getDesktopPreferences(): Promise<DesktopPreferences>
  updateDesktopPreferences(preferences: DesktopPreferences): Promise<void>
  listScheduledTasks(): Promise<ScheduledTaskDefinition[]>
  saveScheduledTask(task: ScheduledTaskDefinition): Promise<ScheduledTaskDefinition>
  deleteScheduledTask(id: string): Promise<void>
  setScheduledTaskStatus(id: string, status: ScheduledTaskStatus): Promise<ScheduledTaskDefinition>
  runScheduledTaskNow(id: string): Promise<ScheduledTaskRunRequest>
  listPendingScheduledTaskRuns(): Promise<ScheduledTaskRunRequest[]>
  bindScheduledTaskRunThread(runId: string, threadId: string): Promise<ScheduledTaskRunRequest>
  acknowledgeScheduledTaskRun(runId: string, threadId?: string): Promise<void>
  requestWindowClose(origin: WindowCloseOrigin): Promise<void>
  respondToWindowCloseRequest(id: string, response: WindowCloseResponse): Promise<void>
  getWindowZoom(): Promise<number>
  setWindowZoom(factor: number): Promise<void>
  acknowledgeOpenThread(id: string): Promise<void>
  openTerminal(options: TerminalOpenOptions): Promise<TerminalSession>
  writeTerminal(id: string, data: string): Promise<void>
  resizeTerminal(id: string, size: TerminalSize): Promise<void>
  closeTerminal(id: string): Promise<void>
  createBrowserView(id: string): Promise<BrowserViewState>
  navigateBrowserView(id: string, url: string): Promise<void>
  goBackBrowserView(id: string): Promise<void>
  goForwardBrowserView(id: string): Promise<void>
  reloadBrowserView(id: string): Promise<void>
  stopBrowserView(id: string): Promise<void>
  findBrowserView(id: string, query: string, options: { forward: boolean; findNext: boolean }): Promise<number>
  stopFindingBrowserView(id: string): Promise<void>
  setBrowserViewZoom(id: string, factor: number): Promise<void>
  setBrowserViewBounds(id: string, bounds: BrowserViewBounds): Promise<void>
  setBrowserViewActive(id: string, active: boolean): Promise<void>
  closeBrowserView(id: string): Promise<void>
  listBrowserTopSites(): Promise<BrowserTopSite[]>
  dismissBrowserTopSite(url: string): Promise<BrowserTopSite[]>
  restoreBrowserTopSite(url: string): Promise<BrowserTopSite[]>
  getGitMetadata(cwd: string, options?: GitMetadataOptions): Promise<GitMetadata>
  listGitBranches(cwd: string): Promise<GitBranches>
  createManagedWorktree(options: ManagedWorktreeCreateOptions): Promise<ManagedWorktree>
  listManagedWorktrees(cwd: string): Promise<ManagedWorktree[]>
  forkThreadInNewWorktree<Thread = unknown>(
    options: ForkThreadInNewWorktreeOptions
  ): Promise<ForkThreadInNewWorktreeResult<Thread>>
  openThreadInNewWindow(threadId: string, hostId?: HostId): Promise<void>
  readWorkspaceDirectory(cwd: string, path: string): Promise<WorkspaceDirectoryResult>
  readWorkspaceFile(cwd: string, path: string): Promise<WorkspaceFileResult>
  diffWorkspaceText(before: string, after: string, options: WorkspaceTextDiffOptions): Promise<string>
  saveWorkspaceFile(cwd: string, path: string, text: string, expectedText: string): Promise<WorkspaceFileSaveResult>
  watchWorkspacePaths(root: string, directories: string[], files: string[]): Promise<string>
  unwatchWorkspacePaths(id: string): Promise<void>
  listWorkspaceOpenTargets(): Promise<WorkspaceOpenTarget[]>
  openWorkspacePath(root: string, path: string, target: WorkspaceOpenTargetId): Promise<void>
  saveWorkspaceFileCopy(root: string, path: string, text?: string): Promise<{ path: string | null }>
  readThreadImage(path: string): Promise<ThreadImageResult>
  copyThreadImage(path: string): Promise<void>
  copyInlineImage(source: string): Promise<void>
  copyText(text: string): Promise<void>
  pickDirectory(): Promise<AppContext | null>
  pickComposerAttachments(): Promise<ComposerAttachmentSelection[]>
  openWorkingDirectory(cwd: string, target: 'finder' | 'terminal'): Promise<void>
  openAuthenticationUrl(url: string): Promise<void>
  openExternal(url: string): Promise<void>
  listPendingServerRequests(hostId?: HostId): Promise<RpcServerRequest[]>
  respondToServerRequest(id: RpcId, response: RpcServerResponse, hostId?: HostId): Promise<void>
  onAppCommand(listener: (command: AppCommand) => void): () => void
  onDesktopPreferencesChanged(listener: (preferences: DesktopPreferences) => void): () => void
  onScheduledTasksChanged(listener: (tasks: ScheduledTaskDefinition[]) => void): () => void
  onScheduledTaskRun(listener: (run: ScheduledTaskRunRequest) => void): () => void
  onCloseCurrentViewRequested(listener: (origin: WindowCloseOrigin) => void): () => void
  onWindowCloseRequested(listener: (request: WindowCloseRequest) => void): () => void
  onWindowZoomChanged(listener: (factor: number) => void): () => void
  onOpenThread(listener: (request: OpenThreadRequest) => void): () => void
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void
  onBrowserViewEvent(listener: (event: BrowserViewEvent) => void): () => void
  onBrowserTopSitesChanged(listener: (sites: BrowserTopSite[]) => void): () => void
  onWorkspaceFilesChanged(listener: (event: WorkspaceFilesChanged) => void): () => void
  onRemoteConnectionsChanged(listener: (connections: RemoteConnection[]) => void): () => void
  onActiveHostInvalidated(listener: (event: ActiveHostInvalidated) => void): () => void
  onNotification(listener: (notification: RpcNotification) => void): () => void
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void
  onBackendStatus(listener: (status: BackendStatus) => void): () => void
}

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppCommand,
  AppContext,
  AppInfo,
  BackendStatus,
  BrowserTopSite,
  BrowserViewEvent,
  BrowserViewState,
  CodexDesktopApi,
  ComposerAttachmentSelection,
  CreateRemoteProjectOptions,
  DesktopPreferences,
  DiscoveredSshConnection,
  ExternalAgentImportProgress,
  ForkThreadInNewWorktreeOptions,
  ForkThreadInNewWorktreeResult,
  GitMetadata,
  GitBranches,
  GitMetadataOptions,
  JsonMap,
  ManagedWorktree,
  ManagedWorktreeCreateOptions,
  OpenThreadRequest,
  RemoteConnection,
  RemoteDirectoryListing,
  RemotePathValidation,
  RemoteProject,
  RpcNotification,
  RpcServerRequest,
  SaveRemoteConnectionOptions,
  ScheduledTaskDefinition,
  ScheduledTaskRunRequest,
  ThreadImageResult,
  TerminalEvent,
  TerminalOpenOptions,
  TerminalSession,
  TerminalSize,
  WindowCloseOrigin,
  WindowCloseRequest,
  WindowCloseResponse,
  WorkspaceDirectoryResult,
  WorkspaceFileResult,
  WorkspaceFileSaveResult
} from '../shared/api'

const readySubscriptions = new Map<string, number>()
// This promise belongs to the preload's document. A readiness message queued
// before reload cannot make the replacement document's services appear ready.
const documentGeneration = ipcRenderer.invoke('app:document-generation') as Promise<number>

function sendReadiness(channel: string, ready: boolean): void {
  void documentGeneration.then((generation) => ipcRenderer.invoke(channel, ready, generation)).catch(() => {})
}

function subscribeReady<T>(
  channel: string,
  readinessChannel: string,
  listener: (value: T) => void
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, wrapped)
  const count = readySubscriptions.get(readinessChannel) ?? 0
  readySubscriptions.set(readinessChannel, count + 1)
  if (count === 0) sendReadiness(readinessChannel, true)
  let removed = false
  return () => {
    if (removed) return
    removed = true
    ipcRenderer.removeListener(channel, wrapped)
    const remaining = Math.max(0, (readySubscriptions.get(readinessChannel) ?? 1) - 1)
    readySubscriptions.set(readinessChannel, remaining)
    if (remaining === 0) sendReadiness(readinessChannel, false)
  }
}

const api: CodexDesktopApi = {
  externalAgentImport: {
    detect: (options) => ipcRenderer.invoke('app:external-agent-detect', options),
    import: (options) => ipcRenderer.invoke('app:external-agent-import', options),
    cancel: (importAttemptId) => ipcRenderer.invoke('app:external-agent-cancel', importAttemptId),
    readHistory: (options) => ipcRenderer.invoke('app:external-agent-history', options),
    readStatus: (options) => ipcRenderer.invoke('app:external-agent-status', options),
    readImportedConnectors: (options) => ipcRenderer.invoke('app:external-agent-connectors', options),
    getPreferences: () => ipcRenderer.invoke('app:external-agent-preferences'),
    setSync: (options) => ipcRenderer.invoke('app:external-agent-sync', options),
    authenticateMcp: (name) => ipcRenderer.invoke('app:external-agent-mcp-authenticate', name),
    onProgress: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, value: ExternalAgentImportProgress): void => listener(value)
      ipcRenderer.on('app:external-agent-progress', wrapped)
      return () => ipcRenderer.removeListener('app:external-agent-progress', wrapped)
    }
  },
  invoke: <T>(method: string, params?: JsonMap, hostId?: string) =>
    ipcRenderer.invoke('codex:invoke', method, params, hostId) as Promise<T>,
  getBackendStatus: (hostId?: string) => ipcRenderer.invoke('codex:status', hostId) as Promise<BackendStatus>,
  restartBackend: (hostId?: string) => ipcRenderer.invoke('codex:restart', hostId) as Promise<void>,
  setActiveHost: (hostId: string) => ipcRenderer.invoke('app:set-active-host', hostId) as Promise<void>,
  getAppContext: (cwd?: string) =>
    ipcRenderer.invoke('app:context', cwd) as Promise<AppContext>,
  discoverSshConnections: () =>
    ipcRenderer.invoke('app:ssh-connections-discover') as Promise<DiscoveredSshConnection[]>,
  listRemoteConnections: () =>
    ipcRenderer.invoke('app:remote-connections-list') as Promise<RemoteConnection[]>,
  saveRemoteConnection: (options: SaveRemoteConnectionOptions) =>
    ipcRenderer.invoke('app:remote-connection-save', options) as Promise<RemoteConnection>,
  deleteRemoteConnection: (hostId: string) =>
    ipcRenderer.invoke('app:remote-connection-delete', hostId) as Promise<void>,
  connectRemoteConnection: (hostId: string) =>
    ipcRenderer.invoke('app:remote-connection-connect', hostId) as Promise<RemoteConnection>,
  disconnectRemoteConnection: (hostId: string) =>
    ipcRenderer.invoke('app:remote-connection-disconnect', hostId) as Promise<RemoteConnection>,
  listRemoteProjects: () =>
    ipcRenderer.invoke('app:remote-projects-list') as Promise<RemoteProject[]>,
  createRemoteProject: (options: CreateRemoteProjectOptions) =>
    ipcRenderer.invoke('app:remote-project-create', options) as Promise<RemoteProject>,
  deleteRemoteProject: (id: string) =>
    ipcRenderer.invoke('app:remote-project-delete', id) as Promise<void>,
  validateRemotePath: (hostId: string, path: string) =>
    ipcRenderer.invoke('app:remote-path-validate', hostId, path) as Promise<RemotePathValidation>,
  createRemoteDirectory: (hostId: string, path: string) =>
    ipcRenderer.invoke('app:remote-directory-create', hostId, path) as Promise<RemotePathValidation>,
  listRemoteDirectory: (hostId: string, path?: string) =>
    ipcRenderer.invoke('app:remote-directory-list', hostId, path) as Promise<RemoteDirectoryListing>,
  getRemoteAppContext: (hostId: string, cwd: string, projectId?: string) =>
    ipcRenderer.invoke('app:remote-context', hostId, cwd, projectId) as Promise<AppContext>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  getDesktopPreferences: () => ipcRenderer.invoke('app:desktop-preferences') as Promise<DesktopPreferences>,
  updateDesktopPreferences: (preferences: DesktopPreferences) =>
    ipcRenderer.invoke('app:update-desktop-preferences', preferences) as Promise<void>,
  listScheduledTasks: () =>
    ipcRenderer.invoke('app:scheduled-tasks-list') as Promise<ScheduledTaskDefinition[]>,
  saveScheduledTask: (task: ScheduledTaskDefinition) =>
    ipcRenderer.invoke('app:scheduled-task-save', task) as Promise<ScheduledTaskDefinition>,
  deleteScheduledTask: (id: string) =>
    ipcRenderer.invoke('app:scheduled-task-delete', id) as Promise<void>,
  setScheduledTaskStatus: (id, status) =>
    ipcRenderer.invoke('app:scheduled-task-status', id, status) as Promise<ScheduledTaskDefinition>,
  runScheduledTaskNow: (id: string) =>
    ipcRenderer.invoke('app:scheduled-task-run-now', id) as Promise<ScheduledTaskRunRequest>,
  listPendingScheduledTaskRuns: () =>
    ipcRenderer.invoke('app:scheduled-task-pending-runs') as Promise<ScheduledTaskRunRequest[]>,
  bindScheduledTaskRunThread: (runId: string, threadId: string) =>
    ipcRenderer.invoke('app:scheduled-task-bind-thread', runId, threadId) as Promise<ScheduledTaskRunRequest>,
  acknowledgeScheduledTaskRun: (runId: string, threadId?: string) =>
    ipcRenderer.invoke('app:scheduled-task-acknowledge-run', runId, threadId) as Promise<void>,
  requestWindowClose: (origin: WindowCloseOrigin) =>
    ipcRenderer.invoke('app:request-window-close', origin) as Promise<void>,
  respondToWindowCloseRequest: (id: string, response: WindowCloseResponse) =>
    ipcRenderer.invoke('app:respond-window-close', id, response) as Promise<void>,
  getWindowZoom: () => ipcRenderer.invoke('app:window-zoom') as Promise<number>,
  setWindowZoom: (factor: number) => ipcRenderer.invoke('app:set-window-zoom', factor) as Promise<void>,
  acknowledgeOpenThread: (id: string) => ipcRenderer.invoke('app:acknowledge-open-thread', id) as Promise<void>,
  openTerminal: (options: TerminalOpenOptions) => ipcRenderer.invoke('app:open-terminal', options) as Promise<TerminalSession>,
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('app:write-terminal', id, data) as Promise<void>,
  resizeTerminal: (id: string, size: TerminalSize) => ipcRenderer.invoke('app:resize-terminal', id, size) as Promise<void>,
  closeTerminal: (id: string) => ipcRenderer.invoke('app:close-terminal', id) as Promise<void>,
  createBrowserView: (id: string) => ipcRenderer.invoke('app:browser-view-create', id) as Promise<BrowserViewState>,
  navigateBrowserView: (id: string, url: string) => ipcRenderer.invoke('app:browser-view-navigate', id, url) as Promise<void>,
  goBackBrowserView: (id: string) => ipcRenderer.invoke('app:browser-view-back', id) as Promise<void>,
  goForwardBrowserView: (id: string) => ipcRenderer.invoke('app:browser-view-forward', id) as Promise<void>,
  reloadBrowserView: (id: string) => ipcRenderer.invoke('app:browser-view-reload', id) as Promise<void>,
  stopBrowserView: (id: string) => ipcRenderer.invoke('app:browser-view-stop', id) as Promise<void>,
  findBrowserView: (id, query, options) => ipcRenderer.invoke('app:browser-view-find', id, query, options) as Promise<number>,
  stopFindingBrowserView: (id) => ipcRenderer.invoke('app:browser-view-stop-finding', id) as Promise<void>,
  setBrowserViewZoom: (id, factor) => ipcRenderer.invoke('app:browser-view-zoom', id, factor) as Promise<void>,
  setBrowserViewBounds: (id, bounds) => ipcRenderer.invoke('app:browser-view-bounds', id, bounds) as Promise<void>,
  setBrowserViewActive: (id: string, active: boolean) => ipcRenderer.invoke('app:browser-view-active', id, active) as Promise<void>,
  closeBrowserView: (id: string) => ipcRenderer.invoke('app:browser-view-close', id) as Promise<void>,
  listBrowserTopSites: () => ipcRenderer.invoke('app:browser-top-sites-list') as Promise<BrowserTopSite[]>,
  dismissBrowserTopSite: (url: string) =>
    ipcRenderer.invoke('app:browser-top-site-dismiss', url) as Promise<BrowserTopSite[]>,
  restoreBrowserTopSite: (url: string) =>
    ipcRenderer.invoke('app:browser-top-site-restore', url) as Promise<BrowserTopSite[]>,
  getGitMetadata: (cwd: string, options?: GitMetadataOptions) =>
    ipcRenderer.invoke('app:git-metadata', cwd, options) as Promise<GitMetadata>,
  diffWorkspaceText: (before, after, options) =>
    ipcRenderer.invoke('app:workspace-text-diff', before, after, options) as Promise<string>,
  listGitBranches: (cwd: string) =>
    ipcRenderer.invoke('app:list-git-branches', cwd) as Promise<GitBranches>,
  createManagedWorktree: (options: ManagedWorktreeCreateOptions) =>
    ipcRenderer.invoke('app:create-managed-worktree', options) as Promise<ManagedWorktree>,
  listManagedWorktrees: (cwd: string) =>
    ipcRenderer.invoke('app:list-managed-worktrees', cwd) as Promise<ManagedWorktree[]>,
  forkThreadInNewWorktree: <Thread = unknown>(options: ForkThreadInNewWorktreeOptions) =>
    ipcRenderer.invoke('app:fork-thread-in-new-worktree', options) as Promise<
      ForkThreadInNewWorktreeResult<Thread>
    >,
  openThreadInNewWindow: (threadId: string, hostId?: string) =>
    ipcRenderer.invoke('app:open-thread-in-new-window', threadId, hostId) as Promise<void>,
  readWorkspaceDirectory: (cwd: string, path: string) =>
    ipcRenderer.invoke(
      'app:workspace-read-directory',
      { root: cwd, path }
    ) as Promise<WorkspaceDirectoryResult>,
  readWorkspaceFile: (cwd: string, path: string) =>
    ipcRenderer.invoke('app:workspace-read-file', { root: cwd, path }) as Promise<WorkspaceFileResult>,
  saveWorkspaceFile: (cwd: string, path: string, text: string, expectedText: string) =>
    ipcRenderer.invoke('app:workspace-save-file', { root: cwd, path, text, expectedText }) as Promise<WorkspaceFileSaveResult>,
  watchWorkspacePaths: (root, directories, files) => documentGeneration.then((generation) =>
    ipcRenderer.invoke('app:workspace-watch', { root, directories, files }, generation)) as Promise<string>,
  unwatchWorkspacePaths: (id) => ipcRenderer.invoke('app:workspace-unwatch', id) as Promise<void>,
  listWorkspaceOpenTargets: () => ipcRenderer.invoke('app:workspace-open-targets'),
  openWorkspacePath: (root, path, target) => ipcRenderer.invoke('app:workspace-open-path', { root, path }, target),
  saveWorkspaceFileCopy: (root, path, text) => ipcRenderer.invoke('app:workspace-save-copy', { root, path, ...(text !== undefined ? { text } : {}) }),
  readThreadImage: (path: string) =>
    ipcRenderer.invoke('app:read-thread-image', path) as Promise<ThreadImageResult>,
  copyThreadImage: (path: string) =>
    ipcRenderer.invoke('app:copy-thread-image', path) as Promise<void>,
  copyInlineImage: (source: string) =>
    ipcRenderer.invoke('app:copy-inline-image', source) as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text) as Promise<void>,
  pickDirectory: () => ipcRenderer.invoke('app:pick-directory') as Promise<AppContext | null>,
  pickComposerAttachments: () =>
    ipcRenderer.invoke('app:pick-composer-attachments') as Promise<
      ComposerAttachmentSelection[]
    >,
  openWorkingDirectory: (cwd, target) =>
    ipcRenderer.invoke('app:open-working-directory', cwd, target) as Promise<void>,
  openAuthenticationUrl: (url: string) =>
    ipcRenderer.invoke('app:open-authentication-url', url) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  listPendingServerRequests: (hostId?: string) =>
    ipcRenderer.invoke('codex:list-pending-server-requests', hostId) as Promise<RpcServerRequest[]>,
  respondToServerRequest: (id, response, hostId) => ipcRenderer.invoke('codex:respond', id, response, hostId),
  onAppCommand: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: AppCommand): void => listener(value)
    ipcRenderer.on('app:command', wrapped)
    return () => ipcRenderer.removeListener('app:command', wrapped)
  },
  onDesktopPreferencesChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: DesktopPreferences): void => listener(value)
    ipcRenderer.on('app:desktop-preferences-changed', wrapped)
    return () => ipcRenderer.removeListener('app:desktop-preferences-changed', wrapped)
  },
  onScheduledTasksChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ScheduledTaskDefinition[]): void => listener(value)
    ipcRenderer.on('app:scheduled-tasks-changed', wrapped)
    return () => ipcRenderer.removeListener('app:scheduled-tasks-changed', wrapped)
  },
  onScheduledTaskRun: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ScheduledTaskRunRequest): void => listener(value)
    ipcRenderer.on('app:scheduled-task-run', wrapped)
    return () => ipcRenderer.removeListener('app:scheduled-task-run', wrapped)
  },
  onCloseCurrentViewRequested: (listener) =>
    subscribeReady<WindowCloseOrigin>('app:close-current-view', 'app:close-current-view-ready', listener),
  onWindowCloseRequested: (listener) =>
    subscribeReady<WindowCloseRequest>('app:window-close-requested', 'app:window-close-ready', listener),
  onOpenThread: (listener) =>
    subscribeReady<OpenThreadRequest>('app:open-thread', 'app:open-thread-ready', listener),
  onWindowZoomChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: number): void => listener(value)
    ipcRenderer.on('app:window-zoom-changed', wrapped)
    return () => ipcRenderer.removeListener('app:window-zoom-changed', wrapped)
  },
  onTerminalEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: TerminalEvent): void => listener(value)
    ipcRenderer.on('app:terminal-event', wrapped)
    return () => ipcRenderer.removeListener('app:terminal-event', wrapped)
  },
  onBrowserViewEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: BrowserViewEvent): void => listener(value)
    ipcRenderer.on('app:browser-view-event', wrapped)
    return () => ipcRenderer.removeListener('app:browser-view-event', wrapped)
  },
  onBrowserTopSitesChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: BrowserTopSite[]): void => listener(value)
    ipcRenderer.on('app:browser-top-sites-changed', wrapped)
    return () => ipcRenderer.removeListener('app:browser-top-sites-changed', wrapped)
  },
  onWorkspaceFilesChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value)
    ipcRenderer.on('app:workspace-files-changed', wrapped)
    return () => ipcRenderer.removeListener('app:workspace-files-changed', wrapped)
  },
  onRemoteConnectionsChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: RemoteConnection[]): void => listener(value)
    ipcRenderer.on('app:remote-connections-changed', wrapped)
    return () => ipcRenderer.removeListener('app:remote-connections-changed', wrapped)
  },
  onActiveHostInvalidated: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value)
    ipcRenderer.on('app:active-host-invalidated', wrapped)
    return () => ipcRenderer.removeListener('app:active-host-invalidated', wrapped)
  },
  onNotification: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: RpcNotification): void =>
      listener(value)
    ipcRenderer.on('codex:notification', wrapped)
    return () => ipcRenderer.removeListener('codex:notification', wrapped)
  },
  onServerRequest: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: RpcServerRequest): void =>
      listener(value)
    ipcRenderer.on('codex:server-request', wrapped)
    return () => ipcRenderer.removeListener('codex:server-request', wrapped)
  },
  onBackendStatus: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: BackendStatus): void =>
      listener(value)
    ipcRenderer.on('codex:backend-status', wrapped)
    return () => ipcRenderer.removeListener('codex:backend-status', wrapped)
  }
}

contextBridge.exposeInMainWorld('codex', api)

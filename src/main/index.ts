import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  nativeTheme,
  Notification,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
  WebContentsView
} from 'electron'
import type {
  AppCommand,
  AppContext,
  AppInfo,
  BackendStatus,
  CreateRemoteProjectOptions,
  GitMetadataOptions,
  HostId,
  JsonMap,
  OpenThreadRequest,
  RpcId,
  RpcNotification,
  RpcServerRequest,
  RpcServerResponse,
  ScheduledTaskRunRequest
} from '../shared/api'
import type { TerminalOpenOptions } from '../shared/api'
import { AppServerClient } from './appServer'
import { HostAppServerRegistry } from './hostAppServerRegistry'
import { normalizeRemotePath, RemoteConnectionStore } from './remoteConnections'
import { ExternalAgentImportService } from './externalAgentImport'
import { AuthenticationUrlBroker } from './authNavigation'
import { applicationMenuTemplate } from './applicationMenu'
import { notificationForServerEvent } from './desktopNotifications'
import {
  EphemeralThreadTracker,
  routeServerRequestToRenderer
} from './ephemeralThreads'
import {
  composerAttachmentPickerProperties,
  describeComposerAttachment,
  MAX_COMPOSER_ATTACHMENTS
} from './composerAttachments'
import { ComposerPathGrants } from './composerPathGrants'
import {
  isAllowedAuthenticationUrl,
  isAllowedExternalUrl,
  isAllowedRendererRpc,
  isExternalAgentDetectOptions,
  isExternalAgentImportOptions,
  isExternalAgentReadOptions,
  isExternalAgentSyncOptions,
  isExternalAgentImportIdentifier,
  isExternalAgentMcpAuthenticationUrl,
  isAllowedWorkspacePathRequest,
  isTrustedRendererUrl
} from './ipcSecurity'
import { restoreWindowBounds, WindowStateStore } from './windowState'
import { readGitMetadata } from './gitMetadata'
import { readGitBranches } from './gitBranches'
import { diffWorkspaceText } from './workspaceTextDiff'
import {
  APP_ENTRY_URL,
  APP_PROTOCOL_SCHEME,
  installPermissionDenyPolicy,
  resolveReplicaUserDataDirectory,
  resolveRendererAssetFilePath
} from './runtimeSecurity'
import { hydrateShellEnvironment } from './shellEnvironment'
import { resolveInitialWorkingDirectory } from './initialWorkingDirectory'
import { validateAppContextDirectory } from './appContextDirectory'
import {
  readWorkspaceDirectory,
  readWorkspaceFile,
  saveWorkspaceFile,
  canonicalWorkspaceTarget,
  isWorkspaceFileSaveRequest,
  WorkspaceRootGrants
} from './workspaceFiles'
import { WorkspaceWatchers, isWorkspaceWatchRequest } from './workspaceWatchers'
import { listWorkspaceOpenTargets, workspaceTargetApplication, isWorkspaceSaveCopyRequest, saveWorkspaceFileCopy } from './workspaceFileActions'
import { loadMacWorkspaceApplicationIcon } from './workspaceTargetIcons'
import type { WorkspaceOpenTargetId } from '../shared/api'
import { readThreadImage, ThreadImagePathGrants } from './threadImageAccess'
import { inlineClipboardImageBytes, writeClipboardImage } from './imageClipboard'
import { SkillPathGrants } from './skillPathGrants'
import { macosWindowOptions } from './macosWindowOptions'
import {
  DesktopPreferencesStore,
  isDesktopPreferences,
  mergeDesktopPreferences,
  RunningTurnTracker,
  shouldDeliverDesktopNotification
} from './desktopPreferences'
import { WindowCloseBroker, WindowCloseController, isWindowCloseOrigin } from './windowClose'
import { NotificationThreadRouter, threadIdForDesktopEvent } from './notificationRouting'
import { isWindowZoom, steppedWindowZoom } from './windowZoom'
import { TerminalSessions, validateTerminalSize } from './terminalSessions'
import { HostTerminalSessions } from './hostTerminalSessions'
import { NativePtyTerminalServer } from './nativePtyTerminalServer'
import { RendererDocumentTracker } from './rendererDocument'
import { ManagedWorktrees, validateWorktreeCreateOptions } from './managedWorktrees'
import {
  forkThreadInNewWorktree,
  validateForkThreadInNewWorktreeOptions
} from './worktreeFork'
import {
  isDesktopThreadId,
  managedWindowForSender,
  WindowThreadRouter
} from './windowThreadRouting'
import { BrowserViews } from './browserViews'
import { BrowserHistoryStore } from './browserHistory'
import { ActiveHostRouting } from './activeHostRouting'
import { discoverSshConnections } from './sshConfigDiscovery'
import { ScheduledTaskService } from './scheduledTasks'
import {
  deliverScheduledTaskRun,
  scheduledTaskRunnerWindow as selectScheduledTaskRunnerWindow
} from './scheduledTaskWindowRouting'

const execFileAsync = promisify(execFile)
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const replicaUserDataDirectory = resolveReplicaUserDataDirectory(
  app.getPath('appData'),
  app.isPackaged,
  process.env.CODEX_REPLICA_USER_DATA_PATH
)
app.setPath('userData', replicaUserDataDirectory)
app.setPath('sessionData', join(replicaUserDataDirectory, 'Session Data'))

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: false,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: false,
      codeCache: true,
      allowExtensions: false
    }
  }
])

const appServer = new AppServerClient({
  // The observed macOS desktop client owns a private stdio app-server process.
  // Daemon reuse remains available as an explicit compatibility/debug option,
  // but it cannot inherit provider variables added after that daemon started.
  preferManagedDaemon: process.env.CODEX_APP_USE_MANAGED_DAEMON === '1'
})
const remoteConnectionStore = new RemoteConnectionStore(replicaUserDataDirectory)
const hostAppServers = new HostAppServerRegistry(appServer, remoteConnectionStore)
const authenticationUrls = new AuthenticationUrlBroker()
const composerPathGrants = new ComposerPathGrants()
const workspaceRootGrants = new WorkspaceRootGrants(replicaUserDataDirectory)
const managedWorktrees = new ManagedWorktrees(replicaUserDataDirectory)
const threadImagePathGrants = new ThreadImagePathGrants()
const skillPathGrants = new SkillPathGrants()
const ephemeralThreads = new EphemeralThreadTracker()
const windowStateStore = new WindowStateStore(replicaUserDataDirectory)
const desktopPreferencesStore = new DesktopPreferencesStore(replicaUserDataDirectory)
const scheduledTasks = new ScheduledTaskService(replicaUserDataDirectory)
const externalAgentImport = new ExternalAgentImportService({
  server: appServer,
  profileDirectory: replicaUserDataDirectory,
  onTrustedResult: async (method, result) => {
    await workspaceRootGrants.rememberThreadResult(method, result)
    await workspaceRootGrants.rememberProjectResult(method, result)
  }
})
externalAgentImport.on('progress', (progress) => sendToRenderer('app:external-agent-progress', progress))
externalAgentImport.on('completed', (result) => sendToRenderer('codex:notification', {
  method: 'externalAgentImport/completed', params: result
}))
let desktopPreferences = desktopPreferencesStore.load()

scheduledTasks.onChange((tasks) => sendToRenderer('app:scheduled-tasks-changed', tasks))
scheduledTasks.onRun((run) => sendScheduledTaskRun(run))

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1d1d1d' : '#f9f9f9'
}

function updateManagedWindowBackgrounds(): void {
  const backgroundColor = windowBackgroundColor()
  for (const window of managedWindows) {
    if (!window.isDestroyed()) window.setBackgroundColor(backgroundColor)
  }
}

function applyNativeAppearance(): void {
  nativeTheme.themeSource = desktopPreferences.appearance
  updateManagedWindowBackgrounds()
}

const runningTurns = new RunningTurnTracker()
const notificationAttention = new Set<Notification>()
let sleepAssertion: number | null = null
let mainWindow: BrowserWindow | null = null
const managedWindows = new Set<BrowserWindow>()
nativeTheme.on('updated', () => {
  if (desktopPreferences.appearance === 'system') updateManagedWindowBackgrounds()
})
const activeHostRouting = new ActiveHostRouting<BrowserWindow>()
const browserViewsByWindow = new Map<BrowserWindow, BrowserViews>()
const browserHistoryStore = new BrowserHistoryStore(replicaUserDataDirectory, (sites) => {
  sendToRenderer('app:browser-top-sites-changed', sites)
})
let quitAfterShutdown = false
const closeCurrentViewReady = new WeakSet<BrowserWindow>()
const windowCloseBroker = new WindowCloseBroker<BrowserWindow>()
const notificationThreadRouter = new NotificationThreadRouter()
const windowThreadRouter = new WindowThreadRouter<BrowserWindow>()
const windowZooms = new WeakMap<BrowserWindow, number>()
const rendererDocuments = new RendererDocumentTracker<BrowserWindow>()
const workspaceWatchers = new WorkspaceWatchers((owner, change) => {
  const window = BrowserWindow.fromId(owner)
  if (window && !window.isDestroyed()) window.webContents.send('app:workspace-files-changed', change)
})
const windowCloseController = new WindowCloseController<BrowserWindow>(
  () => desktopPreferences.closeWindowConfirmation,
  (window, origin) => windowCloseBroker.confirm(window, origin, (request) => {
    if (window.isDestroyed()) throw new Error('Window is unavailable')
    window.webContents.send('app:window-close-requested', request)
  }),
  () => {
    const next = { ...desktopPreferences, closeWindowConfirmation: 'never' as const }
    desktopPreferencesStore.save(next)
    desktopPreferences = next
    sendToRenderer('app:desktop-preferences-changed', { ...next })
  }
)
let hostTerminalSessions!: HostTerminalSessions<TerminalSessions>
const nativePtyTerminalServer = new NativePtyTerminalServer()
const emitTerminalEvent = (owner: number, event: Parameters<ConstructorParameters<typeof TerminalSessions>[1]>[1]): void => {
  if (event.type === 'exit' || event.type === 'error') hostTerminalSessions.forgetSession(event.id)
  const window = [...managedWindows].find((candidate) =>
    !candidate.isDestroyed() && candidate.webContents.id === owner)
  if (window) window.webContents.send('app:terminal-event', event)
}
hostTerminalSessions = new HostTerminalSessions((hostId) => new TerminalSessions(
  hostId === 'local' ? nativePtyTerminalServer : hostAppServers.clientForHost(hostId),
  emitTerminalEvent,
  {
    ...(hostId === 'local' ? {} : { command: ['/bin/sh', '-l'] }),
    onSessionClosed: (id) => hostTerminalSessions.forgetSession(id)
  }
))

async function closeTerminalOwner(owner: number): Promise<void> {
  await hostTerminalSessions.closeOwner(owner)
}

async function disposeTerminalSessions(): Promise<void> {
  await hostTerminalSessions.dispose()
}

const targetInfo = {
  targetVersion: '26.1016.62342',
  targetBuild: '21477',
  targetAppServerVersion: '0.163.0-alpha.11.2'
} as const

// Preserve launch overrides before login-shell hydration updates process.env.
const launchWorkingDirectory = resolveInitialWorkingDirectory()

function initialCwd(): string {
  return launchWorkingDirectory.cwd
}

async function appContext(cwd = initialCwd(), grantWorkspace = false): Promise<AppContext> {
  const normalizedCwd = await validateAppContextDirectory(cwd)
  if (grantWorkspace) workspaceRootGrants.grant(normalizedCwd)
  let branch: string | null = null
  try {
    const result = await execFileAsync('/usr/bin/git', ['-C', normalizedCwd, 'branch', '--show-current'], {
      timeout: 2500
    })
    branch = result.stdout.trim() || null
  } catch {
    // A directory does not need to be a Git repository to host a Codex thread.
  }

  return {
    cwd: normalizedCwd,
    folderName: basename(normalizedCwd) || normalizedCwd,
    branch,
    platform: 'darwin',
    hostId: 'local',
    hostDisplayName: 'Local',
    projectKind: 'local'
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  for (const window of managedWindows) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function scheduledTaskRunnerWindow(): BrowserWindow | null {
  return selectScheduledTaskRunnerWindow(mainWindow, managedWindows)
}

function sendScheduledTaskRun(run: ScheduledTaskRunRequest): void {
  deliverScheduledTaskRun(mainWindow, managedWindows, run, (window, payload) => {
    window.webContents.send('app:scheduled-task-run', payload)
  })
}

function replayPendingScheduledTaskRuns(window: BrowserWindow): void {
  if (scheduledTaskRunnerWindow() !== window || window.isDestroyed()) return
  for (const run of scheduledTasks.listPendingRuns()) {
    window.webContents.send('app:scheduled-task-run', run)
  }
}

function activeHostId(window: BrowserWindow): HostId {
  return activeHostRouting.get(window)
}

function setActiveHost(window: BrowserWindow, hostId: HostId): void {
  activeHostRouting.set(window, hostId)
}

function invalidateActiveHost(hostId: string, reason: 'disconnected' | 'deleted'): void {
  activeHostRouting.invalidate(hostId, managedWindows, reason, (window, event) => {
    if (!window.isDestroyed()) window.webContents.send('app:active-host-invalidated', event)
  })
}

function sendToHostRenderer(hostId: HostId, channel: string, payload: unknown): void {
  for (const window of managedWindows) {
    if (!window.isDestroyed() && activeHostId(window) === hostId) {
      window.webContents.send(channel, payload)
    }
  }
}

function hostForRequest(window: BrowserWindow, requestedHostId: unknown): HostId {
  if (requestedHostId === undefined) return activeHostId(window)
  if (requestedHostId === 'local') return 'local'
  if (typeof requestedHostId !== 'string' || !requestedHostId) throw new Error('Invalid host ID')
  remoteConnectionStore.getConnection(requestedHostId)
  return requestedHostId
}

function assertLocalHost(window: BrowserWindow, capability: string): void {
  if (activeHostId(window) !== 'local') {
    throw new Error(`${capability} is not available for a remote workspace yet`)
  }
}

function assertRemoteWorkspacePath(hostId: string, cwd: string): string {
  const path = normalizeRemotePath(cwd)
  const allowed = remoteConnectionStore.listProjects().some((project) => {
    if (project.hostId !== hostId) return false
    return path === project.remotePath || path.startsWith(`${project.remotePath === '/' ? '' : project.remotePath}/`)
  })
  if (!allowed) throw new Error('Remote terminal working directory is outside the selected projects')
  return path
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function currentBrowserViews(window: BrowserWindow): BrowserViews {
  const browserViews = browserViewsByWindow.get(window)
  if (window.isDestroyed() || !browserViews) {
    throw new Error('Browser window is unavailable')
  }
  return browserViews
}

function focusedManagedWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  return focused && managedWindows.has(focused) && !focused.isDestroyed() ? focused : null
}

function anyManagedWindowFocused(): boolean {
  return [...managedWindows].some((window) => !window.isDestroyed() && window.isFocused())
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow({ primary: true })
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function showBackgroundNotification(copy: { title: string; body: string } | null, params: unknown): void {
  if (!copy || !Notification.isSupported()) return
  const notification = new Notification(copy)
  const threadId = threadIdForDesktopEvent(params)
  const removeAttention = (): void => {
    notificationAttention.delete(notification)
    updateDockNotificationDot()
  }
  notification.on('click', () => {
    removeAttention()
    focusMainWindow()
    if (threadId) notificationThreadRouter.open(threadId)
  })
  notification.on('close', removeAttention)
  notification.on('failed', removeAttention)
  notificationAttention.add(notification)
  updateDockNotificationDot()
  notification.show()
}

function updateDockNotificationDot(): void {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(notificationAttention.size > 0 ? '•' : '')
  }
}

function updateSleepAssertion(): void {
  const shouldPreventSleep = desktopPreferences.preventSleepWhileRunning && runningTurns.isRunning
  if (shouldPreventSleep && sleepAssertion === null) {
    sleepAssertion = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!shouldPreventSleep && sleepAssertion !== null) {
    powerSaveBlocker.stop(sleepAssertion)
    sleepAssertion = null
  }
}

function sendAppCommand(command: AppCommand): void {
  let target = focusedManagedWindow() ?? mainWindow
  if (!target || target.isDestroyed()) {
    mainWindow = createWindow({ primary: true })
    target = mainWindow
    const created = target
    created.webContents.once('did-finish-load', () => {
      if (!created.isDestroyed()) created.webContents.send('app:command', command)
    })
    return
  }

  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  target.webContents.send('app:command', command)
}

function installApplicationMenu(): void {
  const template = applicationMenuTemplate(
    app.name,
    sendAppCommand,
    () => void shell.openExternal('https://learn.chatgpt.com/docs/codex/overview'),
    !app.isPackaged,
    {
      close: (keyboard) => {
        const window = BrowserWindow.getFocusedWindow()
        if (!window || !managedWindows.has(window) || window.isDestroyed()) return
        const origin = keyboard ? 'shortcut' : 'window'
        if (closeCurrentViewReady.has(window)) window.webContents.send('app:close-current-view', origin)
        else windowCloseController.requestClose(window, origin)
      },
      stepZoom: (delta) => {
        const window = BrowserWindow.getFocusedWindow()
        if (window && managedWindows.has(window) && !window.isDestroyed()) {
          setWindowZoom(window, steppedWindowZoom(windowZooms.get(window) ?? 1, delta))
        }
      },
      resetZoom: () => {
        const window = BrowserWindow.getFocusedWindow()
        if (window && managedWindows.has(window) && !window.isDestroyed()) setWindowZoom(window, 1)
      }
    }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setWindowZoom(window: BrowserWindow, factor: number): void {
  if (window.isDestroyed()) return
  // The target scales its renderer viewport with CSS; native Chromium zoom
  // stays at one so its coordinates and popup placement retain that contract.
  windowZooms.set(window, factor)
  if (process.platform === 'darwin') {
    window.setWindowButtonPosition(macosWindowOptions(factor).trafficLightPosition)
  }
  window.webContents.send('app:window-zoom-changed', factor)
}

function assertTrustedIpcSender(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = managedWindowForSender(
    managedWindows,
    event.sender,
    (sender) => BrowserWindow.fromWebContents(sender)
  )
  if (!window) {
    throw new Error('IPC request did not originate from a managed renderer')
  }

  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC request did not originate from the main frame')
  }

  const senderUrl = event.senderFrame.url
  const developmentUrl = app.isPackaged ? null : process.env.ELECTRON_RENDERER_URL ?? null
  if (!senderUrl || !isTrustedRendererUrl(senderUrl, developmentUrl)) {
    throw new Error(`IPC request from untrusted renderer URL: ${senderUrl || '<unknown>'}`)
  }
  return window
}

function installRendererProtocol(): void {
  const rendererRoot = join(currentDirectory, '../renderer')
  protocol.handle(APP_PROTOCOL_SCHEME, async (request) => {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
    }

    const assetPath = await resolveRendererAssetFilePath(request.url, rendererRoot)
    if (!assetPath) return new Response(null, { status: 404, statusText: 'Not Found' })

    try {
      return await net.fetch(pathToFileURL(assetPath).toString())
    } catch {
      return new Response(null, { status: 404, statusText: 'Not Found' })
    }
  })
}

async function writeNativeClipboardImage(image: Electron.NativeImage): Promise<void> {
  // Electron 44 uses ClipboardItem; the target's writeImage operation also
  // places a decoded raster on the native pasteboard, rather than its URL.
  const png = Uint8Array.from(image.toPNG())
  await clipboard.write([new ClipboardItem({
    'image/png': new Blob([png], { type: 'image/png' })
  })])
}

function installIpcHandlers(): void {
  ipcMain.handle('app:external-agent-detect', (event, options: unknown) => {
    assertTrustedIpcSender(event)
    if (!isExternalAgentDetectOptions(options)) throw new Error('Invalid external agent detection options')
    return externalAgentImport.detect(options)
  })
  ipcMain.handle('app:external-agent-import', (event, options: unknown) => {
    assertTrustedIpcSender(event)
    if (!isExternalAgentImportOptions(options)) throw new Error('Invalid external agent import options')
    return externalAgentImport.import(options)
  })
  ipcMain.handle('app:external-agent-cancel', (event, importAttemptId: unknown) => {
    assertTrustedIpcSender(event)
    if (!isExternalAgentImportIdentifier(importAttemptId)) throw new Error('Invalid external agent import attempt')
    return externalAgentImport.cancel(importAttemptId)
  })
  for (const [channel, read] of [
    ['app:external-agent-history', externalAgentImport.readHistory.bind(externalAgentImport)],
    ['app:external-agent-status', externalAgentImport.readStatus.bind(externalAgentImport)],
    ['app:external-agent-connectors', externalAgentImport.readImportedConnectors.bind(externalAgentImport)]
  ] as const) ipcMain.handle(channel, (event, options: unknown) => {
    assertTrustedIpcSender(event)
    if (!isExternalAgentReadOptions(options)) throw new Error('Invalid external agent history options')
    return read(options)
  })
  ipcMain.handle('app:external-agent-preferences', (event) => {
    assertTrustedIpcSender(event)
    return externalAgentImport.getPreferences()
  })
  ipcMain.handle('app:external-agent-sync', (event, options: unknown) => {
    assertTrustedIpcSender(event)
    if (!isExternalAgentSyncOptions(options)) throw new Error('Invalid external agent sync options')
    return externalAgentImport.setSync(options)
  })
  ipcMain.handle('app:external-agent-mcp-authenticate', async (event, name: unknown) => {
    assertTrustedIpcSender(event)
    if (!isExternalAgentImportIdentifier(name)) throw new Error('Invalid MCP server name')
    const result = await appServer.request<{ authorizationUrl: string }>('mcpServer/oauth/login', { name })
    if (!isExternalAgentMcpAuthenticationUrl(result.authorizationUrl)) throw new Error('The server returned an invalid MCP authorization URL')
    await shell.openExternal(result.authorizationUrl)
    return result
  })
  ipcMain.handle('codex:invoke', async (event, method: unknown, params?: unknown, requestedHostId?: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (!isAllowedRendererRpc(method, params)) {
      throw new Error(`Renderer cannot invoke method: ${String(method)}`)
    }
    const hostId = hostForRequest(window, requestedHostId)
    if (hostId === 'local') {
      composerPathGrants.assertAllowedRpc(method, params)
      skillPathGrants.assertAllowedRpc(method, params)
    }
    const rpcParams = params as JsonMap | undefined
    const result = await hostAppServers.request(hostId, method, rpcParams)
    if (hostId === 'local') {
      await workspaceRootGrants.rememberThreadResult(method, result)
      await workspaceRootGrants.rememberProjectResult(method, result)
      if (method === 'skills/list') skillPathGrants.rememberList(result)
    }
    ephemeralThreads.rememberRendererResult(method, rpcParams, result)
    if (hostId === 'local') threadImagePathGrants.grantFromTrustedPayload(result)
    return method === 'account/login/start' ? authenticationUrls.remember(result) : result
  })

  ipcMain.handle('codex:status', (event, requestedHostId?: unknown) => {
    const window = assertTrustedIpcSender(event)
    return hostAppServers.getStatus(hostForRequest(window, requestedHostId))
  })
  ipcMain.handle('codex:restart', async (event, requestedHostId?: unknown) => {
    const window = assertTrustedIpcSender(event)
    await hostAppServers.restart(hostForRequest(window, requestedHostId))
  })
  ipcMain.handle('app:set-active-host', (event, requestedHostId: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (requestedHostId !== 'local' && (typeof requestedHostId !== 'string' || !requestedHostId)) {
      throw new Error('Invalid host ID')
    }
    const hostId = hostForRequest(window, requestedHostId)
    setActiveHost(window, hostId)
  })
  ipcMain.handle('codex:list-pending-server-requests', (event, requestedHostId?: unknown) => {
    const window = assertTrustedIpcSender(event)
    return hostAppServers
      .getPendingServerRequests(hostForRequest(window, requestedHostId))
      .map((request) => routeServerRequestToRenderer(ephemeralThreads, request).request)
  })
  ipcMain.handle(
    'codex:respond',
    (event, id: RpcId, response: RpcServerResponse, requestedHostId?: unknown) => {
      const window = assertTrustedIpcSender(event)
      return hostAppServers.respond(hostForRequest(window, requestedHostId), id, response)
    }
  )
  ipcMain.handle('app:context', async (event, cwd?: unknown) => {
    assertTrustedIpcSender(event)
    const requestedCwd = typeof cwd === 'string' ? cwd : undefined
    const context = await appContext(requestedCwd, requestedCwd === undefined)
    return requestedCwd === undefined ? {...context, initialCwdSource: launchWorkingDirectory.source} : context
  })
  ipcMain.handle('app:ssh-connections-discover', async (event) => {
    assertTrustedIpcSender(event)
    return discoverSshConnections(join(app.getPath('home'), '.ssh', 'config'))
  })
  ipcMain.handle('app:remote-connections-list', (event) => {
    assertTrustedIpcSender(event)
    return hostAppServers.listConnections()
  })
  ipcMain.handle('app:remote-connection-save', async (event, value: unknown) => {
    assertTrustedIpcSender(event)
    const options = record(value)
    if (!options || (options.sshAlias !== undefined && typeof options.sshAlias !== 'string') ||
        (options.host !== undefined && typeof options.host !== 'string') ||
        (options.port !== undefined && options.port !== null && typeof options.port !== 'number') ||
        (options.identityFile !== undefined && typeof options.identityFile !== 'string') ||
        (options.hostId !== undefined && typeof options.hostId !== 'string') ||
        (options.displayName !== undefined && typeof options.displayName !== 'string')) {
      throw new Error('Invalid remote connection')
    }
    const saved = await hostAppServers.saveConnection({
      ...(typeof options.hostId === 'string' ? { hostId: options.hostId } : {}),
      ...(typeof options.sshAlias === 'string' ? { sshAlias: options.sshAlias } : {}),
      ...(typeof options.host === 'string' ? { host: options.host } : {}),
      ...(options.port === null ? { port: null } : typeof options.port === 'number' ? { port: options.port } : {}),
      ...(typeof options.identityFile === 'string' ? { identityFile: options.identityFile } : {}),
      ...(typeof options.displayName === 'string' ? { displayName: options.displayName } : {})
    })
    if (typeof options.hostId === 'string') await hostTerminalSessions.disposeHost(options.hostId)
    return saved
  })
  ipcMain.handle('app:remote-connection-delete', async (event, hostId: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId) throw new Error('Invalid host ID')
    await hostAppServers.deleteConnection(hostId)
    await hostTerminalSessions.disposeHost(hostId)
    invalidateActiveHost(hostId, 'deleted')
  })
  ipcMain.handle('app:remote-connection-connect', async (event, hostId: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId) throw new Error('Invalid host ID')
    return hostAppServers.connect(hostId)
  })
  ipcMain.handle('app:remote-connection-disconnect', async (event, hostId: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId) throw new Error('Invalid host ID')
    const result = await hostAppServers.disconnect(hostId)
    invalidateActiveHost(hostId, 'disconnected')
    return result
  })
  ipcMain.handle('app:remote-projects-list', (event) => {
    assertTrustedIpcSender(event)
    return hostAppServers.listProjects()
  })
  ipcMain.handle('app:remote-project-create', async (event, value: unknown) => {
    assertTrustedIpcSender(event)
    const options = record(value)
    if (!options || typeof options.hostId !== 'string' || typeof options.remotePath !== 'string' ||
        (options.label !== undefined && typeof options.label !== 'string')) {
      throw new Error('Invalid remote project')
    }
    const validated = await hostAppServers.validateRemotePath(options.hostId, options.remotePath)
    if (!validated.exists) throw new Error('Remote project directory does not exist')
    if (!validated.isDirectory || !validated.path) throw new Error('Remote project path is not a directory')
    const createOptions: CreateRemoteProjectOptions = {
      hostId: options.hostId,
      remotePath: validated.path,
      ...(typeof options.label === 'string' ? { label: options.label } : {})
    }
    return hostAppServers.createProject(createOptions)
  })
  ipcMain.handle('app:remote-project-delete', (event, id: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof id !== 'string' || !id) throw new Error('Invalid remote project ID')
    hostAppServers.deleteProject(id)
  })
  ipcMain.handle('app:remote-path-validate', (event, hostId: unknown, path: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId || typeof path !== 'string') {
      throw new Error('Invalid remote path request')
    }
    return hostAppServers.validateRemotePath(hostId, path)
  })
  ipcMain.handle('app:remote-directory-create', (event, hostId: unknown, path: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId || typeof path !== 'string') {
      throw new Error('Invalid remote directory request')
    }
    return hostAppServers.createRemoteDirectory(hostId, path)
  })
  ipcMain.handle('app:remote-directory-list', (event, hostId: unknown, path?: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId ||
        (path !== undefined && typeof path !== 'string')) {
      throw new Error('Invalid remote directory listing request')
    }
    return hostAppServers.listRemoteDirectory(hostId, typeof path === 'string' ? path : undefined)
  })
  ipcMain.handle('app:remote-context', async (event, hostId: unknown, cwd: unknown, projectId?: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof hostId !== 'string' || !hostId || typeof cwd !== 'string' ||
        (projectId !== undefined && typeof projectId !== 'string')) {
      throw new Error('Invalid remote context request')
    }
    return hostAppServers.getRemoteAppContext(
      hostId,
      cwd,
      typeof projectId === 'string' ? projectId : undefined
    )
  })
  ipcMain.handle('app:info', (event): AppInfo => {
    assertTrustedIpcSender(event)
    return {
      implementationVersion: app.getVersion(),
      ...targetInfo
    }
  })
  ipcMain.handle('app:desktop-preferences', (event) => {
    assertTrustedIpcSender(event)
    return { ...desktopPreferences }
  })
  ipcMain.handle('app:document-generation', (event) => {
    const window = assertTrustedIpcSender(event)
    return rendererDocuments.generation(window)
  })
  ipcMain.handle('app:update-desktop-preferences', (event, preferences: unknown) => {
    assertTrustedIpcSender(event)
    if (!isDesktopPreferences(preferences)) throw new Error('Invalid desktop preferences')
    const next = mergeDesktopPreferences(preferences, desktopPreferences)
    desktopPreferencesStore.save(next)
    desktopPreferences = next
    applyNativeAppearance()
    updateDockNotificationDot()
    updateSleepAssertion()
    sendToRenderer('app:desktop-preferences-changed', { ...next })
  })
  ipcMain.handle('app:scheduled-tasks-list', (event) => {
    assertTrustedIpcSender(event)
    return scheduledTasks.list()
  })
  ipcMain.handle('app:scheduled-task-save', (event, task: unknown) => {
    assertTrustedIpcSender(event)
    return scheduledTasks.save(task)
  })
  ipcMain.handle('app:scheduled-task-delete', (event, id: unknown) => {
    assertTrustedIpcSender(event)
    scheduledTasks.delete(id)
  })
  ipcMain.handle('app:scheduled-task-status', (event, id: unknown, taskStatus: unknown) => {
    assertTrustedIpcSender(event)
    return scheduledTasks.setStatus(id, taskStatus)
  })
  ipcMain.handle('app:scheduled-task-run-now', (event, id: unknown) => {
    assertTrustedIpcSender(event)
    return scheduledTasks.runNow(id)
  })
  ipcMain.handle('app:scheduled-task-pending-runs', (event) => {
    const window = assertTrustedIpcSender(event)
    return scheduledTaskRunnerWindow() === window ? scheduledTasks.listPendingRuns() : []
  })
  ipcMain.handle('app:scheduled-task-bind-thread', (event, runId: unknown, threadId: unknown) => {
    assertTrustedIpcSender(event)
    return scheduledTasks.bindRunThread(runId, threadId)
  })
  ipcMain.handle('app:scheduled-task-acknowledge-run', (event, runId: unknown, threadId?: unknown) => {
    assertTrustedIpcSender(event)
    scheduledTasks.acknowledgeRun(runId, threadId)
  })
  ipcMain.handle('app:window-close-ready', (event, ready: unknown, generation: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (typeof ready !== 'boolean') throw new Error('Invalid window close readiness')
    rendererDocuments.assertCurrent(window, generation)
    windowCloseBroker.setReady(window, ready)
  })
  ipcMain.handle('app:close-current-view-ready', (event, ready: unknown, generation: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (typeof ready !== 'boolean') throw new Error('Invalid close command readiness')
    rendererDocuments.assertCurrent(window, generation)
    if (ready) closeCurrentViewReady.add(window)
    else closeCurrentViewReady.delete(window)
  })
  ipcMain.handle('app:request-window-close', (event, origin: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (!isWindowCloseOrigin(origin)) throw new Error('Invalid window close origin')
    windowCloseController.requestClose(window, origin)
  })
  ipcMain.handle('app:respond-window-close', (event, id: unknown, response: unknown) => {
    const window = assertTrustedIpcSender(event)
    windowCloseBroker.respond(window, id, response)
  })
  ipcMain.handle('app:window-zoom', (event) => {
    const window = assertTrustedIpcSender(event)
    return windowZooms.get(window) ?? 1
  })
  ipcMain.handle('app:set-window-zoom', (event, factor: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (!isWindowZoom(factor)) throw new Error('Invalid window zoom factor')
    setWindowZoom(window, factor)
  })
  ipcMain.handle('app:open-thread-ready', (event, ready: unknown, generation: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (typeof ready !== 'boolean') throw new Error('Invalid notification route readiness')
    rendererDocuments.assertCurrent(window, generation)
    const receiver = ready && !window.isDestroyed()
      ? (request: OpenThreadRequest) => window.webContents.send('app:open-thread', request)
      : null
    windowThreadRouter.setReceiver(window, receiver)
    if (window === mainWindow) notificationThreadRouter.setReceiver(receiver)
  })
  ipcMain.handle('app:acknowledge-open-thread', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    if (windowThreadRouter.acknowledge(window, id)) return
    if (window !== mainWindow) throw new Error('Unknown or expired window route')
    notificationThreadRouter.acknowledge(id)
  })
  ipcMain.handle('app:open-thread-in-new-window', (event, threadId: unknown, requestedHostId?: unknown) => {
    const sourceWindow = assertTrustedIpcSender(event)
    if (!isDesktopThreadId(threadId)) throw new Error('Invalid thread identifier')
    createWindow({ threadId, hostId: hostForRequest(sourceWindow, requestedHostId) })
  })
  ipcMain.handle('app:open-terminal', async (event, options: unknown) => {
    const window = assertTrustedIpcSender(event)
    const hostId = activeHostId(window)
    const documentGeneration = rendererDocuments.generation(window)
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Invalid terminal options')
    }
    const value = options as Record<string, unknown>
    if (Object.keys(value).some((key) => !['cwd', 'cols', 'rows'].includes(key)) ||
        typeof value.cwd !== 'string') {
      throw new Error('Terminal working directory has not been selected')
    }
    const size = validateTerminalSize({ cols: value.cols as number, rows: value.rows as number })
    let cwd: string
    if (hostId === 'local') {
      if (!workspaceRootGrants.allows({ root: value.cwd, path: value.cwd })) {
        throw new Error('Terminal working directory has not been selected')
      }
      cwd = await realpath(value.cwd)
      if (!(await stat(cwd)).isDirectory()) throw new Error('Terminal working directory is unavailable')
    } else {
      cwd = assertRemoteWorkspacePath(hostId, value.cwd)
      const validation = await hostAppServers.validateRemotePath(hostId, cwd)
      if (!validation.exists || !validation.isDirectory || !validation.path) {
        throw new Error('Remote terminal working directory is unavailable')
      }
      cwd = validation.path
    }
    if (window.isDestroyed() || !managedWindows.has(window) ||
        rendererDocuments.generation(window) !== documentGeneration || activeHostId(window) !== hostId) {
      throw new Error('Terminal window changed while opening')
    }
    if (assertTrustedIpcSender(event) !== window) throw new Error('Terminal window changed while opening')
    const parsed: TerminalOpenOptions = { cwd, ...size }
    const session = hostTerminalSessions.forHost(hostId).open(event.sender.id, parsed)
    hostTerminalSessions.rememberSession(session.id, hostId)
    return session
  })
  ipcMain.handle('app:write-terminal', async (event, id: string, data: string) => {
    assertTrustedIpcSender(event)
    const hostId = hostTerminalSessions.hostForSession(id)
    if (!hostId) throw new Error('Terminal session is unavailable')
    await hostTerminalSessions.forHost(hostId).write(event.sender.id, id, data)
  })
  ipcMain.handle('app:resize-terminal', async (event, id: string, size: unknown) => {
    assertTrustedIpcSender(event)
    if (!size || typeof size !== 'object' || Array.isArray(size) ||
        Object.keys(size).some((key) => key !== 'cols' && key !== 'rows')) throw new Error('Invalid terminal dimensions')
    const value = size as Record<string, unknown>
    const hostId = hostTerminalSessions.hostForSession(id)
    if (!hostId) throw new Error('Terminal session is unavailable')
    await hostTerminalSessions.forHost(hostId).resize(event.sender.id, id, { cols: value.cols as number, rows: value.rows as number })
  })
  ipcMain.handle('app:close-terminal', async (event, id: string) => {
    assertTrustedIpcSender(event)
    const hostId = hostTerminalSessions.hostForSession(id)
    if (!hostId) return
    try {
      await hostTerminalSessions.forHost(hostId).close(event.sender.id, id)
    } finally {
      hostTerminalSessions.forgetSession(id)
    }
  })
  ipcMain.handle('app:browser-view-create', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    return currentBrowserViews(window).create(id)
  })
  ipcMain.handle('app:browser-view-navigate', (event, id: unknown, url: unknown) => {
    const window = assertTrustedIpcSender(event)
    return currentBrowserViews(window).navigate(id, url)
  })
  ipcMain.handle('app:browser-view-back', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).goBack(id)
  })
  ipcMain.handle('app:browser-view-forward', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).goForward(id)
  })
  ipcMain.handle('app:browser-view-reload', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).reload(id)
  })
  ipcMain.handle('app:browser-view-stop', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).stop(id)
  })
  ipcMain.handle('app:browser-view-find', (event, id: unknown, query: unknown, options: unknown) => {
    return currentBrowserViews(assertTrustedIpcSender(event)).find(id, query, options)
  })
  ipcMain.handle('app:browser-view-stop-finding', (event, id: unknown) => {
    currentBrowserViews(assertTrustedIpcSender(event)).stopFinding(id)
  })
  ipcMain.handle('app:browser-view-zoom', (event, id: unknown, factor: unknown) => {
    currentBrowserViews(assertTrustedIpcSender(event)).setZoom(id, factor)
  })
  ipcMain.handle('app:browser-view-bounds', (event, id: unknown, bounds: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).setBounds(id, bounds)
  })
  ipcMain.handle('app:browser-view-active', (event, id: unknown, active: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).setActive(id, active)
  })
  ipcMain.handle('app:browser-view-close', (event, id: unknown) => {
    const window = assertTrustedIpcSender(event)
    currentBrowserViews(window).close(id)
  })
  ipcMain.handle('app:browser-top-sites-list', (event) => {
    assertTrustedIpcSender(event)
    return browserHistoryStore.list()
  })
  ipcMain.handle('app:browser-top-site-dismiss', (event, url: unknown) => {
    assertTrustedIpcSender(event)
    return browserHistoryStore.dismiss(url)
  })
  ipcMain.handle('app:browser-top-site-restore', (event, url: unknown) => {
    assertTrustedIpcSender(event)
    return browserHistoryStore.restore(url)
  })
  ipcMain.handle('app:git-metadata', (event, cwd: unknown, options?: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Git metadata')
    const parsedOptions: GitMetadataOptions = {
      redactRemoteNames:
        options &&
        typeof options === 'object' &&
        !Array.isArray(options) &&
        typeof (options as Record<string, unknown>).redactRemoteNames === 'boolean'
          ? (options as Record<string, boolean>).redactRemoteNames
          : true
    }
    return readGitMetadata(cwd, parsedOptions)
  })
  ipcMain.handle('app:create-managed-worktree', async (event, options: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Managed worktrees')
    const parsed = validateWorktreeCreateOptions(options)
    if (!workspaceRootGrants.allows({ root: parsed.cwd, path: parsed.cwd })) {
      throw new Error('Worktree source directory has not been selected')
    }
    const generation = rendererDocuments.generation(window)
    const assertCurrent = (): void => {
      if (assertTrustedIpcSender(event) !== window || window.isDestroyed() || !managedWindows.has(window) ||
          rendererDocuments.generation(window) !== generation) {
        throw new Error('Worktree window changed while creating')
      }
    }
    const result = await managedWorktrees.create(parsed, assertCurrent)
    workspaceRootGrants.grant(result.worktreeGitRoot)
    workspaceRootGrants.grant(result.worktreeWorkspaceRoot)
    assertCurrent()
    return result
  })
  ipcMain.handle('app:fork-thread-in-new-worktree', async (event, options: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Managed worktrees')
    const generation = rendererDocuments.generation(window)
    const parsed = validateForkThreadInNewWorktreeOptions(options)
    if (!workspaceRootGrants.allows({ root: parsed.cwd, path: parsed.cwd })) {
      throw new Error('Worktree source directory has not been selected')
    }
    const assertCurrent = (): void => {
      if (assertTrustedIpcSender(event) !== window || window.isDestroyed() || !managedWindows.has(window) ||
          rendererDocuments.generation(window) !== generation) {
        throw new Error('Worktree fork window changed while creating')
      }
    }
    const result = await forkThreadInNewWorktree(
      managedWorktrees,
      appServer,
      parsed,
      assertCurrent,
      (worktree) => {
        workspaceRootGrants.grant(worktree.worktreeGitRoot)
        workspaceRootGrants.grant(worktree.worktreeWorkspaceRoot)
      }
    )
    await workspaceRootGrants.rememberThreadResult('thread/fork', { thread: result.thread })
    return result
  })
  ipcMain.handle('app:list-git-branches', async (event, cwd: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Git branches')
    if (typeof cwd !== 'string' || !workspaceRootGrants.allows({ root: cwd, path: cwd })) {
      throw new Error('Branch source directory has not been selected')
    }
    const generation = rendererDocuments.generation(window)
    const result = await readGitBranches(cwd)
    if (assertTrustedIpcSender(event) !== window || window.isDestroyed() || !managedWindows.has(window) ||
        rendererDocuments.generation(window) !== generation) {
      throw new Error('Branch window changed while reading')
    }
    return result
  })
  ipcMain.handle('app:list-managed-worktrees', async (event, cwd: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Managed worktrees')
    if (typeof cwd !== 'string' || !workspaceRootGrants.allows({ root: cwd, path: cwd })) {
      throw new Error('Worktree source directory has not been selected')
    }
    const results = await managedWorktrees.list(cwd)
    for (const result of results) {
      workspaceRootGrants.grant(result.worktreeGitRoot)
      workspaceRootGrants.grant(result.worktreeWorkspaceRoot)
    }
    return results
  })
  ipcMain.handle('app:workspace-read-directory', (event, request: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Workspace files')
    if (!isAllowedWorkspacePathRequest(request) || !workspaceRootGrants.allows(request)) {
      throw new Error('Blocked invalid workspace directory request')
    }
    return readWorkspaceDirectory(appServer, request)
  })
  ipcMain.handle('app:workspace-read-file', (event, request: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Workspace files')
    if (!isAllowedWorkspacePathRequest(request) || !workspaceRootGrants.allows(request)) {
      throw new Error('Blocked invalid workspace file request')
    }
    return readWorkspaceFile(appServer, request)
  })
  ipcMain.handle('app:workspace-text-diff', async (event, before: unknown, after: unknown, options: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Workspace text diff')
    const generation = rendererDocuments.generation(window)
    const result = await diffWorkspaceText(before, after, options)
    if (assertTrustedIpcSender(event) !== window || window.isDestroyed() || !managedWindows.has(window) ||
        rendererDocuments.generation(window) !== generation) {
      throw new Error('Workspace document changed while computing diff')
    }
    return result
  })
  ipcMain.handle('app:workspace-save-file', (event, request: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Workspace file editing')
    if (!isWorkspaceFileSaveRequest(request) || !workspaceRootGrants.allows({ root: request.root, path: request.path })) {
      throw new Error('Blocked invalid workspace save request')
    }
    return saveWorkspaceFile(request)
  })
  ipcMain.handle('app:workspace-watch', async (event, request: unknown, generation: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Workspace file watching')
    if (rendererDocuments.generation(window) !== generation || !isWorkspaceWatchRequest(request) ||
        !workspaceRootGrants.allows({ root: request.root, path: request.root }) ||
        [...request.directories, ...request.files].some((path) => !workspaceRootGrants.allows({ root: request.root, path }))) {
      throw new Error('Blocked invalid workspace watch request')
    }
    const id = await workspaceWatchers.start(window.id, request)
    try {
      assertTrustedIpcSender(event)
      if (window.isDestroyed() || rendererDocuments.generation(window) !== generation) throw new Error('Workspace document changed while subscribing')
    } catch (error) {
      workspaceWatchers.stop(window.id, id)
      throw error
    }
    return id
  })
  ipcMain.handle('app:workspace-unwatch', (event, id: unknown) => {
    assertTrustedIpcSender(event)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && typeof id === 'string') workspaceWatchers.stop(window.id, id)
  })
  ipcMain.handle('app:workspace-open-targets', (event) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Opening workspace files')
    return listWorkspaceOpenTargets(loadMacWorkspaceApplicationIcon)
  })
  ipcMain.handle('app:workspace-open-path', async (event, request: unknown, target: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Opening workspace files')
    if (!isAllowedWorkspacePathRequest(request) || !workspaceRootGrants.allows(request) || typeof target !== 'string' ||
        !['finder', 'terminal', 'vscode', 'cursor', 'zed', 'windsurf'].includes(target)) throw new Error('Blocked workspace open request')
    const metadata = await stat(request.path)
    const path = await canonicalWorkspaceTarget(request, metadata.isDirectory() ? 'directory' : 'file')
    const appPath = await workspaceTargetApplication(target as WorkspaceOpenTargetId)
    assertTrustedIpcSender(event)
    if (target === 'finder') { if (metadata.isDirectory()) { const error = await shell.openPath(path); if (error) throw new Error(error) } else shell.showItemInFolder(path) }
    else await execFileAsync('/usr/bin/open', ['-a', target === 'terminal' ? 'Terminal' : appPath!, target === 'terminal' && !metadata.isDirectory() ? dirname(path) : path])
  })
  ipcMain.handle('app:workspace-save-copy', async (event, request: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Saving workspace files')
    if (!isWorkspaceSaveCopyRequest(request) || !workspaceRootGrants.allows({ root: request.root, path: request.path })) throw new Error('Blocked workspace save copy request')
    const generation = rendererDocuments.generation(window)
    return saveWorkspaceFileCopy(request, async (defaultPath) => {
      const result = await dialog.showSaveDialog(window, { title: '另存为', defaultPath, properties: ['showOverwriteConfirmation', 'createDirectory'] })
      return result.canceled || !result.filePath ? null : result.filePath
    }, () => {
      assertTrustedIpcSender(event)
      if (window.isDestroyed() || rendererDocuments.generation(window) !== generation) throw new Error('Workspace document changed while saving a copy')
    })
  })
  ipcMain.handle('app:read-thread-image', (event, path: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Thread image previews')
    return readThreadImage(appServer, threadImagePathGrants, path)
  })
  ipcMain.handle('app:copy-thread-image', async (event, path: unknown) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Copying thread images')
    const image = await readThreadImage(appServer, threadImagePathGrants, path)
    await writeClipboardImage(
      Buffer.from(image.dataBase64, 'base64'),
      nativeImage.createFromBuffer,
      writeNativeClipboardImage
    )
  })
  ipcMain.handle('app:copy-inline-image', async (event, source: unknown) => {
    assertTrustedIpcSender(event)
    await writeClipboardImage(inlineClipboardImageBytes(source), nativeImage.createFromBuffer, writeNativeClipboardImage)
  })
  ipcMain.handle('app:copy-text', async (event, text: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof text !== 'string') throw new Error('Invalid clipboard text')
    await clipboard.writeText(text)
  })
  ipcMain.handle('app:open-external', async (event, url: unknown) => {
    assertTrustedIpcSender(event)
    if (!isAllowedExternalUrl(url)) throw new Error('Blocked untrusted external URL')
    await shell.openExternal(url)
  })
  ipcMain.handle('app:open-authentication-url', async (event, url: unknown) => {
    assertTrustedIpcSender(event)
    if (!isAllowedAuthenticationUrl(url) || !authenticationUrls.consume(url)) {
      throw new Error('Blocked untrusted authentication URL')
    }
    await shell.openExternal(url)
  })
  ipcMain.handle('app:pick-directory', async (event) => {
    const window = assertTrustedIpcSender(event)
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a working folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return appContext(result.filePaths[0], true)
  })
  ipcMain.handle('app:pick-composer-attachments', async (event) => {
    const window = assertTrustedIpcSender(event)
    assertLocalHost(window, 'Local composer attachments')
    const result = await dialog.showOpenDialog(window, {
      title: 'Add photos and files',
      buttonLabel: 'Add',
      properties: composerAttachmentPickerProperties()
    })
    if (result.canceled) return []

    const selections = await Promise.all(
      result.filePaths.slice(0, MAX_COMPOSER_ATTACHMENTS).map(async (filePath) => {
        try {
          const entry = await stat(filePath)
          if (!entry.isFile() && !entry.isDirectory()) return null
          return describeComposerAttachment(filePath, entry.isDirectory())
        } catch {
          return null
        }
      })
    )
    const attachments = selections.filter((selection) => selection !== null)
    composerPathGrants.grant(attachments.map((attachment) => attachment.path))
    threadImagePathGrants.grantFromPicker(
      attachments
        .filter((attachment) => attachment.kind === 'image')
        .map((attachment) => attachment.path)
    )
    return attachments
  })
  ipcMain.handle(
    'app:open-working-directory',
    async (event, cwd: unknown, target: unknown) => {
      const window = assertTrustedIpcSender(event)
      assertLocalHost(window, 'Opening the working directory')
      if (
        typeof cwd !== 'string' ||
        cwd.length === 0 ||
        cwd.length > 4096 ||
        cwd.includes('\0') ||
        !isAbsolute(cwd) ||
        normalize(cwd) !== cwd ||
        (target !== 'finder' && target !== 'terminal')
      ) {
        throw new Error('Invalid working-directory target')
      }
      if (!(await stat(cwd)).isDirectory()) throw new Error('Working directory is unavailable')

      if (target === 'finder') {
        const failure = await shell.openPath(cwd)
        if (failure) throw new Error(failure)
        return
      }
      await execFileAsync('/usr/bin/open', ['-a', 'Terminal', cwd], { timeout: 2500 })
    }
  )
}

function createWindow(options: { primary?: boolean; threadId?: string; hostId?: HostId } = {}): BrowserWindow {
  const isPrimary = options.primary ?? managedWindows.size === 0
  const savedWindowState = windowStateStore.load()
  const cascadeOffset = isPrimary ? 0 : 24 * Math.min(managedWindows.size, 5)
  const savedBounds = savedWindowState?.bounds
    ? {
        ...savedWindowState.bounds,
        x: savedWindowState.bounds.x + cascadeOffset,
        y: savedWindowState.bounds.y + cascadeOffset
      }
    : null
  const restoredBounds = restoreWindowBounds(
    savedBounds,
    screen.getAllDisplays().map((display) => display.workArea),
    { width: 1420, height: 900 }
  )
  const window = new BrowserWindow({
    ...restoredBounds,
    show: false,
    title: 'Codex',
    backgroundColor: windowBackgroundColor(),
    ...macosWindowOptions(),
    visualEffectState: 'active',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      scrollBounce: true
    }
  })
  managedWindows.add(window)
  setActiveHost(window, options.hostId ?? 'local')
  if (options.threadId) windowThreadRouter.open(window, options.threadId, options.hostId ?? 'local')
  const rendererOwner = window.webContents.id
  const windowBrowserViews = new BrowserViews(
    window,
    (options) => new WebContentsView(options),
    (event) => {
      if (!window.isDestroyed()) window.webContents.send('app:browser-view-event', event)
    },
    browserHistoryStore
  )
  browserViewsByWindow.set(window, windowBrowserViews)
  let windowStateSaveTimer: NodeJS.Timeout | null = null

  const saveWindowState = (): void => {
    if (!isPrimary || window.isDestroyed()) return
    try {
      windowStateStore.save({
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized(),
        fullScreen: window.isFullScreen()
      })
    } catch (error) {
      if (process.env.CODEX_APP_DEBUG) console.error('Failed to save window state', error)
    }
  }
  const scheduleWindowStateSave = (): void => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null
      saveWindowState()
    }, 250)
  }

  window.once('ready-to-show', () => {
    if (isPrimary && savedWindowState?.maximized) window.maximize()
    if (isPrimary && savedWindowState?.fullScreen) window.setFullScreen(true)
    window.show()
  })
  window.on('move', scheduleWindowStateSave)
  window.on('resize', scheduleWindowStateSave)
  window.on('maximize', scheduleWindowStateSave)
  window.on('unmaximize', scheduleWindowStateSave)
  window.on('enter-full-screen', scheduleWindowStateSave)
  window.on('leave-full-screen', scheduleWindowStateSave)
  window.on('close', (event) => {
    if (!quitAfterShutdown && windowCloseController.shouldPreventClose(window)) {
      event.preventDefault()
      return
    }
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer)
      windowStateSaveTimer = null
    }
    saveWindowState()
    if (process.platform === 'darwin' && !quitAfterShutdown && isPrimary) {
      event.preventDefault()
      if (window.isFullScreen()) {
        window.once('leave-full-screen', () => { if (!window.isDestroyed()) window.hide() })
        window.setFullScreen(false)
      } else window.hide()
    }
  })
  window.on('closed', () => {
    windowBrowserViews.dispose()
    browserViewsByWindow.delete(window)
    managedWindows.delete(window)
    workspaceWatchers.closeOwner(window.id)
    void closeTerminalOwner(rendererOwner)
    windowCloseBroker.setReady(window, false)
    closeCurrentViewReady.delete(window)
    windowThreadRouter.forget(window)
    if (isPrimary) notificationThreadRouter.setReceiver(null)
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.on('did-start-navigation', (event) => {
    if (!event.isMainFrame || event.isSameDocument) return
    rendererDocuments.invalidate(window)
    windowBrowserViews.reset()
    workspaceWatchers.closeOwner(window.id)
    void closeTerminalOwner(rendererOwner)
    windowCloseBroker.setReady(window, false)
    closeCurrentViewReady.delete(window)
    windowThreadRouter.setReceiver(window, null)
    if (isPrimary) notificationThreadRouter.setReceiver(null)
  })
  window.webContents.on('did-finish-load', () => replayPendingScheduledTaskRuns(window))
  window.webContents.on('render-process-gone', () => {
    rendererDocuments.invalidate(window)
    windowBrowserViews.reset()
    workspaceWatchers.closeOwner(window.id)
    void closeTerminalOwner(rendererOwner)
    windowCloseBroker.setReady(window, false)
    closeCurrentViewReady.delete(window)
    windowThreadRouter.setReceiver(window, null)
    if (isPrimary) notificationThreadRouter.setReceiver(null)
  })
  window.webContents.on('zoom-changed', (event, direction) => {
    event.preventDefault()
    setWindowZoom(window, steppedWindowZoom(windowZooms.get(window) ?? 1, direction === 'in' ? 1 : -1))
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url).catch((error: unknown) => {
        if (process.env.CODEX_APP_DEBUG) console.error('Failed to open external URL', error)
      })
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault()
  })
  window.webContents.on('will-navigate', (event) => {
    if (event.url !== window.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadURL(APP_ENTRY_URL)
  }

  return window
}

app.setName('Codex')
appServer.on('notification', (notification: RpcNotification) => {
  runningTurns.remember(notification)
  updateSleepAssertion()
  ephemeralThreads.rememberNotification(notification)
  if (notification.method === 'account/login/completed') authenticationUrls.clear()
  threadImagePathGrants.grantFromTrustedPayload(notification)
  sendToHostRenderer('local', 'codex:notification', notification)
  if (
    !ephemeralThreads.ownsEvent(notification.params) &&
    shouldDeliverDesktopNotification(desktopPreferences, 'notification', notification.method, anyManagedWindowFocused())
  ) {
    showBackgroundNotification(notificationForServerEvent('notification', notification.method), notification.params)
  }
})
appServer.on('server-request', (request: RpcServerRequest) => {
  const route = routeServerRequestToRenderer(ephemeralThreads, request)
  sendToHostRenderer('local', 'codex:server-request', route.request)
  if (
    route.showBackgroundNotification &&
    shouldDeliverDesktopNotification(desktopPreferences, 'server-request', request.method, anyManagedWindowFocused())
  ) {
    showBackgroundNotification(notificationForServerEvent('server-request', request.method), request.params)
  }
})
appServer.on('status', (status: BackendStatus) => {
  if (status.state !== 'ready') {
    runningTurns.clear()
    updateSleepAssertion()
  }
  if (status.state === 'starting') {
    ephemeralThreads.reset()
    skillPathGrants.clear()
  }
  sendToHostRenderer('local', 'codex:backend-status', status)
  if (status.state === 'ready') notificationThreadRouter.replay()
})
appServer.on('server-log', (line: string) => {
  if (process.env.CODEX_APP_DEBUG) process.stderr.write(line)
})

hostAppServers.on('notification', (hostId: string, notification: RpcNotification) => {
  runningTurns.remember(notification)
  updateSleepAssertion()
  ephemeralThreads.rememberNotification(notification)
  if (notification.method === 'account/login/completed') authenticationUrls.clear()
  sendToHostRenderer(hostId, 'codex:notification', notification)
})
hostAppServers.on('server-request', (hostId: string, request: RpcServerRequest) => {
  const route = routeServerRequestToRenderer(ephemeralThreads, request)
  sendToHostRenderer(hostId, 'codex:server-request', route.request)
})
hostAppServers.on('status', (hostId: string, status: BackendStatus) => {
  if (status.state !== 'ready') {
    runningTurns.clear()
    updateSleepAssertion()
  }
  sendToHostRenderer(hostId, 'codex:backend-status', status)
})
hostAppServers.on('server-log', (_hostId: string, line: string) => {
  if (process.env.CODEX_APP_DEBUG) process.stderr.write(line)
})
const publishRemoteConnections = (): void => {
  sendToRenderer('app:remote-connections-changed', hostAppServers.listConnections())
}
hostAppServers.on('connection-status', publishRemoteConnections)
hostAppServers.on('connection-removed', publishRemoteConnections)

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  void app.whenReady().then(async () => {
    applyNativeAppearance()
    await hydrateShellEnvironment()
    installRendererProtocol()
    installPermissionDenyPolicy(session.defaultSession)
    installIpcHandlers()
    mainWindow = createWindow({ primary: true })
    scheduledTasks.start()
    installApplicationMenu()
    void appServer.start().catch((error: unknown) => {
      if (process.env.CODEX_APP_DEBUG) console.error(error)
    })

    app.on('activate', focusMainWindow)
  })
}

app.on('window-all-closed', () => {
  // Keep the standard macOS lifecycle: the app remains available in the Dock.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitAfterShutdown) return
  event.preventDefault()
  quitAfterShutdown = true
  for (const window of managedWindows) {
    if (window.isDestroyed()) continue
    windowCloseBroker.setReady(window, false)
    closeCurrentViewReady.delete(window)
    windowThreadRouter.setReceiver(window, null)
  }
  notificationThreadRouter.setReceiver(null)
  scheduledTasks.stop()
  for (const browserViews of browserViewsByWindow.values()) browserViews.dispose()
  browserViewsByWindow.clear()
  workspaceWatchers.close()
  void Promise.allSettled([externalAgentImport.dispose(), disposeTerminalSessions(), hostAppServers.dispose()])
    .then(() => appServer.stop()).finally(() => app.quit())
})

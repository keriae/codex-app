import { EventEmitter } from 'node:events'
import { posix } from 'node:path'
import type {
  AppContext,
  BackendStatus,
  CreateRemoteProjectOptions,
  JsonMap,
  RemoteConnection,
  RemoteDirectoryListing,
  RemotePathValidation,
  RemoteProject,
  RpcId,
  RpcNotification,
  RpcServerRequest,
  RpcServerResponse,
  SaveRemoteConnectionOptions
} from '../shared/api'
import { AppServerClient } from './appServer'
import {
  normalizeRemotePath,
  RemoteConnectionStore,
  type StoredRemoteConnection
} from './remoteConnections'
import { shellQuote, SshAppServerConnector } from './sshAppServerTransport'

const REMOTE_ENDPOINT = { kind: 'websocket', url: 'ws://codex-app-server/rpc' } as const
const MAX_REMOTE_DIRECTORY_RESPONSE_ENTRIES = 5_000
const MAX_REMOTE_DIRECTORY_ENTRIES = 500
const MAX_REMOTE_DIRECTORY_NAME_BYTES = 256 * 1024
const MAX_REMOTE_ENTRY_NAME_LENGTH = 1_024
const DEFAULT_REMOTE_RECONNECT_MAX_ATTEMPTS = 8

interface RemoteHostRuntime {
  config: StoredRemoteConnection
  connector: SshAppServerConnector
  client: AppServerClient
}

export interface HostAppServerRegistryOptions {
  connectTimeoutSeconds?: number
  reconnectMaxAttempts?: number
  createConnector?: (connection: StoredRemoteConnection) => SshAppServerConnector
  createClient?: (
    connection: StoredRemoteConnection,
    connector: SshAppServerConnector
  ) => AppServerClient
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function statusState(status: BackendStatus): RemoteConnection['state'] {
  if (status.state === 'ready') return 'connected'
  if (status.state === 'starting') return 'connecting'
  if (status.state === 'error') return 'error'
  return 'disconnected'
}

function withHostId(value: unknown, hostId: string): unknown {
  return isRecord(value) ? { ...value, hostId } : value
}

function decorateRemoteThreadDataItem(value: unknown, hostId: string): unknown {
  if (!isRecord(value)) return value
  return isRecord(value.thread)
    ? { ...value, hostId, thread: withHostId(value.thread, hostId) }
    : { ...value, hostId }
}

/** Keep remote thread identity explicit even while legacy renderer state is active-host scoped. */
export function decorateRemoteThreadResult(method: string, result: unknown, hostId: string): unknown {
  if (!isRecord(result) || !method.startsWith('thread/')) return result
  let next: Record<string, unknown> = result
  let changed = false
  if (Array.isArray(result.data)) {
    next = { ...next, data: result.data.map((item) => decorateRemoteThreadDataItem(item, hostId)) }
    changed = true
  }
  if (isRecord(result.thread)) {
    next = { ...next, thread: withHostId(result.thread, hostId) }
    changed = true
  }
  // Some app-server revisions return the thread as the top-level result.
  if (typeof result.id === 'string' && ('cwd' in result || 'turns' in result)) {
    next = { ...next, hostId }
    changed = true
  }
  return changed ? next : result
}

function notificationForHost(notification: RpcNotification, hostId: string): RpcNotification {
  const decoratedParams = withHostId(notification.params, hostId)
  const params = isRecord(decoratedParams) && isRecord(decoratedParams.thread)
    ? {...decoratedParams, thread: withHostId(decoratedParams.thread, hostId)}
    : decoratedParams
  return {
    ...notification,
    hostId,
    params
  }
}

function requestForHost(request: RpcServerRequest, hostId: string): RpcServerRequest {
  return {
    ...request,
    hostId,
    params: withHostId(request.params, hostId)
  }
}

interface RemoteFsDirectoryEntry {
  fileName: string
  isDirectory: boolean
  isFile: boolean
}

interface RemoteFsMetadata {
  isDirectory: boolean
  isFile: boolean
}

function parseRemoteFsMetadata(value: unknown): RemoteFsMetadata {
  if (!isRecord(value) || typeof value.isDirectory !== 'boolean' || typeof value.isFile !== 'boolean' ||
      (value.isDirectory && value.isFile)) {
    throw new Error('Invalid remote filesystem metadata from app-server')
  }
  return { isDirectory: value.isDirectory, isFile: value.isFile }
}

function isMissingRemotePathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /(?:\bENOENT\b|No such file or directory|Not a directory|\(os error (?:2|20)\))/iu.test(error.message)
}

function parseRemoteDirectoryEntry(value: unknown): RemoteFsDirectoryEntry {
  if (!isRecord(value) || typeof value.fileName !== 'string' ||
      typeof value.isDirectory !== 'boolean' || typeof value.isFile !== 'boolean') {
    throw new Error('Invalid remote directory entry from app-server')
  }
  const fileName = value.fileName
  if (!fileName || fileName.length > MAX_REMOTE_ENTRY_NAME_LENGTH || fileName === '.' || fileName === '..' ||
      fileName.includes('/') || fileName.includes('\0') || /[\r\n]/u.test(fileName) ||
      (value.isDirectory && value.isFile)) {
    throw new Error('Invalid remote directory entry from app-server')
  }
  return { fileName, isDirectory: value.isDirectory, isFile: value.isFile }
}

export class HostAppServerRegistry extends EventEmitter {
  private readonly runtimes = new Map<string, RemoteHostRuntime>()
  private readonly statusByHost = new Map<string, BackendStatus>()
  private readonly options: HostAppServerRegistryOptions

  constructor(
    readonly localClient: AppServerClient,
    readonly store: RemoteConnectionStore,
    options: HostAppServerRegistryOptions = {}
  ) {
    super()
    this.options = options
  }

  listConnections(): RemoteConnection[] {
    return this.store.listConnections().map((connection) =>
      this.snapshot(connection, this.statusByHost.get(connection.hostId)))
  }

  async saveConnection(options: SaveRemoteConnectionOptions): Promise<RemoteConnection> {
    const connection = this.store.saveConnection(options)
    if (options.hostId) await this.disposeRuntime(options.hostId)
    const snapshot = this.snapshot(connection)
    this.emit('connection-status', snapshot)
    return snapshot
  }

  async deleteConnection(hostId: string): Promise<void> {
    await this.disposeRuntime(hostId)
    this.store.deleteConnection(hostId)
    this.statusByHost.delete(hostId)
    this.emit('connection-removed', hostId)
  }

  listProjects(): RemoteProject[] {
    return this.store.listProjects()
  }

  createProject(options: CreateRemoteProjectOptions): RemoteProject {
    return this.store.createProject(options)
  }

  deleteProject(id: string): void {
    this.store.deleteProject(id)
  }

  async connect(hostId: string): Promise<RemoteConnection> {
    const runtime = this.runtime(hostId)
    await runtime.client.start()
    return this.snapshot(runtime.config, runtime.client.getStatus())
  }

  async disconnect(hostId: string): Promise<RemoteConnection> {
    const runtime = this.runtimes.get(hostId)
    const config = this.store.getConnection(hostId)
    if (runtime) await runtime.client.stop()
    this.statusByHost.set(hostId, { state: 'stopped', mode: 'daemon' })
    const snapshot = this.snapshot(config, this.statusByHost.get(hostId))
    this.emit('connection-status', snapshot)
    return snapshot
  }

  async request<T = unknown>(hostId: string, method: string, params?: JsonMap): Promise<T> {
    if (hostId === 'local') return this.localClient.request<T>(method, params)
    const result = await this.runtime(hostId).client.request(method, params)
    return decorateRemoteThreadResult(method, result, hostId) as T
  }

  clientForHost(hostId: string): AppServerClient {
    return hostId === 'local' ? this.localClient : this.runtime(hostId).client
  }

  getStatus(hostId: string): BackendStatus {
    if (hostId === 'local') return this.localClient.getStatus()
    return this.runtimes.get(hostId)?.client.getStatus() ??
      this.statusByHost.get(hostId) ?? { state: 'stopped', mode: 'daemon' }
  }

  async restart(hostId: string): Promise<void> {
    const client = hostId === 'local' ? this.localClient : this.runtime(hostId).client
    await client.stop()
    await client.start()
  }

  getPendingServerRequests(hostId: string): RpcServerRequest[] {
    const requests = hostId === 'local'
      ? this.localClient.getPendingServerRequests()
      : this.runtime(hostId).client.getPendingServerRequests()
    return hostId === 'local' ? requests : requests.map((request) => requestForHost(request, hostId))
  }

  respond(hostId: string, id: RpcId, response: RpcServerResponse): Promise<void> {
    return hostId === 'local'
      ? this.localClient.respond(id, response)
      : this.runtime(hostId).client.respond(id, response)
  }

  async validateRemotePath(hostId: string, requestedPath: string): Promise<RemotePathValidation> {
    const path = normalizeRemotePath(requestedPath)
    let metadata: RemoteFsMetadata
    try {
      metadata = parseRemoteFsMetadata(
        await this.runtime(hostId).client.request('fs/getMetadata', { path })
      )
    } catch (error) {
      if (!isMissingRemotePathError(error)) throw error
      return {
        requestedPath: path,
        path: null,
        exists: false,
        isDirectory: false
      }
    }
    return {
      requestedPath: path,
      path: metadata.isDirectory ? path : null,
      exists: true,
      isDirectory: metadata.isDirectory
    }
  }

  async createRemoteDirectory(hostId: string, requestedPath: string): Promise<RemotePathValidation> {
    const path = normalizeRemotePath(requestedPath)
    const client = this.runtime(hostId).client
    await client.request('fs/createDirectory', { path, recursive: true })
    const metadata = parseRemoteFsMetadata(
      await client.request('fs/getMetadata', { path })
    )
    if (!metadata.isDirectory) throw new Error('Remote path is not a directory')
    return {
      requestedPath: path,
      path,
      exists: true,
      isDirectory: true
    }
  }

  async listRemoteDirectory(hostId: string, requestedPath?: string): Promise<RemoteDirectoryListing> {
    const runtime = this.runtime(hostId)
    const path = requestedPath === undefined
      ? normalizeRemotePath(posix.dirname(await runtime.client.codexHome()))
      : normalizeRemotePath(requestedPath)
    const metadata = parseRemoteFsMetadata(
      await runtime.client.request('fs/getMetadata', { path })
    )
    if (!metadata.isDirectory) throw new Error('Remote path is not a directory')

    const response = await runtime.client.request('fs/readDirectory', { path })
    if (!isRecord(response) || !Array.isArray(response.entries) ||
        response.entries.length > MAX_REMOTE_DIRECTORY_RESPONSE_ENTRIES) {
      throw new Error('Invalid or oversized remote directory response from app-server')
    }
    let nameBytes = 0
    const directories = response.entries.map((entry) => {
      const parsed = parseRemoteDirectoryEntry(entry)
      nameBytes += Buffer.byteLength(parsed.fileName, 'utf8')
      if (nameBytes > MAX_REMOTE_DIRECTORY_NAME_BYTES) {
        throw new Error('Remote directory response contains too much entry data')
      }
      return parsed
    }).filter((entry) => entry.isDirectory)
      .sort((left, right) => left.fileName.localeCompare(right.fileName, undefined, {
        numeric: true,
        sensitivity: 'base'
      }))
      .slice(0, MAX_REMOTE_DIRECTORY_ENTRIES)
      .map((entry) => ({
        name: entry.fileName,
        path: posix.join(path, entry.fileName),
        isDirectory: true
      }))

    return {
      path,
      parentPath: path === '/' ? null : posix.dirname(path),
      entries: directories
    }
  }

  async getRemoteAppContext(hostId: string, cwd: string, projectId?: string): Promise<AppContext> {
    const connection = this.store.getConnection(hostId)
    const validation = await this.validateRemotePath(hostId, cwd)
    if (!validation.exists) throw new Error('Remote working directory does not exist')
    if (!validation.isDirectory || !validation.path) throw new Error('Remote working directory is not a directory')
    if (projectId) {
      const project = this.store.getProject(projectId)
      if (project.hostId !== hostId || project.remotePath !== normalizeRemotePath(cwd)) {
        throw new Error('Remote project does not match the selected host and directory')
      }
    }
    const branchResult = await this.runtime(hostId).connector.runRemoteCommand(
      `git -C ${shellQuote(validation.path)} branch --show-current 2>/dev/null || true`
    )
    const branch = branchResult.stdout.trim() || null
    return {
      cwd: validation.path,
      folderName: posix.basename(validation.path) || validation.path,
      branch,
      platform: 'darwin',
      hostId,
      hostDisplayName: connection.displayName,
      projectKind: 'remote',
      projectId: projectId ?? null
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.runtimes.keys()].map((hostId) => this.disposeRuntime(hostId)))
  }

  private runtime(hostId: string): RemoteHostRuntime {
    if (hostId === 'local') throw new Error('Local host does not have an SSH runtime')
    const existing = this.runtimes.get(hostId)
    if (existing) return existing
    const config = this.store.getConnection(hostId)
    const connector = this.options.createConnector?.(config) ?? new SshAppServerConnector({
      host: config.host,
      ...(config.sshAlias ? { sshAlias: config.sshAlias } : {}),
      ...(config.port ? { port: config.port } : {}),
      ...(config.identityFile ? { identityFile: config.identityFile } : {}),
      connectTimeoutSeconds: this.options.connectTimeoutSeconds
    })
    const client = this.options.createClient?.(config, connector) ?? new AppServerClient({
      resolveServerEndpoint: () => REMOTE_ENDPOINT,
      connectEndpoint: (_endpoint, options) => connector.connect(options),
      autoReconnect: true,
      reconnectMaxAttempts: this.options.reconnectMaxAttempts ?? DEFAULT_REMOTE_RECONNECT_MAX_ATTEMPTS,
      onConnectionInitializationFailed: () => connector.onAppServerInitializationFailed()
    })
    const runtime = { config, connector, client }
    this.runtimes.set(hostId, runtime)
    client.on('notification', (notification: RpcNotification) =>
      this.emit('notification', hostId, notificationForHost(notification, hostId)))
    client.on('server-request', (request: RpcServerRequest) =>
      this.emit('server-request', hostId, requestForHost(request, hostId)))
    client.on('status', (status: BackendStatus) => {
      this.statusByHost.set(hostId, status)
      this.emit('connection-status', this.snapshot(config, status))
      this.emit('status', hostId, status)
    })
    client.on('server-log', (line: string) => this.emit('server-log', hostId, line))
    return runtime
  }

  private snapshot(
    config: StoredRemoteConnection,
    status: BackendStatus = { state: 'stopped', mode: 'daemon' }
  ): RemoteConnection {
    return {
      ...config,
      state: statusState(status),
      ...(status.message ? { message: status.message } : {})
    }
  }

  private async disposeRuntime(hostId: string): Promise<void> {
    const runtime = this.runtimes.get(hostId)
    if (!runtime) return
    this.runtimes.delete(hostId)
    await runtime.client.stop().catch(() => undefined)
    await runtime.connector.dispose()
  }
}

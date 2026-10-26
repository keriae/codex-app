import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppServerSocket, ManagedDaemonConnectOptions } from './managedDaemon'
import { AppServerClient } from './appServer'
import { decorateRemoteThreadResult, HostAppServerRegistry } from './hostAppServerRegistry'
import { RemoteConnectionStore, type StoredRemoteConnection } from './remoteConnections'
import {
  SshAppServerConnector,
  type RemoteCommandResult
} from './sshAppServerTransport'

class FakeSocket extends EventEmitter implements AppServerSocket {
  readyState = 1
  readonly requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  readonly metadataKinds = new Map<string, 'directory' | 'file' | 'missing' | 'not-directory' | 'forbidden'>()
  readonly createdDirectories: string[] = []
  directoryEntries: unknown[] = [
    { fileName: 'zeta', isDirectory: true, isFile: false },
    { fileName: 'notes.txt', isDirectory: false, isFile: true },
    { fileName: 'project-10', isDirectory: true, isFile: false },
    { fileName: 'project-2', isDirectory: true, isFile: false }
  ]
  send(data: string, callback: (error?: Error) => void): void {
    const message = JSON.parse(data) as {
      id: string | number
      method: string
      params?: Record<string, unknown>
    }
    this.requests.push({ method: message.method, ...(message.params ? { params: message.params } : {}) })
    callback()
    let result: unknown = message.method === 'initialize'
      ? {
          userAgent: 'codex-test',
          codexHome: '/home/developer/.codex',
          platformFamily: 'unix',
          platformOs: 'linux'
        }
      : message.method === 'thread/list'
      ? { data: [{ id: 'remote-thread', cwd: '/srv/project' }] }
      : message.method === 'fs/readDirectory'
        ? { entries: this.directoryEntries }
      : message.method === 'getAuthStatus'
        ? { authMethod: 'chatgpt' }
        : {}
    let error: { code: number; message: string } | undefined
    if (message.method === 'fs/getMetadata') {
      const path = String(message.params?.path ?? '')
      const kind = this.metadataKinds.get(path) ?? 'directory'
      if (kind === 'missing') error = { code: -32_000, message: 'No such file or directory (os error 2)' }
      else if (kind === 'not-directory') error = { code: -32_000, message: 'Not a directory (os error 20)' }
      else if (kind === 'forbidden') error = { code: -32_000, message: 'Permission denied (os error 13)' }
      else {
        result = {
          isDirectory: kind === 'directory',
          isFile: kind === 'file',
          isSymlink: false,
          createdAtMs: 0,
          modifiedAtMs: 0
        }
      }
    } else if (message.method === 'fs/createDirectory') {
      const path = String(message.params?.path ?? '')
      this.createdDirectories.push(path)
      this.metadataKinds.set(path, 'directory')
    }
    queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify(
      error ? { id: message.id, error } : { id: message.id, result }
    )), false))
  }
  close(code = 1000): void {
    if (this.readyState >= 2) return
    this.readyState = 3
    queueMicrotask(() => this.emit('close', code, Buffer.alloc(0)))
  }
  terminate(): void { this.close(1006) }
}

class FakeConnector extends SshAppServerConnector {
  readonly socket = new FakeSocket()
  readonly commands: string[] = []

  constructor(connection: StoredRemoteConnection) {
    super({ host: connection.host })
  }

  override async connect(_options: ManagedDaemonConnectOptions): Promise<AppServerSocket> {
    return this.socket
  }

  override async runRemoteCommand(command: string): Promise<RemoteCommandResult> {
    this.commands.push(command)
    if (command.startsWith('git -C')) {
      return { code: 0, signal: null, stdout: 'feature/remote\n', stderr: '' }
    }
    if (command.startsWith('cd -- "${HOME:?}"')) {
      return { code: 0, signal: null, stdout: '/home/developer\n', stderr: '' }
    }
    if (command.includes('/home/developer')) {
      return { code: 0, signal: null, stdout: 'directory\n/home/developer\n', stderr: '' }
    }
    return { code: 0, signal: null, stdout: 'directory\n/srv/project\n', stderr: '' }
  }

  override async dispose(): Promise<void> {}
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(): {
  registry: HostAppServerRegistry
  connection: StoredRemoteConnection
  connectors: Map<string, FakeConnector>
} {
  const directory = mkdtempSync(join(tmpdir(), 'codex-host-registry-'))
  directories.push(directory)
  const store = new RemoteConnectionStore(directory)
  const connection = store.saveConnection({ sshAlias: 'remote-dev', displayName: 'Remote dev' })
  const connectors = new Map<string, FakeConnector>()
  const registry = new HostAppServerRegistry(new AppServerClient(), store, {
    createConnector: (config) => {
      const connector = new FakeConnector(config)
      connectors.set(config.hostId, connector)
      return connector
    },
    createClient: (_config, connector) => new AppServerClient({
      resolveServerEndpoint: () => ({ kind: 'websocket', url: 'ws://remote/rpc' }),
      connectEndpoint: (_endpoint, options) => connector.connect(options),
      autoReconnect: false,
      initializeTimeoutMs: 1_000,
      shutdownGraceMs: 10
    })
  })
  return { registry, connection, connectors }
}

describe('host app-server routing', () => {
  it('decorates remote thread catalog entries and notifications with their host ID', async () => {
    const { registry, connection, connectors } = fixture()
    await expect(registry.request(connection.hostId, 'thread/list')).resolves.toEqual({
      data: [{ id: 'remote-thread', cwd: '/srv/project', hostId: connection.hostId }]
    })
    const listener = vi.fn()
    registry.on('notification', listener)
    connectors.get(connection.hostId)?.socket.emit('message', Buffer.from(JSON.stringify({
      method: 'turn/completed',
      params: { threadId: 'remote-thread' }
    })), false)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(
      connection.hostId,
      expect.objectContaining({
        hostId: connection.hostId,
        params: { threadId: 'remote-thread', hostId: connection.hostId }
      })
    ))
    connectors.get(connection.hostId)?.socket.emit('message', Buffer.from(JSON.stringify({
      method: 'thread/started',
      params: { thread: { id: 'remote-created', cwd: '/srv/project' } }
    })), false)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(
      connection.hostId,
      expect.objectContaining({
        hostId: connection.hostId,
        params: {
          hostId: connection.hostId,
          thread: { id: 'remote-created', cwd: '/srv/project', hostId: connection.hostId }
        }
      })
    ))
    await registry.dispose()
  })

  it('builds a remote AppContext without touching the local filesystem', async () => {
    const { registry, connection, connectors } = fixture()
    const project = registry.createProject({
      hostId: connection.hostId,
      remotePath: '/srv/project',
      label: 'Project'
    })
    await expect(registry.getRemoteAppContext(connection.hostId, '/srv/project', project.id)).resolves.toEqual({
      cwd: '/srv/project',
      folderName: 'project',
      branch: 'feature/remote',
      platform: 'darwin',
      hostId: connection.hostId,
      hostDisplayName: 'Remote dev',
      projectKind: 'remote',
      projectId: project.id
    })
    expect(connectors.get(connection.hostId)?.commands).toEqual([
      "git -C '/srv/project' branch --show-current 2>/dev/null || true"
    ])
    await registry.dispose()
  })

  it('decorates supported top-level and nested thread response shapes', () => {
    expect(decorateRemoteThreadResult('thread/read', { thread: { id: 'one' } }, 'host-a')).toEqual({
      thread: { id: 'one', hostId: 'host-a' }
    })
    expect(decorateRemoteThreadResult('thread/start', { id: 'two', cwd: '/work' }, 'host-b')).toEqual({
      id: 'two', cwd: '/work', hostId: 'host-b'
    })
    expect(decorateRemoteThreadResult('thread/search', {
      data: [{ thread: { id: 'three', cwd: '/remote' }, snippet: 'match' }]
    }, 'host-c')).toEqual({
      data: [{
        hostId: 'host-c',
        thread: { id: 'three', cwd: '/remote', hostId: 'host-c' },
        snippet: 'match'
      }]
    })
  })

  it('lists only bounded, sorted remote directories and resolves HOME by default', async () => {
    const { registry, connection, connectors } = fixture()
    await expect(registry.listRemoteDirectory(connection.hostId)).resolves.toEqual({
      path: '/home/developer',
      parentPath: '/home',
      entries: [
        { name: 'project-2', path: '/home/developer/project-2', isDirectory: true },
        { name: 'project-10', path: '/home/developer/project-10', isDirectory: true },
        { name: 'zeta', path: '/home/developer/zeta', isDirectory: true }
      ]
    })
    const connector = connectors.get(connection.hostId)!
    expect(connector.commands).toEqual([])
    expect(connector.socket.requests.filter(({ method }) => method.startsWith('fs/'))).toEqual([
      { method: 'fs/getMetadata', params: { path: '/home/developer' } },
      { method: 'fs/readDirectory', params: { path: '/home/developer' } }
    ])
    await registry.dispose()
  })

  it('validates and creates remote paths entirely through the persistent app-server', async () => {
    const { registry, connection, connectors } = fixture()
    registry.clientForHost(connection.hostId)
    const connector = connectors.get(connection.hostId)!
    const socket = connector.socket
    socket.metadataKinds.set('/srv/file.txt', 'file')
    socket.metadataKinds.set('/srv/missing', 'missing')
    socket.metadataKinds.set('/srv/not-a-directory/child', 'not-directory')
    socket.metadataKinds.set('/srv/forbidden', 'forbidden')

    await expect(registry.validateRemotePath(connection.hostId, '/srv/project')).resolves.toEqual({
      requestedPath: '/srv/project',
      path: '/srv/project',
      exists: true,
      isDirectory: true
    })
    await expect(registry.validateRemotePath(connection.hostId, '/srv/file.txt')).resolves.toEqual({
      requestedPath: '/srv/file.txt',
      path: null,
      exists: true,
      isDirectory: false
    })
    await expect(registry.validateRemotePath(connection.hostId, '/srv/missing')).resolves.toEqual({
      requestedPath: '/srv/missing',
      path: null,
      exists: false,
      isDirectory: false
    })
    await expect(registry.validateRemotePath(connection.hostId, '/srv/not-a-directory/child')).resolves.toEqual({
      requestedPath: '/srv/not-a-directory/child',
      path: null,
      exists: false,
      isDirectory: false
    })
    await expect(registry.validateRemotePath(connection.hostId, '/srv/forbidden')).rejects.toThrow('Permission denied')

    await expect(registry.createRemoteDirectory(connection.hostId, '/srv/missing')).resolves.toEqual({
      requestedPath: '/srv/missing',
      path: '/srv/missing',
      exists: true,
      isDirectory: true
    })
    expect(socket.createdDirectories).toEqual(['/srv/missing'])
    expect(connector.commands).toEqual([])
    expect(socket.requests.filter(({ method }) => method.startsWith('fs/')).at(-2)).toEqual({
      method: 'fs/createDirectory',
      params: { path: '/srv/missing', recursive: true }
    })
    expect(socket.requests.filter(({ method }) => method.startsWith('fs/')).at(-1)).toEqual({
      method: 'fs/getMetadata',
      params: { path: '/srv/missing' }
    })
    await registry.dispose()
  })

  it('caps directory output and rejects unsafe remote entry names', async () => {
    const { registry, connection, connectors } = fixture()
    registry.clientForHost(connection.hostId)
    const socket = connectors.get(connection.hostId)!.socket
    socket.directoryEntries = Array.from({ length: 510 }, (_, index) => ({
      fileName: `folder-${index}`,
      isDirectory: true,
      isFile: false
    }))
    const listing = await registry.listRemoteDirectory(connection.hostId, '/srv/project')
    expect(listing.entries).toHaveLength(500)
    expect(connectors.get(connection.hostId)?.commands).toEqual([])
    socket.directoryEntries = [{ fileName: '../escape', isDirectory: true, isFile: false }]
    await expect(registry.listRemoteDirectory(connection.hostId, '/srv/project')).rejects.toThrow('Invalid remote directory entry')
    await registry.dispose()
  })
})

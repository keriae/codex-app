import { statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import WebSocket, { type RawData } from 'ws'
import type { AppServerEndpoint } from './serverEndpoint'

const DAEMON_HANDSHAKE_URL = 'ws://localhost/rpc'
export const DEFAULT_DAEMON_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
export const DAEMON_MAX_UNFRAGMENTED_MESSAGE_HEADER = 'x-codex-websocket-max-unfragmented-message-bytes'

export interface AppServerSocket {
  readonly readyState: number
  readonly maxOutboundMessageBytes?: number
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this
  once(event: 'close', listener: (code: number, reason: Buffer) => void): this
  off(event: 'close', listener: (code: number, reason: Buffer) => void): this
  send(data: string, callback: (error?: Error) => void): void
  close(code?: number): void
  terminate(): void
}

interface DaemonSocketEvents {
  message: [RawData, boolean]
  error: [Error]
  close: [number, Buffer]
}

class DaemonWebSocket implements AppServerSocket {
  constructor(
    private readonly socket: WebSocket,
    readonly maxOutboundMessageBytes: number
  ) {}

  get readyState(): number { return this.socket.readyState }

  on<K extends keyof DaemonSocketEvents>(event: K, listener: (...args: DaemonSocketEvents[K]) => void): this {
    this.socket.on(event, listener)
    return this
  }

  once(event: 'close', listener: (code: number, reason: Buffer) => void): this {
    this.socket.once(event, listener)
    return this
  }

  off(event: 'close', listener: (code: number, reason: Buffer) => void): this {
    this.socket.off(event, listener)
    return this
  }

  send(data: string, callback: (error?: Error) => void): void {
    if (Buffer.byteLength(data, 'utf8') > this.maxOutboundMessageBytes) {
      callback(new Error(`App-server message exceeds the ${this.maxOutboundMessageBytes}-byte daemon frame limit`))
      return
    }
    this.socket.send(data, callback)
  }

  close(code?: number): void { this.socket.close(code) }
  terminate(): void { this.socket.terminate() }
}

export function daemonMaxOutboundMessageBytes(header: unknown): number {
  const value = Number(header)
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_DAEMON_MAX_MESSAGE_BYTES
}

export interface ManagedDaemonConnectOptions {
  handshakeTimeoutMs: number
  maxMessageBytes: number
  signal?: AbortSignal
}

export type ManagedDaemonConnect = (
  socketPath: string,
  options: ManagedDaemonConnectOptions
) => Promise<AppServerSocket>

export interface ManagedDaemonDiscoveryOptions {
  env?: NodeJS.ProcessEnv
  cwd?: string
  homeDirectory?: string
  uid?: number
}

/**
 * Returns the stable rendezvous path only when it resolves to a private socket
 * owned by the current user. The daemon intentionally rotates the symlink
 * target, so callers must retain the stable path instead of canonicalizing it.
 */
export function discoverManagedDaemonSocket(
  options: ManagedDaemonDiscoveryOptions = {}
): string | null {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const configuredHome = env.CODEX_HOME?.trim()
  const codexHome = configuredHome
    ? isAbsolute(configuredHome)
      ? configuredHome
      : resolve(cwd, configuredHome)
    : join(options.homeDirectory ?? homedir(), '.codex')
  const socketPath = join(codexHome, 'app-server-control', 'app-server-control.sock')

  try {
    const uid = options.uid ?? process.getuid?.()
    const parent = statSync(dirname(socketPath))
    const socket = statSync(socketPath)
    if (!parent.isDirectory() || !socket.isSocket()) return null
    if (uid !== undefined && (parent.uid !== uid || socket.uid !== uid)) return null
    if ((parent.mode & 0o022) !== 0 || (socket.mode & 0o077) !== 0) return null
    return socketPath
  } catch {
    return null
  }
}

export const connectManagedDaemon: ManagedDaemonConnect = (socketPath, options) =>
  connectAppServerEndpoint({ kind: 'unix', socketPath }, options)

export type AppServerEndpointConnect = (
  endpoint: AppServerEndpoint,
  options: ManagedDaemonConnectOptions
) => Promise<AppServerSocket>

export const connectAppServerEndpoint: AppServerEndpointConnect = (endpoint, options) =>
  new Promise<AppServerSocket>((resolveConnection, rejectConnection) => {
    if (options.signal?.aborted) {
      rejectConnection(new Error('Codex app-server connection canceled'))
      return
    }
    const socket = new WebSocket(endpoint.kind === 'unix' ? DAEMON_HANDSHAKE_URL : endpoint.url, {
      ...(endpoint.kind === 'unix' ? { createConnection: () => createConnection(endpoint.socketPath) } : {}),
      handshakeTimeout: options.handshakeTimeoutMs,
      maxPayload: options.maxMessageBytes,
      perMessageDeflate: false
    })
    let settled = false
    let maxUnfragmentedMessageBytes = DEFAULT_DAEMON_MAX_MESSAGE_BYTES

    socket.once('upgrade', (response) => {
      maxUnfragmentedMessageBytes = daemonMaxOutboundMessageBytes(response.headers[DAEMON_MAX_UNFRAGMENTED_MESSAGE_HEADER])
    })

    const onOpen = (): void => {
      if (settled) return
      settled = true
      socket.off('error', onError)
      socket.off('close', onClose)
      options.signal?.removeEventListener('abort', onAbort)
      // Cover the event-loop gap until AppServerClient attaches its own
      // error listener after awaiting this promise.
      socket.on('error', () => undefined)
      resolveConnection(new DaemonWebSocket(socket, maxUnfragmentedMessageBytes))
    }
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      socket.off('open', onOpen)
      socket.off('close', onClose)
      options.signal?.removeEventListener('abort', onAbort)
      // A failed handshake can emit another error while closing. It has no
      // AppServerClient owner yet, so keep that teardown from escaping the promise.
      socket.on('error', () => undefined)
      socket.terminate()
      rejectConnection(error)
    }
    const onClose = (): void => onError(new Error('Codex app-server WebSocket closed before opening'))
    const onAbort = (): void => onError(new Error('Codex app-server connection canceled'))

    socket.once('open', onOpen)
    socket.once('error', onError)
    socket.once('close', onClose)
    options.signal?.addEventListener('abort', onAbort, { once: true })
  })

export function socketMessageText(data: RawData, isBinary: boolean): string {
  if (isBinary) throw new Error('Codex app-server sent an unexpected binary WebSocket message')
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.concat(data).toString('utf8')
}

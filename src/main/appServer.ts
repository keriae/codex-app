import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
import type {
  BackendStatus,
  JsonMap,
  RpcId,
  RpcNotification,
  RpcServerRequest,
  RpcServerResponse
} from '../shared/api'
import { discoverCodexBinary } from './codexBinary'
import { DESKTOP_INITIALIZE_ID, DESKTOP_INITIALIZE_PARAMS } from './desktopProtocol'
import {
  DEFAULT_MAX_JSON_LINE_BYTES,
  JsonLineParser,
  type JsonLineValue
} from './jsonl'
import {
  connectManagedDaemon,
  connectAppServerEndpoint,
  DEFAULT_DAEMON_MAX_MESSAGE_BYTES,
  discoverManagedDaemonSocket,
  socketMessageText,
  type AppServerEndpointConnect,
  type AppServerSocket,
  type ManagedDaemonConnect
} from './managedDaemon'
import { configuredAppServerEndpoint, type AppServerEndpoint } from './serverEndpoint'

const DEFAULT_MAX_PENDING_REQUESTS = 1_024
const DEFAULT_MAX_SERVER_REQUESTS = 256
const MAX_SERVER_RESPONSE_BYTES = 1024 * 1024
const MAX_MCP_ELICITATION_FIELDS = 64
const MAX_MCP_ELICITATION_STRING_LENGTH = 10_000
const MAX_MCP_ELICITATION_ARRAY_ITEMS = 100
const MAX_MCP_ELICITATION_ENUM_VALUES = 100
const DESKTOP_APP_SERVER_ARGS = [
  '-c',
  'features.code_mode_host=true',
  'app-server',
  '--analytics-default-enabled',
  '-c',
  'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true',
  '-c',
  'plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=true'
] as const

interface RpcErrorShape {
  code?: number
  message?: string
  data?: unknown
}

interface PendingRequest {
  method: string
  generation: number
  resolve(value: unknown): void
  reject(error: Error): void
  timeout?: NodeJS.Timeout
  dispatched?: boolean
}

type ConnectionTarget =
  | { kind: 'stdio' }
  | { kind: 'daemon'; socketPath: string }
  | { kind: 'external'; endpoint: AppServerEndpoint }

interface ReconnectWaiter {
  promise: Promise<void>
  resolve(): void
  reject(error: Error): void
}

export type AppServerSpawn = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; env: NodeJS.ProcessEnv }
) => ChildProcessWithoutNullStreams

export interface AppServerClientOptions {
  spawnProcess?: AppServerSpawn
  resolveBinary?: () => string
  resolveDaemonSocket?: () => string | null
  connectDaemon?: ManagedDaemonConnect
  resolveServerEndpoint?: () => AppServerEndpoint | null
  connectEndpoint?: AppServerEndpointConnect
  preferManagedDaemon?: boolean
  /** Socket transports recover automatically; opt in to recovering private stdio too. */
  autoReconnect?: boolean
  reconnectInitialDelayMs?: number
  reconnectMaxDelayMs?: number
  reconnectMaxAttempts?: number
  transportWriteTimeoutMs?: number
  initializeTimeoutMs?: number
  requestTimeoutMs?: number
  shutdownGraceMs?: number
  maxPendingRequests?: number
  maxServerRequests?: number
  maxOutboundMessageBytes?: number
  /** Called after a socket opened but the app-server initialize/auth handshake failed. */
  onConnectionInitializationFailed?: (error: Error) => void
}

export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'AppServerError'
  }
}

/** A lost acknowledgment cannot prove that a dispatched mutation failed. */
export class AppServerDeliveryError extends AppServerError {
  constructor(
    message: string,
    readonly method: string,
    readonly stage: 'not-sent' | 'outcome-unknown'
  ) {
    super(`[${stage}] ${message}`, undefined, { kind: 'app_server_delivery', method, stage })
    this.name = 'AppServerDeliveryError'
  }
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private socket: AppServerSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private serverRequests = new Map<string, RpcServerRequest>()
  private nextId = 1
  private readyPromise: Promise<void> | null = null
  private stopping = false
  private startupToken = 0
  private generation = 0
  private writeTail: Promise<void> = Promise.resolve()
  private activeWriteRejectors = new Set<(error: Error) => void>()
  private queuedWriteCount = 0
  private catalogDefaultModel: string | null = null
  private connectionTarget: ConnectionTarget | null = null
  private connectionAbort: AbortController | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectWaiter: ReconnectWaiter | null = null
  private reconnectAttempt = 0
  private hasConnected = false
  private initializedCodexHome: string | null = null
  private status: BackendStatus = {
    state: 'stopped',
    mode: 'direct'
  }

  private readonly spawnProcess: AppServerSpawn
  private readonly resolveBinary: () => string
  private readonly resolveDaemonSocket: () => string | null
  private readonly connectDaemon: ManagedDaemonConnect
  private readonly resolveServerEndpoint: () => AppServerEndpoint | null
  private readonly connectEndpoint: AppServerEndpointConnect
  private readonly preferManagedDaemon: boolean
  private readonly autoReconnect: boolean | undefined
  private readonly reconnectInitialDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly reconnectMaxAttempts: number
  private readonly transportWriteTimeoutMs: number
  private readonly initializeTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly shutdownGraceMs: number
  private readonly maxPendingRequests: number
  private readonly maxServerRequests: number
  private readonly maxOutboundMessageBytes: number
  private readonly onConnectionInitializationFailed?: (error: Error) => void

  constructor(options: AppServerClientOptions = {}) {
    super()
    this.spawnProcess = options.spawnProcess ?? spawn
    this.resolveBinary = options.resolveBinary ?? (() => discoverCodexBinary())
    this.resolveDaemonSocket =
      options.resolveDaemonSocket ?? (() => discoverManagedDaemonSocket())
    this.connectDaemon = options.connectDaemon ?? connectManagedDaemon
    this.resolveServerEndpoint = options.resolveServerEndpoint ?? (() => configuredAppServerEndpoint())
    this.connectEndpoint = options.connectEndpoint ?? connectAppServerEndpoint
    this.preferManagedDaemon = options.preferManagedDaemon ?? false
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? 12_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 45_000
    this.shutdownGraceMs = options.shutdownGraceMs ?? 1_200
    this.autoReconnect = options.autoReconnect
    this.reconnectInitialDelayMs = positiveInteger(options.reconnectInitialDelayMs, 1_000, 'reconnectInitialDelayMs')
    this.reconnectMaxDelayMs = Math.max(this.reconnectInitialDelayMs, positiveInteger(options.reconnectMaxDelayMs, 20_000, 'reconnectMaxDelayMs'))
    this.reconnectMaxAttempts = options.reconnectMaxAttempts === undefined ? Infinity : positiveInteger(options.reconnectMaxAttempts, 1, 'reconnectMaxAttempts')
    this.transportWriteTimeoutMs = positiveInteger(options.transportWriteTimeoutMs, Math.max(1_000, this.requestTimeoutMs), 'transportWriteTimeoutMs')
    this.maxPendingRequests = positiveInteger(
      options.maxPendingRequests,
      DEFAULT_MAX_PENDING_REQUESTS,
      'maxPendingRequests'
    )
    this.maxServerRequests = positiveInteger(
      options.maxServerRequests,
      DEFAULT_MAX_SERVER_REQUESTS,
      'maxServerRequests'
    )
    this.maxOutboundMessageBytes = positiveInteger(
      options.maxOutboundMessageBytes,
      DEFAULT_MAX_JSON_LINE_BYTES,
      'maxOutboundMessageBytes'
    )
    this.onConnectionInitializationFailed = options.onConnectionInitializationFailed
  }

  getStatus(): BackendStatus {
    return { ...this.status }
  }

  /** Server-owned Codex home captured from the required initialize handshake. */
  async codexHome(): Promise<string> {
    await this.start()
    if (!this.initializedCodexHome) {
      throw new Error('Codex app-server did not report its home directory')
    }
    return this.initializedCodexHome
  }

  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    if (this.reconnectWaiter) return this.reconnectWaiter.promise

    this.stopping = false
    const startupToken = ++this.startupToken
    this.connectionAbort = new AbortController()
    let startup: Promise<void>
    startup = this.connectAndInitialize(startupToken).catch((cause: unknown) => {
      const error = asError(cause)
      if (
        startupToken === this.startupToken &&
        !this.stopping &&
        this.status.state !== 'error'
      ) {
        this.setStatus({ state: 'error', mode: this.status.mode, message: error.message })
      }
      if (this.readyPromise === startup) this.readyPromise = null
      if (startupToken === this.startupToken && !this.stopping && !isNonRetryableConnectionError(error)) {
        this.scheduleReconnect()
      }
      throw error
    })
    this.readyPromise = startup
    return startup
  }

  async request<T = unknown>(method: string, params?: JsonMap): Promise<T> {
    try {
      await this.start()
    } catch (cause) {
      throw new AppServerDeliveryError(asError(cause).message, method, 'not-sent')
    }
    const result = await this.sendRequest<T>(
      method,
      inheritConfiguredModel(method, params, this.catalogDefaultModel)
    )
    if (method === 'model/list') {
      this.catalogDefaultModel = catalogDefaultModel(result) ?? this.catalogDefaultModel
    }
    return result
  }

  /** A PTY response is delivered only after exit; ordinary RPC timeouts remain unchanged. */
  async executeStandaloneCommand<T = unknown>(
    params: JsonMap,
    options: { signal?: AbortSignal; onSubmitted?: () => void } = {}
  ): Promise<T> {
    await this.start()
    if (options.signal?.aborted) throw new Error('Terminal command canceled before submission')
    const response = this.sendRequest<T>('command/exec', params, 0)
    options.onSubmitted?.()
    return response
  }

  async respond(id: RpcId, response: RpcServerResponse): Promise<void> {
    const key = rpcIdKey(id)
    const request = key ? this.serverRequests.get(key) : undefined
    if (!key || !request) {
      throw new Error(`No pending app-server request with id ${String(id)}`)
    }
    const normalizedResponse = normalizeServerResponse(request, response)
    const generation = this.generation
    const message = normalizedResponse.error
      ? { id, error: normalizedResponse.error }
      : { id, result: normalizedResponse.result }
    assertJsonPayloadSize(
      message,
      Math.min(this.outboundMessageLimit(), MAX_SERVER_RESPONSE_BYTES)
    )

    // Claim before the asynchronous write so concurrent renderer handlers can
    // never send two responses for one server request.
    this.serverRequests.delete(key)

    try {
      await this.enqueueWrite(message, generation)
    } catch (cause) {
      const error = asError(cause)
      this.handleProcessError(error, generation)
      throw error
    }
  }

  getPendingServerRequests(): RpcServerRequest[] {
    return [...this.serverRequests.values()]
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.startupToken += 1
    this.connectionAbort?.abort()
    this.connectionAbort = null
    this.readyPromise = null
    const generation = this.generation
    const stopped = new Error('Codex app-server stopped')
    this.cancelReconnect(stopped)
    this.reconnectAttempt = 0
    this.hasConnected = false
    this.initializedCodexHome = null
    this.connectionTarget = null

    if (this.child || this.socket) {
      await this.teardownConnection(stopped, generation, 'stopped', true)
    } else {
      this.generation += 1
      this.rejectAll(stopped)
      this.serverRequests.clear()
      this.abortActiveWrites(stopped)
      this.writeTail = Promise.resolve()
      this.setStatus({ state: 'stopped', mode: this.status.mode })
    }
  }

  private async connectAndInitialize(startupToken: number): Promise<void> {
    this.assertCurrentStartup(startupToken)
    const endpoint = this.connectionTarget ? null : this.resolveServerEndpoint()
    if (endpoint) {
      this.connectionTarget = { kind: 'external', endpoint }
    }
    if (this.connectionTarget?.kind === 'external') {
      await this.connectSocketAndInitialize(this.connectionTarget.endpoint, startupToken, true)
      return
    }
    if (this.connectionTarget?.kind === 'daemon') {
      await this.connectDaemonAndInitialize(this.connectionTarget.socketPath, startupToken)
      return
    }
    if (this.connectionTarget?.kind === 'stdio') {
      await this.spawnAndInitialize()
      return
    }
    const daemonSocket = this.preferManagedDaemon ? this.resolveDaemonSocket() : null
    if (daemonSocket) {
      try {
        await this.connectDaemonAndInitialize(daemonSocket, startupToken)
        this.connectionTarget = { kind: 'daemon', socketPath: daemonSocket }
        return
      } catch (cause) {
        this.assertCurrentStartup(startupToken, cause)
        this.emit(
          'server-log',
          `Managed Codex daemon unavailable; falling back to a private app-server: ${asError(cause).message}\n`
        )
      }
    }

    this.assertCurrentStartup(startupToken)
    this.connectionTarget = { kind: 'stdio' }
    await this.spawnAndInitialize()
  }

  private async connectDaemonAndInitialize(
    socketPath: string,
    startupToken: number
  ): Promise<void> {
    await this.connectSocketAndInitialize({ kind: 'unix', socketPath }, startupToken, false)
  }

  private async connectSocketAndInitialize(
    endpoint: AppServerEndpoint,
    startupToken: number,
    explicit: boolean
  ): Promise<void> {
    this.setStatus({ state: 'starting', mode: 'daemon' })
    const generation = ++this.generation
    let socket: AppServerSocket | null = null

    try {
      const connectOptions = {
        handshakeTimeoutMs: this.initializeTimeoutMs,
        maxMessageBytes: DEFAULT_DAEMON_MAX_MESSAGE_BYTES,
        signal: this.connectionAbort?.signal
      }
      if (explicit) {
        socket = await this.connectEndpoint(endpoint, connectOptions)
      } else if (endpoint.kind === 'unix') {
        socket = await this.connectDaemon(endpoint.socketPath, connectOptions)
      } else {
        throw new Error('A managed app-server daemon requires a Unix socket')
      }
      if (
        generation !== this.generation ||
        startupToken !== this.startupToken ||
        this.stopping
      ) {
        socket.close(1000)
        throw new Error('Codex app-server connection changed during initialization')
      }

      this.socket = socket
      this.writeTail = Promise.resolve()
      socket.on('message', (data, isBinary) => {
        if (generation !== this.generation) return
        try {
          const text = socketMessageText(data, isBinary)
          const value: unknown = JSON.parse(text)
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Expected a JSON object')
          }
          this.handleMessage(value as JsonLineValue, generation)
        } catch (cause) {
          const error = asError(cause)
          this.emit('protocol-error', new Error(`Invalid app-server WebSocket message: ${error.message}`))
        }
      })
      socket.on('error', (error) => this.handleConnectionError(error, generation))
      socket.on('close', (code, reason) =>
        this.handleSocketClose(code, reason, generation)
      )

      await this.initializeConnection(generation)
      if (!this.isCurrentSocket(socket, generation)) {
        throw new Error('Codex app-server connection changed during initialization')
      }
      this.setStatus({ state: 'ready', mode: 'daemon' })
      this.connectionReady()
    } catch (cause) {
      const error = asError(cause)
      if (socket) this.onConnectionInitializationFailed?.(error)
      if (generation === this.generation) {
        await this.teardownConnection(error, generation, 'stopped', true)
      } else if (socket && socket.readyState < 2) {
        socket.close(1000)
      }
      throw error
    }
  }

  private async spawnAndInitialize(): Promise<void> {
    this.setStatus({ state: 'starting', mode: 'direct' })
    const binary = this.resolveBinary()
    const generation = ++this.generation
    const child = this.spawnProcess(binary, [...DESKTOP_APP_SERVER_ARGS], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })
    this.child = child
    this.writeTail = Promise.resolve()

    const parser = new JsonLineParser({
      onValue: (value) => this.handleMessage(value, generation),
      onError: (error, line) => {
        if (generation !== this.generation) return
        this.emit('protocol-error', new Error(`${error.message}: ${line.slice(0, 240)}`))
      }
    })

    child.stdout.on('data', (chunk: Buffer) => parser.push(chunk))
    child.stdout.on('end', () => {
      parser.end()
      this.handleProcessError(new Error('Codex app-server stdout closed'), generation)
    })
    child.stdout.on('close', () => this.handleProcessError(new Error('Codex app-server stdout closed'), generation))
    child.stdout.on('error', (error) => this.handleProcessError(error, generation))
    child.stdin.on('error', (error) => this.handleProcessError(error, generation))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (line: string) => {
      if (generation === this.generation) this.emit('server-log', line)
    })
    child.stderr.on('error', (error) => this.handleProcessError(error, generation))
    child.on('error', (error) => this.handleProcessError(error, generation))
    child.on('exit', (code, signal) => this.handleProcessExit(code, signal, generation))

    try {
      await this.initializeConnection(generation)
      if (!this.isCurrentConnection(child, generation)) {
        throw new Error('Codex app-server connection changed during initialization')
      }
      this.setStatus({ state: 'ready', mode: 'direct' })
      this.connectionReady()
    } catch (cause) {
      const error = asError(cause)
      if (generation === this.generation) {
        await this.teardownConnection(error, generation, 'error', true)
      }
      throw error
    }
  }

  private async initializeConnection(generation: number): Promise<void> {
    this.initializedCodexHome = null
    const initializeResult = await this.sendRequest<unknown>(
      'initialize',
      DESKTOP_INITIALIZE_PARAMS,
      this.initializeTimeoutMs,
      DESKTOP_INITIALIZE_ID
    )
    this.initializedCodexHome = initializeCodexHome(initializeResult)
    await this.sendRequest(
      'getAuthStatus',
      { includeToken: false, refreshToken: false },
      this.initializeTimeoutMs
    )
    if (generation !== this.generation) {
      throw new Error('Codex app-server connection changed during initialization')
    }
  }

  private sendRequest<T = unknown>(
    method: string,
    params?: JsonMap,
    timeoutMs = this.requestTimeoutMs,
    requestId?: RpcId
  ): Promise<T> {
    const generation = this.generation
    if (!this.connectionAvailable(generation)) {
      return Promise.reject(new Error('Codex app-server is not available'))
    }

    const id = requestId ?? this.nextId++
    const key = rpcIdKey(id)
    if (!key) return Promise.reject(new Error(`Invalid app-server request id ${String(id)}`))
    if (this.pending.has(key)) {
      return Promise.reject(new Error(`Duplicate app-server request id ${String(id)}`))
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(
        new Error(`Too many pending app-server requests (limit ${this.maxPendingRequests})`)
      )
    }

    // The managed transport advertises the maximum accepted unfragmented
    // message in its handshake. Reject local oversize/serialization failures
    // before claiming an ID or disturbing a healthy connection.
    try {
      assertJsonPayloadSize({ method, id, params }, this.outboundMessageLimit())
    } catch (cause) {
      return Promise.reject(asError(cause))
    }

    let entry: PendingRequest
    const response = new Promise<T>((resolve, reject) => {
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        if (this.pending.get(key) !== entry) return
        this.pending.delete(key)
        reject(deliveryError(entry, new Error(`${method} timed out after ${timeoutMs}ms`)))
      }, timeoutMs) : undefined

      entry = {
        method,
        generation,
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      }
      this.pending.set(key, entry)
    })

    void this.enqueueWrite(
      { method, id, params },
      generation,
      () => this.pending.get(key) === entry,
      () => { entry.dispatched = true }
    ).catch((cause: unknown) => {
      const error = asError(cause)
      if (this.pending.get(key) === entry) {
        clearTimeout(entry.timeout)
        this.pending.delete(key)
        entry.reject(deliveryError(entry, error))
      }
      this.handleProcessError(error, generation)
    })

    return response
  }

  private enqueueWrite(
    message: Record<string, unknown>,
    generation: number,
    shouldWrite: () => boolean = () => true,
    onDispatch?: () => void
  ): Promise<void> {
    const compact = Object.fromEntries(
      Object.entries(message).filter(([, value]) => value !== undefined)
    )
    let serialized: string
    try {
      serialized = JSON.stringify(compact)
      if (serialized === undefined) throw new TypeError('App-server message is not serializable')
      const bytes = Buffer.byteLength(serialized)
      if (bytes > this.maxOutboundMessageBytes) {
        throw new Error(
          `App-server message exceeds the ${this.maxOutboundMessageBytes}-byte limit`
        )
      }
    } catch (cause) {
      return Promise.reject(asError(cause))
    }
    if (this.queuedWriteCount >= this.maxPendingRequests + this.maxServerRequests + 2) {
      return Promise.reject(new Error('Codex app-server outgoing write queue is full'))
    }
    this.queuedWriteCount += 1
    const operation = this.writeTail.then(() => {
      if (!shouldWrite()) return
      if (!this.connectionAvailable(generation)) {
        throw new Error('Codex app-server connection changed before request dispatch')
      }
      onDispatch?.()
      return this.writeMessage(serialized, generation)
    }).finally(() => { this.queuedWriteCount -= 1 })
    this.writeTail = operation.catch(() => undefined)
    return operation
  }

  private outboundMessageLimit(): number {
    return Math.min(this.maxOutboundMessageBytes, this.socket?.maxOutboundMessageBytes ?? this.maxOutboundMessageBytes)
  }

  private writeMessage(message: string, generation: number): Promise<void> {
    if (this.socket) return this.writeSocket(message, generation)
    return this.writeLine(`${message}\n`, generation)
  }

  private writeSocket(message: string, generation: number): Promise<void> {
    const socket = this.socket
    if (!socket || !this.isCurrentSocket(socket, generation) || socket.readyState !== 1) {
      return Promise.reject(new Error('Codex app-server WebSocket is closed'))
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => settle(new Error('Codex app-server transport write timed out')), this.transportWriteTimeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        this.activeWriteRejectors.delete(abort)
      }
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const abort = (error: Error): void => settle(error)
      this.activeWriteRejectors.add(abort)

      try {
        socket.send(message, (error?: Error) => settle(error))
      } catch (cause) {
        settle(asError(cause))
      }
    })
  }

  private writeLine(line: string, generation: number): Promise<void> {
    const child = this.child
    if (!child || !this.isCurrentConnection(child, generation) || child.stdin.destroyed) {
      return Promise.reject(new Error('Codex app-server stdin is closed'))
    }

    const stream = child.stdin
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let callbackComplete = false
      let drainComplete = false
      let writeReturned = false
      const timer = setTimeout(() => settle(new Error('Codex app-server transport write timed out')), this.transportWriteTimeoutMs)

      const cleanup = (): void => {
        clearTimeout(timer)
        stream.off('error', onError)
        stream.off('close', onClose)
        stream.off('drain', onDrain)
        this.activeWriteRejectors.delete(abort)
      }
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const maybeSettle = (): void => {
        if (writeReturned && callbackComplete && drainComplete) settle()
      }
      const onError = (error: Error): void => settle(error)
      const onClose = (): void => settle(new Error('Codex app-server stdin closed'))
      const onDrain = (): void => {
        drainComplete = true
        maybeSettle()
      }
      const abort = (error: Error): void => settle(error)

      this.activeWriteRejectors.add(abort)
      stream.once('error', onError)
      stream.once('close', onClose)

      try {
        const accepted = stream.write(line, (error?: Error | null) => {
          callbackComplete = true
          if (error) settle(error)
          else maybeSettle()
        })
        drainComplete = accepted
        writeReturned = true
        if (!accepted) stream.once('drain', onDrain)
        maybeSettle()
      } catch (cause) {
        settle(asError(cause))
      }
    })
  }

  private handleMessage(message: JsonLineValue, generation = this.generation): void {
    if (generation !== this.generation) return

    if ('id' in message && !('method' in message)) {
      const key = rpcIdKey(message.id)
      if (!key) return
      const pending = this.pending.get(key)
      if (!pending || pending.generation !== generation) return
      clearTimeout(pending.timeout)
      this.pending.delete(key)

      if (message.error && typeof message.error === 'object') {
        const error = message.error as RpcErrorShape
        pending.reject(
          new AppServerError(
            error.message || `${pending.method} failed`,
            error.code,
            error.data
          )
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (typeof message.method !== 'string') return

    if ('id' in message) {
      const key = rpcIdKey(message.id)
      if (!key) {
        this.emit('protocol-error', new Error('App-server request has an invalid id'))
        return
      }
      const request = {
        id: message.id as RpcId,
        method: message.method,
        params: message.params
      } satisfies RpcServerRequest
      if (this.serverRequests.has(key)) {
        this.emit(
          'protocol-error',
          new Error(`Duplicate app-server request id ${String(request.id)}`)
        )
        return
      }
      if (this.serverRequests.size >= this.maxServerRequests) {
        const error = new Error(
          `Too many pending app-server server requests (limit ${this.maxServerRequests})`
        )
        this.emit('protocol-error', error)
        void this.enqueueWrite(
          {
            id: request.id,
            error: {
              code: -32000,
              message: 'The desktop client has too many pending requests',
              data: { kind: 'client_request_capacity_exceeded', retryable: true }
            }
          },
          generation
        ).catch((cause: unknown) => this.handleProcessError(asError(cause), generation))
        return
      }
      this.serverRequests.set(key, request)
      this.emit('server-request', request)
      return
    }

    if (message.method === 'serverRequest/resolved' && isRecord(message.params)) {
      const key = rpcIdKey(message.params.requestId)
      if (key) this.serverRequests.delete(key)
    }
    this.emit('notification', message as unknown as RpcNotification)
  }

  private handleProcessError(error: Error, generation: number): void {
    this.handleConnectionError(error, generation)
  }

  private handleConnectionError(error: Error, generation: number): void {
    if (generation !== this.generation) return
    this.connectionFailed(error, generation, true)
  }

  private handleSocketClose(code: number, reason: Buffer, generation: number): void {
    if (generation !== this.generation) return
    const detail = reason.toString('utf8').trim()
    const error = new Error(
      `Codex app-server WebSocket closed (${code}${detail ? `: ${detail}` : ''})`
    )
    this.connectionFailed(error, generation, false)
  }

  private handleProcessExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    generation: number
  ): void {
    if (generation !== this.generation) return
    const error = new Error(`Codex app-server exited (${signal ?? code ?? 'unknown'})`)
    this.connectionFailed(error, generation, false)
  }

  private connectionFailed(error: Error, generation: number, terminate: boolean): void {
    const startupToken = this.startupToken
    const wasReady = this.status.state === 'ready'
    void this.teardownConnection(error, generation, this.stopping ? 'stopped' : 'error', terminate)
      .then(() => {
        if (wasReady && startupToken === this.startupToken) this.scheduleReconnect()
      })
  }

  private connectionReady(): void {
    this.hasConnected = true
    this.reconnectAttempt = 0
  }

  private scheduleReconnect(): void {
    const socketTarget = this.connectionTarget?.kind === 'external' || this.connectionTarget?.kind === 'daemon'
    if (
      this.stopping || this.readyPromise || this.reconnectTimer ||
      !(this.autoReconnect ?? socketTarget) ||
      (!this.hasConnected && this.connectionTarget?.kind !== 'external') ||
      this.reconnectAttempt >= this.reconnectMaxAttempts
    ) return
    const attempt = ++this.reconnectAttempt
    const delayMs = Math.min(this.reconnectMaxDelayMs, this.reconnectInitialDelayMs * 2 ** Math.min(attempt - 1, 30))
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((resolveReady, rejectReady) => {
      resolve = resolveReady
      reject = rejectReady
    })
    // Recovery may be automatic without an outstanding caller. Keep its
    // failure observed while preserving rejection for callers awaiting start.
    void promise.catch(() => undefined)
    const waiter = { promise, resolve, reject }
    this.reconnectWaiter = waiter
    this.emit('reconnect-scheduled', { attempt, delayMs })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.reconnectWaiter !== waiter) return
      this.reconnectWaiter = null
      void this.start().then(waiter.resolve, waiter.reject)
    }, delayMs)
    this.reconnectTimer.unref()
  }

  private cancelReconnect(error: Error): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectWaiter?.reject(error)
    this.reconnectWaiter = null
  }

  private async teardownConnection(
    error: Error,
    generation: number,
    state: 'stopped' | 'error',
    terminate: boolean
  ): Promise<void> {
    if (generation !== this.generation) return

    const child = this.child
    const socket = this.socket
    this.child = null
    this.socket = null
    this.readyPromise = null
    this.generation += 1
    this.abortActiveWrites(error)
    this.writeTail = Promise.resolve()
    this.rejectAll(error)
    this.serverRequests.clear()
    this.setStatus({
      state,
      mode: this.status.mode,
      ...(state === 'error' ? { message: error.message } : {})
    })

    if (terminate) {
      if (socket) await this.closeSocket(socket)
      if (child) await this.terminateChild(child)
    }
  }

  private async closeSocket(socket: AppServerSocket): Promise<void> {
    if (socket.readyState >= 2) return

    let timer: NodeJS.Timeout | null = null
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        if (timer) clearTimeout(timer)
        socket.off('close', finish)
        resolve()
      }
      socket.once('close', finish)
      timer = setTimeout(() => {
        try {
          socket.terminate()
        } finally {
          finish()
        }
      }, Math.min(this.shutdownGraceMs, 500))
      try {
        socket.close(1000)
      } catch {
        finish()
      }
    })
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return

    const exited = waitForChildExit(child, this.shutdownGraceMs)

    try {
      if (!child.stdin.destroyed) child.stdin.end()
    } catch {
      // The process is being terminated below even if stdin has already failed.
    }
    try {
      child.kill('SIGTERM')
    } catch {
      // A concurrent process exit is equivalent to a successful termination.
    }

    if (!(await exited) && child.exitCode === null && child.signalCode === null) {
      const killed = waitForChildExit(child, Math.min(this.shutdownGraceMs, 500))
      try {
        child.kill('SIGKILL')
      } catch {
        // Nothing remains to tear down.
      }
      await killed
    }
  }

  private isCurrentConnection(
    child: ChildProcessWithoutNullStreams,
    generation: number
  ): boolean {
    return generation === this.generation && child === this.child
  }

  private assertCurrentStartup(startupToken: number, cause?: unknown): void {
    if (startupToken === this.startupToken && !this.stopping) return
    throw cause instanceof Error
      ? cause
      : new Error('Codex app-server startup was superseded')
  }

  private isCurrentSocket(socket: AppServerSocket, generation: number): boolean {
    return generation === this.generation && socket === this.socket
  }

  private connectionAvailable(generation: number): boolean {
    if (generation !== this.generation) return false
    if (this.socket) return this.socket.readyState === 1
    return Boolean(this.child && !this.child.stdin.destroyed)
  }

  private abortActiveWrites(error: Error): void {
    for (const reject of [...this.activeWriteRejectors]) reject(error)
    this.activeWriteRejectors.clear()
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(deliveryError(pending, error))
    }
    this.pending.clear()
  }

  private setStatus(status: BackendStatus): void {
    this.status = status
    this.emit('status', { ...status })
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function deliveryError(pending: PendingRequest, cause: Error): Error {
  if (pending.method === 'initialize' || pending.method === 'getAuthStatus') return cause
  return new AppServerDeliveryError(cause.message, pending.method, pending.dispatched ? 'outcome-unknown' : 'not-sent')
}

function isNonRetryableConnectionError(error: Error): boolean {
  if ((error as Error & { retryable?: unknown }).retryable === false) return true
  return error instanceof AppServerError && [401, 403, -32601, -32602].includes(error.code ?? 0)
}

function rpcIdKey(id: unknown): string | null {
  if (typeof id === 'string') return `string:${id}`
  if (typeof id === 'number' && Number.isFinite(id)) return `number:${id}`
  return null
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return selected
}

function catalogDefaultModel(result: unknown): string | null {
  if (!isRecord(result) || !Array.isArray(result.data)) return null
  const entry = result.data.find(
    (candidate) => isRecord(candidate) && candidate.isDefault === true
  )
  if (!isRecord(entry) || typeof entry.model !== 'string') return null
  return entry.model.trim() || null
}

function inheritConfiguredModel(
  method: string,
  params: JsonMap | undefined,
  defaultModel: string | null
): JsonMap | undefined {
  if (
    !defaultModel ||
    (method !== 'thread/start' && method !== 'turn/start') ||
    params?.model !== defaultModel
  ) {
    return params
  }

  // `model/list.isDefault` describes the first-party catalog default. A
  // configured provider can have a different default, so forwarding that
  // catalog value as an explicit override can turn a working configuration
  // into an upstream 4xx. Omit only the catalog default and let app-server
  // resolve the effective model; explicit non-default selections still pass
  // through unchanged.
  const { model: _catalogDefault, ...inherited } = params
  return inherited
}

function normalizeServerResponse(
  request: RpcServerRequest,
  response: unknown
): RpcServerResponse {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError('App-server response must be an object')
  }
  const value = response as Record<string, unknown>
  const keys = Object.keys(value)
  if (
    keys.length !== 1 ||
    (keys[0] !== 'result' && keys[0] !== 'error')
  ) {
    throw new TypeError('App-server response must contain exactly one of result or error')
  }

  if (keys[0] === 'result') {
    const result = value.result ?? null
    if (!isAllowedServerRequestResult(request, result)) {
      throw new TypeError(`Invalid response for server request ${request.method}`)
    }
    return { result }
  }

  const error = value.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    throw new TypeError('App-server error response must contain an error object')
  }
  const errorValue = error as Record<string, unknown>
  if (
    !Object.keys(errorValue).every((key) => ['code', 'message', 'data'].includes(key)) ||
    !Number.isSafeInteger(errorValue.code) ||
    typeof errorValue.message !== 'string' ||
    errorValue.message.length < 1 ||
    errorValue.message.length > 2_048
  ) {
    throw new TypeError('App-server error response has an invalid shape')
  }
  return {
    error: {
      code: errorValue.code as number,
      message: errorValue.message,
      ...(Object.hasOwn(errorValue, 'data') ? { data: errorValue.data } : {})
    }
  }
}

function initializeCodexHome(value: unknown): string | null {
  if (!isRecord(value) || typeof value.codexHome !== 'string') return null
  const path = value.codexHome.trim()
  if (!path || path.length > 16_384 || path.includes('\0') || /[\r\n]/u.test(path)) return null
  return path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

const mcpRootSchemaKeys = new Set([
  '$schema',
  '$id',
  '$comment',
  'type',
  'title',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties'
])

const mcpFieldSchemaKeys = new Set([
  '$comment',
  'type',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'enum',
  'enumNames',
  'const',
  'oneOf',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'format',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems'
])

function hasOnlyKnownKeys(value: Record<string, unknown>, known: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => known.has(key))
}

function isBoundedNonNegativeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
}

function validatesNumericBounds(schema: Record<string, unknown>, value: number): boolean {
  if (schema.minimum != null && (typeof schema.minimum !== 'number' || value < schema.minimum)) {
    return false
  }
  if (schema.maximum != null && (typeof schema.maximum !== 'number' || value > schema.maximum)) {
    return false
  }
  if (
    schema.exclusiveMinimum != null &&
    (typeof schema.exclusiveMinimum !== 'number' || value <= schema.exclusiveMinimum)
  ) {
    return false
  }
  if (
    schema.exclusiveMaximum != null &&
    (typeof schema.exclusiveMaximum !== 'number' || value >= schema.exclusiveMaximum)
  ) {
    return false
  }
  return true
}

function validatesStringFormat(format: unknown, value: string): boolean {
  if (format == null) return true
  if (format === 'email') {
    return value.length <= 320 && /^[^\s@]+@[^\s@]+$/u.test(value)
  }
  if (format === 'uri') {
    try {
      const parsed = new URL(value)
      return Boolean(parsed.protocol)
    } catch {
      return false
    }
  }
  if (format === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  }
  if (format === 'date-time') {
    return /^\d{4}-\d{2}-\d{2}T/u.test(value) && !Number.isNaN(Date.parse(value))
  }
  return false
}

function validatesLiteralChoices(schema: Record<string, unknown>, value: unknown): boolean {
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(schema.const, value)) return false

  if (schema.enum !== undefined) {
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.length < 1 ||
      schema.enum.length > MAX_MCP_ELICITATION_ENUM_VALUES ||
      schema.enum.some(
        (candidate) =>
          typeof candidate !== 'string' ||
          candidate.length > MAX_MCP_ELICITATION_STRING_LENGTH
      ) ||
      !schema.enum.some((candidate) => isDeepStrictEqual(candidate, value))
    ) {
      return false
    }
  }

  if (schema.enumNames != null) {
    if (
      !Array.isArray(schema.enum) ||
      !Array.isArray(schema.enumNames) ||
      schema.enumNames.length !== schema.enum.length ||
      schema.enumNames.some(
        (name) => typeof name !== 'string' || name.length > MAX_MCP_ELICITATION_STRING_LENGTH
      )
    ) {
      return false
    }
  }

  if (schema.oneOf !== undefined) {
    if (
      !Array.isArray(schema.oneOf) ||
      schema.oneOf.length < 1 ||
      schema.oneOf.length > MAX_MCP_ELICITATION_ENUM_VALUES
    ) {
      return false
    }
    let matches = 0
    for (const candidate of schema.oneOf) {
      if (
        !isRecord(candidate) ||
        !hasOnlyKnownKeys(candidate, new Set(['const', 'title', 'description'])) ||
        typeof candidate.const !== 'string' ||
        candidate.const.length > MAX_MCP_ELICITATION_STRING_LENGTH
      ) {
        return false
      }
      if (isDeepStrictEqual(candidate.const, value)) matches += 1
    }
    if (matches !== 1) return false
  }

  return true
}

function validatesMcpArrayItemSchema(schema: unknown, value: unknown): boolean {
  if (!isRecord(schema)) return false
  if (schema.anyOf !== undefined) {
    if (
      Object.keys(schema).some((key) => key !== 'anyOf') ||
      !Array.isArray(schema.anyOf) ||
      schema.anyOf.length < 1 ||
      schema.anyOf.length > MAX_MCP_ELICITATION_ENUM_VALUES
    ) {
      return false
    }
    let matched = false
    for (const candidate of schema.anyOf) {
      if (
        !isRecord(candidate) ||
        !hasOnlyKnownKeys(candidate, new Set(['const', 'title', 'description'])) ||
        typeof candidate.const !== 'string' ||
        candidate.const.length > MAX_MCP_ELICITATION_STRING_LENGTH
      ) {
        return false
      }
      if (isDeepStrictEqual(candidate.const, value)) matched = true
    }
    return matched
  }
  return validatesMcpFieldValue(schema, value)
}

function validatesMcpFieldValue(schema: Record<string, unknown>, value: unknown): boolean {
  if (
    !hasOnlyKnownKeys(schema, mcpFieldSchemaKeys) ||
    ((schema.enum !== undefined || schema.oneOf !== undefined) && schema.type !== 'string') ||
    !validatesLiteralChoices(schema, value)
  ) {
    return false
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > MAX_MCP_ELICITATION_STRING_LENGTH) return false
    if (
      schema.minLength != null &&
      (!isBoundedNonNegativeInteger(schema.minLength, MAX_MCP_ELICITATION_STRING_LENGTH) ||
        value.length < schema.minLength)
    ) {
      return false
    }
    if (
      schema.maxLength != null &&
      (!isBoundedNonNegativeInteger(schema.maxLength, MAX_MCP_ELICITATION_STRING_LENGTH) ||
        value.length > schema.maxLength)
    ) {
      return false
    }
    return validatesStringFormat(schema.format, value)
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (schema.type !== 'integer' || Number.isSafeInteger(value)) &&
      validatesNumericBounds(schema, value)
    )
  }

  if (schema.type === 'boolean') return typeof value === 'boolean'

  if (schema.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length > MAX_MCP_ELICITATION_ARRAY_ITEMS ||
      !isRecord(schema.items)
    ) {
      return false
    }
    if (
      schema.minItems != null &&
      (!isBoundedNonNegativeInteger(schema.minItems, MAX_MCP_ELICITATION_ARRAY_ITEMS) ||
        value.length < schema.minItems)
    ) {
      return false
    }
    if (
      schema.maxItems != null &&
      (!isBoundedNonNegativeInteger(schema.maxItems, MAX_MCP_ELICITATION_ARRAY_ITEMS) ||
        value.length > schema.maxItems)
    ) {
      return false
    }
    if (schema.uniqueItems != null && typeof schema.uniqueItems !== 'boolean') return false
    if (
      schema.uniqueItems === true &&
      value.some((entry, index) =>
        value.slice(0, index).some((previous) => isDeepStrictEqual(previous, entry))
      )
    ) {
      return false
    }
    return value.every((entry) => validatesMcpArrayItemSchema(schema.items, entry))
  }

  return false
}

function validatesMcpElicitationContent(request: RpcServerRequest, content: unknown): boolean {
  if (!isRecord(content)) return false
  const params = isRecord(request.params) ? request.params : null
  if (!params || !['form', 'openai/form', 'openaiForm'].includes(String(params.mode))) return false

  const schema = isRecord(params.requestedSchema) ? params.requestedSchema : null
  const properties = schema && isRecord(schema.properties) ? schema.properties : null
  if (
    !schema ||
    !properties ||
    !hasOnlyKnownKeys(schema, mcpRootSchemaKeys) ||
    (schema.type !== undefined && schema.type !== 'object') ||
    Object.keys(properties).length > MAX_MCP_ELICITATION_FIELDS ||
    Object.keys(content).length > MAX_MCP_ELICITATION_FIELDS ||
    (schema.additionalProperties != null && typeof schema.additionalProperties !== 'boolean')
  ) {
    return false
  }

  if (
    Object.keys(properties).some(
      (name) => name.length < 1 || name.length > MAX_MCP_ELICITATION_STRING_LENGTH
    ) ||
    Object.keys(content).some(
      (name) => name.length < 1 || name.length > MAX_MCP_ELICITATION_STRING_LENGTH
    )
  ) {
    return false
  }

  const required = schema.required == null ? [] : schema.required
  if (
    !Array.isArray(required) ||
    required.length > MAX_MCP_ELICITATION_FIELDS ||
    !required.every(
      (name) =>
        typeof name === 'string' &&
        name.length > 0 &&
        name.length <= MAX_MCP_ELICITATION_STRING_LENGTH &&
        Object.hasOwn(properties, name)
    ) ||
    new Set(required).size !== required.length
  ) {
    return false
  }

  if (
    schema.minProperties != null &&
    (!isBoundedNonNegativeInteger(schema.minProperties, MAX_MCP_ELICITATION_FIELDS) ||
      Object.keys(content).length < schema.minProperties)
  ) {
    return false
  }
  if (
    schema.maxProperties != null &&
    (!isBoundedNonNegativeInteger(schema.maxProperties, MAX_MCP_ELICITATION_FIELDS) ||
      Object.keys(content).length > schema.maxProperties)
  ) {
    return false
  }

  if (required.some((name) => !Object.hasOwn(content, name))) return false
  return Object.entries(content).every(([name, value]) => {
    const fieldSchema = properties[name]
    return isRecord(fieldSchema) && validatesMcpFieldValue(fieldSchema, value)
  })
}

function isAllowedServerRequestResult(
  request: RpcServerRequest,
  result: unknown
): boolean {
  if (!isRecord(result)) return false

  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'item/fileChange/requestApproval'
  ) {
    if (!hasOnlyKeys(result, ['decision'])) return false
    const decision = result.decision
    let validShape = false
    if (
      decision === 'accept' ||
      decision === 'acceptForSession' ||
      decision === 'decline' ||
      decision === 'cancel'
    ) {
      validShape = true
    } else {
      validShape = Boolean(
        isRecord(decision) &&
          Object.keys(decision).length === 1 &&
          (isRecord(decision.acceptWithExecpolicyAmendment) ||
            isRecord(decision.applyNetworkPolicyAmendment))
      )
    }
    if (!validShape) return false

    const params = isRecord(request.params) ? request.params : null
    const available = Array.isArray(params?.availableDecisions)
      ? params.availableDecisions
      : ['decline', 'cancel', 'acceptForSession', 'accept']
    return available.some((candidate) => isDeepStrictEqual(candidate, decision))
  }

  if (request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') {
    if (!hasOnlyKeys(result, ['decision'])) return false
    if (
      result.decision === 'approved' ||
      result.decision === 'approved_for_session' ||
      result.decision === 'abort'
    ) {
      return true
    }
    const decision = isRecord(result.decision) ? result.decision : null
    const denied = decision && isRecord(decision.denied) ? decision.denied : null
    return Boolean(
      decision &&
        denied &&
        hasOnlyKeys(decision, ['denied']) &&
        hasOnlyKeys(denied, ['rejection']) &&
        typeof denied.rejection === 'string' &&
        denied.rejection.length <= 2_048
    )
  }

  if (request.method === 'item/permissions/requestApproval') {
    if (!hasOnlyKeys(result, ['permissions', 'scope'])) return false
    const params = isRecord(request.params) ? request.params : null
    return (
      (result.scope === 'turn' || result.scope === 'session') &&
      isRecord(result.permissions) &&
      isDeepStrictEqual(result.permissions, isRecord(params?.permissions) ? params.permissions : {})
    )
  }

  if (request.method === 'item/tool/requestUserInput') {
    if (!hasOnlyKeys(result, ['answers']) || !isRecord(result.answers)) return false
    const params = isRecord(request.params) ? request.params : null
    const questions = Array.isArray(params?.questions) ? params.questions : []
    const questionIds = new Set(
      questions
        .map((question) => (isRecord(question) && typeof question.id === 'string' ? question.id : null))
        .filter((id): id is string => Boolean(id))
    )
    return Object.entries(result.answers).every(([id, answer]) => {
      if (!questionIds.has(id) || !isRecord(answer) || !hasOnlyKeys(answer, ['answers'])) return false
      return (
        Array.isArray(answer.answers) &&
        answer.answers.length <= 20 &&
        answer.answers.every(
          (entry) => typeof entry === 'string' && entry.length <= 10_000
        )
      )
    })
  }

  if (request.method === 'mcpServer/elicitation/request') {
    if (result.action === 'decline' || result.action === 'cancel') {
      return hasOnlyKeys(result, ['action'])
    }
    return (
      result.action === 'accept' &&
      hasOnlyKeys(result, ['action', 'content']) &&
      validatesMcpElicitationContent(request, result.content)
    )
  }

  return false
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout
    const finish = (didExit: boolean): void => {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onExit)
      resolve(didExit)
    }
    const onExit = (): void => finish(true)
    child.once('exit', onExit)
    child.once('error', onExit)
    timer = setTimeout(() => finish(false), timeoutMs)
  })
}

function assertJsonPayloadSize(value: unknown, limitBytes: number): void {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new TypeError('App-server response must be JSON serializable')
  }
  if (serialized === undefined) {
    throw new TypeError('App-server response must be JSON serializable')
  }
  if (Buffer.byteLength(serialized) > limitBytes) {
    throw new Error(`App-server response exceeds the ${limitBytes}-byte limit`)
  }
}

import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Duplex } from 'node:stream'
import WebSocket, { type RawData } from 'ws'
import type { AppServerSocket, ManagedDaemonConnectOptions } from './managedDaemon'
import { DEFAULT_DAEMON_MAX_MESSAGE_BYTES, daemonMaxOutboundMessageBytes } from './managedDaemon'

const SSH_APP_SERVER_URL = 'ws://codex-app-server/rpc'
const MAX_CAPTURE_BYTES = 128 * 1024
const REMOTE_CODEX_NOT_FOUND = 86
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const MAX_UNFRAGMENTED_HEADER = 'x-codex-websocket-max-unfragmented-message-bytes'
// Matches the desktop app's app-server compatibility floor. Development
// builds report 0.0.0 and are explicitly accepted by the original client.
const MIN_REMOTE_CODEX_VERSION = [0, 141, 0] as const

export interface SshConnectionOptions {
  host: string
  sshAlias?: string
  port?: number
  identityFile?: string
  connectTimeoutSeconds?: number
  codexBinary?: string
}

export type SshSpawn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe']; windowsHide: true }
) => ChildProcessWithoutNullStreams

export interface RemoteCommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export class SshAppServerError extends Error {
  constructor(
    message: string,
    readonly stage: 'connect' | 'remote_codex_lookup' | 'remote_app_server_start' | 'proxy',
    readonly retryable = true
  ) {
    super(message)
    this.name = 'SshAppServerError'
  }
}

class WebSocketAppServerSocket implements AppServerSocket {
  constructor(
    private readonly socket: WebSocket,
    readonly maxOutboundMessageBytes: number
  ) {}

  get readyState(): number { return this.socket.readyState }
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this
  on(event: 'message' | 'error' | 'close', listener: (...args: any[]) => void): this {
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
      callback(new Error(`App-server message exceeds the ${this.maxOutboundMessageBytes}-byte SSH frame limit`))
      return
    }
    this.socket.send(data, callback)
  }
  close(code?: number): void { this.socket.close(code) }
  terminate(): void { this.socket.terminate() }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`
}

export function parseCodexVersionOutput(value: string): [number, number, number] | null {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:[-+][^\s]+)?(?:\s|$)/u.exec(value.trim())
  if (!match) return null
  const version = match.slice(1, 4).map(Number) as [number, number, number]
  return version.every(Number.isSafeInteger) ? version : null
}

function versionAtLeast(
  version: readonly [number, number, number],
  minimum: readonly [number, number, number]
): boolean {
  if (version.every((part) => part === 0)) return true
  for (let index = 0; index < version.length; index += 1) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index]
  }
  return true
}

export function isPermanentSshFailure(message: string): boolean {
  return /(?:permission denied|authentication failed|too many authentication failures|host key verification failed|no matching (?:host key type|key exchange method)|bad permissions|identity file .* not accessible|could not resolve hostname|name or service not known|nodename nor servname provided)/iu.test(message)
}

function regexEscape(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
}

export function remoteAppServerBootstrapCommand(codexBinary: string): string {
  const binary = shellQuote(codexBinary)
  const controlDirectory = '"${CODEX_HOME:-$HOME/.codex}/app-server-control"'
  const logPath = '"${CODEX_HOME:-$HOME/.codex}/app-server-control/app-server.log"'
  const agentPath = '"${CODEX_HOME:-$HOME/.codex}/app-server-control/forwarded-ssh-agent.sock"'
  const refreshAgent = `if [ -S "\${SSH_AUTH_SOCK:-}" ]; then ln -sfn -- "$SSH_AUTH_SOCK" ${agentPath}; elif [ ! -S ${agentPath} ]; then rm -f -- ${agentPath}; fi`
  const desktopServerPattern = shellQuote(`${regexEscape(codexBinary)}.*[d]esktop-ssh-websocket-v0\\.sock`)
  return [
    'if [ "${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}" = "true" ]; then exit 0; fi',
    `(umask 077; mkdir -p -- ${controlDirectory})`,
    `(pkill -9 -U "$(id -u)" -f ${desktopServerPattern} || true)`,
    refreshAgent,
    `: > ${logPath}`,
    `{ SSH_AUTH_SOCK=${agentPath} nohup ${binary} -c features.code_mode_host=true app-server --listen ${shellQuote('unix://')} </dev/null >${logPath} 2>&1 & }`
  ].join(' && ')
}

export function sshBaseArguments(options: SshConnectionOptions): string[] {
  const seconds = options.connectTimeoutSeconds
  if (seconds !== undefined && (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 3_600)) {
    throw new Error('SSH connect timeout must be between 0 and 3600 seconds')
  }
  const target = options.sshAlias?.trim() || options.host.trim()
  if (!target || target.startsWith('-') || /[\s\0]/u.test(target)) throw new Error('SSH target is invalid')
  if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535)) {
    throw new Error('SSH port must be between 1 and 65535')
  }
  if (options.identityFile !== undefined && (!options.identityFile.trim() || /[\0\r\n]/u.test(options.identityFile))) {
    throw new Error('SSH identity file is invalid')
  }
  const directOptions = options.sshAlias ? [] : [
    ...(options.identityFile ? ['-i', options.identityFile] : []),
    ...(options.port ? ['-p', String(options.port)] : [])
  ]
  return [
    '-T',
    '-o', 'BatchMode=yes',
    ...(seconds === undefined ? [] : ['-o', `ConnectTimeout=${seconds}`]),
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=12',
    ...directOptions,
    target
  ]
}

function loginShellCommand(command: string, marker?: Buffer): string {
  const markedCommand = marker
    ? `printf %s ${shellQuote(marker.toString('hex'))}; ${command}`
    : command
  return `exec "\${SHELL:-/bin/sh}" -l -c ${shellQuote(markedCommand)}`
}

function appendBounded(previous: Buffer, next: Buffer): Buffer {
  const combined = Buffer.concat([previous, next])
  return combined.length <= MAX_CAPTURE_BYTES ? combined : combined.subarray(combined.length - MAX_CAPTURE_BYTES)
}

function stripMarker(value: Buffer, marker: Buffer): Buffer {
  const index = value.indexOf(marker)
  return index < 0 ? value : value.subarray(index + marker.length)
}

function processError(result: RemoteCommandResult, fallback: string): Error {
  const detail = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && !/^debug\d+:/u.test(line))
    .join('\n')
  return new Error(detail || fallback)
}

export class SshAppServerConnector {
  private readonly spawnProcess: SshSpawn
  private readonly codexBinary: string
  private readonly proxyStreams = new Set<Duplex>()
  private bootstrapped = false
  private disposed = false
  private startupTail: Promise<void> = Promise.resolve()

  constructor(
    readonly options: SshConnectionOptions,
    dependencies: { spawnProcess?: SshSpawn } = {}
  ) {
    this.spawnProcess = dependencies.spawnProcess ?? spawn
    this.codexBinary = options.codexBinary?.trim() || 'codex'
  }

  async connect(options: ManagedDaemonConnectOptions): Promise<AppServerSocket> {
    if (this.disposed) throw new Error('SSH app-server connector is disposed')
    return this.withStartupGate(async () => {
      if (this.bootstrapped) {
        try {
          return await this.openProxy(options)
        } catch (cause) {
          if (options.signal?.aborted) throw cause
          if (cause instanceof SshAppServerError && !cause.retryable) throw cause
          this.bootstrapped = false
        }
      }
      await this.bootstrap(options.signal)
      const socket = await this.openProxy(options)
      this.bootstrapped = true
      return socket
    })
  }

  onAppServerInitializationFailed(): void {
    this.bootstrapped = false
  }

  async runRemoteCommand(
    command: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<RemoteCommandResult> {
    if (this.disposed) throw new Error('SSH app-server connector is disposed')
    const marker = randomBytes(16)
    const child = this.spawnSsh(loginShellCommand(command, marker))
    let stdout: Buffer = Buffer.alloc(0)
    let stderr: Buffer = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk) })
    const timeoutMs = options.timeoutMs ?? Math.max(
      DEFAULT_COMMAND_TIMEOUT_MS,
      (this.options.connectTimeoutSeconds ?? 0) * 1_000
    )
    return new Promise<RemoteCommandResult>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error, code: number | null = child.exitCode, signal: NodeJS.Signals | null = child.signalCode): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        child.removeListener('error', onError)
        child.removeListener('close', onClose)
        if (error) reject(error)
        else resolve({
          code,
          signal,
          stdout: stripMarker(stdout, Buffer.from(marker.toString('hex'))).toString('utf8'),
          stderr: stderr.toString('utf8')
        })
      }
      const onError = (error: Error): void => {
        const code = (error as NodeJS.ErrnoException).code
        finish(new SshAppServerError(error.message, 'connect', code !== 'ENOENT' && code !== 'EACCES'))
      }
      const onClose = (code: number | null, signal: NodeJS.Signals | null): void => finish(undefined, code, signal)
      const onAbort = (): void => {
        child.kill('SIGTERM')
        finish(new Error('SSH command canceled'))
      }
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish(new Error(`SSH command timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref()
      child.once('error', onError)
      child.once('close', onClose)
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const stream of this.proxyStreams) stream.destroy()
    this.proxyStreams.clear()
    await this.startupTail.catch(() => undefined)
  }

  private async bootstrap(signal?: AbortSignal): Promise<void> {
    const binary = shellQuote(this.codexBinary)
    const lookup = await this.runRemoteCommand(
      `if command -v ${binary} >/dev/null 2>&1; then exit 0; fi; exit ${REMOTE_CODEX_NOT_FOUND}`,
      { signal }
    )
    if (lookup.code === REMOTE_CODEX_NOT_FOUND) {
      throw new SshAppServerError(
        'No `codex` found in PATH. Please install the Codex CLI on the remote machine.',
        'remote_codex_lookup',
        false
      )
    }
    if (lookup.code !== 0) {
      const error = processError(lookup, `Remote codex lookup failed with exit code ${lookup.code}`)
      throw new SshAppServerError(
        error.message,
        'remote_codex_lookup',
        !isPermanentSshFailure(error.message)
      )
    }

    const versionResult = await this.runRemoteCommand(`${binary} --version`, { signal })
    const versionText = `${versionResult.stdout}\n${versionResult.stderr}`.trim()
    const version = versionResult.code === 0 ? parseCodexVersionOutput(versionText) : null
    // The original client treats a failed or unparseable probe as advisory and
    // lets the initialize handshake determine compatibility. It only blocks a
    // version that was parsed successfully and is known to be too old.
    if (version && !versionAtLeast(version, MIN_REMOTE_CODEX_VERSION)) {
      const detail = `Remote Codex ${version.join('.')} is incompatible; version ${MIN_REMOTE_CODEX_VERSION.join('.')} or newer is required.`
      throw new SshAppServerError(
        detail,
        'remote_codex_lookup',
        false
      )
    }
    const result = await this.runRemoteCommand(remoteAppServerBootstrapCommand(this.codexBinary), { signal })
    if (result.code !== 0) {
      const error = processError(result, `Remote app-server bootstrap failed with exit code ${result.code}`)
      throw new SshAppServerError(
        error.message,
        'remote_app_server_start',
        !isPermanentSshFailure(error.message)
      )
    }
  }

  private openProxy(options: ManagedDaemonConnectOptions): Promise<AppServerSocket> {
    if (options.signal?.aborted) return Promise.reject(new Error('SSH app-server connection canceled'))
    let proxy: Duplex | null = null
    const socket = new WebSocket(SSH_APP_SERVER_URL, {
      createConnection: () => {
        proxy = this.createProxyStream()
        return proxy as never
      },
      handshakeTimeout: options.handshakeTimeoutMs,
      maxPayload: options.maxMessageBytes,
      perMessageDeflate: false
    })
    let settled = false
    let maxOutboundMessageBytes = DEFAULT_DAEMON_MAX_MESSAGE_BYTES
    socket.once('upgrade', (response) => {
      maxOutboundMessageBytes = daemonMaxOutboundMessageBytes(response.headers[MAX_UNFRAGMENTED_HEADER])
    })
    return new Promise<AppServerSocket>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off('open', onOpen)
        socket.off('error', onError)
        socket.off('close', onClose)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const onOpen = (): void => {
        if (settled) return
        settled = true
        cleanup()
        socket.on('error', () => undefined)
        resolve(new WebSocketAppServerSocket(socket, maxOutboundMessageBytes))
      }
      const onError = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        socket.on('error', () => undefined)
        proxy?.destroy()
        socket.terminate()
        reject(error instanceof SshAppServerError
          ? error
          : new SshAppServerError(error.message, 'proxy', !isPermanentSshFailure(error.message)))
      }
      const onClose = (): void => onError(new Error('SSH app-server WebSocket closed before opening'))
      const onAbort = (): void => onError(new Error('SSH app-server connection canceled'))
      socket.once('open', onOpen)
      socket.once('error', onError)
      socket.once('close', onClose)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private createProxyStream(): Duplex {
    const marker = randomBytes(16)
    const binary = shellQuote(this.codexBinary)
    const agentPath = '"${CODEX_HOME:-$HOME/.codex}/app-server-control/forwarded-ssh-agent.sock"'
    const refreshAgent = `if [ -S "\${SSH_AUTH_SOCK:-}" ]; then ln -sfn -- "$SSH_AUTH_SOCK" ${agentPath}; elif [ ! -S ${agentPath} ]; then rm -f -- ${agentPath}; fi`
    const child = this.spawnSsh(loginShellCommand(`${refreshAgent} && exec ${binary} app-server proxy`, marker))
    const { stdin, stdout, stderr } = child
    let markerFound = false
    let pending: Buffer = Buffer.alloc(0)
    let stderrTail: Buffer = Buffer.alloc(0)
    const stream = new Duplex({
      read: () => stdout.resume(),
      write: (chunk, encoding, callback) => { stdin.write(chunk, encoding, callback) },
      final: (callback) => { stdin.end(callback) },
      destroy: (error, callback) => { child.kill('SIGTERM'); callback(error) }
    })
    const socketLike = stream as Duplex & {
      setKeepAlive(): typeof stream
      setNoDelay(): typeof stream
      setTimeout(): typeof stream
    }
    socketLike.setKeepAlive = () => socketLike
    socketLike.setNoDelay = () => socketLike
    socketLike.setTimeout = () => socketLike
    stderr.on('data', (chunk: Buffer) => { stderrTail = appendBounded(stderrTail, chunk) })
    stdout.on('data', (chunk: Buffer) => {
      let output = chunk
      if (!markerFound) {
        pending = Buffer.concat([pending, chunk])
        const index = pending.indexOf(Buffer.from(marker.toString('hex')))
        if (index < 0) {
          if (pending.length > 4_096) pending = pending.subarray(pending.length - 64)
          return
        }
        markerFound = true
        output = pending.subarray(index + marker.toString('hex').length)
        pending = Buffer.alloc(0)
      }
      if (output.length > 0 && !stream.push(output)) stdout.pause()
    })
    stdout.on('end', () => { if (markerFound) stream.push(null) })
    stdin.on('error', (error) => stream.destroy(error))
    child.on('error', (error) => stream.destroy(error))
    child.on('close', (code, signal) => {
      if (code === 0) {
        stream.push(null)
        return
      }
      const detail = stderrTail.toString('utf8').trim()
      const message = `ssh app-server proxy exited with code ${code}, signal ${signal}: ${detail || 'no stderr'}`
      stream.destroy(new SshAppServerError(message, 'proxy', !isPermanentSshFailure(message)))
    })
    this.proxyStreams.add(stream)
    stream.once('close', () => this.proxyStreams.delete(stream))
    queueMicrotask(() => stream.emit('connect'))
    return socketLike
  }

  private spawnSsh(remoteCommand: string): ChildProcessWithoutNullStreams {
    return this.spawnProcess('ssh', [...sshBaseArguments(this.options), remoteCommand], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
  }

  private async withStartupGate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.startupTail
    let release!: () => void
    this.startupTail = new Promise<void>((resolve) => { release = resolve })
    await previous.catch(() => undefined)
    try {
      if (this.disposed) throw new Error('SSH app-server connector is disposed')
      return await operation()
    } finally {
      release()
    }
  }
}

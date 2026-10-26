import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { BackendStatus, JsonMap, RpcNotification, TerminalEvent, TerminalOpenOptions, TerminalSize } from '../shared/api'
import type { AppServerClient } from './appServer'

export interface TerminalServer {
  executeStandaloneCommand<T = unknown>(params: JsonMap, options?: {
    signal?: AbortSignal
    onSubmitted?: () => void
  }): Promise<T>
  request<T = unknown>(method: string, params?: JsonMap): Promise<T>
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
}
interface Session {
  id: string
  owner: number
  decoders: Map<string, StringDecoder>
  closed: boolean
  submitted: boolean
  cancellation: AbortController
}
const MAX_SESSIONS_PER_OWNER = 8
const MAX_INPUT_BYTES = 64 * 1024
const MAX_OUTPUT_DELTA_BYTES = 1024 * 1024

export function validateTerminalSize(size: TerminalSize): TerminalSize {
  if (!size || !Number.isInteger(size.cols) || !Number.isInteger(size.rows) ||
      size.cols < 2 || size.cols > 1000 || size.rows < 1 || size.rows > 1000) {
    throw new Error('Invalid terminal dimensions')
  }
  return { cols: size.cols, rows: size.rows }
}

/** Only this bridge can start a shell. Renderer RPC never accepts arbitrary command/exec. */
export class TerminalSessions {
  private readonly sessions = new Map<string, Session>()
  private disposed = false
  private readonly command: string[]
  private readonly onSessionClosed?: (id: string) => void
  constructor(private readonly server: TerminalServer | AppServerClient,
    private readonly emit: (owner: number, event: TerminalEvent) => void,
    options: { command?: string[]; onSessionClosed?: (id: string) => void } = {}) {
    this.command = options.command?.length ? [...options.command] : ['/bin/zsh', '-l']
    this.onSessionClosed = options.onSessionClosed
    server.on('notification', this.onNotification)
    server.on('status', this.onStatus)
  }

  open(owner: number, options: TerminalOpenOptions): { id: string } {
    if (this.disposed) throw new Error('Terminal bridge is closed')
    const size = validateTerminalSize(options)
    if (!Number.isInteger(owner) || owner < 1) throw new Error('Invalid terminal owner')
    if (typeof options.cwd !== 'string' || !options.cwd.startsWith('/') || options.cwd.includes('\0')) {
      throw new Error('Invalid terminal working directory')
    }
    if ([...this.sessions.values()].filter((session) => session.owner === owner).length >= MAX_SESSIONS_PER_OWNER) {
      throw new Error('Too many open terminals')
    }
    const session: Session = {
      id: `replica-terminal-${randomUUID()}`, owner, decoders: new Map(), closed: false,
      submitted: false, cancellation: new AbortController()
    }
    this.sessions.set(session.id, session)
    // The fixed system shell inherits the server's configured permissions and sandbox.
    void this.server.executeStandaloneCommand<{ exitCode: number | null }>({
      command: this.command, processId: session.id, tty: true,
      disableTimeout: true, disableOutputCap: true, cwd: options.cwd, size,
      env: {TERM: 'xterm-256color', TERMINFO: null, TERMINFO_DIRS: null}
    }, { signal: session.cancellation.signal, onSubmitted: () => { session.submitted = true } }).then((result) => {
      if (session.closed) return
      this.remove(session)
      this.flush(session)
      this.emit(owner, { id: session.id, type: 'exit', exitCode: result.exitCode ?? null })
    }).catch((error: unknown) => {
      if (session.closed) return
      this.remove(session)
      this.flush(session)
      this.emit(owner, { id: session.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return { id: session.id }
  }

  async write(owner: number, id: string, data: string): Promise<void> {
    this.owned(owner, id)
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_INPUT_BYTES) {
      throw new Error('Invalid terminal input')
    }
    if (!data) return
    await this.server.request('command/exec/write', { processId: id, deltaBase64: Buffer.from(data).toString('base64') })
  }

  async resize(owner: number, id: string, size: TerminalSize): Promise<void> {
    this.owned(owner, id)
    await this.server.request('command/exec/resize', { processId: id, size: validateTerminalSize(size) })
  }

  async close(owner: number, id: string): Promise<void> {
    // The renderer removes a local tab as soon as exit is delivered. An exit
    // and its close acknowledgement may cross; an absent session is already closed.
    const session = this.sessions.get(id)
    if (!session) return
    if (session.owner !== owner) throw new Error('Terminal session is unavailable')
    this.remove(session)
    session.cancellation.abort()
    if (!session.submitted) return
    await this.server.request('command/exec/terminate', { processId: id })
  }

  async closeOwner(owner: number): Promise<void> {
    const sessions = [...this.sessions.values()].filter((session) => session.owner === owner)
    await Promise.allSettled(sessions.map((session) => this.close(owner, session.id)))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.server.off('notification', this.onNotification)
    this.server.off('status', this.onStatus)
    await Promise.allSettled([...this.sessions.values()].map((session) => this.close(session.owner, session.id)))
  }

  private owned(owner: number, id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) throw new Error('Terminal session is unavailable')
    return session
  }
  private remove(session: Session): void {
    if (session.closed) return
    session.closed = true
    this.sessions.delete(session.id)
    this.onSessionClosed?.(session.id)
  }
  private flush(session: Session): void {
    for (const decoder of session.decoders.values()) {
      const data = decoder.end()
      if (data) this.emit(session.owner, { id: session.id, type: 'output', data })
    }
  }
  private onStatus = (status: BackendStatus): void => {
    if (status.state !== 'error' && status.state !== 'stopped') return
    for (const session of [...this.sessions.values()]) {
      this.remove(session)
      session.cancellation.abort()
      this.emit(session.owner, { id: session.id, type: 'error', message: status.message || 'Terminal server disconnected' })
    }
  }
  private onNotification = (notification: RpcNotification): void => {
    if (notification.method !== 'command/exec/outputDelta' || !notification.params || typeof notification.params !== 'object') return
    const params = notification.params as Record<string, unknown>
    const session = typeof params.processId === 'string' ? this.sessions.get(params.processId) : undefined
    if (!session || typeof params.deltaBase64 !== 'string' || params.deltaBase64.length > MAX_OUTPUT_DELTA_BYTES * 4 / 3 + 4 ||
        (params.stream !== 'stdout' && params.stream !== 'stderr')) return
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.deltaBase64)) return
    const bytes = Buffer.from(params.deltaBase64, 'base64')
    if (bytes.byteLength > MAX_OUTPUT_DELTA_BYTES || bytes.toString('base64') !== params.deltaBase64) return
    const stream = params.stream === 'stderr' ? 'stderr' : 'stdout'
    const decoder = session.decoders.get(stream) ?? new StringDecoder('utf8')
    session.decoders.set(stream, decoder)
    const data = decoder.write(bytes)
    if (data) this.emit(session.owner, { id: session.id, type: 'output', data })
  }
}

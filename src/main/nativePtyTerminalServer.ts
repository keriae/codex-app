import { EventEmitter } from 'node:events'
import { isAbsolute } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { JsonMap } from '../shared/api'
import type { TerminalServer } from './terminalSessions'

interface NativePtySession {
  pty: IPty
  removeAbortListener(): void
}

type PtySpawn = typeof spawn

/**
 * Local terminals must not run through app-server's command sandbox. The
 * installed desktop uses a separate native PTY service for the same reason:
 * an interactive login shell needs the user's ordinary filesystem access for
 * history, language-tool configuration and other shell startup state.
 */
export class NativePtyTerminalServer extends EventEmitter implements TerminalServer {
  private readonly sessions = new Map<string, NativePtySession>()

  constructor(private readonly spawnPty: PtySpawn = spawn) {
    super()
  }

  executeStandaloneCommand<T = unknown>(params: JsonMap, options: {
    signal?: AbortSignal
    onSubmitted?: () => void
  } = {}): Promise<T> {
    const command = stringArray(params.command)
    const processId = stringValue(params.processId)
    const cwd = stringValue(params.cwd)
    const size = terminalSize(params.size)
    if (!command.length || !processId || !cwd || !isAbsolute(cwd) || this.sessions.has(processId) ||
        params.tty !== true) {
      return Promise.reject(new Error('Invalid native terminal request'))
    }
    if (options.signal?.aborted) return Promise.reject(abortError())

    return new Promise<T>((resolve, reject) => {
      let pty: IPty
      try {
        pty = this.spawnPty(command[0], command.slice(1), {
          name: 'xterm-256color',
          cols: size.cols,
          rows: size.rows,
          cwd,
          env: terminalEnvironment(process.env, params.env)
        })
      } catch (error) {
        reject(error)
        return
      }

      let settled = false
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        dataSubscription.dispose()
        exitSubscription.dispose()
        const session = this.sessions.get(processId)
        session?.removeAbortListener()
        this.sessions.delete(processId)
        resolve({ exitCode } as T)
      }
      const dataSubscription = pty.onData((data) => {
        this.emit('notification', {
          method: 'command/exec/outputDelta',
          params: {
            processId,
            stream: 'stdout',
            deltaBase64: Buffer.from(data, 'utf8').toString('base64')
          }
        })
      })
      const exitSubscription = pty.onExit(({ exitCode }) => finish(exitCode))
      const abort = (): void => {
        try { pty.kill() } catch { /* The child may already have exited. */ }
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      this.sessions.set(processId, {
        pty,
        removeAbortListener: () => options.signal?.removeEventListener('abort', abort)
      })
      options.onSubmitted?.()
      if (options.signal?.aborted) abort()
    })
  }

  async request<T = unknown>(method: string, params: JsonMap = {}): Promise<T> {
    const processId = stringValue(params.processId)
    const session = processId ? this.sessions.get(processId) : undefined
    if (method === 'command/exec/terminate' && !session) return {} as T
    if (!session) throw new Error('Native terminal session is unavailable')

    if (method === 'command/exec/write') {
      const deltaBase64 = stringValue(params.deltaBase64)
      if (!deltaBase64 || !isCanonicalBase64(deltaBase64)) throw new Error('Invalid native terminal input')
      session.pty.write(Buffer.from(deltaBase64, 'base64'))
    } else if (method === 'command/exec/resize') {
      const size = terminalSize(params.size)
      session.pty.resize(size.cols, size.rows)
    } else if (method === 'command/exec/terminate') {
      try { session.pty.kill() } catch { /* The child may already have exited. */ }
    } else {
      throw new Error('Unsupported native terminal request')
    }
    return {} as T
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    ? value
    : []
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') ? value : null
}

function terminalSize(value: unknown): { cols: number; rows: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid native terminal dimensions')
  }
  const size = value as Record<string, unknown>
  if (!Number.isInteger(size.cols) || !Number.isInteger(size.rows) ||
      (size.cols as number) < 2 || (size.cols as number) > 1000 ||
      (size.rows as number) < 1 || (size.rows as number) > 1000) {
    throw new Error('Invalid native terminal dimensions')
  }
  return { cols: size.cols as number, rows: size.rows as number }
}

function terminalEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: unknown
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(inherited)) {
    if (typeof value === 'string') environment[name] = value
  }
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [name, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (typeof value === 'string') environment[name] = value
      else if (value === null) delete environment[name]
    }
  }
  return environment
}

function isCanonicalBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value
}

function abortError(): Error {
  const error = new Error('Native terminal launch was canceled')
  error.name = 'AbortError'
  return error
}

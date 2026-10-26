import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { JsonMap, TerminalEvent } from '../shared/api'
import { TerminalSessions, validateTerminalSize } from './terminalSessions'
import type { TerminalServer } from './terminalSessions'

const settle = async (): Promise<void> => { for (let index = 0; index < 6; index++) await Promise.resolve() }

class FakeTerminalServer extends EventEmitter implements TerminalServer {
  readonly submissions: JsonMap[] = []
  readonly commands = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  startGate: Promise<void> = Promise.resolve()
  readonly requestCalls = vi.fn(async (_method: string, _params?: JsonMap): Promise<unknown> => ({}))

  async request<T = unknown>(method: string, params?: JsonMap): Promise<T> {
    return await this.requestCalls(method, params) as T
  }

  async executeStandaloneCommand<T = unknown>(params: JsonMap, options: {
    signal?: AbortSignal
    onSubmitted?: () => void
  } = {}): Promise<T> {
    await this.startGate
    if (options.signal?.aborted) throw new Error('Canceled before submission')
    this.submissions.push(params)
    options.onSubmitted?.()
    return new Promise<T>((resolve, reject) => {
      this.commands.set(String(params.processId), { resolve: (value) => resolve(value as T), reject })
    })
  }

  delta(id: string, bytes: Buffer, stream = 'stdout'): void {
    this.emit('notification', { method: 'command/exec/outputDelta', params: { processId: id, stream, deltaBase64: bytes.toString('base64') } })
  }
}

function fixture() {
  const server = new FakeTerminalServer()
  const events: { owner: number; event: TerminalEvent }[] = []
  const sessions = new TerminalSessions(server, (owner, event) => events.push({ owner, event }))
  const open = (owner = 1) => sessions.open(owner, { cwd: '/synthetic/project', cols: 80, rows: 24 })
  return { server, events, sessions, open }
}

describe('server-backed native terminal sessions', () => {
  it('uses a fixed PTY shell and isolates input, resize and close by renderer owner', async () => {
    const test = fixture()
    const { id } = test.open()
    await settle()
    expect(test.server.submissions).toEqual([{
      command: ['/bin/zsh', '-l'], processId: id, tty: true, disableTimeout: true,
      disableOutputCap: true, cwd: '/synthetic/project', size: { cols: 80, rows: 24 },
      env: {TERM: 'xterm-256color', TERMINFO: null, TERMINFO_DIRS: null}
    }])
    await expect(test.sessions.write(2, id, 'secret')).rejects.toThrow('unavailable')
    await expect(test.sessions.resize(2, id, { cols: 90, rows: 30 })).rejects.toThrow('unavailable')
    await expect(test.sessions.close(2, id)).rejects.toThrow('unavailable')
    expect(test.server.requestCalls).not.toHaveBeenCalled()
    await test.sessions.write(1, id, 'hello\r\0')
    await test.sessions.resize(1, id, { cols: 90, rows: 30 })
    expect(test.server.requestCalls).toHaveBeenCalledWith('command/exec/write', { processId: id, deltaBase64: Buffer.from('hello\r\0').toString('base64') })
    expect(test.server.requestCalls).toHaveBeenCalledWith('command/exec/resize', { processId: id, size: { cols: 90, rows: 30 } })
    await test.sessions.close(1, id)
    expect(test.server.requestCalls).toHaveBeenCalledWith('command/exec/terminate', { processId: id })
    await expect(test.sessions.write(1, id, 'late')).rejects.toThrow('unavailable')
    await test.sessions.dispose()
  })

  it('uses a host-specific login shell for remote terminal bridges', async () => {
    const server = new FakeTerminalServer()
    const sessions = new TerminalSessions(server, () => undefined, { command: ['/bin/sh', '-l'] })
    const { id } = sessions.open(1, { cwd: '/remote/project', cols: 80, rows: 24 })
    await settle()
    expect(server.submissions[0]).toMatchObject({ command: ['/bin/sh', '-l'], processId: id, cwd: '/remote/project' })
    await sessions.close(1, id)
    await sessions.dispose()
  })

  it('decodes split UTF-8 per stream and ignores unrelated or malformed output', async () => {
    const test = fixture()
    const { id } = test.open()
    await settle()
    const bytes = Buffer.from('你')
    test.server.delta(id, bytes.subarray(0, 1))
    expect(test.events).toHaveLength(0)
    test.server.delta(id, Buffer.from('stderr'), 'stderr')
    test.server.delta(id, bytes.subarray(1))
    expect(test.events).toEqual([
      { owner: 1, event: { id, type: 'output', data: 'stderr' } },
      { owner: 1, event: { id, type: 'output', data: '你' } }
    ])
    test.server.delta('unrelated', Buffer.from('private'))
    test.server.delta(id, Buffer.from('bad-stream'), 'unknown')
    test.server.emit('notification', { method: 'command/exec/outputDelta', params: { processId: id, stream: 'stdout', deltaBase64: 'AB==' } })
    expect(test.events).toHaveLength(2)
    test.server.commands.get(id)!.resolve({ exitCode: 0 })
    await settle()
    expect(test.events[2]).toEqual({ owner: 1, event: { id, type: 'exit', exitCode: 0 } })
    test.server.delta(id, Buffer.from('late-output'))
    expect(test.events).toHaveLength(3)
    await test.sessions.dispose()
  })

  it('reports execution failure or disconnection once and cleans subscriptions on disposal', async () => {
    const test = fixture()
    const failed = test.open()
    const active = test.open(2)
    await settle()
    test.server.commands.get(failed.id)!.reject(new Error('PTY denied'))
    await settle()
    expect(test.events[0]).toEqual({ owner: 1, event: { id: failed.id, type: 'error', message: 'PTY denied' } })
    test.server.emit('status', { state: 'error', mode: 'direct', message: 'Disconnected' })
    expect(test.events[1]).toEqual({ owner: 2, event: { id: active.id, type: 'error', message: 'Disconnected' } })
    test.server.commands.get(active.id)!.reject(new Error('late-error'))
    await settle()
    expect(test.events).toHaveLength(2)
    expect(test.server.listenerCount('notification')).toBe(1)
    await test.sessions.dispose()
    expect(test.server.listenerCount('notification')).toBe(0)
    expect(test.server.listenerCount('status')).toBe(0)
    expect(() => test.open()).toThrow('closed')
  })

  it('cancels a late shell launch when the renderer closes before backend initialization', async () => {
    const test = fixture()
    let initialized: () => void = () => {}
    test.server.startGate = new Promise((resolve) => { initialized = resolve })
    test.open()
    await test.sessions.dispose()
    initialized()
    await settle()
    expect(test.server.submissions).toHaveLength(0)
    expect(test.server.requestCalls).not.toHaveBeenCalled()
    expect(test.events).toHaveLength(0)
  })

  it('closes only an affected document owner and caps sessions and input', async () => {
    const test = fixture()
    const first = test.open()
    const other = test.open(2)
    await settle()
    await test.sessions.closeOwner(1)
    expect(test.server.requestCalls).toHaveBeenCalledTimes(1)
    await test.sessions.write(2, other.id, '')
    expect(test.server.requestCalls).toHaveBeenCalledTimes(1)
    await expect(test.sessions.write(1, first.id, 'late')).rejects.toThrow()
    await expect(test.sessions.write(2, other.id, '你'.repeat(30_000))).rejects.toThrow('Invalid terminal input')
    for (let index = 0; index < 7; index++) test.open(2)
    expect(() => test.open(2)).toThrow('Too many')
    await test.sessions.dispose()
  })

  it('reports every manual or backend-driven session removal to its routing owner', async () => {
    const server = new FakeTerminalServer()
    const onSessionClosed = vi.fn()
    const sessions = new TerminalSessions(server, () => undefined, { onSessionClosed })
    const manual = sessions.open(1, { cwd: '/synthetic/project', cols: 80, rows: 24 })
    const disconnected = sessions.open(2, { cwd: '/synthetic/project', cols: 80, rows: 24 })
    await settle()
    await sessions.close(1, manual.id)
    server.emit('status', { state: 'stopped', mode: 'daemon' })
    expect(onSessionClosed).toHaveBeenCalledWith(manual.id)
    expect(onSessionClosed).toHaveBeenCalledWith(disconnected.id)
    expect(onSessionClosed).toHaveBeenCalledTimes(2)
    await sessions.dispose()
  })

  it('rejects invalid dimensions and owners before executing a command', () => {
    const test = fixture()
    for (const size of [{ cols: 1, rows: 24 }, { cols: 80.5, rows: 24 }, { cols: 80, rows: 0 }, { cols: 1001, rows: 24 }]) {
      expect(() => validateTerminalSize(size)).toThrow('Invalid terminal dimensions')
    }
    expect(() => test.open(0)).toThrow('Invalid terminal owner')
    expect(() => test.sessions.open(1, { cwd: 'relative', cols: 80, rows: 24 })).toThrow('Invalid terminal working directory')
    expect(test.server.submissions).toHaveLength(0)
    void test.sessions.dispose()
  })
  it('acknowledges a tab close reentered from exit without terminating an already exited shell', async () => {
    const server = new FakeTerminalServer()
    let closing: Promise<void> | undefined
    const sessions = new TerminalSessions(server, (owner, event) => {
      if (event.type === 'exit') closing = sessions.close(owner, event.id)
    })
    const { id } = sessions.open(1, {cwd: '/synthetic/project', cols: 80, rows: 24})
    await settle()
    server.commands.get(id)!.resolve({exitCode: 0})
    await settle()
    await expect(closing).resolves.toBeUndefined()
    await expect(sessions.close(1, id)).resolves.toBeUndefined()
    expect(server.requestCalls).not.toHaveBeenCalled()
    await sessions.dispose()
  })
})

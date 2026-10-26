import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { RpcServerRequest } from '../shared/api'
import { AppServerClient, AppServerError, type AppServerSpawn } from './appServer'
import { DESKTOP_INITIALIZE_ID, DESKTOP_INITIALIZE_PARAMS } from './desktopProtocol'
import type { AppServerSocket, ManagedDaemonConnect } from './managedDaemon'

interface TestPendingRequest {
  method: string
  generation: number
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: NodeJS.Timeout
}

interface TestClientInternals {
  child: ChildProcessWithoutNullStreams | null
  socket: AppServerSocket | null
  generation: number
  pending: Map<string, TestPendingRequest>
  serverRequests: Map<string, RpcServerRequest>
  handleMessage(message: Record<string, unknown>, generation?: number): void
}

class ControlledStdin extends EventEmitter {
  destroyed = false
  acceptWrites = true
  nextError: Error | null = null
  readonly writes: string[] = []

  write(value: string, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(value)
    const error = this.nextError
    this.nextError = null
    queueMicrotask(() => callback?.(error))
    return this.acceptWrites
  }

  end(): void {
    this.destroyed = true
    this.emit('close')
  }
}

class FakeChild extends EventEmitter {
  readonly stdin = new ControlledStdin()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false
  readonly kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    this.killed = true
    queueMicrotask(() => {
      if (this.exitCode !== null || this.signalCode !== null) return
      this.signalCode = signal
      this.emit('exit', null, signal)
    })
    return true
  })

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams
  }
}

class FakeSocket extends EventEmitter implements AppServerSocket {
  readyState = 1
  maxOutboundMessageBytes?: number
  readonly writes: string[] = []
  readonly close = vi.fn((code = 1000) => {
    if (this.readyState >= 2) return
    this.readyState = 2
    queueMicrotask(() => {
      this.readyState = 3
      this.emit('close', code, Buffer.alloc(0))
    })
  })
  readonly terminate = vi.fn(() => {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close', 1006, Buffer.alloc(0))
  })

  send(value: string, callback: (error?: Error) => void): void {
    this.writes.push(value)
    queueMicrotask(() => callback())
  }

  receive(value: Record<string, unknown>): void {
    this.emit('message', Buffer.from(JSON.stringify(value)), false)
  }
}

function internals(client: AppServerClient): TestClientInternals {
  return client as unknown as TestClientInternals
}

function attachConnection(client: AppServerClient, child = new FakeChild(), generation = 1): FakeChild {
  const state = internals(client)
  state.child = child.asChild()
  state.generation = generation
  return child
}

function createSpawnedClient(
  child: FakeChild,
  options: { initializeTimeoutMs?: number; shutdownGraceMs?: number } = {}
): { client: AppServerClient; spawnProcess: ReturnType<typeof vi.fn<AppServerSpawn>> } {
  const spawnProcess = vi.fn<AppServerSpawn>(() => child.asChild())
  const client = new AppServerClient({
    spawnProcess,
    resolveBinary: () => '/test/bin/codex',
    resolveDaemonSocket: () => null,
    initializeTimeoutMs: options.initializeTimeoutMs,
    shutdownGraceMs: options.shutdownGraceMs
  })
  return { client, spawnProcess }
}

const TEST_INITIALIZE_RESULT = {
  userAgent: 'codex-test',
  codexHome: '/home/developer/.codex',
  platformFamily: 'unix',
  platformOs: 'linux'
}

function replyToSocketStartup(
  socket: FakeSocket,
  authError?: { code: number; message: string }
): void {
  const originalSend = socket.send.bind(socket)
  socket.send = (value, callback): void => {
    originalSend(value, callback)
    const message = JSON.parse(value) as Record<string, unknown>
    if (message.id === DESKTOP_INITIALIZE_ID) {
      queueMicrotask(() => socket.receive({ id: DESKTOP_INITIALIZE_ID, result: TEST_INITIALIZE_RESULT }))
    } else if (message.method === 'getAuthStatus') {
      queueMicrotask(() =>
        socket.receive(
          authError
            ? { id: message.id, error: authError }
            : { id: message.id, result: { authMethod: 'chatgpt' } }
        )
      )
    }
  }
}

function replyToStartup(child: FakeChild, authError?: { code: number; message: string }): void {
  const originalWrite = child.stdin.write.bind(child.stdin)
  child.stdin.write = (value, callback): boolean => {
    const accepted = originalWrite(value, callback)
    const message = JSON.parse(value) as Record<string, unknown>
    if (message.id === DESKTOP_INITIALIZE_ID) {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({ id: DESKTOP_INITIALIZE_ID, result: TEST_INITIALIZE_RESULT })}\n`)
      })
    } else if (message.method === 'getAuthStatus') {
      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify(
            authError
              ? { id: message.id, error: authError }
              : { id: message.id, result: { authStatus: 'authenticated' } }
          )}\n`
        )
      })
    }
    return accepted
  }
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('AppServerClient message routing', () => {
  it('correlates successful and failed responses by id', () => {
    const client = new AppServerClient()
    const state = internals(client)
    state.generation = 4
    const success = vi.fn()
    const failure = vi.fn()
    const successTimer = setTimeout(() => undefined, 10_000)
    const failureTimer = setTimeout(() => undefined, 10_000)

    state.pending.set('number:7', {
      method: 'model/list',
      generation: 4,
      resolve: success,
      reject: vi.fn(),
      timeout: successTimer
    })
    state.pending.set('number:8', {
      method: 'thread/read',
      generation: 4,
      resolve: vi.fn(),
      reject: failure,
      timeout: failureTimer
    })

    state.handleMessage({ id: 7, result: { data: [] } }, 4)
    state.handleMessage({ id: 8, error: { code: 404, message: 'missing' } }, 4)

    expect(success).toHaveBeenCalledWith({ data: [] })
    expect(failure).toHaveBeenCalledOnce()
    expect(failure.mock.calls[0]?.[0]).toBeInstanceOf(AppServerError)
    expect(failure.mock.calls[0]?.[0]).toMatchObject({ code: 404, message: 'missing' })
    expect(state.pending.size).toBe(0)
  })

  it('forwards notifications without treating them as requests', () => {
    const client = new AppServerClient()
    const listener = vi.fn()
    client.on('notification', listener)

    internals(client).handleMessage({
      method: 'turn/completed',
      params: { threadId: 'thread-1' }
    })

    expect(listener).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: { threadId: 'thread-1' }
    })
    expect(client.getPendingServerRequests()).toEqual([])
  })

  it('keeps numeric and string RPC ids in separate namespaces', async () => {
    const client = new AppServerClient()
    const child = attachConnection(client)
    const state = internals(client)
    const numericResponse = vi.fn()
    const stringResponse = vi.fn()
    state.pending.set('number:1', {
      method: 'numeric',
      generation: 1,
      resolve: numericResponse,
      reject: vi.fn(),
      timeout: setTimeout(() => undefined, 10_000)
    })
    state.pending.set('string:1', {
      method: 'string',
      generation: 1,
      resolve: stringResponse,
      reject: vi.fn(),
      timeout: setTimeout(() => undefined, 10_000)
    })

    state.handleMessage({ id: 1, result: 'number' }, 1)
    state.handleMessage({ id: '1', result: 'string' }, 1)
    expect(numericResponse).toHaveBeenCalledWith('number')
    expect(stringResponse).toHaveBeenCalledWith('string')

    state.handleMessage({ id: 1, method: 'item/commandExecution/requestApproval' }, 1)
    state.handleMessage({ id: '1', method: 'item/commandExecution/requestApproval' }, 1)
    expect(client.getPendingServerRequests()).toHaveLength(2)
    await Promise.all([
      client.respond(1, { result: { decision: 'accept' } }),
      client.respond('1', { result: { decision: 'decline' } })
    ])
    expect(child.stdin.writes.map((line) => JSON.parse(line))).toEqual([
      { id: 1, result: { decision: 'accept' } },
      { id: '1', result: { decision: 'decline' } }
    ])
  })

  it('retains requests for replay and atomically prevents duplicate responses', async () => {
    const client = new AppServerClient()
    const listener = vi.fn<(request: RpcServerRequest) => void>()
    const child = attachConnection(client)
    client.on('server-request', listener)

    internals(client).handleMessage(
      {
        id: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'git status' }
      },
      1
    )

    expect(listener).toHaveBeenCalledOnce()
    expect(client.getPendingServerRequests()).toHaveLength(1)

    const response = client.respond('approval-1', { result: { decision: 'accept' } })
    await expect(client.respond('approval-1', { result: null })).rejects.toThrow(
      'No pending app-server request with id approval-1'
    )
    await response

    expect(child.stdin.writes).toContain(
      `${JSON.stringify({ id: 'approval-1', result: { decision: 'accept' } })}\n`
    )
    expect(client.getPendingServerRequests()).toEqual([])
  })

  it('rejects malformed renderer responses without consuming the pending request', async () => {
    const client = new AppServerClient()
    attachConnection(client)
    internals(client).handleMessage(
      { id: 'approval-2', method: 'item/commandExecution/requestApproval' },
      1
    )

    await expect(
      client.respond('approval-2', {
        result: { decision: 'accept' },
        error: { code: -1, message: 'ambiguous' }
      })
    ).rejects.toThrow('exactly one of result or error')
    expect(client.getPendingServerRequests()).toHaveLength(1)
  })

  it('rejects permission responses that expand beyond the server request', async () => {
    const client = new AppServerClient()
    attachConnection(client)
    internals(client).handleMessage(
      {
        id: 'permissions-1',
        method: 'item/permissions/requestApproval',
        params: { permissions: { network: { enabled: false } } }
      },
      1
    )

    await expect(
      client.respond('permissions-1', {
        result: { permissions: { network: { enabled: true } }, scope: 'session' }
      })
    ).rejects.toThrow('Invalid response for server request')
    expect(client.getPendingServerRequests()).toHaveLength(1)
  })

  it('accepts only approval decisions offered by the server request', async () => {
    const client = new AppServerClient()
    const child = attachConnection(client)
    internals(client).handleMessage(
      {
        id: 'approval-offer-1',
        method: 'item/commandExecution/requestApproval',
        params: { availableDecisions: ['decline'] }
      },
      1
    )

    await expect(
      client.respond('approval-offer-1', { result: { decision: 'accept' } })
    ).rejects.toThrow('Invalid response for server request')
    await client.respond('approval-offer-1', { result: { decision: 'decline' } })
    expect(child.stdin.writes.map((line) => JSON.parse(line))).toContainEqual({
      id: 'approval-offer-1',
      result: { decision: 'decline' }
    })
  })

  it('validates accepted MCP elicitation content against the requested schema', async () => {
    const client = new AppServerClient()
    const child = attachConnection(client)
    internals(client).handleMessage(
      {
        id: 'elicitation-1',
        method: 'mcpServer/elicitation/request',
        params: {
          mode: 'form',
          requestedSchema: {
            $schema: null,
            type: 'object',
            additionalProperties: false,
            required: ['name', 'count'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 20, format: null },
              count: { type: 'integer', minimum: 1, maximum: 5 },
              channel: {
                type: 'string',
                enum: ['stable', 'preview'],
                enumNames: ['Stable', 'Preview']
              },
              features: {
                type: 'array',
                maxItems: 2,
                uniqueItems: true,
                items: {
                  anyOf: [
                    { const: 'search', title: 'Search' },
                    { const: 'files', title: 'Files' }
                  ]
                }
              }
            }
          }
        }
      },
      1
    )

    for (const content of [
      { name: 'Ada', count: 1, unrequested: true },
      { name: 'Ada', count: 1.5 },
      { name: 'Ada' },
      { name: 'Ada', count: 1, channel: 'nightly' },
      { name: 'Ada', count: 1, features: ['search', 'search'] }
    ]) {
      await expect(
        client.respond('elicitation-1', { result: { action: 'accept', content } })
      ).rejects.toThrow('Invalid response for server request')
      expect(client.getPendingServerRequests()).toHaveLength(1)
    }

    const content = {
      name: 'Ada',
      count: 2,
      channel: 'stable',
      features: ['search', 'files']
    }
    await client.respond('elicitation-1', { result: { action: 'accept', content } })
    expect(child.stdin.writes.map((line) => JSON.parse(line))).toContainEqual({
      id: 'elicitation-1',
      result: { action: 'accept', content }
    })
  })

  it('fails closed for MCP elicitation constraints the local validator does not support', async () => {
    const client = new AppServerClient()
    attachConnection(client)
    internals(client).handleMessage(
      {
        id: 'elicitation-unsupported',
        method: 'mcpServer/elicitation/request',
        params: {
          mode: 'form',
          requestedSchema: {
            type: 'object',
            properties: { code: { type: 'string', pattern: '^[A-Z]+$' } }
          }
        }
      },
      1
    )

    await expect(
      client.respond('elicitation-unsupported', {
        result: { action: 'accept', content: { code: 'SAFE' } }
      })
    ).rejects.toThrow('Invalid response for server request')
  })

  it('allows structured errors but not successful results for unsupported requests', async () => {
    const client = new AppServerClient()
    const child = attachConnection(client)
    internals(client).handleMessage({ id: 'tool-1', method: 'item/tool/call' }, 1)

    await expect(client.respond('tool-1', { result: { content: [] } })).rejects.toThrow(
      'Invalid response for server request item/tool/call'
    )
    await client.respond('tool-1', {
      error: { code: -32601, message: 'No registered tool' }
    })
    expect(child.stdin.writes.map((line) => JSON.parse(line))).toContainEqual({
      id: 'tool-1',
      error: { code: -32601, message: 'No registered tool' }
    })
  })

  it('bounds retained server requests and rejects overflow on the wire', async () => {
    const client = new AppServerClient({ maxServerRequests: 1 })
    const child = attachConnection(client)
    const protocolError = vi.fn()
    client.on('protocol-error', protocolError)

    internals(client).handleMessage(
      { id: 'first', method: 'item/commandExecution/requestApproval' },
      1
    )
    internals(client).handleMessage(
      { id: 'second', method: 'item/commandExecution/requestApproval' },
      1
    )
    await nextTask()

    expect(client.getPendingServerRequests().map((request) => request.id)).toEqual(['first'])
    expect(protocolError).toHaveBeenCalledOnce()
    expect(child.stdin.writes.map((line) => JSON.parse(line))).toContainEqual({
      id: 'second',
      error: {
        code: -32000,
        message: 'The desktop client has too many pending requests',
        data: { kind: 'client_request_capacity_exceeded', retryable: true }
      }
    })
  })

  it('rejects oversized responses before consuming the pending request', async () => {
    const client = new AppServerClient({ maxOutboundMessageBytes: 64, shutdownGraceMs: 10 })
    const child = attachConnection(client)
    const amendment = { acceptWithExecpolicyAmendment: { command: 'x'.repeat(256) } }
    internals(client).handleMessage(
      {
        id: 'approval-3',
        method: 'item/commandExecution/requestApproval',
        params: { availableDecisions: [amendment] }
      },
      1
    )

    await expect(
      client.respond('approval-3', {
        result: {
          decision: amendment
        }
      })
    ).rejects.toThrow('64-byte limit')

    expect(client.getPendingServerRequests()).toHaveLength(1)
    expect(internals(client).child).toBe(child.asChild())
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('rejects cyclic response data before consuming the pending request', async () => {
    const client = new AppServerClient()
    const child = attachConnection(client)
    internals(client).handleMessage({ id: 'unsupported-1', method: 'item/tool/call' }, 1)
    const data: Record<string, unknown> = {}
    data.self = data

    await expect(
      client.respond('unsupported-1', {
        error: { code: -32601, message: 'Unavailable', data }
      })
    ).rejects.toThrow('JSON serializable')
    expect(client.getPendingServerRequests()).toHaveLength(1)
    expect(internals(client).child).toBe(child.asChild())
  })

  it('ignores parser callbacks from an obsolete connection generation', () => {
    const client = new AppServerClient()
    const state = internals(client)
    state.generation = 2
    const resolve = vi.fn()
    const timeout = setTimeout(() => undefined, 10_000)
    state.pending.set('number:1', {
      method: 'model/list',
      generation: 2,
      resolve,
      reject: vi.fn(),
      timeout
    })
    const notification = vi.fn()
    client.on('notification', notification)

    state.handleMessage({ id: 1, result: 'stale' }, 1)
    state.handleMessage({ method: 'turn/completed' }, 1)

    expect(resolve).not.toHaveBeenCalled()
    expect(notification).not.toHaveBeenCalled()
    expect(state.pending.has('number:1')).toBe(true)

    state.handleMessage({ id: 1, result: 'current' }, 2)
    expect(resolve).toHaveBeenCalledWith('current')
  })

  it('waits for both the write callback and drain under backpressure', async () => {
    const client = new AppServerClient()
    const child = attachConnection(client)
    child.stdin.acceptWrites = false
    internals(client).handleMessage(
      { id: 9, method: 'item/commandExecution/requestApproval' },
      1
    )
    let completed = false

    const response = client.respond(9, { result: { decision: 'accept' } }).then(() => {
      completed = true
    })
    await nextTask()

    expect(child.stdin.writes).toHaveLength(1)
    expect(completed).toBe(false)
    child.stdin.emit('drain')
    await response
    expect(completed).toBe(true)
  })

  it('tears down the connection after an EPIPE write failure', async () => {
    const client = new AppServerClient({ shutdownGraceMs: 10 })
    const child = attachConnection(client)
    child.stdin.nextError = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
    internals(client).handleMessage(
      { id: 10, method: 'item/commandExecution/requestApproval' },
      1
    )

    await expect(client.respond(10, { result: { decision: 'accept' } })).rejects.toMatchObject({
      code: 'EPIPE'
    })
    await nextTask()

    expect(internals(client).child).toBeNull()
    expect(client.getStatus()).toMatchObject({ state: 'error', message: 'broken pipe' })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

describe('standalone PTY request lifecycle', () => {
  it('keeps PTY requests pending beyond forty-five seconds while ordinary RPC still times out', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client } = createSpawnedClient(child)
    await client.start()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const ordinary = client.request('model/list').then(() => null, (error: Error) => error)
      const terminal = client.executeStandaloneCommand({ command: ['/bin/zsh', '-l'], tty: true, processId: 'test-terminal' })
      await nextTask()
      const terminalMessage = child.stdin.writes.map((line) => JSON.parse(line)).find((message) => message.method === 'command/exec')!
      await vi.advanceTimersByTimeAsync(45_001)
      expect(await ordinary).toMatchObject({ message: '[outcome-unknown] model/list timed out after 45000ms', stage: 'outcome-unknown' })
      expect(internals(client).pending.size).toBe(1)
      internals(client).handleMessage({ id: terminalMessage.id, result: { exitCode: 0 } })
      await expect(terminal).resolves.toEqual({ exitCode: 0 })
      expect(internals(client).pending.size).toBe(0)
    } finally {
      vi.useRealTimers()
      await client.stop()
    }
  })

  it('does not submit a shell canceled while the backend is initializing', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client } = createSpawnedClient(child)
    const cancellation = new AbortController()
    const submitted = vi.fn()
    const terminal = client.executeStandaloneCommand(
      { command: ['/bin/zsh', '-l'], tty: true, processId: 'canceled-terminal' },
      { signal: cancellation.signal, onSubmitted: submitted }
    )
    cancellation.abort()
    await expect(terminal).rejects.toThrow('canceled before submission')
    expect(submitted).not.toHaveBeenCalled()
    expect(child.stdin.writes.map((line) => JSON.parse(line).method)).not.toContain('command/exec')
    await client.stop()
  })
})

describe('AppServerClient lifecycle', () => {
  it('rejects messages above the daemon handshake limit without closing a healthy connection', async () => {
    const socket = new FakeSocket()
    replyToSocketStartup(socket)
    const client = new AppServerClient({
      preferManagedDaemon: true,
      resolveDaemonSocket: () => '/test/app-server-control.sock',
      connectDaemon: async () => socket,
      shutdownGraceMs: 10
    })
    await client.start()
    socket.maxOutboundMessageBytes = 128
    const before = socket.writes.length
    await expect(client.request('thread/start', { cwd: '/synthetic/workspace', text: 'x'.repeat(128) })).rejects.toThrow('128-byte limit')
    expect(socket.writes).toHaveLength(before)
    expect(socket.close).not.toHaveBeenCalled()
    expect(client.getStatus().state).toBe('ready')
    expect(internals(client).pending.size).toBe(0)
    await client.stop()
  })

  it('defaults to a private stdio server even when a managed daemon is available', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const connectDaemon = vi.fn<ManagedDaemonConnect>()
    const resolveDaemonSocket = vi.fn(() => '/test/app-server-control.sock')
    const spawnProcess = vi.fn<AppServerSpawn>(() => child.asChild())
    const client = new AppServerClient({
      connectDaemon,
      resolveDaemonSocket,
      spawnProcess,
      resolveBinary: () => '/test/bin/codex',
      shutdownGraceMs: 10
    })

    await client.start()

    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(resolveDaemonSocket).not.toHaveBeenCalled()
    expect(connectDaemon).not.toHaveBeenCalled()
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'direct' })
    await client.stop()
  })

  it('uses the managed daemon when explicitly requested and closes only its own WebSocket on stop', async () => {
    const socket = new FakeSocket()
    replyToSocketStartup(socket)
    const connectDaemon = vi.fn<ManagedDaemonConnect>(async () => socket)
    const child = new FakeChild()
    const spawnProcess = vi.fn<AppServerSpawn>(() => child.asChild())
    const client = new AppServerClient({
      connectDaemon,
      preferManagedDaemon: true,
      resolveDaemonSocket: () => '/test/app-server-control.sock',
      spawnProcess,
      resolveBinary: () => '/test/bin/codex',
      shutdownGraceMs: 10
    })

    await client.start()

    expect(connectDaemon).toHaveBeenCalledWith('/test/app-server-control.sock', {
      handshakeTimeoutMs: 12_000,
      maxMessageBytes: 16 * 1024 * 1024,
      signal: expect.any(AbortSignal)
    })
    expect(spawnProcess).not.toHaveBeenCalled()
    expect(socket.writes.map((message) => JSON.parse(message))).toEqual([
      {
        method: 'initialize',
        id: DESKTOP_INITIALIZE_ID,
        params: DESKTOP_INITIALIZE_PARAMS
      },
      {
        method: 'getAuthStatus',
        id: 1,
        params: { includeToken: false, refreshToken: false }
      }
    ])
    expect(socket.writes.every((message) => !message.endsWith('\n'))).toBe(true)
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'daemon' })
    await expect(client.codexHome()).resolves.toBe('/home/developer/.codex')

    await client.stop()

    expect(socket.close).toHaveBeenCalledWith(1000)
    expect(socket.terminate).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
    expect(client.getStatus()).toEqual({ state: 'stopped', mode: 'daemon' })
  })

  it('falls back to a private stdio app-server when the daemon cannot connect', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const connectDaemon = vi.fn<ManagedDaemonConnect>(async () => {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
    })
    const spawnProcess = vi.fn<AppServerSpawn>(() => child.asChild())
    const client = new AppServerClient({
      connectDaemon,
      preferManagedDaemon: true,
      resolveDaemonSocket: () => '/test/app-server-control.sock',
      spawnProcess,
      resolveBinary: () => '/test/bin/codex'
    })

    await client.start()

    expect(connectDaemon).toHaveBeenCalledOnce()
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'direct' })
    await client.stop()
  })

  it('closes an incompatible daemon connection before falling back to stdio', async () => {
    const socket = new FakeSocket()
    replyToSocketStartup(socket, { code: 401, message: 'daemon authentication unavailable' })
    const child = new FakeChild()
    replyToStartup(child)
    const spawnProcess = vi.fn<AppServerSpawn>(() => child.asChild())
    const client = new AppServerClient({
      connectDaemon: async () => socket,
      preferManagedDaemon: true,
      resolveDaemonSocket: () => '/test/app-server-control.sock',
      spawnProcess,
      resolveBinary: () => '/test/bin/codex',
      shutdownGraceMs: 10
    })

    await client.start()

    expect(socket.close).toHaveBeenCalledWith(1000)
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'direct' })
    await client.stop()
  })

  it('does not let a superseded daemon handshake fall back over a restarted connection', async () => {
    const staleSocket = new FakeSocket()
    const currentSocket = new FakeSocket()
    replyToSocketStartup(currentSocket)
    let resolveStaleConnection!: (socket: AppServerSocket) => void
    const staleConnection = new Promise<AppServerSocket>((resolve) => {
      resolveStaleConnection = resolve
    })
    const connectDaemon = vi
      .fn<ManagedDaemonConnect>()
      .mockImplementationOnce(() => staleConnection)
      .mockImplementationOnce(async () => currentSocket)
    const spawnProcess = vi.fn<AppServerSpawn>(() => new FakeChild().asChild())
    const client = new AppServerClient({
      connectDaemon,
      preferManagedDaemon: true,
      resolveDaemonSocket: () => '/test/app-server-control.sock',
      spawnProcess,
      resolveBinary: () => '/test/bin/codex',
      shutdownGraceMs: 10
    })

    const supersededStartup = client.start().catch((error: unknown) => error)
    await nextTask()
    await client.stop()

    await client.start()
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'daemon' })

    resolveStaleConnection(staleSocket)
    await expect(supersededStartup).resolves.toBeInstanceOf(Error)
    await nextTask()

    expect(staleSocket.close).toHaveBeenCalledWith(1000)
    expect(spawnProcess).not.toHaveBeenCalled()
    expect(internals(client).socket).toBe(currentSocket)
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'daemon' })
    await client.stop()
  })

  it('uses direct stdio and sends the exact desktop startup sequence', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client, spawnProcess } = createSpawnedClient(child)

    await client.start()

    expect(spawnProcess).toHaveBeenCalledWith(
      '/test/bin/codex',
      [
        '-c',
        'features.code_mode_host=true',
        'app-server',
        '--analytics-default-enabled',
        '-c',
        'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true',
        '-c',
        'plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=true'
      ],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    )
    expect(child.stdin.writes.map((line) => JSON.parse(line))).toEqual([
      {
        method: 'initialize',
        id: DESKTOP_INITIALIZE_ID,
        params: DESKTOP_INITIALIZE_PARAMS
      },
      {
        method: 'getAuthStatus',
        id: 1,
        params: { includeToken: false, refreshToken: false }
      }
    ])
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'direct' })
    await client.stop()
  })

  it('inherits the configured provider model when the renderer submits the catalog default', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client } = createSpawnedClient(child)
    await client.start()

    const write = child.stdin.write.bind(child.stdin)
    child.stdin.write = (value, callback): boolean => {
      const accepted = write(value, callback)
      const message = JSON.parse(value) as Record<string, unknown>
      if (message.method === 'model/list') {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: {
                data: [
                  { model: 'catalog-default', isDefault: true },
                  { model: 'explicit-model', isDefault: false }
                ]
              }
            })}\n`
          )
        })
      } else if (message.method === 'thread/start') {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: { thread: { id: 'thread-1' }, model: 'provider-default' }
            })}\n`
          )
        })
      } else if (message.method === 'turn/start') {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`
          )
        })
      }
      return accepted
    }

    await client.request('model/list', { limit: 100 })
    expect(
      (client as unknown as { catalogDefaultModel: string | null }).catalogDefaultModel
    ).toBe('catalog-default')
    await client.request('thread/start', {
      cwd: '/test/workspace',
      model: 'catalog-default',
      ephemeral: false
    })
    await client.request('turn/start', {
      threadId: 'thread-1',
      clientUserMessageId: 'message-1',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      cwd: '/test/workspace',
      model: 'catalog-default',
      effort: 'low'
    })

    const requests = child.stdin.writes.map((line) => JSON.parse(line))
    expect(requests.find((request) => request.method === 'thread/start')?.params).toEqual({
      cwd: '/test/workspace',
      ephemeral: false
    })
    expect(requests.find((request) => request.method === 'turn/start')?.params).toEqual({
      threadId: 'thread-1',
      clientUserMessageId: 'message-1',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      cwd: '/test/workspace',
      effort: 'low'
    })
    await client.stop()
  })

  it('preserves an explicit non-default model selection', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client } = createSpawnedClient(child)
    await client.start()

    const write = child.stdin.write.bind(child.stdin)
    child.stdin.write = (value, callback): boolean => {
      const accepted = write(value, callback)
      const message = JSON.parse(value) as Record<string, unknown>
      if (message.method === 'model/list') {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: { data: [{ model: 'catalog-default', isDefault: true }] }
            })}\n`
          )
        })
      } else if (message.method === 'thread/start') {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({ id: message.id, result: { thread: { id: 'thread-2' } } })}\n`
          )
        })
      }
      return accepted
    }

    await client.request('model/list', { limit: 100 })
    await client.request('thread/start', {
      cwd: '/test/workspace',
      model: 'explicit-model',
      ephemeral: false
    })

    const request = child.stdin.writes
      .map((line) => JSON.parse(line))
      .find((candidate) => candidate.method === 'thread/start')
    expect(request?.params.model).toBe('explicit-model')
    await client.stop()
  })

  it('kills and clears a child whose initialize request times out', async () => {
    const child = new FakeChild()
    const { client } = createSpawnedClient(child, {
      initializeTimeoutMs: 5,
      shutdownGraceMs: 10
    })

    await expect(client.start()).rejects.toThrow('initialize timed out after 5ms')

    expect(internals(client).child).toBeNull()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(client.getStatus()).toMatchObject({
      state: 'error',
      message: 'initialize timed out after 5ms'
    })
  })

  it('does not become ready when the startup auth-status check fails', async () => {
    const child = new FakeChild()
    replyToStartup(child, { code: 401, message: 'authentication unavailable' })
    const { client } = createSpawnedClient(child, { shutdownGraceMs: 10 })

    await expect(client.start()).rejects.toMatchObject({
      name: 'AppServerError',
      code: 401,
      message: 'authentication unavailable'
    })

    expect(internals(client).child).toBeNull()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(client.getStatus()).toMatchObject({
      state: 'error',
      message: 'authentication unavailable'
    })
  })

  it('rejects pending calls and clears state when the child exits', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client } = createSpawnedClient(child)
    await client.start()

    const request = client.request('model/list')
    await nextTask()
    child.exitCode = 17
    child.emit('exit', 17, null)

    await expect(request).rejects.toThrow('Codex app-server exited (17)')
    expect(internals(client).child).toBeNull()
    expect(client.getStatus()).toMatchObject({
      state: 'error',
      message: 'Codex app-server exited (17)'
    })
  })

  it('bounds concurrent outbound requests', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const client = new AppServerClient({
      spawnProcess: () => child.asChild(),
      resolveBinary: () => '/test/bin/codex',
      resolveDaemonSocket: () => null,
      maxPendingRequests: 1
    })
    await client.start()

    const first = client.request('model/list')
    await nextTask()
    await expect(client.request('permissionProfile/list')).rejects.toThrow(
      'Too many pending app-server requests'
    )

    child.exitCode = 0
    child.emit('exit', 0, null)
    await expect(first).rejects.toThrow('Codex app-server exited (0)')
  })

  it('rejects an unbounded PTY request immediately when stdio output closes without a process exit', async () => {
    const child = new FakeChild()
    replyToStartup(child)
    const { client } = createSpawnedClient(child, { shutdownGraceMs: 10 })
    await client.start()
    const terminal = client.executeStandaloneCommand({ command: ['/bin/zsh', '-l'], processId: 'eof-terminal' })
      .catch((error: unknown) => error)
    await nextTask()
    child.stdout.emit('end')
    expect(await terminal).toMatchObject({ stage: 'outcome-unknown', message: '[outcome-unknown] Codex app-server stdout closed' })
    expect(internals(client).pending.size).toBe(0)
    expect(client.getStatus().state).toBe('error')
    await client.stop()
  })
})

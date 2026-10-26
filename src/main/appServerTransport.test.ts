import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { AppServerClient, AppServerDeliveryError } from './appServer'
import { connectAppServerEndpoint, type AppServerSocket } from './managedDaemon'
import type { AppServerEndpoint } from './serverEndpoint'

type WireMessage = { method?: string; id?: number | string; params?: Record<string, unknown> }
const clients: AppServerClient[] = []
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop()
  for (const close of cleanup.splice(0)) await close()
  vi.useRealTimers()
})

async function listen(server: Server, address: number | string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    if (typeof address === 'number') server.listen(address, '127.0.0.1', resolve)
    else server.listen(address, resolve)
  })
}

async function fixture(unix = false): Promise<{
  endpoint: AppServerEndpoint
  messages: WireMessage[]
  peers: WebSocket[]
  initialized: () => number
  onRequest: (handler: (message: WireMessage, peer: WebSocket) => boolean) => void
}> {
  const server = createServer()
  const websocket = new WebSocketServer({ server })
  const directory = unix ? mkdtempSync(join(tmpdir(), 'codex-transport-')) : null
  const socketPath = directory ? join(directory, 'server.sock') : null
  const peers: WebSocket[] = []
  const messages: WireMessage[] = []
  let count = 0
  let handle: ((message: WireMessage, peer: WebSocket) => boolean) | undefined
  websocket.on('connection', (peer) => {
    peers.push(peer)
    peer.on('message', (data) => {
      const message = JSON.parse(data.toString()) as WireMessage
      messages.push(message)
      if (handle?.(message, peer)) return
      let result: unknown = {}
      if (message.method === 'initialize') count += 1
      if (message.method === 'getAuthStatus') result = { authMethod: 'chatgpt' }
      if (message.method === 'model/list') result = { data: [{ model: `session-${count}` }] }
      peer.send(JSON.stringify({ id: message.id, result }))
    })
  })
  await listen(server, socketPath ?? 0)
  cleanup.push(async () => {
    for (const peer of peers) peer.terminate()
    await new Promise<void>((resolve) => websocket.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (directory) rmSync(directory, { recursive: true, force: true })
  })
  const port = typeof server.address() === 'object' ? (server.address() as { port: number }).port : 0
  return {
    endpoint: socketPath ? { kind: 'unix', socketPath } : { kind: 'websocket', url: `ws://127.0.0.1:${port}/` },
    peers, messages,
    initialized: () => count,
    onRequest: (handler) => { handle = handler }
  }
}

function clientFor(endpoint: AppServerEndpoint, options: ConstructorParameters<typeof AppServerClient>[0] = {}): AppServerClient {
  const client = new AppServerClient({
    resolveServerEndpoint: () => endpoint,
    initializeTimeoutMs: 1_000,
    shutdownGraceMs: 20,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 20,
    ...options
  })
  clients.push(client)
  return client
}

describe('existing app-server listeners', () => {
  it.each([false, true])('connects an existing %s WebSocket listener without spawning or owning its server', async (unix) => {
    const server = await fixture(unix)
    const spawnProcess = vi.fn()
    const client = clientFor(server.endpoint, { spawnProcess })
    await expect(client.request('model/list')).resolves.toEqual({ data: [{ model: 'session-1' }] })
    expect(spawnProcess).not.toHaveBeenCalled()
    await client.stop()
    expect(client.getStatus()).toEqual({ state: 'stopped', mode: 'daemon' })
    const otherClient = clientFor(server.endpoint)
    await expect(otherClient.request('model/list')).resolves.toEqual({ data: [{ model: 'session-2' }] })
  })

  it('rejects an explicit failed target and never falls back to a private server', async () => {
    const spawnProcess = vi.fn()
    const client = clientFor({ kind: 'unix', socketPath: '/nonexistent/codex.sock' }, { spawnProcess, autoReconnect: false })
    await expect(client.start()).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()
    expect(client.getStatus().state).toBe('error')
  })

  it('reinitializes after a dropped connection and never replays a dispatched mutation', async () => {
    const server = await fixture()
    server.onRequest((message, peer) => {
      if (message.method !== 'turn/start') return false
      peer.terminate()
      return true
    })
    const client = clientFor(server.endpoint)
    await client.start()
    await expect(client.request('turn/start', { threadId: 'test-thread' })).rejects.toMatchObject({
      name: 'AppServerDeliveryError', stage: 'outcome-unknown', method: 'turn/start'
    })
    await vi.waitFor(() => expect(server.initialized()).toBe(2))
    await expect(client.request('model/list')).resolves.toEqual({ data: [{ model: 'session-2' }] })
    expect(server.messages.filter((message) => message.method === 'turn/start')).toHaveLength(1)
    expect(server.messages.filter((message) => message.method === 'initialized')).toHaveLength(0)
    expect(client.getStatus()).toEqual({ state: 'ready', mode: 'daemon' })
  })

  it('dismisses a request resolved by another client before reconnect or a duplicate response', async () => {
    const server = await fixture()
    const client = clientFor(server.endpoint)
    await client.start()
    server.peers[0].send(JSON.stringify({ id: 'approval', method: 'item/fileChange/requestApproval', params: {} }))
    await vi.waitFor(() => expect(client.getPendingServerRequests()).toHaveLength(1))
    server.peers[0].send(JSON.stringify({ method: 'serverRequest/resolved', params: { requestId: 'approval' } }))
    await vi.waitFor(() => expect(client.getPendingServerRequests()).toHaveLength(0))
    await expect(client.respond('approval', { result: { decision: 'accept' } })).rejects.toThrow('No pending')
  })

  it('surfaces overload as backpressure without reconnecting or implicitly repeating the RPC', async () => {
    const server = await fixture()
    let calls = 0
    server.onRequest((message, peer) => {
      if (message.method !== 'thread/list' || ++calls !== 1) return false
      peer.send(JSON.stringify({ id: message.id, error: { code: -32001, message: 'Server overloaded; retry later.' } }))
      return true
    })
    const client = clientFor(server.endpoint)
    await expect(client.request('thread/list')).rejects.toMatchObject({ code: -32001 })
    expect(calls).toBe(1)
    expect(client.getStatus().state).toBe('ready')
    await expect(client.request('thread/list')).resolves.toEqual({})
    expect(calls).toBe(2)
    expect(server.initialized()).toBe(1)
  })
})

describe('bounded transport recovery', () => {
  it('cancels a stalled HTTP upgrade promptly when stopped', async () => {
    const server = createServer()
    const connections: Duplex[] = []
    let connected!: () => void
    const accepted = new Promise<void>((resolve) => { connected = resolve })
    server.on('upgrade', (_request, socket) => { connections.push(socket); connected() })
    await listen(server, 0)
    cleanup.push(async () => {
      connections.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const endpoint: AppServerEndpoint = { kind: 'websocket', url: `ws://127.0.0.1:${(server.address() as { port: number }).port}` }
    const client = clientFor(endpoint, { initializeTimeoutMs: 30_000 })
    const start = client.start().catch((error: unknown) => error)
    await accepted
    await client.stop()
    expect(await start).toMatchObject({ message: 'Codex app-server connection canceled' })
    expect(client.getStatus().state).toBe('stopped')
    await expect(connectAppServerEndpoint(endpoint, { signal: AbortSignal.abort(), handshakeTimeoutMs: 1_000, maxMessageBytes: 1_024 })).rejects.toThrow('canceled')
  })

  it('backs off to its configured ceiling and stops at a finite retry count', async () => {
    vi.useFakeTimers()
    const connectEndpoint = vi.fn(async () => { throw new Error('connection refused') })
    const client = clientFor({ kind: 'websocket', url: 'ws://127.0.0.1:1' }, { connectEndpoint, reconnectMaxAttempts: 3 })
    const scheduled: number[] = []
    client.on('reconnect-scheduled', ({ delayMs }) => scheduled.push(delayMs))
    await expect(client.start()).rejects.toThrow('connection refused')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(20)
    expect(connectEndpoint).toHaveBeenCalledTimes(4)
    expect(scheduled).toEqual([10, 20, 20])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connectEndpoint).toHaveBeenCalledTimes(4)
  })

  it('does not reconnect errors explicitly classified as permanent', async () => {
    vi.useFakeTimers()
    const permanent = Object.assign(new Error('Permission denied (publickey)'), { retryable: false })
    const connectEndpoint = vi.fn(async () => { throw permanent })
    const client = clientFor({ kind: 'websocket', url: 'ws://127.0.0.1:1' }, { connectEndpoint })
    await expect(client.start()).rejects.toThrow('Permission denied')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connectEndpoint).toHaveBeenCalledOnce()
  })

  it('reports a socket initialization failure to its transport owner', async () => {
    class RejectInitializeSocket extends EventEmitter implements AppServerSocket {
      readyState = 1
      send(data: string, callback: (error?: Error) => void): void {
        const message = JSON.parse(data) as WireMessage
        callback()
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({
          id: message.id,
          error: { code: -32601, message: 'initialize is incompatible' }
        })), false))
      }
      close(code = 1000): void { this.readyState = 3; this.emit('close', code, Buffer.alloc(0)) }
      terminate(): void { this.close(1006) }
    }
    const onConnectionInitializationFailed = vi.fn()
    const client = clientFor({ kind: 'websocket', url: 'ws://127.0.0.1:1' }, {
      autoReconnect: false,
      connectEndpoint: async () => new RejectInitializeSocket(),
      onConnectionInitializationFailed
    })
    await expect(client.start()).rejects.toThrow('initialize is incompatible')
    expect(onConnectionInitializationFailed).toHaveBeenCalledOnce()
  })

  it('settles callers waiting for a scheduled reconnect when the app stops', async () => {
    vi.useFakeTimers()
    const connectEndpoint = vi.fn(async () => { throw new Error('offline') })
    const client = clientFor({ kind: 'websocket', url: 'ws://127.0.0.1:1' }, { connectEndpoint })
    await expect(client.start()).rejects.toThrow('offline')
    const waiting = client.request('thread/start').catch((error: unknown) => error)
    await client.stop()
    expect(await waiting).toMatchObject({ message: '[not-sent] Codex app-server stopped', stage: 'not-sent' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connectEndpoint).toHaveBeenCalledOnce()
  })

  it('distinguishes queued requests from dispatched unknown outcomes and releases a stalled write', async () => {
    class StalledSocket extends EventEmitter {
      readyState = 1
      send(data: string, callback: (error?: Error) => void): void {
        const message = JSON.parse(data) as WireMessage
        if (!['initialize', 'getAuthStatus'].includes(message.method ?? '')) return
        queueMicrotask(() => {
          callback()
          this.emit('message', Buffer.from(JSON.stringify({ id: message.id, result: {} })), false)
        })
      }
      close(): void { this.readyState = 3; this.emit('close', 1000, Buffer.alloc(0)) }
      terminate(): void { this.close() }
    }
    const socket = new StalledSocket()
    const client = clientFor({ kind: 'websocket', url: 'ws://127.0.0.1:1' }, {
      connectEndpoint: async () => socket as AppServerSocket,
      requestTimeoutMs: 10,
      transportWriteTimeoutMs: 30,
      autoReconnect: false
    })
    await client.start()
    const dispatched = client.request('turn/start').catch((error: unknown) => error)
    const queued = client.request('thread/start').catch((error: unknown) => error)
    expect(await dispatched).toMatchObject({ stage: 'outcome-unknown', message: expect.stringContaining('[outcome-unknown]') })
    expect(await queued).toMatchObject({ stage: 'not-sent', message: expect.stringContaining('[not-sent]') })
    expect(await dispatched).toBeInstanceOf(AppServerDeliveryError)
    await vi.waitFor(() => expect(client.getStatus().state).toBe('error'))
    expect(client.getPendingServerRequests()).toEqual([])
  })
})

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  discoverManagedDaemonSocket,
  connectManagedDaemon,
  DAEMON_MAX_UNFRAGMENTED_MESSAGE_HEADER,
  daemonMaxOutboundMessageBytes,
  DEFAULT_DAEMON_MAX_MESSAGE_BYTES,
  socketMessageText
} from './managedDaemon'

interface DaemonFixture {
  root: string
  controlDirectory: string
  stableSocket: string
  server: Server
}

const fixtures: DaemonFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

async function privateDaemonFixture(): Promise<DaemonFixture> {
  const root = mkdtempSync(join(tmpdir(), 'codex-daemon-test-'))
  const controlDirectory = join(root, '.codex', 'app-server-control')
  const targetSocket = join(root, 'daemon.sock')
  const stableSocket = join(controlDirectory, 'app-server-control.sock')
  mkdirSync(controlDirectory, { recursive: true, mode: 0o700 })
  chmodSync(controlDirectory, 0o700)

  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(targetSocket, () => {
      server.off('error', reject)
      resolve()
    })
  })
  chmodSync(targetSocket, 0o600)
  symlinkSync(targetSocket, stableSocket)

  const fixture = { root, controlDirectory, stableSocket, server }
  fixtures.push(fixture)
  return fixture
}

describe('managed daemon discovery', () => {
  it('returns the stable private socket path without canonicalizing its target', async () => {
    const fixture = await privateDaemonFixture()

    expect(
      discoverManagedDaemonSocket({
        env: {},
        homeDirectory: fixture.root,
        uid: process.getuid?.()
      })
    ).toBe(fixture.stableSocket)
  })

  it('rejects sockets whose control directory is writable by other users', async () => {
    const fixture = await privateDaemonFixture()
    chmodSync(fixture.controlDirectory, 0o777)

    expect(
      discoverManagedDaemonSocket({
        env: {},
        homeDirectory: fixture.root,
        uid: process.getuid?.()
      })
    ).toBeNull()
  })

  it('rejects a socket that is not owned by the expected user', async () => {
    const fixture = await privateDaemonFixture()
    const uid = process.getuid?.()

    expect(
      discoverManagedDaemonSocket({
        env: {},
        homeDirectory: fixture.root,
        uid: uid === undefined ? Number.MAX_SAFE_INTEGER : uid + 1
      })
    ).toBeNull()
  })
})

describe('managed daemon message decoding', () => {
  it('decodes text WebSocket payload representations', () => {
    expect(socketMessageText(Buffer.from('{"ok":true}'), false)).toBe('{"ok":true}')
    expect(socketMessageText(new Uint8Array([123, 125]).buffer, false)).toBe('{}')
    expect(socketMessageText([Buffer.from('{'), Buffer.from('}')], false)).toBe('{}')
  })

  it('rejects binary WebSocket messages', () => {
    expect(() => socketMessageText(Buffer.from([0, 1]), true)).toThrow(
      'unexpected binary WebSocket message'
    )
  })
})

describe('managed daemon negotiated outbound limit', () => {
  it('uses a positive safe integer handshake limit and defaults invalid or absent values', () => {
    expect(daemonMaxOutboundMessageBytes('65536')).toBe(65_536)
    for (const value of [undefined, '', 'not-a-number', '-1', '0', '2.5', '9007199254740992']) {
      expect(daemonMaxOutboundMessageBytes(value)).toBe(DEFAULT_DAEMON_MAX_MESSAGE_BYTES)
    }
  })

  it('reads the Unix WebSocket handshake limit and refuses oversized messages before sending', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-daemon-handshake-'))
    const path = join(directory, 'daemon.sock')
    const http = createHttpServer()
    const server = new WebSocketServer({ server: http })
    server.on('headers', (headers) => headers.push(`${DAEMON_MAX_UNFRAGMENTED_MESSAGE_HEADER}: 8`))
    const messages: string[] = []
    const firstMessage = new Promise<void>((resolve) => {
      server.on('connection', (peer) => peer.on('message', (data) => {
        messages.push(data.toString())
        resolve()
      }))
    })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(path, resolve)
    })
    let socket: Awaited<ReturnType<typeof connectManagedDaemon>> | null = null
    try {
      socket = await connectManagedDaemon(path, { handshakeTimeoutMs: 1_000, maxMessageBytes: 1_024 })
      expect(socket.maxOutboundMessageBytes).toBe(8)
      await new Promise<void>((resolve, reject) => socket!.send('{}', (error) => error ? reject(error) : resolve()))
      await firstMessage
      await expect(new Promise<void>((resolve, reject) => socket!.send('{"tooLarge":true}', (error) => error ? reject(error) : resolve()))).rejects.toThrow('8-byte daemon frame limit')
      expect(messages).toEqual(['{}'])
      expect(socket.readyState).toBe(1)
    } finally {
      if (socket) {
        await new Promise<void>((resolve) => {
          socket!.once('close', () => resolve())
          socket!.close(1000)
        })
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

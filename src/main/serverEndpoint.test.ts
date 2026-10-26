import { describe, expect, it } from 'vitest'
import { configuredAppServerEndpoint, parseAppServerEndpoint } from './serverEndpoint'

describe('explicit app-server endpoint configuration', () => {
  it('retains WebSocket listener paths and accepts the local address shorthand', () => {
    expect(parseAppServerEndpoint('ws://127.0.0.1:43123')).toEqual({ kind: 'websocket', url: 'ws://127.0.0.1:43123/' })
    expect(parseAppServerEndpoint('localhost:43123/rpc')).toEqual({ kind: 'websocket', url: 'ws://localhost:43123/rpc' })
    expect(parseAppServerEndpoint('wss://localhost:43123/custom?version=1')).toEqual({ kind: 'websocket', url: 'wss://localhost:43123/custom?version=1' })
    expect(parseAppServerEndpoint('[::1]:43123')).toEqual({ kind: 'websocket', url: 'ws://[::1]:43123/' })
  })

  it('preserves the stable Unix socket symlink path and decodes paths with spaces', () => {
    expect(parseAppServerEndpoint('unix:///tmp/Codex%20Replica/control.sock')).toEqual({ kind: 'unix', socketPath: '/tmp/Codex Replica/control.sock' })
    expect(parseAppServerEndpoint('ws+unix:///tmp/control.sock')).toEqual({ kind: 'unix', socketPath: '/tmp/control.sock' })
    expect(configuredAppServerEndpoint({ CODEX_APP_SERVER_SOCKET: 'control.sock' }, '/tmp/codex')).toEqual({ kind: 'unix', socketPath: '/tmp/codex/control.sock' })
    expect(configuredAppServerEndpoint({})).toBeNull()
  })

  it('fails ambiguous and invalid targets before connecting or spawning a server', () => {
    expect(() => configuredAppServerEndpoint({ CODEX_APP_SERVER_URL: 'ws://localhost:1', CODEX_APP_SERVER_SOCKET: '/tmp/control.sock' })).toThrow('either')
    for (const invalid of ['http://localhost:43123', 'stdio://', 'unix://hostname/path', 'unix:///', 'unix:///tmp/a%00b', 'unix:///tmp/%zz', 'ws://localhost:43123/#hash']) {
      expect(() => parseAppServerEndpoint(invalid)).toThrow()
    }
  })
})

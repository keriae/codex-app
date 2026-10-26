import { describe, expect, it, vi } from 'vitest'
import { HostTerminalSessions, type HostTerminalSessionBridge } from './hostTerminalSessions'

function bridge(): HostTerminalSessionBridge {
  return { closeOwner: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
}

describe('HostTerminalSessions', () => {
  it('disposes and forgets only the replaced host bridge and its sessions', async () => {
    const created = new Map<string, HostTerminalSessionBridge>()
    const registry = new HostTerminalSessions((hostId) => {
      const value = bridge()
      created.set(hostId, value)
      return value
    })
    const first = registry.forHost('remote-a')
    const local = registry.forHost('local')
    registry.rememberSession('session-a', 'remote-a')
    registry.rememberSession('session-local', 'local')

    await registry.disposeHost('remote-a')

    expect(first.dispose).toHaveBeenCalledOnce()
    expect(local.dispose).not.toHaveBeenCalled()
    expect(registry.hostForSession('session-a')).toBeUndefined()
    expect(registry.hostForSession('session-local')).toBe('local')
    expect(registry.forHost('remote-a')).not.toBe(first)
  })

  it('closes every host for an owner and clears all routing on disposal', async () => {
    const registry = new HostTerminalSessions(() => bridge())
    const local = registry.forHost('local')
    const remote = registry.forHost('remote-a')
    registry.rememberSession('session-a', 'remote-a')
    await registry.closeOwner(42)
    expect(local.closeOwner).toHaveBeenCalledWith(42)
    expect(remote.closeOwner).toHaveBeenCalledWith(42)
    await registry.dispose()
    expect(local.dispose).toHaveBeenCalledOnce()
    expect(remote.dispose).toHaveBeenCalledOnce()
    expect(registry.hostForSession('session-a')).toBeUndefined()
  })
})

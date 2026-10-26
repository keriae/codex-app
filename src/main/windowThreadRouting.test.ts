import { describe, expect, it } from 'vitest'
import {
  isDesktopThreadId,
  isWindowRouteId,
  managedWindowForSender,
  WindowThreadRouter
} from './windowThreadRouting'

describe('desktop thread window routing', () => {
  it('delivers only to the selected window and retries after renderer reload', () => {
    let nextId = 0
    const router = new WindowThreadRouter<object>(() => `route-${++nextId}`)
    const first = {}
    const second = {}
    const firstReceived: string[] = []
    const secondReceived: string[] = []
    router.setReceiver(first, (request) => firstReceived.push(request.threadId))
    router.setReceiver(second, (request) => secondReceived.push(request.threadId))

    const request = router.open(second, 'thread-in-second-window')
    expect(firstReceived).toEqual([])
    expect(secondReceived).toEqual(['thread-in-second-window'])

    router.setReceiver(second, null)
    router.setReceiver(second, (route) => secondReceived.push(route.threadId))
    expect(secondReceived).toEqual(['thread-in-second-window', 'thread-in-second-window'])
    expect(router.acknowledge(second, request.id)).toBe(true)
    router.setReceiver(second, null)
    router.setReceiver(second, (route) => secondReceived.push(route.threadId))
    expect(secondReceived).toHaveLength(2)
  })

  it('does not allow one window to acknowledge another window route', () => {
    const router = new WindowThreadRouter<object>(() => 'route-id')
    const owner = {}
    const other = {}
    const request = router.open(owner, 'thread-id')
    expect(router.acknowledge(other, request.id)).toBe(false)
    expect(router.acknowledge(owner, request.id)).toBe(true)
  })

  it('preserves the owning host when routing a remote thread', () => {
    const router = new WindowThreadRouter<object>(() => 'remote-route')
    const window = {}
    const received: Array<{threadId: string; hostId?: string}> = []
    router.setReceiver(window, (request) => received.push(request))

    const request = router.open(window, 'remote-thread', 'remote-host')
    expect(request).toEqual({id: 'remote-route', threadId: 'remote-thread', hostId: 'remote-host'})
    expect(received).toEqual([request])
  })

  it('drops closed-window state and validates native route identifiers', () => {
    const router = new WindowThreadRouter<object>(() => 'route-id')
    const window = {}
    const received: string[] = []
    router.open(window, 'thread-id')
    router.forget(window)
    router.setReceiver(window, (request) => received.push(request.threadId))
    expect(received).toEqual([])
    expect(() => router.open(window, 'bad\nthread')).toThrow('Invalid thread identifier')
    expect(() => router.acknowledge(window, 1)).toThrow('Invalid window route identifier')
    expect(() => router.acknowledge(window, '')).toThrow('Invalid window route identifier')
  })

  it('accepts bounded opaque ids and rejects controls or oversized ids', () => {
    expect(isDesktopThreadId('thread/opaque:id')).toBe(true)
    expect(isDesktopThreadId('')).toBe(false)
    expect(isDesktopThreadId('x'.repeat(513))).toBe(false)
    expect(isDesktopThreadId('thread\u007f')).toBe(false)
  })

  it('accepts only bounded printable route ids and rejects repeated generated ids', () => {
    expect(isWindowRouteId('route-1')).toBe(true)
    expect(isWindowRouteId('')).toBe(false)
    expect(isWindowRouteId('x'.repeat(129))).toBe(false)
    expect(isWindowRouteId('route\n1')).toBe(false)

    const router = new WindowThreadRouter<object>(() => 'same-route')
    const window = {}
    router.open(window, 'thread-1')
    expect(() => router.open(window, 'thread-2')).toThrow('unique window route')
  })

  it('trusts only a live registered top-level window owner', () => {
    const contents = {}
    const window = { webContents: contents, isDestroyed: () => false }
    const destroyed = { webContents: {}, isDestroyed: () => true }
    expect(managedWindowForSender(new Set([window]), contents, () => window)).toBe(window)
    expect(managedWindowForSender(new Set<typeof window>(), contents, () => window)).toBeNull()
    expect(managedWindowForSender(new Set([destroyed]), destroyed.webContents, () => destroyed)).toBeNull()
    expect(managedWindowForSender(new Set([window]), {}, () => window)).toBeNull()
  })
})

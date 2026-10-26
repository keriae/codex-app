import { describe, expect, it, vi } from 'vitest'
import { ActiveHostRouting } from './activeHostRouting'

describe('ActiveHostRouting', () => {
  it('invalidates every window using a disconnected host without changing other windows', () => {
    const routing = new ActiveHostRouting<object>()
    const first = {}, second = {}, local = {}, other = {}
    routing.set(first, 'remote-a')
    routing.set(second, 'remote-a')
    routing.set(other, 'remote-b')
    const notify = vi.fn()
    expect(routing.invalidate('remote-a', [first, second, local, other], 'disconnected', notify)).toBe(2)
    expect(routing.get(first)).toBe('local')
    expect(routing.get(second)).toBe('local')
    expect(routing.get(local)).toBe('local')
    expect(routing.get(other)).toBe('remote-b')
    expect(notify).toHaveBeenCalledWith(first, { hostId: 'remote-a', reason: 'disconnected' })
    expect(notify).toHaveBeenCalledWith(second, { hostId: 'remote-a', reason: 'disconnected' })
  })
})

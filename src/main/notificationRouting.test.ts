import { describe, expect, it } from 'vitest'
import { NotificationThreadRouter, threadIdForDesktopEvent } from './notificationRouting'
import type { OpenThreadRequest } from '../shared/api'

describe('notification click thread routing', () => {
  it('replays unacknowledged failed selections on backend recovery without reopening acknowledged threads', () => {
    const router = new NotificationThreadRouter()
    const received: OpenThreadRequest[] = []
    router.setReceiver((request) => received.push(request))
    router.open('failed-until-reconnect')
    router.open('already-opened')
    router.acknowledge(received[1]!.id)
    router.replay()
    expect(received.map((request) => request.threadId)).toEqual([
      'failed-until-reconnect', 'already-opened', 'failed-until-reconnect'
    ])
    expect(received[0]!.id).toBe(received[2]!.id)
  })

  it('stops replay if the renderer receiver is removed during delivery', () => {
    const router = new NotificationThreadRouter()
    router.open('one')
    router.open('two')
    const received: string[] = []
    router.setReceiver((request) => { received.push(request.threadId); router.setReceiver(null) })
    expect(received).toEqual(['one'])
    router.setReceiver((request) => received.push(request.threadId))
    expect(received).toEqual(['one', 'one', 'two'])
  })

  it('extracts only an explicit valid server-owned thread selector', () => {
    expect(threadIdForDesktopEvent({ threadId: 'thread-id' })).toBe('thread-id')
    expect(threadIdForDesktopEvent({ thread_id: 'legacy-thread-id' })).toBe('legacy-thread-id')
    expect(threadIdForDesktopEvent({ conversationId: 'legacy-approval-thread-id' })).toBe('legacy-approval-thread-id')
    for (const value of [null, [], { thread: { id: 'unrelated' } }, { threadId: '' }, { threadId: 'a\n' }, { threadId: 3 }]) {
      expect(threadIdForDesktopEvent(value)).toBeNull()
    }
  })

  it('replays clicks after renderer registration and reload until acknowledged', () => {
    const router = new NotificationThreadRouter()
    const received: OpenThreadRequest[] = []
    router.open('thread-one')
    router.open('thread-two')
    router.setReceiver((request) => received.push(request))
    expect(received.map((request) => request.threadId)).toEqual(['thread-one', 'thread-two'])
    router.acknowledge(received[0]!.id)
    router.setReceiver(null)
    router.open('thread-three')
    router.setReceiver((request) => received.push(request))
    expect(received.slice(2).map((request) => request.threadId)).toEqual(['thread-two', 'thread-three'])
    expect(received[2]!.id).toBe(received[1]!.id)
    expect(() => router.acknowledge(received[0]!.id)).toThrow()
    expect(() => router.acknowledge('invented')).toThrow()
  })

  it('delivers immediate clicks to an active renderer and bounds deferred clicks', () => {
    const router = new NotificationThreadRouter()
    const received: OpenThreadRequest[] = []
    router.setReceiver((request) => received.push(request))
    router.open('active')
    expect(received[0]!.threadId).toBe('active')
    router.setReceiver(null)
    for (let index = 0; index < 65; index++) router.open(`thread-${index}`)
    const replayed: OpenThreadRequest[] = []
    router.setReceiver((request) => replayed.push(request))
    expect(replayed).toHaveLength(64)
    expect(replayed[0]!.threadId).toBe('thread-1')
    expect(replayed[63]!.threadId).toBe('thread-64')
  })
})

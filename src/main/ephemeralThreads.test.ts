import { describe, expect, it } from 'vitest'
import type { RpcServerRequest } from '../shared/api'
import {
  EphemeralThreadTracker,
  routeServerRequestToRenderer,
  rpcThreadId
} from './ephemeralThreads'

describe('ephemeral thread isolation', () => {
  it('tracks renderer-created ephemeral fork results but not normal threads', () => {
    const tracker = new EphemeralThreadTracker()
    tracker.rememberRendererResult(
      'thread/fork',
      { threadId: 'parent', excludeTurns: true, ephemeral: true },
      { thread: { id: 'side-1' } }
    )
    tracker.rememberRendererResult(
      'thread/start',
      { cwd: '/tmp', ephemeral: false },
      { thread: { id: 'main-1' } }
    )

    expect(tracker.hasThread('side-1')).toBe(true)
    expect(tracker.hasThread('main-1')).toBe(false)
    tracker.reset()
    expect(tracker.hasThread('side-1')).toBe(false)
  })

  it('learns an ephemeral thread from notifications and recognizes its events', () => {
    const tracker = new EphemeralThreadTracker()
    tracker.rememberNotification({
      method: 'thread/started',
      params: { thread: { id: 'side-2', ephemeral: true } }
    })

    expect(tracker.ownsEvent({ threadId: 'side-2' })).toBe(true)
    expect(tracker.ownsEvent({ thread: { id: 'side-2' } })).toBe(true)
    expect(tracker.ownsEvent({ threadId: 'main-2' })).toBe(false)
  })

  it('recognizes side-chat server requests', () => {
    const tracker = new EphemeralThreadTracker()
    tracker.remember('side-3')
    const request: RpcServerRequest = {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'side-3' }
    }

    expect(tracker.ownsRequest(request)).toBe(true)
  })

  it('forwards active ephemeral requests with private context and no native notification', () => {
    const tracker = new EphemeralThreadTracker()
    tracker.remember('side-4')
    const request: RpcServerRequest = {
      id: 'approval-2',
      method: 'item/fileChange/requestApproval',
      params: { conversationId: 'side-4' }
    }

    expect(routeServerRequestToRenderer(tracker, request)).toEqual({
      request: {
        ...request,
        desktopContext: { ephemeralThread: true }
      },
      showBackgroundNotification: false
    })
  })

  it('leaves main-chat requests unchanged and eligible for native notification', () => {
    const tracker = new EphemeralThreadTracker()
    tracker.remember('side-5')
    const request: RpcServerRequest = {
      id: 'approval-3',
      method: 'item/commandExecution/requestApproval',
      params: { thread: { id: 'main-5' } }
    }

    const route = routeServerRequestToRenderer(tracker, {
      ...request,
      desktopContext: { ephemeralThread: true }
    })
    expect(route).toEqual({ request, showBackgroundNotification: true })
  })

  it('extracts only explicit thread identifiers', () => {
    expect(rpcThreadId({ threadId: 'thread-1' })).toBe('thread-1')
    expect(rpcThreadId({ thread: { id: 'thread-2' } })).toBe('thread-2')
    expect(rpcThreadId({ conversationId: 'thread-legacy' })).toBe('thread-legacy')
    expect(rpcThreadId({ threadId: 2 })).toBeNull()
    expect(rpcThreadId(null)).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { RightWorkbenchSessions, shouldActivateWorkbenchTerminal } from './rightWorkbenchSessions'
describe('chat-scoped workbench lifetime', () => {
  it('preserves tabs, focus and full view independently across chat switches', () => {
    const store = new RightWorkbenchSessions()
    store.scope = 'a'
    store.update('tabs', { order: ['browser:a', 'workspace:file:a'], activeId: 'browser:a' })
    store.update('view', { mode: 'full', selection: 'chat' })
    store.update('workspaceOpen', true)
    store.scope = 'b'
    store.update('tabs', { order: ['workspace:file:b'], activeId: 'workspace:file:b' })
    expect(store.session('a')).toMatchObject({ workspaceOpen: true, view: { mode: 'full', selection: 'chat' }, tabs: { activeId: 'browser:a' } })
    expect(store.session('b').tabs.activeId).toBe('workspace:file:b')
  })
  it('routes background browser events to their owner and ignores closed pages', () => {
    const store = new RightWorkbenchSessions()
    const listener = vi.fn()
    store.scope = 'a'
    store.update('browsers', [{ id: 'page', state: null }])
    store.scope = 'b'
    expect(store.browserOwner('page')).toBe('a')
    expect(store.browserOwner('unknown')).toBeNull()
    store.subscribe(listener)
    const state = { id: 'page', title: 'Loaded', url: 'https://example.com/', loading: false, canGoBack: false, canGoForward: false, error: null }
    store.updateBrowser(state)
    expect(store.session('a').browsers[0].state).toEqual(state)
    expect(store.session('b').browsers).toEqual([])
    expect(listener).toHaveBeenCalledOnce()
    expect(store.remove('a')).toEqual(['page'])
    expect(store.browserOwner('page')).toBeNull()
    store.updateBrowser(state)
    expect(store.session('a').browsers).toEqual([])
  })
  it('restores browser focus when switching between chats with retained right terminals', () => {
    const store = new RightWorkbenchSessions()
    store.update('tabs', { order: ['terminal:pty-a', 'browser:page-a'], activeId: 'browser:page-a' }, 'a')
    store.update('tabs', { order: ['terminal:pty-b'], activeId: 'terminal:pty-b' }, 'b')
    const a = { scope: 'a', id: 'pty-a' }
    const b = { scope: 'b', id: 'pty-b' }
    expect(shouldActivateWorkbenchTerminal(a, b)).toBe(false)
    expect(shouldActivateWorkbenchTerminal(b, a)).toBe(false)
    expect(store.session('a').tabs.activeId).toBe('browser:page-a')
    expect(shouldActivateWorkbenchTerminal(a, { scope: 'a', id: 'new-pty' })).toBe(true)
    expect(shouldActivateWorkbenchTerminal({ scope: 'a', id: null }, a)).toBe(true)
    expect(shouldActivateWorkbenchTerminal(a, a)).toBe(false)
  })
})

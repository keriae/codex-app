import { describe, expect, it } from 'vitest'
import type { Thread } from './protocol'
import { createdThreadAction, ownsForegroundOperation, type ForegroundOwner } from './foregroundOperation'
import { initialSessionState, sessionReducer } from './state/sessionReducer'

function thread(id: string, cwd = '/workspace/a'): Thread {
  return {id, cwd, name: null, preview: '', model: 'test', reasoningEffort: 'medium', createdAt: 0, updatedAt: 0, turns: []}
}

describe('delayed chat creation and foreground ownership', () => {
  it('keeps an authorized late task running in the catalog without selecting it over a newer chat', async () => {
    let complete!: (value: Thread) => void
    const response = new Promise<Thread>((resolve) => { complete = resolve })
    const operation = {id: 'send-a', revision: 1, cwd: '/workspace/a'}
    const current: ForegroundOwner = {activeId: operation.id, revision: 1, cwd: operation.cwd}
    let state = initialSessionState
    const applying = response.then((created) => {
      state = sessionReducer(state, createdThreadAction(created, ownsForegroundOperation(operation, current)))
      state = sessionReducer(state, {type: 'optimisticUserMessage', threadId: created.id, clientId: 'send-a', text: 'authorized prompt'})
      state = sessionReducer(state, {type: 'notification', notification: {method: 'turn/started', params: {threadId: created.id, turn: {id: 'turn-a', status: 'inProgress', items: []}}}})
    })
    state = sessionReducer(state, {type: 'threadHydrated', thread: thread('b', '/workspace/b')})
    Object.assign(current, {activeId: null, revision: 2, cwd: '/workspace/b'})
    complete(thread('a'))
    await applying
    expect(state.selectedThreadId).toBe('b')
    expect(state.threads.some((entry) => entry.id === 'a')).toBe(true)
    expect(state.sessions.a).toMatchObject({running: true, activeTurnId: 'turn-a'})
    expect(state.sessions.b.running).toBe(false)
  })

  it('accepts the current empty-chat response and selects its created task', () => {
    const operation = {id: 'send', revision: 5, cwd: '/workspace/a'}
    const state = sessionReducer(initialSessionState, createdThreadAction(thread('created'), ownsForegroundOperation(operation, {activeId: 'send', revision: 5, cwd: '/workspace/a'})))
    expect(state.selectedThreadId).toBe('created')
    expect(state.sessions.created).toBeDefined()
  })

  it('rejects an older empty-chat send even when a newer send uses the same directory', () => {
    const operation = {id: 'old-send', revision: 1, cwd: '/workspace/a'}
    let state = sessionReducer(initialSessionState, {type: 'threadHydrated', thread: thread('new')})
    state = sessionReducer(state, createdThreadAction(thread('old'), ownsForegroundOperation(operation, {activeId: 'new-send', revision: 2, cwd: '/workspace/a'})))
    expect(state.selectedThreadId).toBe('new')
    expect(state.threads.map((entry) => entry.id).sort()).toEqual(['new', 'old'])
  })

  it('does not revive old completion flags after leaving and returning to the same folder', () => {
    const operation = {id: 'send', revision: 3, cwd: '/workspace/a'}
    expect(ownsForegroundOperation(operation, {activeId: 'send', revision: 5, cwd: '/workspace/a'})).toBe(false)
    expect(ownsForegroundOperation(operation, {activeId: 'send', revision: 3, cwd: '/workspace/b'})).toBe(false)
  })
})

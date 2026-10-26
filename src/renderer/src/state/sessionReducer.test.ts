import { describe, expect, it } from 'vitest'
import { commandActivityRows } from '../commandActivity'
import type { CommandAction, CommandItem, Thread, ThreadItem, Turn } from '../protocol'
import { initialSessionState, sessionReducer, type SessionState } from './sessionReducer'

const thread: Thread = {
  id: 'thread-1',
  preview: 'Build the app',
  name: null,
  cwd: '/tmp/project',
  model: 'gpt-test',
  reasoningEffort: 'medium',
  createdAt: 10,
  updatedAt: 11,
  turns: []
}

const transientThread: Thread = {
  ...thread,
  id: 'side-thread-1',
  forkedFromId: thread.id,
  ephemeral: true,
  preview: '',
  createdAt: 12,
  updatedAt: 12
}

function hydrated(): SessionState {
  return sessionReducer(initialSessionState, { type: 'threadHydrated', thread })
}

function notify(
  state: SessionState,
  method: string,
  params: Record<string, unknown>
): SessionState {
  return sessionReducer(state, {
    type: 'notification',
    notification: { method, params }
  })
}

function findItem(state: SessionState, turnId: string, itemId: string): ThreadItem | undefined {
  return state.sessions[thread.id].turns
    .find((turn) => turn.id === turnId)
    ?.items.find((item) => item.id === itemId)
}

describe('sessionReducer', () => {
  it('keeps an ephemeral side thread out of the catalog without changing selection', () => {
    let state = hydrated()
    state = notify(state, 'thread/started', { thread: transientThread })

    expect(state.selectedThreadId).toBe(thread.id)
    expect(state.threads.map((candidate) => candidate.id)).toEqual([thread.id])
    expect(state.transientThreads[transientThread.id]).toEqual(transientThread)
    expect(state.sessions[transientThread.id]).toMatchObject({
      turns: [],
      running: false,
      activeTurnId: null
    })

    state = notify(state, 'turn/started', {
      threadId: transientThread.id,
      turn: { id: 'side-turn-1', status: 'inProgress', items: [] }
    })
    state = notify(state, 'item/agentMessage/delta', {
      threadId: transientThread.id,
      turnId: 'side-turn-1',
      itemId: 'side-message-1',
      delta: 'Side response'
    })
    state = sessionReducer(state, {
      type: 'transientThreadHydrated',
      thread: { ...transientThread, turns: [] }
    })

    expect(state.selectedThreadId).toBe(thread.id)
    expect(state.threads.map((candidate) => candidate.id)).toEqual([thread.id])
    expect(state.sessions[transientThread.id]).toMatchObject({
      running: true,
      activeTurnId: 'side-turn-1'
    })
    expect(
      state.sessions[transientThread.id].turns[0].items.find(
        (item) => item.id === 'side-message-1'
      )
    ).toMatchObject({ type: 'agentMessage', text: 'Side response' })
  })

  it('discards only the transient side thread and its session', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'transientThreadHydrated',
      thread: transientThread
    })
    state = sessionReducer(state, {
      type: 'transientThreadRemoved',
      threadId: transientThread.id
    })

    expect(state.transientThreads[transientThread.id]).toBeUndefined()
    expect(state.sessions[transientThread.id]).toBeUndefined()
    expect(state.sessions[thread.id]).toBeDefined()
    expect(state.selectedThreadId).toBe(thread.id)
    expect(state.threads.map((candidate) => candidate.id)).toEqual([thread.id])
  })

  it('deduplicates thread pages and keeps the newest record', () => {
    const state = sessionReducer(initialSessionState, {
      type: 'threadsLoaded',
      threads: [thread, { ...thread, preview: 'Newest', updatedAt: 12 }]
    })

    expect(state.threads).toHaveLength(1)
    expect(state.threads[0].preview).toBe('Newest')
  })

  it('appends catalog pages and removes lifecycle rows idempotently', () => {
    const second = { ...thread, id: 'thread-2', preview: 'Second', updatedAt: 12 }
    let state = sessionReducer(initialSessionState, {
      type: 'threadsLoaded',
      threads: [thread]
    })
    state = sessionReducer(state, { type: 'threadsAppended', threads: [thread, second] })
    expect(state.threads.map((candidate) => candidate.id)).toEqual(['thread-2', 'thread-1'])

    state = notify(state, 'thread/archived', { threadId: 'thread-2' })
    state = notify(state, 'thread/archived', { threadId: 'thread-2' })
    expect(state.threads.map((candidate) => candidate.id)).toEqual(['thread-1'])

    state = sessionReducer(state, { type: 'threadRemoved', threadIds: ['thread-1'] })
    expect(state.threads).toEqual([])
  })

  it('builds an assistant message from item start and deltas', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'turn/started',
        params: {
          threadId: thread.id,
          turn: { id: 'turn-1', status: 'inProgress', items: [] }
        }
      }
    })
    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'item/started',
        params: {
          threadId: thread.id,
          turnId: 'turn-1',
          item: { type: 'agentMessage', id: 'message-1', text: '' }
        }
      }
    })
    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'item/agentMessage/delta',
        params: {
          threadId: thread.id,
          turnId: 'turn-1',
          itemId: 'message-1',
          delta: 'Hello '
        }
      }
    })
    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'item/agentMessage/delta',
        params: {
          threadId: thread.id,
          turnId: 'turn-1',
          itemId: 'message-1',
          delta: 'world'
        }
      }
    })

    const session = state.sessions[thread.id]
    expect(session.running).toBe(true)
    expect(session.activeTurnId).toBe('turn-1')
    expect(session.turns[0].items[0]).toMatchObject({
      type: 'agentMessage',
      text: 'Hello world'
    })
  })

  it('replaces optimistic content and completes a turn', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'optimisticUserMessage',
      threadId: thread.id,
      clientId: 'client-1',
      text: 'Do the work'
    })
    expect(state.sessions[thread.id].turns[0].id).toBe('local-client-1')

    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'turn/started',
        params: {
          threadId: thread.id,
          turn: {
            id: 'turn-2',
            status: 'inProgress',
            items: [
              { type: 'userMessage', id: 'user-1', clientId: 'client-1', content: [] }
            ]
          }
        }
      }
    })
    expect(state.sessions[thread.id].turns.map((turn) => turn.id)).toEqual(['turn-2'])

    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'turn/completed',
        params: {
          threadId: thread.id,
          turn: {
            id: 'turn-2',
            status: 'completed',
            items: [{ type: 'agentMessage', id: 'agent-1', text: 'Done' }]
          }
        }
      }
    })

    expect(state.sessions[thread.id]).toMatchObject({ running: false, activeTurnId: null })
    expect(state.sessions[thread.id].turns[0].status).toBe('completed')
    expect(state.sessions[thread.id].turns[0].items.map((item) => item.type)).toEqual([
      'userMessage',
      'agentMessage'
    ])
  })

  it('adds steering input to the active turn without creating another turn', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: {
        id: 'turn-steer',
        status: 'inProgress',
        items: [{ type: 'agentMessage', id: 'agent-steer', text: 'Working' }]
      }
    })
    state = sessionReducer(state, {
      type: 'optimisticSteer',
      threadId: thread.id,
      turnId: 'turn-steer',
      clientId: 'client-steer',
      text: 'Also add tests'
    })

    expect(state.sessions[thread.id].turns).toHaveLength(1)
    expect(state.sessions[thread.id]).toMatchObject({
      running: true,
      activeTurnId: 'turn-steer'
    })
    expect(findItem(state, 'turn-steer', 'local-steer-client-steer')).toMatchObject({
      type: 'userMessage',
      clientId: 'client-steer'
    })

    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-steer',
      item: {
        type: 'userMessage',
        id: 'server-steer',
        clientId: 'client-steer',
        content: [{ type: 'text', text: 'Also add tests', text_elements: [] }]
      }
    })
    expect(findItem(state, 'turn-steer', 'local-steer-client-steer')).toBeUndefined()
    expect(findItem(state, 'turn-steer', 'server-steer')).toBeDefined()
  })

  it('rolls back only the optimistic steering item when steer fails', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: { id: 'turn-steer-fail', status: 'inProgress', items: [] }
    })
    state = sessionReducer(state, {
      type: 'optimisticSteer',
      threadId: thread.id,
      turnId: 'turn-steer-fail',
      clientId: 'client-steer-fail',
      text: 'Follow up'
    })
    state = sessionReducer(state, {
      type: 'steerFailed',
      threadId: thread.id,
      turnId: 'turn-steer-fail',
      clientId: 'client-steer-fail',
      message: 'The active turn changed'
    })

    expect(state.sessions[thread.id]).toMatchObject({
      running: true,
      activeTurnId: 'turn-steer-fail',
      error: 'The active turn changed'
    })
    expect(findItem(state, 'turn-steer-fail', 'local-steer-client-steer-fail')).toBeUndefined()
  })

  it('keeps an optimistic steering item while the request outcome is unknown', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: { id: 'turn-steer-unknown', status: 'inProgress', items: [] }
    })
    state = sessionReducer(state, {
      type: 'optimisticSteer',
      threadId: thread.id,
      turnId: 'turn-steer-unknown',
      clientId: 'client-steer-unknown',
      text: 'Follow up'
    })
    state = sessionReducer(state, {
      type: 'steerUnknown',
      threadId: thread.id,
      turnId: 'turn-steer-unknown',
      clientId: 'client-steer-unknown',
      message: 'Outcome unknown'
    })

    expect(state.sessions[thread.id]).toMatchObject({
      running: true,
      activeTurnId: 'turn-steer-unknown',
      error: 'Outcome unknown'
    })
    expect(
      findItem(state, 'turn-steer-unknown', 'local-steer-client-steer-unknown')
    ).toBeDefined()
  })

  it('reports an interrupt request error without making the active turn terminal', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: { id: 'turn-still-running', status: 'inProgress', items: [] }
    })
    state = sessionReducer(state, {
      type: 'sessionError',
      threadId: thread.id,
      message: 'Interrupt request timed out'
    })

    expect(state.sessions[thread.id]).toMatchObject({
      running: true,
      activeTurnId: 'turn-still-running',
      error: 'Interrupt request timed out'
    })
    expect(state.sessions[thread.id].turns[0].status).toBe('inProgress')
  })

  it('replaces persisted history, preserves live turns, and prepends older pages', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: { id: 'turn-live', status: 'inProgress', items: [] }
    })
    state = sessionReducer(state, {
      type: 'threadHistoryReplaced',
      threadId: thread.id,
      turns: [
        { id: 'turn-2', status: 'completed', items: [] },
        { id: 'turn-3', status: 'completed', items: [] }
      ]
    })
    expect(state.sessions[thread.id].turns.map((candidate) => candidate.id)).toEqual([
      'turn-2',
      'turn-3',
      'turn-live'
    ])

    state = sessionReducer(state, {
      type: 'threadHistoryPrepended',
      threadId: thread.id,
      turns: [
        { id: 'turn-1', status: 'completed', items: [] },
        { id: 'turn-2', status: 'completed', items: [] }
      ]
    })
    expect(state.sessions[thread.id].turns.map((candidate) => candidate.id)).toEqual([
      'turn-1',
      'turn-2',
      'turn-3',
      'turn-live'
    ])
  })

  it('keeps notification turns that arrive after a history request starts', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'threadHistoryReplaced',
      threadId: thread.id,
      turns: [{ id: 'turn-old', status: 'completed', items: [] }],
      baselineTurnIds: []
    })
    state = notify(state, 'turn/completed', {
      threadId: thread.id,
      turn: {
        id: 'turn-new-during-load',
        status: 'completed',
        items: [{ type: 'agentMessage', id: 'agent-new', text: 'New' }]
      }
    })
    state = sessionReducer(state, {
      type: 'threadHistoryReplaced',
      threadId: thread.id,
      turns: [{ id: 'turn-old', status: 'completed', items: [] }],
      baselineTurnIds: ['turn-old']
    })

    expect(state.sessions[thread.id].turns.map((candidate) => candidate.id)).toEqual([
      'turn-old',
      'turn-new-during-load'
    ])
  })

  it('removes the revert target and later turns only after success is acknowledged', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'threadHistoryReplaced',
      threadId: thread.id,
      turns: [
        { id: 'turn-1', status: 'completed', items: [] },
        { id: 'turn-2', status: 'completed', items: [] },
        { id: 'turn-3', status: 'completed', items: [] }
      ]
    })
    state = sessionReducer(state, {
      type: 'threadReverted',
      threadId: thread.id,
      beforeTurnId: 'turn-2'
    })
    expect(state.sessions[thread.id].turns.map((candidate) => candidate.id)).toEqual(['turn-1'])
  })

  it('applies threadName from rename notifications', () => {
    let state = sessionReducer(initialSessionState, {
      type: 'threadsLoaded',
      threads: [thread]
    })
    state = sessionReducer(state, {
      type: 'notification',
      notification: {
        method: 'thread/name/updated',
        params: { threadId: thread.id, threadName: 'A better title' }
      }
    })

    expect(state.threads[0].name).toBe('A better title')
  })

  it('ignores empty rename notifications and supports optimistic rename rollback', () => {
    let state = sessionReducer(initialSessionState, { type: 'threadsLoaded', threads: [thread] })
    state = sessionReducer(state, {
      type: 'threadRenamed',
      threadId: thread.id,
      name: 'Optimistic'
    })
    state = notify(state, 'thread/name/updated', { threadId: thread.id, threadName: '   ' })
    expect(state.threads[0].name).toBe('Optimistic')
    state = sessionReducer(state, {
      type: 'threadRenamed',
      threadId: thread.id,
      name: null
    })
    expect(state.threads[0].name).toBeNull()
  })

  it('streams indexed reasoning summary and content without lifecycle snapshots erasing it', () => {
    let state = hydrated()
    state = notify(state, 'item/reasoning/summaryTextDelta', {
      threadId: thread.id,
      turnId: 'turn-reasoning',
      itemId: 'reasoning-1',
      summaryIndex: 1,
      delta: 'Second'
    })
    state = notify(state, 'item/reasoning/summaryPartAdded', {
      threadId: thread.id,
      turnId: 'turn-reasoning',
      itemId: 'reasoning-1',
      summaryIndex: 0
    })
    state = notify(state, 'item/reasoning/summaryTextDelta', {
      threadId: thread.id,
      turnId: 'turn-reasoning',
      itemId: 'reasoning-1',
      summaryIndex: 0,
      delta: 'First'
    })
    state = notify(state, 'item/reasoning/textDelta', {
      threadId: thread.id,
      turnId: 'turn-reasoning',
      itemId: 'reasoning-1',
      contentIndex: 0,
      delta: 'Private details'
    })
    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-reasoning',
      item: { type: 'reasoning', id: 'reasoning-1', summary: [], content: [] }
    })
    state = notify(state, 'item/completed', {
      threadId: thread.id,
      turnId: 'turn-reasoning',
      item: { type: 'reasoning', id: 'reasoning-1', summary: [], content: [] }
    })

    expect(findItem(state, 'turn-reasoning', 'reasoning-1')).toMatchObject({
      type: 'reasoning',
      summary: ['First', 'Second'],
      content: ['Private details']
    })
  })

  it('streams plans and accepts a late delta without reopening a completed turn', () => {
    let state = hydrated()
    state = notify(state, 'item/plan/delta', {
      threadId: thread.id,
      turnId: 'turn-plan',
      itemId: 'plan-1',
      delta: 'Step one'
    })
    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-plan',
      item: { type: 'plan', id: 'plan-1', text: '' }
    })
    state = notify(state, 'turn/completed', {
      threadId: thread.id,
      turn: {
        id: 'turn-plan',
        status: 'completed',
        items: [{ type: 'plan', id: 'plan-1', text: '' }]
      }
    })
    state = notify(state, 'item/plan/delta', {
      threadId: thread.id,
      turnId: 'turn-plan',
      itemId: 'plan-1',
      delta: '!'
    })

    expect(findItem(state, 'turn-plan', 'plan-1')).toMatchObject({
      type: 'plan',
      text: 'Step one!'
    })
    expect(state.sessions[thread.id]).toMatchObject({ running: false, activeTurnId: null })
  })

  it('merges command output deltas with started and completed item fields', () => {
    let state = hydrated()
    state = notify(state, 'item/commandExecution/outputDelta', {
      threadId: thread.id,
      turnId: 'turn-command',
      itemId: 'command-1',
      delta: 'alpha\n'
    })
    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-command',
      item: {
        type: 'commandExecution',
        id: 'command-1',
        command: 'printf alpha',
        cwd: '/tmp/project',
        status: 'inProgress',
        aggregatedOutput: null
      }
    })
    state = notify(state, 'item/commandExecution/outputDelta', {
      threadId: thread.id,
      turnId: 'turn-command',
      itemId: 'command-1',
      delta: 'beta\n'
    })
    state = notify(state, 'item/completed', {
      threadId: thread.id,
      turnId: 'turn-command',
      item: {
        type: 'commandExecution',
        id: 'command-1',
        command: 'printf alpha',
        cwd: '/tmp/project',
        status: 'completed',
        aggregatedOutput: '',
        exitCode: 0
      }
    })
    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-command',
      item: {
        type: 'commandExecution',
        id: 'command-1',
        command: 'printf alpha',
        status: 'inProgress',
        aggregatedOutput: null
      }
    })

    expect(findItem(state, 'turn-command', 'command-1')).toMatchObject({
      type: 'commandExecution',
      command: 'printf alpha',
      cwd: '/tmp/project',
      status: 'completed',
      aggregatedOutput: 'alpha\nbeta\n',
      exitCode: 0
    })
  })

  it('uses completed command actions authoritatively and protects them from late started metadata', () => {
    const startedActions: CommandAction[] = [{ type: 'read', command: 'cat a', name: 'a', path: '/repo/a' }]
    const completedActions: CommandAction[] = [
      { type: 'read', command: 'cat a', name: 'a', path: '/repo/a' },
      { type: 'search', command: 'rg x src', query: 'x', path: 'src' },
      { type: 'unknown', command: 'npm test' }
    ]
    let state = hydrated()
    state = notify(state, 'item/started', { threadId: thread.id, turnId: 'actions', item: {
      type: 'commandExecution', id: 'command-actions', command: 'zsh', status: 'inProgress',
      cwd: '/repo', commandActions: startedActions, durationMs: null
    } })
    state = notify(state, 'item/commandExecution/outputDelta', {
      threadId: thread.id, turnId: 'actions', itemId: 'command-actions', delta: 'passed'
    })
    state = notify(state, 'item/completed', { threadId: thread.id, turnId: 'actions', item: {
      type: 'commandExecution', id: 'command-actions', command: 'zsh', status: 'completed',
      commandActions: completedActions, durationMs: 1234
    } })
    const terminal = findItem(state, 'actions', 'command-actions') as CommandItem
    expect(terminal.commandActions).toEqual(completedActions)
    expect(commandActivityRows(terminal).map((row) => row.kind)).toEqual(['read', 'search', 'command'])
    expect(terminal).toMatchObject({ cwd: '/repo', aggregatedOutput: 'passed', durationMs: 1234 })

    const lateActions: CommandAction[] = [{ type: 'unknown', command: 'stale command' }]
    state = notify(state, 'item/started', { threadId: thread.id, turnId: 'actions', item: {
      type: 'commandExecution', id: 'command-actions', command: 'zsh', status: 'inProgress',
      commandActions: lateActions, durationMs: 3
    } })
    expect(findItem(state, 'actions', 'command-actions')).toMatchObject({ status: 'completed', commandActions: completedActions, durationMs: 1234 })
    expect(terminal.commandActions).toEqual(completedActions)
    expect(startedActions).toHaveLength(1)
    expect(lateActions[0].command).toBe('stale command')
  })

  it.each([[], null, undefined, [null, {}, { type: 'read', command: 5 }]])(
    'preserves known command actions when partial started, completed or hydrated snapshots carry %j',
    (partialActions) => {
      const actions: CommandAction[] = [{ type: 'read', command: 'cat a', name: 'a', path: '/repo/a' }]
      for (const mode of ['started', 'completed', 'hydrated'] as const) {
        let state = hydrated()
        state = notify(state, 'item/started', { threadId: thread.id, turnId: 'partial-actions', item: {
          type: 'commandExecution', id: 'command-partial', command: 'zsh', status: 'inProgress', commandActions: actions
        } })
        const incoming = { type: 'commandExecution', id: 'command-partial', command: 'zsh', status: 'inProgress', commandActions: partialActions }
        state = mode === 'hydrated'
          ? sessionReducer(state, { type: 'threadHydrated', thread: { ...thread, turns: [{ id: 'partial-actions', status: 'inProgress', items: [incoming as ThreadItem] }] } })
          : notify(state, `item/${mode}`, { threadId: thread.id, turnId: 'partial-actions', item: incoming })
        expect((findItem(state, 'partial-actions', 'command-partial') as CommandItem).commandActions).toEqual(actions)
      }
    }
  )

  it('fills empty command metadata from hydration without replacing richer live metadata', () => {
    const historyActions: CommandAction[] = [
      { type: 'listFiles', command: 'ls src', path: 'src' },
      { type: 'unknown', command: 'npm test' }
    ]
    let state = hydrated()
    state = notify(state, 'item/started', { threadId: thread.id, turnId: 'hydrate-actions', item: {
      type: 'commandExecution', id: 'command-hydrated', command: 'zsh', status: 'inProgress', commandActions: [], durationMs: null
    } })
    const history: Turn = { id: 'hydrate-actions', status: 'inProgress', items: [{
      type: 'commandExecution', id: 'command-hydrated', command: 'zsh', status: 'inProgress', commandActions: historyActions, durationMs: 0
    }] }
    state = sessionReducer(state, { type: 'threadHydrated', thread: { ...thread, turns: [history] } })
    expect(findItem(state, history.id, 'command-hydrated')).toMatchObject({ commandActions: historyActions, durationMs: 0 })
    state = sessionReducer(state, { type: 'threadHydrated', thread: { ...thread, turns: [{ ...history, items: [{
      type: 'commandExecution', id: 'command-hydrated', command: 'zsh', status: 'inProgress', commandActions: [{ type: 'unknown', command: 'old command' }], durationMs: 10
    }] }] } })
    expect(findItem(state, history.id, 'command-hydrated')).toMatchObject({ commandActions: historyActions, durationMs: 0 })
  })

  it.each(['threadHydrated', 'threadHistoryReplaced'] as const)(
    'retains live terminal command metadata through stale completed %s history', (type) => {
      const liveActions: CommandAction[] = [
        { type: 'read', command: 'cat current', name: 'current', path: '/repo/current' },
        { type: 'unknown', command: 'npm test' }
      ]
      let state = hydrated()
      state = notify(state, 'item/completed', { threadId: thread.id, turnId: 'terminal-history', item: {
        type: 'commandExecution', id: 'terminal-command', command: 'zsh', status: 'completed', commandActions: liveActions, durationMs: 1234
      } })
      const turns: Turn[] = [{ id: 'terminal-history', status: 'completed', items: [{
        type: 'commandExecution', id: 'terminal-command', command: 'zsh', status: 'completed', commandActions: [{ type: 'unknown', command: 'older command' }], durationMs: 12
      }] }]
      state = type === 'threadHydrated'
        ? sessionReducer(state, { type, thread: { ...thread, turns } })
        : sessionReducer(state, { type, threadId: thread.id, turns })
      expect(findItem(state, 'terminal-history', 'terminal-command')).toMatchObject({ commandActions: liveActions, durationMs: 1234 })
    }
  )

  it.each(['item', 'turn', 'history'] as const)('sanitizes command actions and duration on a fresh %s snapshot', (source) => {
    const incoming = {
      type: 'commandExecution', id: 'fresh-command', command: 'zsh', status: 'completed', durationMs: Number.POSITIVE_INFINITY,
      commandActions: [null, {}, { type: 'search', command: 'rg x', query: 'x' }, { type: 'future-command', command: 'new-tool' }]
    }
    let state = hydrated()
    const turn = { id: 'fresh-turn', status: 'completed', items: [incoming] } as unknown as Turn
    if (source === 'item') state = notify(state, 'item/completed', { threadId: thread.id, turnId: turn.id, item: incoming })
    else if (source === 'turn') state = notify(state, 'turn/completed', { threadId: thread.id, turn })
    else state = sessionReducer(state, { type: 'threadHydrated', thread: { ...thread, turns: [turn] } })
    const item = findItem(state, turn.id, incoming.id) as CommandItem
    expect(item.durationMs).toBeNull()
    expect(commandActivityRows(item).map((row) => row.kind)).toEqual(['search', 'command'])
    expect(item.commandActions).toEqual([
      { type: 'search', command: 'rg x', query: 'x' },
      { type: 'unknown', command: 'new-tool' }
    ])
    expect(incoming.commandActions[0]).toBeNull()
    expect(incoming.durationMs).toBe(Number.POSITIVE_INFINITY)
  })

  it('retains known duration through invalid updates and accepts an authoritative zero duration', () => {
    let state = hydrated()
    state = notify(state, 'item/started', { threadId: thread.id, turnId: 'duration', item: {
      type: 'commandExecution', id: 'timed-command', command: 'npm test', status: 'inProgress', durationMs: 12
    } })
    for (const durationMs of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, '9']) {
      state = notify(state, 'item/completed', { threadId: thread.id, turnId: 'duration', item: {
        type: 'commandExecution', id: 'timed-command', command: 'npm test', status: 'completed', durationMs
      } })
      expect((findItem(state, 'duration', 'timed-command') as CommandItem).durationMs).toBe(12)
    }
    state = notify(state, 'item/completed', { threadId: thread.id, turnId: 'duration', item: {
      type: 'commandExecution', id: 'timed-command', command: 'npm test', status: 'completed', durationMs: 0
    } })
    expect((findItem(state, 'duration', 'timed-command') as CommandItem).durationMs).toBe(0)
  })

  it('applies file patch updates and ignores deprecated output deltas with no item field', () => {
    const firstChange = {
      path: 'a.ts',
      kind: { type: 'update', move_path: null },
      diff: '-old\n+new'
    }
    const secondChange = { path: 'b.ts', kind: { type: 'add' }, diff: '+content' }
    let state = hydrated()
    state = notify(state, 'item/fileChange/patchUpdated', {
      threadId: thread.id,
      turnId: 'turn-patch',
      itemId: 'patch-1',
      changes: [firstChange]
    })
    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-patch',
      item: { type: 'fileChange', id: 'patch-1', status: 'inProgress', changes: [] }
    })
    state = notify(state, 'item/fileChange/patchUpdated', {
      threadId: thread.id,
      turnId: 'turn-patch',
      itemId: 'patch-1',
      changes: [secondChange]
    })
    state = notify(state, 'item/completed', {
      threadId: thread.id,
      turnId: 'turn-patch',
      item: { type: 'fileChange', id: 'patch-1', status: 'completed', changes: [] }
    })

    expect(findItem(state, 'turn-patch', 'patch-1')).toMatchObject({
      type: 'fileChange',
      status: 'completed',
      changes: [secondChange]
    })

    const unchanged = notify(state, 'item/fileChange/outputDelta', {
      threadId: thread.id,
      turnId: 'turn-patch',
      itemId: 'patch-1',
      delta: 'legacy output'
    })
    expect(unchanged).toBe(state)
  })

  it('does not let an older in-progress history snapshot replace a live file patch', () => {
    const liveChange = {
      path: 'current.ts',
      kind: { type: 'update' as const, move_path: null },
      diff: '-old\n+current'
    }
    const staleChange = {
      path: 'current.ts',
      kind: { type: 'update' as const, move_path: null },
      diff: '-old\n+stale'
    }
    let state = hydrated()
    state = notify(state, 'item/fileChange/patchUpdated', {
      threadId: thread.id,
      turnId: 'turn-live-patch',
      itemId: 'patch-live',
      changes: [liveChange]
    })
    state = sessionReducer(state, {
      type: 'threadHistoryReplaced',
      threadId: thread.id,
      turns: [
        {
          id: 'turn-live-patch',
          status: 'inProgress',
          items: [
            {
              type: 'fileChange',
              id: 'patch-live',
              status: 'inProgress',
              changes: [staleChange]
            }
          ]
        }
      ]
    })

    expect(findItem(state, 'turn-live-patch', 'patch-live')).toMatchObject({
      type: 'fileChange',
      changes: [liveChange]
    })
  })

  it('keeps retryable errors running and makes final errors terminal', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: { id: 'turn-error', status: 'inProgress', items: [] }
    })
    state = notify(state, 'error', {
      threadId: thread.id,
      turnId: 'turn-error',
      willRetry: true,
      error: { message: 'temporary outage', additionalDetails: null }
    })

    expect(state.sessions[thread.id]).toMatchObject({
      running: true,
      activeTurnId: 'turn-error',
      error: null
    })
    expect(state.sessions[thread.id].turns[0]).toMatchObject({
      status: 'inProgress',
      error: { message: 'temporary outage' }
    })

    state = notify(state, 'error', {
      threadId: thread.id,
      turnId: 'turn-error',
      willRetry: false,
      error: { message: 'permanent outage' }
    })
    expect(state.sessions[thread.id]).toMatchObject({
      running: false,
      activeTurnId: null,
      error: 'permanent outage'
    })
    expect(state.sessions[thread.id].turns[0]).toMatchObject({
      status: 'failed',
      error: { message: 'permanent outage' }
    })

    state = notify(state, 'item/agentMessage/delta', {
      threadId: thread.id,
      turnId: 'turn-error',
      itemId: 'message-after-error',
      delta: 'late'
    })
    expect(state.sessions[thread.id]).toMatchObject({ running: false, activeTurnId: null })
    expect(state.sessions[thread.id].turns[0].status).toBe('failed')
  })

  it('reconciles optimistic, turn-start, streaming, and hydration races by client id', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'optimisticUserMessage',
      threadId: thread.id,
      clientId: 'client-race',
      text: 'Race me'
    })
    const once = state
    state = sessionReducer(state, {
      type: 'optimisticUserMessage',
      threadId: thread.id,
      clientId: 'client-race',
      text: 'Race me'
    })
    expect(state).toBe(once)

    state = notify(state, 'item/agentMessage/delta', {
      threadId: thread.id,
      turnId: 'turn-race',
      itemId: 'agent-race',
      delta: 'streamed first'
    })
    const startedTurn: Turn = {
      id: 'turn-race',
      status: 'inProgress' as const,
      items: [
        {
          type: 'userMessage',
          id: 'user-race',
          clientId: 'client-race',
          content: [{ type: 'text', text: 'Race me', text_elements: [] }]
        },
        { type: 'agentMessage', id: 'agent-race', text: '' }
      ]
    }
    state = notify(state, 'turn/started', { threadId: thread.id, turn: startedTurn })
    state = notify(state, 'turn/started', { threadId: thread.id, turn: startedTurn })

    expect(state.sessions[thread.id].turns.map((turn) => turn.id)).toEqual(['turn-race'])
    expect(findItem(state, 'turn-race', 'agent-race')).toMatchObject({
      type: 'agentMessage',
      text: 'streamed first'
    })
    expect(
      state.sessions[thread.id].turns.flatMap((turn) =>
        turn.items.filter((item) => item.type === 'userMessage')
      )
    ).toHaveLength(1)

    state = sessionReducer(state, {
      type: 'threadHydrated',
      thread: {
        ...thread,
        turns: [
          {
            ...startedTurn,
            items: [
              startedTurn.items[0],
              { type: 'agentMessage', id: 'agent-race', text: '' }
            ]
          }
        ]
      }
    })

    expect(state.sessions[thread.id].turns.map((turn) => turn.id)).toEqual(['turn-race'])
    expect(findItem(state, 'turn-race', 'agent-race')).toMatchObject({ text: 'streamed first' })
  })

  it('keeps an optimistic user turn before a streamed assistant turn when hydration omits the user item', () => {
    let state = hydrated()
    state = sessionReducer(state, {
      type: 'optimisticUserMessage',
      threadId: thread.id,
      clientId: 'client-order',
      text: 'Hello'
    })
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: { id: 'turn-order', status: 'inProgress', items: [] }
    })
    state = notify(state, 'item/started', {
      threadId: thread.id,
      turnId: 'turn-order',
      item: { type: 'agentMessage', id: 'agent-order', text: '' }
    })
    state = notify(state, 'item/agentMessage/delta', {
      threadId: thread.id,
      turnId: 'turn-order',
      itemId: 'agent-order',
      delta: 'Hello back'
    })

    state = sessionReducer(state, {
      type: 'threadHydrated',
      thread: {
        ...thread,
        turns: [
          {
            id: 'turn-order',
            status: 'inProgress',
            items: [{ type: 'agentMessage', id: 'agent-order', text: '' }]
          }
        ]
      }
    })

    expect(state.sessions[thread.id].turns.map((turn) => turn.id)).toEqual([
      'local-client-order',
      'turn-order'
    ])
    expect(
      state.sessions[thread.id].turns.flatMap((turn) => turn.items.map((item) => item.type))
    ).toEqual(['userMessage', 'agentMessage'])
    expect(findItem(state, 'turn-order', 'agent-order')).toMatchObject({ text: 'Hello back' })
  })

  it('field-merges completion snapshots and preserves late streamed data', () => {
    let state = hydrated()
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: {
        id: 'turn-complete',
        status: 'inProgress',
        items: [
          { type: 'userMessage', id: 'user-complete', content: [] },
          { type: 'agentMessage', id: 'agent-complete', text: '' }
        ]
      }
    })
    state = notify(state, 'item/agentMessage/delta', {
      threadId: thread.id,
      turnId: 'turn-complete',
      itemId: 'agent-complete',
      delta: 'answer'
    })
    state = notify(state, 'turn/completed', {
      threadId: thread.id,
      turn: {
        id: 'turn-complete',
        status: 'completed',
        items: [{ type: 'agentMessage', id: 'agent-complete', text: '' }]
      }
    })
    expect(state.sessions[thread.id].turns[0].items.map((item) => item.id)).toEqual([
      'user-complete',
      'agent-complete'
    ])
    state = notify(state, 'item/agentMessage/delta', {
      threadId: thread.id,
      turnId: 'turn-complete',
      itemId: 'agent-complete',
      delta: '!'
    })
    state = notify(state, 'turn/started', {
      threadId: thread.id,
      turn: {
        id: 'turn-complete',
        status: 'inProgress',
        items: [{ type: 'agentMessage', id: 'agent-complete', text: '' }]
      }
    })

    const completed = state.sessions[thread.id].turns[0]
    expect(completed.status).toBe('completed')
    expect(completed.items.find((item) => item.id === 'user-complete')).toBeDefined()
    expect(completed.items.find((item) => item.id === 'agent-complete')).toMatchObject({
      text: 'answer!'
    })
    expect(state.sessions[thread.id]).toMatchObject({ running: false, activeTurnId: null })
  })

  it('tracks thread status and leaves unknown notifications untouched', () => {
    let state = sessionReducer(initialSessionState, { type: 'threadsLoaded', threads: [thread] })
    state = notify(state, 'thread/status/changed', {
      threadId: thread.id,
      status: { type: 'active', activeFlags: ['waitingOnApproval'] }
    })
    expect(state.threads[0].status).toEqual({
      type: 'active',
      activeFlags: ['waitingOnApproval']
    })

    const unchanged = notify(state, 'future/unknownNotification', {
      threadId: thread.id,
      payload: true
    })
    expect(unchanged).toBe(state)
  })
})

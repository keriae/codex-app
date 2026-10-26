import { describe, expect, it, vi } from 'vitest'
import type { AppContext, ManagedWorktree } from '../../shared/api'
import { canReclaimDraftSubmission, draftRecoveryWorktreeChoice, type DraftSubmissionOwner } from './draftSubmissionLifecycle'
import { createdThreadAction } from './foregroundOperation'
import type { NewThreadWorktreeChoice } from './localEnvironmentState'
import { createNavigationHistory, currentNavigationEntry, navigateBack, pushNavigationEntry, resolveDraftNavigationEntries } from './navigationHistory'
import { PreparedWorktreeCache, type PreparedWorktreeClient } from './preparedWorktreeCache'
import type { Thread } from './protocol'
import { initialSessionState, sessionReducer } from './state/sessionReducer'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

const operation = { scope: 'draft:a', id: 'submission:a' }
const draftA = { view: 'chats', threadId: null, cwd: '/source/project', draftId: operation.scope } as const
const draftB = { ...draftA, draftId: 'draft:b' }
function owner(): DraftSubmissionOwner {
  return { currentDraftScope: operation.scope, currentDraftId: operation.scope, selectedThreadId: null, activeSubmissionId: null, pendingSubmissionId: operation.id }
}
function thread(id: string): Thread {
  return { id, cwd: draftA.cwd, name: null, preview: '', model: 'test', reasoningEffort: 'medium', createdAt: 0, updatedAt: 0, turns: [] }
}

describe('delayed draft submission reclamation', () => {
  it('selects a late response after Back returns to the same pending draft', async () => {
    const response = deferred<Thread>()
    const current = owner()
    let history = createNavigationHistory(draftA)
    let state = initialSessionState
    const apply = response.promise.then((created) => {
      const reclaim = canReclaimDraftSubmission(operation, current)
      history = resolveDraftNavigationEntries(history, operation.scope, { threadId: created.id, cwd: created.cwd })
      state = sessionReducer(state, createdThreadAction(created, reclaim))
      if (reclaim) current.selectedThreadId = created.id
      current.pendingSubmissionId = null
    })
    history = pushNavigationEntry(history, draftB)
    Object.assign(current, { currentDraftScope: draftB.draftId, currentDraftId: draftB.draftId })
    history = navigateBack(history)
    Object.assign(current, { currentDraftScope: draftA.draftId, currentDraftId: currentNavigationEntry(history)?.view === 'chats' ? draftA.draftId : null })
    response.resolve(thread('created-a'))
    await apply
    expect(currentNavigationEntry(history)).toEqual({ view: 'chats', threadId: 'created-a', cwd: draftA.cwd })
    expect(state.selectedThreadId).toBe('created-a')
    expect(canReclaimDraftSubmission(operation, current)).toBe(false)
  })

  it('keeps draft B visible when draft A completes in the background', async () => {
    const response = deferred<Thread>()
    const current = owner()
    let history = pushNavigationEntry(createNavigationHistory(draftA), draftB)
    let state = initialSessionState
    const apply = response.promise.then((created) => {
      state = sessionReducer(state, createdThreadAction(created, canReclaimDraftSubmission(operation, current)))
      history = resolveDraftNavigationEntries(history, operation.scope, { threadId: created.id, cwd: created.cwd })
    })
    Object.assign(current, { currentDraftScope: draftB.draftId, currentDraftId: draftB.draftId })
    response.resolve(thread('created-a'))
    await apply
    expect(currentNavigationEntry(history)).toEqual(draftB)
    expect(state.selectedThreadId).toBeNull()
    expect(state.threads.map((entry) => entry.id)).toEqual(['created-a'])
    expect(currentNavigationEntry(navigateBack(history))).toEqual({ view: 'chats', threadId: 'created-a', cwd: draftA.cwd })
  })

  it.each([
    ['a newer active submission', { activeSubmissionId: 'submission:new' }],
    ['a replaced pending token', { pendingSubmissionId: 'submission:new' }],
    ['a different navigation draft id', { currentDraftId: 'draft:b' }],
    ['a selected existing chat', { selectedThreadId: 'selected-chat' }]
  ] as const)('rejects an old response when there is %s', async (_reason, change) => {
    const response = deferred<Thread>()
    const current = owner()
    let state = initialSessionState
    const apply = response.promise.then((created) => {
      state = sessionReducer(state, createdThreadAction(created, canReclaimDraftSubmission(operation, current)))
    })
    Object.assign(current, change)
    if (current.selectedThreadId) state = sessionReducer(state, { type: 'threadHydrated', thread: thread(current.selectedThreadId) })
    response.resolve(thread('old-created'))
    await apply
    expect(state.selectedThreadId).toBe(current.selectedThreadId)
    expect(state.threads.some((entry) => entry.id === 'old-created')).toBe(true)
  })

  it('does not reclaim a completed scope again after its pending token is cleared', async () => {
    const completion = deferred<void>()
    const current = owner()
    const apply = completion.promise.then(() => { current.pendingSubmissionId = null })
    expect(canReclaimDraftSubmission(operation, current)).toBe(true)
    completion.resolve()
    await apply
    expect(canReclaimDraftSubmission(operation, current)).toBe(false)
    expect(canReclaimDraftSubmission({ scope: '', id: '' }, current)).toBe(false)
  })
})

describe('worktree choice in failed draft recovery', () => {
  const sourceCwd = '/source/project'
  const choice: NewThreadWorktreeChoice = { cwd: sourceCwd, enabled: true, branch: 'origin/feature' }
  const context: AppContext = { cwd: '/replica/worktrees/a/project', folderName: 'project', branch: null, platform: 'darwin' }
  const checkout = { worktreeWorkspaceRoot: context.cwd } as ManagedWorktree

  it('preserves the requested branch when creation fails before a checkout exists', async () => {
    const creation = deferred<ManagedWorktree>()
    const native: PreparedWorktreeClient = {
      createManagedWorktree: vi.fn().mockReturnValueOnce(creation.promise).mockResolvedValue(checkout),
      getAppContext: vi.fn().mockResolvedValue(context)
    }
    const cache = new PreparedWorktreeCache()
    const key = { scope: 'draft:failed', cwd: sourceCwd, branch: choice.branch }
    const first = cache.prepare(key, native)
    const failed = expect(first).rejects.toThrow('Invalid ref')
    creation.reject(new Error('Invalid ref'))
    await failed
    const recovered = draftRecoveryWorktreeChoice(choice, sourceCwd, cache.peek(key)?.cwd ?? sourceCwd)
    expect(recovered).toEqual(choice)
    expect(recovered).not.toBe(choice)
    const retry = await cache.prepare({ scope: 'draft:recovery', cwd: recovered!.cwd, branch: recovered!.branch }, native)
    expect(retry.cwd).toBe(context.cwd)
    expect(native.createManagedWorktree).toHaveBeenCalledTimes(2)
    expect(native.createManagedWorktree).toHaveBeenLastCalledWith({ cwd: sourceCwd, startingState: { type: 'branch', branchName: choice.branch } })
  })

  it('recovers in the created checkout without creating another when context lookup fails', async () => {
    const contextRead = deferred<AppContext>()
    const native: PreparedWorktreeClient = {
      createManagedWorktree: vi.fn().mockResolvedValue(checkout),
      getAppContext: vi.fn().mockReturnValueOnce(contextRead.promise).mockResolvedValue(context)
    }
    const cache = new PreparedWorktreeCache()
    const key = { scope: 'draft:failed', cwd: sourceCwd, branch: choice.branch }
    const first = cache.prepare(key, native)
    const failed = expect(first).rejects.toThrow('Context unavailable')
    await vi.waitFor(() => expect(native.getAppContext).toHaveBeenCalledOnce())
    contextRead.reject(new Error('Context unavailable'))
    await failed
    const runCwd = cache.peek(key)!.cwd
    const recovered = draftRecoveryWorktreeChoice(choice, sourceCwd, runCwd)
    expect(recovered).toBeNull()
    const startThread = vi.fn().mockResolvedValue({ id: 'recovered-chat' })
    const prepared = recovered?.enabled
      ? await cache.prepare({ scope: 'draft:recovery', cwd: runCwd, branch: recovered.branch }, native)
      : { cwd: runCwd, context: await native.getAppContext(runCwd) }
    await startThread({ cwd: prepared.cwd })
    expect(native.createManagedWorktree).toHaveBeenCalledOnce()
    expect(startThread).toHaveBeenCalledWith({ cwd: context.cwd })
  })

  it('discards disabled choices and choices belonging to a different source directory', () => {
    expect(draftRecoveryWorktreeChoice({ ...choice, enabled: false }, sourceCwd, sourceCwd)).toBeNull()
    expect(draftRecoveryWorktreeChoice({ ...choice, cwd: '/other' }, sourceCwd, sourceCwd)).toBeNull()
    expect(draftRecoveryWorktreeChoice(null, sourceCwd, sourceCwd)).toBeNull()
  })
})

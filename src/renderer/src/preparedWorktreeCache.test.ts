import { describe, expect, it, vi } from 'vitest'
import type { AppContext, ManagedWorktree } from '../../shared/api'
import { PreparedWorktreeCache, type PreparedWorktreeClient } from './preparedWorktreeCache'

const key = { scope: 'draft:one', cwd: '/source/project', branch: '' }
const context: AppContext = { cwd: '/replica/worktrees/one/project', folderName: 'project', branch: null, platform: 'darwin' }
const checkout = { worktreeWorkspaceRoot: context.cwd } as ManagedWorktree

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function client(): PreparedWorktreeClient {
  return { createManagedWorktree: vi.fn(async () => checkout), getAppContext: vi.fn(async () => context) }
}

describe('prepared checkout failure and retry', () => {
  it('records checkout success before context resolution, then reuses it after a context failure', async () => {
    const native = client()
    const contextRead = deferred<AppContext>()
    native.getAppContext = vi.fn().mockReturnValueOnce(contextRead.promise).mockResolvedValue(context)
    const cache = new PreparedWorktreeCache()
    const first = cache.prepare(key, native)
    await vi.waitFor(() => expect(native.getAppContext).toHaveBeenCalledOnce())
    expect(cache.peek(key)).toEqual({ cwd: context.cwd })
    contextRead.reject(new Error('Context is temporarily unavailable'))
    await expect(first).rejects.toThrow('Context is temporarily unavailable')
    expect(cache.peek(key)).toEqual({ cwd: context.cwd })
    expect(await cache.prepare(key, native)).toEqual({ cwd: context.cwd, context })
    expect(native.createManagedWorktree).toHaveBeenCalledOnce()
    expect(native.getAppContext).toHaveBeenCalledTimes(2)
    expect(native.getAppContext).toHaveBeenLastCalledWith(context.cwd)
  })

  it('retains both checkout and context when subsequent thread/start fails', async () => {
    const native = client()
    const cache = new PreparedWorktreeCache()
    const startThread = vi.fn().mockRejectedValueOnce(new Error('Server disconnected')).mockResolvedValueOnce({ id: 'created-thread' })
    const send = async (): Promise<unknown> => {
      const prepared = await cache.prepare(key, native)
      return startThread({ cwd: prepared.cwd })
    }
    await expect(send()).rejects.toThrow('Server disconnected')
    expect(cache.peek(key)).toEqual({ cwd: context.cwd, context })
    await expect(send()).resolves.toEqual({ id: 'created-thread' })
    expect(native.createManagedWorktree).toHaveBeenCalledOnce()
    expect(native.getAppContext).toHaveBeenCalledOnce()
    expect(startThread).toHaveBeenNthCalledWith(2, { cwd: context.cwd })
  })

  it('shares pending creation and context reads for concurrent callers with the same key', async () => {
    const native = client()
    const creation = deferred<ManagedWorktree>()
    native.createManagedWorktree = vi.fn().mockReturnValue(creation.promise)
    const cache = new PreparedWorktreeCache()
    const first = cache.prepare(key, native)
    const second = cache.prepare({ ...key, branch: undefined }, native)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(native.createManagedWorktree).toHaveBeenCalledOnce())
    creation.resolve(checkout)
    expect(await Promise.all([first, second])).toEqual([{ cwd: context.cwd, context }, { cwd: context.cwd, context }])
    expect(native.getAppContext).toHaveBeenCalledOnce()
  })

  it('releases rejected creation so retry can create, without inventing a successful checkout', async () => {
    const native = client()
    native.createManagedWorktree = vi.fn().mockRejectedValueOnce(new Error('Invalid ref')).mockResolvedValue(checkout)
    const cache = new PreparedWorktreeCache()
    const first = cache.prepare(key, native)
    const second = cache.prepare(key, native)
    await expect(first).rejects.toThrow('Invalid ref')
    await expect(second).rejects.toThrow('Invalid ref')
    expect(cache.peek(key)).toBeUndefined()
    expect(native.getAppContext).not.toHaveBeenCalled()
    await cache.prepare(key, native)
    expect(native.createManagedWorktree).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a prepared checkout for another draft, project or requested branch', async () => {
    const native = client()
    const cache = new PreparedWorktreeCache()
    await cache.prepare(key, native)
    await cache.prepare({ ...key, scope: 'draft:two' }, native)
    await cache.prepare({ ...key, cwd: '/source/other' }, native)
    await cache.prepare({ ...key, branch: 'feature/new' }, native)
    expect(native.createManagedWorktree).toHaveBeenCalledTimes(4)
    expect(native.createManagedWorktree).toHaveBeenLastCalledWith({ cwd: key.cwd, startingState: { type: 'branch', branchName: 'feature/new' } })
  })

  it('does not let a caller mutate the cached context through its returned snapshot', async () => {
    const native = client()
    const cache = new PreparedWorktreeCache()
    const prepared = await cache.prepare(key, native)
    prepared.context.cwd = '/changed/by/caller'
    expect(cache.peek(key)?.context?.cwd).toBe(context.cwd)
    const snapshot = cache.peek(key)!
    snapshot.context!.folderName = 'Changed'
    expect((await cache.prepare(key, native)).context.folderName).toBe('project')
  })
})

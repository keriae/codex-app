import { describe, expect, it, vi } from 'vitest'
import type { ManagedWorktree } from '../shared/api'
import { AppServerDeliveryError } from './appServer'
import {
  forkThreadInNewWorktree,
  validateForkThreadInNewWorktreeOptions
} from './worktreeFork'

const worktree: ManagedWorktree = {
  id: 'managed-id',
  worktreeGitRoot: '/profile/worktrees/abcd/repository',
  worktreeWorkspaceRoot: '/profile/worktrees/abcd/repository/packages/app',
  sourceRepositoryRoot: '/source/repository',
  createdAt: 1,
  head: 'abc123',
  branch: null,
  detached: true,
  ownerThreadId: null,
  setupError: null
}

describe('new-worktree thread fork', () => {
  it('validates a renderer request without allowing output paths or extra fields', () => {
    expect(validateForkThreadInNewWorktreeOptions({
      threadId: 'source-thread',
      cwd: '/source/repository/packages/app',
      startingState: { type: 'branch', branchName: 'origin/main' }
    })).toEqual({
      threadId: 'source-thread',
      cwd: '/source/repository/packages/app',
      startingState: { type: 'branch', branchName: 'origin/main' }
    })
    expect(validateForkThreadInNewWorktreeOptions({
      threadId: 'source-thread',
      cwd: '/source/repository/packages/app',
      startingState: { type: 'working-tree' }
    })).toEqual({
      threadId: 'source-thread',
      cwd: '/source/repository/packages/app',
      startingState: { type: 'working-tree' }
    })
    for (const value of [
      { threadId: '', cwd: '/source/repository' },
      { threadId: 'source', cwd: 'relative' },
      { threadId: 'source', cwd: '/source/repository', outputPath: '/tmp/chosen' },
      { threadId: 'source', cwd: '/source/repository', startingState: { type: 'working-tree', branchName: 'HEAD' } }
    ]) expect(() => validateForkThreadInNewWorktreeOptions(value)).toThrow()
  })

  it('creates an isolated checkout, rechecks document ownership, then forks into its cwd', async () => {
    const order: string[] = []
    const discard = vi.fn(async () => true)
    const create = vi.fn(async (_options, assertCurrent?: () => void) => {
      order.push('create')
      assertCurrent?.()
      return worktree
    })
    const request = vi.fn(async (method: string) => method === 'thread/read'
      ? { thread: {
          id: 'source-thread', cwd: '/source/repository/packages/app',
          model: 'gpt-test', reasoningEffort: 'high', status: { type: 'idle' }
        } }
      : method === 'config/read'
        ? { config: { web_search: 'cached' } }
        : { thread: { id: 'forked-thread', cwd: worktree.worktreeWorkspaceRoot, turns: [] } })
    const result = await forkThreadInNewWorktree(
      { create, discard },
      { request },
      { threadId: 'source-thread', cwd: '/source/repository/packages/app' },
      () => order.push('assert-current'),
      () => order.push('grant-worktree')
    )

    expect(create).toHaveBeenCalledWith(
      {
        cwd: '/source/repository/packages/app',
        startingState: { type: 'working-tree' }
      },
      expect.any(Function)
    )
    expect(order).toEqual([
      'assert-current', 'assert-current', 'create', 'assert-current',
      'assert-current', 'grant-worktree'
    ])
    expect(discard).not.toHaveBeenCalled()
    expect(request).toHaveBeenNthCalledWith(1, 'thread/read', {
      threadId: 'source-thread',
      includeTurns: false
    })
    expect(request).toHaveBeenNthCalledWith(2, 'config/read', {
      cwd: '/source/repository/packages/app',
      includeLayers: false
    })
    expect(request).toHaveBeenNthCalledWith(3, 'thread/fork', {
      threadId: 'source-thread',
      path: null,
      cwd: worktree.worktreeWorkspaceRoot,
      runtimeWorkspaceRoots: [worktree.worktreeWorkspaceRoot, '/source/repository/packages/app'],
      threadSource: 'user',
      model: 'gpt-test',
      config: { web_search: 'cached', model_reasoning_effort: 'high' },
      excludeTurns: true
    })
    expect(result).toEqual({
      thread: { id: 'forked-thread', cwd: worktree.worktreeWorkspaceRoot, turns: [] },
      worktree
    })
  })

  it('never dispatches a fork when the document expires after checkout', async () => {
    const discard = vi.fn(async () => true)
    const request = vi.fn(async (method: string) => method === 'thread/read'
      ? { thread: { id: 'source-thread', cwd: '/source/repository' } }
      : { thread: { id: 'unexpected' } })
    let assertion = 0
    await expect(forkThreadInNewWorktree(
      { create: vi.fn(async () => worktree), discard },
      { request },
      { threadId: 'source-thread', cwd: '/source/repository' },
      () => { if (++assertion === 3) throw new Error('Document expired') }
    )).rejects.toThrow('Document expired')
    expect(request).toHaveBeenCalledTimes(2)
    expect(discard).toHaveBeenCalledWith(worktree)
  })

  it('rejects malformed server results instead of routing an invented thread', async () => {
    const discard = vi.fn(async () => true)
    await expect(forkThreadInNewWorktree(
      { create: vi.fn(async () => worktree), discard },
      { request: vi.fn(async (method: string) => method === 'thread/read'
        ? { thread: { id: 'source-thread', cwd: '/source/repository' } }
        : method === 'config/read' ? { config: {} } : { thread: { id: 'bad\nthread' } }) },
      { threadId: 'source-thread', cwd: '/source/repository' }
    )).rejects.toThrow('invalid forked thread')
    expect(discard).not.toHaveBeenCalled()
  })

  it('discards a checkout when the app-server proves the fork was not sent', async () => {
    const discard = vi.fn(async () => true)
    const failure = new AppServerDeliveryError('Server unavailable', 'thread/fork', 'not-sent')
    await expect(forkThreadInNewWorktree(
      { create: vi.fn(async () => worktree), discard },
      { request: vi.fn(async (method: string) => {
        if (method === 'thread/read') return { thread: { id: 'source-thread', cwd: '/source/repository' } }
        if (method === 'config/read') return { config: {} }
        throw failure
      }) },
      { threadId: 'source-thread', cwd: '/source/repository' }
    )).rejects.toBe(failure)
    expect(discard).toHaveBeenCalledWith(worktree)
  })

  it('retains a checkout when a dispatched fork has an unknown outcome', async () => {
    const discard = vi.fn(async () => true)
    const failure = new AppServerDeliveryError('Connection lost', 'thread/fork', 'outcome-unknown')
    await expect(forkThreadInNewWorktree(
      { create: vi.fn(async () => worktree), discard },
      { request: vi.fn(async (method: string) => {
        if (method === 'thread/read') return { thread: { id: 'source-thread', cwd: '/source/repository' } }
        if (method === 'config/read') return { config: {} }
        throw failure
      }) },
      { threadId: 'source-thread', cwd: '/source/repository' }
    )).rejects.toBe(failure)
    expect(discard).not.toHaveBeenCalled()
  })

  it('does not create a checkout when the source thread belongs to another workspace', async () => {
    const create = vi.fn()
    await expect(forkThreadInNewWorktree(
      { create, discard: vi.fn() },
      { request: vi.fn(async () => ({ thread: { id: 'source-thread', cwd: '/other' } })) },
      { threadId: 'source-thread', cwd: '/source/repository' }
    )).rejects.toThrow('does not match')
    expect(create).not.toHaveBeenCalled()
  })

  it('does not create a checkout while the source has an active turn', async () => {
    const create = vi.fn()
    const request = vi.fn(async () => ({
      thread: { id: 'source-thread', cwd: '/source/repository', status: { type: 'active' } }
    }))
    await expect(forkThreadInNewWorktree(
      { create, discard: vi.fn() },
      { request },
      { threadId: 'source-thread', cwd: '/source/repository' }
    )).rejects.toThrow('Stop the active turn')
    expect(create).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reads fork configuration before allocating the checkout', async () => {
    const create = vi.fn()
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/read') return { thread: { id: 'source-thread', cwd: '/source/repository' } }
      throw new Error('Config unavailable')
    })
    await expect(forkThreadInNewWorktree(
      { create, discard: vi.fn() },
      { request },
      { threadId: 'source-thread', cwd: '/source/repository' }
    )).rejects.toThrow('Config unavailable')
    expect(create).not.toHaveBeenCalled()
  })
})

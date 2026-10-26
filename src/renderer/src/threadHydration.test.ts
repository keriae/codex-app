import { describe, expect, it, vi } from 'vitest'
import type { Thread, Turn } from './protocol'
import { isThreadReadyForComposer } from './threadContinuity'
import { hydrateThreadForSelection, type ThreadHydrationInvoke } from './threadHydration'

const thread: Thread = {
  id: 'fixture-thread',
  preview: 'Fixture chat',
  cwd: '/fixture/workspace',
  createdAt: 1,
  updatedAt: 2,
  historyMode: 'paginated',
  turns: []
}

function turn(id: string): Turn {
  return { id, status: 'completed', items: [{ type: 'agentMessage', id: `item-${id}`, text: id }] }
}

const writerConflict = new Error('thread fixture-thread already has an active writer')

describe('thread selection hydration and writer ownership', () => {
  it('loads paginated transcript after a real resume and carries the successful writer response', async () => {
    const resumed = {
      thread,
      model: 'fixture-model',
      cwd: thread.cwd,
      reasoningEffort: 'high' as const,
      approvalsReviewer: 'guardian_subagent' as const
    }
    const invoke = vi.fn().mockResolvedValueOnce(resumed).mockResolvedValueOnce({
      data: [turn('newest'), turn('older')], nextCursor: 'next-page'
    })
    const result = await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)
    expect(result?.access).toBe('writer')
    expect(result?.turns.map((entry) => entry.id)).toEqual(['older', 'newest'])
    expect(result?.nextCursor).toBe('next-page')
    if (result?.access !== 'writer') throw new Error('Expected writer hydration')
    expect(result.resumed).toBe(resumed)
    expect(result.resumed.approvalsReviewer).toBe('guardian_subagent')
    expect(invoke.mock.calls).toEqual([
      ['thread/resume', { threadId: thread.id, excludeTurns: true }],
      ['thread/turns/list', { threadId: thread.id, limit: 50, sortDirection: 'desc', itemsView: 'full' }]
    ])
  })

  it('recovers metadata and transcript when another client owns the active writer, without acquiring or releasing ownership', async () => {
    const authoritative = { ...thread, cwd: '/fixture/authoritative-workspace', name: 'Authoritative' }
    const invoke = vi.fn().mockRejectedValueOnce(writerConflict)
      .mockResolvedValueOnce({ thread: authoritative })
      .mockResolvedValueOnce({ data: [turn('running'), turn('first')], nextCursor: 'read-only-older' })
    const result = await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)
    expect(result?.access).toBe('reader')
    expect(result?.thread).toMatchObject({ cwd: authoritative.cwd, name: 'Authoritative' })
    expect(result?.turns.map((entry) => entry.id)).toEqual(['first', 'running'])
    expect(result?.nextCursor).toBe('read-only-older')
    expect(result && 'resumed' in result).toBe(false)
    expect(isThreadReadyForComposer(authoritative, {
      loadedThreadId: authoritative.id,
      resumedThreadId: result?.access === 'writer' ? authoritative.id : null,
      hydrating: false,
      contextCwd: authoritative.cwd
    })).toBe(false)
    expect(invoke.mock.calls).toEqual([
      ['thread/resume', { threadId: thread.id, excludeTurns: true }],
      ['thread/read', { threadId: thread.id, includeTurns: false }],
      ['thread/turns/list', { threadId: thread.id, limit: 50, sortDirection: 'desc', itemsView: 'full' }]
    ])
  })

  it('uses selected catalog metadata immediately after a writer conflict instead of waiting on thread/read', async () => {
    const catalogThread = { ...thread, cwd: '/fixture/catalog-workspace', name: 'Catalog title' }
    const invoke = vi.fn().mockRejectedValueOnce(writerConflict)
      .mockResolvedValueOnce({ data: [turn('newest'), turn('oldest')], nextCursor: null })
    const result = await hydrateThreadForSelection(
      invoke as ThreadHydrationInvoke,
      thread.id,
      () => true,
      catalogThread
    )

    expect(result).toMatchObject({
      access: 'reader',
      thread: { id: thread.id, cwd: catalogThread.cwd, name: catalogThread.name },
      nextCursor: null
    })
    expect(result?.turns.map((entry) => entry.id)).toEqual(['oldest', 'newest'])
    expect(invoke.mock.calls).toEqual([
      ['thread/resume', { threadId: thread.id, excludeTurns: true }],
      ['thread/turns/list', { threadId: thread.id, limit: 50, sortDirection: 'desc', itemsView: 'full' }]
    ])
  })

  it('keeps legacy full-history fallback read-only after a live-local-writer conflict', async () => {
    const legacy = { ...thread, historyMode: undefined, turns: [turn('first'), turn('second')] }
    const invoke = vi.fn().mockRejectedValueOnce(new Error('already has a live local writer'))
      .mockResolvedValueOnce({ thread: legacy })
      .mockRejectedValueOnce(new Error('Unknown method thread/turns/list'))
    const result = await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)
    expect(result?.access).toBe('reader')
    expect(result?.thread.historyMode).toBe('legacy')
    expect(result?.turns).toEqual(legacy.turns)
    expect(result?.nextCursor).toBeNull()
    expect(invoke.mock.lastCall).toEqual(['thread/turns/list', {
      threadId: thread.id, limit: 50, sortDirection: 'desc', itemsView: 'full'
    }])
  })

  it('enters reader recovery promptly when history stays blocked by the active writer', async () => {
    const catalogThread = { ...thread, turns: [] }
    const blockedHistory = new Promise<never>(() => {})
    const invoke = vi.fn().mockRejectedValueOnce(writerConflict).mockReturnValueOnce(blockedHistory)
    const result = await hydrateThreadForSelection(
      invoke as ThreadHydrationInvoke,
      thread.id,
      () => true,
      catalogThread,
      5
    )
    expect(result).toMatchObject({ access: 'reader', thread: catalogThread, turns: [], nextCursor: null })
    expect(invoke.mock.calls).toEqual([
      ['thread/resume', { threadId: thread.id, excludeTurns: true }],
      ['thread/turns/list', { threadId: thread.id, limit: 50, sortDirection: 'desc', itemsView: 'full' }]
    ])
  })

  it('retains writer access through a legacy history fallback only because resume succeeded', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ thread, model: 'fixture-model', cwd: thread.cwd })
      .mockRejectedValueOnce(new Error('Unknown method thread/turns/list'))
      .mockResolvedValueOnce({ thread: { ...thread, turns: [turn('first')] } })
    expect((await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id))?.access).toBe('writer')
  })

  it('allows a later successful resume to grant writer access after a read-only selection', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(writerConflict)
      .mockResolvedValueOnce({ thread }).mockResolvedValueOnce({ data: [turn('first')] })
      .mockResolvedValueOnce({ thread, model: 'fixture-model', cwd: thread.cwd })
      .mockResolvedValueOnce({ data: [turn('second'), turn('first')] })
    const first = await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)
    const retry = await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)
    expect(first?.access).toBe('reader')
    expect(retry?.access).toBe('writer')
    expect(retry?.turns.map((entry) => entry.id)).toEqual(['first', 'second'])
    expect(invoke.mock.calls.filter(([method]) => method === 'thread/resume')).toHaveLength(2)
  })

  it('surfaces ordinary resume failures without replacing them with a history read', async () => {
    const missing = new Error('thread not found')
    const invoke = vi.fn().mockRejectedValue(missing)
    await expect(hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)).rejects.toBe(missing)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed read instead of fabricating a loaded or writable conversation', async () => {
    const readFailure = new Error('Cannot read history')
    const invoke = vi.fn().mockRejectedValueOnce(writerConflict).mockRejectedValueOnce(readFailure)
    await expect(hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)).rejects.toBe(readFailure)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not continue an obsolete selection after resume settles', async () => {
    let current = true
    const invoke = vi.fn().mockImplementation(async () => {
      current = false
      throw writerConflict
    })
    expect(await hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id, () => current)).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('does not assign another thread response to the selected chat', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(writerConflict).mockResolvedValueOnce({
      thread: { ...thread, id: 'different-thread' }
    })
    await expect(hydrateThreadForSelection(invoke as ThreadHydrationInvoke, thread.id)).rejects.toThrow('different chat')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

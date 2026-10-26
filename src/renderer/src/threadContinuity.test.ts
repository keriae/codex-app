import { describe, expect, it } from 'vitest'
import type { Thread, Turn } from './protocol'
import {
  acceptNextCursor,
  hasAuthoritativeClientMessage,
  isThreadReadyForComposer,
  isThreadWriterConflictError,
  isUnknownMutationError,
  latestUserTurnTarget,
  revertDisabledReason,
  turnsInChronologicalOrder
} from './threadContinuity'

function turn(id: string, userItemId?: string): Turn {
  return {
    id,
    status: 'completed',
    items: userItemId
      ? [{ type: 'userMessage', id: userItemId, content: [] }]
      : [{ type: 'agentMessage', id: `agent-${id}`, text: id }]
  }
}

const thread: Thread = {
  id: 'synthetic-thread',
  preview: 'Synthetic',
  cwd: '/synthetic/workspace',
  createdAt: 1,
  updatedAt: 2,
  historyMode: 'paginated',
  ephemeral: false,
  turns: []
}

describe('thread continuity helpers', () => {
  it('reverses descending pages and removes duplicate turn ids', () => {
    expect(
      turnsInChronologicalOrder([turn('turn-3'), turn('turn-2'), turn('turn-2'), turn('turn-1')])
        .map((candidate) => candidate.id)
    ).toEqual(['turn-1', 'turn-2', 'turn-3'])
  })

  it('anchors revert to the first user item in the latest user turn', () => {
    const active = turn('turn-3', 'user-3')
    active.items.push({ type: 'userMessage', id: 'steer-3', content: [] })
    expect(latestUserTurnTarget([turn('turn-1', 'user-1'), turn('turn-2'), active])).toEqual({
      turnId: 'turn-3',
      itemId: 'user-3'
    })
  })

  it('rejects repeated cursors without consuming new ones twice', () => {
    const seen = new Set<string>()
    expect(acceptNextCursor('cursor-1', seen)).toBe('cursor-1')
    expect(() => acceptNextCursor('cursor-1', seen)).toThrow('repeated')
    expect(acceptNextCursor(null, seen)).toBeNull()
  })

  it('disables revert for unloaded, active, ephemeral, and legacy history', () => {
    expect(revertDisabledReason(thread, { loaded: false, running: false })).toContain('Load')
    expect(revertDisabledReason(thread, { loaded: true, running: true })).toContain('Stop')
    expect(
      revertDisabledReason({ ...thread, ephemeral: true }, { loaded: true, running: false })
    ).toContain('Ephemeral')
    expect(
      revertDisabledReason(
        { ...thread, historyMode: 'legacy' },
        { loaded: true, running: false }
      )
    ).toContain('Legacy')
    expect(revertDisabledReason(thread, { loaded: true, running: false })).toBeNull()
  })

  it('distinguishes authoritative client messages from optimistic steering items', () => {
    const optimistic = turn('turn-1', 'local-steer-client-1')
    const optimisticItem = optimistic.items[0]
    if (optimisticItem.type === 'userMessage') optimisticItem.clientId = 'client-1'
    expect(hasAuthoritativeClientMessage([optimistic], 'client-1')).toBe(false)

    optimistic.items.push({
      type: 'userMessage',
      id: 'server-message-1',
      clientId: 'client-1',
      content: []
    })
    expect(hasAuthoritativeClientMessage([optimistic], 'client-1')).toBe(true)
  })

  it('requires the loaded thread and matching cwd before enabling the composer', () => {
    expect(
      isThreadReadyForComposer(thread, {
        loadedThreadId: thread.id,
        resumedThreadId: thread.id,
        hydrating: false,
        contextCwd: thread.cwd
      })
    ).toBe(true)
    expect(
      isThreadReadyForComposer(thread, {
        loadedThreadId: null,
        resumedThreadId: thread.id,
        hydrating: false,
        contextCwd: thread.cwd
      })
    ).toBe(false)
    expect(
      isThreadReadyForComposer(thread, {
        loadedThreadId: thread.id,
        resumedThreadId: thread.id,
        hydrating: true,
        contextCwd: thread.cwd
      })
    ).toBe(false)
    expect(
      isThreadReadyForComposer(thread, {
        loadedThreadId: thread.id,
        resumedThreadId: thread.id,
        hydrating: false,
        contextCwd: '/synthetic/other-workspace'
      })
    ).toBe(false)
  })

  it('keeps a readable transcript disabled until this client successfully resumes its writer', () => {
    expect(isThreadReadyForComposer(thread, {
      loadedThreadId: thread.id,
      resumedThreadId: null,
      hydrating: false,
      contextCwd: thread.cwd
    })).toBe(false)
    expect(isThreadReadyForComposer(thread, {
      loadedThreadId: thread.id,
      resumedThreadId: 'another-thread',
      hydrating: false,
      contextCwd: thread.cwd
    })).toBe(false)
    expect(revertDisabledReason(thread, { loaded: true, writable: false, running: false })).toContain('Reconnect')
  })

  it('recognizes both shipped desktop writer-conflict responses without treating other resume errors as ownership conflicts', () => {
    expect(isThreadWriterConflictError(new Error('thread synthetic-thread already has an active writer'))).toBe(true)
    expect(isThreadWriterConflictError(new Error('ALREADY HAS A LIVE LOCAL WRITER'))).toBe(true)
    expect(isThreadWriterConflictError(new Error('thread not found'))).toBe(false)
    expect(isThreadWriterConflictError(new Error('resume timed out'))).toBe(false)
  })

  it('classifies transport failures as unknown mutation outcomes', () => {
    expect(isUnknownMutationError(new Error('turn/steer timed out after 45000ms'))).toBe(true)
    expect(isUnknownMutationError(new Error('Codex app-server stopped'))).toBe(true)
    expect(isUnknownMutationError(new Error('No active turn matches expectedTurnId'))).toBe(false)
  })
})

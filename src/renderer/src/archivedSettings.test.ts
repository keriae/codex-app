import { describe, expect, it } from 'vitest'
import { mergeArchivedThreads } from './ArchivedSettings'
import type { Thread } from './protocol'

const thread = (id: string, updatedAt: number): Thread => ({ id, updatedAt, createdAt: 1, cwd: '/synthetic', preview: id, turns: [] })

describe('archived settings pagination', () => {
  it('reconciles duplicates with fresh server snapshots and preserves recency order', () => {
    const entries = mergeArchivedThreads([thread('a', 2), thread('b', 10)], [thread('a', 12), thread('c', 3)])
    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(entries[0].updatedAt).toBe(12)
  })
})

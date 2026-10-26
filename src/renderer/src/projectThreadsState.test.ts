import { describe, expect, it } from 'vitest'
import type { Thread } from './protocol'
import { matchingProjectThreads, projectArchiveMessage, projectRowClickToggles, projectThreadsForPath, projectThreadTitle, visibleProjectThreads } from './projectThreadsState'

const thread = (id: string, updatedAt = 1, cwd = '/work/project'): Thread => ({ id, cwd, preview: `Chat ${id}`, createdAt: 1, updatedAt, turns: [] })

describe('expanded project chat catalog', () => {
  it('scopes to exact normalized project roots, excluding nested repositories and ephemeral chats', () => {
    const threads = [thread('root', 1, '/work/project/'), thread('nested', 3, '/work/project/subrepo'), thread('neighbour', 4, '/work/project-other'), { ...thread('ephemeral'), ephemeral: true }]
    expect(projectThreadsForPath('/work/project///', threads).map((item) => item.id)).toEqual(['root'])
  })

  it('uses newest summaries, deduplicates pages, and honours recency while preserving inputs', () => {
    const original = thread('a', 2)
    const newer = { ...thread('a', 3), name: 'Updated title' }
    const items = projectThreadsForPath('/work/project', [original, thread('b', 4), original], [newer, { ...thread('c', 1), recencyAt: 5 }])
    expect(items.map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(items[2].name).toBe('Updated title')
    expect(original.name).toBeUndefined()
  })

  it('does not keep a stale cached chat after the current summary changes its project', () => {
    expect(projectThreadsForPath('/work/project', [thread('moved', 1)], [thread('moved', 2, '/work/other')])).toEqual([])
  })

  it('does not resurrect archived IDs from the root first-page summaries', () => {
    expect(projectThreadsForPath('/work/project', [thread('a')], [thread('a', 9), thread('b')], new Set(['a'])).map((item) => item.id)).toEqual(['b'])
  })

  it('uses complete active catalog membership while allowing fresh title/status hydration', () => {
    const items = projectThreadsForPath('/work/project', [thread('active')], [{ ...thread('active', 4), name: 'Fresh title' }, thread('stale-archived')], new Set(), true)
    expect(items.map((item) => item.id)).toEqual(['active'])
    expect(items[0].name).toBe('Fresh title')
  })

  it('finds matching titles across the full loaded catalog and uses the visible title fallback', () => {
    const items = Array.from({ length: 61 }, (_, index) => thread(String(index), index))
    items[60] = { ...items[60], name: '  Database migration  ' }
    expect(matchingProjectThreads(items, ' MIGRATION ').map((item) => item.id)).toEqual(['60'])
    expect(projectThreadTitle({ ...thread('empty'), preview: '\n# First prompt\nsecond line' })).toBe('First prompt')
    expect(matchingProjectThreads(items, ' ')).toEqual([])
  })

  it('reveals ten more at a time but omits pagination when only one tail item remains', () => {
    const items = Array.from({ length: 31 }, (_, index) => thread(String(index)))
    expect(visibleProjectThreads(items, 10)).toHaveLength(10)
    expect(visibleProjectThreads(items, 20)).toHaveLength(20)
    expect(visibleProjectThreads(items, 30)).toHaveLength(31)
    expect(visibleProjectThreads(items.slice(0, 11), 10)).toHaveLength(11)
    expect(visibleProjectThreads(items.slice(0, 12), 10)).toHaveLength(10)
  })

  it('ignores the second click of a double-click and already prevented row events', () => {
    expect(projectRowClickToggles({ detail: 1, defaultPrevented: false, target: null })).toBe(true)
    expect(projectRowClickToggles({ detail: 2, defaultPrevented: false, target: null })).toBe(false)
    expect(projectRowClickToggles({ detail: 1, defaultPrevented: true, target: null })).toBe(false)
  })
})

describe('project archive result feedback', () => {
  it('reports actual successful IDs rather than a frozen confirmation count', () => {
    expect(projectArchiveMessage('Project', { archivedThreadIds: ['a', 'a', 'b'], failures: [] })).toEqual({ message: '已归档 2 个聊天。', failed: false })
  })

  it('reports partial failures separately without counting duplicate or successful failure IDs', () => {
    expect(projectArchiveMessage('Project', { archivedThreadIds: ['a'], failures: [{ threadId: 'a' }, { threadId: 'b' }, { threadId: 'b' }] })).toEqual({ message: '已归档“Project”的 1 个聊天；1 个归档失败。', failed: true })
  })

  it('distinguishes an empty re-read from all-failure results', () => {
    expect(projectArchiveMessage('Project', { archivedThreadIds: [], failures: [] }).failed).toBe(false)
    expect(projectArchiveMessage('Project', { archivedThreadIds: [], failures: [{ threadId: 'a' }] })).toEqual({ message: '无法归档“Project”的聊天。', failed: true })
  })
})

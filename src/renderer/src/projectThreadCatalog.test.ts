import { describe, expect, it, vi } from 'vitest'
import type { Thread } from './protocol'
import { ProjectThreadCatalog } from './projectThreadCatalog'

const thread = (id: string, cwd = '/work/project'): Thread => ({ id, cwd, preview: id, createdAt: 1, updatedAt: 1, turns: [] })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (failure: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('shared project recent/archive catalog', () => {
  it('shares one pending load and one complete 61-chat catalog between consumers', async () => {
    const catalog = new ProjectThreadCatalog()
    catalog.setPaths(['/work/project'])
    const pending = deferred<readonly Thread[]>()
    const loader = vi.fn(() => pending.promise)
    const recent = catalog.load('/work/project', loader)
    const confirm = catalog.load('/work/project', loader)
    expect(recent).toBe(confirm)
    expect(catalog.getSnapshot().entries.get('/work/project')?.loading).toBe(true)
    const all = Array.from({ length: 61 }, (_, index) => thread(String(index)))
    pending.resolve(all)
    await Promise.all([recent, confirm])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(catalog.getSnapshot().entries.get('/work/project')?.threads).toHaveLength(61)
    await catalog.load('/work/project', loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('rejects a late catalog result after removal and re-addition of the same project', async () => {
    const catalog = new ProjectThreadCatalog()
    catalog.setPaths(['/work/project'])
    const stale = deferred<readonly Thread[]>()
    const oldRead = catalog.load('/work/project', () => stale.promise)
    catalog.setPaths([])
    catalog.setPaths(['/work/project'])
    await catalog.load('/work/project', async () => [thread('new')])
    stale.resolve([thread('old')])
    await oldRead
    expect(catalog.getSnapshot().entries.get('/work/project')?.threads.map((item) => item.id)).toEqual(['new'])
  })

  it('keeps a failed load retryable and shares the subsequent authoritative result', async () => {
    const catalog = new ProjectThreadCatalog()
    catalog.setPaths(['/work/project'])
    await expect(catalog.load('/work/project', async () => { throw new Error('Disconnected') })).rejects.toThrow('Disconnected')
    expect(catalog.getSnapshot().entries.get('/work/project')?.error).toBe('Disconnected')
    await catalog.load('/work/project', async () => [thread('retry')])
    expect(catalog.getSnapshot().entries.get('/work/project')).toMatchObject({ loaded: true, loading: false, error: null })
  })

  it('does not reintroduce archived chats from a read started before the archive, while other projects finish loading', async () => {
    const catalog = new ProjectThreadCatalog()
    catalog.setPaths(['/work/project', '/work/other'])
    await catalog.load('/work/project', async () => [thread('a'), thread('b')])
    const beforeArchive = deferred<readonly Thread[]>()
    const other = deferred<readonly Thread[]>()
    const oldRead = catalog.load('/work/project', () => beforeArchive.promise, true)
    const otherRead = catalog.load('/work/other', () => other.promise)
    catalog.removeArchived(['a'], '/work/project')
    beforeArchive.resolve([thread('a'), thread('b')])
    other.resolve([thread('other', '/work/other')])
    await Promise.all([oldRead, otherRead])
    expect(catalog.getSnapshot().entries.get('/work/project')?.threads.map((item) => item.id)).toEqual(['b'])
    expect(catalog.getSnapshot().archivedThreadIds.has('a')).toBe(true)
    expect(catalog.getSnapshot().entries.get('/work/other')?.threads.map((item) => item.id)).toEqual(['other'])
  })

  it('accepts a later explicit active-catalog refresh when a chat has been restored', async () => {
    const catalog = new ProjectThreadCatalog()
    catalog.setPaths(['/work/project'])
    await catalog.load('/work/project', async () => [thread('a')])
    catalog.removeArchived(['a'], '/work/project')
    await catalog.load('/work/project', async () => [thread('a')], true)
    expect(catalog.getSnapshot().archivedThreadIds.has('a')).toBe(false)
    expect(catalog.getSnapshot().entries.get('/work/project')?.threads.map((item) => item.id)).toEqual(['a'])
  })
})

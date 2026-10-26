import { describe, expect, it, vi } from 'vitest'
import type { Thread } from './protocol'
import { archiveAllProjectThreads, loadAllProjectThreads, stopAndArchiveProjectThread, type ProjectThreadOperationsClient } from './projectThreadOperations'

function thread(id: string, cwd = '/project', running = false): Thread {
  return {id, cwd, preview: id, createdAt: 1, updatedAt: 1, path: null, source: 'cli',
    status: {type: 'idle'}, turns: running ? [{id: `${id}-turn`, status: 'inProgress', items: []}] : []} as Thread
}
function fixture(): ProjectThreadOperationsClient {
  return {list: vi.fn(async () => ({data: [], nextCursor: null})), read: vi.fn(async (id) => thread(id)), interrupt: vi.fn(async () => {}), archive: vi.fn(async () => {})}
}
describe('project chat operations', () => {
  it('loads every page, deduplicates, and excludes sibling/subdirectory chats', async () => {
    const client = fixture()
    client.list = vi.fn(async (params) => params.cursor
      ? {data: [thread('a'), thread('b'), thread('sub', '/project/sub')], nextCursor: null}
      : {data: [thread('a'), thread('outside', '/project-other')], nextCursor: 'page2'})
    expect((await loadAllProjectThreads('/project/', client)).map((t) => t.id)).toEqual(['a', 'b'])
    expect(client.list).toHaveBeenLastCalledWith(expect.objectContaining({cwd: '/project', cursor: 'page2', archived: false, sortKey: 'created_at'}))
  })
  it('fails a repeated catalog cursor before performing any archive', async () => {
    const client = fixture()
    client.list = vi.fn(async () => ({data: [thread('a')], nextCursor: 'same'}))
    await expect(archiveAllProjectThreads('/project', client)).rejects.toThrow('repeated')
    expect(client.archive).not.toHaveBeenCalled()
  })
  it('stops the freshly observed active turn before archiving', async () => {
    const order: string[] = []
    const client = fixture()
    client.read = vi.fn(async (id) => thread(id, '/project', true))
    client.interrupt = vi.fn(async (_id, turnId) => { order.push(`interrupt:${turnId}`) })
    client.archive = vi.fn(async (id) => { order.push(`archive:${id}`) })
    await stopAndArchiveProjectThread('a', client, '/project')
    expect(order).toEqual(['interrupt:a-turn', 'archive:a'])
  })
  it('reports partial failure and never archives a chat moved to another project', async () => {
    const client = fixture()
    client.list = vi.fn(async () => ({data: [thread('a'), thread('moved'), thread('failed')], nextCursor: null}))
    client.read = vi.fn(async (id) => thread(id, id === 'moved' ? '/other' : '/project'))
    client.archive = vi.fn(async (id) => { if (id === 'failed') throw new Error('server failed') })
    const remember = vi.fn()
    const result = await archiveAllProjectThreads('/project', client, remember)
    expect(result.archivedThreadIds).toEqual(['a'])
    expect(result.failures).toEqual([{threadId: 'moved', message: 'The chat moved to another project'}, {threadId: 'failed', message: 'server failed'}])
    expect(client.archive).not.toHaveBeenCalledWith('moved')
    expect(remember).toHaveBeenCalledOnce()
  })
  it('does not archive when interrupt fails', async () => {
    const client = fixture()
    client.read = vi.fn(async (id) => thread(id, '/project', true))
    client.interrupt = vi.fn(async () => { throw new Error('cannot stop') })
    await expect(stopAndArchiveProjectThread('a', client)).rejects.toThrow('cannot stop')
    expect(client.archive).not.toHaveBeenCalled()
  })
  it('does not treat an active chat without a live turn snapshot as idle', async () => {
    const client = fixture()
    client.read = vi.fn(async (id) => ({...thread(id), status: {type: 'active' as const, activeFlags: []}}))
    await expect(stopAndArchiveProjectThread('a', client)).rejects.toThrow('locate the running turn')
    expect(client.archive).not.toHaveBeenCalled()
  })
  it('allows archive after confirming that an interrupted turn already finished naturally', async () => {
    const client = fixture()
    let reads = 0
    client.read = vi.fn(async (id) => thread(id, '/project', reads++ === 0))
    client.interrupt = vi.fn(async () => { throw new Error('no active turn to interrupt') })
    await stopAndArchiveProjectThread('a', client)
    expect(client.read).toHaveBeenCalledTimes(2)
    expect(client.archive).toHaveBeenCalledWith('a')
  })
  it('interrupts the replacement turn when it changes before the first interrupt reaches the server', async () => {
    const client = fixture()
    let reads = 0
    client.read = vi.fn(async (id) => ({...thread(id), turns: [{
      id: reads++ === 0 ? 'first-turn' : 'replacement-turn', status: 'inProgress' as const, items: []
    }]}))
    client.interrupt = vi.fn(async (_id, turnId) => {
      if (turnId === 'first-turn') throw new Error('turn changed')
    })
    await stopAndArchiveProjectThread('a', client, '/project')
    expect(vi.mocked(client.interrupt).mock.calls).toEqual([['a', 'first-turn'], ['a', 'replacement-turn']])
    expect(client.archive).toHaveBeenCalledWith('a')
  })
  it('retains a chat moved out of the target project during interrupt reconciliation', async () => {
    const client = fixture()
    let reads = 0
    client.read = vi.fn(async (id) => thread(id, reads++ === 0 ? '/project' : '/other', true))
    client.interrupt = vi.fn(async () => { throw new Error('turn changed') })
    await expect(stopAndArchiveProjectThread('a', client, '/project')).rejects.toThrow('moved')
    expect(client.archive).not.toHaveBeenCalled()
  })
})

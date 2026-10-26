import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDocuments, documentIsDirty } from './workspaceDocuments'
import type { WorkspaceFileSaveResult, WorkspaceFileResult } from '../../shared/api'

function fixture() {
  const disk = new Map([['/root/a.ts', 'const a = 1\n'], ['/root/b.ts', 'const b = 2\n']])
  const client = {
    readWorkspaceFile: vi.fn(async (_root: string, path: string) => ({ path, kind: 'text' as const, mimeType: 'text/typescript', text: disk.get(path)!, sizeBytes: 12 })),
    saveWorkspaceFile: vi.fn(async (_root: string, path: string, text: string, expected: string): Promise<WorkspaceFileSaveResult> => {
      const outcome = expected === disk.get(path) ? 'saved' : 'conflict'
      if (outcome === 'saved') disk.set(path, text)
      return { outcome, file: { path, kind: 'text', mimeType: 'text/typescript', text: disk.get(path)!, sizeBytes: 12 } }
    })
  }
  return { store: new WorkspaceDocuments('/root', client), disk, client }
}
afterEach(() => vi.useRealTimers())
describe('workspace tab documents', () => {
  it.each([false, true])('preserves a recovered draft when its first disk read is an image (overtaken startup: %s)', async (overtaken) => {
    const { client } = fixture()
    let saved: unknown
    let finish!: (result: WorkspaceFileResult) => void
    const image: WorkspaceFileResult = { path: '/root/a.ts', kind: 'image', mimeType: 'image/png', dataBase64: '', sizeBytes: 0 }
    if (overtaken) client.readWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish }))
    else client.readWorkspaceFile.mockResolvedValueOnce(image as never)
    const store = new WorkspaceDocuments('/root', client, {
      read: () => ({ tabs: [{ path: '/root/a.ts', text: '恢复的草稿', base: '旧基线' }], activePath: '/root/a.ts' }),
      write: (value) => { saved = value }
    })
    const remove = store.subscribe(() => {}); await Promise.resolve()
    if (overtaken) {
      client.readWorkspaceFile.mockResolvedValueOnce(image as never)
      await store.reload('/root/a.ts')
      finish({ path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'outdated disk', sizeBytes: 13 })
    }
    await Promise.resolve(); await Promise.resolve()
    expect(store.find('/root/a.ts')).toMatchObject({ text: '恢复的草稿', result: { kind: 'text', text: '旧基线', sizeBytes: 9 }, diskTypeChanged: true })
    expect(store.find('/root/a.ts')?.error).toContain('类型已改变')
    expect(saved).toMatchObject({ tabs: [{ path: '/root/a.ts', text: '恢复的草稿', base: '旧基线' }] })
    client.saveWorkspaceFile.mockRejectedValueOnce(new Error('File is no longer text'))
    expect(await store.close('/root/a.ts')).toBe(false)
    expect(store.find('/root/a.ts')?.text).toBe('恢复的草稿')
    remove()
  })
  it('keeps an undo to the previous baseline durable until its pending write and close have finished', async () => {
    vi.useFakeTimers()
    const { client, disk } = fixture()
    let saved: unknown
    const store = new WorkspaceDocuments('/root', client, { read: () => null, write: (value) => { saved = value } })
    await store.open('/root/a.ts')
    const original = store.find('/root/a.ts')!.text!
    store.edit('/root/a.ts', 'submitted')
    let finish!: (result: WorkspaceFileSaveResult) => void
    client.saveWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = store.save('/root/a.ts')
    store.edit('/root/a.ts', original)
    expect(documentIsDirty(store.find('/root/a.ts')!)).toBe(false)
    expect(saved).toMatchObject({ tabs: [{ text: original, base: original }] })
    const closing = store.close('/root/a.ts')
    expect(store.find('/root/a.ts')?.saving).toBe(true)
    disk.set('/root/a.ts', 'submitted')
    finish({ outcome: 'saved', file: { path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'submitted', sizeBytes: 9 } })
    expect(await saving).toBe(true)
    expect(await closing).toBe(true)
    expect(disk.get('/root/a.ts')).toBe(original)
    expect(client.saveWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(store.find('/root/a.ts')).toBeUndefined()
  })
  it('keeps a tab open when its pending write fails after an undo to the baseline', async () => {
    vi.useFakeTimers()
    const { client, disk } = fixture()
    let saved: unknown
    const store = new WorkspaceDocuments('/root', client, { read: () => null, write: (value) => { saved = value } })
    await store.open('/root/a.ts')
    const original = store.find('/root/a.ts')!.text!
    store.edit('/root/a.ts', 'submitted')
    let fail!: (error: Error) => void
    client.saveWorkspaceFile.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const saving = store.save('/root/a.ts')
    store.edit('/root/a.ts', original)
    const closing = store.close('/root/a.ts')
    // A write can fail at sync after some bytes already reached the disk.
    disk.set('/root/a.ts', 'submitted before sync failure')
    fail(new Error('disk full'))
    expect(await saving).toBe(false)
    expect(await closing).toBe(false)
    expect(store.find('/root/a.ts')).toMatchObject({ text: original, error: 'disk full' })
    expect(documentIsDirty(store.find('/root/a.ts')!)).toBe(true)
    expect(saved).toMatchObject({ tabs: [{ text: original, base: original }] })
    await store.reload('/root/a.ts')
    expect(store.find('/root/a.ts')).toMatchObject({ text: original, conflict: 'submitted before sync failure' })
    expect(documentIsDirty(store.find('/root/a.ts')!)).toBe(true)
    expect(saved).toMatchObject({ tabs: [{ text: original, base: original }] })
    expect(await store.close('/root/a.ts')).toBe(false)
  })
  it('retains a restored preview draft while its initial read is pending or fails', async () => {
    const { client } = fixture()
    let fail!: (error: Error) => void
    client.readWorkspaceFile.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    let saved: unknown
    const store = new WorkspaceDocuments('/root', client, {
      read: () => ({ tabs: [{ path: '/root/a.ts', preview: true, text: 'recover me', base: 'base' }] }), write: (value) => { saved = value }
    })
    const remove = store.subscribe(() => {}); await Promise.resolve()
    expect(await store.close('/root/a.ts')).toBe(false)
    await store.open('/root/b.ts')
    expect(store.find('/root/a.ts')).toBeDefined()
    fail(new Error('ENOENT')); await Promise.resolve(); await Promise.resolve()
    expect(store.find('/root/a.ts')).toMatchObject({ status: 'ready', text: 'recover me', result: { text: 'base' }, error: 'ENOENT' })
    expect(await store.close('/root/a.ts')).toBe(false)
    expect(saved).toMatchObject({ tabs: [ { text: 'recover me', base: 'base' }, { path: '/root/b.ts' } ] })
    expect(await store.close('/root/a.ts', true)).toBe(true)
    remove()
  })
  it('keeps a recovered baseline-equivalent undo when the disk is now an image', async () => {
    const { client } = fixture()
    client.readWorkspaceFile.mockResolvedValueOnce({ path: '/root/a.ts', kind: 'image', mimeType: 'image/png', dataBase64: '', sizeBytes: 0 } as never)
    let saved: unknown
    const store = new WorkspaceDocuments('/root', client, {
      read: () => ({ tabs: [{ path: '/root/a.ts', text: 'original', base: 'original' }] }), write: (value) => { saved = value }
    })
    const remove = store.subscribe(() => {}); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(documentIsDirty(store.find('/root/a.ts')!)).toBe(true)
    expect(saved).toMatchObject({ tabs: [{ text: 'original', base: 'original' }] })
    client.readWorkspaceFile.mockResolvedValueOnce({ path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'original', sizeBytes: 8 })
    await store.reload('/root/a.ts')
    expect(documentIsDirty(store.find('/root/a.ts')!)).toBe(false)
    expect(await store.close('/root/a.ts')).toBe(true)
    remove()
  })
  it('keeps a restored draft when a watcher refresh overtakes the first startup read', async () => {
    vi.useFakeTimers()
    const { client } = fixture()
    let finish!: (result: WorkspaceFileResult) => void
    client.readWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish }))
    const store = new WorkspaceDocuments('/root', client, {
      read: () => ({ tabs: [{ path: '/root/a.ts', text: 'startup draft', base: 'old base' }], activePath: '/root/a.ts' }), write: () => {}
    })
    const remove = store.subscribe(() => {}); await Promise.resolve()
    client.readWorkspaceFile.mockResolvedValueOnce({ path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'latest disk', sizeBytes: 11 })
    await store.reload('/root/a.ts')
    finish({ path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'outdated disk', sizeBytes: 13 }); await Promise.resolve(); await Promise.resolve()
    expect(store.find('/root/a.ts')).toMatchObject({ text: 'startup draft', conflict: 'latest disk', result: { text: 'old base' } })
    remove()
  })
  it('ignores a slower previous disk read and keeps drafts when a watched file is deleted or changes type', async () => {
    vi.useFakeTimers()
    const { store, client } = fixture()
    await store.open('/root/a.ts')
    let finish!: (result: WorkspaceFileResult) => void
    client.readWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish }))
    const oldRead = store.reload('/root/a.ts')
    client.readWorkspaceFile.mockResolvedValueOnce({ path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'newest disk', sizeBytes: 11 })
    await store.reload('/root/a.ts')
    finish({ path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'obsolete disk', sizeBytes: 13 }); await oldRead
    expect(store.find('/root/a.ts')?.text).toBe('newest disk')
    store.edit('/root/a.ts', 'keep local')
    client.readWorkspaceFile.mockRejectedValueOnce(new Error('ENOENT'))
    await store.reload('/root/a.ts')
    expect(store.find('/root/a.ts')).toMatchObject({ text: 'keep local', error: 'ENOENT' })
    client.readWorkspaceFile.mockResolvedValueOnce({ path: '/root/a.ts', kind: 'image', mimeType: 'image/png', dataBase64: '', sizeBytes: 0 } as never)
    await store.reload('/root/a.ts')
    expect(store.find('/root/a.ts')?.text).toBe('keep local')
    expect(store.find('/root/a.ts')?.error).toContain('类型已改变')
  })
  it('processes a file change that arrives while its save is still in flight', async () => {
    vi.useFakeTimers()
    const { store, client, disk } = fixture()
    await store.open('/root/a.ts'); store.edit('/root/a.ts', 'submitted')
    let finish!: (result: WorkspaceFileSaveResult) => void
    client.saveWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = store.save('/root/a.ts')
    await store.reload('/root/a.ts')
    disk.set('/root/a.ts', 'external after save')
    finish({ outcome: 'saved', file: { path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'submitted', sizeBytes: 9 } })
    await saving
    expect(store.find('/root/a.ts')?.text).toBe('external after save')
  })
  it('replaces clean previews, pins edited documents and keeps independent drafts', async () => {
    vi.useFakeTimers()
    const { store } = fixture()
    await store.open('/root/a.ts')
    await store.open('/root/b.ts')
    expect(store.getSnapshot().documents.map((doc) => doc.path)).toEqual(['/root/b.ts'])
    store.edit('/root/b.ts', 'new B')
    await store.open('/root/a.ts')
    expect(store.getSnapshot().documents).toHaveLength(2)
    store.activate('/root/b.ts')
    expect(store.find('/root/b.ts')?.text).toBe('new B')
    expect(store.find('/root/b.ts')?.preview).toBe(false)
  })
  it('does not duplicate pinned tabs when revealing a line', async () => {
    const { store } = fixture()
    await store.open('/root/a.ts')
    store.pin('/root/a.ts')
    await store.open('/root/a.ts', 12)
    expect(store.getSnapshot().documents).toHaveLength(1)
    expect(store.find('/root/a.ts')).toMatchObject({ line: 12, preview: false })
  })
  it('debounces autosave and flushes before closing', async () => {
    vi.useFakeTimers()
    const { store, client, disk } = fixture()
    await store.open('/root/a.ts')
    store.edit('/root/a.ts', 'first')
    await vi.advanceTimersByTimeAsync(2000)
    store.edit('/root/a.ts', 'second')
    await vi.advanceTimersByTimeAsync(2999)
    expect(client.saveWorkspaceFile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(disk.get('/root/a.ts')).toBe('second')
    store.edit('/root/a.ts', 'third')
    expect(await store.close('/root/a.ts')).toBe(true)
    expect(disk.get('/root/a.ts')).toBe('third')
    expect(store.getSnapshot().documents).toHaveLength(0)
  })
  it('preserves edits made while an older save is waiting', async () => {
    vi.useFakeTimers()
    const { store, client } = fixture()
    await store.open('/root/a.ts')
    let finish!: (result: WorkspaceFileSaveResult) => void
    client.saveWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    store.edit('/root/a.ts', 'submitted')
    const saving = store.save('/root/a.ts')
    store.edit('/root/a.ts', 'newer edit')
    finish({ outcome: 'saved', file: { path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'submitted', sizeBytes: 9 } })
    expect(await saving).toBe(true)
    expect(store.find('/root/a.ts')?.text).toBe('newer edit')
    expect(store.find('/root/a.ts')?.result).toMatchObject({text: 'submitted'})
    expect(documentIsDirty(store.find('/root/a.ts')!)).toBe(true)
  })
  it('keeps a conflicting draft open until the user chooses disk or local content', async () => {
    vi.useFakeTimers()
    const { store, disk } = fixture()
    await store.open('/root/a.ts')
    store.edit('/root/a.ts', 'local')
    disk.set('/root/a.ts', 'external')
    expect(await store.close('/root/a.ts')).toBe(false)
    expect(store.find('/root/a.ts')).toMatchObject({ text: 'local', conflict: 'external' })
    expect(await store.resolveConflict('/root/a.ts', 'local')).toBe(true)
    expect(disk.get('/root/a.ts')).toBe('local')
    store.edit('/root/a.ts', 'another draft')
    disk.set('/root/a.ts', 'other external')
    await store.reload('/root/a.ts')
    await store.resolveConflict('/root/a.ts', 'disk')
    expect(store.find('/root/a.ts')?.text).toBe('other external')
  })
  it('retains text and reports errors after a failed save', async () => {
    vi.useFakeTimers()
    const { store, client } = fixture()
    await store.open('/root/a.ts')
    store.edit('/root/a.ts', 'retained')
    client.saveWorkspaceFile.mockRejectedValueOnce(new Error('disk full'))
    expect(await store.close('/root/a.ts')).toBe(false)
    expect(store.find('/root/a.ts')).toMatchObject({ text: 'retained', error: 'disk full', saving: false })
  })
  it('restores per-project tabs and keeps a recovered draft when disk changed during restart', async () => {
    vi.useFakeTimers()
    const { client, disk } = fixture()
    let saved: unknown = null
    const storage = { read: () => saved, write: (value: unknown) => { saved = value } }
    const original = new WorkspaceDocuments('/root', client, storage)
    await original.open('/root/a.ts')
    original.edit('/root/a.ts', 'recover me')
    await original.open('/root/b.ts', 8, false)
    disk.set('/root/a.ts', 'disk changed while closed')
    const restored = new WorkspaceDocuments('/root', client, storage)
    const unsubscribe = restored.subscribe(() => {})
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(restored.getSnapshot().activePath).toBe('/root/b.ts')
    expect(restored.find('/root/a.ts')).toMatchObject({text: 'recover me', conflict: 'disk changed while closed', preview: false})
    expect(restored.find('/root/b.ts')?.line).toBe(8)
    unsubscribe()
  })
  it('does not restore file tabs outside the granted project', () => {
    const { client } = fixture()
    const store = new WorkspaceDocuments('/root', client, {read: () => ({tabs: [{path: '/other/private.txt'}, {path: '/root/../other/private.txt'}], activePath: '/other/private.txt'}), write: () => {}})
    expect(store.getSnapshot().documents).toHaveLength(0)
  })
  it('coalesces simultaneous save requests without replaying a saved edit', async () => {
    vi.useFakeTimers()
    const { store, client } = fixture()
    await store.open('/root/a.ts')
    store.edit('/root/a.ts', 'one edit')
    let finish!: (result: WorkspaceFileSaveResult) => void
    client.saveWorkspaceFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const first = store.save('/root/a.ts')
    const second = store.save('/root/a.ts')
    finish({outcome: 'saved', file: {path: '/root/a.ts', kind: 'text', mimeType: 'text/plain', text: 'one edit', sizeBytes: 8}})
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(client.saveWorkspaceFile).toHaveBeenCalledOnce()
  })
})

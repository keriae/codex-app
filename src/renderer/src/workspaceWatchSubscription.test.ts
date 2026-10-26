import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceFilesChanged } from '../../shared/api'
import { subscribeWorkspaceChanges } from './workspaceWatchSubscription'

function fixture() {
  let listener!: (event: WorkspaceFilesChanged) => void
  let finish!: (id: string) => void
  let reject!: (error: unknown) => void
  const remove = vi.fn()
  const api = {
    onWorkspaceFilesChanged: (value: typeof listener) => { listener = value; return remove },
    watchWorkspacePaths: vi.fn(() => new Promise<string>((resolve, failed) => { finish = resolve; reject = failed })),
    unwatchWorkspacePaths: vi.fn(async () => {})
  }
  return { api, emit: (event: WorkspaceFilesChanged) => listener(event), finish: (id: string) => finish(id), reject: (error: unknown) => reject(error), remove }
}
afterEach(() => vi.unstubAllGlobals())
const event = { id: 'own-watch', root: '/root', files: ['/root/a'], directories: ['/root'] }

it('buffers startup changes and delivers only the current root and native subscription', async () => {
  const { api, emit, finish } = fixture(); const changed = vi.fn()
  const close = subscribeWorkspaceChanges(api, { root: '/root', files: ['/root/a'], directories: ['/root'] }, changed, vi.fn())
  emit(event); emit({ ...event, id: 'other-watch' }); emit({ ...event, root: '/other' })
  finish('own-watch'); await Promise.resolve()
  expect(changed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledWith(event)
  close()
  emit(event)
  expect(changed).toHaveBeenCalledOnce()
  expect(api.unwatchWorkspacePaths).toHaveBeenCalledWith('own-watch')
})

it('unsubscribes a late native id after the pane has changed or closed', async () => {
  const { api, emit, finish, remove } = fixture(); const changed = vi.fn(), ready = vi.fn()
  const close = subscribeWorkspaceChanges(api, { root: '/root', files: [], directories: ['/root'] }, changed, vi.fn(), ready)
  emit(event)
  close(); finish('late-watch'); await Promise.resolve()
  expect(remove).toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled()
  expect(ready).not.toHaveBeenCalled()
  expect(api.unwatchWorkspacePaths).toHaveBeenCalledWith('late-watch')
})

it('waits for delayed native startup, replays events, then refreshes the latest baseline once', async () => {
  const { api, emit, finish } = fixture(), calls: string[] = []
  let disk = 'before startup'
  const baseline = vi.fn(() => calls.push(`baseline:${disk}`))
  const close = subscribeWorkspaceChanges(api, {root: '/root', files: ['/root/a'], directories: ['/root']}, () => calls.push('event'), vi.fn(), baseline)
  await Promise.resolve()
  expect(baseline).not.toHaveBeenCalled()
  // This edit precedes native installation and therefore has no watch event.
  disk = 'changed before native installation'
  emit(event)
  expect(calls).toEqual([])
  finish('own-watch'); await Promise.resolve()
  expect(calls).toEqual(['event', 'baseline:changed before native installation'])
  emit(event)
  expect(calls).toEqual(['event', 'baseline:changed before native installation', 'event'])
  expect(baseline).toHaveBeenCalledOnce()
  close()
})

it('reports consumer callback errors separately and keeps an installed subscription active', async () => {
  const reported = vi.fn(); vi.stubGlobal('reportError', reported)
  const { api, emit, finish, remove } = fixture(), failed = vi.fn()
  const changeError = new Error('consumer event failed'), readyError = new Error('consumer baseline failed')
  const changed = vi.fn(() => {throw changeError})
  const close = subscribeWorkspaceChanges(api, {root: '/root', files: ['/root/a'], directories: []}, changed, failed, () => {throw readyError})
  emit(event); finish('own-watch'); await Promise.resolve()
  expect(reported.mock.calls).toEqual([[changeError], [readyError]])
  expect(failed).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
  emit(event); expect(changed).toHaveBeenCalledTimes(2)
  close(); expect(api.unwatchWorkspacePaths).toHaveBeenCalledWith('own-watch')
})

it('cleans failed native startup without delivering buffered events or refreshing a baseline', async () => {
  const { api, emit, reject, remove } = fixture(), failed = vi.fn(), changed = vi.fn(), ready = vi.fn()
  const close = subscribeWorkspaceChanges(api, {root: '/root', files: [], directories: ['/root']}, changed, failed, ready)
  emit(event)
  const error = new Error('native watch rejected')
  reject(error); await Promise.resolve()
  expect(failed).toHaveBeenCalledWith(error); expect(remove).toHaveBeenCalledOnce()
  expect(changed).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled()
  emit(event); expect(changed).not.toHaveBeenCalled()
  close(); expect(api.unwatchWorkspacePaths).not.toHaveBeenCalled()
})

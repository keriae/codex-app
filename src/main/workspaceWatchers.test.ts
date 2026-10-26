import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceFilesChanged } from '../shared/api'
import { WorkspaceWatchers, isWorkspaceWatchRequest } from './workspaceWatchers'

const roots: string[] = []
const watchers: WorkspaceWatchers[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-file-watch-')); roots.push(root)
  const events: WorkspaceFilesChanged[] = []
  const service = new WorkspaceWatchers((_owner, event) => events.push(event)); watchers.push(service)
  return { root, events, service }
}
afterEach(async () => { watchers.splice(0).forEach((watcher) => watcher.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('reports atomic file replacement, creation, and recreation after deleting a directory', async () => {
  const { root, events, service } = await fixture()
  const directory = join(root, 'src'); await mkdir(directory)
  const path = join(directory, 'a.md'); await writeFile(path, 'before')
  const id = await service.start(1, { root, directories: [root, directory], files: [path] })
  const temporary = join(directory, '.swap'); await writeFile(temporary, 'after'); await rename(temporary, path)
  await vi.waitFor(() => expect(events.some((event) => event.id === id && event.files.includes(path))).toBe(true), { timeout: 2500 })
  events.length = 0
  await rm(directory, { recursive: true }); await mkdir(directory); await writeFile(path, 'recreated')
  await vi.waitFor(() => expect(events.some((event) => event.files.includes(path))).toBe(true), { timeout: 3500 })
  events.length = 0
  await writeFile(join(root, 'new.md'), 'new')
  await vi.waitFor(() => expect(events.some((event) => event.directories.includes(root))).toBe(true), { timeout: 2500 })
})

it('keeps watching a missing file parent and stops all callbacks for the owning window', async () => {
  const { root, events, service } = await fixture()
  const path = join(root, 'later.md')
  const id = await service.start(2, { root, directories: [root], files: [path] })
  service.stop(99, id)
  await writeFile(path, 'created')
  await vi.waitFor(() => expect(events.some((event) => event.files.includes(path))).toBe(true), { timeout: 2500 })
  service.closeOwner(2); events.length = 0
  await writeFile(path, 'after window closed')
  await new Promise((resolve) => setTimeout(resolve, 650))
  expect(events).toEqual([])
})

it('rejects out-of-root symlinks, oversized lists and subscriptions still starting at reload', async () => {
  const { root, service } = await fixture()
  const outside = await fixture(); const secret = join(outside.root, 'secret'); await writeFile(secret, 'secret')
  const link = join(root, 'link'); await symlink(secret, link)
  await expect(service.start(1, { root, directories: [], files: [link] })).rejects.toThrow('outside')
  expect(isWorkspaceWatchRequest({ root, directories: Array(129).fill(root), files: [] })).toBe(false)
  expect(isWorkspaceWatchRequest({ root, directories: [root], files: [], recursive: true })).toBe(false)
  const starting = service.start(3, { root, directories: [root], files: [] })
  service.closeOwner(3)
  await expect(starting).rejects.toThrow('owner has closed')
})

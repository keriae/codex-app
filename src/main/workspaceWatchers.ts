import { watch, watchFile, unwatchFile, type FSWatcher, type Stats } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { WorkspaceFilesChanged, WorkspaceWatchRequest } from '../shared/api'
import { canonicalWorkspaceTarget } from './workspaceFiles'
import { isAllowedWorkspacePathRequest } from './ipcSecurity'

const MAX_PATHS = 128
const MAX_SUBSCRIPTIONS_PER_OWNER = 4
const DEBOUNCE_MS = 80

export function isWorkspaceWatchRequest(value: unknown): value is WorkspaceWatchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (Object.keys(request).some((key) => !['root', 'directories', 'files'].includes(key)) ||
      typeof request.root !== 'string' || !Array.isArray(request.directories) || !Array.isArray(request.files) ||
      request.directories.length + request.files.length > MAX_PATHS) return false
  return [...request.directories, ...request.files].every((path) =>
    typeof path === 'string' && isAllowedWorkspacePathRequest({ root: request.root, path }))
}

interface WatchedDirectory {
  path: string
  watcher: FSWatcher | null
  poll: (current: Stats, previous: Stats) => void
  serial: number
}
interface Subscription {
  id: string
  owner: number
  request: WorkspaceWatchRequest
  directories: Map<string, WatchedDirectory>
  changedDirectories: Set<string>
  changedFiles: Set<string>
  timer: ReturnType<typeof setTimeout> | null
  closed: boolean
}

/** Bounded, nonrecursive local adapter for the original open-file watch lifecycle. */
export class WorkspaceWatchers {
  private subscriptions = new Map<string, Subscription>()
  private ownerEpochs = new Map<number, number>()
  constructor(private readonly notify: (owner: number, event: WorkspaceFilesChanged) => void) {}

  async start(owner: number, request: WorkspaceWatchRequest): Promise<string> {
    if (!isWorkspaceWatchRequest(request)) throw new Error('Invalid workspace watch request')
    const epoch = this.ownerEpochs.get(owner) || 0
    this.ownerEpochs.set(owner, epoch)
    const assertLive = (): void => { if (this.ownerEpochs.get(owner) !== epoch) throw new Error('Workspace watch owner has closed') }
    await canonicalWorkspaceTarget({ root: request.root, path: request.root }, 'directory')
    if ([...this.subscriptions.values()].filter((item) => item.owner === owner).length >= MAX_SUBSCRIPTIONS_PER_OWNER) {
      throw new Error('Too many workspace watch subscriptions')
    }
    const directories = [...new Set([...request.directories, ...request.files.map(dirname)])]
    // Validate every target before installing any watcher. Files may have been deleted;
    // watching their parent keeps recovered drafts connected to later recreation.
    await Promise.all(directories.map((path) => this.validateDirectory(request.root, path)))
    await Promise.all(request.files.map(async (path) => {
      try { await canonicalWorkspaceTarget({ root: request.root, path }, 'file') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }))
    assertLive()
    if ([...this.subscriptions.values()].filter((item) => item.owner === owner).length >= MAX_SUBSCRIPTIONS_PER_OWNER) throw new Error('Too many workspace watch subscriptions')
    const subscription: Subscription = {
      id: randomUUID(), owner, request: { ...request, files: [...new Set(request.files)], directories: [...new Set(request.directories)] },
      directories: new Map(), changedDirectories: new Set(), changedFiles: new Set(), timer: null, closed: false
    }
    this.subscriptions.set(subscription.id, subscription)
    try {
      for (const path of directories) {
        const entry: WatchedDirectory = { path, watcher: null, serial: 0, poll: () => {} }
        subscription.directories.set(path, entry)
        await this.arm(subscription, entry)
        assertLive()
        entry.poll = (current, previous) => {
          if (subscription.closed) return
          this.changed(subscription, path, null)
          // Atomic replacement/deletion can strand an inode-based fs.watch.
          if (current.ino !== previous.ino || current.dev !== previous.dev || current.nlink === 0) {
            void this.arm(subscription, entry).catch(() => {})
          }
        }
        watchFile(path, { persistent: false, interval: 500 }, entry.poll)
      }
      return subscription.id
    } catch (error) { this.stop(owner, subscription.id); throw error }
  }

  stop(owner: number, id: string): void {
    const subscription = this.subscriptions.get(id)
    if (!subscription || subscription.owner !== owner) return
    subscription.closed = true
    this.subscriptions.delete(id)
    if (subscription.timer) clearTimeout(subscription.timer)
    for (const entry of subscription.directories.values()) {
      entry.serial++
      entry.watcher?.close()
      unwatchFile(entry.path, entry.poll)
    }
  }

  closeOwner(owner: number): void {
    this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) || 0) + 1)
    for (const subscription of this.subscriptions.values()) if (subscription.owner === owner) this.stop(owner, subscription.id)
  }

  close(): void { for (const owner of this.ownerEpochs.keys()) this.closeOwner(owner) }

  private async validateDirectory(root: string, path: string): Promise<void> {
    try { await canonicalWorkspaceTarget({ root, path }, 'directory') }
    catch (error) {
      // A vanished expanded directory can still be polled for recreation. Its
      // nearest existing ancestor must remain inside the granted canonical root.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path === root) throw error
      await this.validateDirectory(root, dirname(path))
    }
  }

  private async arm(subscription: Subscription, entry: WatchedDirectory): Promise<void> {
    const serial = ++entry.serial
    entry.watcher?.close()
    entry.watcher = null
    // Revalidate canonical containment when a directory inode is replaced.
    try { await canonicalWorkspaceTarget({ root: subscription.request.root, path: entry.path }, 'directory') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (subscription.closed || serial !== entry.serial) return
    const watcher = watch(entry.path, { persistent: false, recursive: false }, (_type, name) => {
      this.changed(subscription, entry.path, name === null ? null : name.toString())
    })
    watcher.on('error', () => { watcher.close(); if (entry.watcher === watcher) entry.watcher = null; this.changed(subscription, entry.path, null) })
    entry.watcher = watcher
  }

  private changed(subscription: Subscription, directory: string, name: string | null): void {
    if (subscription.closed) return
    const safeName = name && basename(name) === name && name !== '.' && name !== '..' && !name.includes('\0') ? name : null
    subscription.changedDirectories.add(directory)
    for (const path of subscription.request.files) {
      if (dirname(path) === directory && (!safeName || join(directory, safeName) === path)) subscription.changedFiles.add(path)
    }
    if (subscription.timer) return
    subscription.timer = setTimeout(() => {
      subscription.timer = null
      if (subscription.closed) return
      const event = { id: subscription.id, root: subscription.request.root,
        directories: [...subscription.changedDirectories], files: [...subscription.changedFiles] }
      subscription.changedDirectories.clear(); subscription.changedFiles.clear()
      this.notify(subscription.owner, event)
    }, DEBOUNCE_MS)
  }
}

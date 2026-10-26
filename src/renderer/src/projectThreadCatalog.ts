import type { Thread } from './protocol'
import { projectThreadsForPath } from './projectThreadsState'

export interface ProjectThreadCatalogEntry {
  threads: readonly Thread[]
  loaded: boolean
  loading: boolean
  error: string | null
}

export interface ProjectThreadCatalogSnapshot {
  entries: ReadonlyMap<string, ProjectThreadCatalogEntry>
  archivedThreadIds: ReadonlySet<string>
}

interface PendingEntry extends ProjectThreadCatalogEntry {
  promise?: Promise<readonly Thread[]>
}

/** A single active catalog supplies both recent rows and the archive confirmation. */
export class ProjectThreadCatalog {
  private paths = new Set<string>()
  private entries = new Map<string, PendingEntry>()
  private archived = new Set<string>()
  private listeners = new Set<() => void>()
  private snapshot: ProjectThreadCatalogSnapshot = { entries: new Map(), archivedThreadIds: new Set() }

  getSnapshot = (): ProjectThreadCatalogSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(): void {
    this.snapshot = { entries: new Map(this.entries), archivedThreadIds: new Set(this.archived) }
    this.listeners.forEach((listener) => listener())
  }

  setPaths(paths: readonly string[]): void {
    this.paths = new Set(paths)
    let changed = false
    for (const path of this.entries.keys()) {
      if (!this.paths.has(path)) { this.entries.delete(path); changed = true }
    }
    if (changed) this.publish()
  }

  load(path: string, loader: (path: string) => Promise<readonly Thread[]>, refresh = false): Promise<readonly Thread[]> {
    if (!this.paths.has(path)) return Promise.resolve([])
    const previous = this.entries.get(path)
    if (previous?.promise) return previous.promise
    if (previous?.loaded && !previous.error && !refresh) return Promise.resolve(previous.threads)
    const entry: PendingEntry = { threads: previous?.threads ?? [], loaded: previous?.loaded ?? false, loading: true, error: null }
    this.entries.set(path, entry)
    // Defer invocation so the promise is already registered for same-tick duplicate loads.
    entry.promise = Promise.resolve().then(() => loader(path)).then((threads) => {
      if (this.paths.has(path) && this.entries.get(path) === entry) {
        const scoped = projectThreadsForPath(path, threads)
        for (const thread of scoped) this.archived.delete(thread.id)
        this.entries.set(path, { threads: scoped, loaded: true, loading: false, error: null })
        this.publish()
      }
      return threads
    }).catch((failure: unknown) => {
      if (this.paths.has(path) && this.entries.get(path) === entry) {
        this.entries.set(path, { threads: entry.threads, loaded: entry.loaded, loading: false, error: failure instanceof Error ? failure.message : String(failure) })
        this.publish()
      }
      throw failure
    })
    this.publish()
    return entry.promise
  }

  removeArchived(ids: readonly string[], projectPath?: string): void {
    if (!ids.length) return
    const removed = new Set(ids)
    ids.forEach((id) => this.archived.add(id))
    for (const [path, entry] of this.entries) {
      if (path !== projectPath && !entry.threads.some((thread) => removed.has(thread.id))) continue
      // Replacing the entry also invalidates a catalog read started before the archive.
      this.entries.set(path, { threads: entry.threads.filter((thread) => !removed.has(thread.id)), loaded: entry.loaded, loading: false, error: null })
    }
    this.publish()
  }
}

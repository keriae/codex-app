import type { AppContext, CodexDesktopApi } from '../../shared/api'

export interface PreparedWorktreeKey {
  scope: string
  cwd: string
  branch?: string
}

export interface PreparedWorktree {
  cwd: string
  context: AppContext
}

export interface PreparedWorktreeSnapshot {
  cwd: string
  context?: AppContext
}

export type PreparedWorktreeClient = Pick<CodexDesktopApi, 'createManagedWorktree' | 'getAppContext'>

interface Entry {
  cwd?: string
  context?: AppContext
  pending?: Promise<PreparedWorktree>
}

function cacheKey(key: PreparedWorktreeKey): string {
  return JSON.stringify([key.scope, key.cwd, key.branch ?? ''])
}

/** Checkout success survives later context/thread-start failure within the same draft. */
export class PreparedWorktreeCache {
  private readonly entries = new Map<string, Entry>()

  /** A failed context read can still expose the already-created cwd for recovery. */
  peek(key: PreparedWorktreeKey): PreparedWorktreeSnapshot | undefined {
    const entry = this.entries.get(cacheKey(key))
    return entry?.cwd ? { cwd: entry.cwd, ...(entry.context ? { context: { ...entry.context } } : {}) } : undefined
  }

  prepare(key: PreparedWorktreeKey, client: PreparedWorktreeClient): Promise<PreparedWorktree> {
    const identity = cacheKey(key)
    const sourceCwd = key.cwd
    const branch = key.branch
    let entry = this.entries.get(identity)
    if (!entry) { entry = {}; this.entries.set(identity, entry) }
    if (entry.pending) return entry.pending
    if (entry.cwd && entry.context) return Promise.resolve({ cwd: entry.cwd, context: { ...entry.context } })
    const current = entry
    // Start after the pending promise is installed, including for a reentrant caller.
    const operation = Promise.resolve().then(async (): Promise<PreparedWorktree> => {
      if (!current.cwd) {
        const result = await client.createManagedWorktree({ cwd: sourceCwd,
          ...(branch ? { startingState: { type: 'branch', branchName: branch } } : {}) })
        current.cwd = result.worktreeWorkspaceRoot
      }
      current.context ??= await client.getAppContext(current.cwd)
      return { cwd: current.cwd, context: { ...current.context } }
    })
    current.pending = operation
    void operation.then(
      () => { if (current.pending === operation) current.pending = undefined },
      () => { if (current.pending === operation) current.pending = undefined }
    )
    return operation
  }
}

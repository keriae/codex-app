export type NavigationEntry =
  | {
      readonly view: 'chats'
      readonly threadId: string | null
      readonly cwd: string | null
      /** Omitted entries belong to the local host for profile compatibility. */
      readonly hostId?: string
      /** Omitted legacy entries infer local/remote from hostId. */
      readonly projectKind?: 'local' | 'remote' | 'projectless'
      readonly projectId?: string | null
      readonly draftId?: string
    }
  | { readonly view: 'settings' | 'scheduled' | 'projects' | 'marketplace' }

export interface NavigationHistory {
  readonly entries: readonly NavigationEntry[]
  readonly index: number
}

export function sameNavigationEntry(left: NavigationEntry | null, right: NavigationEntry | null): boolean {
  if (!left || !right) return left === right
  if (left.view !== right.view) return false
  const leftHostId = left.view === 'chats' ? left.hostId || 'local' : 'local'
  const rightHostId = right.view === 'chats' ? right.hostId || 'local' : 'local'
  const leftProjectKind = left.view === 'chats'
    ? left.projectKind || (leftHostId === 'local' ? 'local' : 'remote')
    : 'local'
  const rightProjectKind = right.view === 'chats'
    ? right.projectKind || (rightHostId === 'local' ? 'local' : 'remote')
    : 'local'
  return left.view !== 'chats' || (right.view === 'chats' && left.threadId === right.threadId && left.cwd === right.cwd &&
    leftHostId === rightHostId && leftProjectKind === rightProjectKind &&
    (left.projectId || null) === (right.projectId || null) &&
    (left.threadId !== null || left.draftId === right.draftId))
}

export function createNavigationHistory(initial?: NavigationEntry): NavigationHistory {
  return initial ? { entries: [{ ...initial }], index: 0 } : { entries: [], index: -1 }
}

export function currentNavigationEntry(history: NavigationHistory): NavigationEntry | null {
  return history.entries[history.index] ?? null
}

export function pushNavigationEntry(history: NavigationHistory, entry: NavigationEntry): NavigationHistory {
  // Navigating to the current location is a no-op, including when a forward
  // path exists. Returning to an older location is still a new visit.
  if (sameNavigationEntry(currentNavigationEntry(history), entry)) return history
  const entries = [...history.entries.slice(0, history.index + 1), { ...entry }]
  return { entries, index: entries.length - 1 }
}

export function replaceCurrentNavigationEntry(history: NavigationHistory, entry: NavigationEntry): NavigationHistory {
  if (!currentNavigationEntry(history)) return pushNavigationEntry(history, entry)
  if (sameNavigationEntry(currentNavigationEntry(history), entry)) return history
  const entries = [...history.entries]
  entries[history.index] = { ...entry }
  return { entries, index: history.index }
}

/** Resolve the originating draft even when creation completes on a different route. */
export function resolveDraftNavigationEntries(
  history: NavigationHistory, draftId: string,
  thread: {
    readonly threadId: string
    readonly cwd: string | null
    readonly hostId?: string
    readonly projectKind?: 'local' | 'remote' | 'projectless'
    readonly projectId?: string | null
  }
): NavigationHistory {
  let changed = false
  const entries = history.entries.map((entry): NavigationEntry => {
    if (entry.view !== 'chats' || entry.threadId !== null || entry.draftId !== draftId) return entry
    changed = true
    const hostId = thread.hostId ?? entry.hostId
    const projectKind = thread.projectKind ?? entry.projectKind
    const projectId = thread.projectId === undefined ? entry.projectId : thread.projectId
    return {
      view: 'chats',
      threadId: thread.threadId,
      cwd: thread.cwd,
      ...(hostId === undefined ? {} : {hostId}),
      ...(projectKind === undefined ? {} : {projectKind}),
      ...(projectId === undefined ? {} : {projectId})
    }
  })
  return changed ? {entries, index: history.index} : history
}

export function canNavigateBack(history: NavigationHistory): boolean {
  return history.index > 0 && history.index < history.entries.length
}

export function canNavigateForward(history: NavigationHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1
}

export function navigateBack(history: NavigationHistory): NavigationHistory {
  return canNavigateBack(history) ? { entries: history.entries, index: history.index - 1 } : history
}

export function navigateForward(history: NavigationHistory): NavigationHistory {
  return canNavigateForward(history) ? { entries: history.entries, index: history.index + 1 } : history
}

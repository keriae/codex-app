import type { Thread } from './protocol'

export interface ThreadPreferences {
  pinned: string[]
  unread: string[]
}

export const emptyThreadPreferences: ThreadPreferences = { pinned: [], unread: [] }

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

export function parseThreadPreferences(raw: string | null): ThreadPreferences {
  if (!raw) return emptyThreadPreferences
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return emptyThreadPreferences
    }
    return {
      pinned: stringIds(value.pinned),
      unread: stringIds(value.unread)
    }
  } catch {
    return emptyThreadPreferences
  }
}

function updateId(ids: string[], threadId: string, enabled: boolean): string[] {
  const without = ids.filter((id) => id !== threadId)
  return enabled ? [threadId, ...without] : without
}

export function setThreadPinned(
  preferences: ThreadPreferences,
  threadId: string,
  pinned: boolean
): ThreadPreferences {
  return { ...preferences, pinned: updateId(preferences.pinned, threadId, pinned) }
}

export function setThreadUnread(
  preferences: ThreadPreferences,
  threadId: string,
  unread: boolean
): ThreadPreferences {
  return { ...preferences, unread: updateId(preferences.unread, threadId, unread) }
}

export function removeThreadPreferences(
  preferences: ThreadPreferences,
  threadIds: Iterable<string>
): ThreadPreferences {
  const removed = new Set(threadIds)
  return {
    pinned: preferences.pinned.filter((id) => !removed.has(id)),
    unread: preferences.unread.filter((id) => !removed.has(id))
  }
}

export function orderThreadsWithPins(threads: Thread[], pinned: string[]): Thread[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const pinnedThreads = pinned.flatMap((id) => {
    const thread = byId.get(id)
    if (!thread) return []
    byId.delete(id)
    return [thread]
  })
  return [...pinnedThreads, ...threads.filter((thread) => byId.has(thread.id))]
}

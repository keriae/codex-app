import { normalizeProjectPath } from './projects'
import type { Thread } from './protocol'

export const PROJECT_RECENT_CHAT_PAGE_SIZE = 10

export interface ProjectArchiveResult {
  archivedThreadIds: readonly string[]
  failures: readonly { threadId: string; message?: string }[]
}

export function projectThreadTitle(thread: Thread): string {
  return thread.name?.trim() || thread.preview.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean) || '新聊天'
}

export function projectThreadTimestamp(thread: Thread): number {
  const value = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt
  return Number.isFinite(value) ? value : 0
}

/** Project roots own their exact normalized cwd, not neighbouring or nested repositories. */
export function projectThreadsForPath(
  path: string,
  catalog: readonly Thread[],
  currentThreads: readonly Thread[] = [],
  archivedThreadIds: ReadonlySet<string> = new Set(),
  completeCatalog = false
): Thread[] {
  const root = normalizeProjectPath(path)
  if (!root) return []
  const byId = new Map<string, Thread>()
  const memberIds = completeCatalog ? new Set(catalog.map((thread) => thread.id)) : null
  const summaries = memberIds ? currentThreads.filter((thread) => memberIds.has(thread.id)) : currentThreads
  for (const thread of [...catalog, ...summaries]) {
    if (!thread.id || archivedThreadIds.has(thread.id)) continue
    const previous = byId.get(thread.id)
    if (!previous || projectThreadTimestamp(thread) >= projectThreadTimestamp(previous)) byId.set(thread.id, thread)
  }
  return [...byId.values()].filter((thread) => !thread.ephemeral && normalizeProjectPath(thread.cwd) === root).sort((left, right) => projectThreadTimestamp(right) - projectThreadTimestamp(left) || left.id.localeCompare(right.id))
}

export function matchingProjectThreads(threads: readonly Thread[], query: string): Thread[] {
  const search = query.trim().toLocaleLowerCase()
  return search ? threads.filter((thread) => projectThreadTitle(thread).toLocaleLowerCase().includes(search)) : []
}

export function visibleProjectThreads(threads: readonly Thread[], requestedCount: number): Thread[] {
  const count = Math.max(PROJECT_RECENT_CHAT_PAGE_SIZE, requestedCount)
  // The shipped list avoids a Show more button for one remaining item.
  return threads.slice(0, threads.length === count + 1 ? count + 1 : count)
}

export function projectArchiveMessage(projectName: string, result: ProjectArchiveResult): { message: string; failed: boolean } {
  const successes = new Set(result.archivedThreadIds).size
  const failures = new Set(result.failures.map((failure) => failure.threadId).filter((id) => !result.archivedThreadIds.includes(id))).size
  if (!successes) return { message: failures ? `无法归档“${projectName}”的聊天。` : `“${projectName}”没有可归档的聊天。`, failed: failures > 0 }
  return failures
    ? { message: `已归档“${projectName}”的 ${successes} 个聊天；${failures} 个归档失败。`, failed: true }
    : { message: `已归档 ${successes} 个聊天。`, failed: false }
}

export function projectRowClickToggles(event: { defaultPrevented: boolean; detail: number; target: EventTarget | null }): boolean {
  return !event.defaultPrevented && event.detail <= 1 && !(typeof Element !== 'undefined' && event.target instanceof Element && event.target.closest('button,a,input,textarea,select,[role="button"]'))
}

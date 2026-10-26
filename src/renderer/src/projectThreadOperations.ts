import type { Page, Thread } from './protocol'
import { normalizeProjectPath } from './projects'
import type { ProjectArchiveResult } from './projectThreadsState'

export interface ProjectThreadOperationsClient {
  list(params: { cwd: string; archived: false; cursor?: string; limit: number; sortKey: 'created_at'; sortDirection: 'desc' }): Promise<Page<Thread>>
  read(threadId: string): Promise<Thread>
  interrupt(threadId: string, turnId: string): Promise<void>
  archive(threadId: string): Promise<void>
}

export async function loadAllProjectThreads(cwd: string, client: Pick<ProjectThreadOperationsClient, 'list'>): Promise<Thread[]> {
  const normalized = normalizeProjectPath(cwd)
  if (!normalized) throw new Error('Invalid project directory')
  const threads = new Map<string, Thread>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.list({cwd: normalized, archived: false, limit: 100, sortKey: 'created_at', sortDirection: 'desc', ...(cursor ? {cursor} : {})})
    for (const thread of page.data) {
      if (normalizeProjectPath(thread.cwd) === normalized) threads.set(thread.id, thread)
    }
    cursor = page.nextCursor || undefined
    if (cursor) {
      if (cursors.has(cursor)) throw new Error('The server repeated a project chat cursor')
      cursors.add(cursor)
    }
  } while (cursor)
  return [...threads.values()]
}

export async function stopAndArchiveProjectThread(threadId: string, client: Omit<ProjectThreadOperationsClient, 'list'>, expectedCwd?: string): Promise<void> {
  const validate = (fresh: Thread): void => {
    if (fresh.id !== threadId) throw new Error('The server returned a different chat')
    if (expectedCwd && normalizeProjectPath(fresh.cwd) !== normalizeProjectPath(expectedCwd)) throw new Error('The chat moved to another project')
  }
  let fresh = await client.read(threadId)
  validate(fresh)
  for (let attempt = 0; attempt < 2; attempt++) {
    const active = [...(fresh.turns || [])].reverse().find((turn) => turn.status === 'inProgress')
    if (!active) {
      if (fresh.status?.type === 'active') throw new Error('Unable to locate the running turn. Refresh the chat before archiving.')
      break
    }
    try { await client.interrupt(threadId, active.id); break }
    catch (error) {
      // The turn can finish naturally between read and interrupt. Verify that
      // fact rather than treating an arbitrary interrupt error as successful.
      const latest = await client.read(threadId)
      validate(latest)
      const next = [...(latest.turns || [])].reverse().find((turn) => turn.status === 'inProgress')
      if (!next && latest.status?.type !== 'active') break
      if (attempt === 1 || !next || next.id === active.id) throw error
      fresh = latest
    }
  }
  await client.archive(threadId)
}

export async function archiveAllProjectThreads(cwd: string, client: ProjectThreadOperationsClient, onArchived?: (thread: Thread) => void): Promise<ProjectArchiveResult> {
  // Re-read at confirmation time: the visible recent-chat page is not the whole catalog.
  const threads = await loadAllProjectThreads(cwd, client)
  const archivedThreadIds: string[] = []
  const failures: {threadId: string; message: string}[] = []
  for (const thread of threads) {
    try {
      await stopAndArchiveProjectThread(thread.id, client, cwd)
      archivedThreadIds.push(thread.id)
      onArchived?.(thread)
    } catch (error) {
      failures.push({threadId: thread.id, message: error instanceof Error ? error.message : String(error)})
    }
  }
  return {archivedThreadIds, failures}
}

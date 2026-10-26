import type { ApprovalsReviewer, ReasoningEffort, Thread, Turn } from './protocol'
import {
  isThreadWriterConflictError,
  turnsInChronologicalOrder,
  type ThreadTurnsPage
} from './threadContinuity'

export interface ThreadResumeResponse {
  thread: Thread
  model: string
  cwd: string
  reasoningEffort?: ReasoningEffort | null
  activePermissionProfile?: { id?: string } | null
  approvalsReviewer?: ApprovalsReviewer | null
}

export interface ThreadReadResponse {
  thread: Thread
}

export type ThreadHydrationInvoke = <T>(method: string, params: Record<string, unknown>) => Promise<T>

const DEFAULT_READER_HISTORY_TIMEOUT_MS = 3_000
const READER_HISTORY_TIMEOUT = Symbol('reader-history-timeout')

interface HydratedHistory {
  thread: Thread
  turns: Turn[]
  nextCursor: string | null
}

export type ThreadHydrationResult = HydratedHistory & (
  | { access: 'writer'; resumed: ThreadResumeResponse }
  | { access: 'reader'; resumeError: unknown }
)

function checkedThread(thread: Thread, expectedId: string): Thread {
  if (thread.id !== expectedId) throw new Error('The server returned a different chat while loading history.')
  return thread
}

async function readerHistoryWithTimeout(
  request: Promise<ThreadTurnsPage>,
  timeoutMs: number
): Promise<ThreadTurnsPage | typeof READER_HISTORY_TIMEOUT> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<typeof READER_HISTORY_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(READER_HISTORY_TIMEOUT), timeoutMs)
      })
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

/**
 * The desktop's writer-conflict recovery hydrates native history while keeping
 * resumeState=needs_resume. Reading history does not grant runtime ownership.
 */
export async function hydrateThreadForSelection(
  invoke: ThreadHydrationInvoke,
  threadId: string,
  isCurrent: () => boolean = () => true,
  catalogThread?: Thread,
  readerHistoryTimeoutMs = DEFAULT_READER_HISTORY_TIMEOUT_MS
): Promise<ThreadHydrationResult | null> {
  if (!isCurrent()) return null
  let access: { access: 'writer'; resumed: ThreadResumeResponse } | { access: 'reader'; resumeError: unknown }
  let hydrated: Thread
  try {
    const resumed = await invoke<ThreadResumeResponse>('thread/resume', { threadId, excludeTurns: true })
    if (!isCurrent()) return null
    hydrated = checkedThread(resumed.thread, threadId)
    access = { access: 'writer', resumed }
  } catch (error) {
    if (!isCurrent()) return null
    if (!isThreadWriterConflictError(error)) throw error
    // The selected sidebar/catalog row already carries the metadata needed to
    // render a read-only transcript. Reuse it after a writer conflict instead
    // of issuing a second metadata read: the native app opens this state
    // immediately, and a busy writer can otherwise leave thread/read pending
    // until the transport timeout before the recovery card appears.
    if (catalogThread?.id === threadId) {
      hydrated = catalogThread
    } else {
      const metadata = await invoke<ThreadReadResponse>('thread/read', { threadId, includeTurns: false })
      if (!isCurrent()) return null
      hydrated = checkedThread(metadata.thread, threadId)
    }
    access = { access: 'reader', resumeError: error }
  }

  let turns: Turn[]
  let nextCursor: string | null = null
  try {
    const historyRequest = invoke<ThreadTurnsPage>('thread/turns/list', {
      threadId,
      limit: 50,
      sortDirection: 'desc',
      itemsView: 'full'
    })
    const page = access.access === 'reader'
      ? await readerHistoryWithTimeout(historyRequest, readerHistoryTimeoutMs)
      : await historyRequest
    if (!isCurrent()) return null
    if (page === READER_HISTORY_TIMEOUT) {
      // A thread held by another desktop instance can block every history RPC
      // until the transport timeout. The native app does not leave the user on
      // a 45-second spinner or expose that IPC error: it enters read-only mode
      // immediately and lets the user retry or fork. Preserve any turns already
      // present on the catalog/metadata row and show that recovery state.
      hydrated = { ...hydrated, historyMode: hydrated.historyMode || 'paginated' }
      turns = hydrated.turns || []
      return { ...access, thread: hydrated, turns, nextCursor }
    }
    turns = turnsInChronologicalOrder(page.data)
    nextCursor = page.nextCursor || null
    hydrated = { ...hydrated, historyMode: hydrated.historyMode || 'paginated' }
  } catch (error) {
    if (!isCurrent()) return null
    if (access.access === 'reader') {
      // Legacy or temporarily blocked servers may reject pagination while the
      // writer is owned elsewhere. Avoid a second thread/read that is known to
      // block in this state; cached metadata is enough to render the recovery
      // card and any turns already supplied by a legacy metadata response.
      hydrated = { ...hydrated, historyMode: hydrated.historyMode || 'legacy' }
      turns = hydrated.turns || []
      return { ...access, thread: hydrated, turns, nextCursor }
    }
    // Legacy servers do not provide native turn pagination. A read response
    // still cannot promote a reader to writer, even when all turns are present.
    const result = await invoke<ThreadReadResponse>('thread/read', { threadId, includeTurns: true })
    if (!isCurrent()) return null
    hydrated = checkedThread(result.thread, threadId)
    hydrated = { ...hydrated, historyMode: hydrated.historyMode || 'legacy' }
    turns = hydrated.turns
  }

  return { ...access, thread: hydrated, turns, nextCursor }
}

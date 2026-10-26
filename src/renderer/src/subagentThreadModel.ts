import type { ReasoningEffort, Thread, Turn } from './protocol'
import { collaborationModelLabel } from './collaborationActivityModel'

export interface SubagentThreadRequest {
  <T>(method: string, params: Record<string, unknown>): Promise<T>
}

/** A transcript read never selects or resumes the parent or child conversation. */
export async function readSubagentThread(request: SubagentThreadRequest, threadId: string): Promise<Thread> {
  let thread: Thread
  try {
    const response = await request<{ thread: Thread }>('thread/read', { threadId, includeTurns: true })
    thread = response.thread
    if (thread.turns.length && thread.turns.every((turn) => turn.itemsView !== 'notLoaded')) return thread
    if (thread.historyMode !== 'paginated') return thread
  } catch (error) {
    // Older and paginated servers may reject includeTurns for this source.
    try { thread = (await request<{ thread: Thread }>('thread/read', { threadId, includeTurns: false })).thread }
    catch { throw error }
  }
  const seen = new Set<string>()
  const byId = new Map<string, Turn>()
  let cursor: string | null = null
  do {
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error('子智能体历史返回了重复分页游标')
      seen.add(cursor)
    }
    const page: { data: Turn[]; nextCursor?: string | null } = await request('thread/turns/list', {
      threadId, cursor, limit: 50, sortDirection: 'asc', itemsView: 'full'
    })
    for (const turn of page.data) byId.set(turn.id, turn)
    cursor = page.nextCursor || null
  } while (cursor !== null)
  return { ...thread, turns: [...byId.values()], historyMode: 'paginated' }
}

const effortLabels: Record<ReasoningEffort, string> = {
  none: '无', minimal: '最低', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: 'Max', ultra: 'Ultra'
}

export function subagentModelDetail(thread: Thread | null | undefined): string | null {
  if (!thread?.model) return null
  const model = collaborationModelLabel(thread.model)
  return thread.reasoningEffort ? `${model} · ${effortLabels[thread.reasoningEffort] || thread.reasoningEffort}` : model
}

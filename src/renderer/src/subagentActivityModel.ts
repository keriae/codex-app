import type { ThreadItem, ToolItem } from './protocol'

export interface SubagentActivityEntry {
  threadId: string
  name: string
  status: 'active' | 'updated' | 'completed' | 'interrupted' | 'failed' | 'waiting'
}

export interface SubagentActivityBatch { firstItemId: string; itemIds: string[]; items: ToolItem[] }

/** Native inline groups keep the most recent event per agent within each adjacent batch. */
export function subagentActivityBatches(items: ThreadItem[]): SubagentActivityBatch[] {
  const batches: SubagentActivityBatch[] = []
  let batch: ToolItem[] = []
  const flush = (): void => {
    if (batch.length > 1) batches.push({ firstItemId: batch[0].id, itemIds: batch.map((item) => item.id), items: batch })
    batch = []
  }
  for (const item of items) {
    if (item.type === 'subAgentActivity' && item.kind !== 'interacted') batch.push(item)
    else flush()
  }
  flush()
  return batches
}

export function subagentGroupEntries(items: ToolItem[], names?: Map<string, string>): SubagentActivityEntry[] {
  const entries = new Map<string, SubagentActivityEntry>()
  for (const item of items) for (const entry of subagentActivityEntries(item, names)) entries.set(entry.threadId, entry)
  return [...entries.values()]
}

export function subagentGroupStatus(entries: SubagentActivityEntry[]): SubagentActivityEntry['status'] {
  if (entries.some((entry) => entry.status === 'interrupted')) return 'interrupted'
  if (entries.some((entry) => entry.status === 'updated')) return 'updated'
  if (entries.some((entry) => entry.status === 'failed')) return 'failed'
  return entries.length && entries.every((entry) => entry.status === 'completed') ? 'completed' : 'active'
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// F3n in the installed renderer: the final non-root path segment is the label.
export function subagentDisplayName(path: string): string | null {
  const segment = path.split('/').map((part) => part.trim()).filter((part) => part && part !== 'root').at(-1)
  if (!segment) return null
  const name = segment.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return name ? name[0].toUpperCase() + name.slice(1) : null
}

export function subagentAvatarIndex(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) % 2147483647
  return hash % 28
}

function activityStatus(value: unknown): SubagentActivityEntry['status'] {
  switch (typeof value === 'string' ? value : text(record(value)?.status) || text(record(value)?.type)) {
    case 'completed': case 'done': return 'completed'
    case 'interrupted': case 'shutdown': return 'interrupted'
    case 'failed': case 'errored': case 'error': case 'notFound': return 'failed'
    case 'interacted': case 'updated': return 'updated'
    case 'waiting': case 'pendingInit': return 'waiting'
    default: return 'active'
  }
}

export function subagentActivityLabel(status: SubagentActivityEntry['status']): string {
  switch (status) {
    case 'completed': return '已完成'
    case 'interrupted': return '已中断'
    case 'failed': return '失败'
    case 'updated': return '已更新'
    case 'waiting': return '正在等待'
    default: return '开始工作'
  }
}

/** Read names from earlier spawn calls when a wait result only includes IDs. */
export function subagentNames(items: ThreadItem[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const item of items) {
    if (item.type === 'subAgentActivity') {
      const id = text(item.agentThreadId)
      const name = text(item.agentPath) && subagentDisplayName(String(item.agentPath))
      if (id && name) names.set(id, name)
    }
    if (item.type !== 'collabAgentToolCall') continue
    for (const value of Array.isArray(item.receiverThreads) ? item.receiverThreads : []) {
      const receiver = record(value)
      const thread = record(receiver?.thread) || receiver
      const id = text(receiver?.threadId) || text(thread?.id)
      const source = record(record(record(thread?.source)?.subAgent)?.thread_spawn)
      const name = text(thread?.agentNickname) || text(source?.agent_nickname) || text(thread?.name)
      if (id && name) names.set(id, name)
    }
    for (const [id, value] of Object.entries(record(item.agentsStates) || {})) {
      const state = record(value)
      const name = text(state?.agentNickname) || text(state?.name)
      if (name) names.set(id, name)
    }
  }
  return names
}

export function subagentActivityEntries(item: ToolItem, names: Map<string, string> = new Map()): SubagentActivityEntry[] {
  if (item.type === 'subAgentActivity') {
    const threadId = text(item.agentThreadId)
    if (!threadId) return []
    return [{ threadId, name: subagentDisplayName(text(item.agentPath) || '') || names.get(threadId) || '智能体', status: activityStatus(item.kind) }]
  }
  if (item.type !== 'collabAgentToolCall') return []
  const states = record(item.agentsStates) || {}
  const ids = new Set<string>(Object.keys(states))
  for (const value of Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []) {
    const id = text(value)
    if (id) ids.add(id)
  }
  for (const value of Array.isArray(item.receiverThreads) ? item.receiverThreads : []) {
    const thread = record(value)
    const id = text(thread?.threadId) || text(thread?.id)
    if (id) ids.add(id)
  }
  return [...ids].map((threadId) => {
    const state = record(states[threadId])
    return { threadId, name: names.get(threadId) || text(state?.agentNickname) || '子代理', status: activityStatus(state?.status || item.status) }
  })
}

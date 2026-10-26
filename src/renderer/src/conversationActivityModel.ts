import type { ReasoningItem, ThreadItem, ToolItem } from './protocol'
import { collaborationHeader } from './collaborationActivityModel'
import { reasoningActivityHeading } from './reasoningActivity'
import { subagentDisplayName } from './subagentActivityModel'
import { toolActivityStatus, webSearchDetail } from './toolActivityModel'

export type ConversationActivityGrouping = 'hidden' | 'standalone' | 'groupable'

function isMcpAppActivity(item: ThreadItem): boolean {
  if (item.type !== 'mcpToolCall') return false
  // The shipped renderer keeps MCP Apps outside the ordinary tool summary so
  // their interactive surface remains visible when the surrounding work folds.
  return typeof item.mcpAppResourceUri === 'string' && item.mcpAppResourceUri.trim().length > 0
}

/**
 * `dr` in the shipped renderer normalizes every timeline item to either a
 * groupable activity, a persistent standalone row, or no conversation row.
 * Keeping that decision in one place prevents commands, patches and tools from
 * quietly developing different grouping boundaries.
 */
export function conversationActivityGrouping(item: ThreadItem): ConversationActivityGrouping {
  if (item.type === 'reasoning') return 'hidden'
  if (item.type === 'agentMessage' || item.type === 'plan') return item.text?.trim() ? 'standalone' : 'hidden'
  if (item.type === 'collabAgentToolCall') return collaborationHeader([item]) === null ? 'hidden' : 'standalone'
  if (item.type === 'webSearch') return webSearchDetail(item).trim() ? 'groupable' : 'hidden'
  if (item.type === 'dynamicToolCall') {
    if ((item.namespace == null || item.namespace === 'codex_app') && item.tool === 'update_up_next') return 'hidden'
    return item.standaloneInConversation === true ? 'standalone' : 'groupable'
  }
  if (item.type === 'mcpToolCall') {
    return item.standaloneInConversation === true || isMcpAppActivity(item) ? 'standalone' : 'groupable'
  }
  if (item.type === 'commandExecution' || item.type === 'fileChange') return 'groupable'
  return 'standalone'
}

/** dr/Ge in the shipped renderer filter items before creating activity groups. */
export function isConversationActivityItem(item: ThreadItem): boolean {
  return conversationActivityGrouping(item) !== 'hidden'
}

export function isGroupableConversationActivityItem(item: ThreadItem): boolean {
  return conversationActivityGrouping(item) === 'groupable'
}

export function isConversationActivityInProgress(item: ThreadItem, live = false): boolean {
  if (item.type === 'commandExecution' || item.type === 'fileChange') return item.status === 'inProgress'
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall' || item.type === 'webSearch') {
    return toolActivityStatus(item, live) === 'inProgress'
  }
  if (item.type === 'collabAgentToolCall') {
    return item.status === 'inProgress' || item.completed === false
  }
  if (item.type === 'subAgentActivity' && live) {
    const kind = typeof item.kind === 'string' ? item.kind : ''
    return !['completed', 'done', 'interrupted', 'shutdown', 'failed', 'errored', 'error', 'notFound'].includes(kind)
  }
  if (item.type === 'contextCompaction') return item.status === 'inProgress'
  if (item.type === 'imageGeneration') return item.status === 'inProgress'
  return false
}

export function conversationActivityItems(items: ThreadItem[]): ThreadItem[] {
  return items.filter(isConversationActivityItem)
}

export interface ConversationSubagentGroup {
  anchorItemId: string
  itemIds: string[]
  items: ToolItem[]
}

export interface ConversationActivityProjection {
  items: ThreadItem[]
  subagentGroups: ConversationSubagentGroup[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function subagentThreadId(item: ThreadItem): string | null {
  return item.type === 'subAgentActivity' ? text(item.agentThreadId) : null
}

function hasInlineSubagentIdentity(item: ThreadItem): boolean {
  if (item.type !== 'subAgentActivity' || item.kind === 'interacted') return false
  const threadId = subagentThreadId(item)
  const path = text(item.agentPath)
  if (!threadId || !path) return false
  const segment = path.split('/').map((part) => part.trim()).filter((part) => part && part !== 'root').at(-1)
  return Boolean(segment && segment !== threadId && subagentDisplayName(path))
}

function collaborationReceiverIds(item: ToolItem): string[] {
  const ids = new Set<string>()
  for (const value of Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []) {
    const id = text(value)
    if (id) ids.add(id)
  }
  for (const value of Array.isArray(item.receiverThreads) ? item.receiverThreads : []) {
    const receiver = record(value)
    const thread = record(receiver?.thread)
    const id = text(value) || text(receiver?.threadId) || text(receiver?.id) || text(thread?.id)
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * The native renderer projects protocol-level subagent lifecycle items onto
 * anchored inline groups. A completed, prompt-less spawn is redundant once all
 * of its receivers have a named inline lifecycle row, so it is removed before
 * grouping. Meaningful spawn prompts and all other collaboration actions stay
 * visible as standalone activity.
 */
export function conversationActivityProjection(items: ThreadItem[]): ConversationActivityProjection {
  const visibleItems = conversationActivityItems(items)
  const inlineThreadIds = new Set(visibleItems.filter(hasInlineSubagentIdentity).flatMap((item) => {
    const id = subagentThreadId(item)
    return id ? [id] : []
  }))
  const projectedItems = visibleItems.filter((item) => {
    if (item.type !== 'collabAgentToolCall') return true
    const action = text(item.action) || text(item.tool)
    if (action !== 'spawnAgent' && action !== 'spawn_agent') return true
    if (item.status !== 'completed' || text(item.prompt)) return true
    const receiverIds = collaborationReceiverIds(item)
    return receiverIds.length === 0 || !receiverIds.every((id) => inlineThreadIds.has(id))
  })

  const anchoredGroups: Array<ConversationSubagentGroup & { anchorIndex: number }> = []
  let anchorItemId: string | null = null
  let anchorIndex = -1
  let itemIds: string[] = []
  let itemIdSet = new Set<string>()
  let latestByThread = new Map<string, ToolItem>()
  const flush = (): void => {
    if (anchorItemId === null) return
    anchoredGroups.push({ anchorItemId, anchorIndex, itemIds, items: [...latestByThread.values()] })
    anchorItemId = null
    anchorIndex = -1
    itemIds = []
    itemIdSet = new Set()
    latestByThread = new Map()
  }
  projectedItems.forEach((item, index) => {
    if (item.type !== 'subAgentActivity' || item.kind === 'interacted') {
      flush()
      return
    }
    if (anchorItemId === null) {
      anchorItemId = item.id
      anchorIndex = index
    }
    if (!itemIdSet.has(item.id)) {
      itemIdSet.add(item.id)
      itemIds.push(item.id)
    }
    // Map replacement keeps the first-seen agent order while retaining the
    // latest lifecycle state for that agent, matching the shipped zE pass.
    latestByThread.set(subagentThreadId(item) || `item:${item.id}`, item)
  })
  flush()

  anchoredGroups.sort((left, right) => left.anchorIndex - right.anchorIndex)
  return {
    items: projectedItems,
    subagentGroups: anchoredGroups.map(({ anchorIndex: _anchorIndex, ...group }) => group)
  }
}

export function latestConversationReasoning(items: ThreadItem[]): ReasoningItem | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.type === 'reasoning' && reasoningActivityHeading(item)) return item
  }
  return null
}

export function hasConversationActivity(items: ThreadItem[], live: boolean): boolean {
  return items.some(isConversationActivityItem) || (live && latestConversationReasoning(items) !== null)
}

export type ConversationTurnActivityPhase =
  | 'starting'
  | 'thinking'
  | 'live'
  | 'complete'
  | 'terminal'
  | 'idle'

/**
 * Keep the turn lifecycle mutually exclusive. The shipped UI replaces the
 * startup line with one live work group, then replaces that group with a
 * single completed disclosure as soon as the final answer starts.
 */
export function conversationTurnActivityPhase({
  active,
  finalAnswerStarted,
  hasVisibleActivity,
  interrupted,
  starting,
  thinking
}: {
  active: boolean
  finalAnswerStarted: boolean
  hasVisibleActivity: boolean
  interrupted: boolean
  starting: boolean
  thinking: boolean
}): ConversationTurnActivityPhase {
  if (active && !finalAnswerStarted) {
    if (hasVisibleActivity) return 'live'
    if (starting) return 'starting'
    if (thinking) return 'thinking'
    // Cover the short hand-off between turn/start and the first thinking
    // notification without flashing the status line away.
    return 'thinking'
  }
  if (!hasVisibleActivity) return 'idle'
  if (finalAnswerStarted && !interrupted) return 'complete'
  return 'terminal'
}

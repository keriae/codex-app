import type { Thread, Turn } from './protocol'

export interface ThreadTurnsPage {
  data: Turn[]
  nextCursor?: string | null
  backwardsCursor?: string | null
}

export interface LatestUserTurnTarget {
  turnId: string
  itemId: string
}

export function turnsInChronologicalOrder(turnsNewestFirst: Turn[]): Turn[] {
  const seen = new Set<string>()
  const chronological: Turn[] = []
  for (const turn of [...turnsNewestFirst].reverse()) {
    if (seen.has(turn.id)) continue
    seen.add(turn.id)
    chronological.push(turn)
  }
  return chronological
}

export function latestUserTurnTarget(turns: Turn[]): LatestUserTurnTarget | null {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]
    // thread/revert operates at turn granularity. Anchor its action to the
    // first user message so a later steer item does not imply item-level undo.
    for (let itemIndex = 0; itemIndex < turn.items.length; itemIndex += 1) {
      const item = turn.items[itemIndex]
      if (item.type === 'userMessage') return { turnId: turn.id, itemId: item.id }
    }
  }
  return null
}

export function hasAuthoritativeClientMessage(turns: Turn[], clientId: string): boolean {
  return turns.some((turn) =>
    turn.items.some((item) => {
      if (
        item.type !== 'userMessage' ||
        item.id.startsWith('local-') ||
        item.id.startsWith('local-steer-')
      ) {
        return false
      }
      return item.clientId === clientId
    })
  )
}

export function turnContainsClientMessage(turn: Turn | undefined, clientId: string): boolean {
  return Boolean(
    turn?.items.some(
      (item) =>
        item.type === 'userMessage' &&
        !item.id.startsWith('local-') &&
        !item.id.startsWith('local-steer-') &&
        item.clientId === clientId
    )
  )
}

export function isTerminalTurnStatus(status: Turn['status']): boolean {
  return status === 'completed' || status === 'interrupted' || status === 'failed'
}

export function isUnknownMutationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('[not-sent]')) return false
  if (message.includes('[outcome-unknown]')) return true
  return /timed out|app-server (?:stopped|is not available|exited)|stdin (?:is )?closed|connection changed|write.*(?:failed|closed)|broken pipe|epipe|econnreset/i.test(
    message
  )
}

export function isThreadWriterConflictError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('already has an active writer') ||
    message.includes('already has a live local writer')
  )
}

export function isThreadReadyForComposer(
  thread: Thread,
  options: {
    loadedThreadId: string | null
    resumedThreadId: string | null
    hydrating: boolean
    contextCwd: string | null
  }
): boolean {
  return (
    !options.hydrating &&
    options.loadedThreadId === thread.id &&
    options.resumedThreadId === thread.id &&
    options.contextCwd === thread.cwd
  )
}

export function revertDisabledReason(
  thread: Thread,
  options: { loaded: boolean; running: boolean; writable?: boolean }
): string | null {
  if (!options.loaded) return 'Load this chat before reverting history.'
  if (options.writable === false) return 'Reconnect this chat before reverting history.'
  if (options.running || thread.status?.type === 'active') {
    return 'Stop the active turn before reverting history.'
  }
  if (thread.ephemeral === true) return 'Ephemeral chats cannot be reverted.'
  if (thread.historyMode === 'legacy') return 'Legacy chat history cannot be reverted.'
  return null
}

export function acceptNextCursor(
  cursor: string | null | undefined,
  seen: Set<string>
): string | null {
  if (!cursor) return null
  if (seen.has(cursor)) throw new Error('The server repeated a turn-history cursor')
  seen.add(cursor)
  return cursor
}

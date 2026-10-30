import { observeTurnTiming } from '../turnTiming'
import type { RpcNotification } from '../../../shared/api'
import { commandDurationMs, normalizeCommandActions, normalizeCommandItem } from '../commandActions'
import type {
  ModelOption,
  PermissionProfile,
  Thread,
  ThreadItem,
  ThreadStatus,
  Turn,
  TurnError,
  UserInput
} from '../protocol'

export interface ThreadSession {
  turns: Turn[]
  activeTurnId: string | null
  running: boolean
  error: string | null
}

export interface SessionState {
  threads: Thread[]
  transientThreads: Record<string, Thread>
  selectedThreadId: string | null
  sessions: Record<string, ThreadSession>
  models: ModelOption[]
  permissionProfiles: PermissionProfile[]
  loadingThreads: boolean
}

export type SessionAction =
  | { type: 'threadsLoaded'; threads: Thread[] }
  | { type: 'threadsAppended'; threads: Thread[] }
  | { type: 'threadUpserted'; thread: Thread; select?: boolean }
  | { type: 'threadRenamed'; threadId: string; name: string | null }
  | { type: 'threadRemoved'; threadIds: string[] }
  | { type: 'modelsLoaded'; models: ModelOption[] }
  | { type: 'permissionProfilesLoaded'; profiles: PermissionProfile[] }
  | { type: 'selectThread'; threadId: string | null }
  | { type: 'threadHydrated'; thread: Thread }
  | { type: 'transientThreadHydrated'; thread: Thread }
  | { type: 'transientThreadRemoved'; threadId: string }
  | {
      type: 'threadHistoryReplaced'
      threadId: string
      turns: Turn[]
      baselineTurnIds?: string[]
      preserveTurnIds?: string[]
    }
  | { type: 'threadHistoryPrepended'; threadId: string; turns: Turn[] }
  | { type: 'threadReverted'; threadId: string; beforeTurnId: string }
  | {
      type: 'optimisticUserMessage'
      threadId: string
      clientId: string
      text: string
      input?: UserInput[]
    }
  | {
      type: 'optimisticSteer'
      threadId: string
      turnId: string
      clientId: string
      text: string
      input?: UserInput[]
    }
  | { type: 'steerAccepted'; threadId: string; turnId: string; clientId: string }
  | {
      type: 'steerUnknown'
      threadId: string
      turnId: string
      clientId: string
      message: string
    }
  | {
      type: 'steerFailed'
      threadId: string
      turnId: string
      clientId: string
      message: string
    }
  | { type: 'notification'; notification: RpcNotification }
  | { type: 'sessionError'; threadId: string; message: string }
  | { type: 'turnFailed'; threadId: string; message: string }

export const initialSessionState: SessionState = {
  threads: [],
  transientThreads: {},
  selectedThreadId: null,
  sessions: {},
  models: [],
  permissionProfiles: [],
  loadingThreads: true
}

type ItemMergeMode = 'started' | 'completed' | 'hydrated'

function emptySession(): ThreadSession {
  return { turns: [], activeTurnId: null, running: false, error: null }
}

function normalizeThreads(threads: Thread[]): Thread[] {
  const newestById = new Map<string, Thread>()
  for (const thread of threads) {
    const existing = newestById.get(thread.id)
    if (!existing || existing.updatedAt <= thread.updatedAt) newestById.set(thread.id, thread)
  }
  return [...newestById.values()].sort(
    (a, b) => (b.recencyAt || b.updatedAt) - (a.recencyAt || a.updatedAt)
  )
}

function upsertThread(threads: Thread[], thread: Thread): Thread[] {
  return normalizeThreads([thread, ...threads.filter((candidate) => candidate.id !== thread.id)])
}

function replaceTurn(turns: Turn[], turn: Turn): Turn[] {
  const index = turns.findIndex((candidate) => candidate.id === turn.id)
  if (index < 0) return [...turns, turn]
  const copy = [...turns]
  copy[index] = turn
  return copy
}

function replaceItem(turn: Turn, item: ThreadItem): Turn {
  const index = turn.items.findIndex((candidate) => candidate.id === item.id)
  if (index < 0) return { ...turn, items: [...turn.items, item] }
  const items = [...turn.items]
  items[index] = item
  return { ...turn, items }
}

function ensureTurn(session: ThreadSession, turnId: string): Turn {
  return (
    session.turns.find((turn) => turn.id === turnId) || {
      id: turnId,
      items: [],
      status: 'inProgress'
    }
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((part) => typeof part === 'string') ? value : null
}

function isTerminalTurn(turn: Turn): boolean {
  return turn.status === 'completed' || turn.status === 'interrupted' || turn.status === 'failed'
}

function isTerminalItemStatus(value: unknown): boolean {
  return value === 'completed' || value === 'failed' || value === 'declined'
}

function mergeStreamText(
  previousValue: unknown,
  incomingValue: unknown,
  authoritative: boolean
): string | null | undefined {
  const previous = typeof previousValue === 'string' ? previousValue : null
  const incoming = typeof incomingValue === 'string' ? incomingValue : null

  if (incoming === null || incoming.length === 0) {
    if (previous !== null && previous.length > 0) return previous
    return incomingValue === null ? null : previous || incoming || undefined
  }
  if (previous === null || previous.length === 0) return incoming
  if (previous === incoming || previous.startsWith(incoming)) return previous
  if (incoming.startsWith(previous)) return incoming
  return authoritative ? incoming : previous
}

function mergeStreamArray(
  previousValue: unknown,
  incomingValue: unknown,
  authoritative: boolean
): string[] {
  const previous = stringArray(previousValue) || []
  const incoming = stringArray(incomingValue) || []
  const result: string[] = []
  const length = Math.max(previous.length, incoming.length)

  for (let index = 0; index < length; index += 1) {
    result[index] = mergeStreamText(previous[index], incoming[index], authoritative) || ''
  }
  return result
}

function mergeItem(
  existing: ThreadItem,
  incoming: ThreadItem,
  mode: ItemMergeMode,
  preserveCommandMetadata = false
): ThreadItem {
  const sameType = existing.type === incoming.type
  const previous = sameType ? (existing as unknown as Record<string, unknown>) : {}
  const next = incoming as unknown as Record<string, unknown>
  const merged: Record<string, unknown> =
    mode === 'hydrated' ? { ...next, ...previous } : { ...previous, ...next }
  const authoritative = mode === 'completed'

  if (incoming.type === 'agentMessage' || incoming.type === 'plan') {
    merged.text = mergeStreamText(previous.text, next.text, authoritative) || ''
  } else if (incoming.type === 'reasoning') {
    merged.summary = mergeStreamArray(previous.summary, next.summary, authoritative)
    merged.content = mergeStreamArray(previous.content, next.content, authoritative)
  } else if (incoming.type === 'commandExecution') {
    merged.aggregatedOutput = mergeStreamText(
      previous.aggregatedOutput,
      next.aggregatedOutput,
      authoritative
    )
    const previousActions = normalizeCommandActions(previous.commandActions)
    const incomingActions = normalizeCommandActions(next.commandActions)
    const preservePrevious =
      preserveCommandMetadata || mode === 'hydrated' ||
      (mode === 'started' && isTerminalItemStatus(previous.status))
    if (previousActions.length > 0 && (preservePrevious || incomingActions.length === 0)) {
      merged.commandActions = previousActions
    } else if (incomingActions.length > 0 || 'commandActions' in merged) {
      merged.commandActions = incomingActions
    }
    const previousDuration = commandDurationMs(previous.durationMs)
    const incomingDuration = commandDurationMs(next.durationMs)
    if (previousDuration !== null && (preservePrevious || incomingDuration === null)) {
      merged.durationMs = previousDuration
    } else if (incomingDuration !== null || 'durationMs' in merged) {
      merged.durationMs = incomingDuration
    }
  } else if (incoming.type === 'fileChange') {
    const previousChanges = Array.isArray(previous.changes) ? previous.changes : null
    const incomingChanges = Array.isArray(next.changes) ? next.changes : null
    if (
      previousChanges?.length &&
      (mode !== 'completed' || (incomingChanges && incomingChanges.length === 0))
    ) {
      merged.changes = previousChanges
    }
  }

  if (
    mode !== 'completed' &&
    isTerminalItemStatus(previous.status) &&
    next.status === 'inProgress'
  ) {
    merged.status = previous.status
  }

  return merged as unknown as ThreadItem
}

function mergeItems(
  existing: ThreadItem[],
  incoming: ThreadItem[],
  mode: ItemMergeMode,
  preserveCommandMetadata = false
): ThreadItem[] {
  const existingById = new Map(existing.map((item) => [item.id, item]))
  const incomingIds = new Set(incoming.map((item) => item.id))
  if (mode === 'hydrated' || mode === 'completed') {
    const incomingById = new Map(incoming.map((item) => [item.id, item]))
    return removeOptimisticItemDuplicates([
      ...existing.map((item) => {
        const snapshot = incomingById.get(item.id)
        return snapshot ? mergeItem(item, snapshot, mode, preserveCommandMetadata) : item
      }),
      ...incoming.filter((item) => !existingById.has(item.id))
    ])
  }
  return removeOptimisticItemDuplicates([
    ...incoming.map((item) => {
      const previous = existingById.get(item.id)
      return previous ? mergeItem(previous, item, mode, preserveCommandMetadata) : item
    }),
    ...existing.filter((item) => !incomingIds.has(item.id))
  ])
}

function mergeTurn(
  existing: Turn,
  incoming: Turn,
  mode: ItemMergeMode,
  preserveCommandMetadata = false
): Turn {
  const incomingIsTerminal = isTerminalTurn(incoming)
  const itemMode: ItemMergeMode =
    mode === 'completed' || incomingIsTerminal ? 'completed' : mode
  const merged: Turn = {
    ...(mode === 'hydrated' ? incoming : existing),
    ...(mode === 'hydrated' ? existing : incoming),
    startedAt: incoming.startedAt ?? existing.startedAt,
    completedAt: incoming.completedAt ?? existing.completedAt,
    durationMs: incoming.durationMs ?? existing.durationMs,
    activityCompletedAtMs: existing.activityCompletedAtMs ?? incoming.activityCompletedAtMs,
    items: mergeItems(existing.items, incoming.items, itemMode, preserveCommandMetadata)
  }

  // A duplicate/stale turn-start snapshot must not reopen a terminal turn.
  if (isTerminalTurn(existing) && !incomingIsTerminal) {
    merged.status = existing.status
    merged.error = existing.error
    merged.completedAt = existing.completedAt
    merged.durationMs = existing.durationMs
  } else if (
    mode === 'completed' &&
    incoming.status === 'completed' &&
    !Object.prototype.hasOwnProperty.call(incoming, 'error')
  ) {
    // `error` is required by v2, but older/minimal snapshots can omit it.
    merged.error = null
  }

  return merged
}

function mergeHydratedTurns(existing: Turn[], hydrated: Turn[]): Turn[] {
  const existingById = new Map(existing.map((turn) => [turn.id, turn]))
  const hydratedIds = new Set(hydrated.map((turn) => turn.id))
  const merged = hydrated.map((turn) => {
    const previous = existingById.get(turn.id)
    return previous
      ? mergeTurn(previous, turn, isTerminalTurn(turn) ? 'completed' : 'hydrated', true)
      : turn
  })
  const mergedIds = new Set(merged.map((turn) => turn.id))

  for (let index = 0; index < existing.length; index += 1) {
    const turn = existing[index]
    if (hydratedIds.has(turn.id)) continue

    const nextAnchor = existing
      .slice(index + 1)
      .find((candidate) => mergedIds.has(candidate.id))
    if (nextAnchor) {
      const anchorIndex = merged.findIndex((candidate) => candidate.id === nextAnchor.id)
      merged.splice(anchorIndex, 0, turn)
      mergedIds.add(turn.id)
      continue
    }

    const previousAnchor = existing
      .slice(0, index)
      .reverse()
      .find((candidate) => mergedIds.has(candidate.id))
    if (previousAnchor) {
      const anchorIndex = merged.findIndex((candidate) => candidate.id === previousAnchor.id)
      merged.splice(anchorIndex + 1, 0, turn)
    } else {
      merged.push(turn)
    }
    mergedIds.add(turn.id)
  }

  return merged
}

function clientIds(turn: Turn): string[] {
  return turn.items.flatMap((item) => {
    if (item.type !== 'userMessage') return []
    const itemRecord = item as unknown as Record<string, unknown>
    return typeof itemRecord.clientId === 'string' ? [itemRecord.clientId] : []
  })
}

function itemClientId(item: ThreadItem): string | null {
  if (item.type !== 'userMessage') return null
  const itemRecord = item as unknown as Record<string, unknown>
  return typeof itemRecord.clientId === 'string' ? itemRecord.clientId : null
}

function removeOptimisticItemDuplicates(items: ThreadItem[]): ThreadItem[] {
  const serverClientIds = new Set(
    items
      .filter((item) => !item.id.startsWith('local-steer-'))
      .map(itemClientId)
      .filter((clientId): clientId is string => clientId !== null)
  )
  if (serverClientIds.size === 0) return items
  return items.filter(
    (item) =>
      !item.id.startsWith('local-steer-') ||
      !serverClientIds.has(itemClientId(item) || '')
  )
}

function removeOptimisticDuplicates(turns: Turn[]): Turn[] {
  const reconciled = turns.map((turn) => ({
    ...turn,
    items: removeOptimisticItemDuplicates(turn.items)
  }))
  const serverClientIds = new Set(
    reconciled.filter((turn) => !turn.id.startsWith('local-')).flatMap(clientIds)
  )
  if (serverClientIds.size === 0) return reconciled
  return reconciled.filter(
    (turn) =>
      !turn.id.startsWith('local-') || !clientIds(turn).some((clientId) => serverClientIds.has(clientId))
  )
}

function replacePersistedHistory(
  session: ThreadSession,
  hydrated: Turn[],
  baselineTurnIds: string[] = [],
  preserveTurnIds: string[] = []
): ThreadSession {
  const existingById = new Map(session.turns.map((turn) => [turn.id, turn]))
  const hydratedIds = new Set(hydrated.map((turn) => turn.id))
  const baselineIds = new Set(baselineTurnIds)
  const protectedIds = new Set(preserveTurnIds)
  const reconciled = hydrated.map((turn) => {
    const previous = existingById.get(turn.id)
    return previous
      ? mergeTurn(previous, turn, isTerminalTurn(turn) ? 'completed' : 'hydrated', true)
      : turn
  })
  const liveOnly = session.turns.filter(
    (turn) =>
      !hydratedIds.has(turn.id) &&
      (!baselineIds.has(turn.id) ||
        protectedIds.has(turn.id) ||
        turn.id.startsWith('local-') ||
        turn.status === 'inProgress')
  )
  return syncSessionTurns(
    session,
    [...reconciled, ...liveOnly],
    session.activeTurnId || undefined
  )
}

function hasClientId(turns: Turn[], clientId: string): boolean {
  return turns.some((turn) => clientIds(turn).includes(clientId))
}

function syncSessionTurns(
  session: ThreadSession,
  turns: Turn[],
  preferredActiveTurnId?: string
): ThreadSession {
  const normalized = turns.map((turn) => {
    const items = turn.items.map((item) =>
      item.type === 'commandExecution' ? normalizeCommandItem(item) : item
    )
    return items.some((item, index) => item !== turn.items[index]) ? { ...turn, items } : turn
  })
  const deduplicated = removeOptimisticDuplicates(normalized)
  const preferred = preferredActiveTurnId
    ? deduplicated.find(
        (turn) => turn.id === preferredActiveTurnId && turn.status === 'inProgress'
      )
    : null
  const current = session.activeTurnId
    ? deduplicated.find((turn) => turn.id === session.activeTurnId && turn.status === 'inProgress')
    : null
  const fallback = [...deduplicated].reverse().find((turn) => turn.status === 'inProgress')
  const activeTurnId = preferred?.id || current?.id || fallback?.id || null

  return {
    ...session,
    turns: deduplicated,
    activeTurnId,
    running: activeTurnId !== null
  }
}

function updateStreamItem(
  session: ThreadSession,
  turnId: string,
  itemId: string,
  update: (previous: ThreadItem | undefined) => ThreadItem
): ThreadSession {
  const turn = ensureTurn(session, turnId)
  const previous = turn.items.find((item) => item.id === itemId)
  const updatedTurn = replaceItem(turn, update(previous))
  return syncSessionTurns(session, replaceTurn(session.turns, updatedTurn), turnId)
}

function appendIndexedDelta(values: unknown, index: number, delta: string): string[] {
  const next = [...(stringArray(values) || [])]
  while (next.length <= index) next.push('')
  next[index] = `${next[index]}${delta}`
  return next
}

function validIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function notificationUpdate(state: SessionState, notification: RpcNotification): SessionState {
  const params = record(notification.params)
  if (!params) return state
  const threadId = typeof params.threadId === 'string' ? params.threadId : null

  if (notification.method === 'thread/started' && record(params.thread)) {
    const thread = params.thread as unknown as Thread
    if (thread.ephemeral === true) {
      return {
        ...state,
        transientThreads: {
          ...state.transientThreads,
          [thread.id]: thread
        },
        sessions: {
          ...state.sessions,
          [thread.id]: state.sessions[thread.id] || emptySession()
        }
      }
    }
    return {
      ...state,
      threads: upsertThread(state.threads, thread),
      sessions: {
        ...state.sessions,
        [thread.id]: state.sessions[thread.id] || emptySession()
      }
    }
  }

  if (notification.method === 'thread/name/updated' && threadId) {
    if (typeof params.threadName !== 'string' || !params.threadName.trim()) return state
    const name = params.threadName.trim()
    return {
      ...state,
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, name } : thread
      ),
      transientThreads: state.transientThreads[threadId]
        ? {
            ...state.transientThreads,
            [threadId]: { ...state.transientThreads[threadId], name }
          }
        : state.transientThreads
    }
  }

  if (
    (notification.method === 'thread/archived' || notification.method === 'thread/deleted') &&
    threadId
  ) {
    const sessions = { ...state.sessions }
    const transientThreads = { ...state.transientThreads }
    const transient = Boolean(transientThreads[threadId])
    if (notification.method === 'thread/deleted' || transient) delete sessions[threadId]
    delete transientThreads[threadId]
    return {
      ...state,
      threads: state.threads.filter((thread) => thread.id !== threadId),
      transientThreads,
      selectedThreadId: state.selectedThreadId === threadId ? null : state.selectedThreadId,
      sessions
    }
  }

  if (notification.method === 'thread/status/changed' && threadId && record(params.status)) {
    const status = params.status as unknown as ThreadStatus
    return {
      ...state,
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, status } : thread
      ),
      transientThreads: state.transientThreads[threadId]
        ? {
            ...state.transientThreads,
            [threadId]: { ...state.transientThreads[threadId], status }
          }
        : state.transientThreads
    }
  }

  if (!threadId) return state
  const session = state.sessions[threadId] || emptySession()

  if (notification.method === 'turn/started' && record(params.turn)) {
    const incoming = params.turn as unknown as Turn
    const existing = session.turns.find((turn) => turn.id === incoming.id)
    const turn = existing ? mergeTurn(existing, incoming, 'started') : incoming
    const updated = syncSessionTurns(session, replaceTurn(session.turns, turn), turn.id)
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [threadId]: { ...updated, error: null }
      }
    }
  }

  if (
    (notification.method === 'item/started' || notification.method === 'item/completed') &&
    typeof params.turnId === 'string' &&
    record(params.item)
  ) {
    const incoming = params.item as unknown as ThreadItem
    const turn = ensureTurn(session, params.turnId)
    const existing = turn.items.find((item) => item.id === incoming.id)
    const item = existing
      ? mergeItem(existing, incoming, notification.method === 'item/completed' ? 'completed' : 'started')
      : incoming
    const updatedTurn = replaceItem(turn, item)
    const updated = syncSessionTurns(
      session,
      replaceTurn(session.turns, updatedTurn),
      updatedTurn.status === 'inProgress' ? updatedTurn.id : undefined
    )
    return {
      ...state,
      sessions: { ...state.sessions, [threadId]: updated }
    }
  }

  if (
    notification.method === 'item/agentMessage/delta' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    typeof params.delta === 'string'
  ) {
    const updated = updateStreamItem(session, params.turnId, params.itemId, (previous) => {
      const previousRecord =
        previous?.type === 'agentMessage'
          ? (previous as unknown as Record<string, unknown>)
          : {}
      const text = typeof previousRecord.text === 'string' ? previousRecord.text : ''
      return {
        ...previousRecord,
        type: 'agentMessage',
        id: params.itemId as string,
        text: `${text}${params.delta as string}`
      } as ThreadItem
    })
    return { ...state, sessions: { ...state.sessions, [threadId]: updated } }
  }

  if (
    (notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/textDelta') &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    typeof params.delta === 'string'
  ) {
    const index =
      notification.method === 'item/reasoning/summaryTextDelta'
        ? params.summaryIndex
        : params.contentIndex
    if (!validIndex(index)) return state
    const field =
      notification.method === 'item/reasoning/summaryTextDelta' ? 'summary' : 'content'
    const updated = updateStreamItem(session, params.turnId, params.itemId, (previous) => {
      const previousRecord =
        previous?.type === 'reasoning'
          ? (previous as unknown as Record<string, unknown>)
          : {}
      return {
        ...previousRecord,
        type: 'reasoning',
        id: params.itemId as string,
        summary: stringArray(previousRecord.summary) || [],
        content: stringArray(previousRecord.content) || [],
        [field]: appendIndexedDelta(previousRecord[field], index, params.delta as string)
      } as ThreadItem
    })
    return { ...state, sessions: { ...state.sessions, [threadId]: updated } }
  }

  if (
    notification.method === 'item/reasoning/summaryPartAdded' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    validIndex(params.summaryIndex)
  ) {
    const updated = updateStreamItem(session, params.turnId, params.itemId, (previous) => {
      const previousRecord =
        previous?.type === 'reasoning'
          ? (previous as unknown as Record<string, unknown>)
          : {}
      return {
        ...previousRecord,
        type: 'reasoning',
        id: params.itemId as string,
        summary: appendIndexedDelta(previousRecord.summary, params.summaryIndex as number, ''),
        content: stringArray(previousRecord.content) || []
      } as ThreadItem
    })
    return { ...state, sessions: { ...state.sessions, [threadId]: updated } }
  }

  if (
    notification.method === 'item/plan/delta' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    typeof params.delta === 'string'
  ) {
    const updated = updateStreamItem(session, params.turnId, params.itemId, (previous) => {
      const previousRecord =
        previous?.type === 'plan' ? (previous as unknown as Record<string, unknown>) : {}
      const text = typeof previousRecord.text === 'string' ? previousRecord.text : ''
      return {
        ...previousRecord,
        type: 'plan',
        id: params.itemId as string,
        text: `${text}${params.delta as string}`
      } as ThreadItem
    })
    return { ...state, sessions: { ...state.sessions, [threadId]: updated } }
  }

  if (
    notification.method === 'item/commandExecution/outputDelta' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    typeof params.delta === 'string'
  ) {
    const updated = updateStreamItem(session, params.turnId, params.itemId, (previous) => {
      const previousRecord =
        previous?.type === 'commandExecution'
          ? (previous as unknown as Record<string, unknown>)
          : {}
      const output =
        typeof previousRecord.aggregatedOutput === 'string' ? previousRecord.aggregatedOutput : ''
      return {
        ...previousRecord,
        type: 'commandExecution',
        id: params.itemId as string,
        command: typeof previousRecord.command === 'string' ? previousRecord.command : '',
        status: previousRecord.status || 'inProgress',
        aggregatedOutput: `${output}${params.delta as string}`
      } as ThreadItem
    })
    return { ...state, sessions: { ...state.sessions, [threadId]: updated } }
  }

  if (
    notification.method === 'item/fileChange/patchUpdated' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    Array.isArray(params.changes)
  ) {
    const updated = updateStreamItem(session, params.turnId, params.itemId, (previous) => {
      const previousRecord =
        previous?.type === 'fileChange'
          ? (previous as unknown as Record<string, unknown>)
          : {}
      return {
        ...previousRecord,
        type: 'fileChange',
        id: params.itemId as string,
        status: previousRecord.status || 'inProgress',
        changes: params.changes
      } as ThreadItem
    })
    return { ...state, sessions: { ...state.sessions, [threadId]: updated } }
  }

  const notificationError = record(params.error)
  if (
    notification.method === 'error' &&
    typeof params.turnId === 'string' &&
    typeof params.willRetry === 'boolean' &&
    notificationError &&
    typeof notificationError.message === 'string'
  ) {
    const turn = ensureTurn(session, params.turnId)
    const error = notificationError as unknown as TurnError
    const updatedTurn: Turn = {
      ...turn,
      status: params.willRetry ? turn.status : 'failed',
      error
    }
    const updated = syncSessionTurns(
      session,
      replaceTurn(session.turns, updatedTurn),
      params.willRetry ? updatedTurn.id : undefined
    )
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [threadId]: {
          ...updated,
          error: params.willRetry ? session.error : error.message
        }
      }
    }
  }

  if (notification.method === 'turn/completed' && record(params.turn)) {
    const incoming = params.turn as unknown as Turn
    const existing = session.turns.find((turn) => turn.id === incoming.id)
    const turn = existing ? mergeTurn(existing, incoming, 'completed') : incoming
    const updated = syncSessionTurns(session, replaceTurn(session.turns, turn))
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [threadId]: {
          ...updated,
          error: turn.error?.message || null
        }
      }
    }
  }

  return state
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'threadsLoaded':
      return { ...state, threads: normalizeThreads(action.threads), loadingThreads: false }
    case 'threadsAppended':
      return { ...state, threads: normalizeThreads([...state.threads, ...action.threads]) }
    case 'threadUpserted':
      return {
        ...state,
        threads: upsertThread(state.threads, action.thread),
        selectedThreadId: action.select ? action.thread.id : state.selectedThreadId,
        sessions: action.select
          ? {
              ...state.sessions,
              [action.thread.id]: state.sessions[action.thread.id] || emptySession()
            }
          : state.sessions
      }
    case 'threadRenamed':
      return {
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === action.threadId ? { ...thread, name: action.name } : thread
        )
      }
    case 'threadRemoved': {
      const removed = new Set(action.threadIds)
      const sessions = { ...state.sessions }
      const transientThreads = { ...state.transientThreads }
      for (const threadId of removed) delete sessions[threadId]
      for (const threadId of removed) delete transientThreads[threadId]
      return {
        ...state,
        threads: state.threads.filter((thread) => !removed.has(thread.id)),
        transientThreads,
        selectedThreadId:
          state.selectedThreadId && removed.has(state.selectedThreadId)
            ? null
            : state.selectedThreadId,
        sessions
      }
    }
    case 'modelsLoaded':
      return { ...state, models: action.models }
    case 'permissionProfilesLoaded':
      return { ...state, permissionProfiles: action.profiles }
    case 'selectThread':
      return { ...state, selectedThreadId: action.threadId }
    case 'threadHydrated': {
      const session = state.sessions[action.thread.id] || emptySession()
      const turns = removeOptimisticDuplicates(
        mergeHydratedTurns(session.turns, action.thread.turns)
      )
      const updated = syncSessionTurns(session, turns, session.activeTurnId || undefined)
      const latestError = [...updated.turns]
        .reverse()
        .find((turn) => turn.status === 'failed' && turn.error)?.error?.message
      return {
        ...state,
        selectedThreadId: action.thread.id,
        threads: upsertThread(state.threads, action.thread),
        sessions: {
          ...state.sessions,
          [action.thread.id]: {
            ...updated,
            error: updated.running ? session.error : latestError || null
          }
        }
      }
    }
    case 'transientThreadHydrated': {
      const session = state.sessions[action.thread.id] || emptySession()
      const turns = removeOptimisticDuplicates(
        mergeHydratedTurns(session.turns, action.thread.turns)
      )
      const updated = syncSessionTurns(session, turns, session.activeTurnId || undefined)
      const latestError = [...updated.turns]
        .reverse()
        .find((turn) => turn.status === 'failed' && turn.error)?.error?.message
      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== action.thread.id),
        transientThreads: {
          ...state.transientThreads,
          [action.thread.id]: action.thread
        },
        sessions: {
          ...state.sessions,
          [action.thread.id]: {
            ...updated,
            error: updated.running ? session.error : latestError || null
          }
        }
      }
    }
    case 'transientThreadRemoved': {
      if (
        !state.transientThreads[action.threadId] &&
        !state.sessions[action.threadId]
      ) {
        return state
      }
      const transientThreads = { ...state.transientThreads }
      const sessions = { ...state.sessions }
      delete transientThreads[action.threadId]
      delete sessions[action.threadId]
      return { ...state, transientThreads, sessions }
    }
    case 'threadHistoryReplaced': {
      const session = state.sessions[action.threadId] || emptySession()
      const updated = replacePersistedHistory(
        session,
        action.turns,
        action.baselineTurnIds,
        action.preserveTurnIds
      )
      const latestError = [...updated.turns]
        .reverse()
        .find((turn) => turn.status === 'failed' && turn.error)?.error?.message
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: {
            ...updated,
            error: updated.running ? session.error : latestError || null
          }
        }
      }
    }
    case 'threadHistoryPrepended': {
      const session = state.sessions[action.threadId] || emptySession()
      const updated = syncSessionTurns(
        session,
        mergeHydratedTurns(session.turns, action.turns),
        session.activeTurnId || undefined
      )
      return {
        ...state,
        sessions: { ...state.sessions, [action.threadId]: updated }
      }
    }
    case 'threadReverted': {
      const session = state.sessions[action.threadId] || emptySession()
      const targetIndex = session.turns.findIndex((turn) => turn.id === action.beforeTurnId)
      if (targetIndex < 0) return state
      const updated = syncSessionTurns(session, session.turns.slice(0, targetIndex))
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...updated, error: null }
        }
      }
    }
    case 'optimisticUserMessage': {
      const session = state.sessions[action.threadId] || emptySession()
      if (hasClientId(session.turns, action.clientId)) return state
      const turn: Turn = {
        id: `local-${action.clientId}`,
        status: 'inProgress',
        startedAt: Date.now() / 1_000,
        items: [
          {
            type: 'userMessage',
            id: `user-${action.clientId}`,
            clientId: action.clientId,
            content: action.input || [{ type: 'text', text: action.text, text_elements: [] }]
          }
        ]
      }
      const updated = syncSessionTurns(session, [...session.turns, turn], turn.id)
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...updated, error: null }
        }
      }
    }
    case 'optimisticSteer': {
      const session = state.sessions[action.threadId] || emptySession()
      if (hasClientId(session.turns, action.clientId)) return state
      const turn = session.turns.find(
        (candidate) => candidate.id === action.turnId && candidate.status === 'inProgress'
      )
      if (!turn) return state
      const updatedTurn: Turn = {
        ...turn,
        items: [
          ...turn.items,
          {
            type: 'userMessage',
            id: `local-steer-${action.clientId}`,
            clientId: action.clientId,
            content: action.input || [{ type: 'text', text: action.text, text_elements: [] }]
          }
        ]
      }
      const updated = syncSessionTurns(
        session,
        replaceTurn(session.turns, updatedTurn),
        action.turnId
      )
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...updated, error: null }
        }
      }
    }
    case 'steerAccepted': {
      const session = state.sessions[action.threadId] || emptySession()
      if (!hasClientId(session.turns, action.clientId)) return state
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...session, error: null }
        }
      }
    }
    case 'steerUnknown': {
      const session = state.sessions[action.threadId] || emptySession()
      const turn = session.turns.find((candidate) => candidate.id === action.turnId)
      if (!turn || !hasClientId([turn], action.clientId)) return state
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...session, error: action.message }
        }
      }
    }
    case 'steerFailed': {
      const session = state.sessions[action.threadId] || emptySession()
      const turn = session.turns.find((candidate) => candidate.id === action.turnId)
      if (!turn) return state
      const optimisticItemId = `local-steer-${action.clientId}`
      const updatedTurn = {
        ...turn,
        items: turn.items.filter((item) => item.id !== optimisticItemId)
      }
      const updated = syncSessionTurns(
        session,
        replaceTurn(session.turns, updatedTurn),
        session.activeTurnId || undefined
      )
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...updated, error: action.message }
        }
      }
    }
    case 'notification': {
      const next = notificationUpdate(state, action.notification)
      if (next === state) return state
      const now = Date.now()
      const sessions = { ...next.sessions }
      for (const [id, session] of Object.entries(sessions)) {
        if (session === state.sessions[id]) continue
        const previous = new Map(state.sessions[id]?.turns.map((turn) => [turn.id, turn]))
        sessions[id] = { ...session, turns: session.turns.map((turn) => {
          const prior = previous.get(turn.id)
          return prior === turn ? turn : observeTurnTiming(prior, turn, now)
        }) }
      }
      return { ...next, sessions }
    }
    case 'sessionError': {
      const session = state.sessions[action.threadId] || emptySession()
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: { ...session, error: action.message }
        }
      }
    }
    case 'turnFailed': {
      const session = state.sessions[action.threadId] || emptySession()
      const activeTurn = session.activeTurnId
        ? session.turns.find((turn) => turn.id === session.activeTurnId)
        : null
      const turns = activeTurn
        ? replaceTurn(session.turns, {
            ...activeTurn,
            status: 'failed',
            error: { message: action.message }
          })
        : session.turns
      const updated = syncSessionTurns(session, turns)
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.threadId]: {
            ...updated,
            activeTurnId: null,
            running: false,
            error: action.message
          }
        }
      }
    }
  }
}

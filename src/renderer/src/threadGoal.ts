export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export interface ThreadGoal {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  /** Unix timestamp in seconds, as returned by app-server. */
  createdAt: number
  /** Unix timestamp in seconds, as returned by app-server. */
  updatedAt: number
}

export interface ThreadGoalLifecycleState {
  /** The server's current goal. A completed goal is cleared automatically. */
  current: ThreadGoal | null
  /** Retained after clear so the final assistant action row can report completion. */
  completed: ThreadGoal | null
}

export interface ThreadGoalCompletionAnchor {
  createdAt: number
  updatedAt: number
  turnId: string | null
}

export const EMPTY_THREAD_GOAL_STATE: Readonly<ThreadGoalLifecycleState> = Object.freeze({
  current: null,
  completed: null
})

const STATUS_LABELS: Record<ThreadGoalStatus, string> = {
  active: '进行中的目标',
  paused: '已暂停的目标',
  blocked: '目标已停滞',
  usageLimited: '目标使用受限',
  budgetLimited: '目标受限',
  complete: '已达成目标'
}

const durationFormatters = new Map<string, Intl.NumberFormat>()
const compactNumberFormatters = new Map<string, Intl.NumberFormat>()

function resolvedLocale(locale?: string): string {
  if (locale?.trim()) return locale
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return document.documentElement.lang
  }
  return 'en'
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function formatDurationUnit(
  value: number,
  unit: 'day' | 'hour' | 'minute' | 'second',
  locale: string
): string {
  const key = `${locale}:${unit}`
  let formatter = durationFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'narrow'
    })
    durationFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

export function threadGoalStatusLabel(status: ThreadGoalStatus): string {
  return STATUS_LABELS[status]
}

/** Mirrors the shipped goal action: active pauses; resumable states become active. */
export function nextThreadGoalStatus(status: ThreadGoalStatus): ThreadGoalStatus | null {
  switch (status) {
    case 'active':
      return 'paused'
    case 'paused':
    case 'blocked':
    case 'usageLimited':
      return 'active'
    case 'budgetLimited':
    case 'complete':
      return null
  }
}

export function threadGoalNeedsResumeConfirmation(status: ThreadGoalStatus): boolean {
  return status === 'paused' || status === 'blocked' || status === 'usageLimited'
}

export function threadGoalAutomaticClearKey(goal: ThreadGoal): string {
  return `${goal.threadId}:${goal.createdAt}:${goal.updatedAt}`
}

export function mergeThreadGoalCompletionAnchor(
  current: ThreadGoalCompletionAnchor | null,
  goal: ThreadGoal,
  turnId: string | null | undefined
): ThreadGoalCompletionAnchor | null {
  if (goal.status !== 'complete' || turnId === undefined) return current
  const sameLifecycle = current?.createdAt === goal.createdAt &&
    current.updatedAt === goal.updatedAt
  if (sameLifecycle && current.turnId !== null && turnId === null) return current
  return { createdAt: goal.createdAt, updatedAt: goal.updatedAt, turnId }
}

export function threadGoalCompletionAnchorTurnId(
  anchor: ThreadGoalCompletionAnchor | null,
  goal: ThreadGoal | null
): string | null {
  if (!anchor || !goal || anchor.createdAt !== goal.createdAt ||
      anchor.updatedAt !== goal.updatedAt) return null
  return anchor.turnId
}

export function threadGoalMatchesCompletedAt(
  goal: ThreadGoal,
  completedAt: number | null | undefined
): boolean {
  if (completedAt === null || completedAt === undefined || !Number.isFinite(completedAt)) {
    return false
  }
  const completedAtSeconds = completedAt > 10_000_000_000
    ? Math.floor(completedAt / 1_000)
    : Math.floor(completedAt)
  return completedAtSeconds === Math.floor(goal.updatedAt)
}

export function threadGoalElapsedMs(goal: ThreadGoal, nowMs = Date.now()): number {
  const recordedMs = finiteNonNegative(goal.timeUsedSeconds) * 1_000
  if (goal.status !== 'active') return recordedMs
  const updatedAtMs = finiteNonNegative(goal.updatedAt) * 1_000
  return Math.max(0, recordedMs + finiteNonNegative(nowMs) - updatedAtMs)
}

/** Compact elapsed time used by the composer strip and completion action row. */
export function formatThreadGoalDuration(durationMs: number, locale?: string): string {
  const resolved = resolvedLocale(locale)
  const totalSeconds = Math.floor(finiteNonNegative(durationMs) / 1_000)
  if (totalSeconds < 60) return formatDurationUnit(totalSeconds, 'second', resolved)

  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor(totalSeconds / 3_600) % 24
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (days > 0) parts.push(formatDurationUnit(days, 'day', resolved))
  if (hours > 0) parts.push(formatDurationUnit(hours, 'hour', resolved))
  if (minutes > 0) parts.push(formatDurationUnit(minutes, 'minute', resolved))
  if (seconds > 0 && days === 0) parts.push(formatDurationUnit(seconds, 'second', resolved))
  return parts.join(' ') || formatDurationUnit(0, 'second', resolved)
}

export function formatThreadGoalTokenCount(value: number, locale?: string): string {
  const resolved = resolvedLocale(locale)
  let formatter = compactNumberFormatters.get(resolved)
  if (!formatter) {
    formatter = new Intl.NumberFormat(resolved, {
      notation: 'compact',
      maximumFractionDigits: 1
    })
    compactNumberFormatters.set(resolved, formatter)
  }
  return formatter.format(Math.floor(finiteNonNegative(value)))
}

export function formatThreadGoalProgress(
  goal: ThreadGoal,
  options: { nowMs?: number; locale?: string } = {}
): string {
  if (
    goal.tokenBudget !== null &&
    (goal.status === 'active' || goal.status === 'budgetLimited')
  ) {
    return `${formatThreadGoalTokenCount(goal.tokensUsed, options.locale)} / ${formatThreadGoalTokenCount(goal.tokenBudget, options.locale)}`
  }
  return formatThreadGoalDuration(
    threadGoalElapsedMs(goal, options.nowMs ?? Date.now()),
    options.locale
  )
}

export function formatThreadGoalUpdatedLabel(
  updatedAtSeconds: number,
  nowMs = Date.now(),
  _locale?: string
): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((finiteNonNegative(nowMs) - finiteNonNegative(updatedAtSeconds) * 1_000) / 1_000)
  )
  if (elapsedSeconds < 60) return '刚刚更新'
  return `${Math.floor(elapsedSeconds / 60)} 分钟前更新`
}

function newestKnownGoal(state: ThreadGoalLifecycleState, threadId: string): ThreadGoal | null {
  const candidates = [state.current, state.completed].filter(
    (goal): goal is ThreadGoal => goal?.threadId === threadId
  )
  return candidates.reduce<ThreadGoal | null>((latest, goal) => {
    if (!latest || compareThreadGoalVersion(goal, latest) > 0) return goal
    return latest
  }, null)
}

function compareThreadGoalVersion(left: ThreadGoal, right: ThreadGoal): number {
  // `updatedAt` only has second precision. A newly-created goal can therefore
  // share the completion timestamp of the previous goal, so lifecycle identity
  // (`createdAt`) has to win before comparing mutations within one lifecycle.
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt
  if (left.status === right.status) return 0
  if (left.status === 'complete') return 1
  if (right.status === 'complete') return -1
  return 0
}

function sameThreadGoal(left: ThreadGoal | null, right: ThreadGoal): boolean {
  return Boolean(
    left &&
    left.threadId === right.threadId &&
    left.objective === right.objective &&
    left.status === right.status &&
    left.tokenBudget === right.tokenBudget &&
    left.tokensUsed === right.tokensUsed &&
    left.timeUsedSeconds === right.timeUsedSeconds &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  )
}

/**
 * Merge a set/get response or `thread/goal/updated` notification without allowing
 * an older response to overwrite a newer notification. Completion is retained
 * separately because the server immediately clears the current goal afterwards.
 */
export function mergeThreadGoalState(
  state: ThreadGoalLifecycleState,
  incoming: ThreadGoal
): ThreadGoalLifecycleState {
  const newest = newestKnownGoal(state, incoming.threadId)
  if (newest && compareThreadGoalVersion(incoming, newest) < 0) return state

  if (incoming.status === 'complete') {
    if (sameThreadGoal(state.completed, incoming)) return state
    return { current: incoming, completed: incoming }
  }
  if (sameThreadGoal(state.current, incoming) && state.completed === null) return state
  return { current: incoming, completed: null }
}

/** Apply `thread/goal/cleared`, retaining the completion badge payload. */
export function clearCurrentThreadGoal(
  state: ThreadGoalLifecycleState,
  threadId?: string
): ThreadGoalLifecycleState {
  if (!state.current) return state
  if (threadId && state.current.threadId !== threadId) return state
  return { ...state, current: null }
}

/** Apply a get response; request-generation guards remain the caller's responsibility. */
export function hydrateThreadGoalState(
  state: ThreadGoalLifecycleState,
  goal: ThreadGoal | null
): ThreadGoalLifecycleState {
  return goal ? mergeThreadGoalState(state, goal) : clearCurrentThreadGoal(state)
}

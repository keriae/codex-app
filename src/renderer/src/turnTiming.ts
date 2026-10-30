import type { Turn } from './protocol'

export function turnTimestampMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return value < 100_000_000_000 ? value * 1_000 : value
}

export function hasVisibleFinalAnswer(turn: Turn): boolean {
  return turn.items.some((item) => item.type === 'agentMessage' && item.phase === 'final_answer' && Boolean(item.text?.trim()))
}

/** Work ends when the answer starts, even while the answer is still streaming. */
export function turnWorkDuration(turn: Turn, active: boolean, now: number, fallbackStartedAt: number): number {
  const started = turnTimestampMs(turn.startedAt)
  const completed = turn.activityCompletedAtMs ?? turnTimestampMs(turn.completedAt)
  if (completed != null && started != null) return Math.max(0, completed - started)
  const duration = Math.max(0, turn.durationMs || 0)
  if (!active || hasVisibleFinalAnswer(turn)) return duration
  return Math.max(duration, now - (started ?? fallbackStartedAt), 0)
}

/** Called only for notifications, never for hydration of historical turns. */
export function observeTurnTiming(previous: Turn | undefined, turn: Turn, now: number): Turn {
  let startedAt = turn.startedAt ?? previous?.startedAt
  let completedAt = turn.completedAt ?? previous?.completedAt
  let activityCompletedAtMs = previous?.activityCompletedAtMs ?? turn.activityCompletedAtMs
  const wasLive = previous?.status === 'inProgress'
  const final = hasVisibleFinalAnswer(turn)
  if (startedAt == null && turn.status === 'inProgress' && !final) startedAt = now
  // A late terminal snapshot or a newly loaded final answer has no observed
  // live boundary. Keep the server duration instead of assigning today's time.
  if (wasLive && previous && !hasVisibleFinalAnswer(previous)) {
    if (final && activityCompletedAtMs == null) activityCompletedAtMs = now
    if (turn.status !== 'inProgress' && completedAt == null) completedAt = now
  }
  if (startedAt === turn.startedAt && completedAt === turn.completedAt && activityCompletedAtMs === turn.activityCompletedAtMs) return turn
  return { ...turn, startedAt, completedAt, activityCompletedAtMs }
}

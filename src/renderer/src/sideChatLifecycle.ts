import type { TurnStatus } from './protocol'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function forkTurnAction(
  turnId: string,
  status: TurnStatus,
  onFork: ((turnId: string) => void) | undefined
): (() => void) | undefined {
  if (!onFork || status === 'inProgress') return undefined
  return () => onFork(turnId)
}

export function interruptibleTurnId(turnId: string | null | undefined): string | null {
  return turnId && !turnId.startsWith('local-') ? turnId : null
}

export function shouldRetryForkWithoutPredictionMode(error: unknown): boolean {
  const value = record(error)
  const code = value?.code
  if (code === -32601 || code === -32602) return true

  const message =
    error instanceof Error
      ? error.message
      : typeof value?.message === 'string'
        ? value.message
        : typeof error === 'string'
          ? error
          : ''
  const normalized = message.toLowerCase()

  if (/invalid\s+(params?|parameters?)/.test(normalized)) return true
  const referencesPredictionMode = /experimental[_\s-]?prediction[_\s-]?mode/.test(
    normalized
  )
  return (
    referencesPredictionMode &&
    (/(unknown|unrecognized|unsupported|invalid|unexpected)\s+(field|parameter|property|key|option)/.test(
      normalized
    ) || /(?:is\s+)?(?:not\s+supported|unsupported)/.test(normalized))
  )
}

export interface PendingSideChatStart {
  threadId: string
  generation: number
  interruptRequested: boolean
  interruptSent: boolean
}

export function requestPendingInterrupt(
  pending: PendingSideChatStart | null,
  threadId: string
): PendingSideChatStart | null {
  if (!pending || pending.threadId !== threadId) return pending
  pending.interruptRequested = true
  return pending
}

export function claimPendingInterruptTurnId(
  pending: PendingSideChatStart,
  turnId: string | null | undefined
): string | null {
  const realTurnId = interruptibleTurnId(turnId)
  if (!pending.interruptRequested || pending.interruptSent || !realTurnId) return null
  pending.interruptSent = true
  return realTurnId
}

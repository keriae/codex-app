import { describe, expect, it } from 'vitest'
import {
  claimPendingInterruptTurnId,
  forkTurnAction,
  interruptibleTurnId,
  requestPendingInterrupt,
  shouldRetryForkWithoutPredictionMode,
  type PendingSideChatStart
} from './sideChatLifecycle'

describe('side chat lifecycle', () => {
  it('offers a turn-aware fork only when the surface supplies a handler', () => {
    const forkedTurnIds: string[] = []
    const onFork = (turnId: string): void => {
      forkedTurnIds.push(turnId)
    }

    expect(forkTurnAction('turn-side', 'completed', undefined)).toBeUndefined()
    expect(forkTurnAction('turn-running', 'inProgress', onFork)).toBeUndefined()

    const action = forkTurnAction('turn-main', 'completed', onFork)
    expect(action).toBeTypeOf('function')
    action?.()
    expect(forkedTurnIds).toEqual(['turn-main'])
  })

  it('never treats an optimistic local turn id as interruptible', () => {
    expect(interruptibleTurnId('local-client-1')).toBeNull()
    expect(interruptibleTurnId(null)).toBeNull()
    expect(interruptibleTurnId('turn-1')).toBe('turn-1')
  })

  it('remembers a stop request while turn/start is unresolved', () => {
    const pending: PendingSideChatStart = {
      threadId: 'side-1',
      generation: 3,
      interruptRequested: false,
      interruptSent: false
    }

    expect(requestPendingInterrupt(pending, 'side-1')).toBe(pending)
    expect(pending.interruptRequested).toBe(true)
    expect(claimPendingInterruptTurnId(pending, 'local-client-1')).toBeNull()
    expect(pending.interruptSent).toBe(false)
    expect(claimPendingInterruptTurnId(pending, 'turn-1')).toBe('turn-1')
    expect(pending.interruptSent).toBe(true)
    expect(claimPendingInterruptTurnId(pending, 'turn-1')).toBeNull()
    requestPendingInterrupt(pending, 'another-thread')
    expect(pending.interruptRequested).toBe(true)
  })

  it('falls back only for explicit prediction-field compatibility errors', () => {
    expect(shouldRetryForkWithoutPredictionMode({ code: -32602 })).toBe(true)
    expect(
      shouldRetryForkWithoutPredictionMode(
        new Error('Invalid params: unknown field `experimentalPredictionMode`')
      )
    ).toBe(true)
    expect(
      shouldRetryForkWithoutPredictionMode(
        new Error('unsupported parameter experimentalPredictionMode')
      )
    ).toBe(true)
    expect(
      shouldRetryForkWithoutPredictionMode(
        new Error('experimental_prediction_mode is not supported by this server')
      )
    ).toBe(true)
  })

  it('does not retry unknown transport or server failures', () => {
    expect(shouldRetryForkWithoutPredictionMode(new Error('WebSocket connection closed'))).toBe(
      false
    )
    expect(shouldRetryForkWithoutPredictionMode(new Error('thread/fork timed out'))).toBe(false)
    expect(shouldRetryForkWithoutPredictionMode(new Error('Internal server error'))).toBe(false)
    expect(shouldRetryForkWithoutPredictionMode(new Error('unsupported transport encoding'))).toBe(
      false
    )
  })
})

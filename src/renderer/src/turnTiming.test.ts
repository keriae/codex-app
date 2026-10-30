import { describe, expect, it, vi } from 'vitest'
import { initialSessionState, sessionReducer } from './state/sessionReducer'
import type { Turn } from './protocol'
import { hasVisibleFinalAnswer, observeTurnTiming, turnTimestampMs, turnWorkDuration } from './turnTiming'
const now = 1_800_000_000_000
const live = (): Turn => ({ id: 'turn', status: 'inProgress', startedAt: (now - 10_000) / 1000, items: [] })
const final = (text = 'done'): Turn['items'][number] => ({ type: 'agentMessage', id: 'answer', phase: 'final_answer', text })
describe('observed work timing', () => {
  it('accepts seconds and milliseconds without confusing missing or invalid values', () => {
    expect(turnTimestampMs(now / 1000)).toBe(now)
    expect(turnTimestampMs(now)).toBe(now)
    expect(turnTimestampMs(NaN)).toBeNull()
    expect(turnTimestampMs(null)).toBeNull()
  })
  it('freezes on the first visible final delta and survives completion snapshots', () => {
    const before = live()
    const empty = observeTurnTiming(before, { ...before, items: [final('')] }, now)
    expect(hasVisibleFinalAnswer(empty)).toBe(false)
    const answer = observeTurnTiming(empty, { ...empty, items: [final()] }, now + 1000)
    expect(turnWorkDuration(answer, true, now + 40_000, now)).toBe(11_000)
    const completed = observeTurnTiming(answer, { ...answer, status: 'completed', completedAt: (now + 20_000) / 1000, durationMs: 30_000 }, now + 21_000)
    expect(turnWorkDuration(completed, false, now + 50_000, now)).toBe(11_000)
  })
  it('never invents timing for a late historical terminal notification', () => {
    const history: Turn = { id: 'old', status: 'completed', durationMs: 12_000, items: [final()] }
    expect(observeTurnTiming(undefined, history, now)).toEqual(history)
    expect(turnWorkDuration(history, false, now, now)).toBe(12_000)
  })
  it('fills missing live boundaries, including a local interrupt', () => {
    const start = observeTurnTiming(undefined, { id: 'new', status: 'inProgress', items: [] }, now)
    expect(start.startedAt).toBe(now)
    const stopped = observeTurnTiming(start, { ...start, status: 'interrupted' }, now + 3000)
    expect(turnWorkDuration(stopped, false, now + 9000, now)).toBe(3000)
  })
  it('does not treat commentary as the final answer', () => {
    const turn = { ...live(), items: [{ ...final(), phase: 'commentary' as const }] }
    expect(hasVisibleFinalAnswer(turn)).toBe(false)
    expect(turnWorkDuration(turn, true, now, now)).toBe(10_000)
  })
})


describe('notification timing through the session reducer', () => {
  it('keeps the first nonempty final boundary through deltas and terminal snapshots', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      let state = initialSessionState
      const notify = (method: string, params: Record<string, unknown>) => {
        state = sessionReducer(state, { type: 'notification', notification: { method, params } })
      }
      notify('turn/started', { threadId: 'fixture', turn: { id: 'turn', status: 'inProgress', startedAt: now / 1000, items: [] } })
      clock.mockReturnValue(now + 3000)
      notify('item/started', { threadId: 'fixture', turnId: 'turn', item: final('') })
      expect(state.sessions.fixture.turns[0].activityCompletedAtMs).toBeUndefined()
      clock.mockReturnValue(now + 5000)
      notify('item/agentMessage/delta', { threadId: 'fixture', turnId: 'turn', itemId: 'answer', delta: 'Done' })
      const frozen = state.sessions.fixture.turns[0]
      expect(frozen.activityCompletedAtMs).toBe(now + 5000)
      clock.mockReturnValue(now + 12_000)
      notify('item/agentMessage/delta', { threadId: 'fixture', turnId: 'turn', itemId: 'answer', delta: '.' })
      notify('turn/completed', { threadId: 'fixture', turn: { id: 'turn', status: 'completed', durationMs: 12_000, items: [final('Done.')] } })
      expect(turnWorkDuration(state.sessions.fixture.turns[0], false, now + 30_000, now)).toBe(5000)
      expect(state.sessions.fixture.turns[0].items[0]).toMatchObject({ text: 'Done.' })
    } finally { clock.mockRestore() }
  })
  it('keeps a late terminal duration when no live turn was observed', () => {
    const state = sessionReducer(initialSessionState, { type: 'notification', notification: {
      method: 'turn/completed', params: { threadId: 'history', turn: { id: 'old', status: 'completed', durationMs: 42_000, items: [final()] } }
    } })
    const turn = state.sessions.history.turns[0]
    expect(turn.startedAt).toBeUndefined()
    expect(turn.activityCompletedAtMs).toBeUndefined()
    expect(turnWorkDuration(turn, false, now, now)).toBe(42_000)
  })
})

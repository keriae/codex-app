import { describe, expect, it, vi } from 'vitest'
import { deliverScheduledTaskRun, scheduledTaskRunnerWindow } from './scheduledTaskWindowRouting'

interface TestWindow {
  name: string
  destroyed?: boolean
  isDestroyed(): boolean
}

function window(name: string, destroyed = false): TestWindow {
  return { name, destroyed, isDestroyed() { return Boolean(this.destroyed) } }
}

describe('scheduled task window routing', () => {
  it('always selects the live primary window as the single run consumer', () => {
    const primary = window('primary')
    const secondary = window('secondary')
    const send = vi.fn()

    expect(deliverScheduledTaskRun(primary, new Set([primary, secondary]), {runId: 'run-1'}, send)).toBe(primary)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(primary, {runId: 'run-1'})
  })

  it('falls back deterministically when the primary is gone or destroyed', () => {
    const destroyedPrimary = window('primary', true)
    const first = window('first')
    const second = window('second')

    expect(scheduledTaskRunnerWindow(destroyedPrimary, [destroyedPrimary, first, second])).toBe(first)
    expect(scheduledTaskRunnerWindow(null, [first, second])).toBe(first)
    expect(scheduledTaskRunnerWindow(window('detached'), [first, second])).toBe(first)
  })

  it('does not deliver when no live managed window exists', () => {
    const destroyed = window('destroyed', true)
    const send = vi.fn()

    expect(deliverScheduledTaskRun(destroyed, [destroyed], {runId: 'run-2'}, send)).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})

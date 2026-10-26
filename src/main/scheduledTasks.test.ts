import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduledTaskDefinition } from '../shared/api'
import {
  nextScheduledTaskRun,
  normalizeScheduledTaskDefinition,
  ScheduledTaskService
} from './scheduledTasks'

const directories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'codex-scheduled-tasks-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime()
}

function task(overrides: Partial<ScheduledTaskDefinition> = {}): ScheduledTaskDefinition {
  return {
    id: 'task-one',
    title: 'Daily report',
    prompt: 'Prepare the daily report',
    frequency: 'daily',
    time: '09:00',
    status: 'active',
    notification: 'important',
    newChatEachRun: true,
    model: 'GPT-5.6 Terra',
    effort: '中',
    createdAt: local(2026, 0, 5, 8),
    updatedAt: local(2026, 0, 5, 8),
    ...overrides
  }
}

describe('scheduled task calendar', () => {
  it('uses local wall-clock time and skips weekends', () => {
    const daily = task()
    expect(nextScheduledTaskRun(daily, local(2026, 0, 5, 8))).toBe(local(2026, 0, 5, 9))
    expect(nextScheduledTaskRun(daily, local(2026, 0, 5, 9))).toBe(local(2026, 0, 6, 9))

    const weekdays = task({ frequency: 'weekdays' })
    expect(nextScheduledTaskRun(weekdays, local(2026, 0, 9, 9))).toBe(local(2026, 0, 12, 9))
  })

  it('anchors weekly and custom schedules to the creation week', () => {
    const weekly = task({ frequency: 'weekly' })
    expect(nextScheduledTaskRun(weekly, local(2026, 0, 6, 10))).toBe(local(2026, 0, 12, 9))

    const custom = task({
      frequency: 'custom',
      customUnit: 'week',
      customInterval: 2,
      customWeekdays: [1, 3]
    })
    expect(nextScheduledTaskRun(custom, local(2026, 0, 7, 10))).toBe(local(2026, 0, 19, 9))
    expect(nextScheduledTaskRun(custom, local(2026, 0, 19, 9))).toBe(local(2026, 0, 21, 9))
  })

  it('validates custom schedule data and fifteen-minute time values', () => {
    expect(() => normalizeScheduledTaskDefinition(task({ time: '09:10' }))).toThrow('15-minute')
    expect(() => normalizeScheduledTaskDefinition(task({
      frequency: 'custom', customUnit: 'week', customInterval: 0, customWeekdays: [1]
    }))).toThrow('between 1 and 12')
    expect(() => normalizeScheduledTaskDefinition(task({
      frequency: 'custom', customUnit: 'week', customInterval: 1, customWeekdays: []
    }))).toThrow('weekdays')
  })
})

describe('ScheduledTaskService', () => {
  it('persists tasks in the replica profile and restores their next run', () => {
    const directory = temporaryDirectory()
    let now = local(2026, 0, 5, 8)
    const service = new ScheduledTaskService(directory, { now: () => now })
    const saved = service.save(task())
    expect(saved.nextRunAt).toBe(local(2026, 0, 5, 9))
    expect(JSON.parse(readFileSync(service.filePath, 'utf8')).version).toBe(1)

    now = local(2026, 0, 5, 8, 30)
    const restored = new ScheduledTaskService(directory, { now: () => now })
    expect(restored.list()).toEqual([saved])
  })

  it('queues one durable run, advances the schedule, and acknowledges it', () => {
    const directory = temporaryDirectory()
    let now = local(2026, 0, 5, 8)
    const service = new ScheduledTaskService(directory, { now: () => now })
    service.save(task())
    const seen: string[] = []
    service.onRun((run) => seen.push(run.runId))

    now = local(2026, 0, 5, 9)
    const [run] = service.tick()
    expect(run).toMatchObject({ taskId: 'task-one', scheduledFor: now, prompt: 'Prepare the daily report' })
    expect(seen).toEqual([run.runId])
    expect(service.listPendingRuns()).toEqual([run])
    expect(service.list()[0]).toMatchObject({ lastRunAt: now, nextRunAt: local(2026, 0, 6, 9) })

    service.acknowledgeRun(run.runId)
    expect(service.listPendingRuns()).toEqual([])
    expect(new ScheduledTaskService(directory).listPendingRuns()).toEqual([])
  })

  it('does not build a backlog after sleep and supports pause/resume and manual runs', () => {
    const directory = temporaryDirectory()
    let now = local(2026, 0, 5, 8)
    const service = new ScheduledTaskService(directory, { now: () => now })
    service.save(task())
    service.setStatus('task-one', 'paused')
    expect(service.list()[0].nextRunAt).toBeNull()

    now = local(2026, 0, 12, 8)
    service.setStatus('task-one', 'active')
    expect(service.list()[0].nextRunAt).toBe(local(2026, 0, 12, 9))
    now = local(2026, 0, 20, 12)
    expect(service.tick()).toHaveLength(1)
    expect(service.list()[0].nextRunAt).toBe(local(2026, 0, 21, 9))

    const manual = service.runNow('task-one')
    expect(manual.scheduledFor).toBe(now)
    expect(service.listPendingRuns()).toHaveLength(2)
  })

  it('deletes pending executions together with their task', () => {
    const directory = temporaryDirectory()
    const now = local(2026, 0, 5, 8)
    const service = new ScheduledTaskService(directory, { now: () => now })
    service.save(task())
    service.runNow('task-one')
    service.delete('task-one')
    expect(service.list()).toEqual([])
    expect(service.listPendingRuns()).toEqual([])
  })

  it('emits a newly due run once when starting the scheduler', () => {
    const directory = temporaryDirectory()
    let now = local(2026, 0, 5, 8)
    const service = new ScheduledTaskService(directory, {
      now: () => now,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined
    })
    service.save(task())
    const seen: string[] = []
    service.onRun((run) => seen.push(run.runId))

    now = local(2026, 0, 5, 9)
    service.start()

    expect(service.listPendingRuns()).toHaveLength(1)
    expect(seen).toEqual([service.listPendingRuns()[0].runId])
  })

  it('replays a durable pending run once after restart without requeueing its occurrence', () => {
    const directory = temporaryDirectory()
    let now = local(2026, 0, 5, 8)
    const timerOptions = {
      now: () => now,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined
    }
    const initial = new ScheduledTaskService(directory, timerOptions)
    initial.save(task())
    now = local(2026, 0, 5, 9)
    const [pending] = initial.tick()

    const restored = new ScheduledTaskService(directory, timerOptions)
    const seen: string[] = []
    restored.onRun((run) => seen.push(run.runId))
    restored.start()

    expect(restored.listPendingRuns()).toEqual([pending])
    expect(seen).toEqual([pending.runId])
    expect(restored.list()[0].nextRunAt).toBe(local(2026, 0, 6, 9))
  })
})

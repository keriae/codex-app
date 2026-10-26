import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  ScheduledTaskDefinition,
  ScheduledTaskCustomUnit,
  ScheduledTaskFrequency,
  ScheduledTaskRunRequest,
  ScheduledTaskStatus
} from '../shared/api'

const STORE_VERSION = 1
const MAX_TASKS = 1_024
const MAX_PENDING_RUNS = 1_024
const MAX_TEXT = 200_000
const MAX_SHORT_TEXT = 512
const MAX_TIMER_DELAY_MS = 60_000
const MAX_SEARCH_DAYS = 366 * 12
const DAY_MS = 86_400_000

interface ScheduledTasksSnapshot {
  version: 1
  tasks: ScheduledTaskDefinition[]
  pendingRuns: ScheduledTaskRunRequest[]
}

interface ScheduledTaskTimerOptions {
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  maxTimerDelayMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value: unknown, label: string, maximum = MAX_SHORT_TEXT): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const text = value.trim()
  if (!text || text.length > maximum || text.includes('\0')) throw new Error(`${label} is invalid`)
  return text
}

function optionalExecutionPath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 4_096 || value.includes('\0') || /[\r\n]/u.test(value) || !isAbsolute(value)) {
    throw new Error('Scheduled task working directory is invalid')
  }
  return value
}

function optionalHostId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error('Scheduled task host is invalid')
  }
  return value
}

function finiteTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} is invalid`)
  return Math.floor(value)
}

function optionalTimestamp(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return finiteTimestamp(value, label)
}

export function parseScheduledTaskTime(value: unknown): { hour: number; minute: number } {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/u.test(value)) {
    throw new Error('Scheduled task time must use a 15-minute HH:mm value')
  }
  return { hour: Number(value.slice(0, 2)), minute: Number(value.slice(3)) }
}

function frequency(value: unknown): ScheduledTaskFrequency {
  if (value !== 'daily' && value !== 'weekdays' && value !== 'weekly' && value !== 'custom') {
    throw new Error('Scheduled task frequency is invalid')
  }
  return value
}

function status(value: unknown): ScheduledTaskStatus {
  if (value !== 'active' && value !== 'paused' && value !== 'completed') {
    throw new Error('Scheduled task status is invalid')
  }
  return value
}

function customUnit(value: unknown, taskFrequency: ScheduledTaskFrequency): ScheduledTaskCustomUnit | undefined {
  if (taskFrequency !== 'custom') return undefined
  if (value === undefined) return 'week'
  if (value !== 'day' && value !== 'week' && value !== 'month') {
    throw new Error('Custom scheduled task unit is invalid')
  }
  return value
}

function customInterval(value: unknown, taskFrequency: ScheduledTaskFrequency): number | undefined {
  if (taskFrequency !== 'custom') return undefined
  const interval = value === undefined ? 1 : value
  if (!Number.isSafeInteger(interval) || (interval as number) < 1 || (interval as number) > 12) {
    throw new Error('Custom scheduled task interval must be between 1 and 12')
  }
  return interval as number
}

function customWeekdays(value: unknown, taskFrequency: ScheduledTaskFrequency, createdAt: number): number[] | undefined {
  if (taskFrequency !== 'custom') return undefined
  const createdWeekday = new Date(createdAt).getDay()
  const fallback = createdWeekday === 0 ? 7 : createdWeekday
  const values = value === undefined ? [fallback] : value
  if (!Array.isArray(values) || values.length === 0 || values.length > 7 ||
      values.some((day) => !Number.isSafeInteger(day) || day < 1 || day > 7)) {
    throw new Error('Custom scheduled task weekdays are invalid')
  }
  return [...new Set(values as number[])].sort((left, right) => left - right)
}

export function normalizeScheduledTaskDefinition(value: unknown): ScheduledTaskDefinition {
  if (!isRecord(value)) throw new Error('Scheduled task must be an object')
  const id = boundedText(value.id, 'Scheduled task ID', 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new Error('Scheduled task ID is invalid')
  const createdAt = finiteTimestamp(value.createdAt, 'Scheduled task creation time')
  const updatedAt = finiteTimestamp(value.updatedAt, 'Scheduled task update time')
  const taskFrequency = frequency(value.frequency)
  const taskStatus = status(value.status)
  const time = boundedText(value.time, 'Scheduled task time', 5)
  parseScheduledTaskTime(time)
  const notification = value.notification === 'failed' ? 'failed' : value.notification === 'important' ? 'important' : null
  if (!notification) throw new Error('Scheduled task notification policy is invalid')
  if (typeof value.newChatEachRun !== 'boolean') throw new Error('Scheduled task chat policy is invalid')

  const normalized: ScheduledTaskDefinition = {
    id,
    title: boundedText(value.title, 'Scheduled task title'),
    prompt: boundedText(value.prompt, 'Scheduled task prompt', MAX_TEXT),
    frequency: taskFrequency,
    time,
    status: taskStatus,
    notification,
    newChatEachRun: value.newChatEachRun,
    model: boundedText(value.model, 'Scheduled task model'),
    effort: boundedText(value.effort, 'Scheduled task effort', 64),
    createdAt,
    updatedAt
  }
  const unit = customUnit(value.customUnit, taskFrequency)
  const interval = customInterval(value.customInterval, taskFrequency)
  const weekdays = customWeekdays(value.customWeekdays, taskFrequency, createdAt)
  const cwd = optionalExecutionPath(value.cwd)
  const hostId = optionalHostId(value.hostId)
  const lastRunAt = optionalTimestamp(value.lastRunAt, 'Scheduled task last run')
  const nextRunAt = optionalTimestamp(value.nextRunAt, 'Scheduled task next run')
  if (unit !== undefined) normalized.customUnit = unit
  if (interval !== undefined) normalized.customInterval = interval
  if (weekdays !== undefined) normalized.customWeekdays = weekdays
  if (cwd !== undefined) normalized.cwd = cwd
  if (hostId !== undefined) normalized.hostId = hostId
  if (lastRunAt !== undefined) normalized.lastRunAt = lastRunAt
  if (nextRunAt !== undefined) normalized.nextRunAt = nextRunAt
  if (value.lastThreadId !== undefined) normalized.lastThreadId = boundedText(value.lastThreadId, 'Scheduled task thread ID', 256)
  return normalized
}

function calendarDaySerial(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

function localCandidate(day: Date, hour: number, minute: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).getTime()
}

function eligibleDay(task: ScheduledTaskDefinition, day: Date): boolean {
  const weekday = day.getDay()
  if (task.frequency === 'daily') return true
  if (task.frequency === 'weekdays') return weekday >= 1 && weekday <= 5
  if (task.frequency === 'weekly') return weekday === new Date(task.createdAt).getDay()
  const rendererWeekday = weekday === 0 ? 7 : weekday
  const anchor = new Date(task.createdAt)
  const anchorRendererWeekday = anchor.getDay() === 0 ? 7 : anchor.getDay()
  const weekdays = task.customWeekdays?.length ? task.customWeekdays : [anchorRendererWeekday]
  if (!weekdays.includes(rendererWeekday)) return false
  const interval = task.customInterval ?? 1
  const unit = task.customUnit ?? 'week'
  if (unit === 'day') {
    const elapsedDays = calendarDaySerial(day) - calendarDaySerial(anchor)
    return elapsedDays >= 0 && elapsedDays % interval === 0
  }
  if (unit === 'month') {
    const elapsedMonths = (day.getFullYear() - anchor.getFullYear()) * 12 + day.getMonth() - anchor.getMonth()
    return elapsedMonths >= 0 && elapsedMonths % interval === 0
  }
  const anchorWeek = calendarDaySerial(anchor) - anchor.getDay()
  const candidateWeek = calendarDaySerial(day) - weekday
  const elapsedWeeks = Math.floor((candidateWeek - anchorWeek) / 7)
  return elapsedWeeks >= 0 && elapsedWeeks % interval === 0
}

/** Return the first local wall-clock occurrence strictly after `afterMs`. */
export function nextScheduledTaskRun(task: ScheduledTaskDefinition, afterMs: number): number | null {
  if (!Number.isFinite(afterMs) || afterMs < 0) throw new Error('Scheduled task search time is invalid')
  const { hour, minute } = parseScheduledTaskTime(task.time)
  const day = new Date(afterMs)
  day.setHours(0, 0, 0, 0)
  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const candidateDay = new Date(day)
    candidateDay.setDate(day.getDate() + offset)
    if (!eligibleDay(task, candidateDay)) continue
    const candidate = localCandidate(candidateDay, hour, minute)
    if (candidate > afterMs) return candidate
  }
  return null
}

function normalizePendingRun(value: unknown): ScheduledTaskRunRequest | null {
  if (!isRecord(value)) return null
  try {
    if (typeof value.newChatEachRun !== 'boolean') throw new Error('Invalid chat policy')
    const run: ScheduledTaskRunRequest = {
      runId: boundedText(value.runId, 'Scheduled run ID', 128),
      taskId: boundedText(value.taskId, 'Scheduled run task ID', 128),
      title: boundedText(value.title, 'Scheduled run title'),
      prompt: boundedText(value.prompt, 'Scheduled run prompt', MAX_TEXT),
      notification: value.notification === 'failed' ? 'failed' : value.notification === 'important' ? 'important' : (() => { throw new Error('Invalid notification') })(),
      newChatEachRun: value.newChatEachRun,
      model: boundedText(value.model, 'Scheduled run model'),
      effort: boundedText(value.effort, 'Scheduled run effort', 64),
      origin: value.origin === 'manual' ? 'manual' : value.origin === 'scheduled' ? 'scheduled' : (() => { throw new Error('Invalid origin') })(),
      scheduledFor: finiteTimestamp(value.scheduledFor, 'Scheduled run time'),
      createdAt: finiteTimestamp(value.createdAt, 'Scheduled run creation time')
    }
    const cwd = optionalExecutionPath(value.cwd)
    const hostId = optionalHostId(value.hostId)
    const threadId = value.threadId === undefined ? undefined : boundedText(value.threadId, 'Scheduled run thread ID', 256)
    if (cwd !== undefined) run.cwd = cwd
    if (hostId !== undefined) run.hostId = hostId
    if (threadId !== undefined) run.threadId = threadId
    return run
  } catch {
    return null
  }
}

function copyTask(task: ScheduledTaskDefinition): ScheduledTaskDefinition {
  return {
    ...task,
    ...(task.customWeekdays ? { customWeekdays: [...task.customWeekdays] } : {})
  }
}

function copyRun(run: ScheduledTaskRunRequest): ScheduledTaskRunRequest {
  return { ...run }
}

function runRequest(
  task: ScheduledTaskDefinition,
  scheduledFor: number,
  createdAt: number,
  origin: ScheduledTaskRunRequest['origin']
): ScheduledTaskRunRequest {
  return {
    runId: randomUUID(),
    taskId: task.id,
    title: task.title,
    prompt: task.prompt,
    notification: task.notification,
    newChatEachRun: task.newChatEachRun,
    model: task.model,
    effort: task.effort,
    origin,
    ...(task.cwd ? { cwd: task.cwd } : {}),
    ...(task.hostId ? { hostId: task.hostId } : {}),
    ...(!task.newChatEachRun && task.lastThreadId ? { threadId: task.lastThreadId } : {}),
    scheduledFor,
    createdAt
  }
}

export class ScheduledTaskService {
  readonly filePath: string
  private tasks = new Map<string, ScheduledTaskDefinition>()
  private pendingRuns = new Map<string, ScheduledTaskRunRequest>()
  private runListeners = new Set<(run: ScheduledTaskRunRequest) => void>()
  private changeListeners = new Set<(tasks: ScheduledTaskDefinition[]) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  private readonly maxTimerDelayMs: number

  constructor(userDataDirectory: string, options: ScheduledTaskTimerOptions = {}) {
    this.filePath = join(userDataDirectory, 'scheduled-tasks.json')
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.maxTimerDelayMs = Math.max(250, options.maxTimerDelayMs ?? MAX_TIMER_DELAY_MS)
    this.load()
  }

  list(): ScheduledTaskDefinition[] {
    return [...this.tasks.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .map(copyTask)
  }

  listPendingRuns(): ScheduledTaskRunRequest[] {
    return [...this.pendingRuns.values()]
      .sort((left, right) => left.createdAt - right.createdAt || left.runId.localeCompare(right.runId))
      .map(copyRun)
  }

  save(value: unknown): ScheduledTaskDefinition {
    const incoming = normalizeScheduledTaskDefinition(value)
    const previous = this.tasks.get(incoming.id)
    if (!previous && this.tasks.size >= MAX_TASKS) throw new Error('Too many scheduled tasks')
    const now = this.now()
    const task: ScheduledTaskDefinition = {
      ...incoming,
      createdAt: previous?.createdAt ?? incoming.createdAt,
      lastRunAt: previous?.lastRunAt ?? incoming.lastRunAt ?? null,
      nextRunAt: incoming.status === 'active' ? nextScheduledTaskRun(incoming, now) : null
    }
    this.tasks.set(task.id, task)
    this.commit()
    this.emitChange()
    this.schedule()
    return copyTask(task)
  }

  delete(id: unknown): void {
    const taskId = boundedText(id, 'Scheduled task ID', 128)
    if (!this.tasks.delete(taskId)) return
    for (const [runId, run] of this.pendingRuns) {
      if (run.taskId === taskId) this.pendingRuns.delete(runId)
    }
    this.commit()
    this.emitChange()
    this.schedule()
  }

  setStatus(id: unknown, value: unknown): ScheduledTaskDefinition {
    const taskId = boundedText(id, 'Scheduled task ID', 128)
    const taskStatus = status(value)
    const previous = this.tasks.get(taskId)
    if (!previous) throw new Error(`Scheduled task ${taskId} does not exist`)
    const now = this.now()
    const task: ScheduledTaskDefinition = {
      ...previous,
      status: taskStatus,
      updatedAt: now,
      nextRunAt: taskStatus === 'active' ? nextScheduledTaskRun(previous, now) : null
    }
    this.tasks.set(taskId, task)
    this.commit()
    this.emitChange()
    this.schedule()
    return copyTask(task)
  }

  runNow(id: unknown): ScheduledTaskRunRequest {
    const taskId = boundedText(id, 'Scheduled task ID', 128)
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Scheduled task ${taskId} does not exist`)
    if (task.status === 'completed') throw new Error('Completed scheduled tasks cannot be run')
    return this.enqueue(task, this.now())
  }

  bindRunThread(id: unknown, threadId: unknown): ScheduledTaskRunRequest {
    const runId = boundedText(id, 'Scheduled run ID', 128)
    const normalizedThreadId = boundedText(threadId, 'Scheduled task thread ID', 256)
    const previous = this.pendingRuns.get(runId)
    if (!previous) throw new Error(`Scheduled run ${runId} does not exist`)
    const run = { ...previous, threadId: normalizedThreadId }
    this.pendingRuns.set(runId, run)
    this.commit()
    return copyRun(run)
  }

  acknowledgeRun(id: unknown, threadId?: unknown): void {
    const runId = boundedText(id, 'Scheduled run ID', 128)
    const run = this.pendingRuns.get(runId)
    if (!run) return
    if (threadId !== undefined) {
      const normalizedThreadId = boundedText(threadId, 'Scheduled task thread ID', 256)
      const task = this.tasks.get(run.taskId)
      if (task && !task.newChatEachRun) {
        this.tasks.set(task.id, { ...task, lastThreadId: normalizedThreadId })
      }
    }
    this.pendingRuns.delete(runId)
    this.commit()
    this.emitChange()
  }

  onRun(listener: (run: ScheduledTaskRunRequest) => void): () => void {
    this.runListeners.add(listener)
    return () => this.runListeners.delete(listener)
  }

  onChange(listener: (tasks: ScheduledTaskDefinition[]) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  start(): void {
    if (this.started) return
    this.started = true
    for (const run of this.listPendingRuns()) this.emitRun(run)
    this.tick()
  }

  stop(): void {
    this.started = false
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
  }

  /** Public for deterministic main-process tests; production scheduling uses start(). */
  tick(at = this.now()): ScheduledTaskRunRequest[] {
    const queued: ScheduledTaskRunRequest[] = []
    for (const task of this.tasks.values()) {
      if (task.status !== 'active' || task.nextRunAt === null || task.nextRunAt === undefined || task.nextRunAt > at) continue
      const scheduledFor = task.nextRunAt
      const run = runRequest(task, scheduledFor, at, 'scheduled')
      this.pendingRuns.set(run.runId, run)
      task.lastRunAt = scheduledFor
      // Do not replay every interval missed while the app was not running.
      task.nextRunAt = nextScheduledTaskRun(task, at)
      this.tasks.set(task.id, task)
      queued.push(run)
    }
    if (queued.length) {
      this.trimPendingRuns()
      this.commit()
      this.emitChange()
      for (const run of queued) this.emitRun(run)
    }
    this.schedule()
    return queued.map(copyRun)
  }

  private enqueue(task: ScheduledTaskDefinition, scheduledFor: number): ScheduledTaskRunRequest {
    const run = runRequest(task, scheduledFor, this.now(), 'manual')
    this.pendingRuns.set(run.runId, run)
    this.trimPendingRuns()
    this.commit()
    this.emitRun(run)
    return copyRun(run)
  }

  private emitRun(run: ScheduledTaskRunRequest): void {
    for (const listener of this.runListeners) listener(copyRun(run))
  }

  private emitChange(): void {
    const tasks = this.list()
    for (const listener of this.changeListeners) listener(tasks)
  }

  private schedule(): void {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    if (!this.started) return
    const now = this.now()
    const next = [...this.tasks.values()]
      .filter((task) => task.status === 'active' && typeof task.nextRunAt === 'number')
      .reduce<number | null>((earliest, task) => earliest === null || task.nextRunAt! < earliest ? task.nextRunAt! : earliest, null)
    const delay = next === null
      ? this.maxTimerDelayMs
      : Math.max(0, Math.min(this.maxTimerDelayMs, next - now))
    this.timer = this.setTimer(() => {
      this.timer = null
      this.tick()
    }, delay)
  }

  private trimPendingRuns(): void {
    const runs = this.listPendingRuns()
    for (const run of runs.slice(0, Math.max(0, runs.length - MAX_PENDING_RUNS))) {
      this.pendingRuns.delete(run.runId)
    }
  }

  private load(): void {
    try {
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.tasks) ||
          !Array.isArray(value.pendingRuns) || value.tasks.length > MAX_TASKS || value.pendingRuns.length > MAX_PENDING_RUNS) return
      for (const candidate of value.tasks) {
        try {
          const task = normalizeScheduledTaskDefinition(candidate)
          this.tasks.set(task.id, task)
        } catch { /* Skip malformed entries instead of disabling all valid tasks. */ }
      }
      for (const candidate of value.pendingRuns) {
        const run = normalizePendingRun(candidate)
        if (run && this.tasks.has(run.taskId)) this.pendingRuns.set(run.runId, run)
      }
    } catch { /* First launch and stale/corrupt snapshots start empty. */ }
  }

  private commit(): void {
    const snapshot: ScheduledTasksSnapshot = {
      version: STORE_VERSION,
      tasks: this.list(),
      pendingRuns: this.listPendingRuns()
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}

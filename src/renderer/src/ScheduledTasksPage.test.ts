import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalizeScheduledEffort,
  parseScheduledTasks,
  scheduledTaskDefinitionFromRecord,
  scheduledTaskRecordFromDefinition,
  scheduledTaskSummary,
  scheduledTaskTimeOptions,
  scheduledTaskTitle,
  scheduledWeekdaySummary
} from './ScheduledTasksPage'
import type { ScheduledTaskDefinition } from '../../shared/api'

const source = readFileSync(new URL('./ScheduledTasksPage.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./scheduledTasks.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('scheduled task model', () => {
  it('derives a compact title without losing the full prompt', () => {
    expect(scheduledTaskTitle('  每天检查构建状态\n并汇总失败原因  ')).toBe('每天检查构建状态')
    expect(scheduledTaskTitle('x'.repeat(50))).toBe(`${'x'.repeat(38)}…`)
    expect(scheduledTaskTitle('   ')).toBe('未命名任务')
  })

  it('formats the recovered schedule labels', () => {
    expect(scheduledTaskSummary({frequency: 'daily', time: '09:00'})).toBe('每天 09:00')
    expect(scheduledTaskSummary({frequency: 'weekdays', time: '18:30'})).toBe('工作日 18:30')
  })

  it('rejects malformed persisted entries', () => {
    expect(parseScheduledTasks('not-json')).toEqual([])
    expect(parseScheduledTasks(JSON.stringify([{id: 'broken'}]))).toEqual([])
    const task = {
      id: 'task-1', title: '测试', prompt: '测试', frequency: 'daily', time: '09:00',
      status: 'active', unread: false, notification: 'important', newChatEachRun: true,
      model: 'GPT', effort: '中', createdAt: 1, updatedAt: 1
    }
    expect(parseScheduledTasks(JSON.stringify([task]))).toEqual([{
      ...task,
      customUnit: 'week',
      customInterval: 1,
      customWeekdays: [1, 2, 3, 4, 5, 6, 7]
    }])
  })

  it('migrates records written by the earlier local task draft', () => {
    const [task] = parseScheduledTasks(JSON.stringify([{
      id: 'legacy', title: '旧任务', prompt: '旧任务', frequency: 'daily', time: '09:00',
      status: 'active', notification: 'all', effort: '超高'
    }]))
    expect(task).toMatchObject({
      id: 'legacy', notification: 'important', newChatEachRun: false, effort: '极高',
      customUnit: 'week', customInterval: 1, customWeekdays: [1, 2, 3, 4, 5, 6, 7]
    })
  })

  it('persists and normalizes the configurable custom recurrence', () => {
    const [task] = parseScheduledTasks(JSON.stringify([{
      id: 'custom', title: '自定义', prompt: '自定义', frequency: 'custom', time: '08:15',
      status: 'active', customUnit: 'month', customInterval: 99,
      customWeekdays: [5, 1, 5, 9], createdAt: 1, updatedAt: 1
    }]))
    expect(task).toMatchObject({
      customUnit: 'month', customInterval: 12, customWeekdays: [1, 5]
    })
    expect(scheduledWeekdaySummary(task.customWeekdays)).toBe('星期一、星期五')
  })

  it('builds the native fifteen-minute time menu', () => {
    const times = scheduledTaskTimeOptions()
    expect(times).toHaveLength(96)
    expect(times.slice(0, 5)).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00'])
    expect(times.at(-1)).toBe('23:45')
  })

  it('normalizes legacy effort labels to the recovered menu wording', () => {
    expect(normalizeScheduledEffort('低')).toBe('轻度')
    expect(normalizeScheduledEffort('超高')).toBe('极高')
    expect(normalizeScheduledEffort('Ultra')).toBe('Ultra')
    expect(normalizeScheduledEffort('unknown')).toBe('中')
  })

  it('round-trips persisted definitions without losing execution context', () => {
    const definition: ScheduledTaskDefinition = {
      id: 'round-trip',
      title: '远程日报',
      prompt: '检查远程构建并汇总失败原因',
      frequency: 'custom',
      time: '08:15',
      status: 'paused',
      notification: 'failed',
      newChatEachRun: false,
      model: 'GPT-6.1 Sol',
      effort: '极高',
      customUnit: 'week',
      customInterval: 2,
      customWeekdays: [1, 3, 5],
      cwd: '/Users/example/project',
      hostId: 'remote-host',
      lastRunAt: 100,
      nextRunAt: null,
      lastThreadId: 'thread-1',
      createdAt: 10,
      updatedAt: 20
    }

    const record = scheduledTaskRecordFromDefinition(definition)
    expect(record).toMatchObject({ ...definition, unread: false })
    expect(scheduledTaskDefinitionFromRecord(record)).toEqual(definition)
  })

  it('supplies renderer defaults for older definitions before saving them again', () => {
    const definition: ScheduledTaskDefinition = {
      id: 'older-definition',
      title: '旧任务',
      prompt: '继续执行',
      frequency: 'daily',
      time: '09:00',
      status: 'active',
      notification: 'important',
      newChatEachRun: true,
      model: 'GPT-6 Sol',
      effort: '中',
      createdAt: 10,
      updatedAt: 20
    }

    const record = scheduledTaskRecordFromDefinition(definition)
    expect(record).toMatchObject({
      customUnit: 'week',
      customInterval: 1,
      customWeekdays: [1, 2, 3, 4, 5, 6, 7]
    })
    expect(scheduledTaskDefinitionFromRecord(record)).toMatchObject({
      ...definition,
      customUnit: 'week',
      customInterval: 1,
      customWeekdays: [1, 2, 3, 4, 5, 6, 7]
    })
  })

  it('uses controlled popup menus instead of native selects and layers Escape dismissal', () => {
    expect(source).not.toContain('<select')
    expect(source).not.toContain('type="time"')
    expect(source).toContain("if (openMenu) setOpenMenu(null)")
    expect(source).toContain("else onClose()")
    expect(source).toContain('运行频率')
    expect(source).toContain('仅限未成功运行')
    expect(source).toContain('星期一、星期二、星期三、星期四、星期五、星期六和星期日')
    expect(source).toContain('handleScheduledMenuKeyDown')
    expect(source).toContain("selectedRef.current?.focus({preventScroll: true})")
    expect(source).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']")
  })

  it('matches the recovered menu sizing, custom editor, and destructive confirmation', () => {
    expect(source).toContain('width={116}')
    expect(source).toContain('width={208}')
    expect(source).toContain('ariaLabel="重复计划"')
    expect(source).toContain('ariaLabel="推理"')
    expect(source).toContain('menuId="custom-unit"')
    expect(source).toContain('menuId="custom-interval"')
    expect(source).toContain('menuId="custom-days"')
    expect(source).toContain('role="alertdialog"')
    expect(styles).toContain('.scheduled-dialog.is-custom:not(.is-advanced)')
    expect(styles).toContain('height: min(566px, calc(100vh - 120px));')
    expect(styles).toContain(".scheduled-select-button[data-scheduled-menu-trigger='time']")
    expect(styles).toContain('font-size: 16px; font-weight: 590; line-height: 26px;')
    expect(styles).toContain('min-height: 48px;')
    expect(styles).not.toContain('.scheduled-sidebar-tools svg path { stroke-width: 0; }')
  })

  it('matches the recovered scheduled-task sidebar grouping and dark modal treatment', () => {
    const titleIndex = source.indexOf('<h1>定时任务</h1>')
    const searchIndex = source.indexOf('aria-label="搜索定时任务"', titleIndex)
    const newTaskIndex = source.indexOf('className="scheduled-new-row"', searchIndex)
    const sectionIndex = source.indexOf('<span>即将执行</span>', newTaskIndex)
    const filterIndex = source.indexOf('aria-label="筛选任务"', sectionIndex)

    expect(titleIndex).toBeGreaterThanOrEqual(0)
    expect(searchIndex).toBeGreaterThan(titleIndex)
    expect(newTaskIndex).toBeGreaterThan(searchIndex)
    expect(sectionIndex).toBeGreaterThan(newTaskIndex)
    expect(filterIndex).toBeGreaterThan(sectionIndex)
    expect(styles).toContain('background: rgb(0 0 0 / 52%);')
    expect(styles).toContain('background: #222;')
    expect(styles).toContain('scroll-padding-bottom: 16px;')
  })

  it('executes immediate and scheduled runs through the durable IPC pipeline', () => {
    expect(source).toContain('window.codex.runScheduledTaskNow(selectedTask.id)')
    expect(appSource).toContain('window.codex.onScheduledTaskRun(queueScheduledTaskRun)')
    expect(appSource).toContain("window.codex.invoke<ThreadStartResponse>('thread/start'")
    expect(appSource).toContain('window.codex.bindScheduledTaskRunThread(run.runId, threadId)')
    expect(appSource).toContain("window.codex.invoke<{ turn: Turn }>('turn/start'")
    expect(appSource).toContain('clientUserMessageId: run.runId')
    expect(appSource).toContain('window.codex.acknowledgeScheduledTaskRun(run.runId, threadId)')
  })
})

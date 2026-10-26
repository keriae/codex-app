import {
  Bell,
  Check,
  ChevronDown,
  Clock3,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Search,
  Trash2,
  X
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import type { ScheduledTaskDefinition } from '../../shared/api'
import './scheduledTasks.css'

export type ScheduledTaskStatus = 'active' | 'paused' | 'completed'
export type ScheduledTaskFrequency = 'daily' | 'weekdays' | 'weekly' | 'custom'
export type ScheduledTaskCustomUnit = 'day' | 'week' | 'month'

export interface ScheduledTaskRecord {
  id: string
  title: string
  prompt: string
  frequency: ScheduledTaskFrequency
  time: string
  status: ScheduledTaskStatus
  unread: boolean
  notification: 'important' | 'failed'
  newChatEachRun: boolean
  model: string
  effort: string
  customUnit: ScheduledTaskCustomUnit
  customInterval: number
  customWeekdays: number[]
  cwd?: string
  hostId?: string
  lastRunAt?: number | null
  nextRunAt?: number | null
  lastThreadId?: string
  createdAt: number
  updatedAt: number
}

const SCHEDULED_TASKS_KEY = 'codex-scheduled-tasks-v1'
const ALL_STATUSES: readonly ScheduledTaskStatus[] = ['active', 'paused', 'completed']
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const FIXED_SCHEDULED_MODELS = [
  'GPT-6.1 Sol',
  'GPT-6 Astra',
  'GPT-6 Sol',
  'GPT-6 Luna',
  'GPT-5.6 Sol',
  'GPT-5.6 Terra',
  'GPT-5.6 Luna',
  'GPT-5.5'
] as const

const frequencyLabels: Record<ScheduledTaskFrequency, string> = {
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  custom: '自定义'
}

const statusLabels: Record<ScheduledTaskStatus, string> = {
  active: '已开启',
  paused: '已暂停',
  completed: '已完成'
}

const customUnitLabels: Record<ScheduledTaskCustomUnit, string> = {
  day: '每天',
  week: '每周',
  month: '每月'
}

const customUnitSuffixes: Record<ScheduledTaskCustomUnit, string> = {
  day: '天',
  week: '周',
  month: '个月'
}

const weekdayLabels: Record<number, string> = {
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
  6: '星期六',
  7: '星期日'
}

function normalizedCustomUnit(value: unknown): ScheduledTaskCustomUnit {
  return value === 'day' || value === 'month' ? value : 'week'
}

function normalizedCustomInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(12, Math.round(value)))
    : 1
}

function normalizedCustomWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...ALL_WEEKDAYS]
  const days = [...new Set(value.filter((day): day is number =>
    typeof day === 'number' && ALL_WEEKDAYS.includes(day as typeof ALL_WEEKDAYS[number])
  ))].sort((a, b) => a - b)
  return days.length ? days : [...ALL_WEEKDAYS]
}

export function scheduledWeekdaySummary(days: readonly number[]): string {
  const normalized = normalizedCustomWeekdays(days)
  if (normalized.length === ALL_WEEKDAYS.length) {
    return '星期一、星期二、星期三、星期四、星期五、星期六和星期日'
  }
  return normalized.map((day) => weekdayLabels[day]).join('、')
}

export function parseScheduledTasks(value: string | null): ScheduledTaskRecord[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): ScheduledTaskRecord[] => {
      if (!entry || typeof entry !== 'object') return []
      const task = entry as Partial<ScheduledTaskRecord>
      const valid = typeof task.id === 'string' && typeof task.title === 'string' &&
        typeof task.prompt === 'string' && ALL_STATUSES.includes(task.status as ScheduledTaskStatus) &&
        ['daily', 'weekdays', 'weekly', 'custom'].includes(task.frequency || '') &&
        typeof task.time === 'string'
      if (!valid) return []
      return [{
        ...task,
        id: task.id!,
        title: task.title!,
        prompt: task.prompt!,
        frequency: task.frequency!,
        time: task.time!,
        status: task.status!,
        unread: Boolean(task.unread),
        notification: task.notification === 'failed' ? 'failed' : 'important',
        newChatEachRun: Boolean(task.newChatEachRun),
        model: typeof task.model === 'string' ? task.model : '',
        effort: normalizeScheduledEffort(typeof task.effort === 'string' ? task.effort : '中'),
        customUnit: normalizedCustomUnit(task.customUnit),
        customInterval: normalizedCustomInterval(task.customInterval),
        customWeekdays: normalizedCustomWeekdays(task.customWeekdays),
        createdAt: typeof task.createdAt === 'number' ? task.createdAt : 0,
        updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : 0
      }]
    })
  } catch {
    return []
  }
}

export function scheduledTaskTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0]?.trim() || '未命名任务'
  return firstLine.length > 38 ? `${firstLine.slice(0, 38).trimEnd()}…` : firstLine
}

export function scheduledTaskSummary(task: Pick<ScheduledTaskRecord, 'frequency' | 'time'>): string {
  return `${frequencyLabels[task.frequency]} ${task.time}`
}

function readScheduledTasks(): ScheduledTaskRecord[] {
  try {
    return parseScheduledTasks(localStorage.getItem(SCHEDULED_TASKS_KEY))
  } catch {
    return []
  }
}

export function scheduledTaskRecordFromDefinition(task: ScheduledTaskDefinition): ScheduledTaskRecord {
  return {
    ...task,
    unread: false,
    customUnit: normalizedCustomUnit(task.customUnit),
    customInterval: normalizedCustomInterval(task.customInterval),
    customWeekdays: normalizedCustomWeekdays(task.customWeekdays)
  }
}

export function scheduledTaskDefinitionFromRecord(task: ScheduledTaskRecord): ScheduledTaskDefinition {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    frequency: task.frequency,
    time: task.time,
    status: task.status,
    notification: task.notification,
    newChatEachRun: task.newChatEachRun,
    model: task.model,
    effort: task.effort,
    customUnit: task.customUnit,
    customInterval: task.customInterval,
    customWeekdays: [...task.customWeekdays],
    ...(task.cwd ? { cwd: task.cwd } : {}),
    ...(task.hostId ? { hostId: task.hostId } : {}),
    ...(task.lastRunAt !== undefined ? { lastRunAt: task.lastRunAt } : {}),
    ...(task.nextRunAt !== undefined ? { nextRunAt: task.nextRunAt } : {}),
    ...(task.lastThreadId ? { lastThreadId: task.lastThreadId } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

function FilterIcon(): ReactNode {
  return <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M10 11.4746C10.2899 11.4746 10.5254 11.7101 10.5254 12C10.5254 12.2899 10.2899 12.5254 10 12.5254H6C5.71005 12.5254 5.47461 12.2899 5.47461 12C5.47461 11.7101 5.71005 11.4746 6 11.4746H10Z" />
    <path d="M12 7.47461C12.2899 7.47461 12.5254 7.71005 12.5254 8C12.5254 8.28995 12.2899 8.52539 12 8.52539H4C3.71005 8.52539 3.47461 8.28995 3.47461 8C3.47461 7.71005 3.71005 7.47461 4 7.47461H12Z" />
    <path d="M14 3.47461C14.2899 3.47461 14.5254 3.71005 14.5254 4C14.5254 4.28995 14.2899 4.52539 14 4.52539H2C1.71005 4.52539 1.47461 4.28995 1.47461 4C1.47461 3.71005 1.71005 3.47461 2 3.47461H14Z" />
  </svg>
}

function PlusIcon(): ReactNode {
  return <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8.00049 2.14111C8.29021 2.14138 8.52588 2.37672 8.52588 2.6665V7.4751H13.3335C13.6233 7.47527 13.8579 7.71065 13.8579 8.00049C13.8576 8.29011 13.6231 8.5257 13.3335 8.52588H8.52588V13.3335C8.5257 13.6231 8.29011 13.8576 8.00049 13.8579C7.71065 13.8579 7.47527 13.6233 7.4751 13.3335V8.52588H2.6665C2.37672 8.52588 2.14138 8.29021 2.14111 8.00049C2.14111 7.71054 2.37655 7.4751 2.6665 7.4751H7.4751V2.6665C7.4751 2.37655 7.71054 2.14111 8.00049 2.14111Z" />
  </svg>
}

interface ScheduledMenuOption<T extends string> {
  value: T
  label: string
}

type ScheduledDialogMenu =
  | 'frequency'
  | 'time'
  | 'notification'
  | 'model'
  | 'effort'
  | 'custom-unit'
  | 'custom-interval'
  | 'custom-days'

const notificationLabels: Record<ScheduledTaskRecord['notification'], string> = {
  important: '重要更新',
  failed: '仅限未成功运行'
}

const effortOptions = ['轻度', '中', '高', '极高', 'Ultra'] as const

export function normalizeScheduledEffort(value: string): string {
  if (value === '低') return '轻度'
  if (value === '超高') return '极高'
  return effortOptions.includes(value as typeof effortOptions[number]) ? value : '中'
}

export function scheduledTaskTimeOptions(): string[] {
  return Array.from({length: 96}, (_, index) => {
    const hour = Math.floor(index / 4)
    const minute = (index % 4) * 15
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  })
}

function ScheduledPopupMenu<T extends string>({
  menuId,
  title,
  ariaLabel,
  anchorRef,
  options,
  value,
  width = 180,
  scrollable = false,
  onSelect,
  onClose
}: {
  menuId: ScheduledDialogMenu
  title?: string
  ariaLabel: string
  anchorRef: RefObject<HTMLButtonElement | null>
  options: readonly ScheduledMenuOption<T>[]
  value: T
  width?: number
  scrollable?: boolean
  onSelect(value: T): void
  onClose(): void
}): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<CSSProperties>({visibility: 'hidden'})

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!anchor || !menu) return
    const gutter = 12
    const below = window.innerHeight - anchor.bottom - gutter
    const top = below >= menu.height || below >= anchor.top
      ? anchor.bottom + 6
      : anchor.top - menu.height - 6
    setPosition({
      top: Math.max(gutter, Math.min(top, window.innerHeight - menu.height - gutter)),
      left: Math.max(gutter, Math.min(anchor.right - width, window.innerWidth - width - gutter)),
      width
    })
  }, [anchorRef, options, width])

  useLayoutEffect(() => {
    if (position.visibility === 'hidden') return
    selectedRef.current?.scrollIntoView({block: 'center'})
    selectedRef.current?.focus({preventScroll: true})
  }, [position])

  useEffect(() => {
    const dismissOnScroll = (event: Event): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const dismissOnResize = (): void => onClose()
    document.addEventListener('scroll', dismissOnScroll, true)
    window.addEventListener('resize', dismissOnResize)
    return () => {
      document.removeEventListener('scroll', dismissOnScroll, true)
      window.removeEventListener('resize', dismissOnResize)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className={`scheduled-popup-menu${scrollable ? ' is-scrollable' : ''}`}
      data-scheduled-menu={menuId}
      role="menu"
      aria-label={ariaLabel}
      style={position}
      onKeyDown={(event) => handleScheduledMenuKeyDown(event, () => {
        onClose()
        requestAnimationFrame(() => anchorRef.current?.focus())
      })}
    >
      {title && <div className="scheduled-popup-menu-title">{title}</div>}
      <div className="scheduled-popup-menu-options">
        {options.map((option) => {
          const selected = option.value === value
          return <button
            key={option.value}
            ref={selected ? selectedRef : undefined}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'is-selected' : ''}
            onClick={() => onSelect(option.value)}
          >
            <span>{option.label}</span>
            {selected && <Check />}
          </button>
        })}
      </div>
    </div>,
    document.body
  )
}

function handleScheduledMenuKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  onClose: () => void
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const menu = event.currentTarget
  const items = [...menu.querySelectorAll<HTMLElement>(
    '[role="menuitemradio"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"]), [role="menuitem"]:not([aria-disabled="true"])'
  )].filter((item) => item.getClientRects().length > 0)
  if (!items.length) return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLElement)
  let next = current
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
  items[next]?.focus({preventScroll: true})
}

function ScheduledSelectButton({
  menuId,
  label,
  ariaLabel,
  compact = false,
  open,
  buttonRef,
  onClick
}: {
  menuId: ScheduledDialogMenu
  label: string
  ariaLabel: string
  compact?: boolean
  open: boolean
  buttonRef: RefObject<HTMLButtonElement | null>
  onClick(): void
}): ReactNode {
  return <button
    ref={buttonRef}
    type="button"
    className={`scheduled-select-button${compact ? ' is-compact' : ''}`}
    data-scheduled-menu-trigger={menuId}
    aria-label={ariaLabel}
    aria-haspopup="menu"
    aria-expanded={open}
    onClick={onClick}
  >
    <span>{label}</span>
    <ChevronDown />
  </button>
}

function ScheduledWeekdayPopup({
  anchorRef,
  value,
  onChange,
  onClose
}: {
  anchorRef: RefObject<HTMLButtonElement | null>
  value: readonly number[]
  onChange(value: number[]): void
  onClose(): void
}): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<CSSProperties>({visibility: 'hidden'})

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!anchor || !menu) return
    const width = 180
    const gutter = 12
    const proposedTop = window.innerHeight - anchor.bottom - gutter >= menu.height
      ? anchor.bottom + 6
      : anchor.top - menu.height - 6
    setPosition({
      top: Math.max(gutter, Math.min(proposedTop, window.innerHeight - menu.height - gutter)),
      left: Math.max(gutter, Math.min(anchor.right - width, window.innerWidth - width - gutter)),
      width
    })
  }, [anchorRef])

  useEffect(() => {
    const closeOnResize = (): void => onClose()
    window.addEventListener('resize', closeOnResize)
    return () => window.removeEventListener('resize', closeOnResize)
  }, [onClose])

  useLayoutEffect(() => {
    if (position.visibility === 'hidden') return
    initialRef.current?.focus({preventScroll: true})
  }, [position])

  const selected = new Set(value)
  return createPortal(
    <div
      ref={menuRef}
      className="scheduled-popup-menu"
      data-scheduled-menu="custom-days"
      role="menu"
      aria-label="开启日期"
      style={position}
      onKeyDown={(event) => handleScheduledMenuKeyDown(event, () => {
        onClose()
        requestAnimationFrame(() => anchorRef.current?.focus())
      })}
    >
      <div className="scheduled-popup-menu-title">开启</div>
      <div className="scheduled-popup-menu-options">
        {ALL_WEEKDAYS.map((day) => <button
          key={day}
          ref={day === (value[0] || ALL_WEEKDAYS[0]) ? initialRef : undefined}
          type="button"
          role="menuitemcheckbox"
          aria-checked={selected.has(day)}
          tabIndex={day === (value[0] || ALL_WEEKDAYS[0]) ? 0 : -1}
          className={selected.has(day) ? 'is-selected' : ''}
          onClick={() => {
            const next = new Set(selected)
            if (next.has(day)) {
              if (next.size > 1) next.delete(day)
            } else next.add(day)
            onChange([...next].sort((a, b) => a - b))
          }}
        >
          <span>{weekdayLabels[day]}</span>
          {selected.has(day) && <Check />}
        </button>)}
      </div>
    </div>,
    document.body
  )
}

function ScheduledTaskDialog({
  task,
  onClose,
  onSave
}: {
  task: ScheduledTaskRecord | null
  onClose(): void
  onSave(task: ScheduledTaskRecord): void
}): ReactNode {
  const [prompt, setPrompt] = useState(task?.prompt || '')
  const [frequency, setFrequency] = useState<ScheduledTaskFrequency>(task?.frequency || 'daily')
  const [time, setTime] = useState(task?.time || '09:00')
  const [advanced, setAdvanced] = useState(false)
  const [notification, setNotification] = useState<ScheduledTaskRecord['notification']>(task?.notification === 'failed' ? 'failed' : 'important')
  const [newChatEachRun, setNewChatEachRun] = useState(task?.newChatEachRun ?? false)
  const [model, setModel] = useState(task?.model && FIXED_SCHEDULED_MODELS.includes(task.model as typeof FIXED_SCHEDULED_MODELS[number])
    ? task.model
    : 'GPT-5.6 Terra')
  const [effort, setEffort] = useState(normalizeScheduledEffort(task?.effort || '轻度'))
  const [customUnit, setCustomUnit] = useState<ScheduledTaskCustomUnit>(normalizedCustomUnit(task?.customUnit))
  const [customInterval, setCustomInterval] = useState(normalizedCustomInterval(task?.customInterval))
  const [customWeekdays, setCustomWeekdays] = useState<number[]>(normalizedCustomWeekdays(task?.customWeekdays))
  const [openMenu, setOpenMenu] = useState<ScheduledDialogMenu | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const frequencyRef = useRef<HTMLButtonElement>(null)
  const timeRef = useRef<HTMLButtonElement>(null)
  const notificationRef = useRef<HTMLButtonElement>(null)
  const modelRef = useRef<HTMLButtonElement>(null)
  const effortRef = useRef<HTMLButtonElement>(null)
  const customUnitRef = useRef<HTMLButtonElement>(null)
  const customIntervalRef = useRef<HTMLButtonElement>(null)
  const customDaysRef = useRef<HTMLButtonElement>(null)
  const frequencyOptions: readonly ScheduledMenuOption<ScheduledTaskFrequency>[] = [
    {value: 'daily', label: '每天'},
    {value: 'weekdays', label: '工作日'},
    {value: 'weekly', label: '每周'},
    {value: 'custom', label: '自定义'}
  ]
  const timeOptions = useMemo<readonly ScheduledMenuOption<string>[]>(() => scheduledTaskTimeOptions().map((value) => ({
    value,
    label: `${Number(value.slice(0, 2))}:${value.slice(3)}`
  })), [])
  const notificationOptions: readonly ScheduledMenuOption<ScheduledTaskRecord['notification']>[] = [
    {value: 'important', label: '重要更新'},
    {value: 'failed', label: '仅限未成功运行'}
  ]
  const modelOptions = useMemo<readonly ScheduledMenuOption<string>[]>(() =>
    FIXED_SCHEDULED_MODELS.map((value) => ({value, label: value})), [])
  const scheduledEffortOptions = useMemo<readonly ScheduledMenuOption<string>[]>(() => effortOptions.map((value) => ({value, label: value})), [])
  const customUnitOptions: readonly ScheduledMenuOption<ScheduledTaskCustomUnit>[] = [
    {value: 'day', label: '每天'},
    {value: 'week', label: '每周'},
    {value: 'month', label: '每月'}
  ]
  const customIntervalOptions = useMemo<readonly ScheduledMenuOption<string>[]>(() =>
    Array.from({length: 12}, (_, index) => {
      const value = String(index + 1)
      return {value, label: `${value} ${customUnitSuffixes[customUnit]}`}
    }), [customUnit])

  useEffect(() => {
    promptRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (openMenu) setOpenMenu(null)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, openMenu])

  useEffect(() => {
    if (!openMenu) return
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`[data-scheduled-menu="${openMenu}"]`) || target.closest('[data-scheduled-menu-trigger]')) return
      setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [openMenu])

  useEffect(() => {
    if (!advanced && openMenu && ['notification', 'model', 'effort'].includes(openMenu)) setOpenMenu(null)
  }, [advanced, openMenu])

  const toggleMenu = (menu: ScheduledDialogMenu): void => {
    setOpenMenu((current) => current === menu ? null : menu)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!prompt.trim()) return
    const now = Date.now()
    onSave({
      id: task?.id || crypto.randomUUID(),
      title: scheduledTaskTitle(prompt),
      prompt: prompt.trim(),
      frequency,
      time,
      status: task?.status || 'active',
      unread: task?.unread || false,
      notification,
      newChatEachRun,
      model,
      effort,
      customUnit,
      customInterval,
      customWeekdays,
      createdAt: task?.createdAt || now,
      updatedAt: now
    })
  }

  const dialog = <div className="scheduled-dialog-backdrop" onPointerDown={(event) => {
    if (event.target === event.currentTarget) {
      setOpenMenu(null)
      onClose()
    }
  }}>
    <div className={`scheduled-dialog${frequency === 'custom' ? ' is-custom' : ''}${advanced ? ' is-advanced' : ''}`} role="dialog" aria-modal="true" aria-labelledby="scheduled-dialog-title">
      <form onSubmit={submit}>
        <h2 id="scheduled-dialog-title">{task ? '编辑任务' : '设置定时任务'}</h2>
        <div className="scheduled-dialog-body">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="说明…"
            placeholder="说明…"
          />
          <div className={`scheduled-form-card${frequency === 'custom' ? ' is-custom' : ''}`}>
            <div className="scheduled-form-row">
              <span>重复</span>
              <ScheduledSelectButton menuId="frequency" ariaLabel="重复计划" label={frequencyLabels[frequency]} open={openMenu === 'frequency'} buttonRef={frequencyRef} onClick={() => toggleMenu('frequency')} />
            </div>
            {frequency === 'custom' ? <>
              <div className="scheduled-form-row"><span>重复</span><ScheduledSelectButton menuId="custom-unit" ariaLabel="自定义重复计划" label={customUnitLabels[customUnit]} open={openMenu === 'custom-unit'} buttonRef={customUnitRef} onClick={() => toggleMenu('custom-unit')} /></div>
              <div className="scheduled-form-row"><span>每隔</span><ScheduledSelectButton menuId="custom-interval" ariaLabel="重复间隔" label={`${customInterval} ${customUnitSuffixes[customUnit]}`} open={openMenu === 'custom-interval'} buttonRef={customIntervalRef} onClick={() => toggleMenu('custom-interval')} /></div>
              <div className="scheduled-form-row scheduled-custom-days"><span>开启</span><ScheduledSelectButton menuId="custom-days" ariaLabel="开启日期" label={scheduledWeekdaySummary(customWeekdays)} open={openMenu === 'custom-days'} buttonRef={customDaysRef} onClick={() => toggleMenu('custom-days')} /></div>
              <div className="scheduled-form-row">
                <span>开始时间</span>
                <ScheduledSelectButton menuId="time" ariaLabel="时间" label={`中国时间 ${time}`} open={openMenu === 'time'} buttonRef={timeRef} onClick={() => toggleMenu('time')} />
              </div>
            </> : <div className="scheduled-form-row">
              <span>时间</span>
              <ScheduledSelectButton menuId="time" ariaLabel="时间" label={`中国时间 ${time}`} open={openMenu === 'time'} buttonRef={timeRef} onClick={() => toggleMenu('time')} />
            </div>}
          </div>
          <button type="button" className={`scheduled-advanced-toggle${advanced ? ' is-open' : ''}`} aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>
            高级 <ChevronDown />
          </button>
          {advanced && <div className="scheduled-advanced-grid">
            <div className="scheduled-advanced-row">
              <span>通知</span>
              <ScheduledSelectButton menuId="notification" ariaLabel="通知" compact label={notificationLabels[notification]} open={openMenu === 'notification'} buttonRef={notificationRef} onClick={() => toggleMenu('notification')} />
            </div>
            <div className="scheduled-advanced-row">
              <span>每次运行时都开启新聊天</span>
              <button
                type="button"
                role="switch"
                aria-label="每次运行时都开启新聊天"
                aria-checked={newChatEachRun}
                className={`scheduled-switch${newChatEachRun ? ' is-on' : ''}`}
                onClick={() => setNewChatEachRun((enabled) => !enabled)}
              ><span /></button>
            </div>
            <div className="scheduled-advanced-row">
              <span>模型</span>
              <ScheduledSelectButton menuId="model" ariaLabel="模型" label={model} open={openMenu === 'model'} buttonRef={modelRef} onClick={() => toggleMenu('model')} />
            </div>
            <div className="scheduled-advanced-row">
              <span>强度</span>
              <ScheduledSelectButton menuId="effort" ariaLabel="推理" label={effort} open={openMenu === 'effort'} buttonRef={effortRef} onClick={() => toggleMenu('effort')} />
            </div>
          </div>}
        </div>
        <div className="scheduled-dialog-footer">
          <button type="button" className="scheduled-dialog-cancel" onClick={onClose}>取消</button>
          <button type="submit" className="scheduled-dialog-submit" disabled={!prompt.trim()}>{task ? '保存' : '创建'}</button>
        </div>
      </form>
      <button type="button" className="scheduled-dialog-close" aria-label="关闭对话框" onClick={onClose}><X /><span>关闭对话框</span></button>
    </div>
  </div>

  return <>
    {createPortal(dialog, document.body)}
    {openMenu === 'frequency' && <ScheduledPopupMenu menuId="frequency" title="运行频率" ariaLabel="运行频率" anchorRef={frequencyRef} options={frequencyOptions} value={frequency} onSelect={(value) => { setFrequency(value); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'time' && <ScheduledPopupMenu menuId="time" ariaLabel="时间" anchorRef={timeRef} options={timeOptions} value={time} width={160} scrollable onSelect={(value) => { setTime(value); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'notification' && <ScheduledPopupMenu menuId="notification" title="通知" ariaLabel="通知" anchorRef={notificationRef} options={notificationOptions} value={notification} width={116} onSelect={(value) => { setNotification(value); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'model' && <ScheduledPopupMenu menuId="model" ariaLabel="模型" anchorRef={modelRef} options={modelOptions} value={model} width={208} scrollable onSelect={(value) => { setModel(value); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'effort' && <ScheduledPopupMenu menuId="effort" ariaLabel="推理" anchorRef={effortRef} options={scheduledEffortOptions} value={effort} onSelect={(value) => { setEffort(value); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'custom-unit' && <ScheduledPopupMenu menuId="custom-unit" title="重复" ariaLabel="自定义重复计划" anchorRef={customUnitRef} options={customUnitOptions} value={customUnit} onSelect={(value) => { setCustomUnit(value); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'custom-interval' && <ScheduledPopupMenu menuId="custom-interval" ariaLabel="重复间隔" anchorRef={customIntervalRef} options={customIntervalOptions} value={String(customInterval)} width={160} onSelect={(value) => { setCustomInterval(normalizedCustomInterval(Number(value))); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />}
    {openMenu === 'custom-days' && <ScheduledWeekdayPopup anchorRef={customDaysRef} value={customWeekdays} onChange={setCustomWeekdays} onClose={() => setOpenMenu(null)} />}
  </>
}

function ScheduledTaskDetail({
  task,
  onRun,
  onEdit,
  onTogglePaused,
  onDelete
}: {
  task: ScheduledTaskRecord
  onRun(): void
  onEdit(): void
  onTogglePaused(): void
  onDelete(): void
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [menuOpen])
  return <div className="scheduled-detail">
    <div className="scheduled-detail-card">
      <div className="scheduled-detail-heading">
        <div>
          <span className={`scheduled-status-pill is-${task.status}`}>{statusLabels[task.status]}</span>
          <h1>{task.title}</h1>
          <p>{scheduledTaskSummary(task)} · 中国时间</p>
        </div>
        <div className="scheduled-detail-actions">
          <button type="button" className="scheduled-secondary-button" onClick={onRun} disabled={task.status === 'completed'}><Play />立即运行</button>
          <div className="scheduled-more-anchor" ref={menuRef}>
            <button type="button" className="scheduled-icon-button" aria-label="任务选项" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal /></button>
            {menuOpen && <div className="scheduled-task-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onTogglePaused() }}>{task.status === 'paused' ? <Play /> : <Pause />}{task.status === 'paused' ? '恢复任务' : '暂停任务'}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit() }}><Pencil />编辑任务</button>
              <div />
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onDelete() }}><Trash2 />删除任务</button>
            </div>}
          </div>
        </div>
      </div>
      <section>
        <h2>说明</h2>
        <p>{task.prompt}</p>
      </section>
      <section className="scheduled-detail-settings">
        <h2>设置</h2>
        <dl>
          <div><dt><Clock3 />日程安排</dt><dd>{scheduledTaskSummary(task)}</dd></div>
          <div><dt><Bell />通知</dt><dd>{notificationLabels[task.notification] || '重要更新'}</dd></div>
          <div><dt>模型</dt><dd>{task.model}</dd></div>
          <div><dt>强度</dt><dd>{task.effort}</dd></div>
        </dl>
      </section>
    </div>
  </div>
}

function ScheduledDeleteConfirmation({
  task,
  onCancel,
  onConfirm
}: {
  task: ScheduledTaskRecord
  onCancel(): void
  onConfirm(): void
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCancel()
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [onCancel])

  return createPortal(
    <div className="scheduled-confirm-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div className="scheduled-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="scheduled-delete-title" aria-describedby="scheduled-delete-description">
        <h2 id="scheduled-delete-title">删除定时任务？</h2>
        <p id="scheduled-delete-description">“{task.title}”将不再运行，此操作无法撤销。</p>
        <div>
          <button ref={cancelRef} type="button" className="scheduled-dialog-cancel" onClick={onCancel}>取消</button>
          <button type="button" className="scheduled-delete-confirm" onClick={onConfirm}>删除</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function ScheduledTasksPage({
  sidebarOpen,
  cwd,
  hostId
}: {
  sidebarOpen: boolean
  cwd?: string | null
  hostId?: string
}): ReactNode {
  const [tasks, setTasksState] = useState<ScheduledTaskRecord[]>(readScheduledTasks)
  const [selectedId, setSelectedId] = useState<string | null>(() => readScheduledTasks()[0]?.id || null)
  const [dialogTask, setDialogTask] = useState<ScheduledTaskRecord | null | undefined>(undefined)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [deleteTask, setDeleteTask] = useState<ScheduledTaskRecord | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [statusFilters, setStatusFilters] = useState<Set<ScheduledTaskStatus>>(() => new Set(ALL_STATUSES))
  const [unreadOnly, setUnreadOnly] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const accept = (definitions: ScheduledTaskDefinition[]): void => {
      if (!active) return
      setTasksState((current) => definitions.map((definition) => ({
        ...scheduledTaskRecordFromDefinition(definition),
        unread: current.find((task) => task.id === definition.id)?.unread ?? false
      })))
      setSelectedId((current) => definitions.some((task) => task.id === current)
        ? current
        : definitions[0]?.id || null)
    }
    const unsubscribe = window.codex.onScheduledTasksChanged(accept)
    void (async () => {
      let definitions = await window.codex.listScheduledTasks()
      const legacy = readScheduledTasks()
      if (!definitions.length && legacy.length) {
        for (const task of legacy) {
          const timestamp = Date.now()
          await window.codex.saveScheduledTask(scheduledTaskDefinitionFromRecord({
            ...task,
            ...(task.cwd || !cwd ? {} : { cwd }),
            ...(task.hostId || !hostId ? {} : { hostId }),
            createdAt: task.createdAt > 0 ? task.createdAt : timestamp,
            updatedAt: task.updatedAt > 0 ? task.updatedAt : timestamp
          }))
        }
        localStorage.removeItem(SCHEDULED_TASKS_KEY)
        definitions = await window.codex.listScheduledTasks()
      }
      accept(definitions)
      if (active) setOperationError(null)
    })().catch((error: unknown) => {
      if (active) setOperationError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [cwd, hostId])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!filterOpen) return
    const close = (event: PointerEvent): void => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false)
    }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setFilterOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [filterOpen])

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return tasks.filter((task) => statusFilters.has(task.status) && (!unreadOnly || task.unread) &&
      (!query || `${task.title}\n${task.prompt}`.toLocaleLowerCase().includes(query)))
  }, [search, statusFilters, tasks, unreadOnly])
  const selectedTask = tasks.find((task) => task.id === selectedId) || null

  const saveTask = (task: ScheduledTaskRecord): void => {
    const withContext: ScheduledTaskRecord = {
      ...task,
      ...(task.cwd || !cwd ? {} : { cwd }),
      ...(task.hostId || !hostId ? {} : { hostId })
    }
    void window.codex.saveScheduledTask(scheduledTaskDefinitionFromRecord(withContext)).then((saved) => {
      const record = scheduledTaskRecordFromDefinition(saved)
      setTasksState((current) => {
        const exists = current.some((entry) => entry.id === record.id)
        return exists ? current.map((entry) => entry.id === record.id ? {...record, unread: entry.unread} : entry) : [record, ...current]
      })
      setSelectedId(record.id)
      setDialogTask(undefined)
      setOperationError(null)
    }).catch((error: unknown) => setOperationError(error instanceof Error ? error.message : String(error)))
  }

  const toggleSelectedStatus = (): void => {
    if (!selectedTask) return
    const nextStatus = selectedTask.status === 'paused' ? 'active' : 'paused'
    void window.codex.setScheduledTaskStatus(selectedTask.id, nextStatus).then((saved) => {
      const record = scheduledTaskRecordFromDefinition(saved)
      setTasksState((current) => current.map((task) => task.id === record.id ? {...record, unread: task.unread} : task))
      setOperationError(null)
    }).catch((error: unknown) => setOperationError(error instanceof Error ? error.message : String(error)))
  }

  return <div className="scheduled-tasks-page" data-app-surface="scheduled-tasks">
    {sidebarOpen && <aside className="scheduled-sidebar" aria-label="已安排任务文件夹">
      <div className="scheduled-sidebar-header">
        <div className="scheduled-sidebar-title-row">
          <h1>定时任务</h1>
          <div className="scheduled-sidebar-tools">
            <button type="button" className={`scheduled-search-button${searchOpen ? ' active' : ''}`} aria-label="搜索定时任务" aria-pressed={searchOpen} onClick={() => {
              setSearchOpen((open) => {
                if (open) setSearch('')
                return !open
              })
            }}><Search /></button>
          </div>
        </div>
        {searchOpen && <div className="scheduled-search-row"><Search /><input ref={searchRef} value={search} placeholder="搜索定时任务" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Escape') { setSearch(''); setSearchOpen(false) }
        }} /></div>}
        <button type="button" className="scheduled-new-row" onClick={() => setDialogTask(null)}><PlusIcon /><span>新建任务</span></button>
      </div>
      <div className="scheduled-sidebar-list">
        <div className="scheduled-sidebar-section-header">
          <span>即将执行</span>
          <div ref={filterRef} className="scheduled-filter-anchor">
            <button type="button" className={`scheduled-filter-button${filterOpen ? ' active' : ''}`} aria-label="筛选任务" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><FilterIcon /></button>
            {filterOpen && <div className="scheduled-filter-menu" role="menu">
              <span>状态</span>
              {ALL_STATUSES.map((status) => <button key={status} type="button" role="menuitemcheckbox" aria-checked={statusFilters.has(status)} onClick={() => setStatusFilters((current) => {
                const next = new Set(current)
                if (next.has(status)) next.delete(status); else next.add(status)
                return next
              })}><span>{statusLabels[status]}</span>{statusFilters.has(status) && <Check className="scheduled-filter-check" />}</button>)}
              <button type="button" role="menuitemcheckbox" aria-checked={unreadOnly} onClick={() => setUnreadOnly((enabled) => !enabled)}><span>未读</span>{unreadOnly && <Check className="scheduled-filter-check" />}</button>
            </div>}
          </div>
        </div>
        {visibleTasks.length ? visibleTasks.map((task) => <button key={task.id} type="button" className={`scheduled-task-row${selectedId === task.id ? ' active' : ''}`} aria-current={selectedId === task.id ? 'page' : undefined} onClick={() => setSelectedId(task.id)}>
          <span className={`scheduled-task-dot is-${task.status}`} />
          <span><strong>{task.title}</strong><small>{scheduledTaskSummary(task)}</small></span>
        </button>) : <div className="scheduled-sidebar-empty" role="status">{search.trim() ? '没有匹配的任务' : '暂无已安排的任务'}</div>}
      </div>
    </aside>}
    <main className="scheduled-main">
      <div className="scheduled-main-toolbar" />
      {operationError && <div className="scheduled-operation-error" role="alert">{operationError}</div>}
      {selectedTask ? <ScheduledTaskDetail
        task={selectedTask}
        onRun={() => {
          void window.codex.runScheduledTaskNow(selectedTask.id)
            .then(() => setOperationError(null))
            .catch((error: unknown) => setOperationError(error instanceof Error ? error.message : String(error)))
        }}
        onEdit={() => setDialogTask(selectedTask)}
        onTogglePaused={toggleSelectedStatus}
        onDelete={() => setDeleteTask(selectedTask)}
      /> : <div className="scheduled-empty-state">
        <div className="scheduled-empty-card">
          <div className="scheduled-empty-copy">
            <span role="img" aria-label="🕗">🕗</span>
            <div><h1>安排任务</h1><p>ChatGPT 可以帮你处理持续性任务，让你不必亲自动手。</p></div>
          </div>
          <button type="button" onClick={() => setDialogTask(null)}>新建任务</button>
        </div>
      </div>}
    </main>
    {dialogTask !== undefined && <ScheduledTaskDialog
      task={dialogTask}
      onClose={() => setDialogTask(undefined)}
      onSave={saveTask}
    />}
    {deleteTask && <ScheduledDeleteConfirmation
      task={deleteTask}
      onCancel={() => setDeleteTask(null)}
      onConfirm={() => {
        void window.codex.deleteScheduledTask(deleteTask.id).then(() => {
          const remaining = tasks.filter((task) => task.id !== deleteTask.id)
          setTasksState(remaining)
          setSelectedId((current) => current === deleteTask.id ? remaining[0]?.id || null : current)
          setDeleteTask(null)
          setOperationError(null)
        }).catch((error: unknown) => setOperationError(error instanceof Error ? error.message : String(error)))
      }}
    />}
  </div>
}

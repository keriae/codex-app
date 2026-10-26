import {
  Goal as GoalIcon,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  X
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ActivityTooltip } from './ActivityTooltip'
import {
  formatThreadGoalProgress,
  formatThreadGoalUpdatedLabel,
  nextThreadGoalStatus,
  threadGoalNeedsResumeConfirmation,
  threadGoalStatusLabel,
  type ThreadGoal,
  type ThreadGoalStatus
} from './threadGoal'
import './threadGoal.css'

export {
  ThreadGoalCompletion,
  type ThreadGoalCompletionProps
} from './ThreadGoalCompletion'

export type ThreadGoalAction = 'clear' | 'status' | 'load-edit' | 'edit'

export interface ThreadGoalBarProps {
  goal: ThreadGoal
  disabled?: boolean
  /** Disables all actions while a parent-owned request is pending. */
  busy?: boolean
  /** Optional action identity for a parent-owned request and its loading affordance. */
  busyAction?: ThreadGoalAction | null
  locale?: string
  /** Deterministic clock override for screenshots and tests. */
  nowMs?: number
  onClear(): void | Promise<void>
  onStatusChange(status: ThreadGoalStatus): void | Promise<void>
  onSaveObjective(objective: string): void | Promise<void>
  /** Resolves file-backed objectives before the editor opens. */
  onLoadObjective?(goal: ThreadGoal): string | Promise<string>
  onError?(error: unknown, action: ThreadGoalAction): void
}

export interface ThreadGoalResumeDialogProps {
  goal: ThreadGoal | null
  busy?: boolean
  onDismiss(): void | Promise<void>
  onResume(): void | Promise<void>
}

export interface ThreadGoalReplaceDialogProps {
  objective: string | null
  busy?: boolean
  onDismiss(): void | Promise<void>
  onReplace(): void | Promise<void>
}

interface GoalEditorProps {
  objective: string
  sourceObjective: string
  updatedAt: number
  busy: boolean
  error: string | null
  locale?: string
  nowMs: number
  onChange(value: string): void
  onCancel(): void
  onSave(): void
  onRevert(): void
}

const ACTION_ERROR: Record<ThreadGoalAction, string> = {
  clear: '无法清除目标',
  status: '无法更新目标',
  'load-edit': '未成功加载目标',
  edit: '未成功保存目标'
}

function GoalActionButton({
  label,
  disabled,
  loading,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  loading: boolean
  onClick(): void
  children: ReactNode
}): ReactNode {
  return (
    <ActivityTooltip content={label}>
      <button
        type="button"
        className="thread-goal-action"
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {loading ? <LoaderCircle className="thread-goal-spinner" aria-hidden="true" /> : children}
      </button>
    </ActivityTooltip>
  )
}

function GoalEditor({
  objective,
  sourceObjective,
  updatedAt,
  busy,
  error,
  locale,
  nowMs,
  onChange,
  onCancel,
  onSave,
  onRevert
}: GoalEditorProps): ReactNode {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = objective.trim()
  const dirty = trimmed !== sourceObjective.trim()

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    textareaRef.current?.focus()
    textareaRef.current?.select()
    return () => previousFocus?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled])'
        ) || []
      )
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, onCancel])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!busy && trimmed && dirty) onSave()
  }

  const dialog = (
    <div
      className="thread-goal-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <section
        ref={dialogRef}
        className="thread-goal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <form onSubmit={submit}>
          <header className="thread-goal-dialog-header">
            <span className="thread-goal-dialog-emblem"><GoalIcon aria-hidden="true" /></span>
            <h2 id={titleId}>编辑目标</h2>
          </header>
          <label className="thread-goal-dialog-field">
            <span>目标</span>
            <textarea
              ref={textareaRef}
              rows={12}
              aria-label="目标"
              placeholder="目标"
              maxLength={4_000}
              value={objective}
              disabled={busy}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
          </label>
          {error && <p className="thread-goal-dialog-error" role="alert">{error}</p>}
          <div className="thread-goal-dialog-meta">
            <span>{formatThreadGoalUpdatedLabel(updatedAt, nowMs, locale)}</span>
            <button
              type="button"
              className="thread-goal-dialog-revert"
              disabled={busy || !dirty}
              onClick={onRevert}
            >
              <RotateCcw aria-hidden="true" />
              还原
            </button>
          </div>
          <footer>
            <button
              type="button"
              className="thread-goal-dialog-secondary"
              disabled={busy}
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="submit"
              className="thread-goal-dialog-primary"
              disabled={busy || !trimmed || !dirty}
            >
              {busy && <LoaderCircle className="thread-goal-spinner" aria-hidden="true" />}
              保存
            </button>
          </footer>
        </form>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export function ThreadGoalResumeDialog({
  goal,
  busy = false,
  onDismiss,
  onResume
}: ThreadGoalResumeDialogProps): ReactNode {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!goal || !threadGoalNeedsResumeConfirmation(goal.status)) return
    const previousFocus = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()
    return () => previousFocus?.focus({ preventScroll: true })
  }, [goal])

  useEffect(() => {
    if (!goal || !threadGoalNeedsResumeConfirmation(goal.status)) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) void onDismiss()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || []
      )
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, goal, onDismiss])

  if (!goal || !threadGoalNeedsResumeConfirmation(goal.status)) return null
  const paused = goal.status === 'paused'
  const dialog = (
    <div
      className="thread-goal-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) void onDismiss()
      }}
    >
      <section
        ref={dialogRef}
        className="thread-goal-dialog thread-goal-resume-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <form onSubmit={(event) => {
          event.preventDefault()
          if (!busy) void onResume()
        }}>
          <header className="thread-goal-resume-heading">
            <h2 id={titleId}>{paused ? '恢复已暂停的目标吗？' : '恢复目标？'}</h2>
            <p>聊天处于空闲状态时，ChatGPT 会继续推进此目标</p>
          </header>
          <div className="thread-goal-resume-objective">{goal.objective}</div>
          <footer>
            <button
              type="button"
              className="thread-goal-dialog-secondary"
              disabled={busy}
              onClick={() => { void onDismiss() }}
            >
              {paused ? '保持已暂停' : '以后再说'}
            </button>
            <button
              ref={primaryRef}
              type="submit"
              className="thread-goal-dialog-primary"
              disabled={busy}
            >
              {busy && <LoaderCircle className="thread-goal-spinner" aria-hidden="true" />}
              继续目标
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export function ThreadGoalReplaceDialog({
  objective,
  busy = false,
  onDismiss,
  onReplace
}: ThreadGoalReplaceDialogProps): ReactNode {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!objective) return
    const previousFocus = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()
    return () => previousFocus?.focus({ preventScroll: true })
  }, [objective])

  useEffect(() => {
    if (!objective) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) void onDismiss()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || []
      )
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, objective, onDismiss])

  if (!objective) return null
  const dialog = (
    <div
      className="thread-goal-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) void onDismiss()
      }}
    >
      <section
        ref={dialogRef}
        className="thread-goal-dialog thread-goal-resume-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <form onSubmit={(event) => {
          event.preventDefault()
          if (!busy) void onReplace()
        }}>
          <header className="thread-goal-resume-heading">
            <h2 id={titleId}>替换当前目标吗？</h2>
            <p>这会保留聊天，但会用你当前在输入框中的文本替换已保存的目标</p>
          </header>
          <div className="thread-goal-resume-objective">{objective}</div>
          <footer>
            <button
              type="button"
              className="thread-goal-dialog-secondary"
              disabled={busy}
              onClick={() => { void onDismiss() }}
            >
              取消
            </button>
            <button
              ref={primaryRef}
              type="submit"
              className="thread-goal-dialog-primary"
              disabled={busy}
            >
              {busy && <LoaderCircle className="thread-goal-spinner" aria-hidden="true" />}
              替换目标
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export function ThreadGoalBar({
  goal,
  disabled = false,
  busy = false,
  busyAction = null,
  locale,
  nowMs,
  onClear,
  onStatusChange,
  onSaveObjective,
  onLoadObjective,
  onError
}: ThreadGoalBarProps): ReactNode {
  const [clockNow, setClockNow] = useState(() => nowMs ?? Date.now())
  const [localBusyAction, setLocalBusyAction] = useState<ThreadGoalAction | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [sourceObjective, setSourceObjective] = useState(goal.objective)
  const [draftObjective, setDraftObjective] = useState(goal.objective)
  const [actionError, setActionError] = useState<string | null>(null)
  const actionInFlight = useRef(false)

  const pendingAction = busyAction ?? localBusyAction
  const actionDisabled = disabled || busy || pendingAction !== null
  const nextStatus = nextThreadGoalStatus(goal.status)

  useEffect(() => {
    if (nowMs !== undefined) setClockNow(nowMs)
  }, [nowMs])

  useEffect(() => {
    if (goal.status !== 'active' || nowMs !== undefined) return
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [goal.status, nowMs])

  useEffect(() => {
    if (goal.status === 'complete') {
      setEditorOpen(false)
      return
    }
    if (!editorOpen) {
      setSourceObjective(goal.objective)
      setDraftObjective(goal.objective)
    } else if (goal.objective !== sourceObjective) {
      // The shipped editor closes when its source objective changes underneath it.
      setEditorOpen(false)
      setSourceObjective(goal.objective)
      setDraftObjective(goal.objective)
    }
  }, [editorOpen, goal.objective, goal.status, sourceObjective])

  const runAction = async (
    action: ThreadGoalAction,
    operation: () => void | Promise<void>
  ): Promise<boolean> => {
    if (actionDisabled || actionInFlight.current) return false
    actionInFlight.current = true
    setLocalBusyAction(action)
    setActionError(null)
    try {
      await operation()
      return true
    } catch (error) {
      setActionError(ACTION_ERROR[action])
      onError?.(error, action)
      return false
    } finally {
      actionInFlight.current = false
      setLocalBusyAction(null)
    }
  }

  const openEditor = async (): Promise<void> => {
    if (actionDisabled || actionInFlight.current) return
    let objective = goal.objective
    if (onLoadObjective) {
      const loaded = await runAction('load-edit', async () => {
        objective = await onLoadObjective(goal)
      })
      if (!loaded) return
    }
    setSourceObjective(objective)
    setDraftObjective(objective)
    setEditorOpen(true)
  }

  const saveObjective = async (): Promise<void> => {
    const objective = draftObjective.trim()
    if (!objective || objective === sourceObjective.trim()) return
    const saved = await runAction('edit', () => onSaveObjective(objective))
    if (!saved) return
    setSourceObjective(objective)
    setDraftObjective(objective)
    setEditorOpen(false)
  }

  if (goal.status === 'complete') return null

  const statusActionLabel = nextStatus === 'paused' ? '暂停目标' : '恢复目标'
  const progress = formatThreadGoalProgress(goal, { nowMs: clockNow, locale })

  return (
    <>
      <section
        className="thread-goal-bar"
        aria-label="线程目标"
        aria-busy={(busy || pendingAction !== null) || undefined}
        data-goal-status={goal.status}
      >
        <button
          type="button"
          className="thread-goal-summary"
          disabled={actionDisabled}
          onClick={() => { void openEditor() }}
        >
          <GoalIcon className="thread-goal-icon" aria-hidden="true" />
          <span className="thread-goal-status">{threadGoalStatusLabel(goal.status)}</span>
          <span className="thread-goal-objective" title={goal.objective}>
            {goal.objective}<span aria-hidden="true"> •</span>
          </span>
          <span className="thread-goal-progress">{progress}</span>
        </button>
        <div className="thread-goal-actions">
          <GoalActionButton
            label="清除目标"
            disabled={actionDisabled}
            loading={pendingAction === 'clear'}
            onClick={() => { void runAction('clear', onClear) }}
          >
            <X aria-hidden="true" />
          </GoalActionButton>
          {nextStatus && (
            <GoalActionButton
              label={statusActionLabel}
              disabled={actionDisabled}
              loading={pendingAction === 'status'}
              onClick={() => { void runAction('status', () => onStatusChange(nextStatus)) }}
            >
              {nextStatus === 'paused'
                ? <Pause aria-hidden="true" />
                : <Play aria-hidden="true" />}
            </GoalActionButton>
          )}
          <GoalActionButton
            label="编辑目标"
            disabled={actionDisabled}
            loading={pendingAction === 'load-edit'}
            onClick={() => { void openEditor() }}
          >
            <Pencil aria-hidden="true" />
          </GoalActionButton>
        </div>
        {actionError && <span className="thread-goal-live-error" role="status">{actionError}</span>}
      </section>
      {editorOpen && (
        <GoalEditor
          objective={draftObjective}
          sourceObjective={sourceObjective}
          updatedAt={goal.updatedAt}
          busy={pendingAction === 'edit' || busy}
          error={actionError === ACTION_ERROR.edit ? actionError : null}
          locale={locale}
          nowMs={clockNow}
          onChange={setDraftObjective}
          onCancel={() => setEditorOpen(false)}
          onSave={() => { void saveObjective() }}
          onRevert={() => setDraftObjective(sourceObjective)}
        />
      )}
    </>
  )
}

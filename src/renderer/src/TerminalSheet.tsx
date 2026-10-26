import {
  CircleAlert,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelBottom,
  PanelRight,
  RefreshCw,
  TerminalSquare,
  Trash2,
  X
} from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import {
  backgroundTerminalStatus,
  mergeBackgroundTerminals,
  normalizeBackgroundTerminalsPage,
  normalizeTerminateResponse,
  shouldRefreshBackgroundTerminals,
  type ThreadBackgroundTerminal
} from './backgroundTerminals'
import {
  clampTerminalPanelSize,
  DEFAULT_TERMINAL_PANEL_SIZE,
  shouldCollapseTerminalPanel,
  terminalPanelDragSize,
  terminalPanelKeyboardSize,
  terminalPanelSizeLimits,
  type TerminalPanelPlacement,
  type TerminalPanelPresentation
} from './terminalPanelLayout'
import './TerminalSheet.css'

export interface TerminalSheetProps {
  threadId: string
  threadTitle: string
  presentation?: TerminalPanelPresentation
  placement?: TerminalPanelPlacement
  size?: number
  fullView?: boolean
  uiZoom?: number
  onSizeChange?(size: number, placement: TerminalPanelPlacement): void
  onPlacementChange?(placement: TerminalPanelPlacement): void
  onToggleFullView?(): void
  onClose(): void
}

type Confirmation =
  | { type: 'terminate'; processId: string }
  | { type: 'clean' }
  | null

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

export function TerminalRows({
  terminals,
  busyProcessId,
  onRequestTerminate
}: {
  terminals: ThreadBackgroundTerminal[]
  busyProcessId: string | null
  onRequestTerminate(processId: string): void
}): ReactNode {
  return terminals.map((terminal) => {
    const terminating = busyProcessId === terminal.processId
    return (
      <article className="terminal-row" key={terminal.processId}>
        <span className="terminal-row-icon" aria-hidden="true">
          <TerminalSquare />
        </span>
        <div className="terminal-row-body">
          <code className="terminal-command">{terminal.command || 'Background command'}</code>
          <div className="terminal-metadata">
            <span className="terminal-running-status">
              <span aria-hidden="true" />
              {terminating ? 'Terminating…' : backgroundTerminalStatus()}
            </span>
            <span>
              Process ID <code>{terminal.processId}</code>
            </span>
          </div>
        </div>
        <button
          type="button"
          className="terminal-terminate-button"
          disabled={busyProcessId !== null}
          onClick={() => onRequestTerminate(terminal.processId)}
        >
          Terminate…
        </button>
      </article>
    )
  })
}

export function TerminalSheet({
  threadId,
  threadTitle,
  presentation = 'sheet',
  placement = 'bottom',
  size,
  fullView = false,
  uiZoom = 1,
  onSizeChange,
  onPlacementChange,
  onToggleFullView,
  onClose
}: TerminalSheetProps): ReactNode {
  const docked = presentation === 'docked'
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
  const panelId = useId()
  const titleId = `${panelId}-title`
  const [terminals, setTerminals] = useState<ThreadBackgroundTerminal[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operationNotice, setOperationNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [busyAction, setBusyAction] = useState<'clean' | string | null>(null)
  const [panelSizes, setPanelSizes] = useState(DEFAULT_TERMINAL_PANEL_SIZE)
  const [availableSize, setAvailableSize] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const requestSequence = useRef(0)
  const seenCursors = useRef(new Set<string>())
  const cleanRefreshTimer = useRef<number | null>(null)
  const activeThreadId = useRef(threadId)
  activeThreadId.current = threadId
  const lifecycle = useRef(0)
  const resizeGesture = useRef<{
    pointerId: number
    element: HTMLElement
    startCoordinate: number
    startSize: number
  } | null>(null)
  const effectiveSize = clampTerminalPanelSize(
    size ?? panelSizes[placement],
    placement,
    availableSize,
    fullView
  )
  const sizeLimits = terminalPanelSizeLimits(placement, availableSize, fullView)

  const commitPanelSize = useCallback((requested: number): void => {
    const next = clampTerminalPanelSize(requested, placement, availableSize)
    setPanelSizes((current) => ({ ...current, [placement]: next }))
    onSizeChange?.(next, placement)
  }, [availableSize, onSizeChange, placement])

  const finishResize = useCallback((): void => {
    const gesture = resizeGesture.current
    resizeGesture.current = null
    if (gesture?.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId)
    }
    setResizing(false)
  }, [])

  useEffect(() => finishResize, [docked, fullView, placement, finishResize, zoom])

  useEffect(() => {
    if (!docked) return
    const parent = dialogRef.current?.parentElement
    if (!parent) return
    const measure = (): void => {
      const bounds = parent.getBoundingClientRect()
      setAvailableSize((placement === 'bottom' ? bounds.height : bounds.width) / zoom)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [docked, placement, zoom])

  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeGesture.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      startCoordinate: (placement === 'bottom' ? event.clientY : event.clientX) / zoom,
      startSize: effectiveSize
    }
    setResizing(true)
  }

  const updateResize = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const coordinate = (placement === 'bottom' ? event.clientY : event.clientX) / zoom
    const requested = terminalPanelDragSize(gesture.startSize, gesture.startCoordinate, coordinate)
    if (shouldCollapseTerminalPanel(requested, placement)) {
      finishResize()
      onClose()
    } else commitPanelSize(requested)
  }

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = terminalPanelKeyboardSize(
      event.key, effectiveSize, placement, availableSize, event.shiftKey
    )
    if (next !== null) {
      event.preventDefault()
      event.stopPropagation()
      commitPanelSize(next)
    }
  }

  const loadPage = useCallback(
    async (cursor: string | null, append: boolean, silent = false): Promise<void> => {
      if (activeThreadId.current !== threadId) return
      const generation = lifecycle.current
      const sequence = ++requestSequence.current
      if (!append) seenCursors.current.clear()
      if (append) setLoadingMore(true)
      else if (!silent) setLoading(true)
      if (!silent) setOperationNotice(null)
      setError(null)
      try {
        const params: { threadId: string; limit: number; cursor?: string } = {
          threadId,
          limit: 100
        }
        if (cursor !== null) params.cursor = cursor
        const response = await window.codex.invoke<unknown>(
          'thread/backgroundTerminals/list',
          params
        )
        const page = normalizeBackgroundTerminalsPage(response)
        if (generation !== lifecycle.current || sequence !== requestSequence.current) return
        if (page.nextCursor && seenCursors.current.has(page.nextCursor)) {
          throw new Error('The app-server repeated a background-terminal cursor')
        }
        if (page.nextCursor) seenCursors.current.add(page.nextCursor)
        setTerminals((current) =>
          append ? mergeBackgroundTerminals(current, page.data) : page.data
        )
        setNextCursor(page.nextCursor)
      } catch (loadError) {
        if (generation === lifecycle.current && sequence === requestSequence.current) {
          setError(displayError(loadError))
        }
      } finally {
        if (generation === lifecycle.current && sequence === requestSequence.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [threadId]
  )

  useEffect(() => {
    lifecycle.current += 1
    setTerminals([])
    setNextCursor(null)
    setConfirmation(null)
    setBusyAction(null)
    setOperationNotice(null)
    void loadPage(null, false)
    return () => {
      lifecycle.current += 1
      requestSequence.current += 1
      if (cleanRefreshTimer.current !== null) {
        window.clearTimeout(cleanRefreshTimer.current)
      }
    }
  }, [loadPage])

  useEffect(() => {
    if (docked) return
    previousFocus.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
    }
  }, [docked])

  useEffect(
    () =>
      window.codex.onNotification((notification) => {
        if (shouldRefreshBackgroundTerminals(notification, threadId)) {
          void loadPage(null, false, true)
        }
      }),
    [loadPage, threadId]
  )

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (docked && !dialogRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      if (confirmation) setConfirmation(null)
      else onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [confirmation, docked, onClose])

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (docked || event.key !== 'Tab' || !dialogRef.current) return
    const focusable = focusableElements(dialogRef.current)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget && busyAction === null) onClose()
  }

  const confirmTerminate = async (processId: string): Promise<void> => {
    const generation = lifecycle.current
    setBusyAction(processId)
    setError(null)
    try {
      const response = normalizeTerminateResponse(
        await window.codex.invoke<unknown>('thread/backgroundTerminals/terminate', {
          threadId,
          processId
        })
      )
      if (generation !== lifecycle.current) return
      if (!response.terminated) {
        throw new Error('The app-server did not terminate this background process')
      }
      setConfirmation(null)
      setTerminals((current) =>
        current.filter((terminal) => terminal.processId !== processId)
      )
      await loadPage(null, false, true)
    } catch (terminateError) {
      if (generation === lifecycle.current) setError(displayError(terminateError))
    } finally {
      if (generation === lifecycle.current) setBusyAction(null)
    }
  }

  const confirmClean = async (): Promise<void> => {
    const generation = lifecycle.current
    setBusyAction('clean')
    setError(null)
    try {
      await window.codex.invoke('thread/backgroundTerminals/clean', { threadId })
      if (generation !== lifecycle.current) return
      setConfirmation(null)
      setTerminals([])
      setNextCursor(null)
      setOperationNotice('Stopping all background terminals…')
      if (cleanRefreshTimer.current !== null) {
        window.clearTimeout(cleanRefreshTimer.current)
      }
      cleanRefreshTimer.current = window.setTimeout(() => {
        cleanRefreshTimer.current = null
        if (generation !== lifecycle.current) return
        void loadPage(null, false, true).finally(() => {
          if (generation === lifecycle.current) setOperationNotice(null)
        })
      }, 750)
    } catch (cleanError) {
      if (generation === lifecycle.current) setError(displayError(cleanError))
    } finally {
      if (generation === lifecycle.current) setBusyAction(null)
    }
  }

  const panel = (
      <section
        id={panelId}
        ref={dialogRef}
        className={[
          'terminal-sheet',
          docked && 'terminal-sheet-docked',
          docked && `terminal-placement-${placement}`,
          docked && fullView && 'terminal-panel-full-view',
          resizing && 'terminal-panel-resizing'
        ].filter(Boolean).join(' ')}
        style={docked ? { '--terminal-panel-size': `${effectiveSize}px` } as CSSProperties : undefined}
        role={docked ? 'region' : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby={titleId}
        data-presentation={presentation}
        data-placement={docked ? placement : undefined}
        onKeyDown={onDialogKeyDown}
      >
        {docked && !fullView && (
          <div
            className="terminal-panel-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label={`Resize ${placement === 'bottom' ? 'bottom' : 'right'} terminal panel`}
            aria-controls={panelId}
            aria-orientation={placement === 'bottom' ? 'horizontal' : 'vertical'}
            aria-valuemin={sizeLimits.minimum}
            aria-valuemax={Number.isFinite(sizeLimits.maximum) ? sizeLimits.maximum : undefined}
            aria-valuenow={Math.round(effectiveSize)}
            onPointerDown={beginResize}
            onPointerMove={updateResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={finishResize}
            onKeyDown={resizeFromKeyboard}
            onDoubleClick={() => commitPanelSize(DEFAULT_TERMINAL_PANEL_SIZE[placement])}
          />
        )}
        <header className="terminal-sheet-header">
          <div>
            <span className="terminal-sheet-title-icon" aria-hidden="true">
              <TerminalSquare />
            </span>
            <div>
              <h2 id={titleId}>Background terminals</h2>
              <p>{threadTitle}</p>
            </div>
          </div>
          <div className="terminal-sheet-header-actions">
            {docked && onPlacementChange && (
              <button
                type="button"
                className="quiet-icon-button"
                onClick={() => onPlacementChange(placement === 'bottom' ? 'right' : 'bottom')}
                aria-label={`Move terminal panel to ${placement === 'bottom' ? 'right' : 'bottom'}`}
                title={`Move to ${placement === 'bottom' ? 'right' : 'bottom'}`}
              >
                {placement === 'bottom' ? <PanelRight /> : <PanelBottom />}
              </button>
            )}
            {docked && onToggleFullView && (
              <button
                type="button"
                className="quiet-icon-button"
                onClick={onToggleFullView}
                aria-label={fullView ? 'Exit terminal full view' : 'Show terminal in full view'}
                title={fullView ? 'Exit full view' : 'Full view'}
                aria-pressed={fullView}
              >
                {fullView ? <Minimize2 /> : <Maximize2 />}
              </button>
            )}
            <button
              type="button"
              className="quiet-icon-button"
              disabled={loading || busyAction !== null}
              onClick={() => void loadPage(null, false)}
              aria-label="Refresh background terminals"
              title="Refresh"
            >
              <RefreshCw className={loading ? 'spin' : undefined} />
            </button>
            <button
              ref={closeRef}
              type="button"
              className="quiet-icon-button"
              disabled={busyAction !== null}
              onClick={onClose}
              aria-label="Close background terminals"
            >
              <X />
            </button>
          </div>
        </header>

        <div className="terminal-toolbar">
          <span>{terminals.length}{nextCursor ? '+' : ''} running</span>
          <button
            type="button"
            className="terminal-clean-button"
            disabled={terminals.length === 0 || loading || busyAction !== null}
            onClick={() => setConfirmation({ type: 'clean' })}
          >
            <Trash2 />
            Clean all…
          </button>
        </div>

        {error && (
          <div className="terminal-error" role="alert">
            <CircleAlert />
            <span>{error}</span>
            <button type="button" onClick={() => void loadPage(null, false)}>
              Retry
            </button>
          </div>
        )}

        {operationNotice && (
          <div className="terminal-operation-notice" role="status">
            <LoaderCircle className="spin" />
            <span>{operationNotice}</span>
          </div>
        )}

        <div className="terminal-list" aria-live="polite" aria-busy={loading}>
          {loading && terminals.length === 0 ? (
            <div className="terminal-empty-state">
              <LoaderCircle className="spin" />
              <span>Checking background terminals…</span>
            </div>
          ) : terminals.length === 0 ? (
            <div className="terminal-empty-state">
              <TerminalSquare />
              <strong>No background terminals</strong>
              <span>Commands running in the background will appear here.</span>
            </div>
          ) : (
            <TerminalRows
              terminals={terminals}
              busyProcessId={busyAction}
              onRequestTerminate={(processId) =>
                setConfirmation({ type: 'terminate', processId })
              }
            />
          )}
          {nextCursor && (
            <button
              type="button"
              className="terminal-load-more"
              disabled={loadingMore || busyAction !== null}
              onClick={() => void loadPage(nextCursor, true)}
            >
              {loadingMore && <LoaderCircle className="spin" />}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>

        {confirmation && (
          <footer className="terminal-confirmation" role="group" aria-label="Confirm terminal action">
            <div>
              <strong>
                {confirmation.type === 'clean'
                  ? 'Stop all background terminals?'
                  : 'Terminate this background terminal?'}
              </strong>
              <span>
                {confirmation.type === 'clean'
                  ? 'Every running background terminal associated with this chat will be stopped.'
                  : <>Process ID <code>{confirmation.processId}</code> will be asked to terminate.</>}
              </span>
            </div>
            <div>
              <button
                type="button"
                className="terminal-cancel-button"
                disabled={busyAction !== null}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="terminal-confirm-button"
                disabled={busyAction !== null}
                onClick={() =>
                  confirmation.type === 'clean'
                    ? void confirmClean()
                    : void confirmTerminate(confirmation.processId)
                }
              >
                {busyAction !== null && <LoaderCircle className="spin" />}
                {confirmation.type === 'clean' ? 'Stop all' : 'Terminate'}
              </button>
            </div>
          </footer>
        )}
      </section>
  )

  return docked ? panel : (
    <div className="terminal-backdrop" role="presentation" onMouseDown={closeFromBackdrop}>
      {panel}
    </div>
  )
}

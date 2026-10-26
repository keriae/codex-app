import { CircleAlert, LoaderCircle, Maximize2, Minimize2, PanelBottom, PanelRight, RotateCw, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react'
import { InteractiveTerminalRuntime } from './interactiveTerminalRuntime'
import { TerminalGlyph } from './terminalGlyph'
import { type TerminalPanelDockProps, useTerminalPanelDock } from './useTerminalPanelDock'
export { hasInteractiveTerminalBridge, TerminalStartupEventBuffer } from './interactiveTerminalRuntime'
export type { InteractiveTerminalBridge, InteractiveTerminalEvent } from './interactiveTerminalRuntime'
import '@xterm/xterm/css/xterm.css'
import './InteractiveTerminal.css'

export interface InteractiveTerminalProps extends TerminalPanelDockProps {
  cwd: string
  title?: string
  fontSize?: number
  fontFamily?: string
  autoFocus?: boolean
  active?: boolean
  presentation?: 'panel' | 'tab'
  runtime?: InteractiveTerminalRuntime
  labelledBy?: string
  panelId?: string
}

export function InteractiveTerminal(props: InteractiveTerminalProps): ReactNode {
  const { cwd, title = 'Terminal', fontSize = 12, fontFamily = '"SFMono-Regular", Menlo, Monaco, Consolas, monospace', autoFocus = true, active = true, presentation = 'panel', runtime: retainedRuntime, uiZoom = 1, labelledBy, onPlacementChange, onToggleFullView, onClose } = props
  const generatedId = useId()
  const id = props.panelId ?? generatedId
  const panelRef = useRef<HTMLElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const runtime = useMemo(() => retainedRuntime ?? new InteractiveTerminalRuntime({ cwd }), [retainedRuntime, cwd])
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const tab = presentation === 'tab'
  const dock = useTerminalPanelDock(panelRef, { ...props, enabled: !tab })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!retainedRuntime) runtime.retain()
    runtime.attach(host)
    return () => {
      runtime.detach(host)
      // Tab runtimes belong to the shared controller, even while their panel is hidden.
      if (!retainedRuntime) runtime.release()
    }
  }, [retainedRuntime, runtime])

  useEffect(() => {
    runtime.configure({ fontFamily, fontSize, uiZoom })
    if (!active || !autoFocus) return
    const frame = window.requestAnimationFrame(() => runtime.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [active, autoFocus, fontFamily, fontSize, runtime, snapshot.state, uiZoom])

  return (
    <section
      id={id}
      ref={panelRef}
      className={tab ? 'interactive-terminal interactive-terminal-session' : `interactive-terminal terminal-placement-${dock.placement}${dock.fullView ? ' terminal-panel-full-view' : ''}${dock.resizing ? ' terminal-panel-resizing' : ''}`}
      style={tab ? undefined : dock.style}
      role={tab ? 'tabpanel' : 'region'}
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      hidden={!active}
      data-terminal-state={snapshot.state}
      data-terminal-session-id={snapshot.sessionId ?? undefined}
      data-placement={dock.placement}
    >
      {!tab && !dock.fullView && (
        <div className="terminal-panel-resize-handle" role="separator" tabIndex={0}
          aria-label={`Resize ${dock.placement} terminal panel`} aria-controls={id}
          aria-orientation={dock.placement === 'bottom' ? 'horizontal' : 'vertical'}
          aria-valuemin={dock.limits.minimum} aria-valuemax={Number.isFinite(dock.limits.maximum) ? dock.limits.maximum : undefined}
          aria-valuenow={Math.round(dock.size)} {...dock.resizeHandlers} />
      )}
      {!tab && (
        <header className="interactive-terminal-header">
          <div className="interactive-terminal-title" title={cwd}><TerminalGlyph /><span>{title}</span></div>
          <div className="interactive-terminal-actions">
            {onPlacementChange && <button type="button" className="quiet-icon-button" onClick={() => onPlacementChange(dock.placement === 'bottom' ? 'right' : 'bottom')} aria-label={`Move terminal panel to ${dock.placement === 'bottom' ? 'right' : 'bottom'}`} title={`Move to ${dock.placement === 'bottom' ? 'right' : 'bottom'}`}>{dock.placement === 'bottom' ? <PanelRight /> : <PanelBottom />}</button>}
            {onToggleFullView && <button type="button" className="quiet-icon-button" onClick={onToggleFullView} aria-label={dock.fullView ? 'Exit terminal full view' : 'Show terminal in full view'} aria-pressed={dock.fullView} title={dock.fullView ? 'Exit full view' : 'Full view'}>{dock.fullView ? <Minimize2 /> : <Maximize2 />}</button>}
            <button type="button" className="quiet-icon-button" onClick={onClose} aria-label="Close terminal" title="Close terminal"><X /></button>
          </div>
        </header>
      )}
      <div className="interactive-terminal-body" ref={hostRef} />
      {snapshot.state === 'starting' && <div className="interactive-terminal-starting" role="status"><LoaderCircle className="spin" /><span>Starting terminal…</span></div>}
      {(snapshot.error || snapshot.state === 'exited') && (
        <footer className={`interactive-terminal-status${snapshot.error ? ' is-error' : ''}`} role={snapshot.error ? 'alert' : 'status'}>
          {snapshot.error && <CircleAlert />}
          <span>{snapshot.error || `Process exited${snapshot.exitCode === null ? '' : ` (${snapshot.exitCode})`}`}</span>
          <button type="button" onClick={() => { void runtime.restart() }}><RotateCw />Restart</button>
        </footer>
      )}
    </section>
  )
}

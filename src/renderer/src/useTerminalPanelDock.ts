import { type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import {
  clampTerminalPanelSize,
  DEFAULT_TERMINAL_PANEL_SIZE,
  shouldCollapseTerminalPanel,
  terminalPanelDragSize,
  terminalPanelKeyboardSize,
  terminalPanelSizeLimits,
  type TerminalPanelPlacement
} from './terminalPanelLayout'

export interface TerminalPanelDockProps {
  placement?: TerminalPanelPlacement
  size?: number
  fullView?: boolean
  uiZoom?: number
  enabled?: boolean
  onSizeChange?(size: number, placement: TerminalPanelPlacement): void
  onPlacementChange?(placement: TerminalPanelPlacement): void
  onToggleFullView?(): void
  onClose(): void
}

export function useTerminalPanelDock(
  panel: RefObject<HTMLElement | null>,
  { placement = 'bottom', size, fullView = false, uiZoom = 1, enabled = true, onSizeChange, onClose }: TerminalPanelDockProps
) {
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
  const [sizes, setSizes] = useState(DEFAULT_TERMINAL_PANEL_SIZE)
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const gesture = useRef<{
    pointerId: number
    element: HTMLElement
    coordinate: number
    size: number
  } | null>(null)
  const available = bounds ? (placement === 'bottom' ? bounds.height : bounds.width) : null
  const actualSize = clampTerminalPanelSize(size ?? sizes[placement], placement, available, fullView)
  const limits = terminalPanelSizeLimits(placement, available, fullView)

  const finish = useCallback((): void => {
    const active = gesture.current
    gesture.current = null
    if (active?.element.hasPointerCapture(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId)
    }
    setResizing(false)
  }, [])

  useEffect(() => finish, [enabled, finish, fullView, placement, zoom])

  useEffect(() => {
    if (!enabled) return
    const parent = panel.current?.parentElement
    if (!parent) return
    const measure = (): void => {
      const rect = parent.getBoundingClientRect()
      setBounds({ width: rect.width / zoom, height: rect.height / zoom })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [enabled, panel, placement, zoom])

  const commit = (requested: number): void => {
    const next = clampTerminalPanelSize(requested, placement, available)
    setSizes((current) => ({ ...current, [placement]: next }))
    onSizeChange?.(next, placement)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      coordinate: (placement === 'bottom' ? event.clientY : event.clientX) / zoom,
      size: actualSize
    }
    setResizing(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const coordinate = (placement === 'bottom' ? event.clientY : event.clientX) / zoom
    const requested = terminalPanelDragSize(active.size, active.coordinate, coordinate)
    if (shouldCollapseTerminalPanel(requested, placement)) {
      finish()
      onClose()
    } else commit(requested)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = terminalPanelKeyboardSize(event.key, actualSize, placement, available, event.shiftKey)
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    commit(next)
  }

  return {
    placement,
    fullView,
    resizing,
    size: actualSize,
    limits,
    style: { '--terminal-panel-size': `${actualSize}px` } as CSSProperties,
    resizeHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown,
      onDoubleClick: () => commit(DEFAULT_TERMINAL_PANEL_SIZE[placement])
    }
  }
}

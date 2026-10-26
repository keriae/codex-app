import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

export const RIGHT_WORKBENCH_MIN_WIDTH = 320
export const RIGHT_WORKBENCH_DEFAULT_WIDTH = 600
export const RIGHT_WORKBENCH_DEFAULT_MAX_WIDTH = 640
export const RIGHT_WORKBENCH_REGULAR_REMAINDER = 352
export const RIGHT_WORKBENCH_UNIFIED_REMAINDER = 320
// The upstream split view keeps a roughly 640px conversation column at the
// recorded desktop geometry. The previous 500px remainder made the workspace
// consume almost seventy percent of the window and visibly crowded the chat.
export const RIGHT_WORKBENCH_DEFAULT_CHAT_WIDTH = 640
export const RIGHT_WORKBENCH_HEIGHT_RATIO = 1.6
export const RIGHT_WORKBENCH_RESIZE_HANDLE_WIDTH = 16
export const RIGHT_WORKBENCH_KEYBOARD_STEP = 10
export const RIGHT_WORKBENCH_WIDTH_ATOM_KEY = 'app-shell:right-panel-width:v3'
export const RIGHT_WORKBENCH_WIDTH_STORAGE_KEY =
  `codex:persisted-atom:${RIGHT_WORKBENCH_WIDTH_ATOM_KEY}`

export type RightWorkbenchWidthMode = 'regular' | 'unified' | 'full'

export interface RightWorkbenchWidthBounds {
  minimum: number
  maximum: number
}

export interface RightWorkbenchStoredWidth {
  ratio: number
  source: 'default' | 'ratio' | 'legacy-pixels'
  migrated: boolean
}

export interface RightWorkbenchSize {
  width: number
  height: number
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function clampRightWorkbenchRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  return Math.max(0, Math.min(1, ratio))
}

export function rightWorkbenchMaximumWidth(
  workspaceWidth: number,
  widthMode: RightWorkbenchWidthMode = 'regular'
): number {
  const safeWidth = Number.isFinite(workspaceWidth)
    ? Math.max(0, workspaceWidth)
    : RIGHT_WORKBENCH_MIN_WIDTH
  if (widthMode === 'full') {
    return Math.max(RIGHT_WORKBENCH_MIN_WIDTH, safeWidth)
  }
  const remainder = widthMode === 'unified'
    ? RIGHT_WORKBENCH_UNIFIED_REMAINDER
    : RIGHT_WORKBENCH_REGULAR_REMAINDER
  return Math.max(RIGHT_WORKBENCH_MIN_WIDTH, safeWidth - remainder)
}

export function rightWorkbenchWidthBounds(
  workspaceWidth: number,
  widthMode: RightWorkbenchWidthMode = 'regular'
): RightWorkbenchWidthBounds {
  const maximum = rightWorkbenchMaximumWidth(workspaceWidth, widthMode)
  return {
    minimum: Math.min(RIGHT_WORKBENCH_MIN_WIDTH, maximum),
    maximum
  }
}

/**
 * Codex uses 600 as a sentinel for its responsive default, not as a fixed
 * pixel width. A caller-provided width other than that sentinel is left as-is
 * and clamped later against the current layout bounds.
 */
export function rightWorkbenchDefaultWidth({
  defaultWidth = RIGHT_WORKBENCH_DEFAULT_WIDTH,
  workspaceWidth,
  shellHeight
}: {
  defaultWidth?: number
  workspaceWidth: number
  shellHeight: number
}): number {
  if (defaultWidth !== RIGHT_WORKBENCH_DEFAULT_WIDTH) return defaultWidth

  const safeWidth = Number.isFinite(workspaceWidth) ? workspaceWidth : 0
  const safeHeight = Number.isFinite(shellHeight) ? shellHeight : 0
  return Math.max(
    RIGHT_WORKBENCH_MIN_WIDTH,
    Math.min(
      safeHeight * RIGHT_WORKBENCH_HEIGHT_RATIO,
      safeWidth - RIGHT_WORKBENCH_DEFAULT_CHAT_WIDTH
    ),
    Math.min(
      RIGHT_WORKBENCH_DEFAULT_MAX_WIDTH,
      safeWidth - RIGHT_WORKBENCH_REGULAR_REMAINDER
    )
  )
}

export function clampRightWorkbenchWidth(
  width: number,
  workspaceWidth: number,
  widthMode: RightWorkbenchWidthMode = 'regular'
): number {
  const { minimum, maximum } = rightWorkbenchWidthBounds(workspaceWidth, widthMode)
  const safeWidth = Number.isFinite(width) ? width : RIGHT_WORKBENCH_DEFAULT_WIDTH
  return Math.max(minimum, Math.min(safeWidth, maximum))
}

export function rightWorkbenchWidthToRatio(
  width: number,
  workspaceWidth: number,
  widthMode: RightWorkbenchWidthMode = 'regular'
): number {
  const { minimum, maximum } = rightWorkbenchWidthBounds(workspaceWidth, widthMode)
  const range = maximum - minimum
  if (range === 0) return 0
  const clampedWidth = clampRightWorkbenchWidth(width, workspaceWidth, widthMode)
  return clampRightWorkbenchRatio((clampedWidth - minimum) / range)
}

export function rightWorkbenchRatioToWidth(
  ratio: number,
  workspaceWidth: number,
  widthMode: RightWorkbenchWidthMode = 'regular'
): number {
  const { minimum, maximum } = rightWorkbenchWidthBounds(workspaceWidth, widthMode)
  return clampRightWorkbenchWidth(
    minimum + clampRightWorkbenchRatio(ratio) * (maximum - minimum),
    workspaceWidth,
    widthMode
  )
}

/** Reads the JSON number used by Codex's persisted-atom storage. */
export function parseRightWorkbenchStoredValue(storedValue: string | null): number | null {
  if (storedValue === null || storedValue.trim() === '') return null
  try {
    const value: unknown = JSON.parse(storedValue)
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Resolves the current ratio and identifies old (> 1) pixel values so a hook
 * can rewrite them in the v3 ratio format after the container is measured.
 */
export function resolveRightWorkbenchStoredWidth({
  storedValue,
  defaultWidth = RIGHT_WORKBENCH_DEFAULT_WIDTH,
  workspaceWidth,
  shellHeight,
  widthMode = 'regular'
}: {
  storedValue: string | null
  defaultWidth?: number
  workspaceWidth: number
  shellHeight: number
  widthMode?: RightWorkbenchWidthMode
}): RightWorkbenchStoredWidth {
  const parsed = parseRightWorkbenchStoredValue(storedValue)
  if (parsed === null) {
    const responsiveDefault = rightWorkbenchDefaultWidth({
      defaultWidth,
      workspaceWidth,
      shellHeight
    })
    return {
      ratio: rightWorkbenchWidthToRatio(responsiveDefault, workspaceWidth, widthMode),
      source: 'default',
      migrated: false
    }
  }
  if (parsed <= 1) {
    return {
      ratio: clampRightWorkbenchRatio(parsed),
      source: 'ratio',
      migrated: false
    }
  }
  return {
    ratio: rightWorkbenchWidthToRatio(parsed, workspaceWidth, widthMode),
    source: 'legacy-pixels',
    migrated: true
  }
}

export function rightWorkbenchWidthStyle(width: number): CSSProperties {
  const value = `${width}px`
  return {
    '--right-workbench-width': value,
    '--right-workbench-titlebar-width': value
  } as CSSProperties
}

export function rightWorkbenchDragWidth(
  startWidth: number,
  startClientX: number,
  clientX: number,
  uiZoom = 1
): number {
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
  return startWidth - (clientX - startClientX) / zoom
}

export function rightWorkbenchKeyboardWidth(
  key: string,
  currentWidth: number,
  minimumWidth: number,
  maximumWidth: number,
  step = RIGHT_WORKBENCH_KEYBOARD_STEP
): number | null {
  if (key === 'Home') return minimumWidth
  if (key === 'End') return maximumWidth
  const safeStep = Number.isFinite(step) && step > 0 ? step : RIGHT_WORKBENCH_KEYBOARD_STEP
  if (key === 'ArrowLeft') {
    return Math.min(maximumWidth, Math.max(minimumWidth, currentWidth + safeStep))
  }
  if (key === 'ArrowRight') {
    return Math.min(maximumWidth, Math.max(minimumWidth, currentWidth - safeStep))
  }
  return null
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function readStoredWidth(storage: StorageLike | null): string | null {
  if (storage === null) return null
  try {
    return storage.getItem(RIGHT_WORKBENCH_WIDTH_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistWidthRatio(storage: StorageLike | null, ratio: number): void {
  if (storage === null) return
  try {
    storage.setItem(
      RIGHT_WORKBENCH_WIDTH_STORAGE_KEY,
      JSON.stringify(clampRightWorkbenchRatio(ratio))
    )
  } catch {
    // Resizing remains usable when localStorage is unavailable.
  }
}

export interface UseRightWorkbenchResizeOptions {
  containerRef: RefObject<HTMLElement | null>
  defaultWidth?: number
  enabled?: boolean
  storage?: StorageLike | null
  uiZoom?: number
  widthMode?: RightWorkbenchWidthMode
}

export interface RightWorkbenchResizeController {
  width: number
  workspaceWidth: number
  shellHeight: number
  min: number
  max: number
  minimumWidth: number
  maximumWidth: number
  defaultWidth: number
  ratio: number
  measured: boolean
  style: CSSProperties
  resize(rawWidth: number): number
  commit(rawWidth?: number): number
  cancel(): void
  reset(): number
}

export function useRightWorkbenchResize({
  containerRef,
  defaultWidth = RIGHT_WORKBENCH_DEFAULT_WIDTH,
  enabled = true,
  storage = browserStorage(),
  uiZoom = 1,
  widthMode = 'regular'
}: UseRightWorkbenchResizeOptions): RightWorkbenchResizeController {
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
  const storedValue = useRef(readStoredWidth(storage))
  const [containerSize, setContainerSize] = useState<RightWorkbenchSize | null>(null)
  const [committedRatio, setCommittedRatio] = useState<number | null>(null)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const liveRawWidth = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (container === null) return

    const measure = (): void => {
      const bounds = container.getBoundingClientRect()
      const next = {
        width: Math.max(0, bounds.width / zoom),
        height: Math.max(0, bounds.height / zoom)
      }
      setContainerSize((current) =>
        current?.width === next.width && current.height === next.height ? current : next
      )
    }

    measure()
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure)
    observer?.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [containerRef, enabled, zoom])

  const workspaceWidth = containerSize?.width ?? RIGHT_WORKBENCH_DEFAULT_WIDTH + RIGHT_WORKBENCH_REGULAR_REMAINDER
  const shellHeight = containerSize?.height ?? 0
  const bounds = rightWorkbenchWidthBounds(workspaceWidth, widthMode)
  const stored = resolveRightWorkbenchStoredWidth({
    storedValue: storedValue.current,
    defaultWidth,
    workspaceWidth,
    shellHeight,
    widthMode
  })
  const ratio = committedRatio ?? stored.ratio
  const responsiveDefault = rightWorkbenchDefaultWidth({
    defaultWidth,
    workspaceWidth,
    shellHeight
  })
  const committedWidth = rightWorkbenchRatioToWidth(ratio, workspaceWidth, widthMode)
  const width = liveWidth === null
    ? committedWidth
    : clampRightWorkbenchWidth(liveWidth, workspaceWidth, widthMode)

  useEffect(() => {
    if (containerSize === null || committedRatio !== null) return
    setCommittedRatio(stored.ratio)
    if (stored.migrated) {
      persistWidthRatio(storage, stored.ratio)
      storedValue.current = JSON.stringify(stored.ratio)
    }
  }, [committedRatio, containerSize, storage, stored.migrated, stored.ratio])

  const resize = useCallback((rawWidth: number): number => {
    liveRawWidth.current = rawWidth
    const next = clampRightWorkbenchWidth(rawWidth, workspaceWidth, widthMode)
    setLiveWidth(next)
    return next
  }, [widthMode, workspaceWidth])

  const commit = useCallback((rawWidth = liveRawWidth.current ?? width): number => {
    const nextRatio = rightWorkbenchWidthToRatio(rawWidth, workspaceWidth, widthMode)
    const nextWidth = rightWorkbenchRatioToWidth(nextRatio, workspaceWidth, widthMode)
    liveRawWidth.current = null
    setLiveWidth(null)
    setCommittedRatio(nextRatio)
    storedValue.current = JSON.stringify(nextRatio)
    persistWidthRatio(storage, nextRatio)
    return nextWidth
  }, [storage, width, widthMode, workspaceWidth])

  const cancel = useCallback((): void => {
    liveRawWidth.current = null
    setLiveWidth(null)
  }, [])

  const reset = useCallback((): number => {
    return commit(responsiveDefault)
  }, [commit, responsiveDefault])

  return {
    width,
    workspaceWidth,
    shellHeight,
    min: bounds.minimum,
    max: bounds.maximum,
    minimumWidth: bounds.minimum,
    maximumWidth: bounds.maximum,
    defaultWidth: clampRightWorkbenchWidth(responsiveDefault, workspaceWidth, widthMode),
    ratio,
    measured: containerSize !== null,
    style: rightWorkbenchWidthStyle(width),
    resize,
    commit,
    cancel,
    reset
  }
}

interface ResizeGesture {
  pointerId: number
  captureTarget: HTMLDivElement
  startClientX: number
  startWidth: number
  lastRawWidth: number
  didMove: boolean
}

export interface RightWorkbenchResizeHandleProps {
  width: number
  minimumWidth: number
  maximumWidth: number
  defaultWidth: number
  onResize(rawWidth: number): void
  onResizeEnd(rawWidth: number): void
  onReset?(): void
  onResizingChange?(resizing: boolean): void
  ariaLabel?: string
  className?: string
  disabled?: boolean
  style?: CSSProperties
  uiZoom?: number
}

export function RightWorkbenchResizeHandle({
  width,
  minimumWidth,
  maximumWidth,
  defaultWidth,
  onResize,
  onResizeEnd,
  onReset,
  onResizingChange,
  ariaLabel = 'Resize workspace panes',
  className,
  disabled = false,
  style,
  uiZoom = 1
}: RightWorkbenchResizeHandleProps): React.JSX.Element {
  const gesture = useRef<ResizeGesture | null>(null)
  const [resizing, setResizing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1

  const setResizeState = useCallback((next: boolean): void => {
    setResizing(next)
    onResizingChange?.(next)
    if (typeof document !== 'undefined') {
      if (next) document.body.dataset.rightWorkbenchResizing = 'true'
      else delete document.body.dataset.rightWorkbenchResizing
    }
  }, [onResizingChange])

  const finishResize = useCallback((event?: PointerEvent, recompute = false): void => {
    const active = gesture.current
    if (active === null || (event !== undefined && event.pointerId !== active.pointerId)) return

    if (event !== undefined && recompute) {
      const rawWidth = rightWorkbenchDragWidth(
        active.startWidth,
        active.startClientX,
        event.clientX,
        zoom
      )
      if (rawWidth !== active.startWidth) active.didMove = true
      if (active.didMove) {
        active.lastRawWidth = rawWidth
        onResize(rawWidth)
      }
    }

    gesture.current = null
    if (active.captureTarget.hasPointerCapture?.(active.pointerId)) {
      active.captureTarget.releasePointerCapture(active.pointerId)
    }
    setResizeState(false)
    if (active.didMove) onResizeEnd(active.lastRawWidth)
  }, [onResize, onResizeEnd, setResizeState, zoom])

  useEffect(() => {
    if (!resizing) return

    const move = (event: PointerEvent): void => {
      const active = gesture.current
      if (active === null || event.pointerId !== active.pointerId) return
      event.preventDefault()
      const rawWidth = rightWorkbenchDragWidth(
        active.startWidth,
        active.startClientX,
        event.clientX,
        zoom
      )
      if (rawWidth !== active.startWidth) active.didMove = true
      if (!active.didMove) return
      active.lastRawWidth = rawWidth
      onResize(rawWidth)
    }
    const up = (event: PointerEvent): void => finishResize(event, true)
    const cancel = (event: PointerEvent): void => finishResize(event)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('lostpointercapture', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('lostpointercapture', cancel)
    }
  }, [finishResize, onResize, resizing, zoom])

  useEffect(() => () => {
    gesture.current = null
    if (typeof document !== 'undefined') {
      delete document.body.dataset.rightWorkbenchResizing
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0 || gesture.current !== null) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startClientX: event.clientX,
      startWidth: width,
      lastRawWidth: width,
      didMove: false
    }
    setResizeState(true)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const next = rightWorkbenchKeyboardWidth(
      event.key,
      width,
      minimumWidth,
      maximumWidth
    )
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onResize(next)
    onResizeEnd(next)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    if (onReset !== undefined) {
      onReset()
      return
    }
    const next = Math.min(maximumWidth, Math.max(minimumWidth, defaultWidth))
    onResize(next)
    onResizeEnd(next)
  }

  const active = resizing || hovered || focused
  const handleStyle = {
    position: 'relative',
    zIndex: 45,
    alignSelf: 'stretch',
    flex: `0 0 ${RIGHT_WORKBENCH_RESIZE_HANDLE_WIDTH}px`,
    width: RIGHT_WORKBENCH_RESIZE_HANDLE_WIDTH,
    marginInline: -(RIGHT_WORKBENCH_RESIZE_HANDLE_WIDTH / 2),
    cursor: disabled ? 'default' : 'col-resize',
    touchAction: 'none',
    userSelect: 'none',
    WebkitAppRegion: 'no-drag',
    ...style
  } as CSSProperties

  return (
    <div
      className={className === undefined
        ? 'right-workbench-resize-handle'
        : `right-workbench-resize-handle ${className}`}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={Math.round(minimumWidth)}
      aria-valuemax={Math.round(maximumWidth)}
      aria-valuenow={Math.round(width)}
      aria-disabled={disabled || undefined}
      data-resizing={resizing || undefined}
      tabIndex={disabled ? -1 : 0}
      style={handleStyle}
      onBlur={() => setFocused(false)}
      onDoubleClick={onDoubleClick}
      onFocus={() => setFocused(true)}
      onKeyDown={onKeyDown}
      onLostPointerCapture={(event) => finishResize(event.nativeEvent)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={onPointerDown}
    >
      <span
        aria-hidden="true"
        className="right-workbench-resize-handle-line"
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: '50%',
          width: 1,
          transform: 'translateX(-50%)',
          background: 'linear-gradient(to bottom, transparent, var(--text-secondary), transparent)',
          opacity: active ? 1 : 0,
          pointerEvents: 'none',
          transition: 'opacity 120ms ease'
        }}
      />
    </div>
  )
}

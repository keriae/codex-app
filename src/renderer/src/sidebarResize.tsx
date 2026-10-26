import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState
} from 'react'

export const DEFAULT_SIDEBAR_WIDTH = 288
export const MIN_SIDEBAR_WIDTH = 238
export const MAX_SIDEBAR_WIDTH = 720
export const SIDEBAR_WIDTH_STORAGE_KEY = 'codex-sidebar-preferred-width-v1'
// Earlier migration markers could be written before fractional persisted
// widths such as 467.9px were recognized as the old 468px default. Use a new
// marker so existing profiles receive the corrected one-time migration.
export const SIDEBAR_WIDTH_MIGRATION_KEY = 'codex-sidebar-native-default-migrated-v3'
// A previous reconstruction release persisted 468px as its default. Migrate
// only that exact value back to the measured native default while preserving
// every width the user explicitly resized to.
export const LEGACY_DEFAULT_SIDEBAR_WIDTH = 468
export const LEGACY_DEFAULT_SIDEBAR_WIDTH_TOLERANCE = 0.5

export function clampSidebarWidth(
  width: number,
  minimum = MIN_SIDEBAR_WIDTH,
  maximum = MAX_SIDEBAR_WIDTH
): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(Math.max(width, minimum), maximum)
}

export function parseSidebarWidth(
  storedWidth: string | null,
  fallback = DEFAULT_SIDEBAR_WIDTH
): number {
  if (storedWidth === null || storedWidth.trim() === '') {
    return clampSidebarWidth(fallback)
  }

  const parsedWidth = Number(storedWidth)
  return Number.isFinite(parsedWidth)
    ? clampSidebarWidth(parsedWidth)
    : clampSidebarWidth(fallback)
}

export function restoreSidebarWidth(
  storedWidth: string | null,
  legacyDefaultMigrationComplete = false
): number {
  const parsed = storedWidth === null || storedWidth.trim() === ''
    ? Number.NaN
    : Number(storedWidth)
  if (
    !legacyDefaultMigrationComplete &&
    Number.isFinite(parsed) &&
    Math.abs(parsed - LEGACY_DEFAULT_SIDEBAR_WIDTH) <= LEGACY_DEFAULT_SIDEBAR_WIDTH_TOLERANCE
  ) {
    return DEFAULT_SIDEBAR_WIDTH
  }
  return parseSidebarWidth(storedWidth)
}

export interface InitialSidebarWidthState {
  width: number
  shouldPersistMigration: boolean
}

export function initialSidebarWidthState(
  storedWidth: string | null,
  storedMigration: string | null
): InitialSidebarWidthState {
  const migrationComplete = storedMigration === 'true'
  return {
    width: restoreSidebarWidth(storedWidth, migrationComplete),
    shouldPersistMigration: !migrationComplete
  }
}

export function sidebarWidthStyle(width: number): CSSProperties {
  const value = `${clampSidebarWidth(width)}px`
  return {
    '--codex-sidebar-preferred-width': value,
    '--sidebar-width': value
  } as CSSProperties
}

export function useSidebarWidth(): {
  width: number
  setWidth(width: number): void
  style: CSSProperties
} {
  const [initialState] = useState<InitialSidebarWidthState>(() => {
    try {
      return initialSidebarWidthState(
        window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
        window.localStorage.getItem(SIDEBAR_WIDTH_MIGRATION_KEY)
      )
    } catch {
      return {width: DEFAULT_SIDEBAR_WIDTH, shouldPersistMigration: false}
    }
  })
  const migrationPending = useRef(initialState.shouldPersistMigration)
  const [width, setStoredWidth] = useState(initialState.width)

  const setWidth = (nextWidth: number): void => {
    setStoredWidth(clampSidebarWidth(nextWidth))
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
    } catch {
      // Keep resizing functional when storage is unavailable.
    }
    if (!migrationPending.current) return
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_MIGRATION_KEY, 'true')
      migrationPending.current = false
    } catch {
      // Retry the marker on a future width update if storage becomes available.
    }
  }, [width])

  return {
    width,
    setWidth,
    style: sidebarWidthStyle(width)
  }
}

interface DragState {
  pointerId: number
  startClientX: number
  startWidth: number
}

export function SidebarResizeHandle({
  width,
  onWidthChange,
  uiZoom = 1
}: {
  width: number
  onWidthChange(width: number): void
  uiZoom?: number
}): ReactNode {
  const dragState = useRef<DragState | null>(null)
  const [resizing, setResizing] = useState(false)

  const finishResize = (): void => {
    dragState.current = null
    setResizing(false)
    delete document.body.dataset.sidebarResizing
  }

  useEffect(
    () => () => {
      delete document.body.dataset.sidebarResizing
    },
    []
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: width
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.dataset.sidebarResizing = 'true'
    setResizing(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    onWidthChange(drag.startWidth + (event.clientX - drag.startClientX) / (Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1))
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishResize()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 8
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') nextWidth = width - step
    if (event.key === 'ArrowRight') nextWidth = width + step
    if (event.key === 'Home') nextWidth = MIN_SIDEBAR_WIDTH
    if (event.key === 'End') nextWidth = MAX_SIDEBAR_WIDTH
    if (nextWidth === null) return

    event.preventDefault()
    onWidthChange(nextWidth)
  }

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={Math.round(width)}
      data-resizing={resizing || undefined}
      tabIndex={0}
      onDoubleClick={() => onWidthChange(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={finishResize}
    />
  )
}

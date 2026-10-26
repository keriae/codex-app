import {
  createPortal
} from 'react-dom'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import './sidebarHoverCard.css'

const HOVER_CARD_DELAY_MS = 200
const HOVER_CARD_WARM_DELAY_MS = 40
const HOVER_CARD_LEAVE_GRACE_MS = 90
const TOOLTIP_DELAY_MS = 180
const TOOLTIP_WARM_DELAY_MS = 40
const SIDEBAR_SURFACE_SKIP_DELAY_MS = 300

let visibleSidebarSurfaceCount = 0
let lastSidebarSurfaceClosedAt = 0

function sidebarSurfaceDelay(coldDelay: number, warmDelay: number): number {
  return visibleSidebarSurfaceCount > 0 ||
    Date.now() - lastSidebarSurfaceClosedAt <= SIDEBAR_SURFACE_SKIP_DELAY_MS
    ? warmDelay
    : coldDelay
}

function markSidebarSurfaceShown(visible: { current: boolean }): void {
  if (visible.current) return
  visible.current = true
  visibleSidebarSurfaceCount += 1
}

function markSidebarSurfaceHidden(visible: { current: boolean }): void {
  if (!visible.current) return
  visible.current = false
  visibleSidebarSurfaceCount = Math.max(0, visibleSidebarSurfaceCount - 1)
  lastSidebarSurfaceClosedAt = Date.now()
}

interface SurfacePosition {
  left: number
  top: number
}

function cancelTimer(timer: { current: ReturnType<typeof setTimeout> | null }): void {
  if (timer.current) clearTimeout(timer.current)
  timer.current = null
}

export interface SidebarHoverCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  content: ReactNode
  cardClassName?: string
  disabled?: boolean
  children: ReactNode
}

/** Native-style sidebar information card shown to the right of a hovered row. */
export function SidebarHoverCard({
  content,
  cardClassName = '',
  disabled = false,
  children,
  className,
  onPointerEnter,
  onPointerLeave,
  onFocusCapture,
  onBlurCapture,
  ...props
}: SidebarHoverCardProps): ReactNode {
  const id = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRef = useRef(false)
  const [position, setPosition] = useState<SurfacePosition | null>(null)

  const hide = useCallback((): void => {
    cancelTimer(showTimer)
    cancelTimer(hideTimer)
    markSidebarSurfaceHidden(visibleRef)
    setPosition(null)
  }, [])

  const open = useCallback((): void => {
    const anchor = anchorRef.current
    if (!anchor) return
    const bounds = anchor.getBoundingClientRect()
    markSidebarSurfaceShown(visibleRef)
    setPosition({
      left: Math.max(12, Math.min(window.innerWidth - 332, bounds.right + 3)),
      top: Math.max(12, bounds.top + 1)
    })
  }, [])

  const scheduleOpen = useCallback((delay?: number): void => {
    if (disabled) return
    cancelTimer(hideTimer)
    cancelTimer(showTimer)
    showTimer.current = setTimeout(
      open,
      delay ?? sidebarSurfaceDelay(HOVER_CARD_DELAY_MS, HOVER_CARD_WARM_DELAY_MS)
    )
  }, [disabled, open])

  const scheduleHide = useCallback((): void => {
    cancelTimer(showTimer)
    cancelTimer(hideTimer)
    hideTimer.current = setTimeout(hide, HOVER_CARD_LEAVE_GRACE_MS)
  }, [hide])

  useEffect(() => () => {
    cancelTimer(showTimer)
    cancelTimer(hideTimer)
    markSidebarSurfaceHidden(visibleRef)
  }, [])

  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])

  useEffect(() => {
    if (!position) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    const closeOnPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && cardRef.current?.contains(target)) return
      hide()
    }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    document.addEventListener('pointerdown', closeOnPointerDown, true)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      document.removeEventListener('pointerdown', closeOnPointerDown, true)
    }
  }, [hide, position])

  useLayoutEffect(() => {
    if (!position || !cardRef.current) return
    const height = cardRef.current.getBoundingClientRect().height
    const nextTop = Math.max(12, Math.min(position.top, window.innerHeight - height - 12))
    if (nextTop !== position.top) setPosition((current) => current ? {...current, top: nextTop} : current)
  }, [position])

  return <div
    {...props}
    ref={anchorRef}
    className={className}
    aria-describedby={position ? id : undefined}
    onPointerEnter={(event) => {
      onPointerEnter?.(event)
      scheduleOpen()
    }}
    onPointerLeave={(event) => {
      onPointerLeave?.(event)
      scheduleHide()
    }}
    onFocusCapture={(event) => {
      onFocusCapture?.(event)
      scheduleOpen(0)
    }}
    onBlurCapture={(event) => {
      onBlurCapture?.(event)
      const next = event.relatedTarget
      if (next instanceof Node && (anchorRef.current?.contains(next) || cardRef.current?.contains(next))) return
      scheduleHide()
    }}
  >
    {children}
    {position && createPortal(
      <div
        ref={cardRef}
        id={id}
        role="tooltip"
        className={`sidebar-hover-card${cardClassName ? ` ${cardClassName}` : ''}`}
        style={{left: position.left, top: position.top}}
        onPointerEnter={() => {
          cancelTimer(showTimer)
          cancelTimer(hideTimer)
        }}
        onPointerLeave={scheduleHide}
        onClick={() => requestAnimationFrame(hide)}
      >
        {content}
      </div>,
      document.body
    )}
  </div>
}

export function SidebarTooltip({
  content,
  children,
  placement = 'auto'
}: {
  content: string
  children: ReactNode
  placement?: 'auto' | 'right'
}): ReactNode {
  const id = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRef = useRef(false)
  const [position, setPosition] = useState<(SurfacePosition & { side: 'top' | 'bottom' | 'right' }) | null>(null)

  const hide = useCallback((): void => {
    cancelTimer(timer)
    markSidebarSurfaceHidden(visibleRef)
    setPosition(null)
  }, [])

  const show = useCallback((delay?: number): void => {
    cancelTimer(timer)
    timer.current = setTimeout(() => {
      const bounds = anchorRef.current?.getBoundingClientRect()
      if (!bounds) return
      markSidebarSurfaceShown(visibleRef)
      if (placement === 'right') {
        setPosition({
          left: bounds.right,
          top: bounds.top + bounds.height / 2,
          side: 'right'
        })
        return
      }
      setPosition({
        left: Math.max(12, Math.min(window.innerWidth - 12, bounds.left + bounds.width / 2)),
        top: bounds.top < 46 ? bounds.bottom : bounds.top,
        side: bounds.top < 46 ? 'bottom' : 'top'
      })
    }, delay ?? sidebarSurfaceDelay(TOOLTIP_DELAY_MS, TOOLTIP_WARM_DELAY_MS))
  }, [placement])

  useEffect(() => () => {
    cancelTimer(timer)
    markSidebarSurfaceHidden(visibleRef)
  }, [])
  useEffect(() => {
    if (!position) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [hide, position])

  return <span
    ref={anchorRef}
    className="sidebar-tooltip-anchor"
    aria-describedby={position ? id : undefined}
    onPointerEnter={() => show()}
    onPointerLeave={hide}
    // Action buttons stop pointer events so row clicks are not triggered. Close
    // the tooltip during capture so it cannot linger above an opened menu.
    onPointerDownCapture={hide}
    onFocus={() => show(0)}
    onBlur={hide}
  >
    {children}
    {position && createPortal(
      <span
        id={id}
        role="tooltip"
        className="sidebar-action-tooltip"
        data-side={position.side}
        style={{left: position.left, top: position.top}}
      >
        {content}
      </span>,
      document.body
    )}
  </span>
}

export function SidebarMarqueeText({children}: {children: string}): ReactNode {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [duration, setDuration] = useState(6)

  useLayoutEffect(() => {
    const measure = (): void => {
      const viewport = viewportRef.current
      const text = textRef.current
      if (!viewport || !text) return
      const width = text.scrollWidth
      setOverflowing(width > viewport.clientWidth + 1)
      setDuration(Math.max(4.5, Math.min(12, width / 32)))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (viewportRef.current) observer.observe(viewportRef.current)
    if (textRef.current) observer.observe(textRef.current)
    return () => observer.disconnect()
  }, [children])

  return <span
    ref={viewportRef}
    className={`sidebar-marquee-viewport${overflowing ? ' is-overflowing' : ''}`}
    style={{'--sidebar-marquee-duration': `${duration}s`} as CSSProperties}
  >
    <span className="sidebar-marquee-track">
      <span ref={textRef}>{children}</span>
      {overflowing && <><i aria-hidden="true" /><span aria-hidden="true">{children}</span></>}
    </span>
  </span>
}

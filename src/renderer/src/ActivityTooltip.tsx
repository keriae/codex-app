import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import './activityTooltip.css'

type ActivityTooltipProps = { content?: string | null; children: ReactNode; multiline?: boolean; openDelay?: number; variant?: 'activity' | 'copy' | 'userCopy' }

export function ActivityTooltip({ variant = 'activity', ...props }: ActivityTooltipProps): ReactNode {
  return variant === 'activity' ? <ActivityTooltipContent {...props} /> : <CopyTooltip {...props} variant={variant} />
}

/** Other activity consumers retain their existing tooltip behavior. */
function ActivityTooltipContent({ content, children, multiline = false, openDelay = 400 }: ActivityTooltipProps): ReactNode {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const hide = (): void => { if (timer.current) clearTimeout(timer.current); timer.current = null; setPosition(null) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!position) return
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') hide() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('scroll', hide, true) }
  }, [position])
  const show = (delay: number): void => {
    if (!content) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const bounds = ref.current?.getBoundingClientRect()
      if (bounds) setPosition({ left: Math.max(12, Math.min(window.innerWidth - 12, bounds.left + bounds.width / 2)), top: bounds.top })
    }, delay)
  }
  return <span className="activity-tooltip-anchor" ref={ref} data-tooltip={content || undefined} aria-describedby={position ? id : undefined}
    onPointerEnter={() => show(openDelay)} onPointerLeave={hide} onFocus={() => show(0)} onBlur={hide}>
    {children}
    {position && content && createPortal(<span role="tooltip" id={id} className={`activity-tooltip${multiline ? ' is-multiline' : ''}`}
      style={{ left: position.left, top: position.top }}>{content}</span>, document.body)}
  </span>
}

type CopyTooltipSide = 'top' | 'bottom'
type CopyTooltipBounds = { left: number; right: number; top: number; bottom: number; width: number; height: number }

/** Copy tooltip defaults recovered from jA and the user-message $0/Rrn path. */
export function copyTooltipPosition(bounds: CopyTooltipBounds, size: { width: number; height: number }, viewport: { width: number; height: number }, preferredSide: CopyTooltipSide = 'top'): { left: number; top: number; side: CopyTooltipSide } {
  const padding = 8
  const offset = 2
  const fitsTop = bounds.top - offset - size.height >= padding
  const fitsBottom = bounds.bottom + offset + size.height <= viewport.height - padding
  const side = preferredSide === 'top' ? !fitsTop && fitsBottom ? 'bottom' : 'top' : !fitsBottom && fitsTop ? 'top' : 'bottom'
  const left = Math.max(padding, Math.min(viewport.width - padding - size.width, bounds.left + bounds.width / 2 - size.width / 2))
  const top = Math.max(padding, Math.min(viewport.height - padding - size.height, side === 'top' ? bounds.top - offset - size.height : bounds.bottom + offset))
  return { left, top, side }
}

type CopyTriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement>; 'data-tooltip'?: string; 'data-state'?: string }

export function CopyTooltip({ content, children, openDelay, variant = 'copy' }: ActivityTooltipProps & { variant?: 'copy' | 'userCopy' }): ReactNode {
  const id = useId()
  const trigger = useRef<HTMLElement | null>(null)
  const popup = useRef<HTMLSpanElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovered = useRef(false)
  const clicked = useRef(false)
  const pointerDown = useRef(false)
  const opened = useRef(false)
  const closedAt = useRef<number | null>(null)
  const [state, setState] = useState<'closed' | 'delayed-open' | 'instant-open'>('closed')
  const [position, setPosition] = useState<ReturnType<typeof copyTooltipPosition> | null>(null)
  const user = variant === 'userCopy'
  const clearTimer = (): void => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }
  const hide = (): void => {
    clearTimer()
    if (opened.current) closedAt.current = Date.now()
    opened.current = false
    setState('closed')
    setPosition(null)
  }
  const show = (delay: number): void => {
    if (!content || opened.current) return
    if (timer.current !== null) { if (delay === 0) clearTimer(); else return }
    const open = (): void => {
      timer.current = null
      if (!trigger.current?.isConnected) return
      opened.current = true
      setState(delay > 0 ? 'delayed-open' : 'instant-open')
      document.dispatchEvent(new CustomEvent('codex-copy-tooltip-open', { detail: { id, variant } }))
    }
    if (delay === 0) open()
    else timer.current = setTimeout(open, delay)
  }
  const hover = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'touch' || !user && hovered.current || clicked.current) return
    hovered.current = true
    show(closedAt.current !== null && Date.now() - closedAt.current < 300 ? 0 : openDelay ?? (user ? 200 : 150))
  }
  const pointerUp = useRef((): void => { pointerDown.current = false }).current
  useEffect(() => () => {
    clearTimer()
    document.removeEventListener('pointerup', pointerUp)
  }, [])
  useEffect(() => {
    const anotherOpened = (event: Event): void => {
      const detail = (event as CustomEvent<{ id: string; variant: string }>).detail
      if (detail?.id !== id && detail?.variant === variant) hide()
    }
    document.addEventListener('codex-copy-tooltip-open', anotherOpened)
    return () => document.removeEventListener('codex-copy-tooltip-open', anotherOpened)
  }, [id, variant])
  useEffect(() => {
    if (state === 'closed') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { if (!user) event.stopPropagation(); hide() }
    }
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target === window || target === document || target instanceof Node && target.contains(trigger.current)) hide()
    }
    const onPointerDown = (event: PointerEvent): void => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) hide() }
    window.addEventListener('keydown', onKeyDown)
    if (!user) window.addEventListener('scroll', onScroll, true)
    if (!user) document.addEventListener('pointerdown', onPointerDown)
    if (user) window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (!user) window.removeEventListener('scroll', onScroll, true)
      if (!user) document.removeEventListener('pointerdown', onPointerDown)
      if (user) window.removeEventListener('blur', hide)
    }
  }, [state, user])
  useLayoutEffect(() => {
    if (state === 'closed') return
    const update = (): void => {
      const bounds = trigger.current?.getBoundingClientRect()
      const size = popup.current?.getBoundingClientRect()
      if (!bounds || !size || bounds.width <= 0 || bounds.height <= 0) { hide(); return }
      const side = user && window.getComputedStyle(trigger.current!).getPropertyValue('--side-tooltip').trim() === 'bottom' ? 'bottom' : 'top'
      const next = copyTooltipPosition(bounds, size, { width: window.innerWidth, height: window.innerHeight }, side)
      setPosition((previous) => previous?.left === next.left && previous.top === next.top && previous.side === next.side ? previous : next)
    }
    update()
    window.addEventListener('resize', update)
    if (user) window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (trigger.current) observer?.observe(trigger.current)
    if (popup.current) observer?.observe(popup.current)
    return () => { window.removeEventListener('resize', update); if (user) window.removeEventListener('scroll', update, true); observer?.disconnect() }
  }, [state, content, user])

  if (!isValidElement<CopyTriggerProps>(children)) return children
  const original = children as ReactElement<CopyTriggerProps>
  const bind = (element: HTMLElement | null): void => {
    trigger.current = element
    const ref = original.props.ref
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }
  const describedBy = state === 'closed' ? original.props['aria-describedby'] : [original.props['aria-describedby'], id].filter(Boolean).join(' ')
  return <>{cloneElement(original, {
    ref: bind,
    'data-tooltip': content || undefined,
    'data-state': state,
    'aria-describedby': describedBy,
    onPointerEnter: (event) => {
      original.props.onPointerEnter?.(event)
      if (user && !event.defaultPrevented) { clicked.current = false; hover(event) }
    },
    onPointerMove: (event) => { original.props.onPointerMove?.(event); if (!event.defaultPrevented) hover(event) },
    onPointerLeave: (event) => { original.props.onPointerLeave?.(event); if (!event.defaultPrevented) { hovered.current = false; clicked.current = false; hide() } },
    onPointerDown: (event) => {
      original.props.onPointerDown?.(event)
      if (!user && !event.defaultPrevented) { pointerDown.current = true; hide(); document.addEventListener('pointerup', pointerUp, { once: true }) }
    },
    onFocus: (event) => {
      original.props.onFocus?.(event)
      if (!event.defaultPrevented && !pointerDown.current && event.target.matches(':focus-visible')) { clicked.current = false; show(0) }
    },
    onBlur: (event) => { original.props.onBlur?.(event); if (!event.defaultPrevented) hide() },
    onClick: (event) => { original.props.onClick?.(event); if (!event.defaultPrevented) { if (user) clicked.current = true; hide() } },
    onContextMenu: (event) => { original.props.onContextMenu?.(event); if (user && !event.defaultPrevented) hide() }
  })}
    {state !== 'closed' && content && createPortal(<span ref={popup} role="tooltip" id={id}
      className="activity-tooltip is-copy" data-side={position?.side || 'top'} data-align="center" data-state={state} data-tooltip-variant={variant}
      style={{ left: position?.left || 0, top: position?.top || 0, visibility: position ? undefined : 'hidden' }}><span>{content}</span></span>, document.body)}
  </>
}

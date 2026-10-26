import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './activityTooltip.css'

/** Activity tooltips use a short hover delay and remain available to keyboard focus. */
export function ActivityTooltip({ content, children, multiline = false }: { content?: string | null; children: ReactNode; multiline?: boolean }): ReactNode {
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
    onPointerEnter={() => show(400)} onPointerLeave={hide} onFocus={() => show(0)} onBlur={hide}>
    {children}
    {position && content && createPortal(<span role="tooltip" id={id} className={`activity-tooltip${multiline ? ' is-multiline' : ''}`}
      style={{ left: position.left, top: position.top }}>{content}</span>, document.body)}
  </span>
}

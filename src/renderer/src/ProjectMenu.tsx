import { Check } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { nextProjectMenuIndex } from './projectPanelState'
import { toLogicalRect, toLogicalViewport, useWindowZoom } from './windowZoom'

export interface ProjectMenuItem {
  id: string
  label: string
  icon?: ReactNode
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect(): void
}

export function ProjectMenu({
  label,
  trigger,
  items,
  onClose
}: {
  label: string
  trigger: HTMLButtonElement
  items: readonly ProjectMenuItem[]
  onClose(): void
}): ReactNode {
  const zoom = useWindowZoom()
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const [focused, setFocused] = useState(() => {
    const selected = items.findIndex((item) => item.checked && !item.disabled)
    return selected >= 0 ? selected : nextProjectMenuIndex(items.map((item) => Boolean(item.disabled)), -1, 'Home')
  })

  useLayoutEffect(() => {
    if (!menuRef.current) return
    const anchor = toLogicalRect(trigger.getBoundingClientRect(), zoom)
    const box = toLogicalRect(menuRef.current.getBoundingClientRect(), zoom)
    const viewport = toLogicalViewport({ width: window.innerWidth, height: window.innerHeight }, zoom)
    const gutter = 8
    const maxHeight = Math.max(0, viewport.height - gutter * 2)
    const height = Math.min(box.height, maxHeight)
    const below = viewport.height - anchor.bottom - gutter
    const above = anchor.top - gutter
    const top = below >= height || below >= above ? anchor.bottom + 5 : anchor.top - height - 5
    setPosition({
      top: Math.max(gutter, Math.min(top, viewport.height - height - gutter)),
      left: Math.max(gutter, Math.min(anchor.right - box.width, viewport.width - box.width - gutter)),
      maxHeight
    })
  }, [items, trigger, zoom])

  useLayoutEffect(() => {
    if (position.visibility === 'hidden') return
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-project-menu-item]')[focused]?.focus({ preventScroll: true })
  }, [focused, position])

  useEffect(() => {
    const close = (restore: boolean): void => {
      if (restore && trigger.isConnected) trigger.focus({ preventScroll: true })
      onClose()
    }
    const dismiss = (event: PointerEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (!menuRef.current?.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(false)
    }
    const scroll = (event: Event): void => {
      if (!menuRef.current?.contains(event.target as Node)) close(true)
    }
    const resize = (): void => close(true)
    const keyboard = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
      } else if (event.key === 'Tab') {
        event.stopPropagation()
        close(true)
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        setFocused((current) => nextProjectMenuIndex(items.map((item) => Boolean(item.disabled)), current, event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'))
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', keyboard, true)
    }
  }, [items, onClose, trigger])

  return createPortal(
    <div ref={menuRef} id={id} className="projects-menu" role="menu" aria-label={label} style={position}>
      {items.map((item, index) => (
        <div key={item.id} className={item.separatorBefore ? 'projects-menu-section' : undefined}>
          <button
            type="button"
            data-project-menu-item
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            className={item.danger ? 'projects-menu-danger' : undefined}
            disabled={item.disabled}
            tabIndex={focused === index ? 0 : -1}
            onPointerMove={() => { if (!item.disabled) setFocused(index) }}
            onClick={() => {
              if (item.disabled) return
              if (trigger.isConnected) trigger.focus({ preventScroll: true })
              onClose()
              item.onSelect()
            }}
          >
            {item.icon && <span className="projects-menu-icon">{item.icon}</span>}
            <span>{item.label}</span>
            {item.checked && <Check className="projects-menu-check" aria-hidden="true" />}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}

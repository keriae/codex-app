import { Check, ChevronDown } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { toLogicalRect, toLogicalViewport, useWindowZoom } from './windowZoom'
import './SettingsControls.css'

export interface SettingsSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export function SettingsSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
  leading
}: {
  label: string
  value: string
  options: readonly SettingsSelectOption[]
  disabled?: boolean
  leading?: ReactNode
  onChange(value: string): void
}): ReactNode {
  const zoom = useWindowZoom()
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = options.find((option) => option.value === value)

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    const rect = toLogicalRect(trigger.current.getBoundingClientRect(), zoom)
    const menuRect = toLogicalRect(menu.current.getBoundingClientRect(), zoom)
    const viewport = toLogicalViewport({ width: window.innerWidth, height: window.innerHeight }, zoom)
    const gutter = 8
    const maximumHeight = Math.max(0, viewport.height - gutter * 2)
    const height = Math.min(menuRect.height, maximumHeight)
    const below = viewport.height - rect.bottom - gutter
    const above = rect.top - gutter
    const top = below >= height || below >= above
      ? rect.bottom + 5
      : Math.max(gutter, rect.top - height - 5)
    setPosition({
      top: Math.min(top, viewport.height - height - gutter),
      left: Math.max(gutter, Math.min(rect.right - menuRect.width, viewport.width - menuRect.width - gutter)),
      maxHeight: maximumHeight
    })
  }, [open, options, zoom])

  useEffect(() => {
    if (!open) return
    setFocusedIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    const dismiss = (event: PointerEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const reposition = (): void => setOpen(false)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
    }
  }, [open, options, value])

  useEffect(() => {
    if (!open) return
    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[focusedIndex]?.focus({ preventScroll: true })
  }, [focusedIndex, open])

  const choose = (option: SettingsSelectOption): void => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="settings-page-pill"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {leading}{selected?.label || value}<ChevronDown aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          id={id}
          className="settings-select-menu"
          role="menu"
          aria-label={label}
          style={position}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              event.stopPropagation()
              if (event.key === 'Escape') event.preventDefault()
              setOpen(false)
              trigger.current?.focus({ preventScroll: true })
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0)
              const current = enabled.indexOf(focusedIndex)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
                (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
              if (enabled[next] !== undefined) setFocusedIndex(enabled[next])
            }
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              disabled={option.disabled}
              tabIndex={focusedIndex === index ? 0 : -1}
              onClick={() => choose(option)}
              onPointerMove={() => { if (!option.disabled) setFocusedIndex(index) }}
            >
              <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              {option.value === value && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

export function SettingsSegmented({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: readonly SettingsSelectOption[]
  onChange(value: string): void
}): ReactNode {
  return (
    <div className="settings-page-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button type="button" key={option.value} className={option.value === value ? 'active' : undefined} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  )
}

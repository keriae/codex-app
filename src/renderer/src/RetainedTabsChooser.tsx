import { useId, useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { RightWorkbenchTabId } from './rightWorkbenchTabs'
import { WorkbenchElementGlyph } from './WorkbenchElementGlyph'
import { toLogicalRect, toLogicalViewport, useWindowZoom } from './windowZoom'
import { retainedTabDisabled, retainedTabsPointInsideTriangle, retainedTabsPointerTriangle, retainedTabsTriggerKeyAction } from './retainedTabsChooserModel'
import './RetainedTabsChooser.css'

export interface RetainedTabsChooserTab {
  id: RightWorkbenchTabId
  title: string
  titleContent?: ReactNode
  icon: ReactNode
  requiresWorkspaceReady?: boolean
}

type RetainedTabsMode = 'split' | 'full'
interface RetainedTabsChooserProps {
  tabs: readonly RetainedTabsChooserTab[]
  workspaceReady: boolean
  onReveal(restoreMainFocus: boolean): void
  onSelect(id: RightWorkbenchTabId, mode: RetainedTabsMode): void
}

/** Xs: independent split and full-view actions, with the original ready gate. */
export function RetainedTabsChooserRows({ tabs, workspaceReady, onSelect }: Pick<RetainedTabsChooserProps, 'tabs' | 'workspaceReady' | 'onSelect'>): ReactNode {
  return tabs.map((tab) => {
    const disabled = retainedTabDisabled(workspaceReady, tab.requiresWorkspaceReady)
    return <div key={tab.id} className="retained-tabs-row" data-disabled={disabled}>
      <button type="button" className="retained-tabs-primary" aria-label={tab.title} disabled={disabled}
        data-retained-tab-id={tab.id} data-retained-tab-mode="split" onClick={() => onSelect(tab.id, 'split')}>
        <span className="retained-tabs-icon">{tab.icon}</span><span className="retained-tabs-title" dir="auto">{tab.titleContent ?? tab.title}</span>
      </button>
      <button type="button" className="retained-tabs-full" aria-label={`以全屏视图打开 ${tab.title}`} disabled={disabled}
        data-retained-tab-id={tab.id} data-retained-tab-mode="full" onClick={() => onSelect(tab.id, 'full')}
        onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }}>
        <WorkbenchElementGlyph name="chevron-up-right-chevron-down-left-sm-light-16" size={16} />
      </button>
    </div>
  })
}

/** Ys: hovering reveals a chooser, while clicking retains the layout action. */
export function RetainedTabsChooser({ tabs, workspaceReady, onReveal, onSelect }: RetainedTabsChooserProps): ReactNode {
  const zoom = useWindowZoom()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const removePointerGuard = useRef<(() => void) | null>(null)
  const mouseOpened = useRef(false)
  const selected = useRef(false)
  const requestInitialFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const id = useId()
  const clearGrace = (): void => {
    removePointerGuard.current?.()
    removePointerGuard.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const close = (restoreFocus = false): void => {
    clearGrace()
    setOpen(false)
    setPosition(null)
    if (restoreFocus && !selected.current) trigger.current?.focus({ preventScroll: true })
  }
  const leave = (event: PointerEvent<HTMLElement>): void => {
    if (event.pointerType !== 'mouse' || !mouseOpened.current) return
    clearGrace()
    const source = event.currentTarget
    const destination = source === trigger.current ? popup.current : trigger.current
    if (event.relatedTarget instanceof Node && destination?.contains(event.relatedTarget)) return
    const scheduleClose = (): void => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => close(), 100)
    }
    if (destination) {
      const pointer = { x: event.clientX, y: event.clientY }
      const destinationRect = destination.getBoundingClientRect()
      const sourceRect = source.getBoundingClientRect()
      const side = destinationRect.top >= sourceRect.bottom ? 'bottom' : 'top'
      if (retainedTabsPointerTriangle(destinationRect, side, pointer, sourceRect)) {
        const move = (next: globalThis.PointerEvent): void => {
          const path = next.composedPath()
          if (path.includes(destination) || path.includes(source)) { clearGrace(); return }
          const triangle = retainedTabsPointerTriangle(destination.getBoundingClientRect(), side, pointer, source.getBoundingClientRect())
          if (triangle && retainedTabsPointInsideTriangle({ x: next.clientX, y: next.clientY }, triangle)) scheduleClose()
          else close()
        }
        const owner = destination.ownerDocument
        owner.addEventListener('pointermove', move, true)
        removePointerGuard.current = () => owner.removeEventListener('pointermove', move, true)
      }
    }
    scheduleClose()
  }
  const keyboardMode = (): void => { clearGrace(); mouseOpened.current = false }
  const focusEdge = (last = false): void => {
    const buttons = popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    ;(last ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus()
  }
  const triggerKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    keyboardMode()
    const action = retainedTabsTriggerKeyAction(open, event.key)
    if (action === 'open') {
      event.preventDefault()
      selected.current = false
      requestInitialFocus.current = true
      setOpen(true)
    } else if (action) {
      event.preventDefault()
      focusEdge(action === 'last')
    }
  }
  useEffect(() => () => { clearGrace() }, [])
  useLayoutEffect(() => {
    if (!open) return
    const update = (): void => {
      if (!trigger.current || !popup.current) return
      const bounds = toLogicalRect(trigger.current.getBoundingClientRect(), zoom)
      const size = toLogicalRect(popup.current.getBoundingClientRect(), zoom)
      const viewport = toLogicalViewport({ width: window.innerWidth, height: window.innerHeight }, zoom)
      const below = viewport.height - bounds.bottom - 11
      const above = bounds.top - 11
      const side = size.height > below && above > below ? 'top' : 'bottom'
      const height = Math.max(0, side === 'top' ? above : below)
      setPosition({ left: Math.max(6, Math.min(bounds.right - size.width, viewport.width - 6 - size.width)),
        top: side === 'top' ? Math.max(6, bounds.top - 5 - Math.min(size.height, height)) : bounds.bottom + 5,
        maxHeight: Math.min(viewport.height - 16, height), zoom })
    }
    update()
    const observer = new ResizeObserver(update)
    if (trigger.current) observer.observe(trigger.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open, tabs.length, zoom])
  useLayoutEffect(() => {
    if (!open || !position || !requestInitialFocus.current) return
    requestInitialFocus.current = false
    focusEdge()
  }, [open, position])
  useEffect(() => {
    if (!open) return
    const outside = (event: Event): void => {
      if (event.target instanceof Node && (trigger.current?.contains(event.target) || popup.current?.contains(event.target))) return
      close()
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close(!mouseOpened.current)
    }
    const blur = (): void => close()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('blur', blur)
    }
  }, [open])
  const select = (tab: RightWorkbenchTabId, mode: RetainedTabsMode): void => {
    selected.current = true
    close()
    onSelect(tab, mode)
  }
  return <>
    <button ref={trigger} type="button" className="titlebar-icon titlebar-retained-tabs" aria-label="显示标签页" aria-pressed={false}
      aria-description={`${tabs.length} 个打开的标签页`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      data-state={open ? 'open' : 'closed'} data-app-shell-focus-area="main" data-app-shell-workspace-layout-toggle="main"
      onPointerEnter={(event) => {
        clearGrace()
        if (!open && event.pointerType === 'mouse') {
          mouseOpened.current = true
          selected.current = false
          requestInitialFocus.current = false
          setOpen(true)
        }
      }} onPointerLeave={leave} onKeyDown={triggerKey}
      onClick={(event) => {
        event.preventDefault()
        const restoreMainFocus = document.activeElement === event.currentTarget
        selected.current = true
        close()
        if (tabs.length) onReveal(restoreMainFocus)
      }}>
      <span className="titlebar-retained-glyph"><WorkbenchElementGlyph name="aspect-ratio-1-1-light-16" size={16} />
        <span className="titlebar-retained-count" data-multiple-digits={tabs.length > 9}>{tabs.length > 9 ? '9+' : tabs.length}</span></span>
    </button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label="显示标签页" className="retained-tabs-popup"
      style={position ?? { left: 0, top: 0, zoom, visibility: 'hidden' }} data-state="open"
      onPointerEnter={clearGrace} onPointerLeave={leave} onFocusCapture={keyboardMode} onKeyDownCapture={keyboardMode}>
      <div className="retained-tabs-heading">已打开的标签页</div>
      <RetainedTabsChooserRows tabs={tabs} workspaceReady={workspaceReady} onSelect={select} />
    </div>, document.body)}
  </>
}

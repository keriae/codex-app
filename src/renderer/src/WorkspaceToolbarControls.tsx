import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toLogicalRect, toLogicalViewport, useWindowZoom } from './windowZoom'
import { WorkbenchElementGlyph } from './WorkbenchElementGlyph'

// review-file-source-breadcrumb.Zt moves file controls to a popover below 625px.
export function WorkspaceToolbarControls({ children, onPresentationChange, collapseBelow = 625 }: { children: ReactNode; onPresentationChange?(): void; collapseBelow?: number }): ReactNode {
  const zoom = useWindowZoom()
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const popupId = useId()
  const hadFocus = useRef(false)
  useLayoutEffect(() => {
    const header = host.current?.closest('header')
    if (!header) return
    const resize = (): void => {
      const next = header.clientWidth >= collapseBelow
      hadFocus.current = Boolean(host.current?.contains(document.activeElement) || popup.current?.contains(document.activeElement))
      setWide(next)
      if (next) setOpen(false)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(header)
    return () => observer.disconnect()
  }, [collapseBelow])
  useLayoutEffect(() => { onPresentationChange?.() }, [wide, open, onPresentationChange])
  useLayoutEffect(() => {
    if (!hadFocus.current) return
    hadFocus.current = false
    if (wide) host.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    else trigger.current?.focus()
  }, [wide])
  useLayoutEffect(() => {
    if (!open) return
    const button = trigger.current
    if (!button) return
    const update = (): void => {
      const rect = toLogicalRect(button.getBoundingClientRect(), zoom)
      const width = popup.current ? toLogicalRect(popup.current.getBoundingClientRect(), zoom).width : 180
      const viewport = toLogicalViewport({ width: window.innerWidth, height: window.innerHeight }, zoom)
      setPosition({ left: Math.max(8, Math.min(rect.right - width, viewport.width - width - 8)), top: rect.bottom + 5 })
    }
    update()
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, zoom])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); window.removeEventListener('blur', blur) }
  }, [open])
  return <div ref={host} className="workspace-toolbar-controls">
    {wide ? <div className="workspace-toolbar-controls-inline" role="group" aria-label="文件控件">{children}</div> : <button type="button" ref={trigger} className="workspace-toolbar-controls-trigger" aria-label="文件控件" title={open ? undefined : '文件控件'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined} onClick={() => setOpen((value) => !value)}><WorkbenchElementGlyph name="ellipsis-horizontal-light-16" /></button>}
    {open && !wide && createPortal(<div ref={popup} id={popupId} role="dialog" aria-label="文件控件" className="workspace-pane-header-actions workspace-toolbar-controls-popup" style={position}>{children}</div>, document.body)}
  </div>
}

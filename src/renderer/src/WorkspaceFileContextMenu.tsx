import { copyTextToClipboard } from './clipboard'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Copy, Download, MessageSquare, ExternalLink } from 'lucide-react'
import type { WorkspaceOpenTarget, WorkspaceOpenTargetId } from '../../shared/api'
import { readDesktopSettings } from './desktopSettings'

export interface WorkspaceFileMenu { path: string; isDirectory: boolean; x: number; y: number }
export function WorkspaceFileContextMenu({ menu, onClose, onOpen, onSaveAs, onAdd, onError }: {
  menu: WorkspaceFileMenu
  onClose(): void
  onOpen(target: WorkspaceOpenTargetId): Promise<void>
  onSaveAs(): Promise<void>
  onAdd(): void
  onError(error: unknown): void
}): ReactNode {
  const [targets, setTargets] = useState<WorkspaceOpenTarget[] | null>(null)
  const [submenu, setSubmenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const submenuRef = useRef(submenu)
  const submenuTrigger = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  const submenuId = useId()
  submenuRef.current = submenu
  closeRef.current = onClose
  const preferred = readDesktopSettings().defaultFileTarget
  const primary = targets?.find((target) => target.id === preferred) || targets?.[0]
  useEffect(() => {
    let current = true
    void window.codex.listWorkspaceOpenTargets().then((result) => { if (current) setTargets(result) }).catch((error) => { if (current) { setTargets([]); onError(error) } })
    return () => { current = false }
  }, [])
  useEffect(() => {
    const close = (event: PointerEvent): void => { if (!ref.current?.contains(event.target as Node)) closeRef.current() }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (submenuRef.current) {
          submenuRef.current = false
          setSubmenu(false)
          submenuTrigger.current?.focus()
        } else closeRef.current()
      }
      if (event.key === 'ArrowLeft' && submenuRef.current && event.target instanceof Node
        && ref.current?.querySelector('.workspace-file-context-submenu')?.contains(event.target)) {
        event.preventDefault()
        submenuRef.current = false
        setSubmenu(false)
        submenuTrigger.current?.focus()
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', key)
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [])
  const run = (action: () => Promise<void>): void => { onClose(); void action().catch(onError) }
  return createPortal(<div ref={ref} className="workspace-file-context-menu" role="menu" aria-label="文件操作" style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 230)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 245)) }}>
    {targets === null ? <button type="button" role="menuitem" disabled title="正在加载可用应用…"><ExternalLink />打开方式…</button> : primary && <>
      <button type="button" role="menuitem" onClick={() => run(() => onOpen(primary.id))}><ExternalLink />在{primary.label}中打开</button>
      <button ref={submenuTrigger} type="button" role="menuitem" aria-haspopup="menu" aria-controls={submenuId} aria-expanded={submenu}
        onPointerEnter={() => setSubmenu(true)} onClick={() => setSubmenu((value) => !value)} onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return
          event.preventDefault()
          submenuRef.current = true
          setSubmenu(true)
          window.requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.workspace-file-context-submenu button')?.focus())
        }}>打开方式…<ChevronRight /></button>
      {submenu && <div id={submenuId} className="workspace-file-context-submenu" role="menu" aria-label="打开方式" style={{ [menu.x > window.innerWidth - 470 ? 'right' : 'left']: '100%' }}>
        {targets.map((target) => <button type="button" key={target.id} role="menuitem" onClick={() => run(() => onOpen(target.id))}>{target.label}</button>)}
      </div>}
    </>}
    {(targets === null || primary) && <div role="separator" />}
    {!menu.isDirectory && <button type="button" role="menuitem" onClick={() => run(onSaveAs)}><Download />另存为…</button>}
    <button type="button" role="menuitem" onClick={() => run(() => copyTextToClipboard(menu.path))}><Copy />复制路径</button>
    <button type="button" role="menuitem" onClick={() => { onClose(); window.requestAnimationFrame(onAdd) }}><MessageSquare />加入聊天</button>
  </div>, document.body)
}

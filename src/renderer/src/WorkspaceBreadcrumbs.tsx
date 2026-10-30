import { Braces, ChevronDown, ChevronRight, File, FileCode2, FileImage, Folder, FolderOpen, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceDirectoryEntry } from '../../shared/api'
import { workspaceBreadcrumbCollapseCount, workspaceBreadcrumbSegments, workspaceBreadcrumbTreeAction, type WorkspaceBreadcrumbSegment } from './workspaceBreadcrumbModel'
import { workspaceErrorMessage } from './workspaceFileModel'
import { toLogicalRect, toLogicalViewport, useWindowZoom } from './windowZoom'
import './WorkspaceBreadcrumbs.css'

type DirectoryState = { status: 'loading' | 'ready' | 'error'; entries: WorkspaceDirectoryEntry[]; truncated?: boolean; error?: string }

function BreadcrumbIcon({ entry, expanded }: { entry: WorkspaceDirectoryEntry; expanded: boolean }): ReactNode {
  if (entry.isDirectory) return expanded ? <FolderOpen /> : <Folder />
  if (/\.(json|jsonl)$/i.test(entry.path)) return <Braces className="is-json" />
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(entry.path)) return <FileImage />
  return /\.(tsx?|jsx?|mjs|cjs|py|go|rs|css|html|sh)$/i.test(entry.path) ? <FileCode2 /> : <File />
}

function BreadcrumbDirectoryTree({ root, segment, onSelectFile }: { root: string; segment: WorkspaceBreadcrumbSegment; onSelectFile(path: string): void }): ReactNode {
  const directory = segment.directoryPath!
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expanded, setExpanded] = useState(() => new Set(segment.expandActivePath && segment.activePath ? [segment.activePath] : []))
  const [selected, setSelected] = useState(segment.activePath)
  const [focused, setFocused] = useState(segment.activePath)
  const loads = useRef(new Map<string, Promise<void>>())
  const alive = useRef(true)
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const tree = useRef<HTMLDivElement>(null)
  const revealed = useRef(false)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const load = useCallback((path: string, retry = false): Promise<void> => {
    const pending = loads.current.get(path)
    if (pending && !retry) return pending
    setDirectories((current) => ({ ...current, [path]: { status: 'loading', entries: [] } }))
    const request = window.codex.readWorkspaceDirectory(root, path).then((result) => {
      if (alive.current) setDirectories((current) => ({ ...current, [path]: { status: 'ready', entries: result.entries, truncated: result.truncated } }))
    }).catch((error) => {
      if (alive.current) setDirectories((current) => ({ ...current, [path]: { status: 'error', entries: [], error: workspaceErrorMessage(error) } }))
    })
    loads.current.set(path, request)
    return request
  }, [root])
  useEffect(() => { void load(directory); for (const path of expanded) void load(path) }, [directory, expanded, load])

  const items: (WorkspaceDirectoryEntry & { parentPath: string | null; depth: number; expanded: boolean })[] = []
  const append = (parent: string, depth: number): void => {
    for (const entry of directories[parent]?.entries || []) {
      const isExpanded = entry.isDirectory && expanded.has(entry.path)
      items.push({ ...entry, parentPath: parent === directory ? null : parent, depth, expanded: isExpanded })
      if (isExpanded) append(entry.path, depth + 1)
    }
  }
  append(directory, 0)
  const focusPath = focused && items.some((item) => item.path === focused) ? focused : items[0]?.path
  useLayoutEffect(() => {
    if (revealed.current || directories[directory]?.status !== 'ready') return
    const node = nodes.current.get(segment.activePath || '') || nodes.current.get(items[0]?.path || '')
    if (!node) { tree.current?.focus(); return }
    revealed.current = true
    node.focus({ preventScroll: true })
    node.scrollIntoView({ block: 'center', inline: 'nearest' })
  })

  const toggle = (path: string, open: boolean): void => {
    setSelected(path)
    setFocused(path)
    setExpanded((current) => { const next = new Set(current); open ? next.add(path) : next.delete(path); return next })
    if (open) void load(path)
  }
  const renderDirectory = (path: string, depth: number): ReactNode => {
    const state = directories[path]
    if (!state || state.status === 'loading') return <div className="workspace-breadcrumb-tree-state" role="status" style={{ paddingLeft: depth * 14 + 8 }}><LoaderCircle className="workspace-pane-spin" />正在加载…</div>
    if (state.status === 'error') return <div className="workspace-breadcrumb-tree-state is-error" role="alert"><span title={state.error}>无法加载文件夹内容</span><button type="button" onClick={() => void load(path, true)}>重试</button></div>
    if (!state.entries.length) return <div className="workspace-breadcrumb-tree-state" style={{ paddingLeft: depth * 14 + 8 }}>此文件夹为空</div>
    return <>
      {state.entries.map((entry, index) => {
        const isExpanded = entry.isDirectory && expanded.has(entry.path)
        return <div role="none" key={entry.path}>
          <button type="button" role="treeitem" className={`workspace-breadcrumb-tree-row${selected === entry.path ? ' is-selected' : ''}`} aria-label={entry.fileName}
            aria-level={depth + 1} aria-posinset={index + 1} aria-setsize={state.entries.length} aria-selected={selected === entry.path} aria-expanded={entry.isDirectory ? isExpanded : undefined}
            tabIndex={focusPath === entry.path ? 0 : -1} style={{ paddingLeft: depth * 14 + 3 }}
            ref={(node) => { node ? nodes.current.set(entry.path, node) : nodes.current.delete(entry.path) }}
            onFocus={() => setFocused(entry.path)} onClick={() => entry.isDirectory ? toggle(entry.path, !isExpanded) : onSelectFile(entry.path)}
            onKeyDown={(event) => {
              const action = workspaceBreadcrumbTreeAction(items, entry.path, event.key)
              if (!action) return
              event.preventDefault()
              if (action.type === 'focus') nodes.current.get(action.path)?.focus()
              else if (action.type === 'select') onSelectFile(action.path)
              else toggle(action.path, action.type === 'expand')
            }}>
            <span className="workspace-breadcrumb-tree-disclosure">{entry.isDirectory && (isExpanded ? <ChevronDown /> : <ChevronRight />)}</span>
            <BreadcrumbIcon entry={entry} expanded={isExpanded} /><span>{entry.fileName}</span>
          </button>
          {isExpanded && <div role="group">{renderDirectory(entry.path, depth + 1)}</div>}
        </div>
      })}
      {state.truncated && <div className="workspace-breadcrumb-tree-state">仅显示前 {state.entries.length} 个项目</div>}
    </>
  }
  return <div className="workspace-breadcrumb-tree" ref={tree} role="tree" aria-label="文件夹内容" tabIndex={items.length ? -1 : 0}>{renderDirectory(directory, 0)}</div>
}

export function WorkspaceBreadcrumbs({ root, path, onSelectFile }: { root: string | null | undefined; path: string | null; onSelectFile?(path: string): void }): ReactNode {
  const zoom = useWindowZoom()
  const segments = useMemo(() => workspaceBreadcrumbSegments(root, path), [root, path])
  const nav = useRef<HTMLElement>(null)
  const measure = useRef<HTMLOListElement>(null)
  const triggers = useRef(new Map<number, HTMLButtonElement>())
  const popup = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(0)
  const [naturalWidth, setNaturalWidth] = useState<number>()
  const [open, setOpen] = useState<number | null>(null)
  const [position, setPosition] = useState<CSSProperties>({})
  const popupId = useId()
  const close = useCallback((restoreFocus: boolean): void => { if (restoreFocus && open !== null) triggers.current.get(open)?.focus(); setOpen(null) }, [open])
  useEffect(() => { setOpen(null) }, [root, path])
  useLayoutEffect(() => {
    const element = nav.current
    const measurement = measure.current
    if (!element || !measurement) return
    const resize = (): void => {
      if (!segments.length) { setNaturalWidth(undefined); setCollapsed(0); return }
      const scale = element.offsetWidth ? element.getBoundingClientRect().width / element.offsetWidth : 1
      const widths = Array.from(measurement.children).map((child) => child.getBoundingClientRect().width / (scale || 1))
      const styles = getComputedStyle(element)
      const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      setNaturalWidth(widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 4 + padding)
      setCollapsed(workspaceBreadcrumbCollapseCount(widths, element.clientWidth - padding))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [segments])
  useLayoutEffect(() => {
    if (open === null) return
    if (open < collapsed) { close(true); return }
    const trigger = triggers.current.get(open)
    if (!trigger) return
    const update = (): void => {
      const rect = toLogicalRect(trigger.getBoundingClientRect(), zoom)
      const viewport = toLogicalViewport({ width: window.innerWidth, height: window.innerHeight }, zoom)
      const width = Math.min(384, viewport.width - 16)
      const bottomSpace = viewport.height - rect.bottom - 12
      const above = bottomSpace < 320 && rect.top - 12 > bottomSpace
      const height = Math.min(320, Math.max(80, above ? rect.top - 12 : bottomSpace))
      setPosition({ left: Math.max(8, Math.min(rect.left, viewport.width - width - 8)), top: above ? rect.top - height - 4 : rect.bottom + 4, width, height })
    }
    update()
    const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.contains(event.target)) close(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true) } else if (event.key === 'Tab') close(false) }
    const blur = (): void => close(false)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', update)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', update); window.removeEventListener('blur', blur) }
  }, [open, collapsed, close, zoom])
  const content = (interactive: boolean): ReactNode => segments.map((segment, index) => <li key={segment.path} data-file-ancestor={index < segments.length - 1 ? index : undefined}
    hidden={interactive && index < collapsed} className={index === segments.length - 1 ? 'is-filename' : undefined}>
    {interactive && root && onSelectFile && segment.directoryPath ? <button type="button" ref={(node) => { node ? triggers.current.set(index, node) : triggers.current.delete(index) }}
      className="workspace-breadcrumb-trigger" aria-label={`浏览 ${segment.label}`} aria-haspopup="dialog" aria-expanded={open === index} aria-controls={open === index ? popupId : undefined}
      onClick={() => setOpen((current) => current === index ? null : index)}>{segment.label}</button> : <span>{segment.label}</span>}
    {index < segments.length - 1 && <ChevronRight aria-hidden="true" />}
  </li>)
  return <>
    <nav ref={nav} className="workspace-breadcrumbs workspace-file-breadcrumbs" aria-label="文件路径" title={path || root || 'Workspace'} style={{ width: naturalWidth }}
      onCopy={(event) => {
        const selection = window.getSelection()
        if (!selection?.rangeCount || selection.isCollapsed) return
        const fragment = selection.getRangeAt(0).cloneContents()
        fragment.querySelectorAll('.workspace-breadcrumb-measure, [hidden]').forEach((node) => node.remove())
        const parts = Array.from(fragment.querySelectorAll('li')).map((node) => node.textContent || '')
        const selectedPath = parts.length ? parts.join('/') : selection.toString()
        const fullPath = segments.map((segment) => segment.label).join('/')
        if (selectedPath) { event.preventDefault(); event.clipboardData.setData('text/plain', selectedPath === fullPath ? path || root || '' : selectedPath) }
      }}>
      <ol className="workspace-breadcrumb-items">{segments.length ? content(true) : <li className="is-filename"><span>Workspace</span></li>}</ol>
      <ol ref={measure} className="workspace-breadcrumb-measure" aria-hidden="true" inert>{content(false)}</ol>
    </nav>
    {open !== null && segments[open]?.directoryPath && root && onSelectFile && createPortal(<div ref={popup} id={popupId} role="dialog" aria-label={`浏览 ${segments[open].label}`} className="workspace-breadcrumb-popup" style={position}>
      <BreadcrumbDirectoryTree key={`${root}:${segments[open].path}`} root={root} segment={segments[open]} onSelectFile={(selectedPath) => { close(true); onSelectFile(selectedPath) }} />
    </div>, document.body)}
  </>
}

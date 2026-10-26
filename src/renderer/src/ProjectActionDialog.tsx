import { Folder } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { normalizeProjectEdit, type ProjectEdit } from './projectPanelState'

export type ProjectDialogMode = 'rename' | 'edit' | 'remove'

export function ProjectActionDialog({
  mode,
  project,
  busy,
  error,
  onCancel,
  onSubmit
}: {
  mode: ProjectDialogMode
  project: ProjectEdit
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(update?: ProjectEdit): void
}): ReactNode {
  const [name, setName] = useState(project.name)
  const [path, setPath] = useState(project.path)
  const [localError, setLocalError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  const titleId = useId()
  const descriptionId = useId()
  const locked = busy || picking
  const title = mode === 'rename' ? '重命名项目' : mode === 'edit' ? '编辑项目' : '移除项目？'

  useEffect(() => {
    mounted.current = true
    const previousFocus = document.activeElement as HTMLElement | null
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    } else cancelRef.current?.focus()
    return () => {
      mounted.current = false
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      else document.querySelector<HTMLInputElement>('.projects-page-search input')?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!locked) onCancel()
      } else if (event.key === 'Tab') {
        const nodes = [...dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || []]
        const first = nodes[0]
        const last = nodes.at(-1)
        if (!first) {
          event.preventDefault()
          dialogRef.current?.focus()
        } else if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [locked, onCancel])

  const submit = (): void => {
    if (locked) return
    setLocalError(null)
    if (mode === 'remove') {
      onSubmit()
      return
    }
    try {
      onSubmit(normalizeProjectEdit(name, mode === 'rename' ? project.path : path))
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const pick = async (): Promise<void> => {
    setPicking(true)
    setLocalError(null)
    try {
      const selected = await window.codex.pickDirectory()
      if (mounted.current && selected) setPath(selected.cwd)
    } catch (failure) {
      if (mounted.current) setLocalError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mounted.current) setPicking(false)
    }
  }

  const content = (
    <div className="project-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !locked) onCancel()
    }}>
      <section ref={dialogRef} className="project-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={mode === 'remove' ? descriptionId : undefined} tabIndex={-1}>
        <form onSubmit={(event) => { event.preventDefault(); submit() }}>
          <h2 id={titleId}>{title}</h2>
          {mode === 'remove' ? (
            <p id={descriptionId}>将“{project.name}”从项目列表中移除。文件夹和聊天会保留。</p>
          ) : (
            <>
              <label className="project-dialog-field">
                <span>项目名称</span>
                <input ref={inputRef} value={name} maxLength={200} disabled={locked} aria-label="项目名称" onChange={(event) => { setName(event.target.value); setLocalError(null) }} />
              </label>
              {mode === 'edit' && <label className="project-dialog-field">
                <span>文件夹</span>
                <div className="project-dialog-path">
                  <input value={path} maxLength={4096} disabled={locked} aria-label="项目文件夹" onChange={(event) => { setPath(event.target.value); setLocalError(null) }} />
                  <button type="button" disabled={locked} aria-label="选择项目文件夹" title="选择文件夹" onClick={() => void pick()}><Folder aria-hidden="true" /></button>
                </div>
              </label>}
              {mode === 'rename' && <p className="project-dialog-current-path" title={project.path}>{project.path}</p>}
            </>
          )}
          {(localError || error) && <div className="project-dialog-error" role="alert">{localError || error}</div>}
          <footer>
            <button ref={cancelRef} type="button" className="project-dialog-secondary" disabled={locked} onClick={onCancel}>取消</button>
            <button type="submit" className={mode === 'remove' ? 'project-dialog-danger' : 'project-dialog-primary'} disabled={locked || (mode !== 'remove' && (!name.trim() || (mode === 'edit' && !path.trim())))}>{busy ? '正在保存…' : picking ? '正在选择…' : mode === 'remove' ? '移除' : '保存'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

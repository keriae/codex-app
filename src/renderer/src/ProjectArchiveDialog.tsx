import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ProjectArchiveDialog({
  projectName, count, running, loading, busy, error, onCancel, onSubmit
}: {
  projectName: string
  count: number | null
  running: boolean
  loading: boolean
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(): void
}): ReactNode {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => {
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
        if (!busy) onCancel()
      } else if (event.key === 'Tab') {
        const nodes = [...dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || []]
        const first = nodes[0]
        const last = nodes.at(-1)
        if (!first) { event.preventDefault(); dialogRef.current?.focus() }
        else if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [busy, onCancel])

  const title = count === null ? '正在加载聊天…' : `${running ? '停止并归档' : '归档'} ${count} 个聊天？`
  const description = running
    ? '归档会停止所有正在进行的工作。你可以稍后在设置中恢复这些聊天。'
    : `这将归档“${projectName}”中的聊天。你可以稍后在已归档聊天中找到它们。`
  const content = (
    <div className="project-dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy && document.body.dataset.windowCloseActive !== 'true') onCancel()
    }}>
      <section ref={dialogRef} className="project-dialog project-archive-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy || loading} tabIndex={-1}>
        <form onSubmit={(event) => { event.preventDefault(); if (!busy && !loading && count && !error) onSubmit() }}>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
          {error && <div className="project-dialog-error" role="alert">{error}</div>}
          <footer>
            <button ref={cancelRef} type="button" className="project-dialog-secondary" disabled={busy} onClick={onCancel}>取消</button>
            <button type="submit" className="project-dialog-danger" disabled={busy || loading || !count || Boolean(error)}>{busy ? '正在归档…' : running ? '停止并归档' : '全部归档'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

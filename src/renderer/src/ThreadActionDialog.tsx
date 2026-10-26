import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Thread } from './protocol'
import './ThreadActionDialog.css'

export type ThreadDialogMode = 'rename' | 'delete' | 'revert'

export function ThreadActionDialog({
  mode,
  thread,
  busy,
  error,
  onCancel,
  onSubmit
}: {
  mode: ThreadDialogMode
  thread: Thread
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(name?: string): void
}): ReactNode {
  const [name, setName] = useState(thread.name || thread.preview || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const title =
    mode === 'rename' ? 'Rename chat' : mode === 'delete' ? 'Delete chat?' : 'Revert chat history?'

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    } else cancelRef.current?.focus()
    return () => previousFocus?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onCancel()
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || [])
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first) {
          event.preventDefault()
          dialogRef.current?.focus()
        } else if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, onCancel])

  const submit = (): void => {
    if (busy) return
    if (mode === 'rename') {
      const trimmed = name.trim()
      if (!trimmed) return
      onSubmit(trimmed)
    } else {
      onSubmit()
    }
  }

  const dialog = (
    <div className="thread-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section
        ref={dialogRef}
        className="thread-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {mode === 'rename' ? (
          <label className="thread-dialog-field">
            <span>Name</span>
            <input
              ref={inputRef}
              value={name}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
            />
          </label>
        ) : mode === 'delete' ? (
          <p>
            This permanently deletes the conversation and any spawned descendant chats.
            Files in the working folder are not deleted.
          </p>
        ) : (
          <p>
            This deletes this turn, including any follow-ups in it, and all chat history after
            it. Changes to files in the working folder are not restored.
          </p>
        )}
        {error && <div className="thread-dialog-error" role="alert">{error}</div>}
        <footer>
          <button ref={cancelRef} type="button" className="thread-dialog-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={mode === 'rename' ? 'thread-dialog-primary' : 'thread-dialog-danger'}
            disabled={busy || (mode === 'rename' && !name.trim())}
            onClick={submit}
          >
            {busy ? 'Working…' : mode === 'rename' ? 'Save' : mode === 'delete' ? 'Delete' : 'Revert'}
          </button>
        </footer>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

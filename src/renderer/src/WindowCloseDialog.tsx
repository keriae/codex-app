import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { WindowCloseRequest, WindowCloseResponse } from '../../shared/api'
import { windowCloseDialogResponse, windowCloseDialogZoom } from './windowCloseDialogState'
import './WindowCloseDialog.css'

export interface WindowCloseDialogProps {
  request: WindowCloseRequest
  onRespond(response: WindowCloseResponse): Promise<void>
  /** Additional CSS scale for a body portal outside a CSS-zoomed app root. */
  zoomFactor?: number
}

export function WindowCloseDialog(props: WindowCloseDialogProps): ReactNode {
  return <WindowCloseDialogContent key={props.request.id} {...props} />
}

function WindowCloseDialogContent({ request, onRespond, zoomFactor }: WindowCloseDialogProps): ReactNode {
  const [doNotAskAgain, setDoNotAskAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const checkboxId = useId()
  const zoom = windowCloseDialogZoom(zoomFactor)

  useLayoutEffect(() => {
    mounted.current = true
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.dataset.windowCloseActive = 'true'
    cancelRef.current?.focus({ preventScroll: true })
    return () => {
      mounted.current = false
      delete document.body.dataset.windowCloseActive
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  const respond = useCallback(async (confirmed: boolean): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await onRespond(windowCloseDialogResponse(confirmed, doNotAskAgain))
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }, [doNotAskAgain, onRespond])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        void respond(false)
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
  }, [respond])

  const style: CSSProperties = { zoom, maxWidth: `calc((100vw - 40px) / ${zoom})`, maxHeight: `calc((100vh - 40px) / ${zoom})` }
  const content = (
    <div className="window-close-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) void respond(false)
    }}>
      <section ref={dialogRef} className="window-close-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} style={style} data-close-request-id={request.id} data-close-origin={request.origin}>
        <form onSubmit={(event) => { event.preventDefault(); void respond(true) }}>
          <h2 id={titleId}>Are you sure you want to close the window?</h2>
          <div className="window-close-option">
            <input id={checkboxId} type="checkbox" checked={doNotAskAgain} disabled={busy} onChange={(event) => setDoNotAskAgain(event.target.checked)} />
            <label htmlFor={checkboxId}>Do not ask me again</label>
          </div>
          {error && <div className="window-close-error" role="alert">{error}</div>}
          <footer>
            <button ref={cancelRef} type="button" autoFocus className="window-close-cancel" disabled={busy} onClick={() => void respond(false)}>Cancel</button>
            <button type="submit" className="window-close-confirm" disabled={busy}>Close Window</button>
          </footer>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

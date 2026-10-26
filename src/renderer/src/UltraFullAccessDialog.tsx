import { TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './UltraFullAccessDialog.css'

export function trappedUltraDialogTabTarget(
  focusable: readonly HTMLElement[],
  activeElement: Element | null,
  backwards: boolean
): HTMLElement | null {
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return null
  const activeIndex = focusable.indexOf(activeElement as HTMLElement)
  if (activeIndex < 0) return backwards ? last : first
  if (backwards && activeIndex === 0) return last
  if (!backwards && activeIndex === focusable.length - 1) return first
  return null
}

export function UltraFullAccessDialog({
  canContinue,
  onClose,
  onContinueWithFullAccess,
  onContinueWithFallback
}: {
  canContinue: boolean
  onClose(): void
  onContinueWithFullAccess(): void
  onContinueWithFallback(): void
}): ReactNode {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.dataset.ultraFullAccessActive = 'true'
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      delete document.body.dataset.ultraFullAccessActive
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []]
      const target = trappedUltraDialogTabTarget(focusable, document.activeElement, event.shiftKey)
      if (!target) return
      event.preventDefault()
      target.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!canContinue) return
    onContinueWithFallback()
    onClose()
  }

  const content = (
    <div className="ultra-full-access-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="ultra-full-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <form onSubmit={submit}>
          <header>
            <h2 id={titleId}>是否启用 Ultra 搭配完整访问权限？</h2>
            <button ref={closeRef} type="button" className="ultra-full-access-close" aria-label="关闭" onClick={onClose}>
              <X />
            </button>
          </header>
          <p id={descriptionId}>
            {canContinue
              ? '开启 Ultra 和完整访问权限后，Codex 可在未经询问的前提下，运行命令、联网检索、编辑电脑内任意路径文件，同时启用深度推理。你可切换至管控更严格的权限模式，或使用完整访问权限。'
              : '开启 Ultra 和完整访问权限后，Codex 可在未经询问的前提下，运行命令、联网检索、编辑电脑内任意路径文件，同时启用深度推理。当前暂无管控更严格的权限模式可供选择。'}
          </p>
          <footer>
            <button type="button" className="ultra-full-access-danger" onClick={() => {
              onContinueWithFullAccess()
              onClose()
            }}>
              <TriangleAlert aria-hidden="true" />
              <span>使用完整访问权限</span>
            </button>
            <button type="submit" className="ultra-full-access-primary" disabled={!canContinue}>继续</button>
          </footer>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

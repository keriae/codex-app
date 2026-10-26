import { Folder, Globe2, Terminal } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { trappedUltraDialogTabTarget } from './UltraFullAccessDialog'
import './FullAccessConfirmDialog.css'

const SANDBOXING_URL = 'https://developers.openai.com/codex/concepts/sandboxing'

function WarningIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M8.505 3.645c.657-1.147 2.333-1.147 2.99 0l6.025 10.526c.64 1.119-.176 2.504-1.495 2.504H3.975c-1.319 0-2.135-1.385-1.495-2.504L8.505 3.645Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 7.083v3.334" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 13.333h.008" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function Capability({
  icon,
  title,
  description
}: {
  icon: ReactNode
  title: string
  description: string
}): ReactNode {
  return (
    <div className="full-access-capability">
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </div>
  )
}

export function FullAccessConfirmDialog({
  onCancel,
  onConfirm
}: {
  onCancel(): void
  onConfirm(): void
}): ReactNode {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.dataset.fullAccessConfirmActive = 'true'
    cancelRef.current?.focus({ preventScroll: true })
    return () => {
      delete document.body.dataset.fullAccessConfirmActive
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) || []]
      const target = trappedUltraDialogTabTarget(focusable, document.activeElement, event.shiftKey)
      if (!target) return
      event.preventDefault()
      target.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onConfirm()
  }

  const content = (
    <div className="full-access-confirm-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="full-access-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <form onSubmit={submit}>
          <h2 id={titleId}>
            <WarningIcon className="full-access-title-icon" />
            <span>开启完全访问权限？</span>
          </h2>
          <p id={descriptionId} className="full-access-intro">
            Codex 将能够在未经你许可的情况下运行命令、使用互联网，以及在此电脑任意位置创建和编辑文件。这包括但不限于：
          </p>
          <div className="full-access-capabilities">
            <Capability
              icon={<Folder />}
              title="文件和文件夹"
              description="读取、创建、修改、上传或删除此电脑任意位置的文件"
            />
            <Capability
              icon={<Terminal />}
              title="终端命令"
              description="运行命令、安装软件和更改系统设置"
            />
            <Capability
              icon={<Globe2 />}
              title="互联网和已连接的应用"
              description="访问网站、发送数据并使用已启用的插件"
            />
          </div>
          <p className="full-access-risk">
            这会带来敏感数据丢失或泄露、提示词注入等风险。你可以随时关闭此功能。{' '}
            <button
              type="button"
              onClick={() => void window.codex.openExternal(SANDBOXING_URL).catch(() => undefined)}
            >
              了解更多
            </button>
          </p>
          <footer>
            <button ref={cancelRef} type="button" className="full-access-cancel" onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="full-access-confirm">
              <WarningIcon />
              <span>确认</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

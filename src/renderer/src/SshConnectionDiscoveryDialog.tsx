import { Check, Plus, RefreshCw, Server, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type FormEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import './SshConnectionDiscoveryDialog.css'

export interface SshDiscoveryAlias {
  displayName: string
  sshAlias: string
  host: string
  port?: number
  identityFile?: string
  /** A matching saved connection cannot be selected a second time. */
  configured?: boolean
}

export interface SshConnectionDiscoveryDialogProps {
  aliases: readonly SshDiscoveryAlias[]
  open: boolean
  refreshing?: boolean
  saving?: boolean
  selectedAliases: readonly string[]
  error?: string | null
  onToggleAlias(alias: string): void
  onRefresh(): void | Promise<void>
  onAddManually(): void
  onSave(): void | Promise<void>
  onClose(): void
}

export function sshDiscoveryEndpoint(alias: Pick<SshDiscoveryAlias, 'host' | 'port'>): string {
  return `${alias.host}${alias.port ? `:${alias.port}` : ''}`
}

export function selectableSshAliases(
  aliases: readonly SshDiscoveryAlias[],
  selectedAliases: readonly string[]
): string[] {
  const selected = new Set(selectedAliases)
  return aliases
    .filter((alias) => !alias.configured && selected.has(alias.sshAlias))
    .map((alias) => alias.sshAlias)
}

function focusableDialogNodes(dialog: HTMLElement | null): HTMLElement[] {
  return [...dialog?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ) || []].filter((node) => node.offsetParent !== null || typeof window === 'undefined')
}

export function SshConnectionDiscoveryDialog({
  aliases,
  open,
  refreshing = false,
  saving = false,
  selectedAliases,
  error = null,
  onToggleAlias,
  onRefresh,
  onAddManually,
  onSave,
  onClose
}: SshConnectionDiscoveryDialogProps): ReactNode {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const firstAliasRef = useRef<HTMLButtonElement>(null)
  const manualRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const saveRequestedRef = useRef(false)
  const selected = useMemo(() => new Set(selectedAliases), [selectedAliases])
  const selectedCount = selectableSshAliases(aliases, selectedAliases).length

  useLayoutEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    saveRequestedRef.current = false
    const frame = requestAnimationFrame(() => {
      ;(firstAliasRef.current || manualRef.current)?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true })
      previousFocusRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        if (saving) return
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusableDialogNodes(dialogRef.current)
      if (nodes.length === 0) return
      const currentIndex = nodes.indexOf(document.activeElement as HTMLElement)
      const target = event.shiftKey
        ? nodes[currentIndex <= 0 ? nodes.length - 1 : currentIndex - 1]
        : nodes[currentIndex < 0 || currentIndex === nodes.length - 1 ? 0 : currentIndex + 1]
      event.preventDefault()
      target.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, open, saving])

  if (!open) return null

  const requestSave = async (): Promise<void> => {
    if (saving || selectedCount === 0 || saveRequestedRef.current) return
    saveRequestedRef.current = true
    try {
      await onSave()
    } finally {
      saveRequestedRef.current = false
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void requestSave()
  }
  const closeFromBackdrop = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget && !saving) onClose()
  }

  let firstSelectableAssigned = false
  const content = (
    <div className="ssh-discovery-backdrop" role="presentation" onPointerDown={closeFromBackdrop}>
      <section
        ref={dialogRef}
        className="ssh-discovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <form onSubmit={submit}>
          <header>
            <span>
              <h2 id={titleId}>添加 SSH 连接</h2>
              <p id={descriptionId}>从此 Mac 的 SSH 配置中选择要添加的主机。</p>
            </span>
            <button type="button" className="ssh-discovery-close" aria-label="关闭" disabled={saving} onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="ssh-discovery-toolbar">
            <span>SSH 配置</span>
            <button
              type="button"
              aria-label="刷新 SSH 连接"
              disabled={refreshing || saving}
              onClick={() => void onRefresh()}
            >
              <RefreshCw className={refreshing ? 'spin' : undefined} aria-hidden="true" />
              <span>{refreshing ? '正在刷新…' : '刷新'}</span>
            </button>
          </div>

          <div className="ssh-discovery-list" role="group" aria-label="可用的 SSH 连接" aria-busy={refreshing}>
            {aliases.map((alias) => {
              const checked = selected.has(alias.sshAlias) && !alias.configured
              const assignInitialRef = !alias.configured && !firstSelectableAssigned
              if (assignInitialRef) firstSelectableAssigned = true
              return (
                <button
                  ref={assignInitialRef ? firstAliasRef : undefined}
                  key={alias.sshAlias}
                  type="button"
                  className="ssh-discovery-row"
                  role="checkbox"
                  aria-checked={checked}
                  aria-disabled={alias.configured || saving}
                  disabled={alias.configured || saving}
                  onClick={() => onToggleAlias(alias.sshAlias)}
                >
                  <span className="ssh-discovery-server-icon"><Server aria-hidden="true" /></span>
                  <span className="ssh-discovery-copy">
                    <strong>{alias.displayName || alias.sshAlias}</strong>
                    <small>
                      <span>{alias.sshAlias}</span>
                      <span aria-hidden="true">·</span>
                      <span>{sshDiscoveryEndpoint(alias)}</span>
                    </small>
                    {alias.identityFile && <small className="ssh-discovery-identity" title={alias.identityFile}>{alias.identityFile}</small>}
                  </span>
                  {alias.configured ? (
                    <span className="ssh-discovery-added">已添加</span>
                  ) : (
                    <span className="ssh-discovery-checkbox" aria-hidden="true">{checked && <Check />}</span>
                  )}
                </button>
              )
            })}
            {aliases.length === 0 && (
              <div className="ssh-discovery-empty">
                <span className="ssh-discovery-empty-icon"><Server aria-hidden="true" /></span>
                <strong>{refreshing ? '正在查找 SSH 连接…' : '未找到 SSH 连接'}</strong>
                <span>请检查 ~/.ssh/config，或手动添加主机。</span>
                {!refreshing && (
                  <button type="button" disabled={saving} onClick={() => void onRefresh()}>
                    <RefreshCw aria-hidden="true" /> 刷新
                  </button>
                )}
              </div>
            )}
          </div>

          {error && <div className="ssh-discovery-error" role="alert">{error}</div>}

          <footer>
            <button ref={manualRef} type="button" className="ssh-discovery-manual" disabled={saving} onClick={onAddManually}>
              <Plus aria-hidden="true" />
              <span>手动添加</span>
            </button>
            <span className="ssh-discovery-footer-actions">
              <button type="button" className="ssh-discovery-cancel" disabled={saving} onClick={onClose}>取消</button>
              <button type="submit" className="ssh-discovery-save" disabled={saving || selectedCount === 0}>
                {saving ? '正在添加…' : selectedCount > 1 ? `添加 ${selectedCount} 个` : '添加'}
              </button>
            </span>
          </footer>
        </form>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

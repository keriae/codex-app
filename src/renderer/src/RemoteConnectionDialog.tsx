import { Globe2, KeyRound, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { RemoteConnection, SaveRemoteConnectionOptions } from '../../shared/api'
import './RemoteConnectionDialog.css'

export type RemoteConnectionTargetKind = 'hostname' | 'alias'
export type RemoteConnectionAuthMode = 'none' | 'identity'

export interface RemoteConnectionDraft {
  displayName: string
  targetKind: RemoteConnectionTargetKind
  sshHost: string
  sshPort: string
  authMode: RemoteConnectionAuthMode
  identity: string
}

export function remoteConnectionDraft(connection?: RemoteConnection | null): RemoteConnectionDraft {
  return {
    displayName: connection?.displayName || '',
    targetKind: connection?.sshAlias ? 'alias' : 'hostname',
    sshHost: connection?.sshAlias || connection?.host || '',
    sshPort: connection?.port ? String(connection.port) : '',
    authMode: connection?.identityFile ? 'identity' : 'none',
    identity: connection?.identityFile || ''
  }
}

export function remoteConnectionSaveOptions(
  draft: RemoteConnectionDraft,
  hostId?: string
): SaveRemoteConnectionOptions {
  const displayName = draft.displayName.trim()
  const target = draft.sshHost.trim()
  if (!displayName) throw new Error('请输入显示名称')
  if (!target) throw new Error(draft.targetKind === 'alias' ? '请输入 SSH 配置别名' : '请输入主机名')
  let port: number | undefined
  if (draft.targetKind === 'hostname' && draft.sshPort.trim()) {
    port = Number(draft.sshPort)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('SSH 端口必须是 1–65535 之间的整数')
    }
  }
  const identity = draft.identity.trim()
  if (draft.targetKind === 'hostname' && draft.authMode === 'identity' && !identity) {
    throw new Error('请输入身份文件路径')
  }
  if (draft.targetKind === 'hostname' && identity && !identity.startsWith('/') && !identity.startsWith('~/')) {
    throw new Error('身份文件路径必须是绝对路径')
  }
  return {
    ...(hostId ? {hostId} : {}),
    displayName,
    ...(draft.targetKind === 'alias' ? {sshAlias: target} : {host: target}),
    ...(draft.targetKind === 'hostname' ? {port: port ?? null} : {}),
    ...(draft.targetKind === 'alias'
      ? hostId ? {identityFile: ''} : {}
      : draft.authMode === 'identity' ? {identityFile: identity} : hostId ? {identityFile: ''} : {})
  }
}

export function RemoteConnectionDialog({
  connection,
  connections,
  busy = false,
  error,
  onCancel,
  onSubmit
}: {
  connection?: RemoteConnection | null
  connections: readonly RemoteConnection[]
  busy?: boolean
  error?: string | null
  onCancel(): void
  onSubmit(options: SaveRemoteConnectionOptions): void | Promise<void>
}): ReactNode {
  const titleId = useId()
  const displayNameRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState(() => remoteConnectionDraft(connection))
  const [localError, setLocalError] = useState<string | null>(null)
  const duplicateName = useMemo(() => {
    const name = draft.displayName.trim().toLocaleLowerCase()
    if (!name) return false
    return connections.some((candidate) => candidate.hostId !== connection?.hostId &&
      candidate.displayName.trim().toLocaleLowerCase() === name)
  }, [connection?.hostId, connections, draft.displayName])

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    displayNameRef.current?.focus({preventScroll: true})
    return () => previousFocusRef.current?.focus({preventScroll: true})
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [busy, onCancel])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setLocalError(null)
    if (duplicateName) {
      setLocalError('使用此显示名称的连接已存在')
      return
    }
    try {
      void onSubmit(remoteConnectionSaveOptions(draft, connection?.hostId))
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const visibleError = duplicateName
    ? '使用此显示名称的连接已存在'
    : localError || error

  return createPortal(
    <div className="remote-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section className="remote-connection-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <form onSubmit={submit}>
          <header>
            <h2 id={titleId}>{connection ? '编辑连接' : '添加 SSH 连接'}</h2>
          </header>
          <button type="button" className="remote-dialog-close" aria-label="关闭" disabled={busy} onClick={onCancel}><X /></button>
          <div className="remote-dialog-fields">
            <label className="remote-dialog-field remote-dialog-name-field">
              <span>显示名称</span>
              <div className="remote-dialog-name-input">
                <span aria-hidden="true"><Globe2 /></span>
                <input ref={displayNameRef} autoFocus value={draft.displayName} placeholder="开发服务器" disabled={busy}
                  onChange={(event) => setDraft((value) => ({...value, displayName: event.currentTarget.value}))} />
              </div>
            </label>
            <label className="remote-dialog-field remote-dialog-host-field">
              <span>{draft.targetKind === 'alias' ? '别名' : '主机名'}</span>
              <input value={draft.sshHost} disabled={busy || draft.targetKind === 'alias'}
                placeholder={draft.targetKind === 'alias' ? undefined : 'host.com 或 user@host.com'}
                onChange={(event) => setDraft((value) => ({...value, sshHost: event.currentTarget.value}))} />
            </label>
            {draft.targetKind === 'hostname' && (
              <>
                <label className="remote-dialog-field remote-dialog-port-field">
                  <span>SSH 端口 <small>（可选）</small></span>
                  <input inputMode="numeric" value={draft.sshPort} disabled={busy}
                    onChange={(event) => setDraft((value) => ({...value, sshPort: event.currentTarget.value}))} />
                </label>
                <div className="remote-dialog-auth-segment" role="group" aria-label="SSH 身份验证方法">
                  {([
                    ['none', '无身份验证'],
                    ['identity', '身份文件']
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={draft.authMode === mode}
                      disabled={busy}
                      onClick={() => setDraft((value) => ({...value, authMode: mode}))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {draft.authMode === 'identity' && <label className="remote-dialog-field remote-dialog-identity-field">
                  <span>身份文件路径</span>
                  <div><KeyRound /><input value={draft.identity} placeholder="~/.ssh/id_ed25519" disabled={busy}
                    onChange={(event) => setDraft((value) => ({...value, identity: event.currentTarget.value}))} /></div>
                </label>}
              </>
            )}
            {visibleError && <div className="remote-dialog-error" role="alert">{visibleError}</div>}
          </div>
          <footer>
            <button type="button" className="remote-dialog-secondary" disabled={busy} onClick={onCancel}>取消</button>
            <button type="submit" className="remote-dialog-primary" disabled={busy || duplicateName}>
              {busy ? '正在保存…' : '保存'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}

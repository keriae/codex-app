import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  LoaderCircle,
  Monitor,
  Plus,
  X
} from 'lucide-react'
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
import type {
  CreateRemoteProjectOptions,
  RemoteConnection,
  RemoteDirectoryEntry,
  RemoteDirectoryListing,
  RemotePathValidation,
  RemoteProject
} from '../../shared/api'
import './RemoteProjectDialog.css'

export interface RemoteProjectDialogProps {
  connections: readonly RemoteConnection[]
  initialHostId?: string | null
  initialName?: string
  initialPath?: string
  error?: string | null
  busy?: boolean
  onAddRemote?(): void
  onListDirectory(hostId: string, path?: string): Promise<RemoteDirectoryListing>
  onValidatePath(hostId: string, path: string): Promise<RemotePathValidation>
  onCreateDirectory?(hostId: string, path: string): Promise<RemotePathValidation>
  onCreate(options: CreateRemoteProjectOptions): Promise<RemoteProject | boolean | void> | RemoteProject | boolean | void
  onClose(): void
}

type RemoteDirectoryLoader = (
  hostId: string,
  path?: string
) => Promise<RemoteDirectoryListing>

interface RemoteDirectoryCacheEntry {
  expiresAt: number
  promise: Promise<RemoteDirectoryListing>
  value?: RemoteDirectoryListing
}

const REMOTE_DIRECTORY_STALE_MS = 5_000
const REMOTE_DIRECTORY_PREFETCH_STALE_MS = Number.POSITIVE_INFINITY
const MAX_REMOTE_DIRECTORY_CACHE_ENTRIES = 512
const remoteDirectoryCache = new Map<string, RemoteDirectoryCacheEntry>()

function remoteDirectoryCacheKey(hostId: string, path?: string): string {
  return JSON.stringify([hostId, path ?? null])
}

export function clearRemoteDirectoryCacheForTests(): void {
  remoteDirectoryCache.clear()
}

export function loadRemoteDirectoryCached(
  loader: RemoteDirectoryLoader,
  hostId: string,
  path?: string,
  staleMs = REMOTE_DIRECTORY_STALE_MS
): Promise<RemoteDirectoryListing> {
  const key = remoteDirectoryCacheKey(hostId, path)
  const now = Date.now()
  const cached = remoteDirectoryCache.get(key)
  if (cached && (cached.value === undefined || cached.expiresAt > now)) return cached.promise
  if (cached) remoteDirectoryCache.delete(key)
  while (remoteDirectoryCache.size >= MAX_REMOTE_DIRECTORY_CACHE_ENTRIES) {
    const oldest = remoteDirectoryCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    remoteDirectoryCache.delete(oldest)
  }
  let entry: RemoteDirectoryCacheEntry
  const promise = loader(hostId, path).then((value) => {
    if (remoteDirectoryCache.get(key) === entry) {
      entry.value = value
      entry.expiresAt = Date.now() + Math.max(0, staleMs)
    }
    return value
  }).catch((error: unknown) => {
    if (remoteDirectoryCache.get(key) === entry) remoteDirectoryCache.delete(key)
    throw error
  })
  entry = { expiresAt: Number.POSITIVE_INFINITY, promise }
  remoteDirectoryCache.set(key, entry)
  return promise
}

export function peekRemoteDirectoryCache(
  hostId: string,
  path?: string
): RemoteDirectoryListing | null {
  const cached = remoteDirectoryCache.get(remoteDirectoryCacheKey(hostId, path))
  return cached?.value !== undefined && cached.expiresAt > Date.now() ? cached.value : null
}

export async function prefetchRemoteDirectories(
  loader: RemoteDirectoryLoader,
  hostId: string,
  entries: readonly RemoteDirectoryEntry[]
): Promise<void> {
  const directories = entries.filter((entry) => entry.isDirectory)
  await Promise.all(
    directories.map((entry) =>
      loadRemoteDirectoryCached(
        loader,
        hostId,
        entry.path,
        REMOTE_DIRECTORY_PREFETCH_STALE_MS
      ).catch(() => undefined)
    )
  )
}

export interface RemoteDirectoryBreadcrumb {
  label: string
  path: string
}

export type RemotePathDecision =
  | { kind: 'ready'; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'error'; message: string }

export function connectedRemoteConnections(connections: readonly RemoteConnection[]): RemoteConnection[] {
  return connections.filter((connection) => connection.state === 'connected')
}

export function normalizeRemoteProjectPath(value: string): string | null {
  const path = value.trim()
  if (!path.startsWith('/') || path.includes('\0')) return null
  return path === '/' ? path : path.replace(/\/+$/u, '')
}

export function remoteProjectName(name: string, path: string): string {
  const explicit = name.trim()
  if (explicit) return explicit
  return normalizeRemoteProjectPath(path)?.split('/').filter(Boolean).at(-1) || '远程项目'
}

export function remoteDirectoryBreadcrumbs(path: string): RemoteDirectoryBreadcrumb[] {
  const normalized = normalizeRemoteProjectPath(path) || '/'
  if (normalized === '/') return [{label: '/', path: '/'}]
  const segments = normalized.split('/').filter(Boolean)
  return [
    {label: '/', path: '/'},
    ...segments.map((label, index) => ({label, path: `/${segments.slice(0, index + 1).join('/')}`}))
  ]
}

export function remoteDirectoryEntries(listing: RemoteDirectoryListing): RemoteDirectoryEntry[] {
  return listing.entries.filter((entry) => entry.isDirectory)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {numeric: true, sensitivity: 'base'}))
}

export function remotePathDecision(validation: RemotePathValidation): RemotePathDecision {
  const path = normalizeRemoteProjectPath(validation.path || validation.requestedPath)
  if (!path) return { kind: 'error', message: '请输入远程主机上的绝对文件夹路径。' }
  if (!validation.exists) return { kind: 'missing', path }
  if (!validation.isDirectory) return { kind: 'error', message: '所选路径不是文件夹。' }
  return { kind: 'ready', path }
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function RemoteHostIcon({ connected = true }: { connected?: boolean }): ReactNode {
  return (
    <span className="remote-project-host-icon" data-state={connected ? 'connected' : 'disconnected'} aria-hidden="true">
      <Monitor />
      <i />
    </span>
  )
}

export function RemoteDirectoryBrowser({
  listing,
  loading,
  error,
  disabled = false,
  listId,
  onNavigate,
  onRetry
}: {
  listing: RemoteDirectoryListing | null
  loading: boolean
  error: string | null
  disabled?: boolean
  listId?: string
  onNavigate(path: string): void
  onRetry(): void
}): ReactNode {
  const directories = listing ? remoteDirectoryEntries(listing) : []
  return (
    <div id={listId} className="remote-project-directory-list" role="listbox" aria-label="远程文件夹">
      {loading && (
        <div className="remote-project-directory-message" role="status">
          <LoaderCircle className="spin" aria-hidden="true" />
          <span>正在载入文件夹…</span>
        </div>
      )}
      {!loading && error && (
        <div className="remote-project-directory-message is-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}
      {!loading && !error && directories.map((entry) => (
        <button
          key={entry.path}
          type="button"
          role="option"
          aria-selected="false"
          title={entry.path}
          disabled={disabled}
          onClick={() => onNavigate(entry.path)}
        >
          <Folder aria-hidden="true" />
          <span>{entry.name}</span>
        </button>
      ))}
      {!loading && !error && listing && directories.length === 0 && (
        <div className="remote-project-directory-message">此文件夹中没有子文件夹</div>
      )}
    </div>
  )
}

export function RemoteProjectDialog({
  connections,
  initialHostId = null,
  initialName = '',
  initialPath = '',
  error = null,
  busy = false,
  onAddRemote,
  onListDirectory,
  onValidatePath,
  onCreateDirectory,
  onCreate,
  onClose
}: RemoteProjectDialogProps): ReactNode {
  const connected = useMemo(() => connectedRemoteConnections(connections), [connections])
  const initialConnection = connected.find((connection) => connection.hostId === initialHostId) || connected[0] || null
  const [hostId, setHostId] = useState<string | null>(initialConnection?.hostId || null)
  const [name, setName] = useState(initialName)
  const [path, setPath] = useState(initialPath)
  const [hostMenuOpen, setHostMenuOpen] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [folderDraft, setFolderDraft] = useState(initialPath)
  const [directoryListing, setDirectoryListing] = useState<RemoteDirectoryListing | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [missingPath, setMissingPath] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'validating' | 'creating-directory' | 'creating'>('idle')
  const [localError, setLocalError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const pathRef = useRef<HTMLInputElement>(null)
  const hostButtonRef = useRef<HTMLButtonElement>(null)
  const directoryRequestRef = useRef(0)
  const onListDirectoryRef = useRef(onListDirectory)
  onListDirectoryRef.current = onListDirectory
  const titleId = useId()
  const directoryListId = useId()
  const locked = busy || phase !== 'idle'
  const selectedConnection = connected.find((connection) => connection.hostId === hostId) || null
  const selectedHostId = selectedConnection?.hostId ?? null
  const selectedHostIdRef = useRef(selectedHostId)
  selectedHostIdRef.current = selectedHostId
  const normalizedPath = normalizeRemoteProjectPath(path)
  const submitDisabled = locked || selectedConnection == null || normalizedPath == null

  useEffect(() => {
    if (hostId && connected.some((connection) => connection.hostId === hostId)) return
    setHostId(connected[0]?.hostId || null)
    setPath('')
    setFolderDraft('')
    setDirectoryListing(null)
    setDirectoryError(null)
  }, [connected, hostId])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    nameRef.current?.focus({ preventScroll: true })
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (folderPickerOpen) requestAnimationFrame(() => pathRef.current?.focus({ preventScroll: true }))
  }, [folderPickerOpen])

  useEffect(() => {
    if (!folderPickerOpen || !selectedHostId || !directoryListing) return
    void prefetchRemoteDirectories(
      (nextHostId, nextPath) => onListDirectoryRef.current(nextHostId, nextPath),
      selectedHostId,
      directoryListing.entries
    )
  }, [directoryListing, folderPickerOpen, selectedHostId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (locked) return
        if (missingPath) setMissingPath(null)
        else if (folderPickerOpen) setFolderPickerOpen(false)
        else if (hostMenuOpen) setHostMenuOpen(false)
        else onClose()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = [...dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || []]
        .filter((node) => !node.closest('[hidden]'))
      const first = nodes[0]
      const last = nodes.at(-1)
      if (!first) return
      if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [folderPickerOpen, hostMenuOpen, locked, missingPath, onClose])

  const selectHost = (connection: RemoteConnection): void => {
    if (locked) return
    directoryRequestRef.current += 1
    setHostId(connection.hostId)
    setHostMenuOpen(false)
    setPath('')
    setFolderDraft('')
    setDirectoryListing(null)
    setDirectoryError(null)
    setLocalError(null)
    requestAnimationFrame(() => hostButtonRef.current?.focus({ preventScroll: true }))
  }

  const loadDirectory = async (requestedPath?: string): Promise<void> => {
    if (!selectedConnection) return
    const requestId = ++directoryRequestRef.current
    const requestHostId = selectedConnection.hostId
    const cached = peekRemoteDirectoryCache(requestHostId, requestedPath)
    const applyListing = (listing: RemoteDirectoryListing): void => {
      const listingPath = normalizeRemoteProjectPath(listing.path)
      if (!listingPath) throw new Error('远程主机返回了无效的文件夹路径。')
      const normalized: RemoteDirectoryListing = {
        path: listingPath,
        parentPath: listing.parentPath == null ? null : normalizeRemoteProjectPath(listing.parentPath),
        entries: listing.entries
      }
      setDirectoryListing(normalized)
      setFolderDraft(listingPath)
    }
    setDirectoryError(null)
    if (cached) {
      setDirectoryLoading(false)
      try {
        applyListing(cached)
      } catch (failure) {
        setDirectoryError(displayError(failure))
      }
      return
    }
    setDirectoryLoading(true)
    try {
      const listing = await loadRemoteDirectoryCached(
        (nextHostId, nextPath) => onListDirectoryRef.current(nextHostId, nextPath),
        requestHostId,
        requestedPath
      )
      if (requestId !== directoryRequestRef.current || selectedHostIdRef.current !== requestHostId) return
      applyListing(listing)
    } catch (failure) {
      if (requestId !== directoryRequestRef.current || selectedHostIdRef.current !== requestHostId) return
      setDirectoryError(displayError(failure))
    } finally {
      if (requestId === directoryRequestRef.current) setDirectoryLoading(false)
    }
  }

  const openFolderPicker = (): void => {
    if (locked || !selectedConnection) return
    const initialDirectory = normalizeRemoteProjectPath(path) || undefined
    setFolderDraft(path)
    setDirectoryListing(null)
    setDirectoryError(null)
    setLocalError(null)
    setFolderPickerOpen(true)
    void loadDirectory(initialDirectory)
  }

  const loadTypedDirectory = (): void => {
    const next = normalizeRemoteProjectPath(folderDraft)
    if (!next) {
      setDirectoryError('请输入远程主机上的绝对文件夹路径。')
      pathRef.current?.focus()
      return
    }
    void loadDirectory(next)
  }

  const useFolder = (): void => {
    const next = normalizeRemoteProjectPath(folderDraft)
    if (!next) {
      setLocalError('请输入远程主机上的绝对文件夹路径。')
      pathRef.current?.focus()
      return
    }
    setPath(next)
    setFolderDraft(next)
    setDirectoryError(null)
    setLocalError(null)
    setFolderPickerOpen(false)
  }

  const create = async (resolvedPath: string): Promise<void> => {
    if (!selectedConnection) return
    setPhase('creating')
    setLocalError(null)
    try {
      const result = await onCreate({
        hostId: selectedConnection.hostId,
        label: remoteProjectName(name, resolvedPath),
        remotePath: resolvedPath
      })
      if (result !== false) onClose()
    } catch (failure) {
      setLocalError(displayError(failure))
    } finally {
      setPhase('idle')
    }
  }

  const submit = async (): Promise<void> => {
    if (submitDisabled || !selectedConnection || !normalizedPath) return
    setPhase('validating')
    setLocalError(null)
    try {
      const decision = remotePathDecision(await onValidatePath(selectedConnection.hostId, normalizedPath))
      if (decision.kind === 'error') {
        setLocalError(decision.message)
        return
      }
      if (decision.kind === 'missing') {
        if (!onCreateDirectory) {
          setLocalError('无法验证此远程文件夹。请检查路径是否存在，然后重试。')
          return
        }
        setMissingPath(decision.path)
        return
      }
      await create(decision.path)
    } catch (failure) {
      setLocalError(displayError(failure))
    } finally {
      setPhase((current) => current === 'validating' ? 'idle' : current)
    }
  }

  const createMissingDirectory = async (): Promise<void> => {
    if (!missingPath || !selectedConnection || !onCreateDirectory || locked) return
    setPhase('creating-directory')
    setLocalError(null)
    try {
      const decision = remotePathDecision(await onCreateDirectory(selectedConnection.hostId, missingPath))
      if (decision.kind !== 'ready') {
        setLocalError(decision.kind === 'error' ? decision.message : '无法创建远程文件夹。')
        return
      }
      setMissingPath(null)
      setPath(decision.path)
      await create(decision.path)
    } catch (failure) {
      setLocalError(displayError(failure))
    } finally {
      setPhase((current) => current === 'creating-directory' ? 'idle' : current)
    }
  }

  const formSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void submit()
  }

  const content = (
    <>
      <div className="remote-project-dialog-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked && !folderPickerOpen && !missingPath) onClose()
      }}>
        <section
          ref={dialogRef}
          className="remote-project-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <form onSubmit={formSubmit}>
          <header className="remote-project-dialog-header">
            <h2 id={titleId}>创建项目</h2>
          </header>
          <button
            type="button"
            className="remote-project-dialog-close"
            aria-label="关闭"
            title="关闭"
            disabled={locked}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>

          <fieldset disabled={locked}>
            <label className="remote-project-name-field">
              <span className="remote-project-visually-hidden">名称</span>
              <span className="remote-project-name-input">
                <span className="remote-project-name-leading" aria-hidden="true">
                  <Folder />
                </span>
                <input
                  ref={nameRef}
                  aria-label="项目名称"
                  value={name}
                  maxLength={200}
                  placeholder={normalizedPath ? remoteProjectName('', normalizedPath) : '项目名称'}
                  onChange={(event) => { setName(event.target.value); setLocalError(null) }}
                />
              </span>
            </label>

            <section className="remote-project-source-section" aria-label="源文件夹">
              <div className="remote-project-source-heading">
                <strong>源文件夹</strong>
              </div>

              {path ? (
                <div className="remote-project-source-row">
                  <Folder aria-hidden="true" />
                  <button type="button" title={path} onClick={openFolderPicker}>
                    <strong>{remoteProjectName('', path)}</strong>
                    <span>{path}</span>
                  </button>
                  <button
                    type="button"
                    className="remote-project-source-remove"
                    aria-label="移除文件夹"
                    title="移除文件夹"
                    onClick={() => { setPath(''); setFolderDraft(''); setLocalError(null) }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="remote-project-source-empty">
                  <div className="remote-project-host-picker">
                    <button
                      ref={hostButtonRef}
                      type="button"
                      className="remote-project-host-trigger"
                      aria-label="项目所在设备"
                      aria-haspopup="listbox"
                      aria-expanded={hostMenuOpen}
                      onClick={() => setHostMenuOpen((open) => !open)}
                    >
                      {selectedConnection ? (
                        <span>在 <strong>{selectedConnection.displayName}</strong> 上添加文件夹</span>
                      ) : (
                        <span>选择远程设备</span>
                      )}
                      <ChevronDown aria-hidden="true" />
                    </button>
                    {hostMenuOpen && (
                      <div className="remote-project-host-menu" role="listbox" aria-label="远程设备">
                        <div className="remote-project-host-menu-label">远程设备</div>
                        {connected.map((connection) => (
                          <button
                            key={connection.hostId}
                            type="button"
                            role="option"
                            aria-selected={connection.hostId === hostId}
                            onClick={() => selectHost(connection)}
                          >
                            <RemoteHostIcon />
                            <span>{connection.displayName}</span>
                            {connection.hostId === hostId && <Check aria-hidden="true" />}
                          </button>
                        ))}
                        {connected.length === 0 && <div className="remote-project-host-empty">没有已连接的远程设备</div>}
                        {onAddRemote && (
                          <div className="remote-project-host-menu-footer">
                            <button type="button" onClick={() => { setHostMenuOpen(false); onAddRemote() }}>
                              <Plus aria-hidden="true" />
                              <span>添加远程主机</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button type="button" disabled={!selectedConnection} onClick={openFolderPicker}>
                    <FolderPlus aria-hidden="true" />
                    <span>添加</span>
                  </button>
                </div>
              )}
            </section>

            {(localError || error || connected.length === 0) && (
              <div className="remote-project-dialog-message" aria-live="polite">
                {(localError || error) && (
                <span className="remote-project-dialog-error" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span>{localError || error}</span>
                </span>
                )}
                {!localError && !error && connected.length === 0 && (
                <span className="remote-project-dialog-warning">
                  <AlertTriangle aria-hidden="true" />
                  <span>目前没有连接任何远程主机。</span>
                  {onAddRemote && <button type="button" onClick={onAddRemote}>添加远程主机</button>}
                </span>
                )}
              </div>
            )}

            <footer>
              <button type="button" className="remote-project-dialog-secondary" disabled={locked} onClick={onClose}>取消</button>
              <button type="submit" className="remote-project-dialog-primary" disabled={submitDisabled}>
                {phase === 'validating' || phase === 'creating' || phase === 'creating-directory'
                  ? <><LoaderCircle className="spin" aria-hidden="true" /><span>{phase === 'validating' ? '正在验证…' : '正在创建…'}</span></>
                  : '创建项目'}
              </button>
            </footer>
          </fieldset>
          </form>
        </section>
      </div>

      {folderPickerOpen && (
        <div className="remote-project-nested-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !locked) setFolderPickerOpen(false)
          }}>
            <section className="remote-project-folder-dialog" role="dialog" aria-modal="true" aria-label="选择源文件夹">
              <header className="remote-project-folder-header">
                <h3>选择源文件夹</h3>
              </header>
              <button
                type="button"
                className="remote-project-dialog-close remote-project-folder-close"
                aria-label="关闭"
                title="关闭"
                disabled={locked}
                onClick={() => setFolderPickerOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
              <div className="remote-project-folder-content">
                <div className="remote-project-folder-browser-shell">
                  <div className="remote-project-folder-path-row">
                    <button
                      type="button"
                      className="remote-project-directory-up"
                      aria-label="转到上一级文件夹"
                      title="转到上一级文件夹"
                      disabled={locked || directoryLoading || !directoryListing?.parentPath}
                      onClick={() => {
                        if (directoryListing?.parentPath) void loadDirectory(directoryListing.parentPath)
                      }}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <input
                      ref={pathRef}
                      value={folderDraft}
                      placeholder="/home/user/project"
                      role="combobox"
                      aria-label="所选文件夹路径"
                      aria-controls={directoryListId}
                      aria-expanded="true"
                      aria-invalid={folderDraft.length > 0 && normalizeRemoteProjectPath(folderDraft) == null}
                      onChange={(event) => { setFolderDraft(event.target.value); setDirectoryError(null) }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        loadTypedDirectory()
                      }}
                    />
                  </div>
                  <div className="remote-project-directory-browser">
                    <RemoteDirectoryBrowser
                      listId={directoryListId}
                      listing={directoryListing}
                      loading={directoryLoading}
                      error={directoryError}
                      disabled={locked}
                      onNavigate={(nextPath) => void loadDirectory(nextPath)}
                      onRetry={loadTypedDirectory}
                    />
                  </div>
                </div>
              </div>
              <footer>
                <button type="button" className="remote-project-dialog-secondary" disabled={locked} onClick={() => setFolderPickerOpen(false)}>取消</button>
                <button type="button" className="remote-project-dialog-primary" disabled={locked || directoryLoading || normalizeRemoteProjectPath(folderDraft) == null} onClick={useFolder}>使用文件夹</button>
              </footer>
            </section>
          </div>
      )}

      {missingPath && (
        <div className="remote-project-nested-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !locked) setMissingPath(null)
          }}>
            <section className="remote-project-missing-dialog" role="alertdialog" aria-modal="true" aria-label="创建缺失的文件夹">
              <header>
                <h3>创建缺失的文件夹？</h3>
                <p>要先在 <strong>{selectedConnection?.displayName}</strong> 上创建 <code>{missingPath}</code>，然后添加项目吗？</p>
              </header>
              <footer>
                <button type="button" className="remote-project-dialog-secondary" disabled={locked} onClick={() => setMissingPath(null)}>取消</button>
                <button type="button" className="remote-project-dialog-primary" disabled={locked} onClick={() => void createMissingDirectory()}>
                  {phase === 'creating-directory' ? <><LoaderCircle className="spin" aria-hidden="true" /><span>正在创建…</span></> : '创建文件夹'}
                </button>
              </footer>
            </section>
          </div>
      )}
    </>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

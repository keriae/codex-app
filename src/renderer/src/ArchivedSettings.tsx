import { Archive, ArchiveRestore, LoaderCircle, RefreshCw, Search, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackendStatus } from '../../shared/api'
import type { Page, Thread } from './protocol'
import { sanitizeIntegrationDiagnostic } from './integrationModels'
import { ThreadActionDialog } from './ThreadActionDialog'

export function mergeArchivedThreads(current: Thread[], incoming: Thread[]): Thread[] {
  const merged = new Map(current.map((thread) => [thread.id, thread]))
  for (const thread of incoming) merged.set(thread.id, thread)
  return [...merged.values()].sort((a, b) => (b.recencyAt ?? b.updatedAt) - (a.recencyAt ?? a.updatedAt))
}

function displayError(error: unknown): string {
  return sanitizeIntegrationDiagnostic(error instanceof Error ? error.message : String(error))
}

export function ArchivedSettings({
  backend,
  onThreadRestored,
  onOpenThread
}: {
  backend: BackendStatus
  onThreadRestored?(thread: Thread): void
  onOpenThread?(thread: Thread): void
}): ReactNode {
  const [threads, setThreads] = useState<Thread[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Thread | null>(null)
  const sequence = useRef(0)
  const seenCursors = useRef(new Set<string>())

  const load = useCallback(async (nextCursor: string | null = null): Promise<void> => {
    const request = ++sequence.current
    if (backend.state !== 'ready') {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    if (!nextCursor) seenCursors.current.clear()
    try {
      const page = await window.codex.invoke<Page<Thread>>('thread/list', {
        archived: true,
        cursor: nextCursor,
        limit: 50,
        sortKey: 'recency_at',
        sortDirection: 'desc'
      })
      if (request !== sequence.current) return
      if (!page || !Array.isArray(page.data)) throw new Error('Codex Server 返回了无效的聊天列表。')
      if (page.nextCursor && seenCursors.current.has(page.nextCursor)) throw new Error('Codex Server 重复返回了同一页聊天。')
      if (page.nextCursor) seenCursors.current.add(page.nextCursor)
      setThreads((current) => mergeArchivedThreads(nextCursor ? current : [], page.data))
      setCursor(page.nextCursor || null)
    } catch (failure) {
      if (request === sequence.current) setError(displayError(failure))
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [backend.state])

  useEffect(() => {
    void load()
    return () => { sequence.current += 1 }
  }, [load])

  const visibleThreads = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return threads.filter((thread) => !normalized || `${thread.name || ''} ${thread.preview} ${thread.cwd}`.toLocaleLowerCase().includes(normalized))
  }, [threads, query])

  const restore = async (thread: Thread, open = false): Promise<void> => {
    if (busyId) return
    setBusyId(thread.id)
    setError(null)
    try {
      await window.codex.invoke('thread/unarchive', { threadId: thread.id })
      setThreads((current) => current.filter((entry) => entry.id !== thread.id))
      onThreadRestored?.(thread)
      if (open) onOpenThread?.(thread)
    } catch (failure) {
      setError(displayError(failure))
    } finally {
      setBusyId(null)
    }
  }

  const deleteThread = async (): Promise<void> => {
    if (!deleting || busyId) return
    setBusyId(deleting.id)
    setError(null)
    try {
      await window.codex.invoke('thread/delete', { threadId: deleting.id })
      setThreads((current) => current.filter((entry) => entry.id !== deleting.id && entry.parentThreadId !== deleting.id))
      setDeleting(null)
    } catch (failure) {
      setError(displayError(failure))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <header className="settings-page-heading-row">
        <div className="settings-page-heading"><h2>已归档的聊天</h2><p>查看并管理已从侧边栏隐藏的聊天</p></div>
        <button type="button" className="settings-page-icon-button" aria-label="刷新已归档的聊天" title="刷新" disabled={loading || backend.state !== 'ready'} onClick={() => void load()}><RefreshCw className={loading ? 'spin' : undefined} /></button>
      </header>
      <label className="settings-page-search settings-page-archive-search"><Search /><input value={query} type="search" aria-label="搜索已归档的聊天" placeholder="搜索已归档的聊天" onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      {error && !deleting && <p className="settings-page-error" role="alert">{error}</p>}
      <section className="settings-page-group"><div className="settings-page-card">
        {loading && threads.length === 0 ? <div className="settings-page-loading" role="status"><LoaderCircle className="spin" />正在载入聊天…</div> : visibleThreads.length ? visibleThreads.map((thread) => (
          <div className="settings-page-row" key={thread.id}>
            <div className="settings-page-row-copy">
              {onOpenThread ? <button type="button" className="settings-page-archive-title" disabled={busyId !== null} onClick={() => void restore(thread, true)}>{thread.name || thread.preview || '未命名聊天'}</button> : <strong>{thread.name || thread.preview || '未命名聊天'}</strong>}
              <span>{thread.cwd} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(thread.updatedAt * 1000))}</span>
            </div>
            <div className="settings-page-archive-actions">
              <button type="button" className="settings-page-icon-button" aria-label={`恢复 ${thread.name || thread.preview || '聊天'}`} title="恢复聊天" disabled={busyId !== null} onClick={() => void restore(thread)}>{busyId === thread.id ? <LoaderCircle className="spin" /> : <ArchiveRestore />}</button>
              <button type="button" className="settings-page-icon-button" aria-label={`删除 ${thread.name || thread.preview || '聊天'}`} title="删除聊天" disabled={busyId !== null} onClick={() => { setError(null); setDeleting(thread) }}><Trash2 /></button>
            </div>
          </div>
        )) : <div className="settings-page-empty"><Archive /><strong>{backend.state !== 'ready' ? 'Codex Server 尚未连接' : query ? '没有匹配的聊天' : '没有已归档的聊天'}</strong><span>{query ? '试试其他搜索词。' : '归档的聊天会显示在这里。'}</span></div>}
      </div></section>
      {cursor && <button type="button" className="settings-page-pill" disabled={loading} onClick={() => void load(cursor)}>{loading ? '正在载入…' : '加载更多'}</button>}
      {deleting && <ThreadActionDialog mode="delete" thread={deleting} busy={busyId !== null} error={error} onCancel={() => { setDeleting(null); setError(null) }} onSubmit={() => void deleteThread()} />}
    </>
  )
}

import { ArrowLeft, LoaderCircle, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Thread } from './protocol'
import { SubagentAvatar } from './SubagentActivity'
import { subagentModelDetail } from './subagentThreadModel'
import { ActivityTooltip } from './ActivityTooltip'
import './subagentThreadPanel.css'

export interface SubagentThreadPanelProps {
  threadId: string
  displayName: string
  loadThread(threadId: string): Promise<Thread>
  renderThread(thread: Thread): ReactNode
  liveThread?: Thread | null
  onThreadLoaded?(thread: Thread): void
  onClose(): void
  onOpenMain?(thread: Thread): void
}

export type SubagentThreadPanelContentState = 'loading' | 'error' | 'thread' | 'empty'

export function subagentThreadPanelContentState(
  thread: Thread | null,
  loading: boolean,
  error: string | null
): SubagentThreadPanelContentState {
  if (thread) return 'thread'
  if (loading) return 'loading'
  if (error) return 'error'
  return 'empty'
}

/** Source-selected agent transcript, distinct from the temporary side chat composer. */
export function SubagentThreadPanel({ threadId, displayName, loadThread, renderThread, liveThread, onThreadLoaded, onClose }: SubagentThreadPanelProps): ReactNode {
  const [loadedThread, setLoadedThread] = useState<Thread | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const loader = useRef(loadThread)
  const notify = useRef(onThreadLoaded)
  loader.current = loadThread
  notify.current = onThreadLoaded
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null); setLoadedThread(null)
    void loader.current(threadId).then((thread) => {
      if (cancelled) return
      setLoadedThread(thread); setLoading(false); notify.current?.(thread)
    }).catch((reason: unknown) => {
      if (cancelled) return
      setLoading(false); setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [threadId, revision])
  const thread = liveThread?.id === threadId ? liveThread : loadedThread?.id === threadId ? loadedThread : null
  const contentState = subagentThreadPanelContentState(thread, loading, error)
  const detail = subagentModelDetail(thread)
  return <aside className="subagent-thread-panel" aria-label={`子智能体 ${displayName}`}>
    <header className="subagent-thread-panel-header">
      <ActivityTooltip content="返回子代理列表"><button type="button" aria-label="返回子代理列表" onClick={onClose}><ArrowLeft /></button></ActivityTooltip>
      <SubagentAvatar seed={threadId} /><span className="subagent-thread-panel-name">{displayName}</span>
      {detail && <ActivityTooltip content={detail}><span className="subagent-thread-panel-model">{detail}</span></ActivityTooltip>}
    </header>
    <div className="subagent-thread-panel-content" aria-busy={loading}>
      {contentState === 'loading' ? <div className="subagent-thread-panel-empty is-loading" role="status" aria-label="正在加载子智能体对话" aria-live="polite"><LoaderCircle className="spin" /></div>
        : contentState === 'error' ? <div className="subagent-thread-panel-empty" role="alert"><strong>无法加载子智能体对话</strong><span>{error}</span><button type="button" onClick={() => setRevision((value) => value + 1)}><RotateCw />重试</button></div>
          : contentState === 'thread' && thread ? renderThread(thread) : <div className="subagent-thread-panel-empty">尚无子智能体对话</div>}
    </div>
  </aside>
}

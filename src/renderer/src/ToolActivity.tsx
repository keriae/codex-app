import { AlertCircle, Braces, Check, ChevronRight, Copy, ExternalLink, FileText, Globe, Minimize2, RotateCw, Wrench, X } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ToolItem } from './protocol'
import { ActivityTooltip } from './ActivityTooltip'
import { CadencedShimmer } from './CadencedShimmer'
import { rawToolCallOutput, safeToolResourceUrl, toolActivityLabel, toolActivityStatus, toolDisplayResult, toolErrorText, toolRecord, webSearchDetail, type ToolResultBlock } from './toolActivityModel'
import './toolActivity.css'
import { SubagentActivityContext } from './SubagentActivity'

export function ToolResultContent({ block }: { block: ToolResultBlock }): ReactNode {
  if (block.type === 'text') return <div className="tool-result-text">{block.text}</div>
  if (block.type === 'image') return <img className="tool-result-image" src={block.source} alt="工具返回的图像" draggable={false} />
  if (block.type === 'audio') return <audio className="tool-result-audio" controls src={block.source} />
  if (block.type === 'resourceLink') {
    const href = safeToolResourceUrl(block.uri)
    const contents = <><FileText /><span><span className="tool-result-resource-name">{block.name}</span>{block.description && <span className="tool-result-resource-description">{block.description}</span>}</span>{href && <ExternalLink />}</>
    return href ? <a className="tool-result-resource-link" href={href} target="_blank" rel="noreferrer">{contents}</a> : <div className="tool-result-resource-link" title={block.uri}>{contents}</div>
  }
  if (block.type === 'resource') return <details className="tool-result-resource">
    <summary><FileText /><span>{block.uri || '嵌入的资源'}</span><ChevronRight /></summary>
    <dl><dt>URI</dt><dd>{block.uri}</dd>{block.mimeType && <><dt>MIME 类型</dt><dd>{block.mimeType}</dd></>}</dl>
    {block.text !== null && <><span className="tool-result-caption">内容</span><pre>{block.text}</pre></>}
    {block.source && (block.mimeType?.startsWith('audio/') ? <audio controls src={block.source} /> : <img className="tool-result-image" src={block.source} alt="嵌入的资源" />)}
    {block.annotations && <><span className="tool-result-caption">注释</span><pre>{block.annotations}</pre></>}
  </details>
  return block.type === 'unknown' ? <pre className="tool-result-json">{block.json}</pre> : null
}

function RawToolOutputDialog({ item, onClose }: { item: ToolItem; onClose(): void }): ReactNode {
  const heading = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const raw = rawToolCallOutput(item)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key !== 'Tab') return
      const buttons = ref.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]')
      if (!buttons?.length) return
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('keydown', keyboard, true); previous?.focus() }
  }, [onClose])
  return createPortal(<div className="tool-raw-output-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="tool-raw-output-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1}>
      <header><strong id={heading}>原始 {item.server || item.namespace || 'tool'}.{item.tool} 工具调用输出</strong><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>
      <div className="tool-raw-output-code"><pre tabIndex={0}>{raw}</pre><button type="button" aria-label="复制原始输出" onClick={() => {
        void navigator.clipboard?.writeText(raw).then(() => setCopied(true))
      }}>{copied ? <Check /> : <Copy />}</button></div>
    </div>
  </div>, document.body)
}

function ContextCompactionActivity({ item, live }: { item: ToolItem; live?: boolean }): ReactNode {
  const state = toolActivityStatus(item, live)
  const startedAt = typeof item.startedAtMs === 'number' ? item.startedAtMs : null
  const [delayed, setDelayed] = useState(startedAt !== null && Date.now() - startedAt >= 10000)
  useEffect(() => {
    if (startedAt === null || state !== 'inProgress') { setDelayed(false); return }
    const delay = Math.max(0, startedAt + 10000 - Date.now())
    if (!delay) { setDelayed(true); return }
    setDelayed(false)
    const timer = setTimeout(() => setDelayed(true), delay)
    return () => clearTimeout(timer)
  }, [startedAt, state])
  const label = state === 'inProgress' ? `正在压缩上下文${delayed ? ' · 可能需要几分钟' : ''}`
    : state === 'interrupted' || state === 'failed' ? '压缩已中断' : item.source === 'manual' ? '上下文已压缩' : '上下文已自动压缩'
  return <div className="tool-activity-static" data-status={state}><Minimize2 /><CadencedShimmer active={state === 'inProgress'}>{label}</CadencedShimmer></div>
}

export function ToolActivity({ item, compact = false, live, onOpenThread }: { item: ToolItem; compact?: boolean; live?: boolean; onOpenThread?(threadId: string, name: string): void }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const contentId = useId()
  const activityContext = useContext(SubagentActivityContext)
  const openThread = onOpenThread || activityContext?.onOpen
  const state = toolActivityStatus(item, live)
  if (item.type === 'error') return <div className={`tool-activity-system-error${item.willRetry === true ? ' is-retrying' : ''}`} role="status">
    {item.willRetry === true ? <RotateCw /> : <AlertCircle />}<div><span>{typeof item.message === 'string' ? item.message : '发生错误'}</span>
      {typeof item.additionalDetails === 'string' && item.additionalDetails && <details><summary>显示详情</summary><pre>{item.additionalDetails}</pre></details>}</div>
  </div>
  if (item.type === 'contextCompaction') return <ContextCompactionActivity item={item} live={live} />
  if (item.type === 'enteredReviewMode' || item.type === 'exitedReviewMode') return <div className="tool-activity-static"><Check /><span>{item.type === 'enteredReviewMode' ? '已进入审查模式' : '已退出审查模式'}</span></div>
  if (item.type === 'webSearch') {
    const detail = webSearchDetail(item)
    const label = typeof item.title === 'string' ? item.title : state === 'inProgress' ? '正在搜索网页' : '已搜索网页'
    return <div className={`tool-web-search${compact ? ' is-compact' : ''}`} data-status={state}><Globe /><span className="tool-web-search-copy">
      <CadencedShimmer active={state === 'inProgress'}>{label}</CadencedShimmer>{detail && <ActivityTooltip content={detail}><span className="tool-web-search-detail">：{detail}</span></ActivityTooltip>}
    </span></div>
  }
  const label = toolActivityLabel(item, live)
  const output = toolDisplayResult(item)
  const error = toolErrorText(item)
  const progress = Array.isArray(item.progress) ? item.progress : []
  const args = toolRecord(item.arguments)
  const linkedThreadId = typeof args?.threadId === 'string' && ['read_thread', 'send_message_to_thread'].includes(item.tool || '') ? args.threadId : null
  return <div className={`tool-activity${compact ? ' is-compact' : ''}`} data-status={state} data-tool-family={item.type}>
    <div className="tool-activity-heading">
      <button type="button" className="tool-activity-disclosure" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)}>
        <Wrench /><CadencedShimmer active={state === 'inProgress'} className="tool-activity-label">{label}</CadencedShimmer><ChevronRight className={expanded ? 'is-expanded' : ''} />
      </button>
      {linkedThreadId && openThread && <ActivityTooltip content="打开聊天"><button type="button" className="tool-activity-open-thread" aria-label="打开聊天" onClick={() => openThread(linkedThreadId, label)}><ExternalLink /></button></ActivityTooltip>}
    </div>
    {expanded && <div className="tool-activity-body" id={contentId}>
      {progress.length > 0 && <div className="tool-activity-progress" aria-live={state === 'inProgress' ? 'polite' : 'off'}>{progress.map((entry, index) => <div key={index}>{entry.message}</div>)}</div>}
      {error ? <div className="tool-activity-error" role="status">{error}</div> : output.blocks.map((block, index) => <ToolResultContent block={block} key={index} />)}
      {output.structuredJson && !error && <pre className="tool-result-json">{output.structuredJson}</pre>}
      {!error && !output.blocks.length && !output.structuredJson && state !== 'inProgress' && <p className="tool-activity-empty">工具未返回任何内容</p>}
      <ActivityTooltip content="显示原始工具调用输出"><button type="button" className="tool-activity-raw-trigger" aria-label="显示原始工具调用输出" onClick={() => setRawOpen(true)}><Braces /></button></ActivityTooltip>
    </div>}
    {rawOpen && <RawToolOutputDialog item={item} onClose={() => setRawOpen(false)} />}
  </div>
}

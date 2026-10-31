import { ExternalLink } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ToolItem } from './protocol'
import { ActivityTooltip } from './ActivityTooltip'
import { CadencedShimmer } from './CadencedShimmer'
import { rawToolCallOutput, toolActivityLabel, toolActivityStatus, toolDisplayResult, toolErrorText, toolRecord, webSearchDetail, type ToolResultBlock } from './toolActivityModel'
import './toolActivity.css'
import { SubagentActivityContext } from './SubagentActivity'
import { ActivityGlyph } from './ActivityGlyph'
import { useActivityDisclosure } from './useActivityDisclosure'
import { ThreadImagePreview } from './ThreadImagePreview'
import { CodeBlock } from './CodeBlock'

function ToolAudio({ source }: { source: string }): ReactNode {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return failedSource === source ? <span className="tool-result-audio-unavailable">音频不可用</span>
    : <audio className="tool-result-audio" controls preload="metadata" src={source} onError={() => setFailedSource(source)} />
}

function ToolAnnotations({ text }: { text?: string | null }): ReactNode {
  return text ? <p className="tool-result-annotations">注释：{text}</p> : null
}

export function ToolResultContent({ block }: { block: ToolResultBlock }): ReactNode {
  if (block.type === 'text') return <div className="tool-result-text"><header>plaintext</header><div className="tool-result-text-scroll"><pre>{block.text}{block.annotations ? `\n注释：${block.annotations}` : ''}</pre></div></div>
  if (block.type === 'image') return <div className="tool-result-media"><div className="tool-result-image"><ThreadImagePreview inlineSource={block.source} label="工具返回的图像" presentation="message" /></div><ToolAnnotations text={block.annotations} /></div>
  if (block.type === 'audio') return <div className="tool-result-media"><ToolAudio source={block.source} /><ToolAnnotations text={block.annotations} /></div>
  if (block.type === 'resourceLink') return <div className="tool-result-resource-link">
    <div>已读取 {block.name}</div><ToolAnnotations text={block.annotations} />
  </div>
  if (block.type === 'resource') return <div className="tool-result-resource">
    <div className="tool-result-resource-metadata"><span className="tool-result-resource-label">URI</span><span>{block.uri}</span></div>
    {block.mimeType !== null && <div className="tool-result-resource-metadata"><span className="tool-result-resource-label">MIME 类型</span><span>{block.mimeType}</span></div>}
    {block.annotations !== null && <div className="tool-result-resource-metadata"><span className="tool-result-resource-label">注释</span><span>{block.annotations}</span></div>}
    {block.text !== null && block.text !== '' && <div className="tool-result-resource-content"><span className="tool-result-resource-label">内容</span><pre>{block.text}</pre></div>}
  </div>
  return block.type === 'unknown' ? <pre className="tool-result-json">{block.json}</pre> : null
}

export function RawToolOutputDialog({ item, onClose }: { item: ToolItem; onClose(): void }): ReactNode {
  const heading = useId()
  const ref = useRef<HTMLDivElement>(null)
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
      <header><strong id={heading}>原始 {item.server || item.namespace || 'tool'}.{item.tool} 工具调用输出</strong></header>
      <button type="button" className="tool-raw-output-close" aria-label="关闭对话框" onClick={onClose}><ActivityGlyph kind="close" aria-hidden="true" /></button>
      <div className="tool-raw-output-code"><CodeBlock code={raw} language="json" /></div>
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
  return <div className="tool-activity-static" data-status={state}><ActivityGlyph kind="contextCompaction" aria-hidden="true" /><CadencedShimmer active={state === 'inProgress'}>{label}</CadencedShimmer></div>
}

export function ToolActivity({ item, compact = false, live, onOpenThread }: { item: ToolItem; compact?: boolean; live?: boolean; onOpenThread?(threadId: string, name: string): void }): ReactNode {
  const { expanded, mounted, visible, setOpen } = useActivityDisclosure()
  const [rawOpen, setRawOpen] = useState(false)
  const contentId = useId()
  const activityContext = useContext(SubagentActivityContext)
  const openThread = onOpenThread || activityContext?.onOpen
  const state = toolActivityStatus(item, live)
  if (['enteredReviewMode', 'exitedReviewMode', 'sleep'].includes(item.type)) return null
  if (item.type === 'error') return <div className={`tool-activity-system-error${item.willRetry === true ? ' is-retrying' : ''}`} role="status">
    <ActivityGlyph kind={item.willRetry === true ? 'streamError' : 'systemError'} aria-hidden="true" /><div><span>{typeof item.message === 'string' ? item.message : '发生错误'}</span>
      {typeof item.additionalDetails === 'string' && item.additionalDetails && <details><summary>显示详情</summary><pre>{item.additionalDetails}</pre></details>}</div>
  </div>
  if (item.type === 'contextCompaction') return <ContextCompactionActivity item={item} live={live} />
  if (item.type === 'webSearch') {
    const detail = webSearchDetail(item)
    const label = typeof item.title === 'string' ? item.title : state === 'inProgress' ? '正在搜索网页' : '已搜索网页'
    return <div className={`tool-web-search${compact ? ' is-compact' : ''}`} data-status={state}><ActivityGlyph kind="webSearch" /><span className="tool-web-search-copy">
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
      <button type="button" className="tool-activity-disclosure" aria-expanded={expanded} aria-controls={contentId} onClick={() => setOpen(!expanded)}>
        <ActivityGlyph kind="tools" /><CadencedShimmer active={state === 'inProgress'} className="tool-activity-label">{label}</CadencedShimmer><ActivityGlyph kind="chevron" className={expanded ? 'is-expanded' : ''} />
      </button>
      {linkedThreadId && openThread && <ActivityTooltip content="打开聊天"><button type="button" className="tool-activity-open-thread" aria-label="打开聊天" onClick={() => openThread(linkedThreadId, label)}><ExternalLink /></button></ActivityTooltip>}
    </div>
    {mounted && <div className={`tool-activity-collapse${visible ? ' is-expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}><div className="tool-activity-body" id={contentId}>
      {progress.length > 0 && <div className="tool-activity-progress" aria-live={state === 'inProgress' ? 'polite' : 'off'}>{progress.map((entry, index) => <div key={index}>{entry.message}</div>)}</div>}
      {error ? <div className="tool-activity-error" role="status">{error}</div> : output.blocks.map((block, index) => <ToolResultContent block={block} key={index} />)}
      {output.structuredJson && !error && <pre className="tool-result-json">{output.structuredJson}</pre>}
      {!error && !output.blocks.length && !output.structuredJson && state !== 'inProgress' && <p className="tool-activity-empty">工具未返回任何内容</p>}
      {state !== 'inProgress' && <ActivityTooltip content="显示原始工具调用输出" openDelay={150}><button type="button" className="tool-activity-raw-trigger" aria-label="显示原始工具调用输出" onClick={() => setRawOpen(true)}><ActivityGlyph kind="code" aria-hidden="true" /></button></ActivityTooltip>}
    </div></div>}
    {rawOpen && <RawToolOutputDialog item={item} onClose={() => setRawOpen(false)} />}
  </div>
}

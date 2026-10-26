import {
  FileText,
  GripVertical,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  PanelRightOpen,
  Pencil,
  Play,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { QueuedMessage } from './queuedMessages'
import { queuedMessageFullText, queuedMessagePreview } from './queuedMessages'
import './queuedMessageList.css'

interface KeyboardSortState {
  messageId: string
  order: string[]
}

export function QueuedMessageList({
  messages,
  editingMessageId,
  queueingEnabled,
  responseInProgress,
  onSendNow,
  onDelete,
  onEdit,
  onOpenInSideChat,
  onReorder,
  onResumeInterruptedQueue,
  onQueueingChange
}: {
  messages: readonly QueuedMessage[]
  editingMessageId?: string | null
  queueingEnabled: boolean
  responseInProgress: boolean
  onSendNow(messageId: string): void
  onDelete(messageId: string): void
  onEdit(messageId: string): void
  onOpenInSideChat?(messageId: string): void
  onReorder?(messageIds: string[]): void
  onResumeInterruptedQueue?(): void
  onQueueingChange(enabled: boolean): void
}): ReactNode {
  const [menuId, setMenuId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [keyboardSort, setKeyboardSort] = useState<KeyboardSortState | null>(null)
  const [sortAnnouncement, setSortAnnouncement] = useState('')
  const [preview, setPreview] = useState<{
    messageId: string
    style: CSSProperties
  } | null>(null)
  const previewDialogId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const previewDialogRef = useRef<HTMLDivElement>(null)
  const previewContentRef = useRef<HTMLPreElement>(null)
  const previewTriggerRef = useRef<HTMLDivElement>(null)
  const reorderable = Boolean(
    onReorder &&
    messages.length > 1 &&
    messages.every((message) => message.serverAccepted && message.status === 'queued')
  )
  const interrupted = Boolean(
    onResumeInterruptedQueue &&
    messages[0]?.status === 'paused' &&
    messages[0]?.pauseReason === 'interrupted'
  )
  const messageIds = messages.map((message) => message.id)
  const orderedMessages = keyboardSort
    ? keyboardSort.order.flatMap((id) => {
        const message = messages.find((candidate) => candidate.id === id)
        return message ? [message] : []
      })
    : messages

  useEffect(() => {
    setKeyboardSort((current) => {
      if (!current) return null
      const currentIds = new Set(messageIds)
      return current.order.length === messageIds.length &&
        current.order.every((id) => currentIds.has(id))
        ? current
        : null
    })
  }, [messages])

  useEffect(() => {
    if (!menuId) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuId])

  useEffect(() => {
    if (!preview) return
    if (!messages.some((message) => message.id === preview.messageId)) {
      setPreview(null)
      return
    }
    const focusFrame = window.requestAnimationFrame(() => previewContentRef.current?.focus())
    const closeWithoutFocus = (): void => setPreview(null)
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        previewDialogRef.current?.contains(target) ||
        previewTriggerRef.current?.contains(target)
      ) return
      closeWithoutFocus()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPreview(null)
      previewTriggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('resize', closeWithoutFocus)
    window.addEventListener('scroll', closeWithoutFocus, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('resize', closeWithoutFocus)
      window.removeEventListener('scroll', closeWithoutFocus, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [messages, preview])

  const openPreview = (
    messageId: string,
    trigger: HTMLDivElement
  ): void => {
    if (preview?.messageId === messageId) {
      setPreview(null)
      return
    }
    const bounds = trigger.getBoundingClientRect()
    const width = Math.min(420, Math.max(280, bounds.width + 48), window.innerWidth - 24)
    const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))
    previewTriggerRef.current = trigger
    setMenuId(null)
    setPreview({
      messageId,
      style: {
        bottom: window.innerHeight - bounds.top + 8,
        left,
        maxHeight: Math.min(320, Math.max(96, bounds.top - 20)),
        width
      }
    })
  }

  if (messages.length === 0) return null

  const previewMessage = preview
    ? messages.find((message) => message.id === preview.messageId)
    : undefined
  const fullPreviewText = previewMessage ? queuedMessageFullText(previewMessage) : ''

  const handleKeyboardSort = (
    event: ReactKeyboardEvent<HTMLSpanElement>,
    messageId: string
  ): void => {
    if (!reorderable) return
    const active = keyboardSort?.messageId === messageId ? keyboardSort : null
    if (!active) {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      setMenuId(null)
      setPreview(null)
      setKeyboardSort({ messageId, order: [...messageIds] })
      setSortAnnouncement(
        `已抓取第 ${messageIds.indexOf(messageId) + 1} 条排队消息。使用方向键移动，空格键放下，Escape 取消。`
      )
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setKeyboardSort(null)
      setSortAnnouncement('已取消排序。')
      return
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      setKeyboardSort(null)
      onReorder?.(active.order)
      setSortAnnouncement(
        `已将排队消息放在第 ${active.order.indexOf(messageId) + 1} 位。`
      )
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const from = active.order.indexOf(messageId)
    const to = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? active.order.length - 1
        : Math.max(
            0,
            Math.min(active.order.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1))
          )
    if (from === to) return
    const order = moveQueuedMessageToIndex(active.order, messageId, to)
    setKeyboardSort({ messageId, order })
    setSortAnnouncement(`已移动到第 ${to + 1} 位，共 ${order.length} 条。`)
  }

  return (
    <>
      <section className="queued-message-list" aria-label="排队中的消息">
      <span className="queued-message-sort-status" aria-live="assertive" aria-atomic="true">
        {sortAnnouncement}
      </span>
      {interrupted && (
        <>
          <div className="queued-message-interrupted">
            <span className="queued-message-interrupted-icon" aria-hidden="true">
              <PauseGlyph />
            </span>
            <span className="queued-message-interrupted-copy">由于你中断了当前响应，队列已暂停</span>
            <button type="button" onClick={onResumeInterruptedQueue}>
              <Play />
              <span>继续</span>
            </button>
          </div>
          <div className="queued-message-separator" />
        </>
      )}
      {orderedMessages.map((message, index) => {
        const summary = queuedMessagePreview(message)
        const displayText = queuedMessageFullText(message)
        const sending = message.status === 'sending'
        const paused = message.status === 'paused' || message.status === 'outcome-unknown'
        const outcomeUnknown = message.status === 'outcome-unknown'
        const editing = editingMessageId === message.id
        return (
          <div
            className={`queued-message-row${sending ? ' is-sending' : ''}${paused ? ' is-paused' : ''}${editing ? ' is-editing' : ''}${draggingId === message.id ? ' is-dragging' : ''}`}
            key={message.id}
            data-queue-position={index + 1}
            data-reorderable={reorderable || undefined}
            onDragOver={(event) => {
              if (reorderable) event.preventDefault()
            }}
            onDrop={(event) => {
              const activeId = draggingId || event.dataTransfer.getData('text/plain')
              if (!reorderable || !activeId || activeId === message.id) return
              event.preventDefault()
              const next = moveQueuedMessageId(
                orderedMessages.map((entry) => entry.id),
                activeId,
                message.id
              )
              setDraggingId(null)
              onReorder?.(next)
            }}
          >
            <span
              className={`queued-message-leading${reorderable ? ' is-reorderable' : ''}`}
              draggable={reorderable}
              role={reorderable ? 'button' : undefined}
              tabIndex={reorderable ? 0 : undefined}
              aria-label={reorderable
                ? `重新排序第 ${index + 1} 条排队消息`
                : undefined}
              aria-pressed={reorderable
                ? keyboardSort?.messageId === message.id
                : undefined}
              aria-roledescription={reorderable ? '可排序项目' : undefined}
              title={reorderable ? '拖动以重新排序' : undefined}
              onKeyDown={(event) => handleKeyboardSort(event, message.id)}
              onDragStart={(event: DragEvent<HTMLSpanElement>) => {
                if (!reorderable) return
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', message.id)
                setDraggingId(message.id)
                setMenuId(null)
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              {reorderable && <GripVertical className="queued-message-drag-handle" />}
              <span aria-hidden="true">
                {sending ? <LoaderCircle className="spin" /> : <QueuedMessageGlyph />}
              </span>
            </span>
            <QueuedAttachmentPreview message={message} />
            <div
              className="queued-message-copy"
              role="button"
              tabIndex={0}
              aria-label={`预览排队中的第 ${index + 1} 条消息：${accessibleQueuedMessagePreview(summary)}`}
              aria-haspopup="dialog"
              aria-expanded={preview?.messageId === message.id}
              aria-controls={preview?.messageId === message.id ? previewDialogId : undefined}
              onClick={(event) => openPreview(message.id, event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                openPreview(message.id, event.currentTarget)
              }}
            >
              <QueuedMessageInlineMarkdown text={displayText} />
            </div>
            {paused && (
              <span
                className="queued-message-warning"
                title={outcomeUnknown
                  ? '无法确认是否已送达。删除前请先检查对话。'
                  : `${message.error || '这条排队中的消息未能发送'}\n重试、编辑或删除该消息以继续发送排队的消息`}
                aria-label={message.error || '这条排队中的消息未能发送'}
              >
                <TriangleAlert aria-hidden="true" />
              </span>
            )}
            {!sending && (
              <button
                type="button"
                className="queued-message-steer"
                disabled={message.status === 'outcome-unknown' && message.serverAccepted}
                title={responseInProgress ? '提交，但不中断模型运行' : '立即发送这条排队消息'}
                onClick={() => onSendNow(message.id)}
              >
                <SteerGlyph />
                <span>{paused ? '重试' : '引导'}</span>
              </button>
            )}
            <button
              type="button"
              className="queued-message-icon-action"
              disabled={sending}
              aria-label="删除排队的消息"
              title="删除排队的消息"
              onClick={() => onDelete(message.id)}
            >
              <Trash2 />
            </button>
            <div className="queued-message-menu-wrap" ref={menuId === message.id ? menuRef : undefined}>
              <button
                type="button"
                className="queued-message-icon-action"
                disabled={sending || outcomeUnknown}
                aria-label="排队消息操作"
                title="排队消息操作"
                aria-expanded={menuId === message.id}
                onClick={() => setMenuId((current) => current === message.id ? null : message.id)}
              >
                <MoreHorizontal />
              </button>
              {menuId === message.id && (
                <div className="queued-message-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => {
                    setMenuId(null)
                    onEdit(message.id)
                  }}>
                    <Pencil />
                    <span>编辑消息</span>
                  </button>
                  {onOpenInSideChat && (
                    <button type="button" role="menuitem" onClick={() => {
                      setMenuId(null)
                      onOpenInSideChat(message.id)
                    }}>
                      <PanelRightOpen />
                      <span>在侧边聊天中打开</span>
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={() => {
                    setMenuId(null)
                    onQueueingChange(!queueingEnabled)
                  }}>
                    <QueuedMessageGlyph />
                    <span>{queueingEnabled ? '关闭排队' : '启用队列模式'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
      </section>
      {preview && previewMessage && typeof document !== 'undefined' && createPortal(
        <div
          ref={previewDialogRef}
          id={previewDialogId}
          className="queued-message-preview-popover"
          role="dialog"
          aria-label="排队消息预览"
          aria-modal="false"
          style={preview.style}
        >
          <pre
            ref={previewContentRef}
            className="queued-message-preview-content"
            aria-label="完整排队消息文本，可选择并复制"
            tabIndex={0}
            onKeyDown={(event) => {
              if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return
              event.preventDefault()
              const selection = window.getSelection()
              const range = document.createRange()
              range.selectNodeContents(event.currentTarget)
              selection?.removeAllRanges()
              selection?.addRange(range)
            }}
          >
            {fullPreviewText}
          </pre>
        </div>,
        document.body
      )}
    </>
  )
}

export function accessibleQueuedMessagePreview(preview: string): string {
  const compact = preview.replace(/\s+/g, ' ').trim()
  return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact
}

export function moveQueuedMessageId(
  messageIds: readonly string[],
  activeId: string,
  overId: string
): string[] {
  const from = messageIds.indexOf(activeId)
  const to = messageIds.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return [...messageIds]
  const next = [...messageIds]
  const [active] = next.splice(from, 1)
  next.splice(to, 0, active)
  return next
}

export function moveQueuedMessageToIndex(
  messageIds: readonly string[],
  activeId: string,
  targetIndex: number
): string[] {
  const from = messageIds.indexOf(activeId)
  if (from < 0) return [...messageIds]
  const to = Math.max(0, Math.min(messageIds.length - 1, targetIndex))
  if (from === to) return [...messageIds]
  const next = [...messageIds]
  const [active] = next.splice(from, 1)
  next.splice(to, 0, active)
  return next
}

const INDENTED_CODE_BLOCK = /^(?:[ \t]*\r?\n)*(?: {4}| {0,3}\t)[ \t]*\S/

function QueuedMessageInlineMarkdown({ text }: { text: string }): ReactNode {
  if (INDENTED_CODE_BLOCK.test(text)) {
    return <span className="queued-message-plain-text">{text.replace(/\s+/g, ' ').trim()}</span>
  }
  return (
    <div className="queued-message-markdown" aria-hidden="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children }) => <span>{children}</span>,
          p: ({ children }) => <span>{children}</span>,
          pre: ({ children }) => <span>{children}</span>,
          h1: ({ children }) => <span>{children}</span>,
          h2: ({ children }) => <span>{children}</span>,
          h3: ({ children }) => <span>{children}</span>,
          h4: ({ children }) => <span>{children}</span>,
          h5: ({ children }) => <span>{children}</span>,
          h6: ({ children }) => <span>{children}</span>
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function QueuedAttachmentPreview({ message }: { message: QueuedMessage }): ReactNode {
  const attachment = message.attachments[0]
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (attachment?.kind !== 'image' || typeof window === 'undefined' || !window.codex) {
      setSource(null)
      return
    }
    void window.codex.readThreadImage(attachment.path).then((result) => {
      if (!cancelled) setSource(`data:${result.mimeType};base64,${result.dataBase64}`)
    }).catch(() => {
      if (!cancelled) setSource(null)
    })
    return () => { cancelled = true }
  }, [attachment?.kind, attachment?.path])

  if (!attachment) return null
  if (attachment.kind === 'image' && source) {
    return <img className="queued-message-attachment-preview" src={source} alt="图像附件" />
  }
  return (
    <span className="queued-message-attachment-fallback" aria-hidden="true">
      {attachment.kind === 'image' ? <ImageIcon /> : <FileText />}
    </span>
  )
}

export function QueuedMessageGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M2.668 11V3.333a.665.665 0 0 1 1.33 0V11c0 .711.001 1.204.032 1.588.031.375.088.587.168.745l.071.126c.176.288.429.522.731.676l.13.055c.144.052.333.09.615.113.384.031.877.032 1.588.032H15l.067.007-.955-.955a.665.665 0 0 1 .941-.94l2.084 2.082a.665.665 0 0 1 0 .941l-2.083 2.084a.666.666 0 0 1-.942-.941l.954-.955-.066.007H7.333c-.689 0-1.246 0-1.696-.037-.401-.033-.762-.097-1.098-.241l-.143-.068a4.002 4.002 0 0 1-1.261-1.165l-.122-.218c-.192-.377-.271-.783-.309-1.241-.037-.45-.036-1.007-.036-1.696ZM11.666 8.918a.665.665 0 0 1 0 1.33H7.5a.665.665 0 1 1 0-1.33h4.166ZM14.166 4.335a.665.665 0 0 1 0 1.33H7.5a.665.665 0 0 1 0-1.33h6.666Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SteerGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 21 21" fill="none" aria-hidden="true">
      <path
        d="M13.129 7.348a.665.665 0 0 1 .941 0l4 4a.665.665 0 0 1 0 .94l-4 4a.665.665 0 0 1-.941-.94l2.865-2.865H6.6a3.665 3.665 0 0 1-3.665-3.665v-3.5a.665.665 0 1 1 1.33 0v3.5A2.335 2.335 0 0 0 6.6 11.153h9.394L13.129 8.29a.665.665 0 0 1 0-.941Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PauseGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M6.875 5.833a.625.625 0 0 1 .625-.625h.833c.345 0 .625.28.625.625v8.334a.625.625 0 0 1-.625.625H7.5a.625.625 0 0 1-.625-.625V5.833ZM11.667 5.208a.625.625 0 0 0-.625.625v8.334c0 .345.28.625.625.625h.833c.345 0 .625-.28.625-.625V5.833a.625.625 0 0 0-.625-.625h-.833Z"
        fill="currentColor"
      />
    </svg>
  )
}

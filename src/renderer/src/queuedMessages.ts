import type { ComposerAttachmentSelection } from '../../shared/api'
import type { DiffCommentAttachment } from './diffComments'
import type { UserInput } from './protocol'

export interface ServerQueuedSubmission {
  id: string
  clientUserMessageId: string
  input: UserInput[]
}

export type QueuedMessageStatus =
  | 'queued'
  | 'sending'
  | 'paused'
  | 'outcome-unknown'

export type QueuedMessagePauseReason =
  | 'interrupted'
  | 'send-failed'
  | null

export interface QueuedMessage {
  id: string
  threadId: string
  clientUserMessageId: string
  input: UserInput[]
  draftText: string
  text: string
  attachments: ComposerAttachmentSelection[]
  comments: readonly DiffCommentAttachment[]
  commentCount: number
  status: QueuedMessageStatus
  pauseReason: QueuedMessagePauseReason
  serverAccepted: boolean
  error: string | null
}

const COMMENT_HEADING = /^## User Comment \d+$/gm
const COMMENT_SUFFIX = /\n## User Comment \d+\n[\s\S]*$/

function attachmentName(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized.split('/').at(-1) || normalized || path
}

export function queuedMessageText(input: readonly UserInput[]): string {
  const text = input.find((item) => item.type === 'text')?.text || ''
  return text.replace(COMMENT_SUFFIX, '').trim()
}

export function queuedMessageCommentCount(input: readonly UserInput[]): number {
  const text = input.find((item) => item.type === 'text')?.text || ''
  return [...text.matchAll(COMMENT_HEADING)].length
}

export function queuedMessageAttachments(
  input: readonly UserInput[]
): ComposerAttachmentSelection[] {
  return input.flatMap<ComposerAttachmentSelection>((item) => {
    if (item.type === 'localImage') {
      return [{ kind: 'image' as const, name: attachmentName(item.path), path: item.path }]
    }
    if (item.type === 'mention') {
      return [{ kind: 'file' as const, name: item.name || attachmentName(item.path), path: item.path }]
    }
    return []
  })
}

export function createOptimisticQueuedMessage(options: {
  threadId: string
  clientUserMessageId: string
  input: UserInput[]
  draftText?: string
  text: string
  attachments: ComposerAttachmentSelection[]
  comments: readonly DiffCommentAttachment[]
}): QueuedMessage {
  return {
    id: `local-queue-${options.clientUserMessageId}`,
    threadId: options.threadId,
    clientUserMessageId: options.clientUserMessageId,
    input: options.input,
    draftText: options.draftText ?? options.text,
    text: options.text,
    attachments: options.attachments,
    comments: options.comments,
    commentCount: options.comments.length,
    status: 'sending',
    pauseReason: null,
    serverAccepted: false,
    error: null
  }
}

export function queuedMessageFromServer(
  threadId: string,
  submission: ServerQueuedSubmission,
  previous?: QueuedMessage
): QueuedMessage {
  const inputUnchanged = Boolean(
    previous && JSON.stringify(previous.input) === JSON.stringify(submission.input)
  )
  const preserveUnresolvedStatus = Boolean(
    previous?.serverAccepted && previous.status !== 'queued' && inputUnchanged
  )
  return {
    id: submission.id,
    threadId,
    clientUserMessageId: submission.clientUserMessageId,
    input: submission.input,
    draftText: inputUnchanged ? previous!.draftText : queuedMessageText(submission.input),
    text: inputUnchanged ? previous!.text : queuedMessageText(submission.input),
    attachments: inputUnchanged
      ? previous!.attachments
      : queuedMessageAttachments(submission.input),
    comments: inputUnchanged ? previous!.comments : [],
    commentCount: inputUnchanged
      ? previous!.commentCount
      : queuedMessageCommentCount(submission.input),
    status: preserveUnresolvedStatus ? previous!.status : 'queued',
    pauseReason: preserveUnresolvedStatus ? previous!.pauseReason : null,
    serverAccepted: true,
    error: preserveUnresolvedStatus ? previous!.error : null
  }
}

export function reconcileQueuedSubmissions(
  threadId: string,
  current: readonly QueuedMessage[],
  submissions: readonly ServerQueuedSubmission[]
): QueuedMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  const byClientId = new Map(
    current.map((message) => [message.clientUserMessageId, message])
  )
  const matched = new Set<QueuedMessage>()
  const accepted = submissions.map((submission) => {
    const previous = byId.get(submission.id) || byClientId.get(submission.clientUserMessageId)
    if (previous) matched.add(previous)
    return queuedMessageFromServer(threadId, submission, previous)
  })

  // A write can lose its acknowledgement before the app-server queue can be
  // read. Keep only local, unconfirmed records; accepted records absent from
  // the authoritative list were already started or deleted.
  const unconfirmed = current.filter(
    (message) =>
      !matched.has(message) &&
      !message.serverAccepted &&
      (message.status === 'sending' || message.status === 'outcome-unknown')
  )
  return [...accepted, ...unconfirmed]
}

export function upsertQueuedMessage(
  current: readonly QueuedMessage[],
  message: QueuedMessage
): QueuedMessage[] {
  const index = current.findIndex(
    (candidate) =>
      candidate.id === message.id ||
      candidate.clientUserMessageId === message.clientUserMessageId
  )
  if (index < 0) return [...current, message]
  const next = [...current]
  next[index] = message
  return next
}

export function updateQueuedMessage(
  current: readonly QueuedMessage[],
  id: string,
  update: (message: QueuedMessage) => QueuedMessage
): QueuedMessage[] {
  let changed = false
  const next = current.map((message) => {
    if (message.id !== id && message.clientUserMessageId !== id) return message
    changed = true
    return update(message)
  })
  return changed ? next : [...current]
}

export function removeQueuedMessage(
  current: readonly QueuedMessage[],
  id: string
): QueuedMessage[] {
  return current.filter(
    (message) => message.id !== id && message.clientUserMessageId !== id
  )
}

export function nextQueuedMessage(
  messages: readonly QueuedMessage[],
  running: boolean
): QueuedMessage | null {
  if (running) return null
  const first = messages[0]
  return first?.status === 'queued' && first.serverAccepted ? first : null
}

export function queuedMessagePreview(message: QueuedMessage): string {
  if (message.text.trim()) return message.text.trim().replace(/\s+/g, ' ')
  if (message.commentCount > 0) return `${message.commentCount} 条评审评论`
  if (message.attachments.length > 0) {
    const images = message.attachments.filter((attachment) => attachment.kind === 'image')
    if (images.length === message.attachments.length) return `${images.length} 张图像`
    return message.attachments.map((attachment) => attachment.name).join('、')
  }
  return '排队中的消息'
}

/** Plain source shown in the selectable full-prompt preview. */
export function queuedMessageFullText(message: QueuedMessage): string {
  return message.text.trim() || queuedMessagePreview(message)
}

/** Exact textual input used when moving a queued prompt to another composer. */
export function queuedMessageTransferText(message: QueuedMessage): string {
  return message.input.find((item) => item.type === 'text')?.text || message.draftText
}

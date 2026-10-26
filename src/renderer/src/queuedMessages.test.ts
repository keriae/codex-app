import { describe, expect, it } from 'vitest'
import type { ComposerAttachmentSelection } from '../../shared/api'
import type { DiffCommentAttachment } from './diffComments'
import {
  createOptimisticQueuedMessage,
  nextQueuedMessage,
  queuedMessageAttachments,
  queuedMessageCommentCount,
  queuedMessageFullText,
  queuedMessageFromServer,
  queuedMessagePreview,
  queuedMessageText,
  queuedMessageTransferText,
  reconcileQueuedSubmissions,
  removeQueuedMessage,
  updateQueuedMessage,
  upsertQueuedMessage
} from './queuedMessages'

const image: ComposerAttachmentSelection = {
  kind: 'image',
  name: 'screen.png',
  path: '/project/screen.png'
}
const comment: DiffCommentAttachment = {
  id: 'comment-1',
  type: 'comment',
  position: { path: 'src/a.ts', side: 'right', line: 4 },
  content: [{ content_type: 'text', text: 'Handle this case' }]
}

function optimistic(clientUserMessageId = 'client-1') {
  return createOptimisticQueuedMessage({
    threadId: 'thread-a',
    clientUserMessageId,
    input: [
      {
        type: 'text',
        text: 'Continue the audit\n## User Comment 1\nFile: src/a.ts\nComment:\nHandle this case\n',
        text_elements: []
      },
      { type: 'localImage', path: image.path }
    ],
    text: 'Continue the audit',
    attachments: [image],
    comments: [comment]
  })
}

describe('queued message model', () => {
  it('keeps exact local composer metadata when the server assigns a queue id', () => {
    const local = optimistic()
    const accepted = queuedMessageFromServer('thread-a', {
      id: 'queue-1',
      clientUserMessageId: 'client-1',
      input: local.input
    }, local)

    expect(accepted).toMatchObject({
      id: 'queue-1',
      text: 'Continue the audit',
      attachments: [image],
      comments: [comment],
      commentCount: 1,
      status: 'queued',
      serverAccepted: true
    })
  })

  it('reconstructs attachment and review-comment summaries from a durable server queue', () => {
    const input = optimistic().input
    expect(queuedMessageText(input)).toBe('Continue the audit')
    expect(queuedMessageCommentCount(input)).toBe(1)
    expect(queuedMessageAttachments(input)).toEqual([
      { kind: 'image', name: 'screen.png', path: '/project/screen.png' }
    ])
    expect(queuedMessagePreview(queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input
    }))).toBe('Continue the audit')
  })

  it('preserves multiline Markdown as selectable plain source for the full preview', () => {
    const markdown = '# Audit\n\n- keep `inline code`\n- keep **emphasis**'
    const queued = queuedMessageFromServer('thread-a', {
      id: 'queue-markdown',
      clientUserMessageId: 'client-markdown',
      input: [{ type: 'text', text: markdown, text_elements: [] }]
    })

    expect(queuedMessagePreview(queued)).toBe('# Audit - keep `inline code` - keep **emphasis**')
    expect(queuedMessageFullText(queued)).toBe(markdown)
  })

  it('keeps serialized review comments when transferring a queued prompt', () => {
    const queued = optimistic()
    expect(queuedMessageTransferText(queued)).toContain('Continue the audit')
    expect(queuedMessageTransferText(queued)).toContain('## User Comment 1')
    expect(queuedMessageTransferText(queued)).toContain('Handle this case')
  })

  it('reconciles by client id without dropping an acknowledgement-unknown message', () => {
    const local = { ...optimistic(), status: 'outcome-unknown' as const }
    const absent = reconcileQueuedSubmissions('thread-a', [local], [])
    expect(absent).toEqual([local])

    const accepted = reconcileQueuedSubmissions('thread-a', [local], [{
      id: 'queue-1', clientUserMessageId: local.clientUserMessageId, input: local.input
    }])
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({ id: 'queue-1', status: 'queued', serverAccepted: true })
    expect(accepted[0].attachments).toEqual([image])
    expect(accepted[0].comments).toEqual([comment])
  })

  it('does not re-arm a delivery-unknown accepted message after a queue refresh', () => {
    const accepted = queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input: optimistic().input
    }, optimistic())
    const unresolved = {
      ...accepted,
      status: 'outcome-unknown' as const,
      error: 'Steer succeeded but queue deletion was not confirmed'
    }
    const refreshed = reconcileQueuedSubmissions('thread-a', [unresolved], [{
      id: accepted.id,
      clientUserMessageId: accepted.clientUserMessageId,
      input: accepted.input
    }])

    expect(refreshed[0]).toMatchObject({
      status: 'outcome-unknown',
      serverAccepted: true,
      error: 'Steer succeeded but queue deletion was not confirmed'
    })
    expect(nextQueuedMessage(refreshed, false)).toBeNull()
  })

  it('preserves an explicit interrupted pause reason across queue refreshes', () => {
    const accepted = queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input: optimistic().input
    }, optimistic())
    const paused = {
      ...accepted,
      status: 'paused' as const,
      pauseReason: 'interrupted' as const,
      error: 'Localized display text can change independently.'
    }
    const [refreshed] = reconcileQueuedSubmissions('thread-a', [paused], [{
      id: accepted.id,
      clientUserMessageId: accepted.clientUserMessageId,
      input: accepted.input
    }])

    expect(refreshed).toMatchObject({
      status: 'paused',
      pauseReason: 'interrupted',
      error: 'Localized display text can change independently.'
    })
  })

  it('uses authoritative server text when another client updates a queued submission', () => {
    const previous = queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input: optimistic().input
    }, optimistic())
    const serverInput = [{ type: 'text' as const, text: 'Updated elsewhere', text_elements: [] }]
    const refreshed = queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input: serverInput
    }, { ...previous, status: 'outcome-unknown' })

    expect(refreshed).toMatchObject({
      input: serverInput,
      text: 'Updated elsewhere',
      draftText: 'Updated elsewhere',
      attachments: [],
      comments: [],
      status: 'queued'
    })
  })

  it('drops accepted entries absent from the authoritative list but preserves queue order', () => {
    const first = queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input: optimistic().input
    })
    const second = optimistic('client-2')
    const reconciled = reconcileQueuedSubmissions('thread-a', [first, second], [])
    expect(reconciled.map((message) => message.clientUserMessageId)).toEqual(['client-2'])
  })

  it('only auto-starts the accepted head and pauses behind a failed head', () => {
    const first = queuedMessageFromServer('thread-a', {
      id: 'queue-1', clientUserMessageId: 'client-1', input: optimistic().input
    })
    const second = queuedMessageFromServer('thread-a', {
      id: 'queue-2', clientUserMessageId: 'client-2', input: optimistic('client-2').input
    })
    expect(nextQueuedMessage([first, second], false)?.id).toBe('queue-1')
    expect(nextQueuedMessage([first, second], true)).toBeNull()
    expect(nextQueuedMessage([{ ...first, status: 'paused' }, second], false)).toBeNull()
  })

  it('updates and removes one isolated queue item without affecting another thread', () => {
    const a = optimistic('client-a')
    const b = { ...optimistic('client-b'), threadId: 'thread-b' }
    const list = upsertQueuedMessage([a], b)
    const updated = updateQueuedMessage(list, a.id, (message) => ({ ...message, status: 'paused' }))
    expect(updated.map((message) => [message.threadId, message.status])).toEqual([
      ['thread-a', 'paused'],
      ['thread-b', 'sending']
    ])
    expect(removeQueuedMessage(updated, b.id)).toEqual([expect.objectContaining({ threadId: 'thread-a' })])
  })
})

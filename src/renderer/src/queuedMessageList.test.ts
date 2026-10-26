import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  accessibleQueuedMessagePreview,
  moveQueuedMessageId,
  moveQueuedMessageToIndex,
  QueuedMessageList
} from './QueuedMessageList'
import { createOptimisticQueuedMessage, queuedMessageFromServer } from './queuedMessages'

function message(id: string, text: string) {
  return queuedMessageFromServer('thread-a', {
    id,
    clientUserMessageId: `client-${id}`,
    input: [{ type: 'text', text, text_elements: [] }]
  })
}

describe('QueuedMessageList', () => {
  it('renders the measured row actions and exact queue ordering', () => {
    const html = renderToStaticMarkup(createElement(QueuedMessageList, {
      messages: [message('queue-1', 'First follow-up'), message('queue-2', 'Second follow-up')],
      queueingEnabled: true,
      responseInProgress: true,
      onSendNow: vi.fn(),
      onDelete: vi.fn(),
      onEdit: vi.fn(),
      onOpenInSideChat: vi.fn(),
      onReorder: vi.fn(),
      onQueueingChange: vi.fn()
    }))

    expect(html).toContain('aria-label="排队中的消息"')
    expect(html).toContain('data-queue-position="1"')
    expect(html).toContain('data-queue-position="2"')
    expect(html.indexOf('First follow-up')).toBeLessThan(html.indexOf('Second follow-up'))
    expect(html).toContain('>引导</span>')
    expect(html).toContain('aria-label="删除排队的消息"')
    expect(html).toContain('aria-label="排队消息操作"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-reorderable="true"')
    expect(html).toContain('draggable="true"')
    expect(html).toContain('aria-roledescription="可排序项目"')
    expect(html).toContain('aria-live="assertive"')
  })

  it('shows sending and paused states without losing the saved prompt', () => {
    const sending = createOptimisticQueuedMessage({
      threadId: 'thread-a',
      clientUserMessageId: 'client-local',
      input: [{ type: 'text', text: 'Saved locally', text_elements: [] }],
      text: 'Saved locally',
      attachments: [],
      comments: []
    })
    const paused = {
      ...message('queue-paused', 'Retry me'),
      status: 'paused' as const,
      pauseReason: 'interrupted' as const,
      error: 'The previous run was stopped.'
    }
    const html = renderToStaticMarkup(createElement(QueuedMessageList, {
      messages: [paused, sending],
      queueingEnabled: true,
      responseInProgress: false,
      onSendNow: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(),
      onResumeInterruptedQueue: vi.fn(), onQueueingChange: vi.fn()
    }))

    expect(html).toContain('is-sending')
    expect(html).toContain('Saved locally')
    expect(html).toContain('is-paused')
    expect(html).toContain('>重试</span>')
    expect(html).toContain('由于你中断了当前响应，队列已暂停')
    expect(html).toContain('>继续</span>')
  })

  it('uses explicit pause state instead of matching localized error text', () => {
    const paused = {
      ...message('queue-paused', 'Retry me'),
      status: 'paused' as const,
      pauseReason: 'send-failed' as const,
      error: '错误文案即使包含“中断”也不是用户中断状态'
    }
    const html = renderToStaticMarkup(createElement(QueuedMessageList, {
      messages: [paused],
      queueingEnabled: true,
      responseInProgress: false,
      onSendNow: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(),
      onResumeInterruptedQueue: vi.fn(), onQueueingChange: vi.fn()
    }))

    expect(html).not.toContain('队列已暂停</span>')
    expect(html).not.toContain('>继续</span>')
  })

  it('keeps preview labels compact and keyboard distinguishable', () => {
    const preview = `First line\n${'second '.repeat(20)}`
    const compact = accessibleQueuedMessagePreview(preview)
    expect(compact).not.toContain('\n')
    expect(compact).toHaveLength(80)
    expect(compact.endsWith('…')).toBe(true)
  })

  it('moves a dragged queue id without changing or dropping its peers', () => {
    expect(moveQueuedMessageId(['queue-1', 'queue-2', 'queue-3'], 'queue-1', 'queue-3'))
      .toEqual(['queue-2', 'queue-3', 'queue-1'])
    expect(moveQueuedMessageId(['queue-1', 'queue-2'], 'missing', 'queue-2'))
      .toEqual(['queue-1', 'queue-2'])
    expect(moveQueuedMessageToIndex(['queue-1', 'queue-2', 'queue-3'], 'queue-3', 0))
      .toEqual(['queue-3', 'queue-1', 'queue-2'])
    expect(moveQueuedMessageToIndex(['queue-1', 'queue-2'], 'queue-1', 99))
      .toEqual(['queue-2', 'queue-1'])
  })
})

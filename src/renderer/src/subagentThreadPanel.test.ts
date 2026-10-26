import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  SubagentThreadPanel,
  subagentThreadPanelContentState
} from './SubagentThreadPanel'
import type { Thread } from './protocol'

describe('SubagentThreadPanel header', () => {
  it('matches the measured detail header without duplicate workbench actions', () => {
    const thread: Thread = {
      id: 'thread-audit',
      name: 'Layout verification',
      preview: '',
      cwd: '/tmp/project',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
      createdAt: 0,
      updatedAt: 0,
      turns: []
    }
    const html = renderToStaticMarkup(createElement(SubagentThreadPanel, {
      threadId: thread.id,
      displayName: thread.name || 'Layout verification',
      loadThread: async () => thread,
      renderThread: () => null,
      liveThread: thread,
      onClose: () => undefined,
      onOpenMain: () => undefined
    }))

    expect(html).toContain('aria-label="返回子代理列表"')
    expect(html).toContain('Layout verification')
    expect(html).toContain('GPT-5.6 Sol · Ultra')
    expect(html).not.toContain('aria-label="打开聊天"')
    expect(html).not.toContain('aria-label="关闭子智能体"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('keeps a usable live transcript visible when background hydration fails', () => {
    const thread: Thread = {
      id: 'thread-live',
      preview: '',
      cwd: '/tmp/project',
      createdAt: 0,
      updatedAt: 0,
      turns: []
    }

    expect(subagentThreadPanelContentState(thread, false, 'Network unavailable')).toBe('thread')
    expect(subagentThreadPanelContentState(null, false, 'Network unavailable')).toBe('error')
  })
})

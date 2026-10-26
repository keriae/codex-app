import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ThreadResumeNotice } from './ThreadResumeNotice'

describe('ThreadResumeNotice', () => {
  it('matches the shipped other-application recovery card', () => {
    const html = renderToStaticMarkup(createElement(ThreadResumeNotice, {
      busy: false,
      onRetry: vi.fn(),
      onFork: vi.fn()
    }))

    expect(html).toContain('已在另一个应用中打开')
    expect(html).toContain('请先在那边关闭会话，才能在这里继续。')
    expect(html).toContain('>重试<')
    expect(html).toContain('创建聊天分叉')
  })

  it('disables both recovery actions while retrying', () => {
    const html = renderToStaticMarkup(createElement(ThreadResumeNotice, {
      busy: true,
      onRetry: vi.fn(),
      onFork: vi.fn()
    }))

    expect(html).toContain('正在重试…')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })
})

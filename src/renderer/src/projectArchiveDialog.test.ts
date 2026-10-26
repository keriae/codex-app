import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectArchiveDialog } from './ProjectArchiveDialog'

const render = (options: Partial<Parameters<typeof ProjectArchiveDialog>[0]> = {}): string => renderToStaticMarkup(createElement(ProjectArchiveDialog, {
  projectName: 'Codex', count: 61, running: false, loading: false, busy: false, error: null, onCancel: vi.fn(), onSubmit: vi.fn(), ...options
}))

describe('project archive confirmation', () => {
  it('warns explicitly that archiving running chats stops ongoing work', () => {
    const html = render({ running: true })
    expect(html).toContain('停止并归档 61 个聊天？')
    expect(html).toContain('归档会停止所有正在进行的工作')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('project-archive-dialog')
  })

  it('keeps cancellation available during catalog loading while disabling archive', () => {
    const html = render({ count: null, loading: true })
    expect(html).toContain('正在加载聊天…')
    expect(html).toContain('class="project-dialog-secondary">取消')
    expect(html).toContain('class="project-dialog-danger" disabled=""')
  })

  it('disables both controls while the frozen count is being archived', () => {
    const html = render({ count: 12, busy: true })
    expect(html).toContain('归档 12 个聊天？')
    expect(html).toContain('class="project-dialog-secondary" disabled=""')
    expect(html).toContain('正在归档…')
  })

  it('does not enable archive after a catalog failure or when no active chats remain', () => {
    expect(render({ error: 'Disconnected' })).toContain('class="project-dialog-danger" disabled=""')
    expect(render({ count: 0 })).toContain('class="project-dialog-danger" disabled=""')
  })
})

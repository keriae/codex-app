import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FullAccessConfirmDialog } from './FullAccessConfirmDialog'
import { isFullAccessPermission } from './ultraFullAccess'

describe('Full Access permission confirmation', () => {
  it('recognizes every server spelling used for unrestricted access', () => {
    expect(isFullAccessPermission(':danger-full-access')).toBe(true)
    expect(isFullAccessPermission('danger-no-sandbox')).toBe(true)
    expect(isFullAccessPermission(':full-access')).toBe(true)
    expect(isFullAccessPermission(':workspace')).toBe(false)
  })

  it('renders the upstream warning structure and action order', () => {
    const html = renderToStaticMarkup(createElement(FullAccessConfirmDialog, {
      onCancel: vi.fn(),
      onConfirm: vi.fn()
    }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('开启完全访问权限？')
    expect(html).toContain('文件和文件夹')
    expect(html).toContain('终端命令')
    expect(html).toContain('互联网和已连接的应用')
    expect(html.indexOf('>取消<')).toBeLessThan(html.indexOf('<span>确认</span>'))
  })
})

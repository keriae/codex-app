import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WindowCloseDialog } from './WindowCloseDialog'
import { windowCloseDialogResponse, windowCloseDialogZoom } from './windowCloseDialogState'

const styles = readFileSync(new URL('./WindowCloseDialog.css', import.meta.url), 'utf8')

describe('window close dialog', () => {
  it('renders only the observed title, opt-out and two actions with Cancel initially focused', () => {
    const html = renderToStaticMarkup(createElement(WindowCloseDialog, {
      request: { id: 'close-1', origin: 'shortcut' }, onRespond: vi.fn(async () => {})
    }))
    expect(html).toContain('Are you sure you want to close the window?')
    expect(html).toContain('Do not ask me again')
    expect(html).toMatch(/type="button" autofocus="" class="window-close-cancel"[^>]*>Cancel<\/button>/)
    expect(html).toContain('>Close Window</button>')
    expect(html).toContain('role="dialog" aria-modal="true"')
    expect(html).not.toContain('aria-describedby')
    expect(html).not.toContain('<p')
    expect(html).not.toContain('<svg')
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  it('applies opt-out only after confirmation, keeping cancellation free of preference changes', () => {
    expect(windowCloseDialogResponse(false, true)).toEqual({ confirmed: false })
    expect(windowCloseDialogResponse(true, true)).toEqual({ confirmed: true, doNotAskAgain: true })
    expect(windowCloseDialogResponse(true, false)).toEqual({ confirmed: true, doNotAskAgain: false })
  })

  it('scales only the portal content and rejects unsupported or non-finite zoom', () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, 0.4, 3.1]) expect(windowCloseDialogZoom(value)).toBe(1)
    expect(windowCloseDialogZoom(0.5)).toBe(0.5)
    expect(windowCloseDialogZoom(1.2)).toBe(1.2)
    expect(windowCloseDialogZoom(3)).toBe(3)
    const html = renderToStaticMarkup(createElement(WindowCloseDialog, {
      request: { id: 'close-2', origin: 'window' }, onRespond: vi.fn(async () => {}), zoomFactor: 1.2
    }))
    expect(html).toContain('zoom:1.2')
    expect(html).toContain('max-width:calc((100vw - 40px) / 1.2)')
  })

  it('stays above and suppresses transient overlays from the underlying app', () => {
    expect(styles).toMatch(/\.window-close-backdrop\s*\{[^}]*z-index:\s*20000/s)
    for (const selector of [
      '.settings-backdrop', '.remote-project-dialog-backdrop', '.remote-dialog-backdrop',
      '.thread-goal-dialog-backdrop', '.import-modal-backdrop', '.tool-raw-output-backdrop',
      '.thread-image-lightbox', '.diagram-lightbox', '.workspace-file-context-menu'
    ]) expect(styles).toContain(`body[data-window-close-active='true'] ${selector}`)
  })
})

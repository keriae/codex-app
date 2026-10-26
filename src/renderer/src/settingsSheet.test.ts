import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSheet } from './SettingsSheet'

describe('SettingsSheet', () => {
  it('renders an accessible macOS settings dialog with general, account, and integrations tabs', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSheet, {
        backend: { state: 'ready', mode: 'direct' },
        context: {
          cwd: '/work/codex-app',
          folderName: 'codex-app',
          branch: 'main',
          platform: 'darwin'
        },
        theme: 'dark',
        onToggleTheme: vi.fn(),
        onClose: vi.fn()
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Settings sections')
    expect(html).toContain('General')
    expect(html).toContain('Account')
    expect(html).toContain('Integrations')
    expect(html).toContain('/work/codex-app')
    expect(html).toContain('Connected · local stdio')
    expect(html).not.toContain('apiKey')
  })
})

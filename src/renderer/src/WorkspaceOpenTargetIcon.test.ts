import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceOpenTargetIcon } from './WorkspaceOpenTargetIcon'

describe('workspace native app icon rendering', () => {
  it('shows the native PNG without replacing its colors, frame, or alpha', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceOpenTargetIcon, { target: {
      id: 'terminal', label: 'Terminal', iconDataUrl: 'data:image/png;base64,aWNvbg=='
    } }))
    expect(html).toContain('src="data:image/png;base64,aWNvbg=="')
    expect(html).toContain('draggable="false"')
    expect(html).not.toContain('is-terminal')
    expect(html).not.toContain('<svg')
  })

  it('uses the shipped app artwork for missing or non-native icon URLs', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceOpenTargetIcon, { target: {
      id: 'terminal', label: 'Terminal', iconDataUrl: 'https://example.invalid/icon.png'
    } }))
    expect(html).toContain('terminal.png')
    expect(html).toContain('<img')
    expect(html).not.toContain('example.invalid')
  })
})

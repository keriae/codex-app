import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TerminalRows, TerminalSheet } from './TerminalSheet'

describe('TerminalSheet', () => {
  it('renders an accessible thread-scoped dialog without exposing spawn controls', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalSheet, {
        threadId: 'synthetic-thread',
        threadTitle: 'Synthetic chat',
        onClose: vi.fn()
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Background terminals')
    expect(html).toContain('Refresh background terminals')
    expect(html).not.toContain('Spawn')
    expect(html).not.toContain('shellCommand')
  })

  it('shows only schema-backed process identity, command, and derived status', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalRows, {
        terminals: [
          {
            itemId: 'synthetic-item',
            processId: 'synthetic-process',
            command: 'synthetic command',
            cwd: '/synthetic/workspace',
            osPid: null,
            cpuPercent: null,
            rssKb: null
          }
        ],
        busyProcessId: null,
        onRequestTerminate: vi.fn()
      })
    )

    expect(html).toContain('synthetic command')
    expect(html).toContain('synthetic-process')
    expect(html).toContain('Running')
    expect(html).toContain('Terminate…')
    expect(html).not.toContain('/synthetic/workspace')
  })

  it.each(['bottom', 'right'] as const)('renders a %s dock as a nonmodal region', (placement) => {
    const html = renderToStaticMarkup(
      createElement(TerminalSheet, {
        threadId: 'synthetic-thread',
        threadTitle: 'Synthetic chat',
        presentation: 'docked',
        placement,
        onPlacementChange: vi.fn(),
        onToggleFullView: vi.fn(),
        onClose: vi.fn()
      })
    )

    expect(html).toContain('role="region"')
    expect(html).toContain(`data-placement="${placement}"`)
    expect(html).toContain('role="separator"')
    expect(html).toContain(`aria-orientation="${placement === 'bottom' ? 'horizontal' : 'vertical'}"`)
    expect(html).toContain('Move terminal panel to')
    expect(html).toContain('Show terminal in full view')
    expect(html).not.toContain('terminal-backdrop')
    expect(html).not.toContain('aria-modal')
    expect(html).not.toContain('Spawn')
  })

  it('fills the full-view slot without retaining a split-view resize handle', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalSheet, {
        threadId: 'synthetic-thread',
        threadTitle: 'Synthetic chat',
        presentation: 'docked',
        placement: 'right',
        fullView: true,
        onToggleFullView: vi.fn(),
        onClose: vi.fn()
      })
    )

    expect(html).toContain('terminal-panel-full-view')
    expect(html).toContain('Exit terminal full view')
    expect(html).not.toContain('role="separator"')
    expect(html).not.toContain('aria-modal')
  })
})

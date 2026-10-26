import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { hasInteractiveTerminalBridge, InteractiveTerminal, TerminalStartupEventBuffer } from './InteractiveTerminal'

describe('interactive terminal bridge and rendering', () => {
  it.each(['bottom', 'right'] as const)('renders a %s PTY region with accessible resize controls', (placement) => {
    const html = renderToStaticMarkup(createElement(InteractiveTerminal, {
      cwd: '/synthetic/workspace', placement, uiZoom: 1.25,
      onPlacementChange: vi.fn(), onToggleFullView: vi.fn(), onClose: vi.fn()
    }))
    expect(html).toContain('role="region"')
    expect(html).toContain(`data-placement="${placement}"`)
    expect(html).toContain('data-terminal-state="starting"')
    expect(html).toContain('role="separator"')
    expect(html).toContain(`aria-orientation="${placement === 'bottom' ? 'horizontal' : 'vertical'}"`)
    expect(html).toContain('Close terminal')
    expect(html).not.toContain('aria-modal')
    expect(html).not.toContain('Background terminals')
    expect(html).not.toContain('Spawn')
  })

  it('full view removes the split resize handle', () => {
    const html = renderToStaticMarkup(createElement(InteractiveTerminal, {
      cwd: '/synthetic/workspace', placement: 'right', fullView: true,
      onToggleFullView: vi.fn(), onClose: vi.fn()
    }))
    expect(html).toContain('terminal-panel-full-view')
    expect(html).toContain('Exit terminal full view')
    expect(html).not.toContain('role="separator"')
  })

  it('requires the complete native bridge before creating a terminal', () => {
    const methods = ['openTerminal', 'writeTerminal', 'resizeTerminal', 'closeTerminal', 'onTerminalEvent']
    const complete = Object.fromEntries(methods.map((method) => [method, vi.fn()]))
    expect(hasInteractiveTerminalBridge(complete)).toBe(true)
    for (const method of methods) expect(hasInteractiveTerminalBridge({ ...complete, [method]: null })).toBe(false)
    for (const invalid of [null, undefined, 'terminal', 1, {}]) expect(hasInteractiveTerminalBridge(invalid)).toBe(false)
  })

  it('replays only the newly opened session, preserving output and exit order', () => {
    const buffer = new TerminalStartupEventBuffer()
    buffer.push({ id: 'unrelated', type: 'output', data: 'private output' })
    buffer.push({ id: 'opened', type: 'output', data: '你好🙂' })
    buffer.push({ id: 'opened', type: 'exit', exitCode: 7 })
    expect(buffer.take('opened')).toMatchObject({ overflowed: false, events: [
      { id: 'opened', type: 'output', data: '你好🙂' },
      { id: 'opened', type: 'exit', exitCode: 7 }
    ] })
    expect(buffer.take('unrelated').events).toEqual([])
  })

  it('reports selected-session overflow instead of silently replaying truncated output', () => {
    const buffer = new TerminalStartupEventBuffer(256, 2)
    buffer.push({ id: 'large-other', type: 'output', data: 'x'.repeat(1024) })
    buffer.push({ id: 'opened', type: 'output', data: 'safe' })
    expect(buffer.take('opened')).toMatchObject({ overflowed: false, events: [{ data: 'safe' }] })
    buffer.push({ id: 'opened', type: 'output', data: 'x'.repeat(1024) })
    buffer.push({ id: 'opened', type: 'exit', exitCode: 0 })
    expect(buffer.take('opened')).toMatchObject({ overflowed: true, events: [] })
    buffer.push({ id: 'opened', type: 'exit', exitCode: 0 })
    buffer.clear()
    expect(buffer.take('opened').events).toEqual([])
  })
})

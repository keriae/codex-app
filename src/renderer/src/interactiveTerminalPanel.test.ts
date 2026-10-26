import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { InteractiveTerminalPanel } from './InteractiveTerminalPanel'
import { TerminalTabsRegistry } from './terminalTabs'

const registries: TerminalTabsRegistry[] = []
function setup() {
  let index = 0
  const registry = new TerminalTabsRegistry(() => `tab-${++index}`)
  registries.push(registry)
  return { registry, controller: registry.get('chat') }
}
afterEach(async () => { await Promise.all(registries.splice(0).map((registry) => registry.dispose())) })

describe('terminal tab panel accessibility and state', () => {
  it('renders each panel tab with one correctly linked surface and only one selection', () => {
    const { controller } = setup()
    controller.create('bottom', '/work/project')
    controller.create('right', '/work/other')
    controller.create('bottom', '/work/project')
    const html = renderToStaticMarkup(createElement(InteractiveTerminalPanel, { controller, placement: 'bottom', cwd: '/work/current' }))
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => match[0])
    expect(tabs).toHaveLength(2)
    expect(tabs.filter((tab) => tab.includes('aria-selected="true"'))).toHaveLength(1)
    expect(tabs.filter((tab) => tab.includes('tabindex="0"'))).toHaveLength(1)
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2)
    for (const tab of tabs) {
      const tabId = /\bid="([^"]+)"/.exec(tab)![1]
      const surfaceId = /aria-controls="([^"]+)"/.exec(tab)![1]
      expect(html.match(new RegExp(` id="${surfaceId}"`, 'g'))).toHaveLength(1)
      expect(html).toContain(`aria-labelledby="${tabId}"`)
    }
    expect(html).toContain('Close project 1 tab')
    expect(html).toContain('Close project 2 tab')
    expect(html).not.toContain('Close other tab')
    expect(html).toContain('aria-keyshortcuts="Delete"')
    expect(html.match(/draggable="true"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Hide bottom panel"')
  })
  it('hides a closed panel while retaining tab and surface markup', () => {
    const { controller } = setup()
    controller.create('right', '/work/project')
    controller.hide('right')
    const html = renderToStaticMarkup(createElement(InteractiveTerminalPanel, { controller, placement: 'right', cwd: '/work' }))
    expect(html).toContain('data-terminal-panel-visible="false"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('hidden=""')
  })
  it('disables new terminal when other chats exhaust the shared process budget', () => {
    const { registry, controller } = setup()
    controller.create('bottom', '/work')
    const other = registry.get('other-chat')
    for (let index = 0; index < 7; index++) other.create('right', '/work/other')
    const html = renderToStaticMarkup(createElement(InteractiveTerminalPanel, { controller, placement: 'bottom', cwd: '/work' }))
    const newButton = /<button[^>]*aria-label="New terminal"[^>]*>/.exec(html)![0]
    expect(newButton).toContain('disabled=""')
  })
  it('renders full view without a resize separator and has no empty panel chrome', () => {
    const { controller } = setup()
    expect(renderToStaticMarkup(createElement(InteractiveTerminalPanel, { controller, placement: 'bottom', cwd: '/work' }))).toBe('')
    controller.create('bottom', '/work')
    controller.toggleFullView('bottom')
    const html = renderToStaticMarkup(createElement(InteractiveTerminalPanel, { controller, placement: 'bottom', cwd: '/work' }))
    expect(html).toContain('terminal-panel-full-view')
    expect(html).toContain('Exit terminal full view')
    expect(html).not.toContain('role="separator"')
  })
})

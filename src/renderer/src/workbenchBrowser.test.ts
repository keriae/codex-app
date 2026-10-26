import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserViewState } from '../../shared/api'
import { WorkbenchBrowser, type WorkbenchBrowserProps } from './WorkbenchBrowser'

const styles = readFileSync(new URL('./WorkbenchBrowser.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('./WorkbenchBrowser.tsx', import.meta.url), 'utf8')

function props(state: BrowserViewState | null = null): WorkbenchBrowserProps {
  return {
    tabId: 'web-1',
    active: true,
    state,
    onStateChange: vi.fn(),
    onOpenNewTab: vi.fn(),
    onOpenChanges: vi.fn(),
    onOpenFiles: vi.fn(),
    onOpenSideChat: vi.fn(),
    onOpenTerminal: vi.fn(),
    onToggleBottomTerminal: vi.fn(),
    recentItems: [],
    onOpenRecent: vi.fn()
  }
}

function expectCssRule(selector: string, declarations: readonly string[]): void {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'gs'))]
    .map((match) => match[1])
  expect(
    blocks.some((block) => declarations.every((declaration) => block.includes(declaration))),
    `missing CSS contract for ${selector}: ${declarations.join(', ')}`
  ).toBe(true)
}

describe('workbench browser rendering', () => {
  it('renders the native new-tab tools without touching the bridge during render', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchBrowser, props()))
    expect(html).toContain('aria-label="搜索或输入网址"')
    expect(html).toContain('role="toolbar" aria-label="导航"')
    expect(html).toContain('aria-label="返回"')
    expect(html).toContain('aria-label="重新加载页面"')
    expect(html).toContain('role="toolbar" aria-label="浏览器操作"')
    expect(html).toContain('aria-label="扩展程序"')
    expect(html).toContain('aria-label="浏览器选项"')
    expect(html).toContain('viewBox="0 0 20 20" aria-hidden="true" focusable="false"')
    expect(html).toContain('M9.99958 10.5852')
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(3)
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3)
    expect(html).toMatch(
      /class="workbench-browser-import-banner" role="status" aria-labelledby="[^"]+" aria-describedby="[^"]+"/
    )
    expect(html).not.toContain('workbench-browser-address-icon')
    expect(html).toMatch(/<strong id="[^"]+">从 Chrome 导入数据<\/strong>/)
    expect(html).toMatch(/<small id="[^"]+">将你的密码和 Cookie 导入内置浏览器<\/small>/)
    expect(html).toContain('>导入</button>')
    expect(html).toContain('aria-label="关闭浏览器数据导入横幅"')
    expect(html).toContain('>变更<')
    expect(html).toContain('M9.6665 10.1421')
    expect(html).toContain('>终端<')
    expect(html).toContain('aria-label="终端选项"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('>侧边聊天<')
    expect(html).toContain('M8 5.29883')
    expect(html).toContain('>文件<')
    expect(html).not.toContain('>推荐<')
    expect(html).not.toContain('>最近<')
    expect(html).not.toContain('>MCP 文档<')
    expect(html).not.toContain('<strong>index.html</strong>')
    expect(html).not.toContain('>OpenAI Docs<')
    expect(html).not.toContain('>Codex · GitHub<')
    expect(html).not.toContain('is-navigated')
  })

  it('renders only real recent output artifacts supplied by the selected chat', () => {
    const values = props()
    values.recentItems = [{
      id: 'turn:image',
      kind: 'image',
      title: 'diagram.png',
      subtitle: '生成图片',
      target: '/workspace/diagram.png',
      producedAtMs: null
    }]
    const html = renderToStaticMarkup(createElement(WorkbenchBrowser, values))
    expect(html).toContain('>最近<')
    expect(html).toContain('<strong>diagram.png</strong><small>生成图片</small>')
    expect(html).not.toContain('<strong>index.html</strong>')
  })

  it('reserves the native content viewport after navigation and reflects history state', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchBrowser, props({
      id: 'web-1',
      url: 'https://example.com/',
      title: 'Example',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      error: null
    })))
    expect(html).toContain('aria-label="Example"')
    expect(html).toContain('value="https://example.com/"')
    expect(html).toContain('class="workbench-browser-viewport is-navigated"')
    expect(html).not.toContain('workbench-browser-home-inner')
    expect(html).not.toContain('workbench-browser-import-banner')
  })

  it('uses the recovered stop label and two-pixel progress indicator while loading', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchBrowser, props({
      id: 'web-1',
      url: 'https://example.com/',
      title: 'Example',
      loading: true,
      canGoBack: false,
      canGoForward: false,
      error: null
    })))
    expect(html).toContain('aria-label="停止加载"')
    expect(html).toContain('class="workbench-browser-loading-bar" aria-hidden="true"')
  })
})

describe('workbench browser recovered geometry', () => {
  it('matches the native browser toolbar and centered omnibox dimensions', () => {
    expectCssRule('.workbench-browser-chrome', [
      'height: 48px;',
      'flex: 0 0 48px;',
      'gap: 6px;',
      'padding: 8px;'
    ])
    expectCssRule('.workbench-browser-navigation', [
      'height: 32px;',
      'border-radius: 999px;'
    ])
    expectCssRule('.workbench-browser-address', [
      'flex: 0 1 770px;',
      'max-width: 770px;'
    ])
    expectCssRule('.workbench-browser-loading-bar', ['height: 2px;'])
    expectCssRule('.workbench-browser-import-banner', [
      'min-height: 56px;',
      'gap: 12px;',
      'padding: 8px 8px 8px 16px;'
    ])
  })

  it('matches the native new-tab card spacing and recent-row height', () => {
    expectCssRule('.workbench-browser-home', [
      'padding: 32px 20px 48px;'
    ])
    expectCssRule('.workbench-browser-home-inner', [
      'max-width: 768px;',
      'gap: 40px;'
    ])
    expectCssRule('.workbench-browser-tools-section,\n.workbench-browser-recommendations-section', [
      'gap: 16px;'
    ])
    expectCssRule('.workbench-browser-tools', [
      'grid-template-columns: minmax(0, 1fr);',
      'column-gap: 16px;',
      'row-gap: 4px;'
    ])
    expectCssRule('.workbench-browser-tool', ['min-height: 40px;'])
    expect(styles).toContain('@container (min-width: 448px)')
    expect(styles).toMatch(
      /@container \(min-width: 448px\)\s*\{\s*\.workbench-browser-tools\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s
    )
    expectCssRule('.workbench-browser-recommendations', [
      'display: flex;',
      'gap: 12px;',
      'overflow-x: auto;'
    ])
    expectCssRule('.workbench-browser-recommendations > li', [
      'min-width: 128px;',
      'flex: 1;'
    ])
    expectCssRule('.workbench-browser-recommendation', [
      'gap: 12px;',
      'padding: 12px;',
      'border-radius: 12px;'
    ])
    expectCssRule('.workbench-browser-recommendation-icon', [
      'width: 48px;',
      'height: 48px;'
    ])
    expectCssRule('.workbench-browser-recent', ['min-height: 56px;'])
    expectCssRule('.workbench-browser-recent-icon', [
      'width: 28px;',
      'height: 28px;'
    ])
    expectCssRule('.workbench-browser-recent small,\n.workbench-browser-recent time', [
      'font-size: 12px;'
    ])
  })

  it('keeps browser errors legible in both appearance themes', () => {
    expectCssRule('.workbench-browser-error', ['color: var(--danger);'])
  })
})

describe('workbench browser command lifecycle', () => {
  it('ignores stale command failures and restores the home surface after the latest failure', () => {
    expect(source).toContain('commandSequenceRef.current !== sequence')
    expect(source).toContain(
      'setRequestedUrl((current) => current === url ? null : current)'
    )
  })

  it('keeps unsupported browser services honest while exposing recovered menus and import copy', () => {
    expect(source).toContain('role="menu"')
    expect(source).toContain('扩展程序（0）')
    expect(source).toContain('未安装扩展程序')
    expect(source).toContain('管理扩展程序')
    expect(source).toContain('访问网上应用商店')
    expect(source).toContain('onOpenNewTab(WORKBENCH_BROWSER_WEB_STORE_URL)')
    expect(source).toContain('在页面中查找')
    expect(source).toContain('aria-label="缩小" disabled')
    expect(source).toContain('aria-label="放大" disabled')
    expect(source).toContain('role="dialog"')
    expect(source).toContain('从其他浏览器导入数据')
    expect(source).toContain('已保存的密码')
    expect(source).toContain('浏览记录')
    expect(source).toContain('当前构建未连接浏览器资料导入服务。')
    expect(source).toContain('className="is-primary" disabled>继续')
    expect(source).toContain('listBrowserTopSites()')
    expect(source).toContain('dismissBrowserTopSite(site.url)')
    expect(source).toContain('restoreBrowserTopSite(site.url)')
  })

  it('connects the recovered terminal overflow menu to the real bottom-panel callback', () => {
    expect(source).toContain("toggleToolbarMenu(event, 'terminal')")
    expect(source).toContain('<TerminalSquare /><span>打开底部终端</span><kbd>⌘J</kbd>')
    expect(source).toContain('onToggleBottomTerminal()')
    expectCssRule('.workbench-browser-terminal-menu', [
      'top: calc(100% + 4px);',
      'width: 158px;'
    ])
  })
})

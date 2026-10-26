import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage, SettingsPill, UnavailableSelectPill } from './SettingsPage'

const settingsSourceText = readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8')
const settingsSource = ts.createSourceFile('SettingsPage.tsx', settingsSourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function rawButtonsWithoutBehavior(): string[] {
  const failures: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(settingsSource) === 'button') {
        const attributes = new Set(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText(settingsSource)))
        if (!attributes.has('onClick') && !attributes.has('disabled')) {
          const { line } = settingsSource.getLineAndCharacterOfPosition(node.getStart(settingsSource))
          failures.push(`line ${line + 1}: ${node.getText(settingsSource).slice(0, 100)}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(settingsSource)
  return failures
}

describe('SettingsPage', () => {
  it('renders the upstream full-page settings navigation and general route', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        backend: { state: 'ready', mode: 'direct' },
        context: {
          cwd: '/work/codex-app',
          folderName: 'codex-app',
          branch: 'main',
          platform: 'darwin'
        },
        theme: 'dark',
        onToggleTheme: vi.fn()
      })
    )

    expect(html).toContain('class="settings-page"')
    expect(html).toContain('aria-label="设置部分"')
    expect(html).toContain('data-settings-route="general"')
    expect(html).toContain('常规')
    expect(html).toContain('个性化')
    expect(html).toContain('应用快照')
    expect(html).toContain('Worktrees')
    expect(html).toContain('/work/codex-app')
    expect(html).toContain('role="switch"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('aria-modal="true"')
  })

  it('opens a requested settings section from native menu shortcuts', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        backend: { state: 'ready', mode: 'direct' },
        context: null,
        theme: 'dark',
        initialSection: 'shortcuts',
        onToggleTheme: vi.fn()
      })
    )

    expect(html).toContain('data-settings-route="shortcuts"')
    expect(html).toContain('键盘快捷键')
  })

  it('renders action pills without callbacks as explicitly unavailable', () => {
    const unavailable = renderToStaticMarkup(createElement(SettingsPill, { children: '管理' }))
    const actionable = renderToStaticMarkup(createElement(SettingsPill, { children: '更改', onClick: vi.fn() }))
    const select = renderToStaticMarkup(createElement(UnavailableSelectPill, { children: '默认', unavailableReason: '未接入偏好' }))

    expect(unavailable).toContain('disabled=""')
    expect(unavailable).toContain('title="当前复刻版尚未接入此设置"')
    expect(actionable).not.toContain('disabled=""')
    expect(select).toContain('disabled=""')
    expect(select).toContain('aria-description="未接入偏好"')
  })

  it('does not leave raw buttons clickable-looking without a handler or disabled state', () => {
    expect(rawButtonsWithoutBehavior()).toEqual([])
  })

  it('keeps explicit appearance preference updates separate from the legacy theme toggle fallback', () => {
    const chooseMode = settingsSourceText.match(/const chooseMode = \(nextMode: AppearanceMode\): void => \{[\s\S]*?\n  \}/)?.[0]

    expect(chooseMode).toContain('onThemePreferenceChange(nextMode)')
    expect(chooseMode).toMatch(/onThemePreferenceChange\(nextMode\)\s+return/)
    expect(chooseMode?.indexOf('return')).toBeLessThan(chooseMode?.indexOf('onToggleTheme()') ?? -1)
  })

  it('uses evidenced documentation links and marks unsupported native flows honestly', () => {
    expect(settingsSourceText).not.toContain('href="#learn-more"')
    expect(settingsSourceText).toContain('https://developers.openai.com/codex/app/chrome-extension')
    expect(settingsSourceText).toContain('https://developers.openai.com/codex/hooks')
    expect(settingsSourceText).toContain('https://developers.openai.com/codex/remote-connections#connect-to-an-ssh-host')
    expect(settingsSourceText).toContain('disabled title="当前 renderer IPC 未接入 hooks/list"')
    expect(settingsSourceText).toContain('window.codex.listRemoteConnections()')
    expect(settingsSourceText).toContain('window.codex.saveRemoteConnection(options)')
    expect(settingsSourceText).toContain('window.codex.connectRemoteConnection(saved.hostId)')
    expect(settingsSourceText).not.toContain('需要原版远程连接编辑器和认证后端')
  })

  it('lists only explicitly saved projects in environment settings', () => {
    const environmentSettings = settingsSourceText.match(
      /function EnvironmentSettings[\s\S]*?\n\}/
    )?.[0]

    expect(environmentSettings).toContain('new Set(projectPaths)')
    expect(environmentSettings).not.toContain('context.cwd')
    expect(environmentSettings).not.toContain('context?.cwd')
  })
})

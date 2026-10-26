import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const composerAddMenu = readFileSync(new URL('./ComposerAddMenu.tsx', import.meta.url), 'utf8')
const composerStyles = readFileSync(new URL('./composerAddMenu.css', import.meta.url), 'utf8')
const composerMenus = readFileSync(new URL('./ComposerMenus.tsx', import.meta.url), 'utf8')
const composerMenuStyles = readFileSync(new URL('./composerMenus.css', import.meta.url), 'utf8')

describe('native home parity contracts', () => {
  it('uses the measured native dark and light surfaces', () => {
    expect(styles).toContain('--window: #1d1d1d;')
    expect(styles).toContain('--rail: #1d1d1d;')
    expect(styles).toContain('--sidebar: #151515;')
    expect(styles).toContain('--main: #111111;')
    expect(styles).toContain('--composer: #2f2f2f;')
    expect(styles).toMatch(/:root\[data-theme='light'\]\s*\{[^}]*--window: #f6f6f6;[^}]*--rail: #f6f6f6;[^}]*--sidebar: #fcfcfc;[^}]*--text: #1a1c1f;/s)
    expect(composerStyles).toMatch(/\.composer-context-strip\s*\{[^}]*background: #212121;[^}]*color: var\(--text-faint\);[^}]*line-height: 18px;/s)
    expect(composerStyles).toMatch(/:root\[data-theme='light'\] \.composer-context-strip\s*\{[^}]*background: #f6f6f6;[^}]*color: var\(--text-faint\);/s)
    expect(styles).toContain('--text-faint: rgb(26 28 31 / 49.4%);')
    expect(styles).toMatch(/:root\[data-theme='light'\] \.titlebar-icon\s*\{[^}]*color: var\(--text-faint\);/s)
    expect(styles).toMatch(/:root\[data-theme='light'\] \.rail-button\s*\{[^}]*color: var\(--text-faint\);/s)
    expect(styles).toMatch(/:root\[data-theme='light'\] \.sidebar-heading-actions \.quiet-icon-button\s*\{[^}]*color: var\(--text-faint\);/s)
  })

  it('restores the selected home and project treatments', () => {
    expect(app).toContain('hasUnread={threadPreferences.unread.length > 0}')
    expect(app).toContain('badge={hasUnread}')
    expect(styles).toMatch(/\.rail-button\.active\s*\{[^}]*background: rgb\(252 252 252 \/ 8%\);[^}]*color: #fcfcfc;/s)
    expect(app).toContain("className={`sidebar-project-heading${active ? ' active' : ''}`}")
    expect(app).toContain("aria-current={active ? 'page' : undefined}")
    expect(styles).toMatch(/\.sidebar-project-heading\.active\s*\{[^}]*background: var\(--hover\);[^}]*color: color-mix\(in oklab, var\(--text\) 85%, transparent\);/s)
    expect(styles).toMatch(/\.new-thread-button\s*\{[^}]*width: calc\(100% - 16px\);[^}]*color: var\(--text\);/s)
    expect(app).toContain('<SidebarActivityIcon attention={hasAttentionThreads} />')
    expect(app).toContain("? '关闭活动视图'")
    expect(app).toContain("? '查看活动，有聊天需要关注'")
    expect(app).toContain("'暂无需要关注的聊天'")
    expect(app).toContain("'部分未读聊天尚不可用'")
  })

  it('uses the recovered native navigation and sidebar identities', () => {
    expect(app).toContain('function RailPluginsIcon()')
    expect(app).toContain('function RailHomeIcon({active}: {active: boolean})')
    expect(app).toContain('function RailScheduledIcon({active}: {active: boolean})')
    expect(app).toContain('M9.99596 3.8495')
    expect(app).toContain('M10.001 1.83496')
    expect(app).toContain('function CodexWordmark()')
    expect(app).toContain('function SidebarRemoteFolderIcon(')
    expect(app).toContain('remoteProjects={remoteProjects}')
    expect(styles).toMatch(/\.rail-notification-dot\s*\{[^}]*top: 6px;[^}]*right: 6px;[^}]*border: 0;/s)
    expect(styles).toMatch(/\.sidebar-head\s*\{[^}]*border-bottom: 0;/s)
    expect(styles).toMatch(/\.sidebar-project-host-status\[data-state='connected'\]::after\s*\{ background: #40c977; \}/s)
    expect(styles).toMatch(/\.sidebar-heading-actions \.quiet-icon-button\s*\{[^}]*color: rgb\(252 252 252 \/ 50%\);/s)
  })

  it('restores the native rounded page surface', () => {
    expect(styles).toMatch(/\.workspace-frame::after\s*\{[^}]*display: block;[^}]*border-radius: 12px;/s)
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*clip-path: inset\(0 -12px 0 0 round 12px\);/s)
    expect(styles).toMatch(/\.main-panel\s*\{[^}]*clip-path: inset\(0 0 0 -12px round 12px\);/s)
  })

  it('uses the current desktop home sidebar geometry', () => {
    expect(styles).toContain('--codex-sidebar-preferred-width: 288px;')
    expect(styles).toMatch(/\.sidebar-resize-handle\s*\{[^}]*width: 16px;[^}]*margin: 0 -8px;/s)
    expect(composerStyles).toMatch(/\.composer-context-strip\s*\{[^}]*gap: 8px;[^}]*border: 0;/s)
    expect(composerStyles).toMatch(/\.composer-context-segment\s*\{[^}]*height: 28px;[^}]*gap: 6px;[^}]*padding: 0 8px;[^}]*border: 1px solid transparent;[^}]*border-radius: 9999px;/s)
    expect(composerStyles).toMatch(/\.composer-context-segment svg\s*\{[^}]*width: 16px;[^}]*height: 16px;/s)
    expect(composerStyles).toMatch(/\.composer-context-project\s*\{[^}]*max-width: 224px;[^}]*background: transparent;/s)
  })

  it('matches the empty chat welcome treatment', () => {
    expect(styles).toMatch(/\.welcome-mark\s*\{[^}]*width: 56px;[^}]*height: 56px;[^}]*flex: 0 0 56px;/s)
    expect(app).toContain('mask="url(#codex-welcome-mark-inside)"')
    expect(app).toContain("workspaceCwd={context?.projectKind === 'projectless' ? null : context?.cwd || null}")
    expect(app).toContain("emptyThread ? '随心输入'")
    expect(styles).toMatch(/\.empty-conversation h2 button\s*\{[^}]*text-decoration-style: dotted;[^}]*text-underline-offset: 4px;/s)
  })

  it('matches the compact native permission trigger', () => {
    expect(composerMenus).toContain('ariaLabel="更改权限"')
    expect(composerMenus).toContain('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">')
    expect(composerMenus).toContain('d="M7.8005 0.880859')
    expect(composerMenuStyles).toMatch(/\.permission-menu-trigger\s*\{[^}]*justify-content: center;[^}]*gap: 4px;[^}]*padding: 0 6px;[^}]*border: 1px solid transparent;[^}]*border-radius: 9999px;/s)
    expect(composerMenuStyles).toMatch(/\.permission-menu-trigger > svg:first-child\s*\{[^}]*width: 16px;[^}]*height: 16px;[^}]*flex: 0 0 16px;/s)
    expect(composerMenuStyles).toMatch(/\.permission-menu-trigger \.composer-menu-chevron\s*\{[^}]*display: none;/s)
  })

  it('uses the recovered native composer glyphs and spacing', () => {
    expect(app).toContain('d="M9.33467 16.6663V4.93978')
    expect(composerAddMenu).toContain('d="M5.55957 2.14136')
    expect(composerMenus).toContain('d="M10.2954 6.54537')
    expect(styles).toMatch(/\.composer-run-controls\s*\{[^}]*gap: 8px;/s)
    expect(styles).toMatch(/\.composer-add-menu-trigger\s*\{[^}]*color: var\(--text\);/s)
    expect(composerStyles).toMatch(/\.attachment-picker\.composer-add-menu-trigger > svg\s*\{[^}]*width: 16px;[^}]*height: 16px;/s)
    expect(composerMenuStyles).toMatch(/\.model-effort-menu-trigger > svg\s*\{[^}]*width: 16px;[^}]*height: 16px;/s)
    expect(composerStyles).toMatch(/\.composer textarea::placeholder\s*\{[^}]*color: color-mix\(in srgb, var\(--text\) 49\.4%, transparent\);[^}]*opacity: 0\.5;/s)
  })

  it('records new drafts with the explicitly selected workspace context', () => {
    expect(app).toContain('workspaceContext: AppContext | null = contextRef.current')
    expect(app).toContain('navigationWorkspaceFields(workspaceContext)')
    expect(app).toContain("startNewThread(true, projectlessContext.cwd, undefined, 'local', projectlessContext)")
    expect(app).toContain('startNewThread(true, next.cwd, undefined, project.hostId, next)')
  })

  it('resets native button chrome globally and inside the dark project picker', () => {
    expect(styles).toMatch(/button\s*\{[^}]*appearance: none;[^}]*border: 0;[^}]*background: transparent;/s)
    expect(composerStyles).toMatch(/\.composer-project-picker-list > button,\s*\.composer-project-picker-footer > button\s*\{[^}]*appearance: none;[^}]*background: transparent;/s)
  })
})

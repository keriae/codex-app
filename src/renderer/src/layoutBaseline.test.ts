import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const addMenuStyles = readFileSync(new URL('./composerAddMenu.css', import.meta.url), 'utf8')
const composerMenuStyles = readFileSync(new URL('./composerMenus.css', import.meta.url), 'utf8')
const localEnvironmentStyles = readFileSync(new URL('./LocalEnvironmentDialog.css', import.meta.url), 'utf8')
const workspacePaneStyles = readFileSync(new URL('./WorkspacePane.css', import.meta.url), 'utf8')
const baseline = JSON.parse(
  readFileSync(
    new URL('../../../reverse/baseline/26.1016.61520.json', import.meta.url),
    'utf8'
  )
).renderer.layoutCssPixels

describe('measured macOS shell geometry', () => {
  it('keeps the global text-input focus rule lower-specificity than component resets', () => {
    expect(styles).toMatch(
      /button:focus-visible,\s*select:focus-visible,\s*:where\(textarea, input\):focus-visible\s*\{[^}]*outline: 2px solid/s
    )
    expect(styles).not.toContain('textarea:focus-visible,\ninput:focus-visible')
    expect(styles).toMatch(
      /\.composer:focus-within\s*\{[^}]*border: 0;[^}]*outline: 0;/s
    )
    expect(styles).toMatch(
      /\.composer textarea:focus,\s*\.composer textarea:focus-visible\s*\{[^}]*outline: 0;[^}]*box-shadow: none;/s
    )
  })

  it('keeps composer permission and model labels neutral while warning only through the icon', () => {
    expect(composerMenuStyles).toMatch(
      /\.permission-menu-trigger\s*\{[^}]*color: color-mix\(in srgb, var\(--text\) 49\.4%, transparent\);/s
    )
    expect(composerMenuStyles).toMatch(
      /\.permission-menu-trigger > \.permission-warning-icon,[^}]*\.composer-menu-option-icon > \.permission-warning-icon\s*\{[^}]*color: #ff8549;/s
    )
    expect(composerMenuStyles).toMatch(
      /\.model-effort-menu-trigger\s*\{[^}]*color: var\(--text-faint\);/s
    )
  })

  it('uses only the recovered 16px conversation inset at the content maximum', () => {
    const conversationRules = [...styles.matchAll(/^\.conversation-content\s*\{([^}]*)\}/gm)]
      .map((match) => match[1] || '')

    expect(conversationRules.length).toBeGreaterThanOrEqual(2)
    expect(conversationRules.every((rule) => rule.includes('width: 100%'))).toBe(true)
    expect(conversationRules.every((rule) => rule.includes('max-width: 768px'))).toBe(true)
    expect(conversationRules.join('\n')).not.toContain('calc(100% - 40px)')
  })

  it('fades and clips conversation content before the fixed composer surface', () => {
    expect(styles).toMatch(/\.main-panel\s*\{[^}]*--conversation-bottom-fade-distance: 32px;/s)
    expect(styles).toMatch(/\.main-panel\s*\{[^}]*container-type: inline-size;/s)
    expect(styles).toMatch(
      /\.conversation-bottom-fade\s*\{[^}]*position: absolute;[^}]*z-index: 8;[^}]*right: calc\(var\(--output-track-width\) \+ 8px\);[^}]*height: calc\([^}]*var\(--conversation-footer-height, 114px\)[^}]*linear-gradient\([^}]*transparent 0,[^}]*var\(--main\) var\(--conversation-bottom-fade-distance\)[^}]*pointer-events: none;/s
    )
    expect(styles).toMatch(
      /@container \(min-width: 1537px\)\s*\{[^}]*\.conversation-scroll,[^}]*\.conversation-bottom-fade,[^}]*\.composer-dock,[^}]*\.scroll-to-latest\s*\{[^}]*--output-track-width: 0px;/s
    )
    expect(styles).toMatch(
      /@container \(min-width: 1537px\)[\s\S]*?\.conversation-scroll\s*\{[^}]*--conversation-track-width: 100%;/
    )
    expect(styles).not.toMatch(/\.conversation-scroll\s*\{[^}]*mask-image:/s)
    expect(app).toContain('<div className="conversation-bottom-fade" aria-hidden="true" />')
    expect(workspacePaneStyles).toMatch(
      /workspace-pane-expanded[^\n]*data-workspace-layout='full'[^\n]*> \.conversation-bottom-fade,/
    )
    expect(localEnvironmentStyles).toMatch(
      /\.worktree-creation-status\s*\{[^}]*position: relative;[^}]*z-index: 9;/s
    )
    expect(styles).toContain(
      'padding: 32px 16px calc(var(--conversation-footer-height, 114px) + var(--conversation-bottom-fade-distance, 32px));'
    )
    expect(styles).toMatch(
      /\.composer-dock\s*\{[^}]*right: var\(--output-track-width\);[^}]*bottom: 16px;[^}]*max-width: 768px;[^}]*min-height: 98px;/s
    )
  })

  it('keeps the transcript scrollable without exposing scrollbar chrome', () => {
    const conversationScrollRules = [...styles.matchAll(/^\.conversation-scroll\s*\{([^}]*)\}/gm)]
      .map((match) => match[1] || '')
      .join('\n')

    expect(conversationScrollRules).toContain('overflow-y: auto;')
    expect(conversationScrollRules).toContain('scrollbar-width: none;')
    expect(conversationScrollRules).toContain('scrollbar-gutter: auto;')
    expect(conversationScrollRules).not.toContain('scrollbar-gutter: stable')
    expect(styles).toMatch(
      /\.conversation-scroll::-webkit-scrollbar\s*\{[^}]*width: 0;[^}]*height: 0;/s
    )
  })

  it('matches the recovered assistant markdown rhythm and table treatment', () => {
    expect(styles).toContain('--markdown-space: calc(var(--codex-chat-font-size, 14px) / 4);')
    expect(styles).toContain('--markdown-line-height: calc(var(--codex-chat-font-size, 14px) * 1.625);')
    expect(styles).toMatch(/\.markdown-body > p \+ p\s*\{[^}]*margin-block: calc\(var\(--markdown-space\) \* 4\);/s)
    expect(styles).toMatch(/\.markdown-body code\s*\{[^}]*padding: 1px 6px;[^}]*border: 0;[^}]*border-radius: 6px;[^}]*box-decoration-break: clone;[^}]*font-size: 0\.92em;/s)
    expect(styles).toMatch(/\.markdown-body table\s*\{[^}]*width: fit-content;[^}]*min-width: 100%;[^}]*border-collapse: separate;[^}]*font-size: var\(--markdown-small-font-size\);/s)
    expect(styles).toMatch(/\.markdown-body th\s*\{[^}]*border-bottom: 1px solid var\(--border-strong\);/s)
    expect(styles).toMatch(/\.markdown-body tbody tr:not\(:last-child\) td\s*\{[^}]*border-bottom: 1px solid var\(--border\);/s)
    expect(styles).not.toMatch(/\.markdown-body th,\s*\.markdown-body td\s*\{[^}]*border: 1px/s)
  })

  it('aligns workspace file links to the surrounding text baseline', () => {
    expect(styles).toMatch(
      /\.markdown-body a\.markdown-workspace-file-link\s*\{[^}]*display: inline-flex;[^}]*align-items: baseline;[^}]*line-height: inherit;[^}]*vertical-align: baseline;/s
    )
    expect(styles).toMatch(
      /\.markdown-workspace-file-icon\s*\{[^}]*align-self: center;/s
    )
    expect(styles).not.toContain('vertical-align: -2px;')
  })

  it('keeps the current titlebar, rail, and workspace insets in sync', () => {
    expect(baseline.titlebarHeight).toBe(44)
    expect(baseline.iconRailWidth).toBe(52)
    expect(baseline.railIconSize).toBe(20)
    expect(baseline.sidebarBorderRadius).toBe(0)
    expect(baseline.workspaceInsets).toEqual({ right: 4, bottom: 4 })
    expect(styles).toContain('--rail-width: 52px;')
    expect(styles).toContain('--titlebar-height: 44px;')
    expect(styles).toMatch(/\.rail-button svg\s*\{[^}]*width: 20px;[^}]*height: 20px;/s)
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*border-radius: 0;/s)
    expect(styles).toContain('width: calc(100% - 4px);')
    expect(styles).toContain('height: calc(100% - var(--titlebar-height) - 4px);')
    expect(app).toContain('<RailPluginsIcon />')
    expect(app).not.toContain('<Orbit />')
  })

  it('gives an empty chat the full main track and hides its output panel', () => {
    expect(baseline.emptyChat.outputTrackWidth).toBe(0)
    expect(baseline.emptyChat.titlebarActions).toEqual(['New chat'])
    expect(baseline.emptyChat.titlebarThreadVisible).toBe(false)
    expect(baseline.emptyChat.composer.innerWidth).toBe(736)
    expect(styles).toMatch(
      /\.main-panel:has\(\.conversation-content\.is-empty\)\s*\{[^}]*--output-track-width: 0px;/s
    )
    expect(styles).toMatch(
      /\.main-panel:has\(\.conversation-content\.is-empty\) > \.output-panel\s*\{[^}]*display: none;/s
    )
  })

  it('keeps the right workbench mounted while its full view hides chat and the bottom terminal', () => {
    expect(styles).toMatch(
      /\.chat-workspace\.right-workbench-full-view > \.chat-terminal-column\s*\{[^}]*display: flex;/s
    )
    expect(styles).toMatch(
      /\.chat-workspace\.right-workbench-full-view \.chat-conversation-row > \.main-panel,\s*\.chat-workspace\.right-workbench-full-view > \.chat-terminal-column > \.interactive-terminal\.terminal-placement-bottom\s*\{[^}]*display: none;/s
    )
    expect(styles).toMatch(
      /\.chat-workspace\.right-workbench-full-view \.right-workbench-column\s*\{[^}]*width: 100%;[^}]*flex: 1 1 100%;/s
    )
    expect(styles).not.toMatch(
      /\.chat-workspace\.right-workbench-full-view > \.chat-terminal-column\s*\{[^}]*display: none;/s
    )
  })

  it('matches the measured empty-state context rail', () => {
    expect(baseline.emptyChat.contextStrip).toEqual({
      x: 931,
      width: 710,
      height: 42,
      borderRadius: 20,
      bottomOverlap: 4
    })
    expect(addMenuStyles).toContain('width: calc(100% - 58px);')
    expect(addMenuStyles).toContain('flex: 0 0 42px;')
    expect(addMenuStyles).toContain('margin: 0 auto -4px;')
    expect(addMenuStyles).toContain('border-radius: 20px 20px 0 0;')
  })

  it('keeps the measured output card and reply action chrome', () => {
    expect(styles).toMatch(
      /\.output-panel\s*\{[^}]*width: 300px;[^}]*border-radius: 20px;[^}]*background: #262626;[^}]*rgb\(252 252 252 \/ 15\.7%\) 0 0 0 0\.5px,[^}]*rgb\(0 0 0 \/ 4%\) 0 3px 7\.5px,[^}]*rgb\(0 0 0 \/ 5%\) 0 0 20px;/s
    )
    expect(styles).toMatch(
      /\.agent-message-actions \.agent-message-copy\s*\{[^}]*width: 26px;[^}]*height: 26px;[^}]*padding: 4px;/s
    )
    expect(styles).toMatch(
      /\.agent-message-actions \.agent-message-more\s*\{[^}]*width: 24px;[^}]*height: 24px;/s
    )
    expect(styles).toMatch(/\.agent-message-actions\s*\{[^}]*opacity: 1;/s)
    expect(styles).toMatch(
      /\.message-actions\s*\{[^}]*min-height: 26px;[^}]*gap: 8px;[^}]*margin-inline: 4px;[^}]*opacity: 0;/s
    )
    expect(styles).toMatch(
      /\.message-actions\.is-persistent\s*\{[^}]*opacity: 1;/s
    )
    expect(styles).toMatch(
      /\.message-action-controls\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 2px;/s
    )
    expect(styles).toMatch(
      /\.message-actions button\s*\{[^}]*width: 26px;[^}]*height: 26px;[^}]*opacity: 1;[^}]*transition: background-color 150ms ease/s
    )
    expect(styles).toMatch(
      /\.message-actions\.is-persistent \.message-revert\s*\{[^}]*order: -1;[^}]*opacity: 0;/s
    )
    expect(styles).toMatch(
      /\.user-message-group:hover \.message-actions\.is-persistent \.message-revert,\s*\.message-actions\.is-persistent \.message-revert:focus-visible\s*\{[^}]*opacity: 1;/s
    )
    expect(styles).toMatch(
      /\.user-message-group\s*\{[^}]*gap: 4px;[^}]*margin-bottom: 16px;/s
    )
    expect(styles).toMatch(
      /\.user-message\s*\{[^}]*max-width: min\(70%, 620px\);[^}]*padding: 10px 16px;[^}]*border-radius: 22px;[^}]*font-size: var\(--codex-chat-font-size, 14px\);[^}]*line-height: 1\.625;/s
    )
    expect(styles).toMatch(
      /\.conversation-timestamp-separator\s*\{[^}]*justify-content: center;[^}]*padding: 16px 0;[^}]*color: var\(--text-faint\);/s
    )
    expect(styles).toMatch(
      /\.user-message-sent-at\s*\{[^}]*color: var\(--text-faint\);[^}]*font-size: 12px;[^}]*line-height: 16px;[^}]*opacity: 0;/s
    )
    expect(styles).toMatch(
      /\.user-message-group:hover \.user-message-sent-at,\s*\.message-actions:focus-within \.user-message-sent-at\s*\{[^}]*opacity: 1;/s
    )
    expect(styles).not.toMatch(
      /\.message-actions button\[aria-label=['"]Copy message['"]\]\s*\{[^}]*opacity: 1;/s
    )
    expect(styles).toMatch(/\.send-button\.stop\s*\{[^}]*padding: 2px;/s)
    expect(styles).toMatch(
      /\.send-button\.send:disabled\s*\{[^}]*opacity: 0\.5;/s
    )
    expect(styles).toMatch(
      /\.send-button\.send svg\s*\{[^}]*width: 16px;[^}]*fill: currentColor;[^}]*stroke: none;/s
    )
    expect(styles).toMatch(
      /\.send-button\.starting svg\s*\{[^}]*width: 16px;[^}]*height: 16px;/s
    )
  })

  it('matches the recovered activity status and collapsed-disclosure structure', () => {
    expect(styles).toMatch(
      /\.turn-activity\.is-live \.activity-section-heading,\s*\.turn-activity\.is-terminal \.activity-section-heading,\s*\.turn-activity\.is-complete \.activity-section-heading\s*\{[^}]*width: 100%;[^}]*height: 21px;[^}]*align-items: center;[^}]*gap: 8px;[^}]*font-size: 14px;[^}]*line-height: 21px;/s
    )
    expect(styles).toMatch(
      /\.turn-activity\.is-terminal \.activity-section-heading\s*\{[^}]*height: auto;[^}]*flex-direction: column;[^}]*align-items: stretch;[^}]*gap: 8px;/s
    )
    expect(styles).toMatch(
      /\.turn-activity\.is-terminal \.activity-section-heading > \.activity-heading-divider\s*\{[^}]*width: 100%;[^}]*flex: 0 0 auto;/s
    )
    expect(styles).toMatch(
      /\.activity-heading-divider\s*\{[^}]*width: auto;[^}]*min-width: 16px;[^}]*flex: 1 1 auto;[^}]*border-top: 1px solid rgb\(252 252 252 \/ 8\.2%\);/s
    )
    expect(styles).toMatch(
      /\.activity-disclosure\s*\{[^}]*flex: 0 0 auto;[^}]*color: rgb\(252 252 252 \/ 49\.8%\);[^}]*font-size: 14px;[^}]*font-weight: 430;[^}]*line-height: 21px;[^}]*font-variant-numeric: tabular-nums;/s
    )
    expect(styles).toMatch(
      /\.activity-disclosure button\s*\{[^}]*height: 21px;[^}]*gap: 4px;[^}]*margin: 0;[^}]*padding: 0;[^}]*border-radius: 10px;[^}]*background: transparent;/s
    )
    expect(styles).toMatch(
      /\.activity-disclosure svg\s*\{[^}]*width: 14px;[^}]*height: 14px;/s
    )
    expect(styles).toMatch(
      /\.activity-disclosure button:focus-visible\s*\{[^}]*box-shadow: 0 0 0 2px rgb\(100 164 224 \/ 76%\);[^}]*color: rgb\(252 252 252 \/ 49\.8%\);/s
    )
    expect(styles).toMatch(/\.turn-activity\.is-complete\s*\{[^}]*margin: 0 0 16px;/s)
    expect(styles).toMatch(
      /\.activity-collapse\s*\{[^}]*grid-template-rows: 0fr;[^}]*opacity: 0;[^}]*transform: translateY\(-4px\);[^}]*150ms/s
    )
    expect(styles).toMatch(
      /\.activity-collapse\.is-expanded\s*\{[^}]*grid-template-rows: 1fr;[^}]*opacity: 1;[^}]*transform: translateY\(0\);/s
    )
    expect(app).toContain('<ActivityDivider />')
    expect(app).toContain('<ActivitySectionHeading>')
    expect(app).not.toContain('className="activity-disclosure-divider"')
    expect(app).toContain('aria-expanded={expanded}')
    expect(app).toContain("className={`activity-collapse${expanded ? ' is-expanded' : ''}`}")
    expect(app).toContain("interrupted: turn.status === 'interrupted'")
    expect(app).toContain("activityPhase === 'complete'")
    expect(app).toContain('className="turn-activity is-open is-terminal"')
    expect(app).not.toContain('<details className="turn-activity is-complete"')
  })
})

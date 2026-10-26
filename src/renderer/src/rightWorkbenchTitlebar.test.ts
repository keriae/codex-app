import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const workspaceStyles = readFileSync(new URL('./WorkspacePane.css', import.meta.url), 'utf8')

describe('right workbench titlebar parity', () => {
  it('moves the conversation actions into the tab strip in full view', () => {
    expect(app).toContain('thread && !(rightWorkbenchOpen && rightWorkbenchFullView)')
    expect(app).toMatch(
      /rightWorkbenchFullView && thread && <div className=\{`right-workbench-title-tab is-chat-tab\$\{rightWorkbenchChatSelected \? ' is-active' : ''\}`\}>[\s\S]*?<TitlebarConversationMenu available pinned=\{threadPinned\} onAction=\{onConversationAction\} \/>/
    )
    expect(app).toContain('aria-selected={rightWorkbenchChatSelected}')
    expect(app).toContain('className={`titlebar-icon right-workbench-project-summary')
    expect(styles).toMatch(
      /\.right-workbench-title-tab\.is-chat-tab > \.titlebar-icon\s*\{[^}]*width: 24px;[^}]*height: 24px;/s
    )
  })

  it('uses the original split-view semantics for the secondary full-view control', () => {
    expect(app).toContain(
      "aria-label={rightWorkbenchFullView ? '进入分屏视图' : '隐藏标签页'}"
    )
    expect(app).toContain(
      'onClick={rightWorkbenchFullView ? onToggleRightWorkbenchFullView : onCollapseRightWorkbench}'
    )
  })

  it('keeps the full-view tab strip mounted when chat becomes the selected tab', () => {
    expect(app).toContain('const [rightWorkbenchView, setRightWorkbenchView] = useState(initialRightWorkbenchViewState)')
    expect(app).toContain('rightWorkbenchViewFlags(rightWorkbenchView)')
    expect(app).toContain('const visibleRightSurface = rightWorkbenchOpen && rightWorkbenchSurfaceVisible ? rightSurface : null')
    expect(app).toContain('onShowChat={showRightWorkbenchChat}')
    expect(app).toContain('activeRightTabId={rightWorkbenchChatSelected ? null : activeRightTabId}')
    expect(styles).toMatch(
      /\.right-workbench-title-tab\.is-chat-tab\.is-active\s*\{[^}]*color: var\(--text\);[^}]*opacity: 1;/s
    )
  })

  it('uses roving tab stops, native keyboard shortcuts, and a scrollable strip', () => {
    expect(app).toContain('resolveRightWorkbenchTabKeyboardAction({')
    expect(app).toContain('rightWorkbenchRovingTabIndex(rightTabOrder, selectedRightTabId, chatTabId)')
    expect(app).toContain('aria-keyshortcuts="ArrowLeft ArrowRight Home End Delete"')
    expect(app).toContain("target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })")
    expect(app).toContain('data-app-shell-tab-strip-controller="right"')
    expect(styles).toMatch(
      /\.right-workbench-title-tabs\s*\{[^}]*overflow-x: auto;[^}]*overflow-y: hidden;[^}]*scrollbar-width: none;/s
    )
  })

  it('keeps fixed-width tabs, trailing close affordances, and the add button next to the strip', () => {
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-title-tabs\s*\{[^}]*width: max-content;[^}]*max-width: calc\(100% - 104px\);[^}]*flex: 0 1 auto;/s
    )
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-title-tabs > \.right-workbench-title-tab\s*\{[^}]*width: 240px;[^}]*flex: 0 0 240px;/s
    )
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-title-close\s*\{[^}]*position: absolute;[^}]*right: 7px;[^}]*width: 20px;[^}]*height: 20px;/s
    )
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-title-tab > button:first-child\s*\{[^}]*gap: 4px;[^}]*padding-right: 31px;/s
    )
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-title-tab\.is-active > button:first-child > span\s*\{[^}]*font-weight: 430;/s
    )
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-titlebar-controls\s*\{[^}]*gap: 6px;/s
    )
    expect(workspaceStyles).toMatch(
      /\.right-workbench-titlebar \.right-workbench-titlebar-controls > button\[aria-pressed='true'\]\s*\{[^}]*background: color-mix\(in srgb, var\(--text\) 5%, transparent\);/s
    )
  })

  it('does not pass the React click event to the optional new-tab URL parameter', () => {
    expect(app).not.toContain('onClick={onOpenNewWorkbenchTab}><TitlebarNewTabIcon')
    expect(app).toContain('onClick={() => onOpenNewWorkbenchTab()}><TitlebarNewTabIcon')
  })
})

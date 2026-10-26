import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./WorkspacePane.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const workspaceStyles = readFileSync(new URL('./WorkspacePane.css', import.meta.url), 'utf8')
const diffStyles = readFileSync(new URL('./WorkspaceDiffViewer.css', import.meta.url), 'utf8')

describe('workspace toolbar open-target integration', () => {
  it('uses the preferred native open target with a separate target menu', () => {
    expect(workspace).toContain('window.codex.listWorkspaceOpenTargets()')
    expect(workspace).toContain('const preferredOpenTarget = readDesktopSettings().defaultFileTarget')
    expect(workspace).toContain('void window.codex.openWorkspacePath(cwd, toolbarOpenPath, target)')
    expect(workspace).toContain('className="workspace-open-primary"')
    expect(workspace).toContain('className="workspace-open-dropdown"')
    expect(workspace).toContain('className="workspace-open-native"')
    expect(workspace).toContain('onClick={() => primaryOpenTarget && openToolbarPath(primaryOpenTarget.id)}')
    expect(workspace).toContain('onClick={() => openToolbarPath(target.id)}')
    expect(workspace).toContain('aria-haspopup="menu"')
    expect(workspace).toContain('aria-expanded={toolbarOpenMenu}')
    expect(workspace).toContain('role="menu" aria-label="打开方式"')
    expect(workspace).not.toContain('onOpenTerminal?(): void')
    expect(workspace).not.toContain('aria-label="Show command output"')
    expect(app).not.toContain('onOpenTerminal={openRightTerminal}')
    expect(workspaceStyles).toMatch(/\.workspace-open-controls\s*\{[^}]*width:\s*150px;[^}]*height:\s*32px;/s)
    expect(workspaceStyles).toMatch(/\.workspace-open-native\s*\{[^}]*width:\s*86px;[^}]*height:\s*28px;/s)
    expect(workspaceStyles).toMatch(/\.workspace-open-native\s*>\s*\.workspace-open-primary\s*\{[^}]*width:\s*63px;/s)
    expect(workspaceStyles).toMatch(/\.workspace-open-native\s*>\s*\.workspace-open-dropdown\s*\{[^}]*width:\s*23px;/s)
  })

  it('matches the native diff action geometry and retains its change tabs', () => {
    expect(workspace).toContain("const WORKSPACE_CHANGE_SOURCES = ['上一轮', '未提交', '未暂存', '已暂存', '已提交', '分支']")
    expect(workspace).toContain("...(snapshot.changes.length > 0 || retainedChange ? [changesTab] : [])")
    expect(workspace).toContain("...(retainedChangeTab ? [retainedChangeTab] : [])")
    expect(workspace).toContain("onOpenFile={showSelectedChangeFile}")
    expect(workspace).toContain("onRefresh={refreshSelectedChange}")
    expect(workspace).toContain("toolbarActions={unifiedChrome ? (leadingControls, fileControls) => renderToolbarActions(fileControls, leadingControls) : undefined}")
    expect(workspace).toContain("setChangeView('overview'); setActiveTab('changes')")
    expect(workspaceStyles).toMatch(/\.workspace-file-actions\.is-diff\s*>\s*\.workspace-change-switcher\s*\{[^}]*width:\s*73px;/s)
    expect(workspaceStyles).toMatch(/\.workspace-diff-native-controls\s*\{[^}]*width:\s*224px;[^}]*height:\s*32px;/s)
    expect(workspaceStyles).toMatch(/\.workspace-diff-native-controls\s*>\s*button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/s)
    expect(workspace).toContain("aria-label={toolsVisible ? '隐藏文件' : '显示文件'}")
    expect(diffStyles).toContain('.workspace-diff-leading-controls')
    expect(diffStyles).toContain('.workspace-diff-file-controls')
    expect(diffStyles).toContain('.workspace-diff-viewer.is-collapsed .workspace-diff-line')
  })
})

describe('right workbench JSON tab icon', () => {
  it('uses the orange braces icon for JSON and JSONL files', () => {
    expect(app).toContain("if (kind === 'file' && /\\.(?:json|jsonl)$/i.test(title))")
    expect(app).toContain('<Braces className="right-workbench-json-icon" />')
    expect(app).toContain('<RightWorkbenchTabIcon kind={tab.kind} title={tab.title} />')
    expect(styles).toMatch(
      /\.right-workbench-title-tab \.right-workbench-json-icon\s*\{[^}]*color: #d9823b;/s
    )
  })
})

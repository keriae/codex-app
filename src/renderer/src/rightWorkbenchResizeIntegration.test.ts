import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const workspaceStyles = readFileSync(new URL('./WorkspacePane.css', import.meta.url), 'utf8')
const resizeSource = readFileSync(new URL('./rightWorkbenchResize.tsx', import.meta.url), 'utf8')

describe('right workbench resize shell integration', () => {
  it('measures the shared conversation row and publishes one width to body and titlebar', () => {
    expect(app).toContain('ref={rightWorkbenchContainerRef} className="chat-conversation-row"')
    expect(app).toContain('style={{...sidebarWidth.style, ...rightWorkbenchResize.style}}')
    expect(styles).toContain('auto var(--right-workbench-titlebar-width)')
    expect(styles).toContain(
      'auto var(--workspace-titlebar-width, var(--right-workbench-width))'
    )
    expect(styles).not.toContain('clamp(520px, calc(60vw - 300px), 960px)')
    expect(styles).not.toContain('clamp(520px, calc(54vw - 120px), 960px)')
  })

  it('uses the same separator for integrated workspace and retained workbench surfaces', () => {
    expect(app).toContain(
      "resizeHandle={visibleRightSurface === 'workspace' ? renderRightWorkbenchResizeHandle(true) : null}"
    )
    expect(app).toContain(
      "visibleRightSurface !== 'workspace' && renderRightWorkbenchResizeHandle()"
    )
    expect(resizeSource).toContain("ariaLabel = 'Resize workspace panes'")
  })

  it('snaps a raw drag below 160px closed and the opposite pane below 160px full', () => {
    expect(app).toMatch(
      /if \(rawWidth < 160\) \{[\s\S]*?rightWorkbenchResize\.cancel\(\)[\s\S]*?collapseRightWorkbench\(\)/
    )
    expect(app).toMatch(
      /rightWorkbenchResize\.workspaceWidth - rawWidth < 160[\s\S]*?enterRightWorkbenchFullView\(\)/
    )
  })

  it('allows the recovered 320px minimum in both pane implementations', () => {
    expect(styles).toMatch(
      /\.right-workbench-column\s*\{[^}]*min-width: min\(320px, 100%\);/s
    )
    expect(workspaceStyles).toMatch(
      /\.workspace-pane-expanded\s*\{[^}]*min-width: min\(320px, 100%\);/s
    )
  })
})

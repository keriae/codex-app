import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspacePane } from './WorkspacePane'

const source = readFileSync(new URL('./WorkspacePane.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./WorkspacePane.css', import.meta.url), 'utf8')

describe('workspace navigator parity structure', () => {
  it('renders the original combined navigation in the correct order', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePane, {
      session: undefined,
      cwd: '/project',
      integratedChrome: true,
      initialExpanded: true
    }))

    const navigator = html.slice(html.indexOf('aria-label="文件导航"'))
    const search = navigator.indexOf('placeholder="筛选文件…"')
    const allChanges = navigator.indexOf('所有更改')
    const changedFiles = navigator.indexOf('已更改的文件')
    const allFiles = navigator.indexOf('所有文件')
    expect(search).toBeGreaterThan(-1)
    expect(search).toBeLessThan(allChanges)
    expect(allChanges).toBeLessThan(changedFiles)
    expect(changedFiles).toBeLessThan(allFiles)
    expect(navigator).toMatch(/aria-expanded="true"[^>]*>[\s\S]*?已更改的文件/)
    expect(navigator).toMatch(/aria-expanded="true"[^>]*>[\s\S]*?所有文件/)
    expect(html).toContain('aria-label="调整文件导航宽度"')
    expect(html).toContain('--workspace-navigator-width:250px')
    expect(source).toContain('aria-label="清除文件筛选"')
    expect(source).toContain('className="workspace-pane-body" ref={setToolbarHost}')
    expect(source).toContain('toolbarTarget={unifiedChrome ? toolbarHost : undefined}')
    expect(styles).toMatch(/\.workspace-navigator-resize-handle\s*\{[^}]*margin-top:\s*48px;/s)
  })

  it('does not restore the obsolete Files, Changes, and Output tab strip', () => {
    expect(source).not.toContain('aria-label="Workspace views"')
    expect(source).not.toContain('className="workspace-pane-tabs"')
    expect(source).not.toMatch(/>\s*Files\s*</)
    expect(source).not.toMatch(/>\s*Changes\s*</)
    expect(source).not.toMatch(/>\s*Output\s*</)
  })
})

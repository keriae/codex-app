import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer'
import { resolveWorkspaceDiffLink } from './workspaceDiffLinks'
import { nextWorkspaceDiffStyle, parseWorkspaceDiffPreferences, resolveWorkspaceDiffStyle, workspaceDiffStyleLabel,
  WORKSPACE_DIFF_PREFERENCES_KEY, type WorkspaceDiffStyle } from './workspaceDiffModel'
import { parseUnifiedDiff } from './unifiedDiff'

afterEach(() => { vi.unstubAllGlobals() })

describe('original review diff modes', () => {
  it('defaults to Auto and preserves all explicit saved modes and wrap settings', () => {
    expect(parseWorkspaceDiffPreferences(null)).toMatchObject({ style: 'auto', wrap: false })
    for (const style of ['unified', 'split', 'auto'] as const) {
      expect(parseWorkspaceDiffPreferences(JSON.stringify({ style, wrap: true }))).toMatchObject({ style, wrap: true })
    }
    expect(parseWorkspaceDiffPreferences('not JSON')).toMatchObject({ style: 'auto', wrap: false })
    expect(parseWorkspaceDiffPreferences('{"style":"adaptive","wrap":1}')).toMatchObject({ style: 'auto', wrap: false })
  })

  it('cycles the saved mode through unified, split and Auto independently of its effective layout', () => {
    const modes: WorkspaceDiffStyle[] = []
    let mode: WorkspaceDiffStyle = 'unified'
    for (let i = 0; i < 4; i++) { modes.push(mode); mode = nextWorkspaceDiffStyle(mode) }
    expect(modes).toEqual(['unified', 'split', 'auto', 'unified'])
    expect(workspaceDiffStyleLabel('unified')).toBe('切换到拆分差异视图')
    expect(workspaceDiffStyleLabel('split')).toBe('将差异视图切换为自动布局')
    expect(workspaceDiffStyleLabel('auto')).toBe('自动差异视图：改用统一差异视图')
  })

  it('resolves Auto to split only for replacements at or above the logical 800px file width', () => {
    const replacement = parseUnifiedDiff('@@ -1 +1 @@\n-before\n+after')
    for (const width of [null, 0, 799, 799.99, NaN, Infinity]) {
      expect(resolveWorkspaceDiffStyle('auto', replacement, width)).toBe('unified')
    }
    expect(resolveWorkspaceDiffStyle('auto', replacement, 800)).toBe('split')
    expect(resolveWorkspaceDiffStyle('auto', replacement, 1440)).toBe('split')
    expect(resolveWorkspaceDiffStyle('unified', replacement, 1440)).toBe('unified')
    expect(resolveWorkspaceDiffStyle('split', replacement, 320)).toBe('split')
  })

  it('keeps added, deleted, binary and unchanged files unified in Auto, then reflows a streaming replacement', () => {
    for (const patch of ['+added', '-removed', ' same', 'Binary files a/file and b/file differ', '']) {
      expect(resolveWorkspaceDiffStyle('auto', parseUnifiedDiff(patch), 1440)).toBe('unified')
    }
    expect(resolveWorkspaceDiffStyle('auto', parseUnifiedDiff('-before'), 900)).toBe('unified')
    expect(resolveWorkspaceDiffStyle('auto', parseUnifiedDiff('-before\n+after'), 900)).toBe('split')
    expect(resolveWorkspaceDiffStyle('auto', parseUnifiedDiff('-before\n+after'), 600)).toBe('unified')
  })

  it.each(['unified', 'split', 'auto'] as const)('shows the original colored %s glyph and the next-action tooltip', (style) => {
    const saved = vi.fn((key: string) => key === WORKSPACE_DIFF_PREFERENCES_KEY ? JSON.stringify({ style, wrap: true }) : null)
    vi.stubGlobal('localStorage', { getItem: saved })
    const change = resolveWorkspaceDiffLink('/project', { itemId: 'replace', change: {
      path: 'a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-before\n+after'
    } })!
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project', onOpenFile: () => {} }))
    const label = workspaceDiffStyleLabel(style)
    expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toContain(`title="${label}"`)
    expect(html).toContain(`data-workspace-diff-glyph="${style}"`)
    expect(html).toContain(`data-diff-mode="${style}"`)
    expect(html).toContain(`data-diff-style="${style === 'split' ? 'split' : 'unified'}"`)
    expect(html).toContain('viewBox="0 0 16 16" fill="none" stroke="none"')
    expect(html).toContain('fill="#F84E63" fill-opacity="0.5"')
    expect(html).toContain('fill="#36D958" fill-opacity="0.5"')
    expect(html).not.toContain('lucide-columns-2')
    expect(html).toContain('is-wrapped')
  })
})

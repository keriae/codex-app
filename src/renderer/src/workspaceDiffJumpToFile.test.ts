import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { workspaceDiffJumpEntries } from './WorkspaceDiffJumpToFile'
import { resolveWorkspaceDiffLink } from './workspaceDiffLinks'
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer'

const change = (path: string) => resolveWorkspaceDiffLink('/project', { itemId: path, change: {
  path, kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new'
} })!

describe('original changed-file jump picker', () => {
  it('sorts empty queries by basename then parent and preserves the actual change entry identity', () => {
    const entries = [change('z/a.ts'), change('src/b.ts'), change('a/a.ts')]
    const result = workspaceDiffJumpEntries(entries, '/project', '  ')
    expect(result.map((entry) => entry.displayPath)).toEqual(['a/a.ts', 'z/a.ts', 'src/b.ts'])
    expect(result[0].change).toBe(entries[2])
    expect(result[0]).toMatchObject({ fileName: 'a.ts', parentPath: 'a' })
  })

  it('filters available paths without switching to the source editor or inventing entries', () => {
    const entries = [change('src/Button.tsx'), change('test/Button.test.tsx'), change('readme.md')]
    expect(workspaceDiffJumpEntries(entries, '/project', ' BUTTON ').map((entry) => entry.displayPath)).toEqual(['test/Button.test.tsx', 'src/Button.tsx'])
    expect(workspaceDiffJumpEntries(entries, '/project', 'src/').map((entry) => entry.change)).toEqual([entries[0]])
    expect(workspaceDiffJumpEntries(entries, '/project', 'missing')).toEqual([])
  })

  it('renders the original document magnifier with a custom tooltip and an actual change-selection callback', () => {
    const current = change('file.ts')
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change: current, cwd: '/project', onOpenFile: () => {},
      jumpChanges: [current], onJumpToChange: () => {} }))
    expect(html).toContain('aria-label="跳转到文件" aria-haspopup="dialog"')
    expect(html).toContain('data-workbench-glyph="document-badge-magnifyingglass-light-16"')
    expect(html).not.toContain('title="跳转到文件"')
    expect(html).not.toContain('lucide-file-code-2')
  })
})

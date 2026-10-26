import { describe, expect, it } from 'vitest'
import {
  dispatchWorkspaceFileLink,
  dispatchWorkspaceSourceImage,
  OPEN_WORKSPACE_FILE_EVENT,
  OPEN_WORKSPACE_SOURCE_IMAGE_EVENT,
  parseWorkspaceFileLink,
  resolveWorkspaceFileLink,
  type WorkspaceFileLink,
  workspaceFileLabelHasLocation,
  workspaceFileLocationLabel,
  workspaceCitationMatches,
  workspaceFileTypeLabel
} from './workspaceFileLinks'

describe('workspace Markdown file links', () => {
  it('extracts line numbers from fragments, suffixes, and visible labels', () => {
    expect(parseWorkspaceFileLink('src/main/index.ts#L299')).toEqual({
      path: 'src/main/index.ts',
      line: 299
    })
    expect(parseWorkspaceFileLink('src/main/appServer.ts#line-80')).toEqual({
      path: 'src/main/appServer.ts',
      line: 80
    })
    expect(parseWorkspaceFileLink('src/preload/index.ts:17')).toEqual({
      path: 'src/preload/index.ts',
      line: 17
    })
    expect(parseWorkspaceFileLink('src/renderer/src/App.tsx', 'App.tsx (line 277)')).toEqual({
      path: 'src/renderer/src/App.tsx',
      line: 277
    })
  })

  it('matches the original range, column, and backtick reference syntax', () => {
    expect(parseWorkspaceFileLink('`src/App.tsx:12:3–20:8`')).toEqual({
      path: 'src/App.tsx',
      line: 12,
      column: 3,
      endLine: 20,
      endColumn: 8
    })
    expect(parseWorkspaceFileLink('src/App.tsx#L12C3-L20C8')).toEqual({
      path: 'src/App.tsx',
      line: 12,
      column: 3,
      endLine: 20,
      endColumn: 8
    })
    expect(parseWorkspaceFileLink('src/App.tsx', 'App.tsx (lines 12-20)')).toEqual({
      path: 'src/App.tsx',
      line: 12,
      endLine: 20
    })
  })

  it('extracts Codex citations with source ranges and columns', () => {
    expect(
      workspaceCitationMatches(
        'See 【src/App.tsx†L12C3-L20C8】 and 【src/main/index.ts†L299-L306】.'
      )
    ).toMatchObject([
      {
        href: 'src/App.tsx#L12C3-L20C8',
        label: 'App.tsx (lines 12–20)',
        link: { path: 'src/App.tsx', line: 12, column: 3, endLine: 20, endColumn: 8 }
      },
      {
        href: 'src/main/index.ts#L299-L306',
        label: 'index.ts (lines 299–306)',
        link: { path: 'src/main/index.ts', line: 299, endLine: 306 }
      }
    ])
  })

  it('accepts decoded local file URLs but rejects web and executable URLs', () => {
    expect(parseWorkspaceFileLink('file:///Users/me/codex%20app/src/App.tsx#L42')).toEqual({
      path: '/Users/me/codex app/src/App.tsx',
      line: 42
    })
    expect(parseWorkspaceFileLink('https://example.com/src/App.tsx#L42')).toBeNull()
    expect(parseWorkspaceFileLink('mailto:person@example.com')).toBeNull()
    expect(parseWorkspaceFileLink('javascript:alert(1)')).toBeNull()
    expect(parseWorkspaceFileLink('#local-heading')).toBeNull()
  })

  it('resolves only paths contained by the active workspace', () => {
    expect(resolveWorkspaceFileLink('/workspace/codex-app', './src/../src/App.tsx')).toBe(
      '/workspace/codex-app/src/App.tsx'
    )
    expect(
      resolveWorkspaceFileLink('/workspace/codex-app', '/workspace/codex-app/src/App.tsx')
    ).toBe('/workspace/codex-app/src/App.tsx')
    expect(resolveWorkspaceFileLink('/workspace/codex-app', '../../private.txt')).toBeNull()
    expect(resolveWorkspaceFileLink('/workspace/codex-app', '/workspace/other/App.tsx')).toBeNull()
    expect(resolveWorkspaceFileLink('/', '/private/tmp/codex-clipboard.png')).toBe(
      '/private/tmp/codex-clipboard.png'
    )
  })

  it('dispatches a renderer-local open event with the parsed target', () => {
    const target = new EventTarget()
    let received: WorkspaceFileLink | null = null
    target.addEventListener(OPEN_WORKSPACE_FILE_EVENT, (event) => {
      received = (event as CustomEvent<WorkspaceFileLink>).detail
    })

    dispatchWorkspaceFileLink({ path: 'src/App.tsx', line: 42 }, target)

    expect(received).toEqual({ path: 'src/App.tsx', line: 42 })
  })

  it('dispatches an external thread-image target without weakening workspace path checks', () => {
    const target = new EventTarget()
    let received: string | null = null
    target.addEventListener(OPEN_WORKSPACE_SOURCE_IMAGE_EVENT, (event) => {
      received = (event as CustomEvent<string>).detail
    })

    dispatchWorkspaceSourceImage('/private/tmp/codex-clipboard.png', target)

    expect(received).toBe('/private/tmp/codex-clipboard.png')
    expect(resolveWorkspaceFileLink('/workspace/codex-app', received || '')).toBeNull()
  })

  it('derives compact file-type badges matching the source-link treatment', () => {
    expect(workspaceFileTypeLabel('src/main/index.ts')).toBe('TS')
    expect(workspaceFileTypeLabel('src/App.tsx')).toBe('TS')
    expect(workspaceFileTypeLabel('README.md')).toBe('MD')
    expect(workspaceFileTypeLabel('LICENSE')).toBe('<>')
    expect(workspaceFileLocationLabel({ path: 'src/App.tsx', line: 12, endLine: 20 })).toBe(
      '(lines 12–20)'
    )
    expect(workspaceFileLabelHasLocation('App.tsx (line 12)')).toBe(true)
    expect(workspaceFileLabelHasLocation('App.tsx')).toBe(false)
  })
})

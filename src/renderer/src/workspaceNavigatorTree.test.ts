import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileTreeView, WorkspaceChangedFiles, collectVisibleWorkspaceTreeItems, workspaceTreeKeyboardAction } from './WorkspacePane'
import { buildWorkspaceNavigatorChangedTree, collectVisibleWorkspaceChangedItems, collectWorkspaceNavigatorSearchPaths, workspaceNavigatorRevealDirectories } from './workspaceNavigatorModel'
import type { WorkspaceChangeEntry } from './workspacePaneModel'

const changes: WorkspaceChangeEntry[] = [
  { id: 'readme', path: '/project/README.md', sourcePath: '/project/README.md', turnId: 'turn', diff: '', kind: 'modified', status: 'completed', additions: 2, deletions: 1 },
  { id: 'alpha', path: '/project/src/alpha.ts', sourcePath: '/project/src/alpha.ts', turnId: 'turn', diff: '', kind: 'added', status: 'completed', additions: 3, deletions: 0 },
  { id: 'beta', path: '/project/src/lib/beta.ts', sourcePath: '/project/src/lib/beta.ts', turnId: 'turn', diff: '', kind: 'deleted', status: 'completed', additions: 0, deletions: 4 }
]

describe('workspace navigator tree behavior', () => {
  it('keeps selected keyed rows and keyboard order while a native watch baseline refreshes cached directories', () => {
    const directories = {
      '/project': { status: 'ready' as const, truncated: false, entries: [
        { path: '/project/src', fileName: 'src', isDirectory: true, isFile: false },
        { path: '/project/README.md', fileName: 'README.md', isDirectory: false, isFile: true }
      ] },
      '/project/src': { status: 'ready' as const, truncated: false, entries: [
        { path: '/project/src/alpha.ts', fileName: 'alpha.ts', isDirectory: false, isFile: true }
      ] }
    }
    const refreshing = Object.fromEntries(Object.entries(directories).map(([path, state]) => [path, { ...state, status: 'loading' as const }]))
    const expanded = new Set(['/project', '/project/src'])
    expect(collectVisibleWorkspaceTreeItems('/project', refreshing, expanded, '')).toEqual(
      collectVisibleWorkspaceTreeItems('/project', directories, expanded, ''))
    const searchBefore = collectWorkspaceNavigatorSearchPaths('/project', directories, 'alpha')
    const searchDuring = collectWorkspaceNavigatorSearchPaths('/project', refreshing, 'alpha')
    expect(searchDuring).toEqual(searchBefore)
    expect(collectVisibleWorkspaceTreeItems('/project', refreshing, expanded, 'alpha', searchDuring)).toEqual(
      collectVisibleWorkspaceTreeItems('/project', directories, expanded, 'alpha', searchBefore))
    const html = renderToStaticMarkup(createElement(FileTreeView, {
      cwd: '/project', directories: refreshing, expandedDirectories: expanded,
      selectedFile: '/project/src/alpha.ts', filter: '', hideRoot: true,
      onToggleDirectory: () => undefined, onSelectFile: () => undefined,
      onRetryDirectory: () => undefined, onContextMenu: () => undefined
    }))
    expect(html).toContain('data-workspace-tree-path="/project/src/alpha.ts"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).not.toContain('载入中…')
    expect(html).not.toContain('lucide-folder')
    const rows = new Map([...html.matchAll(/<button\b[^>]*data-workspace-tree-path="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((match) => [match[1], match[2]]))
    expect(rows.get('/project/src')).not.toContain('workspace-tree-indent-guides')
    expect(rows.get('/project/src/alpha.ts')).toContain('data-workspace-tree-indent-depth="1"')
  })

  it('retains the loading placeholder for a first directory read', () => {
    const html = renderToStaticMarkup(createElement(FileTreeView, {
      cwd: '/project', directories: { '/project': { status: 'loading', truncated: false, entries: [] } },
      expandedDirectories: new Set(['/project']), selectedFile: null, filter: '', hideRoot: true,
      onToggleDirectory: () => undefined, onSelectFile: () => undefined,
      onRetryDirectory: () => undefined, onContextMenu: () => undefined
    }))
    expect(html).toContain('载入中…')
    expect(html).not.toContain('data-workspace-tree-path=')
  })

  it('reveals source links inside their own root, including the filesystem root', () => {
    expect(workspaceNavigatorRevealDirectories('/project', '/project/src/lib/beta.ts')).toEqual(['/project', '/project/src', '/project/src/lib'])
    expect(workspaceNavigatorRevealDirectories('/', '/src/lib/file.ts')).toEqual(['/', '/src', '/src/lib'])
    for (const path of ['/project-other/file.ts', '/project/../file.ts', '/project/src/./file.ts', 'src/file.ts']) {
      expect(workspaceNavigatorRevealDirectories('/project', path)).toEqual([])
    }
  })

  it('navigates changed files using only the expanded hierarchy and preserves ancestors during filtering', () => {
    const tree = buildWorkspaceNavigatorChangedTree('/project', changes)
    const visible = collectVisibleWorkspaceChangedItems(tree, new Set(['src/lib']))
    expect(visible.map((item) => item.path)).toEqual(['src', 'src/lib', 'src/alpha.ts', 'README.md'])
    expect(workspaceTreeKeyboardAction(visible, 'src/lib', 'ArrowRight')).toEqual({ type: 'expand', path: 'src/lib' })
    expect(workspaceTreeKeyboardAction(visible, 'src/alpha.ts', 'ArrowLeft')).toEqual({ type: 'focus', path: 'src' })
    expect(workspaceTreeKeyboardAction(visible, 'src', 'End')).toEqual({ type: 'focus', path: 'README.md' })
    const filtered = collectVisibleWorkspaceChangedItems(buildWorkspaceNavigatorChangedTree('/project', changes, 'beta'), new Set(['src', 'src/lib']), true)
    expect(filtered.map((item) => item.path)).toEqual(['src', 'src/lib', 'src/lib/beta.ts'])
    expect(workspaceTreeKeyboardAction(filtered, 'src/lib/beta.ts', 'Enter')).toEqual({ type: 'activate', path: 'src/lib/beta.ts' })
  })

  it('renders changed files as a roving tree with the actual selected change as its tab stop', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceChangedFiles, {
      cwd: '/project', changes, selectedChange: changes[1], filter: '', collapsedPaths: new Set<string>(),
      onSelect: () => undefined, onToggleDirectory: () => undefined
    }))
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(/data-workspace-tree-path="src\/alpha.ts"/)
    expect(html).toMatch(/aria-selected="true" aria-level="2" aria-posinset="2" aria-setsize="2" tabindex="0"/)
    expect(html).toContain('aria-level="3"')
    expect(html).not.toContain('lucide-folder')
    const rows = new Map([...html.matchAll(/<button\b[^>]*data-workspace-tree-path="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((match) => [match[1], match[2]]))
    expect(rows.get('src')).not.toContain('workspace-tree-indent-guides')
    expect(rows.get('src/lib')).toContain('data-workspace-tree-indent-depth="1"')
    expect(rows.get('src/lib/beta.ts')).toContain('data-workspace-tree-indent-depth="2"')
  })

  it('ends descendant guide columns when their folder is collapsed', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceChangedFiles, {
      cwd: '/project', changes, selectedChange: null, filter: '', collapsedPaths: new Set(['src/lib']),
      onSelect: () => undefined, onToggleDirectory: () => undefined
    }))
    expect(html).toContain('data-workspace-tree-path="src/lib"')
    expect(html).not.toContain('data-workspace-tree-path="src/lib/beta.ts"')
    expect(html).not.toContain('data-workspace-tree-indent-depth="2"')
  })
})

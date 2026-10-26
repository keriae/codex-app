import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS,
  WORKSPACE_NAVIGATOR_SECTIONS_STORAGE_KEY,
  WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY,
  buildWorkspaceNavigatorChangedTree,
  clampWorkspaceNavigatorWidth,
  collectWorkspaceNavigatorSearchPaths,
  parseWorkspaceNavigatorSections,
  parseWorkspaceNavigatorWidth,
  persistWorkspaceNavigatorSections,
  persistWorkspaceNavigatorWidth,
  readWorkspaceNavigatorSections,
  readWorkspaceNavigatorWidth,
  workspaceNavigatorMaximumWidth
} from './workspaceNavigatorModel'

describe('workspace navigator width', () => {
  it('uses the original 250px default and clamps between 200px and 60% of the workbench', () => {
    expect(parseWorkspaceNavigatorWidth(null, 900)).toBe(250)
    expect(clampWorkspaceNavigatorWidth(120, 900)).toBe(200)
    expect(clampWorkspaceNavigatorWidth(800, 900)).toBe(540)
    expect(workspaceNavigatorMaximumWidth(320)).toBe(200)
    expect(workspaceNavigatorMaximumWidth(0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('persists only the clamped width and tolerates unavailable storage', () => {
    const storage = { getItem: vi.fn(() => '420'), setItem: vi.fn() }
    expect(readWorkspaceNavigatorWidth(storage, 600)).toBe(360)
    expect(persistWorkspaceNavigatorWidth(storage, 450, 600)).toBe(360)
    expect(storage.setItem).toHaveBeenCalledWith(WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY, '360')

    const unavailable = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') }
    }
    expect(readWorkspaceNavigatorWidth(unavailable, 900)).toBe(250)
    expect(persistWorkspaceNavigatorWidth(unavailable, 300, 900)).toBe(300)
  })
})

describe('workspace navigator sections', () => {
  it('defaults both original file-tree sections open', () => {
    expect(parseWorkspaceNavigatorSections(null)).toEqual(DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS)
    expect(parseWorkspaceNavigatorSections('{broken')).toEqual(DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS)
  })

  it('restores and persists each disclosure independently', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ changedFilesExpanded: true, allFilesExpanded: false })),
      setItem: vi.fn()
    }
    expect(readWorkspaceNavigatorSections(storage)).toEqual({
      changedFilesExpanded: true,
      allFilesExpanded: false,
      collapsedChangedPaths: []
    })
    expect(persistWorkspaceNavigatorSections(storage, {
      changedFilesExpanded: false,
      allFilesExpanded: true,
      collapsedChangedPaths: ['src/generated', 'src/generated']
    })).toEqual({
      changedFilesExpanded: false,
      allFilesExpanded: true,
      collapsedChangedPaths: ['src/generated']
    })
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_NAVIGATOR_SECTIONS_STORAGE_KEY,
      JSON.stringify({
        changedFilesExpanded: false,
        allFilesExpanded: true,
        collapsedChangedPaths: ['src/generated']
      })
    )
  })
})

describe('workspace navigator changed-file hierarchy', () => {
  it('groups changed files by path and keeps directories before files', () => {
    const changes = [
      { id: 'readme', path: '/project/README.md', additions: 1, deletions: 0 },
      { id: 'button', path: '/project/src/components/Button.tsx', additions: 4, deletions: 2 },
      { id: 'app', path: '/project/src/App.tsx', additions: 3, deletions: 1 }
    ]
    expect(buildWorkspaceNavigatorChangedTree('/project', changes)).toEqual([
      {
        kind: 'directory', id: 'directory:src', path: 'src', name: 'src', children: [
          {
            kind: 'directory', id: 'directory:src/components', path: 'src/components', name: 'components', children: [
              { kind: 'file', id: 'button', path: 'src/components/Button.tsx', name: 'Button.tsx', change: changes[1] }
            ]
          },
          { kind: 'file', id: 'app', path: 'src/App.tsx', name: 'App.tsx', change: changes[2] }
        ]
      },
      { kind: 'file', id: 'readme', path: 'README.md', name: 'README.md', change: changes[0] }
    ])
  })

  it('filters files by their full relative path while preserving ancestors', () => {
    const changes = [
      { id: 'button', path: '/project/src/components/Button.tsx', additions: 1, deletions: 0 },
      { id: 'readme', path: '/project/README.md', additions: 1, deletions: 0 }
    ]
    const tree = buildWorkspaceNavigatorChangedTree('/project', changes, 'components')
    expect(tree).toHaveLength(1)
    expect(tree[0]?.kind).toBe('directory')
    expect(tree[0]?.path).toBe('src')
  })
})

describe('workspace navigator recursive search', () => {
  const directory = (fileName: string, path: string) => ({
    fileName, path, isDirectory: true, isFile: false
  })
  const file = (fileName: string, path: string) => ({
    fileName, path, isDirectory: false, isFile: true
  })
  const directories = {
    '/project': { status: 'ready' as const, entries: [
      directory('src', '/project/src'),
      directory('node_modules', '/project/node_modules'),
      file('README.md', '/project/README.md')
    ] },
    '/project/src': { status: 'ready' as const, entries: [
      directory('components', '/project/src/components'),
      file('main.ts', '/project/src/main.ts')
    ] },
    '/project/src/components': { status: 'ready' as const, entries: [
      file('Button.tsx', '/project/src/components/Button.tsx')
    ] },
    '/project/node_modules': { status: 'ready' as const, entries: [
      file('button-internal.js', '/project/node_modules/button-internal.js')
    ] }
  }

  it('keeps every ancestor needed to reveal a deep match', () => {
    expect([...collectWorkspaceNavigatorSearchPaths('/project', directories, 'button')]).toEqual([
      '/project/src/components/Button.tsx',
      '/project',
      '/project/src',
      '/project/src/components'
    ])
  })

  it('does not descend into node_modules or other generated trees', () => {
    const matches = collectWorkspaceNavigatorSearchPaths('/project', directories, 'internal')
    expect(matches.has('/project/node_modules/button-internal.js')).toBe(false)
    expect(matches.has('/project/node_modules')).toBe(false)

    const directoryMatch = collectWorkspaceNavigatorSearchPaths('/project', directories, 'node_modules')
    expect(directoryMatch.has('/project/node_modules')).toBe(true)
    expect(directoryMatch.has('/project/node_modules/button-internal.js')).toBe(false)
  })
})

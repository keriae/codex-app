import { describe, expect, it } from 'vitest'
import { workspaceBreadcrumbCollapseCount, workspaceBreadcrumbSegments, workspaceBreadcrumbTreeAction } from './workspaceBreadcrumbModel'

describe('workspace breadcrumb navigation', () => {
  it('opens the clicked ancestor in its containing directory, and the filename among its siblings', () => {
    expect(workspaceBreadcrumbSegments('/project', '/project/src/ui/App.tsx')).toEqual([
      { label: 'project', path: '/project', directoryPath: '/project', activePath: null, expandActivePath: false },
      { label: 'src', path: '/project/src', directoryPath: '/project', activePath: '/project/src', expandActivePath: true },
      { label: 'ui', path: '/project/src/ui', directoryPath: '/project/src', activePath: '/project/src/ui', expandActivePath: true },
      { label: 'App.tsx', path: '/project/src/ui/App.tsx', directoryPath: '/project/src/ui', activePath: '/project/src/ui/App.tsx', expandActivePath: false }
    ])
  })
  it('handles relative paths, trailing root separators and the macOS filesystem root', () => {
    expect(workspaceBreadcrumbSegments('/project/', 'src/file.ts').at(-1)?.path).toBe('/project/src/file.ts')
    expect(workspaceBreadcrumbSegments('/', '/Users/file.ts').map((part) => [part.label, part.directoryPath])).toEqual([['/', '/'], ['Users', '/'], ['file.ts', '/Users']])
    expect(workspaceBreadcrumbSegments('/project', null)).toHaveLength(1)
  })
  it('keeps external files readable without navigating outside the workspace root', () => {
    const segments = workspaceBreadcrumbSegments('/project', '/project-other/private/file.txt')
    expect(segments.map((part) => part.label)).toEqual(['project-other', 'private', 'file.txt'])
    expect(segments.every((part) => part.directoryPath === null)).toBe(true)
  })
})

describe('responsive breadcrumb collapse', () => {
  it('removes ancestors from left to right before truncating the filename', () => {
    const widths = [90, 30, 70, 100]
    expect(workspaceBreadcrumbCollapseCount(widths, 302)).toBe(0)
    expect(workspaceBreadcrumbCollapseCount(widths, 300)).toBe(1)
    expect(workspaceBreadcrumbCollapseCount(widths, 200)).toBe(2)
    expect(workspaceBreadcrumbCollapseCount(widths, 110)).toBe(3)
    expect(workspaceBreadcrumbCollapseCount(widths, 0)).toBe(3)
    expect(workspaceBreadcrumbCollapseCount([100], 0)).toBe(0)
    expect(workspaceBreadcrumbCollapseCount([], 0)).toBe(0)
  })
})

describe('breadcrumb tree keyboard navigation', () => {
  const items = [
    { path: '/project/src', parentPath: null, isDirectory: true, expanded: true },
    { path: '/project/src/ui', parentPath: '/project/src', isDirectory: true, expanded: false },
    { path: '/project/src/file.ts', parentPath: '/project/src', isDirectory: false, expanded: false },
    { path: '/project/README.md', parentPath: null, isDirectory: false, expanded: false }
  ]
  it('moves through visible children and returns to parents', () => {
    expect(workspaceBreadcrumbTreeAction(items, '/project/src', 'ArrowRight')).toEqual({ type: 'focus', path: '/project/src/ui' })
    expect(workspaceBreadcrumbTreeAction(items, '/project/src/file.ts', 'ArrowLeft')).toEqual({ type: 'focus', path: '/project/src' })
    expect(workspaceBreadcrumbTreeAction(items, '/project/src/file.ts', 'ArrowDown')).toEqual({ type: 'focus', path: '/project/README.md' })
    expect(workspaceBreadcrumbTreeAction(items, '/project/src', 'End')).toEqual({ type: 'focus', path: '/project/README.md' })
  })
  it('expands or collapses directories, activates files and leaves boundary keys to the browser', () => {
    expect(workspaceBreadcrumbTreeAction(items, '/project/src/ui', 'Enter')).toEqual({ type: 'expand', path: '/project/src/ui' })
    expect(workspaceBreadcrumbTreeAction(items, '/project/src', 'ArrowLeft')).toEqual({ type: 'collapse', path: '/project/src' })
    expect(workspaceBreadcrumbTreeAction(items, '/project/src/file.ts', ' ')).toEqual({ type: 'select', path: '/project/src/file.ts' })
    expect(workspaceBreadcrumbTreeAction(items, '/project/src', 'ArrowUp')).toBeNull()
    expect(workspaceBreadcrumbTreeAction(items, '/project/README.md', 'ArrowDown')).toBeNull()
    expect(workspaceBreadcrumbTreeAction(items, '/project/src', 'Escape')).toBeNull()
  })
})

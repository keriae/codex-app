import { describe, expect, it } from 'vitest'
import type { ProjectListEntry } from './discoveryPages'
import { normalizeProjectEdit, nextProjectMenuIndex, orderProjectPanelEntries, parseProjectPanelSort, visibleProjectPanelPaths } from './projectPanelState'

const entries: ProjectListEntry[] = [
  { path: '/work/zeta', name: 'zeta', updatedAt: 20, current: false, threadCount: 1 },
  { path: '/work/alpha', name: 'alpha', updatedAt: 40, current: true, threadCount: 2 },
  { path: '/work/new', name: 'new', updatedAt: null, current: false, threadCount: 0 }
]

describe('project panel sorting and edits', () => {
  it('sorts by original modified/name directions while using custom display names', () => {
    expect(orderProjectPanelEntries(entries, { key: 'modified', direction: 'descending' }).map((entry) => entry.path)).toEqual(['/work/alpha', '/work/zeta', '/work/new'])
    expect(orderProjectPanelEntries(entries, { key: 'modified', direction: 'ascending' }).map((entry) => entry.path)).toEqual(['/work/new', '/work/zeta', '/work/alpha'])
    const renamed = orderProjectPanelEntries(entries, { key: 'name', direction: 'ascending' }, { '/work/zeta': '  Aardvark  ' })
    expect(renamed.map((entry) => entry.name)).toEqual(['Aardvark', 'alpha', 'new'])
    expect(entries[0].name).toBe('zeta')
  })

  it('validates stored sorting instead of accepting corrupted controls', () => {
    expect(parseProjectPanelSort('{')).toEqual({ key: 'modified', direction: 'descending' })
    expect(parseProjectPanelSort('{"key":"path","direction":"up"}')).toEqual({ key: 'modified', direction: 'descending' })
    expect(parseProjectPanelSort('{"key":"name","direction":"ascending"}')).toEqual({ key: 'name', direction: 'ascending' })
  })

  it('hides removed normalized paths including the current cwd when it remains in the catalog', () => {
    expect(visibleProjectPanelPaths(['/work/alpha/', '/work/zeta', '/work/alpha', 'relative'], ['/work/alpha'])).toEqual(['/work/zeta'])
  })

  it('validates names and local roots without mutating directories', () => {
    expect(normalizeProjectEdit('  Codex  ', '/work/codex///')).toEqual({ name: 'Codex', path: '/work/codex' })
    expect(() => normalizeProjectEdit('', '/work')).toThrow()
    expect(() => normalizeProjectEdit('x'.repeat(201), '/work')).toThrow()
    expect(() => normalizeProjectEdit('Codex', 'relative')).toThrow()
    expect(() => normalizeProjectEdit('Codex', '/bad\0path')).toThrow()
  })

  it('keeps keyboard navigation on enabled actions with wrapping and endpoints', () => {
    expect(nextProjectMenuIndex([false, true, false], 0, 'ArrowDown')).toBe(2)
    expect(nextProjectMenuIndex([false, true, false], 0, 'ArrowUp')).toBe(2)
    expect(nextProjectMenuIndex([false, true, false], 2, 'Home')).toBe(0)
    expect(nextProjectMenuIndex([false, true, false], 0, 'End')).toBe(2)
    expect(nextProjectMenuIndex([true, true], 0, 'ArrowDown')).toBe(-1)
  })
})

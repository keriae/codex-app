import { describe, expect, it } from 'vitest'
import type { Project } from './protocol'
import { editProjectPreference, migrateProjectPinnedPaths, overlayProjectPreferences, parseProjectPreferences } from './projectPreferences'

describe('project preference migration', () => {
  it('migrates the name and keeps the former server root hidden across reloads', () => {
    const before = { names: { '/work/old': 'Old', '/work/other': 'Other' }, hiddenPaths: ['/work/removed', '/work/new'] }
    const edited = editProjectPreference(before, '/work/old/', '/work/new/', '  Renamed  ')
    expect(edited).toEqual({ names: { '/work/other': 'Other', '/work/new': 'Renamed' }, hiddenPaths: ['/work/removed', '/work/old'] })
    expect(parseProjectPreferences(JSON.stringify(edited))).toEqual(edited)
    expect(before.names['/work/old']).toBe('Old')
    const again = editProjectPreference(edited, '/work/new', '/work/final', 'Final')
    expect(again.hiddenPaths).toEqual(['/work/removed', '/work/old', '/work/new'])
  })

  it('renames in place while preserving unrelated removals and un-hiding that root only', () => {
    const edited = editProjectPreference({ names: {}, hiddenPaths: ['/work/root', '/work/removed'] }, '/work/root/', '/work/root', 'Title')
    expect(edited).toEqual({ names: { '/work/root': 'Title' }, hiddenPaths: ['/work/removed'] })
    expect(() => editProjectPreference(edited, 'relative', '/work/new', 'Title')).toThrow()
    expect(() => editProjectPreference(edited, '/work/root', '/work/new', 'bad\0name')).toThrow()
  })

  it('overlays normalized roots without resurrecting hidden catalog entries', () => {
    const project = { id: 'server-project', name: 'Server', roots: [{ path: '/work/old/' }, { path: '/work/new/' }], metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null } satisfies Project
    const preferences = { names: { '/work/new': 'New title' }, hiddenPaths: ['/work/old'] }
    const overlaid = overlayProjectPreferences([project], preferences)
    expect(overlaid[0].roots).toEqual([{ path: '/work/new' }])
    expect(overlaid[0].name).toBe('New title')
    expect(project.roots).toHaveLength(2)
    expect(overlayProjectPreferences([project], { names: {}, hiddenPaths: ['/work/old', '/work/new'] })).toEqual([])
  })

  it('normalizes older path spellings while ignoring corrupt records', () => {
    expect(parseProjectPreferences(JSON.stringify({ names: { '/work/root/': ' Name ', relative: 'Bad', '/work/bad': 7 }, hiddenPaths: ['/work/removed/', '/work/removed', 'relative'] }))).toEqual({ names: { '/work/root': 'Name' }, hiddenPaths: ['/work/removed'] })
    expect(parseProjectPreferences('[')).toEqual({ names: {}, hiddenPaths: [] })
  })

  it('migrates legacy server ID and saved-path pins without unpinning an already pinned destination', () => {
    expect(migrateProjectPinnedPaths(['other', 'server-id'], '/work/old', '/work/new', ['server-id'])).toEqual(['other', '/work/new'])
    expect(migrateProjectPinnedPaths(['/work/new', 'server-id'], '/work/old', '/work/new', ['server-id'])).toEqual(['/work/new'])
    expect(migrateProjectPinnedPaths(['saved-path:%2Fwork%2Fold'], '/work/old', '/work/new')).toEqual(['/work/new'])
    expect(migrateProjectPinnedPaths(['/work/old/'], '/work/old', '/work/new')).toEqual(['/work/new'])
    expect(migrateProjectPinnedPaths(['other'], '/work/old', '/work/new')).toEqual(['other'])
  })
})

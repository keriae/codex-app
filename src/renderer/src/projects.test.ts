import { describe, expect, it } from 'vitest'
import type { Project } from './protocol'
import {
  addSavedProjectPath,
  deriveProjectPaths,
  normalizeProjectPath,
  parseSavedProjectPaths,
  projectCatalogForSavedPaths,
  projectCatalogWithSavedPaths,
  removeSavedProjectPath,
  restoreSavedProjectPath
} from './projects'

function project(id: string, name: string, roots: string[], position = 0): Project {
  return {
    id,
    name,
    roots: roots.map((path) => ({ path })),
    metadata: {},
    position,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null
  }
}

describe('project path catalog', () => {
  it('normalizes and deduplicates only explicitly registered project folders', () => {
    expect(
      deriveProjectPaths(
        [project('current', 'Current', ['/workspace/current/', '/workspace/beta/'])],
        ['/workspace/beta', '/workspace/saved']
      )
    ).toEqual([
      '/workspace/current',
      '/workspace/beta',
      '/workspace/saved'
    ])
  })

  it('uses only explicit server projects and saved paths', () => {
    expect(deriveProjectPaths([], [])).toEqual([])
  })

  it('keeps server project identity and adds uncovered saved paths as compatibility projects', () => {
    const serverProject = project('project-id', 'Named project', ['/workspace/one'])
    const catalog = projectCatalogWithSavedPaths(
      [serverProject],
      ['/workspace/one/', '/workspace/two']
    )

    expect(catalog[0]).toEqual(serverProject)
    expect(catalog[1]).toMatchObject({
      id: 'saved-path:%2Fworkspace%2Ftwo',
      name: 'two',
      roots: [{ path: '/workspace/two' }]
    })
  })

  it('does not expose shared app-server projects when no folders are saved', () => {
    expect(
      projectCatalogForSavedPaths(
        [project('shared-one', 'Shared one', ['/workspace/shared-one'])],
        []
      )
    ).toEqual([])
  })

  it('keeps matching server identity without adopting unrelated projects', () => {
    const visible = project('visible-id', 'Visible project', ['/workspace/visible'])
    const shared = project('shared-id', 'Shared project', ['/workspace/shared'])

    expect(projectCatalogForSavedPaths([shared, visible], ['/workspace/visible/'])).toEqual([
      visible
    ])
  })

  it('follows saved path order, deduplicates server projects, and synthesizes unmatched paths', () => {
    const multiRoot = project(
      'multi-root-id',
      'Multi root',
      ['/workspace/one', '/workspace/two', '/workspace/not-saved']
    )
    const catalog = projectCatalogForSavedPaths(
      [multiRoot],
      ['/workspace/two', '/workspace/missing/', '/workspace/one', '/workspace/two/']
    )

    expect(catalog).toHaveLength(2)
    expect(catalog[0]).toMatchObject({
      id: 'multi-root-id',
      roots: [{ path: '/workspace/two' }, { path: '/workspace/one' }]
    })
    expect(catalog[1]).toMatchObject({
      id: 'saved-path:%2Fworkspace%2Fmissing',
      name: 'missing',
      roots: [{ path: '/workspace/missing' }]
    })
  })

  it('parses persisted paths defensively', () => {
    expect(
      parseSavedProjectPaths(
        JSON.stringify(['/workspace/one/', 42, 'relative/path', '/workspace/one'])
      )
    ).toEqual(['/workspace/one'])
    expect(parseSavedProjectPaths('{bad json')).toEqual([])
  })

  it('puts a newly selected folder first without duplicates', () => {
    expect(
      addSavedProjectPath(['/workspace/one', '/workspace/two'], '/workspace/two/')
    ).toEqual(['/workspace/two', '/workspace/one'])
  })

  it('removes and restores a folder at its previous project-order position', () => {
    const removed = removeSavedProjectPath(
      ['/workspace/one', '/workspace/two/', '/workspace/three'],
      '/workspace/two'
    )
    expect(removed).toEqual({
      paths: ['/workspace/one', '/workspace/three'],
      index: 1
    })
    expect(
      restoreSavedProjectPath(removed.paths, '/workspace/two/', removed.index)
    ).toEqual(['/workspace/one', '/workspace/two', '/workspace/three'])
  })

  it('restores defensively when the old position is unavailable', () => {
    expect(restoreSavedProjectPath(['/workspace/one'], '/workspace/two', 99)).toEqual([
      '/workspace/one',
      '/workspace/two'
    ])
    expect(removeSavedProjectPath(['/workspace/one'], 'relative')).toEqual({
      paths: ['/workspace/one'],
      index: -1
    })
  })

  it('rejects relative and NUL-containing paths', () => {
    expect(normalizeProjectPath('relative/repo')).toBeNull()
    expect(normalizeProjectPath('/workspace/\0repo')).toBeNull()
  })
})

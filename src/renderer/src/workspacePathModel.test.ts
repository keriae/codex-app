import { describe, expect, it } from 'vitest'
import { isAllowedWorkspacePathRequest } from '../../main/ipcSecurity'
import { workspaceBreadcrumbSegments } from './workspaceBreadcrumbModel'
import { workspaceBreadcrumbs, workspaceRelativePath } from './workspaceFileModel'
import { buildWorkspaceNavigatorChangedTree, workspaceNavigatorRevealDirectories } from './workspaceNavigatorModel'
import { resolveWorkspaceFileLink } from './workspaceFileLinks'
import { workspacePathComparisonKey } from './workspacePathModel'

describe('macOS workspace system path aliases', () => {
  it.each(['var', 'tmp', 'etc'])('rebases both spellings of /%s to the active root for native requests', (directory) => {
    const alias = `/${directory}/codex-fixture`
    const canonical = `/private${alias}`
    for (const [root, source] of [[alias, canonical], [canonical, alias]]) {
      expect(resolveWorkspaceFileLink(root, source)).toBe(root)
      const path = resolveWorkspaceFileLink(`${root}/`, `${source}/lib/deep/buttons.ts`)!
      expect(path).toBe(`${root}/lib/deep/buttons.ts`)
      expect(isAllowedWorkspacePathRequest({ root, path })).toBe(true)
      expect(workspaceRelativePath(root, `${source}/lib/deep/buttons.ts`)).toBe('lib/deep/buttons.ts')
      expect(workspacePathComparisonKey(root)).toBe(workspacePathComparisonKey(source))
    }
  })

  it('retains the traversal and directory boundary checks after alias comparison', () => {
    const root = '/var/codex-fixture'
    for (const path of [
      '/private/var/codex-fixture-other/file.ts',
      '/private/var/codex-fixture/../other/file.ts',
      '../other/file.ts',
      '/private/tmp/codex-fixture/file.ts',
      '/private/various/codex-fixture/file.ts',
      '/Users/private/var/codex-fixture/file.ts',
      '/private/private/var/codex-fixture/file.ts',
      '/VAR/codex-fixture/file.ts',
      '/private/var/codex-fixture/file\0.ts'
    ]) expect(resolveWorkspaceFileLink(root, path)).toBeNull()
    expect(resolveWorkspaceFileLink(root, './lib/../buttons.ts')).toBe(`${root}/buttons.ts`)
    expect(resolveWorkspaceFileLink('/', '/private/tmp/file.ts')).toBe('/private/tmp/file.ts')
    expect(workspacePathComparisonKey('/Users/var/project')).toBe('/Users/var/project')
  })

  it('builds workspace-relative breadcrumbs and changed trees from resumed canonical paths', () => {
    const root = '/var/folders/test/T/codex-fixture'
    const path = `/private${root}/lib/deep/buttons.ts`
    expect(workspaceBreadcrumbs(root, path)).toEqual(['codex-fixture', 'lib', 'deep', 'buttons.ts'])
    expect(workspaceBreadcrumbSegments(root, path).map((segment) => [segment.label, segment.path])).toEqual([
      ['codex-fixture', root], ['lib', `${root}/lib`], ['deep', `${root}/lib/deep`], ['buttons.ts', `${root}/lib/deep/buttons.ts`]
    ])
    expect(workspaceNavigatorRevealDirectories(root, path)).toEqual([root, `${root}/lib`, `${root}/lib/deep`])
    expect(workspaceNavigatorRevealDirectories(root, `/private${root}/lib/../buttons.ts`)).toEqual([])
    expect(workspaceNavigatorRevealDirectories(root, `/private${root}-other/buttons.ts`)).toEqual([])
    const tree = buildWorkspaceNavigatorChangedTree(root, [{ id: 'change', path, additions: 1, deletions: 1 }])
    expect(tree[0]).toMatchObject({ kind: 'directory', path: 'lib', children: [
      { kind: 'directory', path: 'lib/deep', children: [{ kind: 'file', path: 'lib/deep/buttons.ts' }] }
    ] })
    expect(workspaceRelativePath(root, `/private${root}-other/file.ts`)).toBe(`/private${root}-other/file.ts`)
  })
})

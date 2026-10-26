import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceRootGrants } from './workspaceRootGrants'

describe('main-owned persistent workspace root grants', () => {
  it('persists native selections privately and refuses unnormalized paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-root-grants-test-'))
    try {
      const grants = new WorkspaceRootGrants(directory)
      grants.grant('/synthetic/selected-project')
      expect(new WorkspaceRootGrants(directory).allows({ root: '/synthetic/selected-project', path: '/synthetic/selected-project' })).toBe(true)
      expect(statSync(join(directory, 'workspace-root-grants.json')).mode & 0o777).toBe(0o600)
      expect(() => grants.grant('/synthetic/selected-project/../other')).toThrow()
      expect(() => grants.grant('relative')).toThrow()
      expect(grants.allows({ root: '/synthetic/other', path: '/synthetic/other' })).toBe(false)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('grants only real local directories in recognized trusted thread result shapes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-thread-root-grants-test-'))
    try {
      const root = join(directory, 'project')
      const other = join(directory, 'other')
      await mkdir(root)
      await mkdir(other)
      await writeFile(join(directory, 'plain-file'), 'text')
      const grants = new WorkspaceRootGrants()
      await grants.rememberThreadResult('account/read', { thread: { id: 'one', cwd: root } })
      await grants.rememberThreadResult('thread/read', { unrelated: { thread: { id: 'one', cwd: root } } })
      expect(grants.allows({ root, path: root })).toBe(false)
      await grants.rememberThreadResult('thread/read', { thread: { id: 'one', cwd: root } })
      expect(grants.allows({ root, path: root })).toBe(true)
      const canonical = await realpath(root)
      expect(grants.allows({ root: canonical, path: canonical })).toBe(true)
      await grants.rememberThreadResult('thread/list', { data: [
        { id: 'two', cwd: other }, { cwd: '/not-a-thread' },
        { id: 'missing', cwd: join(directory, 'not-existing') }, { id: 'file', cwd: join(directory, 'plain-file') }
      ] })
      expect(grants.allows({ root: other, path: other })).toBe(true)
      expect(grants.allows({ root: '/not-a-thread', path: '/not-a-thread' })).toBe(false)
      expect(grants.allows({ root: join(directory, 'plain-file'), path: join(directory, 'plain-file') })).toBe(false)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('ignores malformed persisted grants and filters invalid directory entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-invalid-root-grants-test-'))
    try {
      const filePath = join(directory, 'workspace-root-grants.json')
      writeFileSync(filePath, JSON.stringify({ version: 2, roots: ['/synthetic/invalid-version'] }))
      expect(new WorkspaceRootGrants(directory).allows({ root: '/synthetic/invalid-version', path: '/synthetic/invalid-version' })).toBe(false)
      writeFileSync(filePath, JSON.stringify({ version: 1, roots: ['/synthetic/project', 'relative', '/bad/../path'] }))
      const grants = new WorkspaceRootGrants(directory)
      expect(grants.allows({ root: '/synthetic/project', path: '/synthetic/project' })).toBe(true)
      expect(grants.allows({ root: '/path', path: '/path' })).toBe(false)
      grants.grant('/synthetic/new')
      expect(JSON.parse(readFileSync(filePath, 'utf8')).roots).toEqual(['/synthetic/project', '/synthetic/new'])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('grants only existing explicit roots of server-identified projects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-project-root-grants-test-'))
    try {
      const root = join(directory, 'project')
      const other = join(directory, 'other')
      const plainFile = join(directory, 'file')
      await mkdir(root)
      await mkdir(other)
      await writeFile(plainFile, 'plain file')
      const grants = new WorkspaceRootGrants()
      for (const [method, result] of [
        ['account/read', { project: { id: 'one', roots: [{ path: root }] } }],
        ['project/read', { unrelated: { project: { id: 'one', roots: [{ path: root }] } } }],
        ['project/read', { project: { roots: [{ path: root }] } }],
        ['project/read', { project: { id: 'one', rootPath: root, metadata: { path: root } } }],
        ['project/read', { project: { id: 'one', roots: [{ nested: { path: root } }] } }]
      ] as const) await grants.rememberProjectResult(method, result)
      expect(grants.allows({ root, path: root })).toBe(false)
      await grants.rememberProjectResult('project/read', { project: { id: 'one', roots: [{ path: root }] } })
      expect(grants.allows({ root, path: root })).toBe(true)
      const canonical = await realpath(root)
      expect(grants.allows({ root: canonical, path: canonical })).toBe(true)
      await grants.rememberProjectResult('project/list', { data: [
        { id: 'two', roots: [{ path: other }, { path: plainFile }, { path: join(directory, 'missing') }, { path: `${root}/../other` }] },
        { id: '', roots: [{ path: '/not-a-project' }] }
      ] })
      expect(grants.allows({ root: other, path: other })).toBe(true)
      expect(grants.allows({ root: plainFile, path: plainFile })).toBe(false)
      expect(grants.allows({ root: '/not-a-project', path: '/not-a-project' })).toBe(false)
      const createdGrants = new WorkspaceRootGrants()
      await createdGrants.rememberProjectResult('project/create', { project: { id: 'new', roots: [{ path: root }] } })
      expect(createdGrants.allows({ root, path: root })).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

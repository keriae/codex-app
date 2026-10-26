import { execFile } from 'node:child_process'
import { lstat, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ManagedWorktrees, validateWorktreeCreateOptions } from './managedWorktrees'

const execFileAsync = promisify(execFile)
let directory: string
let repo: string
let profile: string
let initialHead: string

async function git(...args: string[]): Promise<string> {
  const result = await execFileAsync('/usr/bin/git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
  })
  return result.stdout.trim()
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'codex-managed-worktrees-test-')))
  repo = join(directory, 'sample-repository')
  profile = join(directory, 'replica-profile')
  await execFileAsync('/usr/bin/git', ['init', '-b', 'main', repo])
  await execFileAsync('/bin/mkdir', ['-p', join(repo, 'packages', 'nested')])
  await writeFile(join(repo, 'file.txt'), 'initial\n')
  await writeFile(join(repo, 'packages', 'nested', 'tracked.txt'), 'nested\n')
  await git('add', '.')
  await git('-c', 'user.name=Replica Test', '-c', 'user.email=replica-test@example.invalid', 'commit', '-m', 'Initial')
  initialHead = await git('rev-parse', 'HEAD')
})

afterEach(async () => {
  // Every repository and its Git administrative files are inside this temporary fixture.
  await rm(directory, { recursive: true, force: true })
})

describe('worktree request validation', () => {
  it('accepts branch refs and source paths with spaces without converting them to command arguments', () => {
    expect(validateWorktreeCreateOptions({ cwd: '/workspace/repository with spaces', name: 'new-task', startingState: { type: 'branch', branchName: 'refs/remotes/origin/main' } })).toEqual({
      cwd: '/workspace/repository with spaces', name: 'new-task', startingState: { type: 'branch', branchName: 'refs/remotes/origin/main' }
    })
    expect(validateWorktreeCreateOptions({
      cwd: '/workspace/repository with spaces',
      startingState: { type: 'working-tree' }
    })).toEqual({
      cwd: '/workspace/repository with spaces',
      startingState: { type: 'working-tree' }
    })
  })

  it('rejects output-path overrides, malformed names and option-like refs', () => {
    for (const options of [
      { cwd: repo, output: '/tmp/renderer-chosen' }, { cwd: 'relative' }, { cwd: `${repo}/../other` },
      ...['CON', 'com1', 'deadbeef', 'a--b', 'Upper', '../outside', '-leading', 'x'.repeat(65), ''].map((name) => ({ cwd: repo, name })),
      { cwd: repo, startingState: { type: 'working-tree', branchName: 'HEAD' } },
      { cwd: repo, startingState: { type: 'branch', branchName: '--help' } },
      { cwd: repo, startingState: { type: 'branch', branchName: 'HEAD\n', remoteRef: 'origin/main' } }
    ]) expect(() => validateWorktreeCreateOptions(options)).toThrow()
  })
})

describe('isolated Git worktree creation', () => {
  it('uses the cached remote default branch in detached mode and preserves source dirty state', async () => {
    await git('remote', 'add', 'origin', join(directory, 'offline-remote'))
    await git('update-ref', 'refs/remotes/origin/main', initialHead)
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    await writeFile(join(repo, 'file.txt'), 'source advanced\n')
    await git('add', 'file.txt')
    await git('-c', 'user.name=Replica Test', '-c', 'user.email=replica-test@example.invalid', 'commit', '-m', 'Advanced local branch')
    await writeFile(join(repo, 'file.txt'), 'uncommitted source\n')
    await writeFile(join(repo, 'untracked.txt'), 'source only\n')
    const before = await git('status', '--porcelain=v1')
    const branches = await git('for-each-ref', 'refs/heads', '--format=%(refname)')
    const manager = new ManagedWorktrees(profile)
    const created = await manager.create({ cwd: repo, name: 'isolated-task' })
    expect(created).toMatchObject({ head: initialHead, branch: null, detached: true, ownerThreadId: null, setupError: null })
    expect(created.worktreeGitRoot).toBe(join(profile, 'worktrees', 'isolated-task', 'sample-repository'))
    expect(await readFile(join(created.worktreeGitRoot, 'file.txt'), 'utf8')).toBe('initial\n')
    expect(await stat(join(created.worktreeGitRoot, 'untracked.txt')).catch(() => null)).toBeNull()
    expect(await git('status', '--porcelain=v1')).toBe(before)
    expect(await git('for-each-ref', 'refs/heads', '--format=%(refname)')).toBe(branches)
    expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(2)
  })

  it('requires an explicit ref without a cached remote default and never guesses the current branch', async () => {
    const manager = new ManagedWorktrees(profile)
    await expect(manager.create({ cwd: repo })).rejects.toThrow('Could not determine the remote default branch')
    expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1)
    const created = await manager.create({ cwd: repo, startingState: { type: 'branch', branchName: 'HEAD' } })
    expect(created.head).toBe(initialHead)
    expect(created.detached).toBe(true)
    expect(dirname(created.worktreeGitRoot)).toMatch(/\/[0-9a-f]{4}$/)
  })

  it('copies tracked and untracked source changes for a working-tree start without mutating the source', async () => {
    await writeFile(join(repo, 'file.txt'), 'unstaged source\n')
    await writeFile(join(repo, 'packages', 'nested', 'tracked.txt'), 'staged source\n')
    await git('add', 'packages/nested/tracked.txt')
    await writeFile(join(repo, 'untracked.txt'), 'untracked source\n')
    await symlink('file.txt', join(repo, 'untracked-link'))
    const before = await git('status', '--porcelain=v1')

    const created = await new ManagedWorktrees(profile).create({
      cwd: repo,
      name: 'working-copy',
      startingState: { type: 'working-tree' }
    })

    expect(await readFile(join(created.worktreeGitRoot, 'file.txt'), 'utf8')).toBe('unstaged source\n')
    expect(await readFile(join(created.worktreeGitRoot, 'packages', 'nested', 'tracked.txt'), 'utf8')).toBe('staged source\n')
    expect(await readFile(join(created.worktreeGitRoot, 'untracked.txt'), 'utf8')).toBe('untracked source\n')
    expect((await lstat(join(created.worktreeGitRoot, 'untracked-link'))).isSymbolicLink()).toBe(true)
    expect(await git('status', '--porcelain=v1')).toBe(before)
  })

  it('preserves a nested project cwd and persists its managed identity', async () => {
    const cwd = join(repo, 'packages', 'nested')
    const created = await new ManagedWorktrees(profile).create({ cwd, name: 'nested-project', startingState: { type: 'branch', branchName: 'main' } })
    expect(created.worktreeWorkspaceRoot).toBe(join(created.worktreeGitRoot, 'packages', 'nested'))
    expect(await readFile(join(created.worktreeWorkspaceRoot, 'tracked.txt'), 'utf8')).toBe('nested\n')
    expect(await new ManagedWorktrees(profile).list(cwd)).toEqual([created])
    expect((await stat(join(profile, 'managed-worktrees.json'))).mode & 0o777).toBe(0o600)
  })

  it('atomically reserves duplicate names and preserves the first checkout', async () => {
    const manager = new ManagedWorktrees(profile)
    const options = { cwd: repo, name: 'same-name', startingState: { type: 'branch' as const, branchName: 'HEAD' } }
    const first = await manager.create(options)
    const second = await manager.create(options)
    expect(second.worktreeGitRoot).toMatch(/\/same-name-\d{4}\/sample-repository$/)
    expect(first.worktreeGitRoot).not.toBe(second.worktreeGitRoot)
    expect(await readFile(join(first.worktreeGitRoot, 'file.txt'), 'utf8')).toBe('initial\n')
    expect(await manager.list(repo)).toHaveLength(2)
  })

  it('keeps a valid 64-character name on its first allocation', async () => {
    const name = 'q'.repeat(64)
    const created = await new ManagedWorktrees(profile).create({ cwd: repo, name, startingState: { type: 'branch', branchName: 'HEAD' } })
    expect(dirname(created.worktreeGitRoot)).toBe(join(profile, 'worktrees', name))
  })

  it('does not submit Git mutation after its opening document becomes stale', async () => {
    const manager = new ManagedWorktrees(profile)
    let calls = 0
    await expect(manager.create({ cwd: repo, name: 'cancelled', startingState: { type: 'branch', branchName: 'HEAD' } }, () => {
      calls += 1
      if (calls === 2) throw new Error('Document expired')
    })).rejects.toThrow('Document expired')
    expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1)
    expect(await readdir(manager.worktreesRoot)).toEqual([])
  })

  it('removes a newly allocated checkout when its owner expires immediately after creation', async () => {
    const manager = new ManagedWorktrees(profile)
    let calls = 0
    await expect(manager.create({
      cwd: repo,
      name: 'expired-after-checkout',
      startingState: { type: 'working-tree' }
    }, () => {
      calls += 1
      if (calls === 3) throw new Error('Document expired after checkout')
    })).rejects.toThrow('Document expired after checkout')
    expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1)
    expect(await stat(join(manager.worktreesRoot, 'expired-after-checkout')).catch(() => null)).toBeNull()
  })

  it('discards only an exact managed checkout identity before it acquires a server owner', async () => {
    const manager = new ManagedWorktrees(profile)
    const created = await manager.create({
      cwd: repo,
      name: 'abandoned-fork',
      startingState: { type: 'branch', branchName: 'HEAD' }
    })
    expect(await manager.discard({ ...created, createdAt: created.createdAt + 1 })).toBe(false)
    expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(2)

    expect(await manager.discard(created)).toBe(true)
    expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1)
    expect(await stat(join(manager.worktreesRoot, 'abandoned-fork')).catch(() => null)).toBeNull()
    expect(await new ManagedWorktrees(profile).list(repo)).toEqual([])
  })

  it('rejects unknown refs before allocating a worktree path', async () => {
    const manager = new ManagedWorktrees(profile)
    await expect(manager.create({ cwd: repo, startingState: { type: 'branch', branchName: 'missing-ref' } })).rejects.toThrow('Git rev-parse failed')
    expect(await stat(manager.worktreesRoot).catch(() => null)).toBeNull()
  })

  it('disables attribute filter execution while checking out, matching original safe filter overrides', async () => {
    const marker = join(directory, 'smudge-filter-ran')
    const script = join(directory, 'smudge-test.sh')
    await writeFile(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o700 })
    await writeFile(join(repo, '.gitattributes'), 'file.txt filter=test\n')
    await git('config', 'filter.test.clean', 'cat')
    await git('config', 'filter.test.smudge', script)
    await git('config', 'filter.test.required', 'true')
    await git('add', '.gitattributes')
    await git('-c', 'user.name=Replica Test', '-c', 'user.email=replica-test@example.invalid', 'commit', '-m', 'Attributes')
    const created = await new ManagedWorktrees(profile).create({ cwd: repo, startingState: { type: 'branch', branchName: 'HEAD' } })
    expect(await readFile(join(created.worktreeGitRoot, 'file.txt'), 'utf8')).toBe('initial\n')
    expect(await stat(marker).catch(() => null)).toBeNull()
  })

  it('does not adopt ordinary worktrees or a redirected managed checkout', async () => {
    const ordinary = join(directory, 'ordinary')
    await git('worktree', 'add', '--detach', ordinary, 'HEAD')
    const manager = new ManagedWorktrees(profile)
    expect(await manager.list(repo)).toEqual([])
    const created = await manager.create({ cwd: repo, name: 'redirect-test', startingState: { type: 'branch', branchName: 'HEAD' } })
    await rm(created.worktreeGitRoot, { recursive: true })
    await symlink(ordinary, created.worktreeGitRoot)
    expect(await new ManagedWorktrees(profile).list(repo)).toEqual([])
  })

  it('retains all concurrently created identities in the durable registry', async () => {
    const manager = new ManagedWorktrees(profile)
    const created = await Promise.all(['parallel-one', 'parallel-two', 'parallel-three'].map((name) =>
      manager.create({ cwd: repo, name, startingState: { type: 'branch', branchName: 'HEAD' } })))
    const saved = await new ManagedWorktrees(profile).list(repo)
    expect(new Set(saved.map((row) => row.id))).toEqual(new Set(created.map((row) => row.id)))
  })
})

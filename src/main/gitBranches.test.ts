import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAllowedGitBranchesArgs, parseGitBranches, readGitBranches } from './gitBranches'

const execFileAsync = promisify(execFile)
let directory: string
let repo: string

async function git(...args: string[]): Promise<string> {
  const result = await execFileAsync('/usr/bin/git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
  })
  return result.stdout.trim()
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'codex-branch-read-test-')))
  repo = join(directory, 'repository with spaces')
  await execFileAsync('/usr/bin/git', ['init', '-b', 'main', repo])
  await writeFile(join(repo, 'tracked.txt'), 'test\n')
  await git('add', '.')
  await git('-c', 'user.name=Branch Test', '-c', 'user.email=branch-test@example.invalid', 'commit', '-m', 'Initial')
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('branch read command boundary', () => {
  it('allows exactly the three fixed reads and rejects mutation, fetch and caller-selected formats', () => {
    for (const command of [
      ['branch', '--show-current'], ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'], ['remote']
    ]) expect(isAllowedGitBranchesArgs(['-C', repo, ...command])).toBe(true)
    for (const args of [
      ['-C', repo, 'fetch', 'origin'], ['-C', repo, 'checkout', 'main'], ['-C', repo, 'branch', 'new-branch'],
      ['-C', repo, 'for-each-ref', '--format=%(contents)', 'refs/heads', 'refs/remotes'],
      ['-C', repo, 'for-each-ref', '--format=%(refname)%00%(symref)', 'refs/tags'],
      ['-C', repo, 'remote', 'add', 'new', 'url'], ['-C', 'relative', 'remote'], ['-C', `${repo}/../other`, 'remote']
    ]) expect(isAllowedGitBranchesArgs(args)).toBe(false)
  })

  it('uses only the fixed allowlisted reads through its injected runner', async () => {
    const runner = vi.fn(async (args: readonly string[]) => {
      const command = args[2]
      if (command === 'branch') return 'main\n'
      if (command === 'remote') return 'origin\n'
      return 'refs/heads/main\0\nrefs/remotes/origin/main\0\nrefs/remotes/origin/HEAD\0refs/remotes/origin/main\n'
    })
    expect(await readGitBranches(repo, runner)).toEqual({ currentBranch: 'main', defaultBranch: 'origin/main', localBranches: ['main'], remoteBranches: ['origin/main'] })
    expect(runner).toHaveBeenCalledTimes(3)
    for (const [args] of runner.mock.calls) expect(isAllowedGitBranchesArgs(args)).toBe(true)
  })
})

describe('cached Git branches', () => {
  it('returns local and remote refs, filters symbolic remote HEAD, and honors cached default HEAD', async () => {
    await git('branch', 'feature/local')
    await git('remote', 'add', 'origin', join(directory, 'offline-remote-does-not-exist'))
    await git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    await git('update-ref', 'refs/remotes/origin/develop', 'HEAD')
    await git('update-ref', 'refs/remotes/origin/feature/remote', 'HEAD')
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    const before = await git('show-ref')
    expect(await readGitBranches(repo)).toEqual({
      currentBranch: 'main', defaultBranch: 'origin/develop', localBranches: ['feature/local', 'main'],
      remoteBranches: ['origin/develop', 'origin/feature/remote', 'origin/main']
    })
    expect(await git('show-ref')).toBe(before)
  })

  it('handles detached checkout and falls back only to known remote main/master refs', async () => {
    await git('remote', 'add', 'origin', join(directory, 'offline-remote-does-not-exist'))
    await git('update-ref', 'refs/remotes/origin/master', 'HEAD')
    await git('checkout', '--detach', 'HEAD')
    expect(await readGitBranches(repo)).toEqual({ currentBranch: null, defaultBranch: 'origin/master', localBranches: ['main'], remoteBranches: ['origin/master'] })
    expect(parseGitBranches('main\n', 'refs/heads/main\0\n', '')).toMatchObject({ currentBranch: 'main', defaultBranch: null })
  })

  it('reads a nested cwd and ignores inherited Git repository selectors', async () => {
    const nested = join(repo, 'nested')
    await mkdir(nested)
    const previous = process.env.GIT_DIR
    process.env.GIT_DIR = join(directory, 'unrelated-missing-git-dir')
    try { expect((await readGitBranches(nested)).currentBranch).toBe('main') }
    finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous }
  })

  it('rejects malformed paths, files and non-repository directories', async () => {
    await expect(readGitBranches('relative')).rejects.toThrow('Invalid branch directory')
    await expect(readGitBranches(join(repo, 'tracked.txt'))).rejects.toThrow('Branch directory is unavailable')
    const notRepository = join(directory, 'not-a-repository')
    await mkdir(notRepository)
    await expect(readGitBranches(notRepository)).rejects.toThrow('Could not read branches')
  })
})

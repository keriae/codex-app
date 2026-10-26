import { describe, expect, it, vi } from 'vitest'
import {
  inspectGitRepository,
  isAllowedReadOnlyGitArgs,
  parseGitDirtySummary,
  parseGitWorktrees
} from './gitMetadata'

describe('read-only git command boundary', () => {
  it('accepts only fixed metadata commands', () => {
    expect(
      isAllowedReadOnlyGitArgs(['/workspace/repo'].flatMap((path) => [
        '-C',
        path,
        'worktree',
        'list',
        '--porcelain'
      ]))
    ).toBe(true)
    expect(isAllowedReadOnlyGitArgs(['-C', '/workspace/repo', 'status', '--short'])).toBe(false)
    expect(isAllowedReadOnlyGitArgs(['-C', '/workspace/repo', 'worktree', 'add', '/tmp/new'])).toBe(false)
    expect(isAllowedReadOnlyGitArgs(['-C', 'relative/repo', 'remote'])).toBe(false)
  })
})

describe('git metadata parsers', () => {
  it('counts porcelain records without double-counting rename source paths', () => {
    const summary = parseGitDirtySummary(
      [
        'M  src/staged.ts',
        ' M src/unstaged.ts',
        'MM src/both.ts',
        '?? notes.txt',
        'UU conflict.ts',
        'R  src/new.ts',
        'src/old.ts',
        ''
      ].join('\0')
    )

    expect(summary).toEqual({
      staged: 3,
      unstaged: 2,
      untracked: 1,
      conflicted: 1,
      total: 6
    })
  })

  it('parses worktree porcelain and marks only the current checkout', () => {
    expect(
      parseGitWorktrees(
        [
          'worktree /workspace/repo',
          'HEAD 1111111111111111111111111111111111111111',
          'branch refs/heads/main',
          '',
          'worktree /workspace/feature',
          'HEAD 2222222222222222222222222222222222222222',
          'detached',
          'locked maintenance',
          ''
        ].join('\n'),
        '/workspace/feature'
      )
    ).toEqual([
      {
        path: '/workspace/repo',
        head: '1111111111111111111111111111111111111111',
        branch: 'main',
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        current: false
      },
      {
        path: '/workspace/feature',
        head: '2222222222222222222222222222222222222222',
        branch: null,
        detached: true,
        bare: false,
        locked: true,
        prunable: false,
        current: true
      }
    ])
  })
})

describe('inspectGitRepository', () => {
  it('uses only the fixed reads and redacts remote names by default', async () => {
    const responses = new Map<string, string>([
      ['rev-parse --show-toplevel', '/workspace/repo\n'],
      ['branch --show-current', 'main\n'],
      ['rev-parse --short=12 HEAD', 'abcdef123456\n'],
      [
        'status --porcelain=v1 -z --untracked-files=normal --ignore-submodules=all',
        '?? local.txt\0'
      ],
      ['remote', 'company\nbackup\n'],
      [
        'worktree list --porcelain',
        'worktree /workspace/repo\nHEAD abcdef123456\nbranch refs/heads/main\n'
      ]
    ])
    const runner = vi.fn(async (args: readonly string[]) => {
      const command = args.slice(2).join(' ')
      const output = responses.get(command)
      if (output === undefined) throw new Error(`unexpected read: ${command}`)
      return output
    })

    const result = await inspectGitRepository('/workspace/repo', {}, runner)

    expect(result).toMatchObject({
      isRepository: true,
      root: '/workspace/repo',
      branch: 'main',
      head: 'abcdef123456',
      remotes: ['remote 1', 'remote 2'],
      remoteCount: 2,
      remoteNamesRedacted: true
    })
    expect(runner).toHaveBeenCalledTimes(6)
    for (const [args] of runner.mock.calls) {
      expect(isAllowedReadOnlyGitArgs(args)).toBe(true)
    }
  })

  it('can reveal remote names only when explicitly requested', async () => {
    const runner = async (args: readonly string[]): Promise<string> => {
      const command = args.slice(2).join(' ')
      if (command === 'rev-parse --show-toplevel') return '/workspace/repo\n'
      if (command === 'remote') return 'origin\n'
      return ''
    }

    const result = await inspectGitRepository(
      '/workspace/repo',
      { redactRemoteNames: false },
      runner
    )
    expect(result.isRepository && result.remotes).toEqual(['origin'])
  })
})

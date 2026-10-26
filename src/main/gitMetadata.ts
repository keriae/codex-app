import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitDirtySummary,
  GitMetadata,
  GitMetadataFailure,
  GitMetadataOptions,
  GitRepositoryMetadata,
  GitWorktreeMetadata
} from '../shared/api'

const execFileAsync = promisify(execFile)
const GIT_BINARY = '/usr/bin/git'
const GIT_TIMEOUT_MS = 2_500
const GIT_MAX_BUFFER = 512 * 1024
const MAX_PATH_LENGTH = 4_096

const READ_ONLY_COMMANDS = [
  ['rev-parse', '--show-toplevel'],
  ['branch', '--show-current'],
  ['rev-parse', '--short=12', 'HEAD'],
  ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all'],
  ['remote'],
  ['worktree', 'list', '--porcelain']
] as const

type GitRunner = (args: readonly string[]) => Promise<string>

class GitReadError extends Error {
  constructor(readonly reason: GitMetadataFailure) {
    super(reason)
  }
}

function sameArguments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((argument, index) => argument === right[index])
}

/**
 * The renderer can choose a directory, but it cannot choose a git subcommand.
 * Keep this allowlist exact so this IPC surface can never become a generic
 * command runner as new UI is added.
 */
export function isAllowedReadOnlyGitArgs(args: readonly string[]): boolean {
  if (args.length < 3 || args[0] !== '-C' || !isAbsolute(args[1])) return false
  const command = args.slice(2)
  return READ_ONLY_COMMANDS.some((allowed) => sameArguments(command, allowed))
}

async function runReadOnlyGit(args: readonly string[]): Promise<string> {
  if (!isAllowedReadOnlyGitArgs(args)) throw new GitReadError('unavailable')

  try {
    const result = await execFileAsync(GIT_BINARY, [...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: '',
        GIT_EXTERNAL_DIFF: '',
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: 'false',
        GIT_CONFIG_KEY_1: 'core.untrackedCache',
        GIT_CONFIG_VALUE_1: 'false',
        LC_ALL: 'C'
      }
    })
    return result.stdout
  } catch (error) {
    const details = error as NodeJS.ErrnoException & {
      killed?: boolean
      signal?: string
      stderr?: string | Buffer
    }
    if (details.code === 'ENOENT') throw new GitReadError('git-unavailable')
    if (details.code === 'ETIMEDOUT' || details.killed || details.signal === 'SIGTERM') {
      throw new GitReadError('timeout')
    }
    const stderr = typeof details.stderr === 'string' ? details.stderr : details.stderr?.toString()
    if (stderr?.toLowerCase().includes('not a git repository')) {
      throw new GitReadError('not-repository')
    }
    throw new GitReadError('unavailable')
  }
}

function normalizedPathForComparison(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

export function parseGitDirtySummary(output: string): GitDirtySummary {
  const records = output.split('\0')
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0
  let total = 0

  const conflictStates = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
  const validStatusCharacters = new Set([' ', 'M', 'A', 'D', 'R', 'C', 'U', 'T', '?', '!'])

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 3) continue
    const x = record[0]
    const y = record[1]
    if (!validStatusCharacters.has(x) || !validStatusCharacters.has(y) || record[2] !== ' ') {
      continue
    }

    const state = `${x}${y}`
    if (state === '!!') continue
    total += 1
    if (state === '??') {
      untracked += 1
    } else if (conflictStates.has(state)) {
      conflicted += 1
    } else {
      if (x !== ' ') staged += 1
      if (y !== ' ') unstaged += 1
    }

    // In porcelain v1 -z output a rename/copy is followed by the source path
    // as a second NUL-delimited field with no status prefix.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index += 1
  }

  return { staged, unstaged, untracked, conflicted, total }
}

export function parseGitWorktrees(output: string, currentRoot: string): GitWorktreeMetadata[] {
  const currentKey = normalizedPathForComparison(currentRoot)
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      let path: string | null = null
      let head: string | null = null
      let branch: string | null = null
      let detached = false
      let bare = false
      let locked = false
      let prunable = false

      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
        else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length) || null
        else if (line.startsWith('branch ')) {
          branch = line.slice('branch '.length).replace(/^refs\/heads\//, '') || null
        } else if (line === 'detached') detached = true
        else if (line === 'bare') bare = true
        else if (line === 'locked' || line.startsWith('locked ')) locked = true
        else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true
      }

      if (!path) return []
      return [{
        path,
        head,
        branch,
        detached,
        bare,
        locked,
        prunable,
        current: normalizedPathForComparison(path) === currentKey
      }]
    })
}

function parseRemoteNames(output: string): string[] {
  return output
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((name) => name.slice(0, 128))
}

async function optionalGitRead(
  runner: GitRunner,
  args: readonly string[]
): Promise<string | null> {
  try {
    return await runner(args)
  } catch {
    return null
  }
}

export async function inspectGitRepository(
  requestedPath: string,
  options: GitMetadataOptions = {},
  runner: GitRunner = runReadOnlyGit
): Promise<GitMetadata> {
  let rootOutput: string
  try {
    rootOutput = await runner(['-C', requestedPath, 'rev-parse', '--show-toplevel'])
  } catch (error) {
    return {
      requestedPath,
      isRepository: false,
      reason: error instanceof GitReadError ? error.reason : 'unavailable'
    }
  }

  const root = rootOutput.trim()
  if (!root || !isAbsolute(root)) {
    return { requestedPath, isRepository: false, reason: 'not-repository' }
  }

  const [branchOutput, headOutput, statusOutput, remoteOutput, worktreeOutput] = await Promise.all([
    optionalGitRead(runner, ['-C', root, 'branch', '--show-current']),
    optionalGitRead(runner, ['-C', root, 'rev-parse', '--short=12', 'HEAD']),
    optionalGitRead(runner, [
      '-C',
      root,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=normal',
      '--ignore-submodules=all'
    ]),
    optionalGitRead(runner, ['-C', root, 'remote']),
    optionalGitRead(runner, ['-C', root, 'worktree', 'list', '--porcelain'])
  ])

  const branch = branchOutput?.trim() || null
  const headCandidate = headOutput?.trim() || null
  const head = headCandidate && /^[0-9a-f]+$/i.test(headCandidate) ? headCandidate : null
  const remoteNames = remoteOutput === null ? [] : parseRemoteNames(remoteOutput)
  const redactRemoteNames = options.redactRemoteNames !== false
  const metadata: GitRepositoryMetadata = {
    requestedPath,
    isRepository: true,
    root,
    branch,
    head,
    detached: branch === null && head !== null,
    dirty: statusOutput === null ? null : parseGitDirtySummary(statusOutput),
    remotes: redactRemoteNames
      ? remoteNames.map((_name, index) => `remote ${index + 1}`)
      : remoteNames,
    remoteCount: remoteNames.length,
    remoteNamesRedacted: redactRemoteNames,
    worktrees: worktreeOutput === null ? [] : parseGitWorktrees(worktreeOutput, root)
  }
  return metadata
}

function validatedProjectPath(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_PATH_LENGTH ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !isAbsolute(value)
  ) {
    return null
  }
  return resolve(value)
}

export async function readGitMetadata(
  value: unknown,
  options: GitMetadataOptions = {}
): Promise<GitMetadata> {
  const requestedPath = validatedProjectPath(value)
  if (!requestedPath) {
    return { requestedPath: '', isRepository: false, reason: 'invalid-path' }
  }

  try {
    if (!(await stat(requestedPath)).isDirectory()) {
      return { requestedPath, isRepository: false, reason: 'not-directory' }
    }
  } catch {
    return { requestedPath, isRepository: false, reason: 'not-directory' }
  }

  return inspectGitRepository(requestedPath, options)
}

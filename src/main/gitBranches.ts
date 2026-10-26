import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { GitBranches } from '../shared/api'

const execFileAsync = promisify(execFile)
const REF_COMMAND = ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'] as const
const COMMANDS = [['branch', '--show-current'], REF_COMMAND, ['remote']] as const

function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && isAbsolute(value) &&
    !/[\0\r\n]/.test(value) && resolve(value) === value
}

/** Branch IPC never accepts a Git subcommand, a format string or a ref namespace. */
export function isAllowedGitBranchesArgs(args: readonly string[]): boolean {
  return args[0] === '-C' && validPath(args[1]) && COMMANDS.some((command) =>
    args.length === command.length + 2 && command.every((part, index) => args[index + 2] === part))
}

type GitBranchesRunner = (args: readonly string[]) => Promise<string>

async function runGitBranches(args: readonly string[]): Promise<string> {
  if (!isAllowedGitBranchesArgs(args)) throw new Error('Blocked unsupported branch read')
  try {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const result = await execFileAsync('/usr/bin/git', [...args], {
      encoding: 'utf8', timeout: 2500, maxBuffer: 2 * 1024 * 1024,
      env: { ...inherited, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: '', LC_ALL: 'C' }
    })
    return result.stdout
  } catch (error) {
    const value = error as NodeJS.ErrnoException & { killed?: boolean }
    if (value.code === 'ENOENT') throw new Error('Git is unavailable')
    if (value.killed || value.code === 'ETIMEDOUT') throw new Error('Git branch read timed out')
    throw new Error('Could not read branches from this repository')
  }
}

export function parseGitBranches(currentOutput: string, refsOutput: string, remotesOutput: string): GitBranches {
  const local = new Set<string>()
  const remote = new Set<string>()
  const defaultRefs = new Map<string, string>()
  for (const line of refsOutput.split(/\r?\n/)) {
    const [ref, symbolicTarget] = line.split('\0')
    if (ref.startsWith('refs/heads/')) local.add(ref.slice('refs/heads/'.length))
    else if (ref.startsWith('refs/remotes/')) {
      if (ref.endsWith('/HEAD')) {
        const remoteName = ref.slice('refs/remotes/'.length, -'/HEAD'.length)
        if (symbolicTarget?.startsWith(`refs/remotes/${remoteName}/`) && !symbolicTarget.endsWith('/HEAD')) {
          defaultRefs.set(remoteName, symbolicTarget.slice('refs/remotes/'.length))
        }
      } else remote.add(ref.slice('refs/remotes/'.length))
    }
  }
  let defaultBranch: string | null = null
  for (const name of remotesOutput.trim().split(/\r?\n/).filter(Boolean)) {
    const symbolic = defaultRefs.get(name)
    if (symbolic && remote.has(symbolic)) { defaultBranch = symbolic; break }
    const fallback = ['main', 'master'].map((branch) => `${name}/${branch}`).find((branch) => remote.has(branch))
    if (fallback) { defaultBranch = fallback; break }
  }
  return { currentBranch: currentOutput.trim() || null, defaultBranch,
    localBranches: [...local].filter(Boolean).sort(), remoteBranches: [...remote].filter(Boolean).sort() }
}

export async function readGitBranches(value: unknown, runner: GitBranchesRunner = runGitBranches): Promise<GitBranches> {
  if (!validPath(value)) throw new Error('Invalid branch directory')
  const cwd = await realpath(value)
  if (!(await stat(cwd)).isDirectory()) throw new Error('Branch directory is unavailable')
  const [current, refs, remotes] = await Promise.all(COMMANDS.map((command) => runner(['-C', cwd, ...command])))
  return parseGitBranches(current, refs, remotes)
}

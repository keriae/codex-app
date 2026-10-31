import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WorkspaceTextDiffOptions } from '../shared/api'

const execFileAsync = promisify(execFile)
const MAX_TEXT_BYTES = 512 * 1024
type GitDiffRunner = (args: string[], directory: string) => Promise<{ stdout: string; code: number }>

export function validateWorkspaceTextDiff(before: unknown, after: unknown, options: unknown): {
  before: string; after: string; options: WorkspaceTextDiffOptions
} {
  if (typeof before !== 'string' || typeof after !== 'string' || before.includes('\0') || after.includes('\0') ||
      Buffer.byteLength(before, 'utf8') > MAX_TEXT_BYTES || Buffer.byteLength(after, 'utf8') > MAX_TEXT_BYTES ||
      !options || typeof options !== 'object' || Array.isArray(options) ||
      typeof (options as Record<string, unknown>).ignoreWhitespace !== 'boolean' ||
      Object.keys(options).some((key) => key !== 'ignoreWhitespace')) {
    throw new Error('Invalid workspace text diff request')
  }
  return { before, after, options: { ignoreWhitespace: (options as WorkspaceTextDiffOptions).ignoreWhitespace } }
}

async function runGitDiff(args: string[], directory: string): Promise<{ stdout: string; code: number }> {
  try {
    const result = await execFileAsync('/usr/bin/git', args, {
      cwd: directory, encoding: 'utf8', timeout: 5_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: '', GIT_EXTERNAL_DIFF: '', LC_ALL: 'C' }
    })
    return { stdout: result.stdout, code: 0 }
  } catch (error) {
    const details = error as { code?: unknown; stdout?: unknown }
    // git diff uses exit 1 for a successfully generated nonempty difference.
    if (details.code === 1 && typeof details.stdout === 'string') return { stdout: details.stdout, code: 1 }
    throw new Error('Could not compute workspace text diff')
  }
}

/** Re-diff validated full snapshots using the original Git whitespace semantics. */
export async function diffWorkspaceText(before: unknown, after: unknown, options: unknown,
  runner: GitDiffRunner = runGitDiff): Promise<string> {
  const request = validateWorkspaceTextDiff(before, after, options)
  const directory = await mkdtemp(join(tmpdir(), 'codex-replica-text-diff-'))
  try {
    await Promise.all([writeFile(join(directory, 'before'), request.before, { mode: 0o600 }),
      writeFile(join(directory, 'after'), request.after, { mode: 0o600 })])
    const args = ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3',
      ...(request.options.ignoreWhitespace ? ['--ignore-all-space'] : []), '--', 'before', 'after']
    const result = await runner(args, directory)
    if (result.code !== 0 && result.code !== 1) throw new Error('Could not compute workspace text diff')
    // Snapshot filenames are implementation details and never file-link targets.
    return result.stdout.replace(/^diff --git a\/before b\/after$/m, 'diff --git a/file b/file')
      .replace(/^--- a\/before$/m, '--- a/file').replace(/^\+\+\+ b\/after$/m, '+++ b/file')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

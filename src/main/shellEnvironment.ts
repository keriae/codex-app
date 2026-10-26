import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'

const DEFAULT_TIMEOUT_MS = 5_000
const MAX_SHELL_OUTPUT_BYTES = 4 * 1024 * 1024
const SHELL_ENV_DELIMITER = '_SHELL_ENV_DELIMITER_'
const SHELL_ENV_MARKER = Buffer.from(`\0${SHELL_ENV_DELIMITER}\0`)
const SHELL_ENV_COMMAND = [
  `printf '\\0%s\\0' '${SHELL_ENV_DELIMITER}'`,
  'command env -0 || exit',
  `printf '\\0%s\\0' '${SHELL_ENV_DELIMITER}'`,
  'exit'
].join('; ')

const SHELL_BOOTSTRAP_ENVIRONMENT: NodeJS.ProcessEnv = {
  CODEX_SHELL: '1',
  DISABLE_AUTO_UPDATE: 'true',
  ZSH_TMUX_AUTOSTARTED: 'true',
  ZSH_TMUX_AUTOSTART: 'false'
}

export type ShellEnvironmentHydrationStatus = 'loaded' | 'failed' | 'timed_out' | 'skipped'

export interface ShellEnvironmentRunOptions {
  env: NodeJS.ProcessEnv
  signal: AbortSignal
}

export type ShellEnvironmentRunner = (
  executable: string,
  args: string[],
  options: ShellEnvironmentRunOptions
) => Promise<Buffer>

export interface ShellEnvironmentHydrationOptions {
  environment?: NodeJS.ProcessEnv
  getUserShell?: () => string | undefined
  platform?: NodeJS.Platform
  runShell?: ShellEnvironmentRunner
  timeoutMs?: number
}

/**
 * Finder launches macOS applications with a deliberately small environment.
 * Hydrate the Electron main process from the user's login shell before any
 * long-lived child process is started. Values stay in memory and are never
 * returned or logged by this module.
 */
export async function hydrateShellEnvironment(
  options: ShellEnvironmentHydrationOptions = {}
): Promise<ShellEnvironmentHydrationStatus> {
  if ((options.platform ?? process.platform) !== 'darwin') return 'skipped'

  const environment = options.environment ?? process.env
  const runShell = options.runShell ?? runLoginShell
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const abortController = new AbortController()
  const timedOut = Symbol('shell-environment-timeout')
  let timeout: NodeJS.Timeout | null = null

  const timeoutPromise = new Promise<typeof timedOut>((resolve) => {
    timeout = setTimeout(() => {
      abortController.abort()
      resolve(timedOut)
    }, timeoutMs)
    timeout.unref()
  })

  try {
    for (const shell of shellCandidates(options.getUserShell)) {
      const attempt = runShell(shell, ['-ilc', SHELL_ENV_COMMAND], {
        env: { ...SHELL_BOOTSTRAP_ENVIRONMENT },
        signal: abortController.signal
      }).then(
        (stdout) => ({ status: 'success' as const, stdout }),
        () => ({ status: 'failed' as const })
      )
      const outcome = await Promise.race([attempt, timeoutPromise])

      if (outcome === timedOut || abortController.signal.aborted) return 'timed_out'
      if (outcome.status === 'failed') continue

      try {
        const loaded = parseShellEnvironment(outcome.stdout)
        for (const [name, value] of loaded) environment[name] = value
        return 'loaded'
      } catch {
        // A custom shell can exit successfully while emitting unusable output.
        // Retry the standard macOS shell without exposing that output.
      }
    }

    return 'failed'
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function normalizeTimeout(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_MS
}

function shellCandidates(getUserShell: (() => string | undefined) | undefined): string[] {
  let configured: string | undefined
  try {
    configured = (getUserShell ?? (() => userInfo().shell))()?.trim()
  } catch {
    configured = undefined
  }

  return [...new Set([configured, '/bin/zsh'].filter((shell): shell is string => !!shell))]
}

function runLoginShell(
  executable: string,
  args: string[],
  options: ShellEnvironmentRunOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        executable,
        args,
        {
          encoding: null,
          env: options.env,
          maxBuffer: MAX_SHELL_OUTPUT_BYTES,
          signal: options.signal,
          windowsHide: true
        },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
        }
      )
    } catch (error) {
      reject(error)
    }
  })
}

function parseShellEnvironment(stdout: Buffer): Map<string, string> {
  const start = stdout.indexOf(SHELL_ENV_MARKER)
  const end =
    start < 0 ? -1 : stdout.indexOf(SHELL_ENV_MARKER, start + SHELL_ENV_MARKER.length)
  if (start < 0 || end < 0) throw new Error('Shell environment delimiters were not found')

  const environment = new Map<string, string>()
  const payload = stdout.subarray(start + SHELL_ENV_MARKER.length, end)
  let offset = 0
  while (offset < payload.length) {
    const terminator = payload.indexOf(0, offset)
    const next = terminator < 0 ? payload.length : terminator
    const entry = payload.subarray(offset, next)
    const separator = entry.indexOf(0x3d)
    if (separator > 0) {
      environment.set(
        entry.subarray(0, separator).toString('utf8'),
        entry.subarray(separator + 1).toString('utf8')
      )
    }
    offset = next + 1
  }
  return environment
}

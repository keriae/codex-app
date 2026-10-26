import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

const macosTargetTriple = process.arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin'
const DESKTOP_BUNDLED_CODEX =
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
const MACOS_FALLBACKS = [
  `/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-${process.arch}/vendor/${macosTargetTriple}/bin/codex`,
  `/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-${process.arch}/vendor/${macosTargetTriple}/bin/codex`,
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex'
] as const

export interface CodexBinaryDiscoveryOptions {
  env?: NodeJS.ProcessEnv
  cwd?: string
  isExecutable?: (path: string) => boolean
}

export function discoverCodexBinary(options: CodexBinaryDiscoveryOptions = {}): string {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const isExecutable = options.isExecutable ?? executableFile
  const configured = env.CODEX_BINARY?.trim()

  if (configured) {
    const candidate = resolveConfiguredBinary(configured, env.PATH, cwd, isExecutable)
    if (candidate) return candidate
    throw new Error(
      `CODEX_BINARY is set to "${configured}", but no executable was found there or on PATH`
    )
  }

  // The desktop target owns and launches this exact companion binary. Prefer
  // the installed bundle over a potentially different Homebrew/npm release.
  if (isExecutable(DESKTOP_BUNDLED_CODEX)) return DESKTOP_BUNDLED_CODEX

  const fromPath = findOnPath('codex', env.PATH, cwd, isExecutable)
  if (fromPath) return fromPath

  for (const candidate of MACOS_FALLBACKS) {
    if (isExecutable(candidate)) return candidate
  }

  throw new Error(
    'Unable to find the Codex CLI. Set CODEX_BINARY, add codex to PATH, install the Codex CLI with npm/Homebrew, or install the official Codex desktop app.'
  )
}

function resolveConfiguredBinary(
  configured: string,
  pathValue: string | undefined,
  cwd: string,
  isExecutable: (path: string) => boolean
): string | null {
  if (!configured.includes('/')) return findOnPath(configured, pathValue, cwd, isExecutable)
  const candidate = isAbsolute(configured) ? configured : resolve(cwd, configured)
  return isExecutable(candidate) ? candidate : null
}

function findOnPath(
  name: string,
  pathValue: string | undefined,
  cwd: string,
  isExecutable: (path: string) => boolean
): string | null {
  if (!pathValue) return null
  for (const entry of pathValue.split(delimiter)) {
    const directory = entry || cwd
    const candidate = join(directory, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function executableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

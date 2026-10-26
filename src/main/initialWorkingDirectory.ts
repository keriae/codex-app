import { homedir } from 'node:os'
import { resolve } from 'node:path'

export type InitialWorkingDirectorySource = 'argument' | 'environment' | 'process' | 'home'

export interface InitialWorkingDirectory {
  cwd: string
  source: InitialWorkingDirectorySource
}

export interface InitialWorkingDirectoryOptions {
  args?: readonly string[]
  environmentWorkspace?: string
  processCwd?: string
  homeDirectory?: string
}

/** Finder launches have an implicit `/`; it is not a selected project folder. */
export function resolveInitialWorkingDirectory(options: InitialWorkingDirectoryOptions = {}): InitialWorkingDirectory {
  const processCwd = resolve(options.processCwd ?? process.cwd())
  const cwdArgument = (options.args ?? process.argv).find((argument) => argument.startsWith('--cwd='))?.slice('--cwd='.length)
  if (cwdArgument) return { cwd: resolve(processCwd, cwdArgument), source: 'argument' }
  const environmentWorkspace = options.environmentWorkspace ?? process.env.CODEX_WORKSPACE
  if (environmentWorkspace) return { cwd: resolve(processCwd, environmentWorkspace), source: 'environment' }
  if (processCwd !== '/') return { cwd: processCwd, source: 'process' }
  // The renderer can restore its selected project after the catalog loads.
  // Until then, use an existing user directory instead of granting the volume root.
  return { cwd: resolve(options.homeDirectory ?? homedir()), source: 'home' }
}

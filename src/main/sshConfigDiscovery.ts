import { spawn } from 'node:child_process'
import {
  existsSync,
  globSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const HOST_PATTERN_CHARACTERS = /[!*?[\]]/u
const INCLUDE_GLOB_CHARACTERS = /[*?[\]{}()]/u
const EXCLUDED_ALIASES = new Set(['colima'])
const EXCLUDED_HOSTNAMES = new Set(['github.com'])
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000
const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_MAX_CONFIG_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_CONFIG_FILES = 512
const DEFAULT_MAX_ALIASES = 1_024
const DEFAULT_MAX_INCLUDE_MATCHES = 2_048

export interface SshConfigDiscoveryLimits {
  maxConfigBytes?: number
  maxConfigFiles?: number
  maxAliases?: number
  maxIncludeMatches?: number
}

export interface ResolvedSshAlias {
  displayName: string
  sshAlias: string
  host: string
  port?: number
  identityFile?: string
}

export interface SshCommandResult {
  code: number | null
  stdout: string
  stderr: string
}

export type SshCommandRunner = (
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number }
) => Promise<SshCommandResult>

export interface DiscoverSshAliasesOptions extends SshConfigDiscoveryLimits {
  homeDirectory?: string
  glob?: (pattern: string) => string[]
}

export interface ResolveSshAliasOptions {
  entrypointPath: string
  sshAlias: string
  runSshCommand?: SshCommandRunner
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
}

interface ParsedDirective {
  name: string
  values: string[]
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  return value
}

/** Tokenizes the subset of ssh_config syntax used by Host, Match and Include. */
export function parseSshConfigDirective(line: string): ParsedDirective | null {
  if (line.includes('\0')) throw new Error('SSH config contains a NUL byte')
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let started = false

  const push = (): void => {
    if (!started) return
    tokens.push(token)
    token = ''
    started = false
  }

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (escaped) {
      token += character
      escaped = false
      started = true
      continue
    }
    if (character === '\\') {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else token += character
      started = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === '#') break
    if (character === '=' && ((tokens.length === 0 && started) || (tokens.length === 1 && !started))) {
      push()
      continue
    }
    if (/\s/u.test(character)) {
      push()
      continue
    }
    token += character
    started = true
  }
  if (escaped || quote) throw new Error('SSH config contains an unterminated escape or quote')
  push()
  if (tokens.length === 0) return null
  return { name: tokens[0], values: tokens.slice(1) }
}

function expandHome(path: string, homeDirectory: string): string {
  if (path === '~') return homeDirectory
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homeDirectory, path.slice(2))
  return path
}

function canonicalPath(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

function includeFiles(
  patterns: readonly string[],
  rootDirectory: string,
  homeDirectory: string,
  glob: (pattern: string) => string[],
  maxMatches: number
): string[] {
  const files: string[] = []
  for (const value of patterns) {
    if (!value || value.includes('\0')) continue
    const expanded = expandHome(value, homeDirectory)
    const pattern = isAbsolute(expanded) ? expanded : resolve(rootDirectory, expanded)
    let matches = glob(pattern)
    if (matches.length === 0 && !INCLUDE_GLOB_CHARACTERS.test(pattern) && existsSync(pattern)) {
      matches = [pattern]
    }
    for (const match of matches) {
      if (files.length >= maxMatches) throw new Error('SSH config includes too many files')
      try {
        if (statSync(match).isFile()) files.push(canonicalPath(match))
      } catch {
        // OpenSSH ignores include patterns that disappeared between expansion and read.
      }
    }
  }
  return files
}

/**
 * Discovers explicit Host aliases using the same policy as the original app:
 * global Includes are resolved relative to the entrypoint directory, only the
 * first non-pattern alias from each Host directive is collected, and `colima`
 * is hidden from the picker.
 */
export function discoverSshAliases(
  entrypointPath: string,
  options: DiscoverSshAliasesOptions = {}
): string[] {
  if (!entrypointPath || entrypointPath.includes('\0')) throw new Error('SSH config path is invalid')
  const absoluteEntrypoint = resolve(entrypointPath)
  if (!existsSync(absoluteEntrypoint)) return []

  const maxConfigBytes = positiveInteger(options.maxConfigBytes, DEFAULT_MAX_CONFIG_BYTES, 'maxConfigBytes')
  const maxConfigFiles = positiveInteger(options.maxConfigFiles, DEFAULT_MAX_CONFIG_FILES, 'maxConfigFiles')
  const maxAliases = positiveInteger(options.maxAliases, DEFAULT_MAX_ALIASES, 'maxAliases')
  const maxIncludeMatches = positiveInteger(
    options.maxIncludeMatches,
    DEFAULT_MAX_INCLUDE_MATCHES,
    'maxIncludeMatches'
  )
  const homeDirectory = options.homeDirectory ?? homedir()
  const glob = options.glob ?? ((pattern: string) => globSync(pattern))
  const rootDirectory = dirname(absoluteEntrypoint)
  const aliases = new Set<string>()
  const visited = new Set<string>()

  const visit = (configPath: string): void => {
    const path = canonicalPath(configPath)
    if (visited.has(path)) return
    if (visited.size >= maxConfigFiles) throw new Error('SSH config includes too many files')
    visited.add(path)

    const metadata = statSync(path)
    if (!metadata.isFile()) return
    if (metadata.size > maxConfigBytes) throw new Error('SSH config file is too large')
    const source = readFileSync(path, 'utf8')
    if (Buffer.byteLength(source, 'utf8') > maxConfigBytes) throw new Error('SSH config file is too large')

    let inConditionalBlock = false
    for (const line of source.split(/\r?\n/u)) {
      const directive = parseSshConfigDirective(line)
      if (!directive) continue
      const name = directive.name.toLocaleLowerCase()
      if (name === 'host') {
        inConditionalBlock = true
        const alias = directive.values.find((value) => value.length > 0 && !HOST_PATTERN_CHARACTERS.test(value))
        if (alias && !EXCLUDED_ALIASES.has(alias.trim().toLocaleLowerCase())) {
          if (!aliases.has(alias) && aliases.size >= maxAliases) throw new Error('SSH config contains too many aliases')
          aliases.add(alias)
        }
        continue
      }
      if (name === 'match') {
        inConditionalBlock = true
        continue
      }
      if (name !== 'include' || inConditionalBlock) continue
      for (const included of includeFiles(
        directive.values,
        rootDirectory,
        homeDirectory,
        glob,
        maxIncludeMatches
      )) visit(included)
    }
  }

  visit(absoluteEntrypoint)
  return [...aliases].sort((left, right) => left.localeCompare(right))
}

export function parseSshResolvedConfig(output: string): {
  hostname: string | null
  port: number | null
  identityFile: string | null
} {
  let hostname: string | null = null
  let port: number | null = null
  let identityFile: string | null = null
  for (const line of output.split(/\r?\n/u)) {
    const directive = parseSshConfigDirective(line)
    if (!directive || directive.values.length === 0) continue
    const name = directive.name.toLocaleLowerCase()
    const value = directive.values.join(' ').trim()
    if (!value) continue
    if (name === 'hostname' && hostname === null) hostname = value
    else if (name === 'port' && port === null) {
      const parsed = Number(value)
      if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65_535) port = parsed
    } else if (name === 'identityfile' && identityFile === null && value.toLocaleLowerCase() !== 'none') {
      identityFile = value
    }
  }
  return { hostname, port, identityFile }
}

export async function runSshConfigCommand(
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number }
): Promise<SshCommandResult> {
  return new Promise<SshCommandResult>((resolvePromise, reject) => {
    const child = spawn('ssh', [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout: Buffer = Buffer.alloc(0)
    let stderr: Buffer = Buffer.alloc(0)
    let settled = false

    const finish = (error?: Error, code: number | null = child.exitCode): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      child.removeListener('error', onError)
      child.removeListener('close', onClose)
      if (error) reject(error)
      else resolvePromise({ code, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') })
    }
    const append = (current: Buffer, chunk: Buffer): Buffer => {
      const combined = Buffer.concat([current, chunk])
      if (combined.length > options.maxOutputBytes) {
        child.kill('SIGTERM')
        finish(new Error('ssh -G output exceeded the configured limit'))
      }
      return combined
    }
    const onAbort = (): void => {
      child.kill('SIGTERM')
      finish(new Error('SSH config resolution canceled'))
    }
    const onError = (error: Error): void => finish(error)
    const onClose = (code: number | null): void => finish(undefined, code)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`ssh -G timed out after ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    timer.unref()

    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.once('error', onError)
    child.once('close', onClose)
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Resolves one discovered alias through OpenSSH's own effective-config parser. */
export async function resolveSshAlias(options: ResolveSshAliasOptions): Promise<ResolvedSshAlias | null> {
  const entrypointPath = resolve(options.entrypointPath)
  const sshAlias = options.sshAlias.trim()
  if (!sshAlias || sshAlias.startsWith('-') || /[\s\0]/u.test(sshAlias) || HOST_PATTERN_CHARACTERS.test(sshAlias)) {
    throw new Error('SSH alias is invalid')
  }
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, 'timeoutMs')
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes,
    DEFAULT_MAX_COMMAND_OUTPUT_BYTES,
    'maxOutputBytes'
  )
  const result = await (options.runSshCommand ?? runSshConfigCommand)(
    ['-G', '-F', entrypointPath, sshAlias],
    { signal: options.signal, timeoutMs, maxOutputBytes }
  )
  if (result.code !== 0) return null
  const resolved = parseSshResolvedConfig(result.stdout)
  if (!resolved.hostname || EXCLUDED_HOSTNAMES.has(resolved.hostname.trim().toLocaleLowerCase())) return null
  return {
    displayName: sshAlias,
    sshAlias,
    host: resolved.hostname,
    ...(resolved.port === null ? {} : { port: resolved.port }),
    ...(resolved.identityFile === null ? {} : { identityFile: resolved.identityFile })
  }
}

export async function discoverSshConnections(
  entrypointPath: string,
  options: DiscoverSshAliasesOptions & Omit<ResolveSshAliasOptions, 'entrypointPath' | 'sshAlias'> = {}
): Promise<ResolvedSshAlias[]> {
  const aliases = discoverSshAliases(entrypointPath, options)
  const connections: ResolvedSshAlias[] = []
  for (const sshAlias of aliases) {
    if (options.signal?.aborted) throw new Error('SSH config discovery canceled')
    const resolved = await resolveSshAlias({ ...options, entrypointPath, sshAlias })
    if (resolved) connections.push(resolved)
  }
  return connections
}

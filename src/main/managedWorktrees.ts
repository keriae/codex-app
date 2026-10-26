import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { ManagedWorktree, ManagedWorktreeCreateOptions } from '../shared/api'

const execFileAsync = promisify(execFile)
const MAX_RECORDS = 4096
const MAX_ACTIVE_CREATES = 8
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_UNTRACKED_FILES = 100_000
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_NAME = /^(?:[0-9a-f]{4,}|con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

interface WorktreeRecord {
  id: string
  worktreeGitRoot: string
  worktreeWorkspaceRoot: string
  sourceRepositoryRoot: string
  commonDirectory: string
  createdAt: number
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    isAbsolute(value) && !/[\0\r\n]/.test(value) && resolve(value) === value
}

function within(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

export function validateWorktreeCreateOptions(value: unknown): ManagedWorktreeCreateOptions {
  if (!record(value) || Object.keys(value).some((key) => !['cwd', 'name', 'startingState'].includes(key)) ||
      !validPath(value.cwd)) throw new Error('Invalid worktree options')
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 64 ||
      !NAME_PATTERN.test(value.name) || RESERVED_NAME.test(value.name))) {
    throw new Error('Invalid worktree name. Use 1–64 lowercase letters, numbers, or single hyphens; hexadecimal IDs and device names are reserved.')
  }
  if (value.startingState !== undefined) {
    const state = value.startingState
    if (!record(state) || (
      state.type === 'working-tree'
        ? Object.keys(state).some((key) => key !== 'type')
        : state.type !== 'branch' || Object.keys(state).some((key) => !['type', 'branchName'].includes(key)) ||
          typeof state.branchName !== 'string' || state.branchName.length === 0 ||
          state.branchName.length > 1024 || state.branchName.startsWith('-') || /[\0\r\n]/.test(state.branchName)
    )) {
      throw new Error('Invalid worktree starting ref')
    }
  }
  return value as unknown as ManagedWorktreeCreateOptions
}

function gitEnvironment(): NodeJS.ProcessEnv {
  // Inherited repository selectors cannot redirect a selected cwd to another repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: '', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C' }
}

async function git(
  cwd: string,
  args: string[],
  config: string[] = [],
  allowedNonZeroExitCodes: number[] = [],
  maxBuffer = 1024 * 1024
): Promise<string> {
  try {
    const result = await execFileAsync('/usr/bin/git', [
      '-C', cwd, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'submodule.recurse=false', ...config, ...args
    ], { env: gitEnvironment(), timeout: 30_000, maxBuffer, encoding: 'utf8' })
    return result.stdout
  } catch (error) {
    const value = error as { code?: string | number; killed?: boolean; stdout?: string }
    if (typeof value.code === 'number' && allowedNonZeroExitCodes.includes(value.code)) return value.stdout ?? ''
    if (value.code === 'ENOENT') throw new Error('Git is unavailable')
    if (value.killed || value.code === 'ETIMEDOUT') throw new Error('Git worktree operation timed out')
    // Git stderr may include remote URLs/configuration; return a bounded operation label instead.
    throw new Error(`Git ${args[0]} failed`)
  }
}

async function optionalGit(cwd: string, args: string[]): Promise<string | null> {
  try { return (await git(cwd, args)).trim() } catch { return null }
}

async function repository(cwd: string): Promise<{ root: string; commonDirectory: string }> {
  if (!validPath(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('Workspace directory is unavailable')
  const canonicalCwd = await realpath(cwd)
  const root = await realpath((await git(canonicalCwd, ['rev-parse', '--show-toplevel'])).trim())
  const commonDirectory = await realpath((await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
  if (!within(root, canonicalCwd)) throw new Error('Workspace is outside its repository')
  return { root, commonDirectory }
}

async function defaultStartingRef(root: string): Promise<string> {
  const remotes = (await git(root, ['remote'])).trim().split('\n').filter(Boolean).slice(0, 100)
  for (const remote of remotes) {
    const prefix = `refs/remotes/${remote}/`
    const head = await optionalGit(root, ['symbolic-ref', '--quiet', `${prefix}HEAD`])
    if (head?.startsWith(prefix) && await optionalGit(root, ['rev-parse', '--verify', '--end-of-options', `${head}^{commit}`])) return head
    for (const branch of ['main', 'master']) {
      const ref = `${prefix}${branch}`
      if (await optionalGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])) return ref
    }
  }
  throw new Error('Could not determine the remote default branch. Specify an explicit ref to create the worktree.')
}

async function safeAttributeConfig(root: string): Promise<string[]> {
  const names = await git(root, ['config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$'], [], [1])
  const filters = new Set((names ?? '').split('\n').flatMap((name) => {
    const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/.exec(name)
    return match && !/[\0\r\n]/.test(match[1]) ? [match[1]] : []
  }))
  return ['-c', 'attr.tree=', '-c', 'core.attributesFile=', ...[...filters].flatMap((name) =>
    ['clean', 'smudge', 'process', 'required'].flatMap((key) => ['-c', `filter.${name}.${key}=${key === 'required' ? 'false' : ''}`]))]
}

interface WorkingTreeSnapshot {
  patch: string
  untrackedPaths: string[]
}

async function workingTreeSnapshot(root: string, startingSha: string): Promise<WorkingTreeSnapshot> {
  const [patch, untracked] = await Promise.all([
    git(root, [
      'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv',
      startingSha, '--'
    ], [], [], MAX_GIT_OUTPUT_BYTES),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'], [], [], MAX_GIT_OUTPUT_BYTES)
  ])
  const untrackedPaths = untracked.split('\0').filter(Boolean)
  if (untrackedPaths.length > MAX_UNTRACKED_FILES) {
    throw new Error('Working tree contains too many untracked files')
  }
  return { patch, untrackedPaths }
}

function checkedRepositoryPath(root: string, value: string): string {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    throw new Error('Git returned an invalid working-tree path')
  }
  const path = resolve(root, value)
  if (!within(root, path) || path === root) throw new Error('Git returned an invalid working-tree path')
  return path
}

async function copyUntrackedPaths(
  sourceRoot: string,
  targetRoot: string,
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    const source = checkedRepositoryPath(sourceRoot, path)
    const target = checkedRepositoryPath(targetRoot, path)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, {
      dereference: false,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: (await lstat(source)).isDirectory(),
      verbatimSymlinks: true
    })
  }
}

/** A desktop-owned registry; callers never supply output paths or Git commands. */
export class ManagedWorktrees {
  private readonly records = new Map<string, WorktreeRecord>()
  private readonly filePath: string
  private readonly ready: Promise<void>
  private activeCreates = 0
  private saveQueue: Promise<void> = Promise.resolve()
  readonly worktreesRoot: string

  constructor(userDataDirectory: string) {
    this.worktreesRoot = resolve(userDataDirectory, 'worktrees')
    this.filePath = resolve(userDataDirectory, 'managed-worktrees.json')
    this.ready = this.load()
  }

  private async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!record(value) || value.version !== 1 || !Array.isArray(value.worktrees) ||
          value.worktrees.length > MAX_RECORDS || Object.keys(value).some((key) => !['version', 'worktrees'].includes(key))) return
      for (const entry of value.worktrees) {
        if (!record(entry) || Object.keys(entry).some((key) => !['id', 'worktreeGitRoot', 'worktreeWorkspaceRoot', 'sourceRepositoryRoot', 'commonDirectory', 'createdAt'].includes(key)) ||
            typeof entry.id !== 'string' || !/^[0-9a-f-]{36}$/.test(entry.id) ||
            !validPath(entry.worktreeGitRoot) || !within(this.worktreesRoot, entry.worktreeGitRoot) ||
            !validPath(entry.worktreeWorkspaceRoot) || !within(entry.worktreeGitRoot, entry.worktreeWorkspaceRoot) ||
            !validPath(entry.sourceRepositoryRoot) || !validPath(entry.commonDirectory) ||
            typeof entry.createdAt !== 'number' || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0) continue
        this.records.set(entry.id, entry as unknown as WorktreeRecord)
      }
    } catch { /* Missing/corrupt registries never adopt unrelated checkouts. */ }
  }

  private save(): Promise<void> {
    const operation = this.saveQueue.then(() => this.writeRegistry())
    this.saveQueue = operation.catch(() => {})
    return operation
  }

  private async writeRegistry(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ version: 1, worktrees: [...this.records.values()] })}\n`, { mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    } finally { await rm(temporaryPath, { force: true }).catch(() => {}) }
  }

  async list(cwd: string): Promise<ManagedWorktree[]> {
    await this.ready
    const source = await repository(cwd)
    const rows = await Promise.all([...this.records.values()].filter((entry) => entry.commonDirectory === source.commonDirectory).map(async (entry) => {
      try {
        if ((await lstat(entry.worktreeGitRoot)).isSymbolicLink() ||
            await realpath(entry.worktreeGitRoot) !== entry.worktreeGitRoot ||
            !(await lstat(join(dirname(entry.worktreeGitRoot), '.codex-worktree-name'))).isFile()) return null
        const current = await repository(entry.worktreeGitRoot)
        if (current.root !== entry.worktreeGitRoot || current.commonDirectory !== entry.commonDirectory) return null
        return await this.describe(entry)
      } catch { return null }
    }))
    return rows.filter((row): row is ManagedWorktree => row !== null).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }

  private async describe(entry: WorktreeRecord): Promise<ManagedWorktree> {
    const [head, branch] = await Promise.all([
      optionalGit(entry.worktreeGitRoot, ['rev-parse', '--verify', 'HEAD']),
      optionalGit(entry.worktreeGitRoot, ['branch', '--show-current'])
    ])
    return { id: entry.id, worktreeGitRoot: entry.worktreeGitRoot, worktreeWorkspaceRoot: entry.worktreeWorkspaceRoot,
      sourceRepositoryRoot: entry.sourceRepositoryRoot, createdAt: entry.createdAt,
      head, branch: branch || null, detached: !branch, ownerThreadId: null, setupError: null }
  }

  /**
   * Dispose a checkout returned by this manager only while its owner can prove
   * no persistent server mutation was submitted. Identity and repository
   * checks keep stale/forged handles from removing another checkout.
   */
  async discard(created: ManagedWorktree): Promise<boolean> {
    await this.ready
    const entry = this.records.get(created.id)
    if (!entry || entry.worktreeGitRoot !== created.worktreeGitRoot ||
        entry.worktreeWorkspaceRoot !== created.worktreeWorkspaceRoot ||
        entry.sourceRepositoryRoot !== created.sourceRepositoryRoot ||
        entry.createdAt !== created.createdAt) return false

    const parent = dirname(entry.worktreeGitRoot)
    const marker = join(parent, '.codex-worktree-name')
    try {
      if (parent === this.worktreesRoot || !within(this.worktreesRoot, parent) ||
          (await lstat(parent)).isSymbolicLink() || await realpath(parent) !== parent ||
          !(await lstat(marker)).isFile()) return false
      const current = await repository(entry.worktreeGitRoot)
      if (current.root !== entry.worktreeGitRoot || current.commonDirectory !== entry.commonDirectory) return false
      const source = await repository(entry.sourceRepositoryRoot)
      if (source.root !== entry.sourceRepositoryRoot || source.commonDirectory !== entry.commonDirectory) return false
      await git(entry.sourceRepositoryRoot, ['worktree', 'remove', '--force', entry.worktreeGitRoot])
    } catch {
      return false
    }

    this.records.delete(entry.id)
    await this.save()
    try {
      const children = await readdir(parent)
      if (children.length === 1 && children[0] === '.codex-worktree-name') {
        await rm(marker, { force: true })
        await rmdir(parent)
      }
    } catch { /* The checkout and registry entry are already removed. */ }
    return true
  }

  async create(value: unknown, assertCurrent: () => void = () => {}): Promise<ManagedWorktree> {
    const options = validateWorktreeCreateOptions(value)
    await this.ready
    if (this.records.size >= MAX_RECORDS || this.activeCreates >= MAX_ACTIVE_CREATES) throw new Error('Too many managed worktrees')
    this.activeCreates += 1
    let reservedParent: string | null = null
    let checkoutCreated = false
    let completed = false
    let sourceRoot: string | null = null
    let worktreeGitRoot: string | null = null
    let patchPath: string | null = null
    try {
      const canonicalCwd = await realpath(options.cwd)
      const source = await repository(canonicalCwd)
      sourceRoot = source.root
      const startingRef = options.startingState?.type === 'working-tree'
        ? 'HEAD'
        : options.startingState?.branchName ?? await defaultStartingRef(source.root)
      const sha = (await git(source.root, ['rev-parse', '--verify', '--end-of-options', `${startingRef}^{commit}`])).trim()
      if (!/^[0-9a-f]{40,64}$/i.test(sha)) throw new Error('Starting ref does not resolve to a commit')
      const snapshot = options.startingState?.type === 'working-tree'
        ? await workingTreeSnapshot(source.root, sha)
        : null
      const config = await safeAttributeConfig(source.root)
      assertCurrent()
      await mkdir(this.worktreesRoot, { recursive: true, mode: 0o700 })
      const canonicalRoot = await realpath(this.worktreesRoot)
      if (canonicalRoot !== this.worktreesRoot) throw new Error('Managed worktrees directory was redirected')
      const name = options.name ?? randomUUID().slice(0, 4)
      for (let attempt = 0; attempt <= 5; attempt += 1) {
        const suffix = attempt === 0 ? '' : `-${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`
        const candidate = join(this.worktreesRoot, attempt === 0 ? name : `${name.slice(0, 59).replace(/-+$/, '')}${suffix}`)
        try { await mkdir(candidate, { mode: 0o700 }); reservedParent = candidate; break } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === 5) throw new Error('Could not reserve the worktree directory')
        }
      }
      if (!reservedParent) throw new Error('Could not reserve the worktree directory')
      worktreeGitRoot = join(reservedParent, basename(source.root))
      const worktreeWorkspaceRoot = join(worktreeGitRoot, relative(source.root, canonicalCwd))
      await writeFile(join(reservedParent, '.codex-worktree-name'), '', { mode: 0o600, flag: 'wx' })
      assertCurrent()
      await git(source.root, ['worktree', 'add', '--detach', worktreeGitRoot, sha], config)
      checkoutCreated = true
      assertCurrent()
      if (snapshot?.patch) {
        patchPath = join(reservedParent, '.codex-working-tree.patch')
        await writeFile(patchPath, snapshot.patch, { mode: 0o600, flag: 'wx' })
        await git(worktreeGitRoot, ['apply', '--binary', '--whitespace=nowarn', '--', patchPath], config)
        await rm(patchPath, { force: true })
        patchPath = null
      }
      if (snapshot) await copyUntrackedPaths(source.root, worktreeGitRoot, snapshot.untrackedPaths)
      const entry: WorktreeRecord = { id: randomUUID(), worktreeGitRoot, worktreeWorkspaceRoot,
        sourceRepositoryRoot: source.root, commonDirectory: source.commonDirectory, createdAt: Date.now() }
      this.records.set(entry.id, entry)
      try { await this.save() } catch {
        this.records.delete(entry.id)
        throw new Error('Worktree was created, but its registry could not be saved')
      }
      const result = await this.describe(entry)
      completed = true
      return result
    } finally {
      this.activeCreates -= 1
      if (patchPath) await rm(patchPath, { force: true }).catch(() => {})
      if (reservedParent && !completed) {
        let mayRemoveDirectory = !checkoutCreated
        if (checkoutCreated && sourceRoot && worktreeGitRoot) {
          mayRemoveDirectory = await git(sourceRoot, [
            'worktree', 'remove', '--force', worktreeGitRoot
          ]).then(() => true, () => false)
        }
        if (mayRemoveDirectory) await rm(reservedParent, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}

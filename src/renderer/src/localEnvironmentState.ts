import type { GitBranches } from '../../shared/api'

export interface NewThreadWorktreeChoice { cwd: string; enabled: boolean; branch: string }

export interface LocalBranchSnapshot {
  cwd: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  branches: GitBranches | null
  error: string | null
}

export function normalizeLocalBranchInventory(value: GitBranches): GitBranches {
  if (!value || !Array.isArray(value.localBranches) || !Array.isArray(value.remoteBranches)) throw new Error('Invalid branch inventory')
  const names = (items: string[]): string[] => [...new Set(items.filter((name) =>
    typeof name === 'string' && name.length > 0 && name.trim() === name && !/[\0\r\n]/.test(name) && !name.endsWith('/HEAD')))]
  const localBranches = names(value.localBranches)
  const localSet = new Set(localBranches)
  const remoteBranches = names(value.remoteBranches).filter((name) => !localSet.has(name))
  const all = new Set([...localBranches, ...remoteBranches])
  return { localBranches, remoteBranches,
    currentBranch: value.currentBranch && all.has(value.currentBranch) ? value.currentBranch : null,
    defaultBranch: value.defaultBranch && all.has(value.defaultBranch) ? value.defaultBranch : null }
}

export function localBranchSections(branches: GitBranches, query: string): { label: string; branches: string[] }[] {
  const search = query.trim().toLocaleLowerCase()
  const promoteDefault = (items: string[]): string[] => branches.defaultBranch && items.includes(branches.defaultBranch)
    ? [branches.defaultBranch, ...items.filter((item) => item !== branches.defaultBranch)] : [...items]
  return [
    { label: 'Local branches', branches: promoteDefault(branches.localBranches) },
    { label: 'Remote branches', branches: promoteDefault(branches.remoteBranches) }
  ].map((section) => ({ ...section, branches: section.branches.filter((branch) => branch.toLocaleLowerCase().includes(search)) }))
    .filter((section) => section.branches.length > 0)
}

export function localEnvironmentChoice(cwd: string, choice: NewThreadWorktreeChoice | null): NewThreadWorktreeChoice {
  return choice?.cwd === cwd ? { ...choice } : { cwd, enabled: false, branch: '' }
}

export function selectLocalBranch(cwd: string, choice: NewThreadWorktreeChoice | null, snapshot: LocalBranchSnapshot, branch: string): NewThreadWorktreeChoice | null {
  if (snapshot.cwd !== cwd || snapshot.status !== 'ready' || !snapshot.branches ||
    ![...snapshot.branches.localBranches, ...snapshot.branches.remoteBranches].includes(branch)) return null
  return { ...localEnvironmentChoice(cwd, choice), branch }
}

/** Keeps late directory reads and failed retries from replacing the current picker. */
export class LocalEnvironmentBranchCatalog {
  private state: LocalBranchSnapshot = { cwd: null, status: 'idle', branches: null, error: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private pending: Promise<void> | null = null

  constructor(private read: (cwd: string) => Promise<GitBranches>) {}
  getSnapshot = (): LocalBranchSnapshot => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private update(state: LocalBranchSnapshot): void { this.state = state; this.listeners.forEach((listener) => listener()) }

  load(cwd: string, retry = false): Promise<void> {
    if (this.state.cwd === cwd && !retry) {
      if (this.pending) return this.pending
      if (this.state.status === 'ready') return Promise.resolve()
    }
    const generation = ++this.generation
    this.update({ cwd, status: 'loading', branches: null, error: null })
    const pending = Promise.resolve().then(() => this.read(cwd)).then((value) => {
      if (generation !== this.generation) return
      this.update({ cwd, status: 'ready', branches: normalizeLocalBranchInventory(value), error: null })
    }).catch((error: unknown) => {
      if (generation !== this.generation) return
      this.update({ cwd, status: 'error', branches: null, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { if (generation === this.generation) this.pending = null })
    this.pending = pending
    return pending
  }

  invalidate(): void {
    ++this.generation
    this.pending = null
    this.update({ cwd: null, status: 'idle', branches: null, error: null })
  }
}

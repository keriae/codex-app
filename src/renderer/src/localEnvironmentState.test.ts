import { describe, expect, it, vi } from 'vitest'
import type { GitBranches } from '../../shared/api'
import { LocalEnvironmentBranchCatalog, localBranchSections, localEnvironmentChoice, normalizeLocalBranchInventory, selectLocalBranch } from './localEnvironmentState'

const branches = (): GitBranches => ({ currentBranch: 'feature/local', defaultBranch: 'origin/main',
  localBranches: ['main', 'feature/local'], remoteBranches: ['origin/feature', 'origin/main'] })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('local environment branch inventory', () => {
  it('deduplicates simultaneous reads and preserves the actual remote default', async () => {
    const pending = deferred<GitBranches>()
    const read = vi.fn(() => pending.promise)
    const catalog = new LocalEnvironmentBranchCatalog(read)
    const first = catalog.load('/project'), second = catalog.load('/project')
    expect(second).toBe(first)
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    expect(catalog.getSnapshot().status).toBe('loading')
    pending.resolve(branches())
    await first
    expect(catalog.getSnapshot()).toMatchObject({ cwd: '/project', status: 'ready', branches: branches() })
    await catalog.load('/project')
    expect(read).toHaveBeenCalledOnce()
  })

  it('does not let an earlier directory failure replace the new project', async () => {
    const old = deferred<GitBranches>(), current = deferred<GitBranches>()
    const catalog = new LocalEnvironmentBranchCatalog((cwd) => cwd === '/old' ? old.promise : current.promise)
    const oldLoad = catalog.load('/old'), currentLoad = catalog.load('/current')
    current.resolve(branches())
    await currentLoad
    old.reject(new Error('No longer accessible'))
    await oldLoad
    expect(catalog.getSnapshot()).toMatchObject({ cwd: '/current', status: 'ready', error: null })
  })

  it('leaves the failed state visible and retries without inventing branches', async () => {
    const read = vi.fn<() => Promise<GitBranches>>().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce(branches())
    const catalog = new LocalEnvironmentBranchCatalog(read)
    await catalog.load('/project')
    expect(catalog.getSnapshot()).toMatchObject({ status: 'error', branches: null, error: 'Disconnected' })
    await catalog.load('/project', true)
    expect(read).toHaveBeenCalledTimes(2)
    expect(catalog.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })

  it('ignores results after the popover closes', async () => {
    const pending = deferred<GitBranches>()
    const catalog = new LocalEnvironmentBranchCatalog(() => pending.promise)
    const task = catalog.load('/project')
    catalog.invalidate()
    pending.resolve(branches())
    await task
    expect(catalog.getSnapshot()).toEqual({ cwd: null, status: 'idle', branches: null, error: null })
  })

  it('rejects malformed transport results and filters symbolic HEAD aliases', async () => {
    expect(normalizeLocalBranchInventory({ ...branches(), defaultBranch: 'origin/deleted',
      localBranches: ['main', 'main', ''], remoteBranches: ['origin/HEAD', 'origin/main', 'main'] }))
      .toEqual({ currentBranch: null, defaultBranch: null, localBranches: ['main'], remoteBranches: ['origin/main'] })
    const catalog = new LocalEnvironmentBranchCatalog(async () => ({ localBranches: null } as unknown as GitBranches))
    await catalog.load('/project')
    expect(catalog.getSnapshot()).toMatchObject({ status: 'error', error: 'Invalid branch inventory' })
  })

  it('searches local and remote sections case-insensitively and promotes a known default', () => {
    expect(localBranchSections(branches(), '  ORIGIN  ')).toEqual([{ label: 'Remote branches', branches: ['origin/main', 'origin/feature'] }])
    expect(localBranchSections(branches(), 'local')).toEqual([{ label: 'Local branches', branches: ['feature/local'] }])
    expect(localBranchSections(branches(), 'absent')).toEqual([])
  })

  it('never chooses a typed, missing, loading, or stale-directory branch', () => {
    const snapshot = { cwd: '/project', status: 'ready' as const, branches: branches(), error: null }
    const choice = { cwd: '/project', enabled: true, branch: 'origin/main' }
    expect(selectLocalBranch('/project', choice, snapshot, 'main')).toEqual({ ...choice, branch: 'main' })
    expect(selectLocalBranch('/project', choice, snapshot, 'missing')).toBeNull()
    expect(selectLocalBranch('/other', choice, snapshot, 'main')).toBeNull()
    expect(selectLocalBranch('/project', choice, { ...snapshot, status: 'loading' }, 'main')).toBeNull()
    expect(choice.branch).toBe('origin/main')
  })

  it('preserves the saved branch without enabling worktree during selection, and isolates directories', () => {
    const snapshot = { cwd: '/project', status: 'ready' as const, branches: branches(), error: null }
    expect(selectLocalBranch('/project', null, snapshot, 'origin/main')).toEqual({ cwd: '/project', enabled: false, branch: 'origin/main' })
    expect(localEnvironmentChoice('/other', { cwd: '/project', enabled: true, branch: 'feature/local' }))
      .toEqual({ cwd: '/other', enabled: false, branch: '' })
  })
})

import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../../shared/api'
import { MODEL_PREFERENCE_KEY, selectInitialModel } from './modelPreference'
import { createNavigationHistory, currentNavigationEntry, pushNavigationEntry, replaceCurrentNavigationEntry, type NavigationHistory } from './navigationHistory'
import { overlayProjectPreferences } from './projectPreferences'
import { projectCatalogForSavedPaths } from './projects'
import type { ModelOption, PermissionProfile, Project } from './protocol'
import { canRestoreInitialProject, initialProjectPath, parseSelectedProject, rememberSelectedProject, SELECTED_PROJECT_KEY } from './selectedProject'
import { initialSessionState, sessionReducer, type SessionAction } from './state/sessionReducer'

// Run App's actual bootstrap closure while controlling native context responses.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let bootstrapSource = ''
let permissionEffectSource = ''
function findBootstrap(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'bootstrap' && node.initializer) bootstrapSource = node.initializer.getText(source)
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' &&
    node.arguments.length === 2 && node.arguments[1].getText(source).includes('bootstrapReady') &&
    node.arguments[0].getText(source).includes("'permissionProfile/list'")) permissionEffectSource = node.arguments[0].getText(source)
  ts.forEachChild(node, findBootstrap)
}
findBootstrap(source)
if (!bootstrapSource) throw new Error('App bootstrap handler not found')
if (!permissionEffectSource) throw new Error('App directory-scoped permission effect not found')
const compiled = ts.transpileModule(`const bootstrap = ${bootstrapSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const permissionCompiled = ts.transpileModule(`const permissionEffect = ${permissionEffectSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const homeContext: AppContext = { cwd: '/Users/test', folderName: 'test', branch: null, platform: 'darwin', initialCwdSource: 'home' }
const contextFor = (cwd: string): AppContext => ({ cwd, folderName: cwd.split('/').at(-1)!, branch: null, platform: 'darwin' })
const navigationWorkspaceFields = (context: AppContext | null | undefined) => {
  const hostId = context?.hostId || 'local'
  return {
    hostId,
    projectKind: context?.projectKind || (hostId === 'local' ? 'local' : 'remote'),
    projectId: context?.projectId ?? null
  }
}
const project = (cwd: string, position: number): Project => ({ id: cwd, name: cwd, roots: [{ path: cwd }], position, metadata: {}, createdAt: 0, updatedAt: 0, recencyAt: null })
const catalog = [project('/projects/first', 0), project('/projects/second', 1)]
const model: ModelOption = { id: 'test', model: 'test', displayName: 'Test', description: '', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }] }

function fixture(
  launch: AppContext = homeContext,
  preference?: string,
  savedProjectPaths: string[] = catalog.flatMap((entry) => entry.roots.map((root) => root.path))
) {
  let history = createNavigationHistory({ view: 'chats', threadId: null, cwd: null, draftId: 'draft:initial' })
  let state = initialSessionState
  const values = new Map<string, string>()
  if (preference !== undefined) values.set(SELECTED_PROJECT_KEY, preference)
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const native = {
    getAppContext: vi.fn(async (cwd?: string) => cwd ? contextFor(cwd) : launch),
    setActiveHost: vi.fn().mockResolvedValue(undefined),
    getBackendStatus: vi.fn(async () => ({ state: 'ready', mode: 'direct' })),
    invoke: vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'thread/list') return { data: [], nextCursor: null }
      if (method === 'project/list') return { data: catalog }
      if (method === 'model/list') return { data: [model] }
      if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true, description: null }] }
      throw new Error(`Unexpected bootstrap RPC ${method}`)
    })
  }
  const bindings = {
    window: { codex: native }, localStorage, savedProjectPaths, projectPreferences: { names: {}, hiddenPaths: [] },
    navigationActionRevision: { current: 0 }, draftTerminalScopeRef: { current: 'draft:initial' },
    navigationRef: { current: history },
    selectedThreadIdRef: { current: null as string | null }, activeMainSubmission: { current: null as string | null },
    contextRef: { current: null as AppContext | null },
    setContext: vi.fn((context: AppContext) => { bindings.contextRef.current = context }),
    setNavigation: vi.fn((update: (current: NavigationHistory) => NavigationHistory) => { history = update(history); bindings.navigationRef.current = history }),
    dispatch: vi.fn((action: SessionAction) => { state = sessionReducer(state, action) }),
    setBackend: vi.fn(), setThreadsNextCursor: vi.fn(), seenThreadCursors: { current: new Set<string>() },
    setProjects: vi.fn(), setBootstrapReady: vi.fn(), setModelId: vi.fn(), setEffort: vi.fn(), setPermission: vi.fn(), setAttachmentError: vi.fn(),
    currentNavigationEntry, replaceCurrentNavigationEntry, canRestoreInitialProject, initialProjectPath,
    navigationWorkspaceFields,
    parseSelectedProject, rememberSelectedProject, SELECTED_PROJECT_KEY, projectCatalogForSavedPaths,
    overlayProjectPreferences, selectInitialModel, MODEL_PREFERENCE_KEY, displayError: String
  }
  const actions = new Function(...Object.keys(bindings), `let cancelled = false; ${compiled}\nreturn {run: bootstrap, cancel: () => {cancelled = true}}`)(...Object.values(bindings)) as { run(): Promise<void>; cancel(): void }
  const navigate = (cwd: string): void => {
    ++bindings.navigationActionRevision.current
    bindings.draftTerminalScopeRef.current = 'draft:new'
    bindings.contextRef.current = contextFor(cwd)
    history = createNavigationHistory({ view: 'chats', threadId: null, cwd, draftId: 'draft:new' })
    bindings.navigationRef.current = history
  }
  const navigateSurface = (view: 'settings' | 'projects'): void => {
    ++bindings.navigationActionRevision.current
    history = pushNavigationEntry(history, { view })
    bindings.navigationRef.current = history
  }
  return { ...actions, bindings, native, values, navigate, navigateSurface, history: () => history, state: () => state }
}

function permissionFixture(test: ReturnType<typeof fixture>, initialPermission = ':workspace') {
  let permission = initialPermission
  const setPermission = vi.fn((update: (current: string) => string) => { permission = update(permission) })
  const start = (ready = true, backendState = 'ready'): (() => void) | undefined => {
    const bindings = {
      ...test.bindings,
      bootstrapReady: ready,
      backend: { state: backendState },
      context: test.bindings.contextRef.current,
      appContextHostId: (value: AppContext | null | undefined) => value?.hostId || 'local',
      setPermission
    }
    return new Function(...Object.keys(bindings), `${permissionCompiled}\nreturn permissionEffect()`)(...Object.values(bindings)) as (() => void) | undefined
  }
  return { start, setPermission, permission: () => permission }
}

describe('actual initial project bootstrap handler', () => {
  it('restores the first catalog project on an initial home launch', async () => {
    const test = fixture()
    await test.run()
    expect(test.native.getAppContext.mock.calls).toEqual([[], [catalog[0].roots[0].path]])
    expect(test.bindings.contextRef.current?.cwd).toBe('/projects/first')
    expect(currentNavigationEntry(test.history())).toEqual({
      view: 'chats', threadId: null, cwd: '/projects/first', hostId: 'local',
      projectKind: 'local', projectId: null, draftId: 'draft:initial'
    })
    expect(test.values.get(SELECTED_PROJECT_KEY)).toBe('"/projects/first"')
    expect(test.state().models).toEqual([model])
    expect(test.bindings.setBootstrapReady).toHaveBeenCalledWith(true)
  })

  it('restores the saved catalog root on a subsequent home launch', async () => {
    const test = fixture(homeContext, '"/projects/second"')
    await test.run()
    expect(test.bindings.contextRef.current?.cwd).toBe('/projects/second')
    expect(test.native.getAppContext).toHaveBeenLastCalledWith('/projects/second')
  })

  it('does not restore projects discovered only through a shared app-server catalog', async () => {
    const test = fixture(homeContext, '"/projects/second"', [])
    await test.run()
    expect(test.native.getAppContext).toHaveBeenCalledOnce()
    expect(test.bindings.contextRef.current).toEqual(homeContext)
    expect(currentNavigationEntry(test.history())).toMatchObject({ cwd: homeContext.cwd })
  })

  it.each(['argument', 'environment', 'process', undefined] as const)('keeps a launch cwd with source %s ahead of the saved project', async (source) => {
    const launch = { ...homeContext, cwd: '/', initialCwdSource: source }
    const test = fixture(launch, '"/projects/second"')
    await test.run()
    expect(test.native.getAppContext).toHaveBeenCalledOnce()
    expect(test.bindings.contextRef.current).toEqual(launch)
    expect(currentNavigationEntry(test.history())).toMatchObject({ cwd: '/' })
    expect(test.values.get(SELECTED_PROJECT_KEY)).toBe('"/projects/second"')
  })

  it('retains the user directory when a stale project fails native validation', async () => {
    const test = fixture(homeContext, '"/projects/second"')
    test.native.getAppContext.mockImplementation(async (cwd) => {
      if (cwd) throw new Error('Project no longer exists')
      return homeContext
    })
    await test.run()
    expect(test.bindings.contextRef.current).toEqual(homeContext)
    expect(test.bindings.setBootstrapReady).toHaveBeenCalledWith(true)
    expect(test.state().models).toEqual([model])
  })

  it('does not replace a newer draft when initial native context arrives late', async () => {
    const contextRead = deferred<AppContext>()
    const test = fixture()
    test.native.getAppContext.mockReturnValueOnce(contextRead.promise)
    const pending = test.run()
    test.navigate('/projects/new')
    contextRead.resolve(homeContext)
    await pending
    expect(test.bindings.setContext).not.toHaveBeenCalled()
    expect(test.bindings.contextRef.current?.cwd).toBe('/projects/new')
    expect(currentNavigationEntry(test.history())).toMatchObject({ cwd: '/projects/new', draftId: 'draft:new' })
    expect(test.native.getAppContext).toHaveBeenCalledOnce()
    expect(test.state().models).toEqual([model])
  })

  it.each(['settings', 'projects'] as const)('does not apply a late initial context after navigating to %s', async (surface) => {
    const contextRead = deferred<AppContext>()
    const test = fixture()
    test.native.getAppContext.mockReturnValueOnce(contextRead.promise)
    const pending = test.run()
    test.navigateSurface(surface)
    const index = test.history().index
    contextRead.resolve(homeContext)
    await pending
    expect(test.bindings.contextRef.current).toBeNull()
    expect(currentNavigationEntry(test.history())).toEqual({ view: surface })
    expect(test.history().index).toBe(index)
    expect(test.history().entries[0]).toEqual({
      view: 'chats', threadId: null, cwd: null, draftId: 'draft:initial'
    })
    expect(test.bindings.selectedThreadIdRef.current).toBeNull()
    expect(test.native.getAppContext).toHaveBeenCalledOnce()
    expect(test.values.has(SELECTED_PROJECT_KEY)).toBe(false)
    expect(test.bindings.setBootstrapReady).toHaveBeenCalledWith(true)
  })

  it('never replaces an existing background context with a late initial context on settings', async () => {
    const contextRead = deferred<AppContext>()
    const test = fixture()
    test.native.getAppContext.mockReturnValueOnce(contextRead.promise)
    const pending = test.run()
    test.navigate('/projects/new')
    test.navigateSurface('settings')
    const historyBefore = test.history()
    contextRead.resolve(homeContext)
    await pending
    expect(test.bindings.setContext).not.toHaveBeenCalled()
    expect(test.bindings.contextRef.current?.cwd).toBe('/projects/new')
    expect(test.history()).toEqual(historyBefore)
    expect(currentNavigationEntry(test.history())).toEqual({ view: 'settings' })
  })

  it('does not apply a restored project context after another navigation action', async () => {
    const contextRead = deferred<AppContext>()
    const test = fixture(homeContext, '"/projects/second"')
    test.native.getAppContext.mockImplementation((cwd) => cwd ? contextRead.promise : Promise.resolve(homeContext))
    const pending = test.run()
    await vi.waitFor(() => expect(test.native.getAppContext).toHaveBeenCalledTimes(2))
    test.navigate('/projects/new')
    contextRead.resolve(contextFor('/projects/second'))
    await pending
    expect(test.bindings.setContext).toHaveBeenCalledOnce()
    expect(test.bindings.contextRef.current?.cwd).toBe('/projects/new')
    expect(currentNavigationEntry(test.history())).toMatchObject({ cwd: '/projects/new', draftId: 'draft:new' })
    expect(test.values.get(SELECTED_PROJECT_KEY)).toBe('"/projects/second"')
  })

  it('does not apply initialization after its renderer document is disposed', async () => {
    const contextRead = deferred<AppContext>()
    const test = fixture()
    test.native.getAppContext.mockReturnValueOnce(contextRead.promise)
    const pending = test.run()
    test.cancel()
    contextRead.resolve(homeContext)
    await pending
    expect(test.bindings.setContext).not.toHaveBeenCalled()
    expect(test.native.invoke).not.toHaveBeenCalled()
    expect(test.bindings.setBootstrapReady).not.toHaveBeenCalled()
  })

  it('does not publish bootstrap state when its final status lookup finishes after disposal', async () => {
    const statusRead = deferred<{ state: string; mode: string }>()
    const test = fixture({ ...homeContext, initialCwdSource: 'argument' })
    test.native.getBackendStatus.mockReturnValueOnce(statusRead.promise)
    const pending = test.run()
    await vi.waitFor(() => expect(test.native.getBackendStatus).toHaveBeenCalledOnce())
    test.cancel()
    statusRead.resolve({ state: 'ready', mode: 'direct' })
    await pending
    expect(test.bindings.setBackend).not.toHaveBeenCalled()
    expect(test.bindings.dispatch).not.toHaveBeenCalled()
    expect(test.bindings.setBootstrapReady).not.toHaveBeenCalled()
  })
})

describe('actual directory-scoped permission effect', () => {
  const profiles = (id: string): PermissionProfile[] => [{ id, allowed: true, description: null }]

  it('loads permissions for the restored project without blocking catalog startup', async () => {
    const test = fixture(homeContext, '"/projects/second"')
    await test.run()
    expect(test.native.invoke.mock.calls.map(([method]) => method)).toEqual(['thread/list', 'project/list', 'model/list'])
    expect(test.bindings.setBootstrapReady).toHaveBeenCalledWith(true)
    const permissionRead = deferred<{ data: PermissionProfile[] }>()
    test.native.invoke.mockReturnValueOnce(permissionRead.promise)
    const permission = permissionFixture(test, ':custom')
    const cleanup = permission.start()
    expect(test.native.invoke).toHaveBeenLastCalledWith('permissionProfile/list', { cwd: '/projects/second' }, 'local')
    permissionRead.resolve({ data: profiles(':custom') })
    await vi.waitFor(() => expect(test.state().permissionProfiles).toEqual(profiles(':custom')))
    expect(permission.permission()).toBe(':custom')
    cleanup?.()
  })

  it.each(['argument', 'environment'] as const)('uses the explicit %s launch cwd for permissions', async (source) => {
    const test = fixture({ ...homeContext, cwd: '/', initialCwdSource: source }, '"/projects/second"')
    await test.run()
    const permission = permissionFixture(test)
    const cleanup = permission.start()
    expect(test.native.invoke).toHaveBeenLastCalledWith('permissionProfile/list', { cwd: '/' }, 'local')
    await vi.waitFor(() => expect(test.state().permissionProfiles).toHaveLength(1))
    cleanup?.()
  })

  it('loads the new directory and ignores a slower previous-directory response', async () => {
    const test = fixture({ ...contextFor('/projects/old'), initialCwdSource: 'argument' })
    await test.run()
    const oldRead = deferred<{ data: PermissionProfile[] }>()
    const newRead = deferred<{ data: PermissionProfile[] }>()
    test.native.invoke.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    const permission = permissionFixture(test, ':old')
    const oldCleanup = permission.start()
    test.navigate('/projects/new')
    oldCleanup?.()
    const newCleanup = permission.start()
    expect(test.native.invoke).toHaveBeenLastCalledWith('permissionProfile/list', { cwd: '/projects/new' }, 'local')
    newRead.resolve({ data: profiles(':new') })
    await vi.waitFor(() => expect(test.state().permissionProfiles).toEqual(profiles(':new')))
    oldRead.resolve({ data: profiles(':old') })
    await oldRead.promise
    expect(test.state().permissionProfiles).toEqual(profiles(':new'))
    expect(permission.permission()).toBe(':new')
    newCleanup?.()
  })

  it('rejects a stale result when the context changes before cleanup runs', async () => {
    const test = fixture({ ...contextFor('/projects/old'), initialCwdSource: 'argument' })
    await test.run()
    const response = deferred<{ data: PermissionProfile[] }>()
    test.native.invoke.mockReturnValueOnce(response.promise)
    const permission = permissionFixture(test)
    const cleanup = permission.start()
    test.navigate('/projects/new')
    response.resolve({ data: profiles(':old') })
    await response.promise
    expect(test.state().permissionProfiles).toEqual([])
    expect(permission.setPermission).not.toHaveBeenCalled()
    cleanup?.()
  })

  it('ignores a canceled failure but reports a failure for the current directory', async () => {
    const test = fixture({ ...contextFor('/projects/old'), initialCwdSource: 'argument' })
    await test.run()
    const oldRead = deferred<{ data: PermissionProfile[] }>()
    const currentRead = deferred<{ data: PermissionProfile[] }>()
    test.native.invoke.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(currentRead.promise)
    const permission = permissionFixture(test)
    const oldCleanup = permission.start()
    test.navigate('/projects/new')
    oldCleanup?.()
    const newCleanup = permission.start()
    oldRead.reject(new Error('Old permissions unavailable'))
    await oldRead.promise.catch(() => {})
    expect(test.bindings.setAttachmentError).not.toHaveBeenCalled()
    currentRead.reject(new Error('Current permissions unavailable'))
    await vi.waitFor(() => expect(test.bindings.setAttachmentError).toHaveBeenCalledWith('Error: Current permissions unavailable'))
    newCleanup?.()
  })

  it('waits for bootstrap completion and backend readiness before querying', async () => {
    const test = fixture()
    await test.run()
    test.native.invoke.mockClear()
    const permission = permissionFixture(test)
    expect(permission.start(false)).toBeUndefined()
    expect(permission.start(true, 'starting')).toBeUndefined()
    expect(test.native.invoke).not.toHaveBeenCalled()
  })
})

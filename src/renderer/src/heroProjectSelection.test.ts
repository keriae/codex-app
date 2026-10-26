import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../../shared/api'
import { createNavigationHistory, currentNavigationEntry, pushNavigationEntry, type NavigationHistory } from './navigationHistory'
import { rememberSelectedWorkspace } from './selectedProject'

// Exercise App's actual native picker handler with controllable navigation/submission races.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let pickerSource = ''
function findPicker(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'pickHeroProject' && node.initializer) pickerSource = node.initializer.getText(source)
  ts.forEachChild(node, findPicker)
}
findPicker(source)
if (!pickerSource) throw new Error('Hero project picker handler not found')
const compiled = ts.transpileModule(`const pickHeroProject = ${pickerSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const next: AppContext = { cwd: '/work/next', folderName: 'next', branch: 'main', platform: 'darwin' }

function fixture() {
  let resolve!: (value: AppContext | null) => void
  let reject!: (error: Error) => void
  const result = new Promise<AppContext | null>((accept, fail) => { resolve = accept; reject = fail })
  let history = createNavigationHistory({ view: 'chats', threadId: null, cwd: '/work/current', draftId: 'draft:existing' })
  const draft = { text: 'Continue my unfinished work', attachments: [{ id: 'attached-file' }] }
  const contextRef = { current: { cwd: '/work/current', folderName: 'current', branch: 'main', platform: 'darwin' } as AppContext | null }
  const bindings = {
    draftTerminalScopeRef: { current: 'draft:existing' }, selectedThreadIdRef: { current: null as string | null },
    activeMainSubmission: { current: null as object | null }, pendingDraftSubmissionsRef: { current: new Map<string, unknown>() },
    navigationActionRevision: { current: 0 }, markNavigationAction: vi.fn(() => ++bindings.navigationActionRevision.current),
    window: { codex: {
      pickDirectory: vi.fn(() => result),
      setActiveHost: vi.fn().mockResolvedValue(undefined)
    } }, setContext: vi.fn(),
    contextRef,
    appContextHostId: (value: AppContext | null | undefined) => value?.hostId || 'local',
    loadHostCatalog: vi.fn(), applyHostCatalog: vi.fn(),
    setNavigation: vi.fn((update: (current: NavigationHistory) => NavigationHistory) => { history = update(history) }),
    pushNavigationEntry, setAttachmentError: vi.fn(), setThreadNotice: vi.fn(), displayError: String,
    rememberSelectedWorkspace, localStorage: { setItem: vi.fn() },
    setDraft: vi.fn(), setAttachments: vi.fn(), startNewThread: vi.fn()
  }
  const pick = new Function(...Object.keys(bindings), `${compiled}\nreturn pickHeroProject`)(...Object.values(bindings)) as () => Promise<void>
  return { bindings, draft, pick, resolve, reject, history: () => history }
}

function expectUnchanged(test: ReturnType<typeof fixture>): void {
  expect(test.bindings.setContext).not.toHaveBeenCalled()
  expect(test.bindings.setNavigation).not.toHaveBeenCalled()
  expect(test.bindings.setDraft).not.toHaveBeenCalled()
  expect(test.bindings.setAttachments).not.toHaveBeenCalled()
  expect(test.bindings.startNewThread).not.toHaveBeenCalled()
}

describe('empty conversation project selection', () => {
  it('changes the working directory while retaining the existing draft and attachments', async () => {
    const test = fixture()
    const pending = test.pick()
    expect(test.bindings.window.codex.pickDirectory).toHaveBeenCalledOnce()
    test.resolve(next)
    await pending
    expect(test.bindings.setContext).toHaveBeenCalledWith(next)
    expect(currentNavigationEntry(test.history())).toEqual({
      view: 'chats', threadId: null, cwd: next.cwd, hostId: 'local',
      projectKind: 'local', projectId: null, draftId: 'draft:existing'
    })
    expect(test.bindings.draftTerminalScopeRef.current).toBe('draft:existing')
    expect(test.draft).toEqual({ text: 'Continue my unfinished work', attachments: [{ id: 'attached-file' }] })
    expect(test.bindings.setDraft).not.toHaveBeenCalled()
    expect(test.bindings.setAttachments).not.toHaveBeenCalled()
    expect(test.bindings.startNewThread).not.toHaveBeenCalled()
    expect(test.bindings.setAttachmentError).toHaveBeenCalledWith(null)
  })

  it('leaves a cancelled directory selection unchanged', async () => {
    const test = fixture()
    const pending = test.pick()
    test.resolve(null)
    await pending
    expectUnchanged(test)
    expect(test.bindings.setAttachmentError).not.toHaveBeenCalled()
  })

  it.each(['thread', 'active submission', 'pending draft'] as const)('does not open the native picker with a %s already active', async (condition) => {
    const test = fixture()
    if (condition === 'thread') test.bindings.selectedThreadIdRef.current = 'thread:active'
    if (condition === 'active submission') test.bindings.activeMainSubmission.current = {}
    if (condition === 'pending draft') test.bindings.pendingDraftSubmissionsRef.current.set('draft:existing', {})
    await test.pick()
    expect(test.bindings.window.codex.pickDirectory).not.toHaveBeenCalled()
    expectUnchanged(test)
  })

  it.each(['navigation', 'thread', 'draft scope', 'active submission', 'pending draft'] as const)('ignores a picker result after %s changes while awaiting selection', async (condition) => {
    const test = fixture()
    const pending = test.pick()
    if (condition === 'navigation') test.bindings.navigationActionRevision.current++
    if (condition === 'thread') test.bindings.selectedThreadIdRef.current = 'thread:active'
    if (condition === 'draft scope') test.bindings.draftTerminalScopeRef.current = 'draft:other'
    if (condition === 'active submission') test.bindings.activeMainSubmission.current = {}
    if (condition === 'pending draft') test.bindings.pendingDraftSubmissionsRef.current.set('draft:existing', {})
    test.resolve(next)
    await pending
    expectUnchanged(test)
  })

  it('reports a current picker failure as a notice without replacing the draft', async () => {
    const test = fixture()
    const pending = test.pick()
    test.reject(new Error('Directory picker unavailable'))
    await pending
    expect(test.bindings.setThreadNotice).toHaveBeenCalledWith({ message: 'Error: Directory picker unavailable' })
    expectUnchanged(test)
  })

  it('ignores a picker failure after a newer navigation action', async () => {
    const test = fixture()
    const pending = test.pick()
    test.bindings.navigationActionRevision.current++
    test.reject(new Error('Directory picker unavailable'))
    await pending
    expect(test.bindings.setThreadNotice).not.toHaveBeenCalled()
    expectUnchanged(test)
  })
})

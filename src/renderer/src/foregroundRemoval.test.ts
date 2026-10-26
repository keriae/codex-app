import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { materializeComposerRichDraft } from './composerRichDraft'
import { ownsForegroundOperation } from './foregroundOperation'
import { createNavigationHistory, currentNavigationEntry, replaceCurrentNavigationEntry, type NavigationHistory } from './navigationHistory'

// Exercise the actual App handlers with synthetic state bindings. A removal
// notification can arrive before either the RPC acknowledgement or React commit.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers = new Map<string, string>()
function collect(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
    ['markNavigationAction', 'setResumedThreadId', 'invalidateRemovedThreadSelection', 'submit'].includes(node.name.text)) {
    handlers.set(node.name.text, node.initializer.getText(source))
  }
  ts.forEachChild(node, collect)
}
collect(source)
if (handlers.size !== 4) throw new Error('Foreground removal/submission handlers not found')
const compiled = ts.transpileModule([...handlers].map(([name, text]) => `const ${name} = ${text};`).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText

function fixture() {
  let history = createNavigationHistory({view: 'chats', threadId: 'chat', cwd: '/project'})
  const bindings = {
    navigationActionRevision: { current: 4 }, navigationInFlight: { current: true },
    activeMainSubmission: { current: 'pending-send' as string | null },
    selectedThreadIdRef: { current: 'chat' as string | null }, selectSequence: { current: 7 },
    reconnectThreadId: { current: 'chat' as string | null },
    resumedThreadId: 'chat' as string | null,
    resumedThreadIdRef: { current: 'chat' as string | null },
    updateResumedThreadId: vi.fn((threadId: string | null) => { bindings.resumedThreadId = threadId }),
    removedThreadIds: {current: new Set<string>()}, draftTerminalScopeRef: {current: 'draft:old'},
    mainTurnStarting: false, selectedSession: null, draft: 'Unsent text', attachments: [], composerMode: 'default',
    materializeComposerRichDraft, threadGoals: {},
    backend: {state: 'ready'}, context: {cwd: '/project'}, selectedModel: {model: 'test'},
    state: {selectedThreadId: null as string | null}, draftTerminalScope: 'draft:old',
    pendingDraftSubmissionsRef: {current: new Map<string, {id: string}>()},
    terminalScopes: {current: new Map<string, string>()},
    buildTurnInput: () => [{type: 'text', text: 'Unsent text'}],
    diffCommentsStore: {getSnapshot: () => []}, diffCommentScope: 'draft:old',
    setDraft: vi.fn(), setAttachments: vi.fn(), setAttachmentError: vi.fn(),
    setDraftTerminalScope: vi.fn(), contextRef: {current: {cwd: '/project'}},
    navigationWorkspaceFields: (value: {hostId?: string; projectKind?: 'local' | 'remote' | 'projectless'; projectId?: string | null} | null | undefined) => {
      const hostId = value?.hostId || 'local'
      return {
        hostId,
        projectKind: value?.projectKind || (hostId === 'local' ? 'local' : 'remote'),
        projectId: value?.projectId ?? null
      }
    },
    crypto: {randomUUID: () => 'fresh'}, currentNavigationEntry, replaceCurrentNavigationEntry,
    setNavigation: vi.fn((update: (previous: NavigationHistory) => NavigationHistory) => { history = update(history) }),
    setNavigationBusy: vi.fn(), setMainTurnStarting: vi.fn(), setMainTurnThinking: vi.fn(),
    setWorktreeCreating: vi.fn(), setPendingUserMessage: vi.fn(), setLoadedThreadId: vi.fn(),
    setHydrating: vi.fn(), setHistoryLoadingEarlier: vi.fn(), setHistoryNextCursor: vi.fn(), setHistoryError: vi.fn()
  }
  const actions = new Function(...Object.keys(bindings), `${compiled}\nreturn {remove: invalidateRemovedThreadSelection, submit}`)(
    ...Object.values(bindings)
  ) as {remove(threadId: string): void; submit(): Promise<void>}
  return { bindings, ...actions, getHistory: () => history }
}

describe('foreground removal before asynchronous responses', () => {
  it('invalidates a pending turn acknowledgement before it can update the empty chat', async () => {
    const { bindings, remove } = fixture()
    const operation = { id: 'pending-send', revision: 4, cwd: '/project' }
    let acknowledge!: () => void
    const response = new Promise<void>((resolve) => { acknowledge = resolve })
    const writeThinking = vi.fn()
    const applying = response.then(() => {
      if (ownsForegroundOperation(operation, {
        activeId: bindings.activeMainSubmission.current,
        revision: bindings.navigationActionRevision.current, cwd: '/project'
      })) writeThinking()
    })
    remove('chat')
    acknowledge()
    await applying
    expect(writeThinking).not.toHaveBeenCalled()
    expect(bindings.selectedThreadIdRef.current).toBeNull()
    expect(bindings.resumedThreadIdRef.current).toBeNull()
    expect(bindings.resumedThreadId).toBeNull()
    expect(bindings.updateResumedThreadId).toHaveBeenCalledWith(null)
    expect(bindings.setMainTurnStarting).toHaveBeenCalledWith(false)
    expect(bindings.setMainTurnThinking).toHaveBeenCalledWith(false)
    expect(bindings.setPendingUserMessage).toHaveBeenCalledWith(null)
  })

  it('invalidates a pending history read and remains idempotent when the mutation also acknowledges', () => {
    const { bindings, remove } = fixture()
    const historySequence = bindings.selectSequence.current
    remove('chat')
    remove('chat')
    expect(bindings.selectSequence.current).not.toBe(historySequence)
    expect(bindings.navigationActionRevision.current).toBe(5)
    expect(bindings.reconnectThreadId.current).toBeNull()
    expect(bindings.setLoadedThreadId).toHaveBeenCalledWith(null)
    expect(bindings.resumedThreadIdRef.current).toBeNull()
    expect(bindings.updateResumedThreadId).toHaveBeenCalledTimes(1)
    expect(bindings.setHydrating).toHaveBeenCalledWith(false)
  })

  it('does not cancel the foreground send when a different chat is removed', () => {
    const { bindings, remove } = fixture()
    remove('background-chat')
    expect(bindings.activeMainSubmission.current).toBe('pending-send')
    expect(bindings.navigationActionRevision.current).toBe(4)
    expect(bindings.selectedThreadIdRef.current).toBe('chat')
    expect(bindings.resumedThreadIdRef.current).toBe('chat')
    expect(bindings.resumedThreadId).toBe('chat')
    expect(bindings.updateResumedThreadId).not.toHaveBeenCalled()
    expect(bindings.setLoadedThreadId).not.toHaveBeenCalled()
  })
  it('gives the new empty chat a fresh scope instead of sharing the archived chat terminal', () => {
    const {bindings, remove, getHistory} = fixture()
    remove('chat')
    expect(bindings.draftTerminalScopeRef.current).toBe('draft:fresh')
    expect(bindings.setDraftTerminalScope).toHaveBeenCalledWith('draft:fresh')
    expect(currentNavigationEntry(getHistory())).toEqual({
      view: 'chats', threadId: null, cwd: '/project', hostId: 'local',
      projectKind: 'local', projectId: null, draftId: 'draft:fresh'
    })
  })
  it('does not submit again when returning to a draft whose first request is still pending', async () => {
    const {bindings, submit} = fixture()
    bindings.activeMainSubmission.current = null
    bindings.pendingDraftSubmissionsRef.current.set('draft:old', {id: 'original-send'})
    await expect(submit()).resolves.toBeUndefined()
    expect(bindings.setDraft).not.toHaveBeenCalled()
    expect(bindings.setAttachments).not.toHaveBeenCalled()
  })
  it('also blocks a second send after the pending draft has become a background-created chat', async () => {
    const {bindings, submit} = fixture()
    bindings.activeMainSubmission.current = null
    bindings.state.selectedThreadId = 'created-chat'
    bindings.terminalScopes.current.set('created-chat', 'draft:old')
    bindings.pendingDraftSubmissionsRef.current.set('draft:old', {id: 'original-send'})
    await expect(submit()).resolves.toBeUndefined()
    expect(bindings.setDraft).not.toHaveBeenCalled()
  })
})

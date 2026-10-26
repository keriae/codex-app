import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext, ComposerAttachmentSelection } from '../../shared/api'
import { buildTurnInput, mergeComposerAttachments } from './composerAttachments'
import { collaborationModeForTurn } from './composerMode'
import { materializeComposerRichDraft } from './composerRichDraft'
import { serializeDiffComments, type DiffCommentAttachment } from './diffComments'
import { DiffCommentsStore } from './diffCommentsStore'
import { canReclaimDraftSubmission, draftRecoveryWorktreeChoice } from './draftSubmissionLifecycle'
import { createdThreadAction, ownsForegroundOperation } from './foregroundOperation'
import { createNavigationHistory, currentNavigationEntry, pushNavigationEntry, resolveDraftNavigationEntries, type NavigationHistory } from './navigationHistory'
import type { Thread, Turn } from './protocol'
import { initialSessionState, sessionReducer, type SessionAction, type SessionState } from './state/sessionReducer'
import { hasAuthoritativeClientMessage, isTerminalTurnStatus, isThreadReadyForComposer, isUnknownMutationError } from './threadContinuity'

// Execute the real App submission/reconciliation handlers and composer restore
// callbacks. Native RPC boundaries stay controllable; the actual input builder,
// comment store, navigation helpers and session reducer run without substitutes.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['markNavigationAction', 'setResumedThreadId', 'setDraft', 'setAttachments', 'restoreComposerDraft', 'settlePendingSteerFromTurns', 'submit'])
const handlers = new Map<string, string>()
let recoverySource = ''
let dismissSource = ''
function collect(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && names.has(node.name.text)) handlers.set(node.name.text, node.initializer.getText(source))
  if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onClick' && node.initializer && ts.isJsxExpression(node.initializer) &&
    node.initializer.expression && ts.isArrowFunction(node.initializer.expression) && node.initializer.expression.getText(source).includes('diffCommentsStore.move(recovery.commentScope, restoredScope)')) {
    recoverySource = node.initializer.expression.getText(source)
  }
  if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onClick' && node.initializer && ts.isJsxExpression(node.initializer) &&
    node.initializer.expression && ts.isArrowFunction(node.initializer.expression) && node.initializer.expression.getText(source).includes('diffCommentsStore.clear(recovery.commentScope)')) {
    dismissSource = node.initializer.expression.getText(source)
  }
  ts.forEachChild(node, collect)
}
collect(source)
if (handlers.size !== names.size || !recoverySource || !dismissSource) throw new Error('Actual App comment submission/recovery handlers not found')
const compiled = ts.transpileModule([...handlers].map(([name, text]) => `const ${name} = ${text};`).join('\n') +
  `\nconst restoreFailedDraft = ${recoverySource};\nconst dismissFailedDraft = ${dismissSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

interface ComposerDraft { text: string; attachments: ComposerAttachmentSelection[] }
interface SteerRecovery {
  threadId: string; turnId: string; clientId: string; text: string; attachments: ComposerAttachmentSelection[]
  comments: readonly DiffCommentAttachment[]
}
interface FailedRecovery {
  id: string; cwd: string; text: string; attachments: ComposerAttachmentSelection[]; message: string
  commentScope?: string; worktreeChoice?: unknown
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const comment = (id: string, text = id): DiffCommentAttachment => ({ id, type: 'comment',
  position: { path: 'src/a.ts', side: 'right', line: 4 }, content: [{ content_type: 'text', text }], localWorkspaceRoot: '/project' })
const thread = (id: string): Thread => ({ id, cwd: '/project', preview: '', createdAt: 1, updatedAt: 1, turns: [], status: { type: 'idle' } })
const turn = (status: Turn['status'] = 'inProgress', items: Turn['items'] = []): Turn => ({ id: 'turn:active', status, items })
const context: AppContext = { cwd: '/project', folderName: 'project', branch: 'main', platform: 'darwin' }

function fixture({
  draft = false,
  running = false,
  text = '',
  writable = true,
  reviewer = 'user'
}: {
  draft?: boolean
  running?: boolean
  text?: string
  writable?: boolean
  reviewer?: 'user' | 'auto_review'
} = {}) {
  const scope = draft ? 'draft:original' : 'thread:original'
  const startedThread = deferred<{
    thread: Thread
    approvalsReviewer?: 'user' | 'auto_review' | 'guardian_subagent'
  }>()
  const startedTurn = deferred<{ turn: Turn }>()
  const steeredTurn = deferred<{ turnId: string }>()
  const store = new DiffCommentsStore()
  let drafts: Record<string, ComposerDraft> = { [scope]: { text, attachments: [] } }
  let pendingDrafts: Record<string, unknown> = {}
  let layouts: Record<string, string> = {}
  let failedRecoveries: FailedRecovery[] = []
  let id = 0
  const timers = new Map<number, () => void>()
  const state: SessionState = { ...initialSessionState,
    selectedThreadId: draft ? null : scope, threads: draft ? [] : [thread(scope)],
    sessions: draft ? {} : { [scope]: { turns: running ? [turn()] : [], activeTurnId: running ? 'turn:active' : null, running, error: null } }
  }
  const navigationRef = { current: createNavigationHistory({ view: 'chats', threadId: draft ? null : scope,
    cwd: '/project', ...(draft ? { draftId: scope } : {}) }) }
  const stateRef = { current: state }
  const selectedThreadIdRef = { current: state.selectedThreadId }
  const draftTerminalScopeRef = { current: draft ? scope : 'draft:unused' }
  const contextRef = { current: context as AppContext | null }
  const bindings = {
    mainTurnStarting: false, selectedSession: draft ? null : state.sessions[scope], activeMainSubmission: { current: null as string | null },
    draft: text, attachments: [] as ComposerAttachmentSelection[], composerDraftKey: scope, composerMode: 'default',
    materializeComposerRichDraft, threadGoals: {},
    diffCommentsStore: store, diffCommentScope: scope, buildTurnInput, backend: { state: 'ready' }, context,
    selectedModel: { model: 'test-model' }, state, stateRef, draftTerminalScope: draftTerminalScopeRef.current,
    draftTerminalScopeRef, selectedThreadIdRef, contextRef, navigationRef,
    pendingDraftSubmissionsRef: { current: new Map<string, { id: string }>() }, terminalScopes: { current: new Map<string, string>() },
    pendingSteerRecoveries: { current: new Map<string, SteerRecovery>() },
    // A normal existing-chat fixture has completed thread/resume. A readable
    // transcript alone deliberately leaves this actual writer gate empty.
    loadedThreadId: draft ? null : scope,
    resumedThreadId: !draft && writable ? scope : null as string | null,
    resumedThreadIdRef: { current: !draft && writable ? scope : null as string | null },
    updateResumedThreadId: vi.fn((threadId: string | null) => { bindings.resumedThreadId = threadId }),
    hydrating: false, steering: false,
    queueingEnabled: false, editingQueuedMessage: null,
    queuedMessagesByThreadRef: { current: {} },
    enqueueQueuedFollowUp: vi.fn(), updateQueuedFollowUp: vi.fn(),
    crypto: { randomUUID: () => 'client:submission' }, navigationActionRevision: { current: 7 }, navigationInFlight: { current: false },
    newThreadWorktreeChoice: null, permission: null, approvalsReviewer: reviewer, effort: 'low', newThreadWorkspaceLayout: 'split',
    preparedWorktrees: { current: { prepare: vi.fn(() => { throw new Error('Unexpected worktree preparation') }), peek: () => undefined } },
    removedThreadIds: { current: new Set<string>() },
    currentNavigationEntry, pushNavigationEntry, resolveDraftNavigationEntries, canReclaimDraftSubmission, draftRecoveryWorktreeChoice,
    ownsForegroundOperation, createdThreadAction, isThreadReadyForComposer, isUnknownMutationError, hasAuthoritativeClientMessage, isTerminalTurnStatus,
    mergeComposerAttachments, collaborationModeForTurn,
    appContextHostId: (value: AppContext | null | undefined) => value?.hostId || 'local',
    threadHostId: (value: Thread | null | undefined) => value?.hostId || 'local',
    hostIdForThreadId: vi.fn(() => 'local'),
    displayError: (error: unknown) => error instanceof Error ? error.message : String(error),
    window: {
      setTimeout: vi.fn((callback: () => void) => { const handle = ++id; timers.set(handle, callback); return handle }),
      clearTimeout: (handle: number) => { timers.delete(handle) },
      requestAnimationFrame: (callback: () => void) => { const handle = ++id; queueMicrotask(callback); return handle },
      cancelAnimationFrame: vi.fn(),
      codex: {
        invoke: vi.fn((method: string, _params: Record<string, unknown>): Promise<unknown> => {
          if (method === 'thread/start') return startedThread.promise
          if (method === 'turn/start') return startedTurn.promise
          if (method === 'turn/steer') return steeredTurn.promise
          throw new Error(`Unexpected RPC method: ${method}`)
        }),
        getAppContext: vi.fn(async () => context),
        setActiveHost: vi.fn().mockResolvedValue(undefined)
      }
    },
    dispatch: vi.fn((action: SessionAction) => { stateRef.current = sessionReducer(stateRef.current, action) }),
    setComposerDrafts: vi.fn((update: (current: Record<string, ComposerDraft>) => Record<string, ComposerDraft>) => { drafts = update(drafts) }),
    setComposerModes: vi.fn(),
    setPendingDraftSubmissions: vi.fn((update: (current: Record<string, unknown>) => Record<string, unknown>) => { pendingDrafts = update(pendingDrafts) }),
    setNavigation: vi.fn((update: (current: NavigationHistory) => NavigationHistory) => { navigationRef.current = update(navigationRef.current) }),
    setWorkspaceLayouts: vi.fn((update: (current: Record<string, string>) => Record<string, string>) => { layouts = update(layouts) }),
    setFailedDraftRecoveries: vi.fn((update: (current: FailedRecovery[]) => FailedRecovery[]) => { failedRecoveries = update(failedRecoveries); bindings.failedDraftRecoveries = failedRecoveries }),
    failedDraftRecoveries: failedRecoveries, threadNotice: null,
    setContext: vi.fn((next: AppContext) => { contextRef.current = next }),
    setDraftWorktreeChoices: vi.fn(), setThreadNotice: vi.fn(), setAttachmentError: vi.fn(), setSteering: vi.fn(),
    setMainTurnStarting: vi.fn(), setMainTurnThinking: vi.fn(), setWorktreeCreating: vi.fn(), setPendingUserMessage: vi.fn(),
    setApprovalsReviewer: vi.fn(), canonicalApprovalsReviewer: (reviewer: string | null | undefined) => reviewer === 'guardian_subagent' ? 'auto_review' : reviewer || 'user',
    setLoadedThreadId: vi.fn(), setNavigationBusy: vi.fn(),
    startNewThread: vi.fn(() => { selectedThreadIdRef.current = null; draftTerminalScopeRef.current = 'draft:restored'; return 'draft:restored' })
  }
  // failedDraftRecoveries is a render value; rebinding recreates the real handler
  // after the catch updates its state, just as React's next render would do.
  const bindActions = () => new Function(...Object.keys(bindings), `${compiled}\nreturn { submit, reconcile: settlePendingSteerFromTurns, restoreFailedDraft, dismissFailedDraft, markNavigationAction, setWriter: setResumedThreadId }`)(...Object.values(bindings)) as {
    submit(): Promise<void>; reconcile(threadId: string, turns: Turn[]): void; restoreFailedDraft(): void; dismissFailedDraft(): void; markNavigationAction(): number; setWriter(threadId: string | null): void
  }
  const actions = bindActions()
  const navigate = (nextScope: string): void => {
    actions.markNavigationAction()
    actions.setWriter(null)
    selectedThreadIdRef.current = nextScope.startsWith('draft:') ? null : nextScope
    draftTerminalScopeRef.current = nextScope.startsWith('draft:') ? nextScope : 'draft:unused'
    navigationRef.current = pushNavigationEntry(navigationRef.current, { view: 'chats', threadId: selectedThreadIdRef.current,
      cwd: '/project', ...(selectedThreadIdRef.current ? {} : { draftId: nextScope }) })
  }
  return { scope, store, actions, bindActions, bindings, navigate, startedThread, startedTurn, steeredTurn,
    drafts: () => drafts, recoveries: () => failedRecoveries, pendingDrafts: () => pendingDrafts, layouts: () => layouts }
}

async function reaches(test: ReturnType<typeof fixture>, method: string): Promise<Record<string, unknown>> {
  for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  const call = test.bindings.window.codex.invoke.mock.calls.find(([candidate]) => candidate === method)
  expect(call, `The real App handler must reach ${method}; fixture errors must not masquerade as recovery`).toBeDefined()
  return call![1]
}
function expectNoSubmissionFailure(test: ReturnType<typeof fixture>): void {
  expect(test.bindings.dispatch.mock.calls.some(([action]) => action.type === 'turnFailed' || action.type === 'steerFailed' || action.type === 'steerUnknown')).toBe(false)
  expect(test.bindings.setThreadNotice).not.toHaveBeenCalled()
  expect(test.recoveries()).toEqual([])
}

describe('actual App review-comment submission lifecycle', () => {
  it.each([false, true])('rejects a read-only %s running chat before clearing draft or review comments or sending a mutation', async (running) => {
    const test = fixture({ running, text: 'Keep this draft', writable: false })
    const submitted = comment('read-only-review')
    test.store.set(test.scope, [submitted])
    expect(test.bindings.loadedThreadId).toBe(test.scope)
    expect(test.bindings.resumedThreadIdRef.current).toBeNull()
    await test.bindActions().submit()
    expect(test.bindings.window.codex.invoke).not.toHaveBeenCalled()
    expect(test.drafts()[test.scope].text).toBe('Keep this draft')
    expect(test.store.getSnapshot(test.scope)).toEqual([submitted])
    expect(test.bindings.setComposerDrafts).not.toHaveBeenCalled()
    expect(test.bindings.dispatch).not.toHaveBeenCalled()
    expect(test.bindings.setAttachmentError).toHaveBeenCalledWith('此聊天正由其他客户端处理。重新连接成功后即可发送消息。')
    expectNoSubmissionFailure(test)
  })

  it('sends comment-only input through turn/start and clears it only after acknowledgement', async () => {
    const test = fixture()
    const submitted = comment('review', 'Handle the empty array')
    test.store.set(test.scope, [submitted])
    const pending = test.actions.submit()
    const request = await reaches(test, 'turn/start')
    expect(test.bindings.resumedThreadIdRef.current).toBe(test.scope)
    expect(request).toMatchObject({ threadId: test.scope, input: [{ type: 'text', text: serializeDiffComments([submitted]), text_elements: [] }] })
    expect(test.bindings.window.codex.invoke.mock.calls.map(([method]) => method)).toEqual(['turn/start'])
    expect(test.store.getSnapshot(test.scope)).toEqual([submitted])
    test.startedTurn.resolve({ turn: turn() })
    await pending
    expect(test.store.getSnapshot(test.scope)).toEqual([])
    expectNoSubmissionFailure(test)
  })

  it('forwards auto-review through thread creation and the first turn', async () => {
    const test = fixture({ draft: true, text: 'Inspect safely', reviewer: 'auto_review' })
    const pending = test.actions.submit()
    const threadRequest = await reaches(test, 'thread/start')
    expect(threadRequest.approvalsReviewer).toBe('auto_review')
    test.startedThread.resolve({
      thread: thread('thread:auto-review'),
      approvalsReviewer: 'guardian_subagent'
    })
    const turnRequest = await reaches(test, 'turn/start')
    expect(turnRequest).toMatchObject({
      threadId: 'thread:auto-review',
      approvalsReviewer: 'auto_review'
    })
    test.startedTurn.resolve({ turn: turn() })
    await pending
    expectNoSubmissionFailure(test)
  })

  it('moves a background-created draft into its assigned thread without consuming the newly selected draft', async () => {
    const test = fixture({ draft: true })
    test.store.set(test.scope, [comment('submitted'), comment('edited')])
    const pending = test.actions.submit()
    await reaches(test, 'thread/start')
    test.store.upsert(test.scope, comment('edited', 'Edited before creation acknowledged'))
    test.store.upsert(test.scope, comment('new-before-creation'))
    test.navigate('draft:other')
    test.store.set('draft:other', [comment('submitted')])
    test.startedThread.resolve({ thread: thread('thread:created') })
    const request = await reaches(test, 'turn/start')
    expect(request.threadId).toBe('thread:created')
    expect(test.store.getSnapshot(test.scope)).toEqual([])
    expect(test.store.getSnapshot('thread:created')).toHaveLength(3)
    expect(test.bindings.selectedThreadIdRef.current).toBeNull()
    expect(test.bindings.resumedThreadIdRef.current).toBeNull()
    expect(test.bindings.updateResumedThreadId).not.toHaveBeenCalledWith('thread:created')
    expect(currentNavigationEntry(test.bindings.navigationRef.current)).toMatchObject({ view: 'chats', draftId: 'draft:other' })
    expect(test.bindings.dispatch.mock.calls.some(([action]) => action.type === 'threadUpserted' && action.thread.id === 'thread:created')).toBe(true)
    expect(test.bindings.dispatch.mock.calls.some(([action]) => action.type === 'threadHydrated')).toBe(false)
    test.store.upsert('thread:created', comment('new-after-creation'))
    test.startedTurn.resolve({ turn: turn() })
    await pending
    expect(test.store.getSnapshot('thread:created').map((item) => item.id)).toEqual(['edited', 'new-before-creation', 'new-after-creation'])
    expect(test.store.getSnapshot('draft:other')).toEqual([comment('submitted')])
    expect(test.pendingDrafts()).toEqual({})
    expectNoSubmissionFailure(test)
  })

  it('retains pending edits and additions while clearing only the original thread snapshot', async () => {
    const test = fixture()
    test.store.set(test.scope, [comment('unchanged'), comment('edited')])
    const pending = test.actions.submit()
    await reaches(test, 'turn/start')
    test.store.upsert(test.scope, comment('edited', 'Changed while waiting'))
    test.store.upsert(test.scope, comment('new'))
    test.navigate('thread:other')
    test.store.set('thread:other', [comment('unchanged')])
    test.startedTurn.resolve({ turn: turn() })
    await pending
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('edited', 'Changed while waiting'), comment('new')])
    expect(test.store.getSnapshot('thread:other')).toEqual([comment('unchanged')])
    expectNoSubmissionFailure(test)
  })

  it('preserves distinct equal-content comments added around thread creation while clearing only the submitted identities', async () => {
    const test = fixture({ draft: true })
    const submitted = [comment('submitted-one', 'Same body'), comment('submitted-two', 'Same body')]
    test.store.set(test.scope, submitted)
    const pending = test.actions.submit()
    await reaches(test, 'thread/start')
    test.store.upsert(test.scope, comment('new-before-creation', 'Same body'))
    test.startedThread.resolve({ thread: thread('thread:created') })
    const request = await reaches(test, 'turn/start')
    expect(test.bindings.resumedThreadIdRef.current).toBe('thread:created')
    expect(test.bindings.updateResumedThreadId).toHaveBeenCalledWith('thread:created')
    expect(request.input).toEqual(buildTurnInput('', [], submitted))
    expect(test.store.getSnapshot('thread:created').map((item) => item.id)).toEqual(['submitted-one', 'submitted-two', 'new-before-creation'])
    test.store.upsert('thread:created', comment('new-after-creation', 'Same body'))
    test.navigate('draft:other')
    test.store.set('draft:other', [comment('submitted-one', 'Same body')])
    test.startedTurn.resolve({ turn: turn() })
    await pending
    expect(test.store.getSnapshot('thread:created')).toEqual([comment('new-before-creation', 'Same body'), comment('new-after-creation', 'Same body')])
    expect(test.store.getSnapshot('draft:other')).toEqual([comment('submitted-one', 'Same body')])
    expectNoSubmissionFailure(test)
  })

  it('preserves comments and restores text to the submission thread after a definite start failure', async () => {
    const test = fixture({ text: 'Submitted text' })
    test.store.set(test.scope, [comment('submitted')])
    const pending = test.actions.submit()
    await reaches(test, 'turn/start')
    test.store.upsert(test.scope, comment('edited-later'))
    test.navigate('thread:other')
    test.store.set('thread:other', [comment('other')])
    test.startedTurn.reject(new Error('Permission denied'))
    await pending
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('submitted'), comment('edited-later')])
    expect(test.store.getSnapshot('thread:other')).toEqual([comment('other')])
    expect(test.drafts()[test.scope].text).toBe('Submitted text')
    expect(test.drafts()['thread:other']).toBeUndefined()
    expect(test.bindings.dispatch.mock.calls).toContainEqual([{ type: 'turnFailed', threadId: test.scope, message: 'Permission denied' }])
  })

  it('restores a failed background snapshot without moving later comments from the source or another draft', async () => {
    const test = fixture({ draft: true, text: 'Recover this' })
    test.store.set(test.scope, [comment('submitted')])
    const pending = test.actions.submit()
    await reaches(test, 'thread/start')
    test.store.upsert(test.scope, comment('submitted', 'Edited before failure'))
    test.store.upsert(test.scope, comment('new-before-failure'))
    test.navigate('draft:other')
    test.store.set('draft:other', [comment('other')])
    test.startedThread.reject(new Error('Unable to create conversation'))
    await pending
    expect(test.recoveries()).toHaveLength(1)
    const recovery = test.recoveries()[0]
    expect(recovery.commentScope).toBe('recovery:client:submission')
    expect(test.store.getSnapshot(recovery.commentScope!)).toEqual([comment('submitted')])
    test.store.upsert(test.scope, comment('submitted', 'Edited after failure'))
    test.store.upsert(test.scope, comment('new-after-failure'))
    test.bindActions().restoreFailedDraft()
    for (let tick = 0; tick < 8; tick++) await Promise.resolve()
    expect(test.bindings.startNewThread).toHaveBeenCalledWith(true, '/project', undefined, 'local', context)
    expect(test.store.getSnapshot('draft:restored')).toEqual([comment('submitted')])
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('submitted', 'Edited after failure'), comment('new-before-failure'), comment('new-after-failure')])
    expect(test.store.getSnapshot('draft:other')).toEqual([comment('other')])
    expect(test.store.getSnapshot(recovery.commentScope!)).toEqual([])
    expect(test.drafts()['draft:restored'].text).toBe('Recover this')
    expect(test.recoveries()).toEqual([])
  })

  it('dismisses only the private failure recovery comments and preserves the source draft', async () => {
    const test = fixture({ draft: true })
    test.store.set(test.scope, [comment('submitted')])
    const pending = test.actions.submit()
    await reaches(test, 'thread/start')
    test.navigate('draft:other')
    test.store.set('draft:other', [comment('other')])
    test.startedThread.reject(new Error('Unable to create conversation'))
    await pending
    const recovery = test.recoveries()[0]
    expect(test.store.getSnapshot(recovery.commentScope!)).toEqual([comment('submitted')])
    test.store.upsert(test.scope, comment('new-after-failure'))
    test.bindActions().dismissFailedDraft()
    expect(test.store.getSnapshot(recovery.commentScope!)).toEqual([])
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('submitted'), comment('new-after-failure')])
    expect(test.store.getSnapshot('draft:other')).toEqual([comment('other')])
    expect(test.recoveries()).toEqual([])
  })

  it('sends comment-only steer input and retains edits or additions while awaiting the ack', async () => {
    const test = fixture({ running: true })
    test.store.set(test.scope, [comment('unchanged'), comment('edited')])
    const pending = test.actions.submit()
    const request = await reaches(test, 'turn/steer')
    expect(request).toMatchObject({ threadId: test.scope, expectedTurnId: 'turn:active', clientUserMessageId: 'client:submission' })
    expect(request.input).toEqual(buildTurnInput('', [], [comment('unchanged'), comment('edited')]))
    test.store.upsert(test.scope, comment('edited', 'Changed while steering'))
    test.store.upsert(test.scope, comment('new'))
    test.steeredTurn.resolve({ turnId: 'turn:active' })
    await pending
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('edited', 'Changed while steering'), comment('new')])
    expectNoSubmissionFailure(test)
  })

  it('routes Enter during a running turn to the durable queue with attachments and review comments', async () => {
    const test = fixture({ running: true, text: 'Run this next' })
    const attachment: ComposerAttachmentSelection = {
      kind: 'image', name: 'screen.png', path: '/project/screen.png'
    }
    test.bindings.attachments.push(attachment)
    test.bindings.queueingEnabled = true
    const submitted = comment('queued-review')
    test.store.set(test.scope, [submitted])

    await test.bindActions().submit()

    expect(test.bindings.enqueueQueuedFollowUp).toHaveBeenCalledWith({
      threadId: test.scope,
      clientUserMessageId: 'client:submission',
      input: buildTurnInput('Run this next', [attachment], [submitted]),
      text: 'Run this next',
      draftText: 'Run this next',
      attachments: [attachment],
      comments: [submitted]
    })
    expect(test.bindings.window.codex.invoke).not.toHaveBeenCalledWith(
      'turn/steer', expect.anything()
    )
  })

  it('keeps comment attachments after a definite steer failure and restores the captured text', async () => {
    const test = fixture({ running: true, text: 'Try this adjustment' })
    test.store.set(test.scope, [comment('review')])
    const pending = test.actions.submit()
    await reaches(test, 'turn/steer')
    test.steeredTurn.reject(new Error('The active turn changed'))
    await pending
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('review')])
    expect(test.drafts()[test.scope].text).toBe('Try this adjustment')
    expect(test.bindings.pendingSteerRecoveries.current.size).toBe(0)
    expect(test.bindings.dispatch.mock.calls.some(([action]) => action.type === 'steerFailed' && action.threadId === test.scope)).toBe(true)
  })

  it('reconciles an unknown steer against its original scope and preserves waiting edits and another thread', async () => {
    const test = fixture({ running: true })
    test.store.set(test.scope, [comment('submitted'), comment('edited')])
    const pending = test.actions.submit()
    await reaches(test, 'turn/steer')
    test.steeredTurn.reject(new Error('App-server stopped before the response arrived'))
    await pending
    const recovery = test.bindings.pendingSteerRecoveries.current.get(test.scope)
    expect(recovery?.comments).toEqual([comment('submitted'), comment('edited')])
    expect(test.store.getSnapshot(test.scope)).toHaveLength(2)
    test.store.upsert(test.scope, comment('edited', 'Edited during reconnect'))
    test.store.upsert(test.scope, comment('new'))
    test.navigate('thread:other')
    test.store.set('thread:other', [comment('submitted')])
    test.actions.reconcile(test.scope, [turn('inProgress', [{ type: 'userMessage', id: 'server:item', clientId: 'client:submission', content: [] }])])
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('edited', 'Edited during reconnect'), comment('new')])
    expect(test.store.getSnapshot('thread:other')).toEqual([comment('submitted')])
    expect(test.bindings.pendingSteerRecoveries.current.has(test.scope)).toBe(false)
    expect(test.bindings.dispatch.mock.calls).toContainEqual([{ type: 'steerAccepted', threadId: test.scope, turnId: 'turn:active', clientId: 'client:submission' }])
  })

  it('keeps comments and restores its own composer when reconciliation confirms the steer was not accepted', async () => {
    const test = fixture({ running: true, text: 'Keep my follow-up' })
    test.store.set(test.scope, [comment('submitted')])
    const pending = test.actions.submit()
    await reaches(test, 'turn/steer')
    test.steeredTurn.reject(new Error('Connection changed'))
    await pending
    test.navigate('thread:other')
    test.store.set('thread:other', [comment('other')])
    test.actions.reconcile(test.scope, [turn('completed')])
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('submitted')])
    expect(test.store.getSnapshot('thread:other')).toEqual([comment('other')])
    expect(test.drafts()[test.scope].text).toBe('Keep my follow-up')
    expect(test.bindings.pendingSteerRecoveries.current.has(test.scope)).toBe(false)
  })

  it.each(['turn/start', 'turn/steer'])('preserves a recreated equal-content comment while awaiting the %s acknowledgement', async (method) => {
    const running = method === 'turn/steer'
    const test = fixture({ running })
    test.store.set(test.scope, [comment('submitted', 'Same content')])
    const pending = test.actions.submit()
    await reaches(test, running ? 'turn/steer' : 'turn/start')
    test.store.remove(test.scope, 'submitted')
    test.store.upsert(test.scope, comment('recreated', 'Same content'))
    if (running) test.steeredTurn.resolve({ turnId: 'turn:active' })
    else test.startedTurn.resolve({ turn: turn() })
    await pending
    expect(test.store.getSnapshot(test.scope)).toEqual([comment('recreated', 'Same content')])
    expectNoSubmissionFailure(test)
  })
})

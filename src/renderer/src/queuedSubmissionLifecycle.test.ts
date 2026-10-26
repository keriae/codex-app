import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { ComposerAttachmentSelection } from '../../shared/api'
import type { DiffCommentAttachment } from './diffComments'
import type { ThreadSession } from './state/sessionReducer'
import {
  createOptimisticQueuedMessage,
  queuedMessageFromServer,
  reconcileQueuedSubmissions,
  removeQueuedMessage,
  updateQueuedMessage,
  upsertQueuedMessage,
  type QueuedMessage
} from './queuedMessages'
import { interruptibleTurnId } from './sideChatLifecycle'
import { hasAuthoritativeClientMessage, isUnknownMutationError } from './threadContinuity'

const source = ts.createSourceFile(
  'App.tsx',
  readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const queueMutationHelperNames = new Set([
  'bumpThreadQueueRevision',
  'waitForThreadQueueMutations',
  'invokeQueueMutation'
])
const handlerNames = new Set([
  'enqueueQueuedFollowUp',
  'updateQueuedFollowUp',
  'reorderQueuedFollowUps',
  'resolveQueuedMessage',
  'startQueuedFollowUp',
  'resumeInterruptedQueue',
  'sendQueuedFollowUpNow'
])
const extractedInitializers = new Map<string, string>()
let authoritativeQueueEffect = ''
function collect(node: ts.Node): void {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (
      queueMutationHelperNames.has(node.name.text) ||
      handlerNames.has(node.name.text) ||
      node.name.text === 'refreshThreadQueue'
    )
  ) {
    extractedInitializers.set(node.name.text, node.initializer.getText(source))
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'useEffect' &&
    node.arguments[0] &&
    node.arguments[0].getText(source).includes('hasAuthoritativeClientMessage')
  ) {
    authoritativeQueueEffect = node.arguments[0].getText(source)
  }
  ts.forEachChild(node, collect)
}
collect(source)
for (const name of [...queueMutationHelperNames, ...handlerNames, 'refreshThreadQueue']) {
  if (!extractedInitializers.has(name)) throw new Error(`Actual App queue function not found: ${name}`)
}
if (!authoritativeQueueEffect) throw new Error('Actual App authoritative queue effect not found')
const compiled = ts.transpileModule(
  [...queueMutationHelperNames, ...handlerNames]
    .map((name) => `const ${name} = ${extractedInitializers.get(name)};`)
    .join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const queueRaceCompiled = ts.transpileModule(
  [...queueMutationHelperNames, 'refreshThreadQueue', 'startQueuedFollowUp']
    .map((name) => `const ${name} = ${extractedInitializers.get(name)};`)
    .join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const authoritativeQueueEffectCompiled = ts.transpileModule(
  `const runAuthoritativeQueueEffect = ${authoritativeQueueEffect};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const attachment: ComposerAttachmentSelection = {
  kind: 'image', name: 'screen.png', path: '/project/screen.png'
}
const comment: DiffCommentAttachment = {
  id: 'review', type: 'comment', position: { path: 'src/a.ts', side: 'right', line: 3 },
  content: [{ content_type: 'text', text: 'Check this' }]
}
const input = [
  { type: 'text' as const, text: 'Run next', text_elements: [] },
  { type: 'localImage' as const, path: attachment.path }
]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  let queues: Record<string, QueuedMessage[]> = {}
  const queueRef = { current: queues }
  const invoke = vi.fn<(method: string, params: Record<string, unknown>, hostId?: string) => Promise<unknown>>()
  const removeSubmitted = vi.fn()
  const restoreComposerDraft = vi.fn()
  const refreshThreadQueue = vi.fn(async (threadId: string) => queueRef.current[threadId] || [])
  const dispatch = vi.fn()
  const setAttachmentError = vi.fn()
  const setThreadNotice = vi.fn()
  const setComposerDrafts = vi.fn()
  const setEditingQueuedMessage = vi.fn()
  const queueServerRevisions = { current: new Map<string, number>() }
  const queueActiveMutations = { current: new Map<string, number>() }
  const queueMutationWaiters = { current: new Map<string, Set<() => void>>() }
  const sessions: Record<string, ThreadSession> = {
    'thread-a': { activeTurnId: 'turn-a', running: true, turns: [], error: null }
  }
  const stateRef = {
    current: {
      sessions
    }
  }
  const updateThreadQueue = (
    threadId: string,
    update: (messages: readonly QueuedMessage[]) => QueuedMessage[]
  ): QueuedMessage[] => {
    const nextMessages = update(queueRef.current[threadId] || [])
    queues = { ...queueRef.current }
    if (nextMessages.length) queues[threadId] = nextMessages
    else delete queues[threadId]
    queueRef.current = queues
    return nextMessages
  }
  const bindings = {
    createOptimisticQueuedMessage,
    queuedMessageFromServer,
    upsertQueuedMessage,
    updateQueuedMessage,
    removeQueuedMessage,
    updateThreadQueue,
    queuedMessagesByThreadRef: queueRef,
    queueServerRevisions,
    queueActiveMutations,
    queueMutationWaiters,
    queueStarts: { current: new Set<string>() },
    diffCommentsStore: { removeSubmitted },
    restoreComposerDraft,
    refreshThreadQueue,
    setAttachmentError,
    setThreadNotice,
    setComposerDrafts,
    setEditingQueuedMessage,
    displayError: (error: unknown) => error instanceof Error ? error.message : String(error),
    isUnknownMutationError,
    interruptibleTurnId,
    hostIdForThreadId: vi.fn(() => 'local'),
    stateRef,
    dispatch,
    window: {
      requestAnimationFrame: vi.fn(),
      codex: { invoke }
    },
    document: { querySelector: vi.fn() }
  }
  const actions = new Function(
    ...Object.keys(bindings),
    `${compiled}\nreturn { enqueueQueuedFollowUp, updateQueuedFollowUp, reorderQueuedFollowUps, startQueuedFollowUp, resumeInterruptedQueue, sendQueuedFollowUpNow }`
  )(...Object.values(bindings)) as {
    enqueueQueuedFollowUp(options: {
      threadId: string; clientUserMessageId: string; input: typeof input; text: string; draftText: string
      attachments: ComposerAttachmentSelection[]; comments: readonly DiffCommentAttachment[]
    }): Promise<void>
    updateQueuedFollowUp(options: {
      threadId: string; messageId: string; input: typeof input; text: string; draftText: string
      attachments: ComposerAttachmentSelection[]; comments: readonly DiffCommentAttachment[]
    }): Promise<void>
    reorderQueuedFollowUps(threadId: string, messageIds: string[]): Promise<void>
    startQueuedFollowUp(threadId: string, messageId: string): Promise<void>
    resumeInterruptedQueue(threadId: string): void
    sendQueuedFollowUpNow(threadId: string, messageId: string): Promise<void>
  }
  const options = {
    threadId: 'thread-a', clientUserMessageId: 'client-a', input,
    text: 'Run next', draftText: 'Run next', attachments: [attachment], comments: [comment]
  }
  const seedAccepted = (): QueuedMessage => {
    const optimistic = createOptimisticQueuedMessage(options)
    const accepted = queuedMessageFromServer('thread-a', {
      id: 'queue-a', clientUserMessageId: 'client-a', input
    }, optimistic)
    updateThreadQueue('thread-a', () => [accepted])
    return accepted
  }
  return {
    actions, options, invoke, removeSubmitted, restoreComposerDraft,
    refreshThreadQueue, dispatch, setAttachmentError, setThreadNotice,
    setComposerDrafts, setEditingQueuedMessage, stateRef,
    queues: () => queues, seedAccepted, updateThreadQueue
  }
}

function queueRaceFixture() {
  let queues: Record<string, QueuedMessage[]> = {}
  const queuedMessagesByThreadRef = { current: queues }
  const queueServerRevisions = { current: new Map<string, number>() }
  const queueActiveMutations = { current: new Map<string, number>() }
  const queueMutationWaiters = { current: new Map<string, Set<() => void>>() }
  const queueLoads = { current: new Map<string, Promise<QueuedMessage[]>>() }
  const queueStarts = { current: new Set<string>() }
  const removeSubmitted = vi.fn()
  const dispatch = vi.fn()
  const invoke = vi.fn<(method: string, params: Record<string, unknown>, hostId?: string) => Promise<unknown>>()
  const updateThreadQueue = (
    threadId: string,
    update: (messages: readonly QueuedMessage[]) => QueuedMessage[]
  ): QueuedMessage[] => {
    const nextMessages = update(queuedMessagesByThreadRef.current[threadId] || [])
    queues = { ...queuedMessagesByThreadRef.current }
    if (nextMessages.length) queues[threadId] = nextMessages
    else delete queues[threadId]
    queuedMessagesByThreadRef.current = queues
    return nextMessages
  }
  const bindings = {
    queueServerRevisions,
    queueActiveMutations,
    queueMutationWaiters,
    queueLoads,
    queueStarts,
    queuedMessagesByThreadRef,
    updateThreadQueue,
    reconcileQueuedSubmissions,
    updateQueuedMessage,
    removeQueuedMessage,
    diffCommentsStore: { removeSubmitted },
    dispatch,
    isUnknownMutationError,
    hostIdForThreadId: vi.fn(() => 'local'),
    displayError: (error: unknown) => error instanceof Error ? error.message : String(error),
    window: { codex: { invoke } }
  }
  const actions = new Function(
    ...Object.keys(bindings),
    `${queueRaceCompiled}\nreturn { refreshThreadQueue, startQueuedFollowUp }`
  )(...Object.values(bindings)) as {
    refreshThreadQueue(threadId: string): Promise<QueuedMessage[]>
    startQueuedFollowUp(threadId: string, messageId: string): Promise<void>
  }
  const accepted = queuedMessageFromServer('thread-a', {
    id: 'queue-a', clientUserMessageId: 'client-a', input
  })
  updateThreadQueue('thread-a', () => [accepted])
  return {
    actions,
    accepted,
    invoke,
    queues: () => queues
  }
}

describe('actual App durable queued-submission lifecycle', () => {
  it('persists the full input before clearing submitted diff comments', async () => {
    const test = fixture()
    test.invoke.mockResolvedValueOnce({
      queuedSubmission: { id: 'queue-a', clientUserMessageId: 'client-a', input }
    })

    await test.actions.enqueueQueuedFollowUp(test.options)

    expect(test.invoke).toHaveBeenCalledWith('thread/queue/add', {
      threadId: 'thread-a', clientUserMessageId: 'client-a', input
    }, 'local')
    expect(test.queues()['thread-a'][0]).toMatchObject({
      id: 'queue-a', status: 'queued', serverAccepted: true,
      attachments: [attachment], comments: [comment]
    })
    expect(test.removeSubmitted).toHaveBeenCalledWith('thread-a', [comment])
  })

  it('restores the exact draft and attachment if an old server rejects queue/add', async () => {
    const test = fixture()
    test.invoke.mockRejectedValueOnce(new Error('Method not found: thread/queue/add'))

    await test.actions.enqueueQueuedFollowUp(test.options)

    expect(test.queues()['thread-a']).toBeUndefined()
    expect(test.restoreComposerDraft).toHaveBeenCalledWith('thread-a', 'Run next', [attachment])
    expect(test.setAttachmentError).toHaveBeenCalledWith(
      '当前 Codex server 不支持输入排队，消息已恢复到输入框。请更新 codex server。'
    )
    expect(test.removeSubmitted).not.toHaveBeenCalled()
  })

  it('retains an outcome-unknown add as a saved row instead of losing or resending it', async () => {
    const test = fixture()
    test.invoke.mockRejectedValueOnce(new Error('[outcome-unknown] connection changed'))

    await test.actions.enqueueQueuedFollowUp(test.options)

    expect(test.queues()['thread-a'][0]).toMatchObject({
      clientUserMessageId: 'client-a', status: 'outcome-unknown', serverAccepted: false,
      attachments: [attachment], comments: [comment]
    })
    expect(test.restoreComposerDraft).not.toHaveBeenCalled()
    expect(test.refreshThreadQueue).toHaveBeenCalledWith('thread-a')
  })

  it('updates an accepted queued submission in place through thread/queue/update', async () => {
    const test = fixture()
    test.seedAccepted()
    const updatedInput = [{ type: 'text' as const, text: 'Edited follow-up', text_elements: [] }]
    test.invoke.mockResolvedValueOnce({
      queuedSubmission: {
        id: 'queue-a', clientUserMessageId: 'client-a', input: updatedInput
      }
    })

    await test.actions.updateQueuedFollowUp({
      ...test.options,
      messageId: 'queue-a',
      input: updatedInput,
      text: 'Edited follow-up',
      draftText: 'Edited follow-up',
      attachments: [],
      comments: []
    })

    expect(test.invoke).toHaveBeenCalledWith('thread/queue/update', {
      threadId: 'thread-a', queuedSubmissionId: 'queue-a', input: updatedInput
    }, 'local')
    expect(test.queues()['thread-a']).toEqual([
      expect.objectContaining({
        id: 'queue-a', text: 'Edited follow-up', input: updatedInput,
        status: 'queued', serverAccepted: true
      })
    ])
    expect(test.setComposerDrafts).toHaveBeenCalledOnce()
    expect(test.setEditingQueuedMessage).toHaveBeenCalledOnce()
  })

  it('keeps the original queue row and edit draft after a definite update failure', async () => {
    const test = fixture()
    test.seedAccepted()
    const updatedInput = [{ type: 'text' as const, text: 'Rejected edit', text_elements: [] }]
    test.invoke.mockRejectedValueOnce(new Error('invalid queued input'))

    await test.actions.updateQueuedFollowUp({
      ...test.options,
      messageId: 'queue-a', input: updatedInput,
      text: 'Rejected edit', draftText: 'Rejected edit', attachments: [], comments: []
    })

    expect(test.queues()['thread-a'][0]).toMatchObject({
      id: 'queue-a', text: 'Run next', input, status: 'queued'
    })
    expect(test.setAttachmentError).toHaveBeenCalledWith('invalid queued input')
    expect(test.setComposerDrafts).not.toHaveBeenCalled()
    expect(test.setEditingQueuedMessage).not.toHaveBeenCalled()
  })

  it('keeps the local edit context when an unknown update cannot be reconciled', async () => {
    const test = fixture()
    test.seedAccepted()
    const updatedInput = [{ type: 'text' as const, text: 'Unconfirmed edit', text_elements: [] }]
    test.invoke.mockRejectedValueOnce(new Error('[outcome-unknown] connection changed'))
    test.refreshThreadQueue.mockRejectedValueOnce(new Error('still offline'))

    await test.actions.updateQueuedFollowUp({
      ...test.options,
      messageId: 'queue-a', input: updatedInput,
      text: 'Unconfirmed edit', draftText: 'Unconfirmed edit',
      attachments: [attachment], comments: [comment]
    })

    expect(test.queues()['thread-a'][0]).toMatchObject({
      id: 'queue-a', input: updatedInput, text: 'Unconfirmed edit',
      attachments: [attachment], comments: [comment], status: 'outcome-unknown'
    })
    expect(test.setComposerDrafts).not.toHaveBeenCalled()
    expect(test.setEditingQueuedMessage).not.toHaveBeenCalled()
    expect(test.removeSubmitted).not.toHaveBeenCalled()
    expect(test.setAttachmentError).toHaveBeenCalledWith(
      '暂时无法确认排队消息是否已修改；编辑内容仍保留在输入框中。'
    )
  })

  it('optimistically reorders accepted queue rows and persists the exact id order', async () => {
    const test = fixture()
    const first = test.seedAccepted()
    const second = queuedMessageFromServer('thread-a', {
      id: 'queue-b',
      clientUserMessageId: 'client-b',
      input: [{ type: 'text', text: 'Second', text_elements: [] }]
    })
    test.updateThreadQueue('thread-a', () => [first, second])
    test.invoke.mockResolvedValueOnce({})

    await test.actions.reorderQueuedFollowUps('thread-a', ['queue-b', 'queue-a'])

    expect(test.invoke).toHaveBeenCalledWith('thread/queue/reorder', {
      threadId: 'thread-a', queuedSubmissionIds: ['queue-b', 'queue-a']
    }, 'local')
    expect(test.queues()['thread-a'].map((message) => message.id))
      .toEqual(['queue-b', 'queue-a'])
  })

  it('restores the previous order and refreshes after reorder rejection', async () => {
    const test = fixture()
    const first = test.seedAccepted()
    const second = queuedMessageFromServer('thread-a', {
      id: 'queue-b', clientUserMessageId: 'client-b',
      input: [{ type: 'text', text: 'Second', text_elements: [] }]
    })
    test.updateThreadQueue('thread-a', () => [first, second])
    test.invoke.mockRejectedValueOnce(new Error('reorder rejected'))

    await test.actions.reorderQueuedFollowUps('thread-a', ['queue-b', 'queue-a'])

    expect(test.queues()['thread-a'].map((message) => message.id))
      .toEqual(['queue-a', 'queue-b'])
    expect(test.refreshThreadQueue).toHaveBeenCalledWith('thread-a')
    expect(test.setThreadNotice).toHaveBeenCalledWith({ message: 'reorder rejected' })
  })

  it('explicitly starts one accepted head and removes it only after turn/start acknowledgement', async () => {
    const test = fixture()
    const queued = test.seedAccepted()
    test.stateRef.current.sessions['thread-a'].running = false
    test.stateRef.current.sessions['thread-a'].activeTurnId = null
    test.invoke.mockResolvedValueOnce({
      turn: { id: 'turn-next', status: 'inProgress', items: [] }
    })

    await test.actions.startQueuedFollowUp('thread-a', queued.id)

    expect(test.invoke).toHaveBeenCalledWith('thread/queue/start', {
      threadId: 'thread-a', queuedSubmissionId: 'queue-a'
    }, 'local')
    expect(test.queues()['thread-a']).toBeUndefined()
    expect(test.dispatch).toHaveBeenCalledWith({
      type: 'notification',
      notification: {
        method: 'turn/started',
        params: { threadId: 'thread-a', turn: { id: 'turn-next', status: 'inProgress', items: [] } }
      }
    })
  })

  it('resumes an interrupted queue head through thread/queue/start', async () => {
    const test = fixture()
    const queued = test.seedAccepted()
    test.updateThreadQueue('thread-a', () => [{
      ...queued,
      status: 'paused',
      pauseReason: 'interrupted',
      error: '由于你中断了当前响应，队列已暂停。'
    }])
    test.stateRef.current.sessions['thread-a'].running = false
    test.stateRef.current.sessions['thread-a'].activeTurnId = null
    test.invoke.mockResolvedValueOnce({
      turn: { id: 'turn-resumed', status: 'inProgress', items: [] }
    })

    test.actions.resumeInterruptedQueue('thread-a')
    await Promise.resolve()
    await Promise.resolve()

    expect(test.invoke).toHaveBeenCalledWith('thread/queue/start', {
      threadId: 'thread-a', queuedSubmissionId: 'queue-a'
    }, 'local')
    expect(test.queues()['thread-a']).toBeUndefined()
  })

  it('uses turn/steer for 引导 and deletes the durable queue record afterwards', async () => {
    const test = fixture()
    test.seedAccepted()
    test.invoke
      .mockResolvedValueOnce({ turnId: 'turn-a' })
      .mockResolvedValueOnce({ deleted: true })

    await test.actions.sendQueuedFollowUpNow('thread-a', 'queue-a')

    expect(test.invoke.mock.calls).toEqual([
      ['turn/steer', {
        threadId: 'thread-a', input, expectedTurnId: 'turn-a', clientUserMessageId: 'client-a'
      }, 'local'],
      ['thread/queue/delete', { threadId: 'thread-a', queuedSubmissionId: 'queue-a' }, 'local']
    ])
    expect(test.queues()['thread-a']).toBeUndefined()
    expect(test.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'optimisticSteer', 'steerAccepted'
    ])
  })

  it('keeps a server-accepted item outcome-unknown when steer delivery or deletion is uncertain', async () => {
    const test = fixture()
    test.seedAccepted()
    test.invoke.mockRejectedValueOnce(new Error('[outcome-unknown] connection changed'))

    await test.actions.sendQueuedFollowUpNow('thread-a', 'queue-a')

    expect(test.queues()['thread-a'][0]).toMatchObject({
      id: 'queue-a', status: 'outcome-unknown', serverAccepted: true
    })
    expect(test.refreshThreadQueue).toHaveBeenCalledWith('thread-a')
  })

  it('idempotently removes every queued row already present in authoritative turns', async () => {
    let queues: Record<string, QueuedMessage[]> = {}
    const acceptedUnknown = queuedMessageFromServer('thread-a', {
      id: 'queue-unknown', clientUserMessageId: 'client-unknown', input
    })
    const acceptedAfterRestart = queuedMessageFromServer('thread-a', {
      id: 'queue-hydrated', clientUserMessageId: 'client-hydrated', input
    })
    const localUnknown = createOptimisticQueuedMessage({
      threadId: 'thread-a',
      clientUserMessageId: 'client-local',
      input,
      text: 'Run next',
      attachments: [attachment],
      comments: [comment]
    })
    queues['thread-a'] = [
      { ...acceptedUnknown, status: 'outcome-unknown' },
      acceptedAfterRestart,
      { ...localUnknown, status: 'outcome-unknown' }
    ]
    const updateThreadQueue = (
      threadId: string,
      update: (messages: readonly QueuedMessage[]) => QueuedMessage[]
    ): QueuedMessage[] => {
      const nextMessages = update(queues[threadId] || [])
      queues = { ...queues }
      if (nextMessages.length) queues[threadId] = nextMessages
      else delete queues[threadId]
      return nextMessages
    }
    const invokeQueueMutation = vi.fn(async () => ({ deleted: false }))
    const removeSubmitted = vi.fn()
    const refreshThreadQueue = vi.fn(async () => queues['thread-a'] || [])
    const bindings = {
      backend: { state: 'ready' },
      queuedMessagesByThread: queues,
      state: {
        sessions: {
          'thread-a': {
            running: true,
            turns: [{
              id: 'turn-authoritative',
              status: 'inProgress',
              items: [
                { type: 'userMessage', id: 'server-unknown', clientId: 'client-unknown', content: [] },
                { type: 'userMessage', id: 'server-hydrated', clientId: 'client-hydrated', content: [] },
                { type: 'userMessage', id: 'server-local', clientId: 'client-local', content: [] }
              ]
            }]
          }
        }
      },
      hasAuthoritativeClientMessage,
      queueStarts: { current: new Set<string>() },
      diffCommentsStore: { removeSubmitted },
      invokeQueueMutation,
      updateThreadQueue,
      removeQueuedMessage,
      updateQueuedMessage,
      refreshThreadQueue
    }
    const runAuthoritativeQueueEffect = new Function(
      ...Object.keys(bindings),
      `${authoritativeQueueEffectCompiled}\nreturn runAuthoritativeQueueEffect`
    )(...Object.values(bindings)) as () => void

    runAuthoritativeQueueEffect()

    expect(invokeQueueMutation.mock.calls).toEqual([
      [
        'thread-a',
        'thread/queue/delete',
        { threadId: 'thread-a', queuedSubmissionId: 'queue-unknown' }
      ],
      [
        'thread-a',
        'thread/queue/delete',
        { threadId: 'thread-a', queuedSubmissionId: 'queue-hydrated' }
      ]
    ])
    expect(queues['thread-a'].map((message) => message.id))
      .toEqual(['queue-unknown', 'queue-hydrated'])
    await Promise.resolve()
    await Promise.resolve()
    expect(queues['thread-a']).toBeUndefined()
    expect(refreshThreadQueue).not.toHaveBeenCalled()
  })

  it('leaves normal idle dispatch to the server and only pauses interrupted turns', () => {
    let queues: Record<string, QueuedMessage[]> = {
      'thread-a': [queuedMessageFromServer('thread-a', {
        id: 'queue-a', clientUserMessageId: 'client-a', input
      })]
    }
    const updateThreadQueue = (
      threadId: string,
      update: (messages: readonly QueuedMessage[]) => QueuedMessage[]
    ): QueuedMessage[] => {
      const nextMessages = update(queues[threadId] || [])
      queues = { ...queues, [threadId]: nextMessages }
      return nextMessages
    }
    const invokeQueueMutation = vi.fn()
    const bindings = {
      backend: { state: 'ready' },
      queuedMessagesByThread: queues,
      state: {
        sessions: {
          'thread-a': {
            running: false,
            turns: [{ id: 'turn-failed', status: 'failed', items: [] }]
          }
        }
      },
      hasAuthoritativeClientMessage,
      queueStarts: { current: new Set<string>() },
      diffCommentsStore: { removeSubmitted: vi.fn() },
      invokeQueueMutation,
      updateThreadQueue,
      removeQueuedMessage,
      updateQueuedMessage,
      refreshThreadQueue: vi.fn()
    }
    const runAuthoritativeQueueEffect = new Function(
      ...Object.keys(bindings),
      `${authoritativeQueueEffectCompiled}\nreturn runAuthoritativeQueueEffect`
    )(...Object.values(bindings)) as () => void

    runAuthoritativeQueueEffect()

    expect(invokeQueueMutation).not.toHaveBeenCalled()
    expect(queues['thread-a']).toEqual([
      expect.objectContaining({ id: 'queue-a', status: 'queued', pauseReason: null })
    ])
  })

  it('discards a stale queue list that overlaps a successful explicit start', async () => {
    const test = queueRaceFixture()
    const staleList = deferred<{
      data: Array<{ id: string; clientUserMessageId: string; input: typeof input }>
      nextCursor: null
    }>()
    let listCalls = 0
    test.invoke.mockImplementation((method) => {
      if (method === 'thread/queue/list') {
        listCalls += 1
        if (listCalls === 1) return staleList.promise
        return Promise.resolve({ data: [], nextCursor: null })
      }
      if (method === 'thread/queue/start') {
        return Promise.resolve({
          turn: { id: 'turn-next', status: 'inProgress', items: [] }
        })
      }
      return Promise.reject(new Error(`Unexpected RPC method: ${method}`))
    })

    const refresh = test.actions.refreshThreadQueue('thread-a')
    await Promise.resolve()
    await Promise.resolve()
    expect(listCalls).toBe(1)

    await test.actions.startQueuedFollowUp('thread-a', test.accepted.id)
    expect(test.queues()['thread-a']).toBeUndefined()

    staleList.resolve({
      data: [{ id: 'queue-a', clientUserMessageId: 'client-a', input }],
      nextCursor: null
    })
    await expect(refresh).resolves.toEqual([])

    expect(listCalls).toBe(2)
    expect(test.queues()['thread-a']).toBeUndefined()
  })
})

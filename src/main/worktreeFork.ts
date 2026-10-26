import type {
  ForkThreadInNewWorktreeOptions,
  ForkThreadInNewWorktreeResult,
  JsonMap,
  ManagedWorktree,
  ManagedWorktreeCreateOptions
} from '../shared/api'
import { AppServerDeliveryError } from './appServer'
import { validateWorktreeCreateOptions } from './managedWorktrees'
import { isDesktopThreadId } from './windowThreadRouting'

interface WorktreeCreator {
  create(options: ManagedWorktreeCreateOptions, assertCurrent?: () => void): Promise<ManagedWorktree>
  discard(worktree: ManagedWorktree): Promise<boolean>
}

interface AppServerRequester {
  request(method: string, params?: JsonMap): Promise<unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function forkWasDefinitelyNotSent(error: unknown): boolean {
  return error instanceof AppServerDeliveryError &&
    error.method === 'thread/fork' && error.stage === 'not-sent'
}

export function validateForkThreadInNewWorktreeOptions(
  value: unknown
): ForkThreadInNewWorktreeOptions {
  if (!record(value) || Object.keys(value).some((key) =>
    !['threadId', 'cwd', 'startingState'].includes(key)) ||
    !isDesktopThreadId(value.threadId)) {
    throw new Error('Invalid new-worktree fork options')
  }
  const worktree = validateWorktreeCreateOptions({
    cwd: value.cwd,
    ...(value.startingState === undefined ? {} : { startingState: value.startingState })
  })
  return { threadId: value.threadId, cwd: worktree.cwd, ...(
    worktree.startingState === undefined ? {} : { startingState: worktree.startingState }
  ) }
}

/** Create the checkout before dispatching the persistent fork mutation. */
export async function forkThreadInNewWorktree(
  worktrees: WorktreeCreator,
  server: AppServerRequester,
  value: unknown,
  assertCurrent: () => void = () => {},
  onWorktreeCreated: (worktree: ManagedWorktree) => void = () => {}
): Promise<ForkThreadInNewWorktreeResult<Record<string, unknown>>> {
  const options = validateForkThreadInNewWorktreeOptions(value)
  const source = await server.request('thread/read', {
    threadId: options.threadId,
    includeTurns: false
  })
  if (!record(source) || !record(source.thread) || source.thread.id !== options.threadId ||
      source.thread.cwd !== options.cwd) {
    throw new Error('Fork source does not match the selected workspace')
  }
  const sourceStatus = record(source.thread.status) ? source.thread.status : null
  if (sourceStatus?.type === 'active') {
    throw new Error('Stop the active turn before forking this chat')
  }
  assertCurrent()
  const configResponse = await server.request('config/read', {
    cwd: options.cwd,
    includeLayers: false
  })
  const configured = record(configResponse) && record(configResponse.config)
    ? configResponse.config
    : null
  assertCurrent()
  const worktree = await worktrees.create({
    cwd: options.cwd,
    startingState: options.startingState ?? { type: 'working-tree' }
  }, assertCurrent)
  let mutationInvoked = false
  try {
    const reasoningEffort = typeof source.thread.reasoningEffort === 'string'
      ? source.thread.reasoningEffort
      : null
    const config = configured == null && reasoningEffort == null
      ? null
      : {
          ...(configured ?? {}),
          ...(reasoningEffort == null ? {} : { model_reasoning_effort: reasoningEffort })
        }
    const params = {
      threadId: options.threadId,
      path: null,
      cwd: worktree.worktreeWorkspaceRoot,
      runtimeWorkspaceRoots: [...new Set([worktree.worktreeWorkspaceRoot, options.cwd])],
      threadSource: 'user',
      ...(typeof source.thread.model === 'string' && source.thread.model
        ? { model: source.thread.model }
        : {}),
      ...(config == null ? {} : { config }),
      excludeTurns: true
    }
    // A stale renderer must not submit the persistent mutation after a slow
    // checkout. Once request() is invoked, retain the checkout unless the
    // transport can prove the mutation was never sent.
    assertCurrent()
    const mutation = server.request('thread/fork', params)
    mutationInvoked = true
    const result = await mutation
    if (!record(result) || !record(result.thread) || !isDesktopThreadId(result.thread.id)) {
      throw new Error('Codex server returned an invalid forked thread')
    }
    onWorktreeCreated(worktree)
    return { thread: result.thread, worktree }
  } catch (error) {
    if (!mutationInvoked || forkWasDefinitelyNotSent(error)) {
      await worktrees.discard(worktree).catch(() => false)
    }
    throw error
  }
}

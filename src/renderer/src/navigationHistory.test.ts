import { describe, expect, it } from 'vitest'
import {
  canNavigateBack,
  canNavigateForward,
  createNavigationHistory,
  currentNavigationEntry,
  navigateBack,
  navigateForward,
  pushNavigationEntry,
  replaceCurrentNavigationEntry,
  resolveDraftNavigationEntries,
  sameNavigationEntry,
  type NavigationEntry
} from './navigationHistory'

const draft: NavigationEntry = { view: 'chats', threadId: null, cwd: '/work/alpha' }
const chat: NavigationEntry = { view: 'chats', threadId: 'chat-1', cwd: '/work/alpha' }

describe('window navigation history', () => {
  it('restores chat identity and workspace when traversing all primary surfaces', () => {
    let history = createNavigationHistory(draft)
    for (const entry of [chat, { view: 'settings' }, { view: 'scheduled' }, { view: 'projects' }, { view: 'marketplace' }] as NavigationEntry[]) history = pushNavigationEntry(history, entry)
    expect(currentNavigationEntry(history)).toEqual({ view: 'marketplace' })
    history = navigateBack(history)
    expect(currentNavigationEntry(history)).toEqual({ view: 'projects' })
    history = navigateBack(navigateBack(navigateBack(history)))
    expect(currentNavigationEntry(history)).toEqual(chat)
    expect(currentNavigationEntry(navigateForward(history))).toEqual({ view: 'settings' })
    expect(currentNavigationEntry(navigateBack(history))).toEqual(draft)
  })

  it('deduplicates only consecutive equivalent locations, retaining deliberate return visits', () => {
    let history = createNavigationHistory(chat)
    expect(pushNavigationEntry(history, { ...chat })).toBe(history)
    history = pushNavigationEntry(history, { view: 'settings' })
    expect(pushNavigationEntry(history, { view: 'settings' })).toBe(history)
    history = pushNavigationEntry(history, chat)
    expect(history.entries).toEqual([chat, { view: 'settings' }, chat])
    expect(history.index).toBe(2)
    expect(pushNavigationEntry(history, { view: 'chats', threadId: 'chat-1', cwd: '/work/beta' }).entries).toHaveLength(4)
  })

  it('keeps the same remote path on different hosts as distinct locations', () => {
    const local = {view: 'chats', threadId: null, cwd: '/work/shared', hostId: 'local', draftId: 'local'} as const
    const remote = {...local, hostId: 'remote-ssh-codex-managed:one', draftId: 'remote'} as const
    const history = pushNavigationEntry(createNavigationHistory(local), remote)
    expect(history.entries).toEqual([local, remote])
    expect(sameNavigationEntry(local, {...local, hostId: undefined})).toBe(true)
  })

  it('keeps projectless and remote-project identities when the cwd is shared', () => {
    const local = {view: 'chats', threadId: null, cwd: '/work/shared', hostId: 'local', projectKind: 'local', draftId: 'draft'} as const
    const projectless = {...local, projectKind: 'projectless'} as const
    const remoteOne = {...local, hostId: 'remote-one', projectKind: 'remote', projectId: 'project-one'} as const
    const remoteTwo = {...remoteOne, projectId: 'project-two'} as const

    expect(sameNavigationEntry(local, projectless)).toBe(false)
    expect(sameNavigationEntry(remoteOne, remoteTwo)).toBe(false)
  })

  it('truncates forward visits on new navigation while keeping a duplicate current push unchanged', () => {
    let history = pushNavigationEntry(pushNavigationEntry(createNavigationHistory(draft), chat), { view: 'settings' })
    history = navigateBack(history)
    expect(canNavigateForward(history)).toBe(true)
    expect(pushNavigationEntry(history, chat)).toBe(history)
    const branched = pushNavigationEntry(history, { view: 'projects' })
    expect(branched.entries).toEqual([draft, chat, { view: 'projects' }])
    expect(canNavigateForward(branched)).toBe(false)
    expect(history.entries).toEqual([draft, chat, { view: 'settings' }])
  })

  it('keeps boundaries stable and supports an initially unhydrated window', () => {
    const empty = createNavigationHistory()
    expect(currentNavigationEntry(empty)).toBeNull()
    expect(navigateBack(empty)).toBe(empty)
    expect(navigateForward(empty)).toBe(empty)
    const seeded = pushNavigationEntry(empty, draft)
    expect(navigateBack(seeded)).toBe(seeded)
    expect(navigateForward(seeded)).toBe(seeded)
    expect(canNavigateBack(seeded)).toBe(false)
    expect(canNavigateForward(seeded)).toBe(false)
  })

  it('replaces hydration metadata without adding a visit or discarding forward history', () => {
    const waiting = { view: 'chats', threadId: null, cwd: null } as const
    const history = navigateBack(pushNavigationEntry(createNavigationHistory(waiting), { view: 'projects' }))
    const hydrated = replaceCurrentNavigationEntry(history, draft)
    expect(hydrated.index).toBe(0)
    expect(hydrated.entries).toEqual([draft, { view: 'projects' }])
    expect(history.entries).toEqual([waiting, { view: 'projects' }])
    expect(canNavigateForward(hydrated)).toBe(true)
    expect(replaceCurrentNavigationEntry(hydrated, draft)).toBe(hydrated)
  })
  it('retains distinct empty-chat drafts and terminal scopes even in the same working folder', () => {
    const first = {...draft, draftId: 'draft:first'} as const
    const second = {...draft, draftId: 'draft:second'} as const
    const history = pushNavigationEntry(createNavigationHistory(first), second)
    expect(history.entries).toEqual([first, second])
    expect(currentNavigationEntry(navigateBack(history))).toEqual(first)
    expect(currentNavigationEntry(navigateForward(navigateBack(history)))).toEqual(second)
    expect(pushNavigationEntry(history, {...second})).toBe(history)
  })
  it('resolves a background-created draft without selecting it over the current draft', () => {
    const first = {...draft, projectKind: 'projectless', projectId: null, draftId: 'draft:first'} as const
    const second = {...draft, draftId: 'draft:second'} as const
    const history = pushNavigationEntry(createNavigationHistory(first), second)
    const resolved = resolveDraftNavigationEntries(history, 'draft:first', {threadId: 'created-first', cwd: '/work/worktree'})
    expect(currentNavigationEntry(resolved)).toEqual(second)
    expect(currentNavigationEntry(navigateBack(resolved))).toEqual({
      view: 'chats',
      threadId: 'created-first',
      cwd: '/work/worktree',
      projectKind: 'projectless',
      projectId: null
    })
    expect(resolved.index).toBe(history.index)
    expect(resolveDraftNavigationEntries(resolved, 'draft:first', {threadId: 'duplicate', cwd: '/work/worktree'})).toBe(resolved)
    expect(history.entries[0]).toEqual(first)
  })
})

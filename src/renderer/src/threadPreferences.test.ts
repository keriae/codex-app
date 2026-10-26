import { describe, expect, it } from 'vitest'
import type { Thread } from './protocol'
import {
  orderThreadsWithPins,
  parseThreadPreferences,
  removeThreadPreferences,
  setThreadPinned,
  setThreadUnread
} from './threadPreferences'

const thread = (id: string): Thread => ({
  id,
  preview: id,
  cwd: '/synthetic/project',
  createdAt: 1,
  updatedAt: 1,
  turns: []
})

describe('thread preferences', () => {
  it('sanitizes corrupt and duplicate stored ids', () => {
    expect(parseThreadPreferences('{')).toEqual({ pinned: [], unread: [] })
    expect(
      parseThreadPreferences(JSON.stringify({ pinned: ['a', 'a', 1], unread: ['b', '', 'b'] }))
    ).toEqual({ pinned: ['a'], unread: ['b'] })
  })

  it('keeps ordered pins and unread state independent', () => {
    let preferences = parseThreadPreferences(null)
    preferences = setThreadPinned(preferences, 'a', true)
    preferences = setThreadPinned(preferences, 'b', true)
    preferences = setThreadUnread(preferences, 'a', true)
    expect(preferences).toEqual({ pinned: ['b', 'a'], unread: ['a'] })
    expect(setThreadPinned(preferences, 'a', false)).toEqual({ pinned: ['b'], unread: ['a'] })
  })

  it('removes deleted ids from every local preference', () => {
    expect(
      removeThreadPreferences({ pinned: ['a', 'b'], unread: ['b', 'c'] }, ['b'])
    ).toEqual({ pinned: ['a'], unread: ['c'] })
  })

  it('orders present pinned threads without duplicating stale ids', () => {
    expect(orderThreadsWithPins([thread('a'), thread('b'), thread('c')], ['c', 'missing', 'a']))
      .toEqual([thread('c'), thread('a'), thread('b')])
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildConversationControlsItems,
  buildConversationMenuItems,
  nextEnabledTitlebarMenuIndex
} from './TitlebarMenus'

describe('buildConversationMenuItems', () => {
  it('matches the observed macOS thread menu order, groups, and shortcuts', () => {
    const items = buildConversationMenuItems({ pinned: true })
    expect(items.map((item) => item.id)).toEqual([
      'rename',
      'toggle-pin',
      'open-side-chat',
      'fork',
      'schedule',
      'copy',
      'open-new-window',
      'open-with',
      'archive'
    ])
    expect(items[1].label).toBe('取消置顶')
    expect(items.map((item) => item.shortcut || null)).toEqual([
      '⌥⌘R',
      '⌥⌘P',
      '⌥⌘S',
      null,
      null,
      null,
      null,
      null,
      '⇧⌘A'
    ])
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual([
      'open-side-chat',
      'copy',
      'open-new-window',
      'archive'
    ])
    expect(items[4]).toMatchObject({ disabled: true, label: '添加计划任务…' })
  })

  it('exposes the observed fork, copy, and open-with submenu actions', () => {
    const items = buildConversationMenuItems({ pinned: false })
    expect(items.find((item) => item.id === 'fork')?.children?.map((item) => item.action)).toEqual([
      'fork-same-worktree',
      'fork-new-worktree'
    ])
    expect(items.find((item) => item.id === 'copy')?.children?.map((item) => item.action)).toEqual([
      'copy-deeplink',
      'copy-markdown',
      'copy-working-directory'
    ])
    expect(items.find((item) => item.id === 'open-with')?.children?.map((item) => item.action)).toEqual([
      'open-finder',
      'open-terminal'
    ])
    expect(items.map((item) => item.id)).not.toContain('toggle-unread')
    expect(items.map((item) => item.id)).not.toContain('compact')
  })
})

describe('conversation controls menu', () => {
  it('keeps settings available while disabling an unavailable terminal', () => {
    const items = buildConversationControlsItems(false)
    expect(items).toEqual([
      { id: 'terminal', action: 'terminal', label: '后台终端', disabled: true },
      { id: 'settings', action: 'settings', label: '设置…', separatorBefore: true }
    ])
  })
})

describe('nextEnabledTitlebarMenuIndex', () => {
  it('wraps and skips disabled menu items', () => {
    const items = buildConversationControlsItems(false)
    expect(nextEnabledTitlebarMenuIndex(items, -1, 1)).toBe(1)
    expect(nextEnabledTitlebarMenuIndex(items, 1, 1)).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  isRightWorkbenchTabKeyboardKey,
  resolveRightWorkbenchTabKeyboardAction,
  rightWorkbenchActiveAfterDelete,
  rightWorkbenchRovingTabId,
  rightWorkbenchRovingTabIndex,
  rightWorkbenchTabNavigationTarget
} from './rightWorkbenchTabKeyboard'

const tabs = ['chat', 'workspace:file:a', 'browser:web-1'] as const

describe('right workbench tab keyboard navigation', () => {
  it('wraps horizontal navigation in left-to-right order', () => {
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[0], 'ArrowLeft')).toBe(tabs[2])
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[2], 'ArrowRight')).toBe(tabs[0])
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[1], 'ArrowLeft')).toBe(tabs[0])
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[1], 'ArrowRight')).toBe(tabs[2])
  })

  it('reverses horizontal arrow meaning for right-to-left layout', () => {
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[0], 'ArrowLeft', 'rtl')).toBe(tabs[1])
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[0], 'ArrowRight', 'rtl')).toBe(tabs[2])
  })

  it('moves to the first or last tab with Home and End', () => {
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[1], 'Home')).toBe(tabs[0])
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[1], 'End')).toBe(tabs[2])
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[0], 'Home')).toBeNull()
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[2], 'End')).toBeNull()
  })

  it('ignores unsupported keys, unknown tabs, and single-tab no-ops', () => {
    expect(rightWorkbenchTabNavigationTarget(tabs, tabs[1], 'Enter')).toBeNull()
    expect(rightWorkbenchTabNavigationTarget(tabs, 'missing', 'ArrowRight')).toBeNull()
    expect(rightWorkbenchTabNavigationTarget(['only'], 'only', 'ArrowRight')).toBeNull()
    expect(rightWorkbenchTabNavigationTarget([], 'missing', 'Home')).toBeNull()
  })
})

describe('right workbench tab Delete behavior', () => {
  it('selects the right neighbor first and falls back to the left neighbor', () => {
    expect(rightWorkbenchActiveAfterDelete(tabs, tabs[0])).toBe(tabs[1])
    expect(rightWorkbenchActiveAfterDelete(tabs, tabs[1])).toBe(tabs[2])
    expect(rightWorkbenchActiveAfterDelete(tabs, tabs[2])).toBe(tabs[1])
  })

  it('returns no next active tab when the last tab is deleted or the id is unknown', () => {
    expect(rightWorkbenchActiveAfterDelete(['only'], 'only')).toBeNull()
    expect(rightWorkbenchActiveAfterDelete(tabs, 'missing')).toBeNull()
  })

  it('returns a close action with the next active selection', () => {
    expect(resolveRightWorkbenchTabKeyboardAction({
      order: tabs,
      focusedId: tabs[1],
      key: 'Delete'
    })).toEqual({
      type: 'close',
      id: tabs[1],
      nextActiveId: tabs[2]
    })
  })

  it('does not close a non-closable or missing tab', () => {
    expect(resolveRightWorkbenchTabKeyboardAction({
      order: tabs,
      focusedId: tabs[1],
      key: 'Delete',
      closable: false
    })).toBeNull()
    expect(resolveRightWorkbenchTabKeyboardAction({
      order: tabs,
      focusedId: 'missing',
      key: 'Delete'
    })).toBeNull()
  })
})

describe('right workbench roving tab stop', () => {
  it('makes only the active tab keyboard-focusable', () => {
    expect(tabs.map((id) => rightWorkbenchRovingTabIndex(tabs, tabs[1], id))).toEqual([-1, 0, -1])
    expect(rightWorkbenchRovingTabId(tabs, tabs[1])).toBe(tabs[1])
  })

  it('falls back to the first tab when active state is absent or stale', () => {
    expect(rightWorkbenchRovingTabId(tabs, null)).toBe(tabs[0])
    expect(rightWorkbenchRovingTabId(tabs, 'missing')).toBe(tabs[0])
    expect(tabs.map((id) => rightWorkbenchRovingTabIndex(tabs, null, id))).toEqual([0, -1, -1])
    expect(rightWorkbenchRovingTabId([], null)).toBeNull()
  })

  it('identifies every handled tab-strip key', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete']) {
      expect(isRightWorkbenchTabKeyboardKey(key)).toBe(true)
    }
    expect(isRightWorkbenchTabKeyboardKey('Enter')).toBe(false)
  })

  it('returns activation actions for navigation keys', () => {
    expect(resolveRightWorkbenchTabKeyboardAction({
      order: tabs,
      focusedId: tabs[1],
      key: 'ArrowRight'
    })).toEqual({ type: 'activate', id: tabs[2] })
  })
})

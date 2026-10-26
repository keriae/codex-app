import { describe, expect, it } from 'vitest'
import {
  activateRightWorkbenchTab,
  closeRightWorkbenchTab,
  moveRightWorkbenchTab,
  openRightWorkbenchTab,
  reconcileRightWorkbenchTabs,
  rightWorkbenchTabKind,
  rightWorkbenchTabValue,
  type RightWorkbenchTabsState
} from './rightWorkbenchTabs'

const state = (...order: RightWorkbenchTabsState['order']): RightWorkbenchTabsState => ({
  order,
  activeId: order.at(-1) ?? null
})

describe('right workbench tab ordering', () => {
  it('keeps one global insertion order across every surface kind', () => {
    let tabs = state('workspace:file:README.md')
    tabs = openRightWorkbenchTab(tabs, 'subagent:child')
    tabs = openRightWorkbenchTab(tabs, 'side-chat')
    tabs = openRightWorkbenchTab(tabs, 'browser:web-1')
    expect(tabs).toEqual({
      order: ['workspace:file:README.md', 'subagent:child', 'side-chat', 'browser:web-1'],
      activeId: 'browser:web-1'
    })
  })

  it('selects the right neighbor, then the left neighbor, when closing the active tab', () => {
    const tabs = activateRightWorkbenchTab(
      state('workspace:file:a', 'subagent:child', 'side-chat'),
      'subagent:child'
    )
    expect(closeRightWorkbenchTab(tabs, 'subagent:child').activeId).toBe('side-chat')
    expect(closeRightWorkbenchTab({...tabs, activeId: 'side-chat'}, 'side-chat').activeId).toBe('subagent:child')
  })

  it('reconciles externally closed workspace tabs without grouping surviving tabs', () => {
    const tabs = activateRightWorkbenchTab(
      state('workspace:file:a', 'subagent:child', 'workspace:file:b', 'browser:web-1'),
      'workspace:file:b'
    )
    expect(reconcileRightWorkbenchTabs(tabs, [
      'workspace:file:a', 'subagent:child', 'browser:web-1', 'workspace:file:c'
    ])).toEqual({
      order: ['workspace:file:a', 'subagent:child', 'browser:web-1', 'workspace:file:c'],
      activeId: 'browser:web-1'
    })
  })

  it('moves a tab before another tab or to the end', () => {
    const tabs = state('workspace:file:a', 'subagent:child', 'browser:web-1')
    expect(moveRightWorkbenchTab(tabs, 'browser:web-1', 'subagent:child').order).toEqual([
      'workspace:file:a', 'browser:web-1', 'subagent:child'
    ])
    expect(moveRightWorkbenchTab(tabs, 'workspace:file:a', null).order).toEqual([
      'subagent:child', 'browser:web-1', 'workspace:file:a'
    ])
  })

  it('parses stable typed identifiers', () => {
    expect(rightWorkbenchTabKind('side-chat')).toBe('side-chat')
    expect(rightWorkbenchTabKind('terminal:tab-1')).toBe('terminal')
    expect(rightWorkbenchTabValue('workspace:file:src/App.tsx')).toBe('file:src/App.tsx')
  })
})

import { describe, expect, it } from 'vitest'
import {
  activateRightWorkbenchSurface,
  collapseRightWorkbenchView,
  enterRightWorkbenchFullView,
  initialRightWorkbenchViewState,
  reconcileRightWorkbenchView,
  revealRightWorkbenchView,
  rightWorkbenchViewFlags,
  selectRightWorkbenchChat,
  toggleRightWorkbenchFullView,
  workspaceLayoutForRightWorkbenchView,
  type RightWorkbenchViewState
} from './rightWorkbenchViewModel'

describe('right workbench presentation state', () => {
  it('selects chat in full view without hiding the tab strip or leaving full view', () => {
    const selected = selectRightWorkbenchChat(enterRightWorkbenchFullView())

    expect(selected).toEqual({ mode: 'full', selection: 'chat' })
    expect(rightWorkbenchViewFlags(selected)).toEqual({
      open: true,
      fullView: true,
      chatSelected: true,
      workbenchSurfaceVisible: false
    })
  })

  it('restores any right-workbench surface while preserving full view', () => {
    const chat = selectRightWorkbenchChat(enterRightWorkbenchFullView())

    expect(activateRightWorkbenchSurface(chat)).toEqual({
      mode: 'full',
      selection: 'workbench'
    })
  })

  it('normalizes chat selection when leaving full view, hiding, or losing all tabs', () => {
    const chat = selectRightWorkbenchChat(enterRightWorkbenchFullView())

    expect(toggleRightWorkbenchFullView(chat)).toEqual({ mode: 'split' })
    expect(collapseRightWorkbenchView()).toEqual({ mode: 'hidden' })
    expect(reconcileRightWorkbenchView(chat, 0)).toEqual({ mode: 'hidden' })
  })

  it('reveals hidden tabs in split view and opens a hidden tab on activation', () => {
    const hidden = initialRightWorkbenchViewState()

    expect(revealRightWorkbenchView(hidden)).toEqual({ mode: 'split' })
    expect(activateRightWorkbenchSurface(hidden)).toEqual({ mode: 'split' })
  })

  it('exposes whether native close may target the retained workbench tab', () => {
    const cases: Array<[RightWorkbenchViewState, boolean]> = [
      [{ mode: 'hidden' }, false],
      [{ mode: 'split' }, true],
      [{ mode: 'full', selection: 'workbench' }, true],
      [{ mode: 'full', selection: 'chat' }, false]
    ]

    for (const [state, expected] of cases) {
      expect(rightWorkbenchViewFlags(state).workbenchSurfaceVisible).toBe(expected)
    }
  })

  it('keeps every retained workspace layout synchronized even when another full-view tab is selected', () => {
    const fullChat = selectRightWorkbenchChat(enterRightWorkbenchFullView())

    expect(workspaceLayoutForRightWorkbenchView(fullChat, true)).toBe('full')
    expect(workspaceLayoutForRightWorkbenchView({ mode: 'split' }, true)).toBe('split')
    expect(workspaceLayoutForRightWorkbenchView(fullChat, false)).toBeNull()
  })
})

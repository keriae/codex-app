export type RightWorkbenchFullViewSelection = 'chat' | 'workbench'

/**
 * Presentation state for the shared right-workbench tab strip.
 *
 * The active workbench tab is intentionally kept in RightWorkbenchTabsState.
 * Selecting chat in full view only changes which side of that tab strip is
 * visible; it must not discard the last active workbench tab.
 */
export type RightWorkbenchViewState =
  | { mode: 'hidden' }
  | { mode: 'split' }
  | { mode: 'full'; selection: RightWorkbenchFullViewSelection }

export interface RightWorkbenchViewFlags {
  open: boolean
  fullView: boolean
  chatSelected: boolean
  workbenchSurfaceVisible: boolean
}

export function initialRightWorkbenchViewState(): RightWorkbenchViewState {
  return { mode: 'hidden' }
}

/** Revealing retained tabs returns to the ordinary split presentation. */
export function revealRightWorkbenchView(
  state: RightWorkbenchViewState
): RightWorkbenchViewState {
  return state.mode === 'hidden' ? { mode: 'split' } : state
}

/**
 * Activating any retained tab makes its surface primary without leaving full
 * view. This is the inverse of selecting the conversation tab in full view.
 */
export function activateRightWorkbenchSurface(
  state: RightWorkbenchViewState
): RightWorkbenchViewState {
  if (state.mode === 'hidden') return { mode: 'split' }
  if (state.mode === 'full' && state.selection === 'chat') {
    return { mode: 'full', selection: 'workbench' }
  }
  return state
}

export function enterRightWorkbenchFullView(): RightWorkbenchViewState {
  return { mode: 'full', selection: 'workbench' }
}

export function toggleRightWorkbenchFullView(
  state: RightWorkbenchViewState
): RightWorkbenchViewState {
  return state.mode === 'full'
    ? { mode: 'split' }
    : enterRightWorkbenchFullView()
}

/** The conversation is a real selected tab only while the strip is full-view. */
export function selectRightWorkbenchChat(
  state: RightWorkbenchViewState
): RightWorkbenchViewState {
  if (state.mode !== 'full' || state.selection === 'chat') return state
  return { mode: 'full', selection: 'chat' }
}

export function collapseRightWorkbenchView(): RightWorkbenchViewState {
  return { mode: 'hidden' }
}

export function reconcileRightWorkbenchView(
  state: RightWorkbenchViewState,
  retainedTabCount: number
): RightWorkbenchViewState {
  return retainedTabCount > 0 ? state : collapseRightWorkbenchView()
}

export function rightWorkbenchViewFlags(
  state: RightWorkbenchViewState
): RightWorkbenchViewFlags {
  const open = state.mode !== 'hidden'
  const fullView = state.mode === 'full'
  const chatSelected = fullView && state.selection === 'chat'
  return {
    open,
    fullView,
    chatSelected,
    workbenchSurfaceVisible: open && !chatSelected
  }
}

/**
 * Keeps WorkspacePane's legacy full/split value synchronized with the global
 * tab-strip presentation whenever workspace content is retained. Synchronizing
 * only when a workspace tab is active leaves a stale full layout after the
 * user exits full view from a browser, terminal, or chat tab.
 */
export function workspaceLayoutForRightWorkbenchView(
  state: RightWorkbenchViewState,
  workspaceRetained: boolean
): 'full' | 'split' | null {
  if (!workspaceRetained) return null
  return state.mode === 'full' ? 'full' : 'split'
}

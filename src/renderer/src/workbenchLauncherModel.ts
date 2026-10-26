import {
  rightWorkbenchTabKind,
  rightWorkbenchTabValue,
  type RightWorkbenchTabsState
} from './rightWorkbenchTabs'
import {
  hasWorkbenchBrowserPage,
  type WorkbenchBrowserTab
} from './workbenchBrowserModel'

export type WorkbenchLauncherTool =
  | 'browser'
  | 'files'
  | 'changes'
  | 'terminal'
  | 'side-chat'

export type WorkbenchLauncherTarget =
  | { surface: 'browser'; operation: 'keep-current'; tabId: string }
  | { surface: 'workspace'; operation: 'open-or-activate'; tab: 'files' | 'changes' }
  | { surface: 'terminal'; operation: 'open-or-activate' }
  | { surface: 'side-chat'; operation: 'open-or-activate' }

export interface WorkbenchLauncherSelectionStrategy {
  consumeLauncher: boolean
  /** Close this native browser tab before opening or activating `target`. */
  closeBrowserTabId: string | null
  target: WorkbenchLauncherTarget
}

/** An empty browser home can be consumed only while it is the active workbench tab. */
export function isReplaceableWorkbenchLauncherTab(
  tab: WorkbenchBrowserTab,
  tabs: RightWorkbenchTabsState
): boolean {
  const activeId = tabs.activeId
  return Boolean(
    activeId &&
    rightWorkbenchTabKind(activeId) === 'browser' &&
    rightWorkbenchTabValue(activeId) === tab.id &&
    !hasWorkbenchBrowserPage(tab.state)
  )
}

function launcherTarget(
  tab: WorkbenchBrowserTab,
  tool: WorkbenchLauncherTool
): WorkbenchLauncherTarget {
  if (tool === 'browser') {
    return { surface: 'browser', operation: 'keep-current', tabId: tab.id }
  }
  if (tool === 'files' || tool === 'changes') {
    return { surface: 'workspace', operation: 'open-or-activate', tab: tool }
  }
  if (tool === 'terminal') {
    return { surface: 'terminal', operation: 'open-or-activate' }
  }
  return { surface: 'side-chat', operation: 'open-or-activate' }
}

/**
 * Plans a launcher tool selection. Consumers should close `closeBrowserTabId`
 * first, then execute the target action. A Browser selection deliberately keeps
 * the current launcher tab.
 */
export function workbenchLauncherSelectionStrategy(
  tab: WorkbenchBrowserTab,
  tabs: RightWorkbenchTabsState,
  tool: WorkbenchLauncherTool
): WorkbenchLauncherSelectionStrategy {
  const consumeLauncher = tool !== 'browser' && isReplaceableWorkbenchLauncherTab(tab, tabs)
  return {
    consumeLauncher,
    closeBrowserTabId: consumeLauncher ? tab.id : null,
    target: launcherTarget(tab, tool)
  }
}

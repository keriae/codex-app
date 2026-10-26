import { describe, expect, it } from 'vitest'
import type { BrowserViewState } from '../../shared/api'
import type { RightWorkbenchTabsState } from './rightWorkbenchTabs'
import type { WorkbenchBrowserTab } from './workbenchBrowserModel'
import {
  isReplaceableWorkbenchLauncherTab,
  workbenchLauncherSelectionStrategy,
  type WorkbenchLauncherTool
} from './workbenchLauncherModel'

function browserState(id: string, url: string): BrowserViewState {
  return {
    id,
    url,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
  }
}

function tabs(activeId: RightWorkbenchTabsState['activeId']): RightWorkbenchTabsState {
  return {
    order: ['browser:web-1', 'workspace:changes'],
    activeId
  }
}

describe('replaceable workbench launcher tabs', () => {
  it('accepts null and about:blank state only when that browser tab is active', () => {
    const pending: WorkbenchBrowserTab = { id: 'web-1', state: null }
    const blank: WorkbenchBrowserTab = {
      id: 'web-1',
      state: browserState('web-1', 'about:blank')
    }

    expect(isReplaceableWorkbenchLauncherTab(pending, tabs('browser:web-1'))).toBe(true)
    expect(isReplaceableWorkbenchLauncherTab(blank, tabs('browser:web-1'))).toBe(true)
    expect(isReplaceableWorkbenchLauncherTab(blank, tabs('workspace:changes'))).toBe(false)
    expect(isReplaceableWorkbenchLauncherTab(blank, tabs('browser:web-2'))).toBe(false)
  })

  it('does not replace a browser tab that has navigated to a page', () => {
    const page: WorkbenchBrowserTab = {
      id: 'web-1',
      state: browserState('web-1', 'https://openai.com/')
    }
    expect(isReplaceableWorkbenchLauncherTab(page, tabs('browser:web-1'))).toBe(false)
  })
})

describe('workbench launcher tool strategy', () => {
  const launcher: WorkbenchBrowserTab = { id: 'web-1', state: null }

  it.each<{
    tool: Exclude<WorkbenchLauncherTool, 'browser'>
    target: ReturnType<typeof workbenchLauncherSelectionStrategy>['target']
  }>([
    {
      tool: 'files',
      target: { surface: 'workspace', operation: 'open-or-activate', tab: 'files' }
    },
    {
      tool: 'changes',
      target: { surface: 'workspace', operation: 'open-or-activate', tab: 'changes' }
    },
    {
      tool: 'terminal',
      target: { surface: 'terminal', operation: 'open-or-activate' }
    },
    {
      tool: 'side-chat',
      target: { surface: 'side-chat', operation: 'open-or-activate' }
    }
  ])('consumes an active blank launcher before opening $tool', ({ tool, target }) => {
    expect(workbenchLauncherSelectionStrategy(
      launcher,
      tabs('browser:web-1'),
      tool
    )).toEqual({
      consumeLauncher: true,
      closeBrowserTabId: 'web-1',
      target
    })
  })

  it('keeps the current launcher for Browser', () => {
    expect(workbenchLauncherSelectionStrategy(
      launcher,
      tabs('browser:web-1'),
      'browser'
    )).toEqual({
      consumeLauncher: false,
      closeBrowserTabId: null,
      target: { surface: 'browser', operation: 'keep-current', tabId: 'web-1' }
    })
  })

  it('opens the requested tool without consuming a navigated browser tab', () => {
    const page: WorkbenchBrowserTab = {
      id: 'web-1',
      state: browserState('web-1', 'https://example.com/')
    }
    expect(workbenchLauncherSelectionStrategy(page, tabs('browser:web-1'), 'side-chat')).toEqual({
      consumeLauncher: false,
      closeBrowserTabId: null,
      target: { surface: 'side-chat', operation: 'open-or-activate' }
    })
  })
})

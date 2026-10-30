import { useMemo, useState, useSyncExternalStore } from 'react'
import type { BrowserViewState } from '../../shared/api'
import type { Thread } from './protocol'
import type { WorkspaceChromeState } from './WorkspacePane'
import type { WorkbenchBrowserTab } from './workbenchBrowserModel'
import type { RightWorkbenchTabsState } from './rightWorkbenchTabs'
import type { RightWorkbenchViewState } from './rightWorkbenchViewModel'

export interface OpenedSubagentTab { threadId: string; name: string; thread?: Thread }
export interface RightWorkbenchSession {
  workspaceOpen: boolean
  chrome: WorkspaceChromeState
  tabs: RightWorkbenchTabsState
  view: RightWorkbenchViewState
  browsers: WorkbenchBrowserTab[]
  subagents: OpenedSubagentTab[]
  activeSubagent: string | null
}
type Update<T> = T | ((current: T) => T)

export interface TerminalWorkbenchSelection { scope: string; id: string | null }

/** Restoring another chat's terminal does not select it over its retained tab. */
export function shouldActivateWorkbenchTerminal(previous: TerminalWorkbenchSelection, next: TerminalWorkbenchSelection): boolean {
  return previous.scope === next.scope && next.id !== null && previous.id !== next.id
}

function emptySession(): RightWorkbenchSession {
  return {
    workspaceOpen: false,
    chrome: { label: '工作区', kind: 'workspace', tabs: [], activeTabId: 'workspace' },
    tabs: { order: [], activeId: null }, view: { mode: 'hidden' },
    browsers: [], subagents: [], activeSubagent: null
  }
}

/** Native pages outlive the selected chat; their events update their owner. */
export class RightWorkbenchSessions {
  scope = ''
  private snapshot: Record<string, RightWorkbenchSession> = {}
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = (): Record<string, RightWorkbenchSession> => this.snapshot
  session(scope: string): RightWorkbenchSession {
    if (!this.snapshot[scope]) this.snapshot = { ...this.snapshot, [scope]: emptySession() }
    return this.snapshot[scope]!
  }
  update<K extends keyof RightWorkbenchSession>(key: K, update: Update<RightWorkbenchSession[K]>, scope = this.scope): void {
    const current = this.session(scope)
    const next = typeof update === 'function' ? (update as (value: RightWorkbenchSession[K]) => RightWorkbenchSession[K])(current[key]) : update
    if (next === current[key]) return
    this.snapshot = { ...this.snapshot, [scope]: { ...current, [key]: next } }
    this.listeners.forEach((listener) => listener())
  }
  browserOwner(id: string): string | null {
    return Object.entries(this.snapshot).find(([, session]) => session.browsers.some((tab) => tab.id === id))?.[0] ?? null
  }
  remove(scope: string): string[] {
    const current = this.snapshot[scope]
    if (!current) return []
    const next = { ...this.snapshot }
    delete next[scope]
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
    return current.browsers.map((tab) => tab.id)
  }
  updateBrowser = (state: BrowserViewState): void => {
    for (const [scope, session] of Object.entries(this.snapshot)) {
      if (!session.browsers.some((tab) => tab.id === state.id)) continue
      this.update('browsers', session.browsers.map((tab) => tab.id === state.id ? { ...tab, state } : tab), scope)
      return
    }
  }
}
export function useRightWorkbenchSessions(scope: string) {
  const [store] = useState(() => new RightWorkbenchSessions())
  store.scope = scope
  store.session(scope)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const session = snapshot[scope]!
  const setters = useMemo(() => ({
    setWorkspaceOpen: (value: Update<boolean>) => store.update('workspaceOpen', value),
    setWorkspaceChromeState: (value: Update<WorkspaceChromeState>) => store.update('chrome', value),
    setRightWorkbenchTabsState: (value: Update<RightWorkbenchTabsState>) => store.update('tabs', value),
    setRightWorkbenchView: (value: Update<RightWorkbenchViewState>) => store.update('view', value),
    setBrowserTabs: (value: Update<WorkbenchBrowserTab[]>) => store.update('browsers', value),
    setOpenedSubagents: (value: Update<OpenedSubagentTab[]>) => store.update('subagents', value),
    setActiveSubagentId: (value: Update<string | null>) => store.update('activeSubagent', value)
  }), [store])
  return {
    ...setters, store,
    workspaceOpen: session.workspaceOpen, workspaceChromeState: session.chrome,
    rightWorkbenchTabs: session.tabs, rightWorkbenchView: session.view,
    browserTabs: session.browsers, openedSubagents: session.subagents, activeSubagentId: session.activeSubagent,
    allBrowserTabs: useMemo(() => Object.entries(snapshot).flatMap(([ownerScope, entry]) => entry.browsers.map((tab) => ({ ...tab, ownerScope }))), [snapshot])
  }
}

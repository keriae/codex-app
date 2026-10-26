import { useEffect, useState, useSyncExternalStore } from 'react'
import { TerminalTabsController, TerminalTabsRegistry, type TerminalTabsSnapshot } from './terminalTabs'

export function useTerminalTabsController(scopeKey: string): TerminalTabsController {
  const [registry] = useState(() => new TerminalTabsRegistry())
  useEffect(() => { registry.retain(); return () => registry.release() }, [registry])
  return registry.get(scopeKey)
}
export function useTerminalTabsSnapshot(controller: TerminalTabsController): TerminalTabsSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}

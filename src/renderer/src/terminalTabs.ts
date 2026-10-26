import type { InteractiveTerminalRuntime } from './interactiveTerminalRuntime'
import { DEFAULT_TERMINAL_PANEL_SIZE, type TerminalPanelPlacement } from './terminalPanelLayout'

export interface InteractiveTerminalTab { id: string; cwd: string; placement: TerminalPanelPlacement; customTitle?: string }
export interface TerminalTabsSnapshot {
  tabs: readonly InteractiveTerminalTab[]
  active: Record<TerminalPanelPlacement, string | null>
  visible: Record<TerminalPanelPlacement, boolean>
  sizes: Record<TerminalPanelPlacement, number>
  fullView: Record<TerminalPanelPlacement, boolean>
  canCreate: boolean
}
export const MAX_INTERACTIVE_TERMINAL_TABS = 8

/** Reservations include hidden scopes and shells that are still closing. */
export class TerminalTabsBudget {
  private count = 0
  private readonly listeners = new Set<() => void>()
  canCreate(): boolean { return this.count < MAX_INTERACTIVE_TERMINAL_TABS }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private notify(): void { for (const listener of this.listeners) listener() }
  reserve(): () => void {
    if (this.count >= MAX_INTERACTIVE_TERMINAL_TABS) throw new Error('Maximum number of terminals reached')
    this.count += 1
    this.notify()
    let reserved = true
    return () => { if (reserved) { reserved = false; this.count -= 1; this.notify() } }
  }
}

/** o6a/s6a/c6a: remove controls and redundant directory prefixes from OSC titles. */
export function terminalShellTitle(raw: string, cwd: string): string | null {
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const directory = cwd.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const name = directory.replace(/\/+$/, '').slice(directory.replace(/\/+$/, '').lastIndexOf('/') + 1)
  if (!title || title === directory || title === name) return null
  if (!directory) return title
  for (const separator of [': ', ' — ', ' - ', ' | ']) {
    for (const prefix of [directory, name]) if (prefix && title.startsWith(`${prefix}${separator}`)) return title.slice(prefix.length + separator.length).trim() || null
  }
  return title
}

/** Ubs: native title, otherwise cwd basename, numbered within the current panel. */
export function terminalTabTitle(tab: InteractiveTerminalTab, tabs: readonly InteractiveTerminalTab[]): string {
  const custom = tab.customTitle?.trim()
  if (custom) return custom
  const panelTabs = tabs.filter((item) => item.placement === tab.placement)
  const index = Math.max(0, panelTabs.findIndex((item) => item.id === tab.id)) + 1
  const cwd = tab.cwd.trim()
  const directory = cwd.replace(/\/+$/, '')
  const name = directory.slice(directory.lastIndexOf('/') + 1) || cwd
  return name ? panelTabs.length > 1 ? `${name} ${index}` : name : `Terminal ${index}`
}

/** Panel state and runtime ownership live above the independently rendered slots. */
export class TerminalTabsController {
  private readonly listeners = new Set<() => void>()
  private readonly runtimes = new Map<string, InteractiveTerminalRuntime>()
  private readonly runtimeObservers = new Map<string, () => void>()
  private readonly reservations = new Map<string, () => void>()
  private readonly closingRuntimes = new Set<Promise<void>>()
  private disposed = false
  private disposing: Promise<void> | null = null
  private leases = 0
  private leaseRevision = 0
  private readonly stopObservingBudget: () => void
  private snapshot: TerminalTabsSnapshot = {
    tabs: [], active: { bottom: null, right: null }, visible: { bottom: false, right: false },
    sizes: { ...DEFAULT_TERMINAL_PANEL_SIZE }, fullView: { bottom: false, right: false }, canCreate: true
  }
  constructor(
    private readonly createId: () => string = () => `terminal-tab-${crypto.randomUUID()}`,
    private readonly budget = new TerminalTabsBudget()
  ) {
    this.snapshot.canCreate = budget.canCreate()
    this.stopObservingBudget = budget.subscribe(() => {
      const canCreate = budget.canCreate()
      if (canCreate !== this.snapshot.canCreate) this.update({ canCreate })
    })
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = (): TerminalTabsSnapshot => this.snapshot
  retain(): void { this.assertOpen(); this.leases += 1; this.leaseRevision += 1 }
  release(): void {
    this.leases = Math.max(0, this.leases - 1)
    const revision = ++this.leaseRevision
    queueMicrotask(() => { if (this.leases === 0 && revision === this.leaseRevision) void this.dispose() })
  }
  private update(next: Partial<TerminalTabsSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }
  private assertOpen(): void { if (this.disposed) throw new Error('Terminal tabs are closed') }
  open(placement: TerminalPanelPlacement, cwd: string): string {
    this.assertOpen()
    const active = this.snapshot.active[placement]
    const existing = this.snapshot.tabs.find((tab) => tab.id === active && tab.placement === placement) ?? this.snapshot.tabs.find((tab) => tab.placement === placement)
    if (!existing) return this.create(placement, cwd)
    this.select(existing.id)
    return existing.id
  }
  create(placement: TerminalPanelPlacement, cwd: string): string {
    this.assertOpen()
    const tab = { id: this.createId(), cwd, placement }
    if (this.snapshot.tabs.some((item) => item.id === tab.id)) throw new Error('Terminal tab already exists')
    this.reservations.set(tab.id, this.budget.reserve())
    this.update({ tabs: [...this.snapshot.tabs, tab], active: { ...this.snapshot.active, [placement]: tab.id }, visible: { ...this.snapshot.visible, [placement]: true }, fullView: { ...this.snapshot.fullView, [placement]: false } })
    return tab.id
  }
  select(id: string): void {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab) return
    this.update({ active: { ...this.snapshot.active, [tab.placement]: id }, visible: { ...this.snapshot.visible, [tab.placement]: true } })
  }
  hide(placement: TerminalPanelPlacement): void {
    this.update({ visible: { ...this.snapshot.visible, [placement]: false }, fullView: { ...this.snapshot.fullView, [placement]: false } })
  }
  private afterRemoval(tab: InteractiveTerminalTab, remaining: readonly InteractiveTerminalTab[]) {
    const before = this.snapshot.tabs.filter((item) => item.placement === tab.placement)
    const index = before.findIndex((item) => item.id === tab.id)
    const neighbor = before[index + 1] ?? before[index - 1]
    const panel = remaining.filter((item) => item.placement === tab.placement)
    const active = this.snapshot.active[tab.placement] === tab.id ? neighbor?.id ?? null : this.snapshot.active[tab.placement]
    return {
      active: { ...this.snapshot.active, [tab.placement]: active },
      visible: { ...this.snapshot.visible, [tab.placement]: panel.length > 0 && this.snapshot.visible[tab.placement] },
      fullView: { ...this.snapshot.fullView, [tab.placement]: panel.length > 0 && this.snapshot.fullView[tab.placement] }
    }
  }
  async close(id: string): Promise<void> {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab) return
    const tabs = this.snapshot.tabs.filter((item) => item.id !== id)
    const runtime = this.runtimes.get(id)
    const releaseReservation = this.reservations.get(id)
    this.runtimes.delete(id)
    this.runtimeObservers.get(id)?.()
    this.runtimeObservers.delete(id)
    this.reservations.delete(id)
    this.update({ tabs, ...this.afterRemoval(tab, tabs) })
    const closing = (async () => { try { await runtime?.dispose() } finally { releaseReservation?.() } })()
    this.closingRuntimes.add(closing)
    try { await closing } finally { this.closingRuntimes.delete(closing) }
  }
  closeActive(placement: TerminalPanelPlacement): Promise<void> {
    const id = this.snapshot.active[placement]
    return id ? this.close(id) : Promise.resolve()
  }
  async closeOthers(id: string): Promise<void> {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab) return
    const ids = this.snapshot.tabs.filter((item) => item.placement === tab.placement && item.id !== id).map((item) => item.id)
    await Promise.all(ids.map((other) => this.close(other)))
  }
  async closeToRight(id: string): Promise<void> {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab) return
    const panel = this.snapshot.tabs.filter((item) => item.placement === tab.placement)
    await Promise.all(panel.slice(panel.findIndex((item) => item.id === id) + 1).map((item) => this.close(item.id)))
  }
  move(id: string, placement: TerminalPanelPlacement): void {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab || tab.placement === placement) return
    this.reorder(id, null, placement)
  }
  reorder(id: string, beforeId: string | null, placement: TerminalPanelPlacement): void {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab) return
    if (beforeId === id) { this.select(id); return }
    const before = this.snapshot.tabs.find((item) => item.id === beforeId && item.placement === placement)
    const remaining = this.snapshot.tabs.filter((item) => item.id !== id)
    const insertion = before ? remaining.findIndex((item) => item.id === before.id) : remaining.length
    const tabs = [...remaining.slice(0, insertion), { ...tab, placement }, ...remaining.slice(insertion)]
    if (tab.placement === placement) {
      this.update({ tabs, active: { ...this.snapshot.active, [placement]: id }, visible: { ...this.snapshot.visible, [placement]: true } })
    } else {
      const after = this.afterRemoval(tab, remaining)
      this.update({ tabs, active: { ...after.active, [placement]: id }, visible: { ...after.visible, [placement]: true }, fullView: { ...this.snapshot.fullView, [tab.placement]: false, [placement]: false } })
    }
  }
  setTitle(id: string, title: string | null): void {
    this.update({ tabs: this.snapshot.tabs.map((tab) => tab.id === id ? { ...tab, customTitle: title?.trim() || undefined } : tab) })
  }
  setShellTitle(id: string, title: string): void {
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (tab) this.setTitle(id, terminalShellTitle(title, tab.cwd))
  }
  setSize(placement: TerminalPanelPlacement, size: number): void {
    if (Number.isFinite(size)) this.update({ sizes: { ...this.snapshot.sizes, [placement]: size } })
  }
  toggleFullView(placement: TerminalPanelPlacement): void {
    this.update({ fullView: { bottom: false, right: false, [placement]: !this.snapshot.fullView[placement] } })
  }
  acquireRuntime(id: string, create: (tab: InteractiveTerminalTab) => InteractiveTerminalRuntime): InteractiveTerminalRuntime {
    this.assertOpen()
    const tab = this.snapshot.tabs.find((item) => item.id === id)
    if (!tab) throw new Error('Terminal tab is unavailable')
    let runtime = this.runtimes.get(id)
    if (!runtime) {
      runtime = create(tab)
      this.runtimes.set(id, runtime)
      const owned = runtime
      const removeExitedLocalSession = (): void => {
        const snapshot = owned.getSnapshot()
        // hJ.handleHostEvent removes local session mappings on exit unless an
        // error snapshot exists. Cloud stopped/Retry behavior is separate.
        if (this.runtimes.get(id) === owned && snapshot.state === 'exited' && snapshot.error === null) void this.close(id)
      }
      this.runtimeObservers.set(id, runtime.subscribe(removeExitedLocalSession))
      // A supplied factory can return a session whose startup already ended.
      queueMicrotask(removeExitedLocalSession)
    }
    return runtime
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    const runtimes = [...this.runtimes.values()]
    const reservations = [...this.reservations.values()]
    for (const stop of this.runtimeObservers.values()) stop()
    this.runtimeObservers.clear()
    this.runtimes.clear()
    this.reservations.clear()
    this.update({ tabs: [], active: { bottom: null, right: null }, visible: { bottom: false, right: false }, fullView: { bottom: false, right: false } })
    this.disposed = true
    this.stopObservingBudget()
    this.disposing = (async () => {
      await Promise.allSettled([...this.closingRuntimes, ...runtimes.map((runtime) => runtime.dispose())])
      for (const release of reservations) release()
      this.listeners.clear()
    })()
    return this.disposing
  }
}

/** Conversation changes select a controller; only the root owner closes them. */
export class TerminalTabsRegistry {
  private readonly controllers = new Map<string, TerminalTabsController>()
  private readonly budget = new TerminalTabsBudget()
  private disposed = false
  private disposing: Promise<void> | null = null
  private leases = 0
  private leaseRevision = 0
  constructor(private readonly createId?: () => string) {}
  get(scopeKey: string): TerminalTabsController {
    if (this.disposed) throw new Error('Terminal registry is closed')
    let controller = this.controllers.get(scopeKey)
    if (!controller) {
      controller = new TerminalTabsController(this.createId, this.budget)
      this.controllers.set(scopeKey, controller)
    }
    return controller
  }
  retain(): void {
    if (this.disposed) throw new Error('Terminal registry is closed')
    this.leases += 1
    this.leaseRevision += 1
  }
  release(): void {
    this.leases = Math.max(0, this.leases - 1)
    const revision = ++this.leaseRevision
    queueMicrotask(() => { if (this.leases === 0 && revision === this.leaseRevision) void this.dispose() })
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    const controllers = [...this.controllers.values()]
    this.controllers.clear()
    this.disposing = Promise.allSettled(controllers.map((controller) => controller.dispose())).then(() => {})
    return this.disposing
  }
}

import type { FitAddon } from '@xterm/addon-fit'
import type { ITheme, ITerminalOptions, Terminal } from '@xterm/xterm'
import { installTerminalMouseZoom, macTerminalKeyData, readXtermTheme } from './terminalXtermAdapter'

export interface InteractiveTerminalEvent {
  id: string
  type: 'output' | 'exit' | 'error'
  data?: string
  exitCode?: number | null
  message?: string
}
export interface InteractiveTerminalBridge {
  openTerminal(params: { cwd: string; cols: number; rows: number }): Promise<{ id: string }>
  writeTerminal(id: string, data: string): Promise<void>
  resizeTerminal(id: string, size: { cols: number; rows: number }): Promise<void>
  closeTerminal(id: string): Promise<void>
  onTerminalEvent(listener: (event: InteractiveTerminalEvent) => void): () => void
}
export function hasInteractiveTerminalBridge(value: unknown): value is InteractiveTerminalBridge {
  if (!value || typeof value !== 'object') return false
  const bridge = value as Record<string, unknown>
  return ['openTerminal', 'writeTerminal', 'resizeTerminal', 'closeTerminal', 'onTerminalEvent'].every((key) => typeof bridge[key] === 'function')
}

export class TerminalStartupEventBuffer {
  private readonly sessions = new Map<string, { events: InteractiveTerminalEvent[]; bytes: number; overflowed: boolean }>()
  constructor(private readonly maximumBytes = 1024 * 1024, private readonly maximumEvents = 4096) {}
  push(event: InteractiveTerminalEvent): void {
    let session = this.sessions.get(event.id)
    if (!session) {
      if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value!)
      session = { events: [], bytes: 0, overflowed: false }
      this.sessions.set(event.id, session)
    }
    if (session.overflowed) return
    session.bytes += (event.data?.length ?? 0) * 2 + (event.message?.length ?? 0) * 2 + 128
    if (session.bytes > this.maximumBytes || session.events.length >= this.maximumEvents) {
      session.events.length = 0
      session.overflowed = true
    } else session.events.push(event)
  }
  take(id: string): { events: InteractiveTerminalEvent[]; overflowed: boolean } {
    const result = this.sessions.get(id) ?? { events: [], overflowed: false }
    this.sessions.clear()
    return result
  }
  clear(): void { this.sessions.clear() }
}

export interface InteractiveTerminalRuntimeSnapshot {
  state: 'starting' | 'running' | 'exited' | 'error'
  error: string | null
  exitCode: number | null
  sessionId: string | null
}
export interface InteractiveTerminalRuntimeOptions {
  cwd: string
  fontSize?: number
  fontFamily?: string
  uiZoom?: number
  onTitleChange?(title: string): void
}
export interface InteractiveTerminalRuntimeDependencies {
  getBridge(): unknown
  loadTerminal(): Promise<new (options: ITerminalOptions) => Terminal>
  loadFit(): Promise<new () => FitAddon>
  readTheme(host: HTMLElement): ITheme
  installMouseZoom(terminal: Terminal, getZoom: () => number): () => void
  frame(callback: FrameRequestCallback): number
  cancelFrame(id: number): void
  observeHost(host: HTMLElement, callback: () => void): () => void
  observeTheme(callback: () => void): () => void
}
const DEFAULT_FONT = '"SFMono-Regular", Menlo, Monaco, Consolas, monospace'
const defaults: InteractiveTerminalRuntimeDependencies = {
  getBridge: () => window.codex,
  loadTerminal: async () => (await import('@xterm/xterm')).Terminal,
  loadFit: async () => (await import('@xterm/addon-fit')).FitAddon,
  readTheme: readXtermTheme,
  installMouseZoom: installTerminalMouseZoom,
  frame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  observeHost(host, callback) {
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(callback)
    observer?.observe(host)
    window.addEventListener('resize', callback)
    return () => { observer?.disconnect(); window.removeEventListener('resize', callback) }
  },
  observeTheme(callback) {
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(callback)
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    return () => observer?.disconnect()
  }
}

/** Owns one PTY and one xterm DOM node, independently of a tab's React parent. */
export class InteractiveTerminalRuntime {
  private readonly listeners = new Set<() => void>()
  private snapshot: InteractiveTerminalRuntimeSnapshot = { state: 'starting', error: null, exitCode: null, sessionId: null }
  private host: HTMLElement | null = null
  private terminal: Terminal | null = null
  private fit: FitAddon | null = null
  private bridge: InteractiveTerminalBridge | null = null
  private disposed = false
  private disposing: Promise<void> | null = null
  private readonly closingSessions = new Set<Promise<void>>()
  private leases = 0
  private leaseRevision = 0
  private generation = 0
  private starting: Promise<void> | null = null
  private frame: number | null = null
  private inputQueue = Promise.resolve()
  private resizeQueue = Promise.resolve()
  private lastSize: { cols: number; rows: number } | null = null
  private stopObservingHost = (): void => {}
  private cleanupSession: Array<() => void> = []
  private earlyEvents = new TerminalStartupEventBuffer()
  private options: Required<InteractiveTerminalRuntimeOptions>
  constructor(options: InteractiveTerminalRuntimeOptions, private readonly dependencies = defaults) {
    this.options = { cwd: options.cwd, fontSize: options.fontSize ?? 12, fontFamily: options.fontFamily ?? DEFAULT_FONT, uiZoom: options.uiZoom ?? 1, onTitleChange: options.onTitleChange ?? (() => {}) }
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = (): InteractiveTerminalRuntimeSnapshot => this.snapshot
  retain(): void { if (this.disposed) throw new Error('Terminal runtime is closed'); this.leases += 1; this.leaseRevision += 1 }
  release(): void {
    this.leases = Math.max(0, this.leases - 1)
    const revision = ++this.leaseRevision
    queueMicrotask(() => { if (this.leases === 0 && revision === this.leaseRevision) void this.dispose() })
  }
  private update(value: Partial<InteractiveTerminalRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...value }
    for (const listener of this.listeners) listener()
  }
  private fail(reason: unknown, fatal = true): void {
    if (this.disposed) return
    this.update({ error: reason instanceof Error ? reason.message : String(reason), ...(fatal ? { state: 'error' as const } : {}) })
    if (fatal && this.terminal) this.terminal.options.disableStdin = true
  }

  attach(host: HTMLElement): void {
    if (this.disposed) throw new Error('Terminal runtime is closed')
    this.stopObservingHost()
    this.host = host
    // Move the existing xterm node; moving a React tab never opens another PTY.
    if (this.terminal?.element && this.terminal.element.parentElement !== host) host.appendChild(this.terminal.element)
    this.stopObservingHost = this.dependencies.observeHost(host, this.scheduleFit)
    this.configure({})
    if (!this.terminal) void this.start()
  }
  detach(host: HTMLElement): void {
    if (this.host !== host) return
    this.stopObservingHost()
    this.stopObservingHost = () => {}
    this.host = null
    if (this.terminal?.element?.parentElement === host) this.terminal.element.remove()
    if (this.frame !== null) { this.dependencies.cancelFrame(this.frame); this.frame = null }
  }
  configure(options: Partial<Omit<InteractiveTerminalRuntimeOptions, 'cwd'>>): void {
    this.options = { ...this.options, ...options }
    if (this.terminal) {
      this.terminal.options.fontFamily = this.options.fontFamily
      this.terminal.options.fontSize = this.options.fontSize
      if (this.host) this.terminal.options.theme = this.dependencies.readTheme(this.host)
    }
    this.scheduleFit()
  }
  focus(): void {
    if (this.host && this.host.clientWidth > 0 && this.host.clientHeight > 0) this.terminal?.focus()
  }
  write(data: string): Promise<void> {
    const id = this.snapshot.sessionId
    const generation = this.generation
    if (!id || this.disposed || this.terminal?.options.disableStdin || !data) return Promise.resolve()
    const bridge = this.bridge!
    this.inputQueue = this.inputQueue.then(async () => {
      if (!this.disposed && generation === this.generation && !this.terminal?.options.disableStdin) await bridge.writeTerminal(id, data)
    }).catch((reason) => { if (generation === this.generation) this.fail(reason) })
    return this.inputQueue
  }
  private applyEvent(event: InteractiveTerminalEvent): void {
    if (this.disposed || event.id !== this.snapshot.sessionId || !this.terminal) return
    if (event.type === 'output' && typeof event.data === 'string') this.terminal.write(event.data)
    else if (event.type === 'exit') {
      this.terminal.options.disableStdin = true
      this.update({ state: 'exited', exitCode: typeof event.exitCode === 'number' ? event.exitCode : null })
    } else if (event.type === 'error') this.fail(event.message || 'The terminal encountered an error.')
  }
  private resizeProcess = (): void => {
    const id = this.snapshot.sessionId
    if (!id || !this.terminal || this.disposed || this.snapshot.state !== 'running') return
    const next = { cols: this.terminal.cols, rows: this.terminal.rows }
    if (this.lastSize?.cols === next.cols && this.lastSize.rows === next.rows) return
    this.lastSize = next
    const generation = this.generation
    this.resizeQueue = this.resizeQueue.then(async () => {
      if (!this.disposed && generation === this.generation && this.snapshot.state === 'running') await this.bridge!.resizeTerminal(id, next)
    }).catch((reason) => { if (generation === this.generation) this.fail(reason, false) })
  }
  private scheduleFit = (): void => {
    if (this.disposed || this.frame !== null || !this.host || !this.terminal) return
    this.frame = this.dependencies.frame(() => {
      this.frame = null
      const host = this.host
      if (!host?.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) return
      this.fit?.fit()
      this.resizeProcess()
    })
  }
  private start(): Promise<void> {
    if (this.starting) return this.starting
    const generation = this.generation
    const start = async (): Promise<void> => {
      const bridge = this.dependencies.getBridge()
      if (!hasInteractiveTerminalBridge(bridge)) throw new Error('Terminal is unavailable.')
      this.bridge = bridge
      const [Xterm, Fit] = await Promise.all([this.dependencies.loadTerminal(), this.dependencies.loadFit()])
      if (this.disposed || generation !== this.generation || !this.host) return
      const terminal = new Xterm({ fontFamily: this.options.fontFamily, fontSize: this.options.fontSize, theme: this.dependencies.readTheme(this.host), scrollback: 1000, convertEol: false, disableStdin: true, cursorBlink: false, allowProposedApi: false })
      this.terminal = terminal
      const fit = new Fit()
      this.fit = fit
      terminal.loadAddon(fit)
      terminal.open(this.host)
      terminal.attachCustomKeyEventHandler((event) => {
        const data = macTerminalKeyData(event)
        if (data === null) return true
        event.preventDefault(); event.stopPropagation(); void this.write(data)
        return false
      })
      const input = terminal.onData((data) => { void this.write(data) })
      const resized = terminal.onResize(this.resizeProcess)
      const title = terminal.onTitleChange((value) => this.options.onTitleChange(value))
      const removeZoom = this.dependencies.installMouseZoom(terminal, () => this.options.uiZoom)
      const stopTheme = this.dependencies.observeTheme(() => this.configure({}))
      const unsubscribe = bridge.onTerminalEvent((event) => {
        if (this.disposed || generation !== this.generation) return
        if (this.snapshot.sessionId) this.applyEvent(event)
        else this.earlyEvents.push(event)
      })
      this.cleanupSession.push(() => input.dispose(), () => resized.dispose(), () => title.dispose(), removeZoom, stopTheme, unsubscribe)
      await new Promise<void>((resolve) => this.dependencies.frame(() => resolve()))
      if (this.disposed || generation !== this.generation) return
      if (this.host && this.host.clientWidth > 0 && this.host.clientHeight > 0) fit.fit()
      const openingSize = { cols: terminal.cols, rows: terminal.rows }
      const opened = await bridge.openTerminal({ cwd: this.options.cwd, ...openingSize })
      if (!opened || typeof opened.id !== 'string' || !opened.id) throw new Error('Terminal could not be started.')
      if (this.disposed || generation !== this.generation) { await this.closeProcess(bridge, opened.id); return }
      const buffered = this.earlyEvents.take(opened.id)
      if (buffered.overflowed) { await this.closeProcess(bridge, opened.id); throw new Error('Terminal output exceeded the startup buffer.') }
      this.lastSize = openingSize
      terminal.options.disableStdin = false
      this.update({ state: 'running', sessionId: opened.id, error: null, exitCode: null })
      for (const event of buffered.events) this.applyEvent(event)
      this.scheduleFit()
    }
    const promise = start().catch((reason) => { if (generation === this.generation) this.fail(reason) }).finally(() => { if (this.starting === promise) this.starting = null })
    this.starting = promise
    return promise
  }
  private closeProcess(bridge: InteractiveTerminalBridge, id: string): Promise<void> {
    const closing = bridge.closeTerminal(id).catch(() => {})
    this.closingSessions.add(closing)
    void closing.then(() => this.closingSessions.delete(closing))
    return closing
  }
  private async closeSession(): Promise<void> {
    this.generation += 1
    this.starting = null
    this.stopObservingHost(); this.stopObservingHost = () => {}
    if (this.frame !== null) { this.dependencies.cancelFrame(this.frame); this.frame = null }
    for (const cleanup of this.cleanupSession.splice(0)) cleanup()
    this.earlyEvents.clear()
    this.terminal?.dispose(); this.terminal = null; this.fit = null
    const id = this.snapshot.sessionId
    this.snapshot = { state: 'starting', error: null, exitCode: null, sessionId: null }
    this.inputQueue = Promise.resolve(); this.resizeQueue = Promise.resolve(); this.lastSize = null
    if (id && this.bridge) await this.closeProcess(this.bridge, id)
  }
  async restart(): Promise<void> {
    if (this.disposed) return
    const host = this.host
    await this.closeSession()
    this.update({})
    if (host && !this.disposed) this.attach(host)
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    this.host = null
    this.disposing = (async () => {
      await this.closeSession()
      await Promise.allSettled([...this.closingSessions])
      this.listeners.clear()
    })()
    return this.disposing
  }
}

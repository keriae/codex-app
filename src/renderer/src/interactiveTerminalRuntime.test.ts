import type { FitAddon } from '@xterm/addon-fit'
import type { ITerminalOptions, Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InteractiveTerminalRuntime, type InteractiveTerminalBridge, type InteractiveTerminalEvent, type InteractiveTerminalRuntimeDependencies } from './interactiveTerminalRuntime'
import { TerminalTabsRegistry } from './terminalTabs'

class FakeElement {
  parentElement: FakeHost | null = null
  remove(): void { this.parentElement = null }
}
class FakeHost {
  clientWidth = 500
  clientHeight = 280
  isConnected = true
  appendChild(element: FakeElement): void { element.parentElement = this }
}
class FakeTerminal {
  cols = 80
  rows = 24
  element?: FakeElement
  readonly written: string[] = []
  readonly focus = vi.fn()
  readonly dispose = vi.fn(() => { this.element?.remove() })
  private readonly inputs = new Set<(data: string) => void>()
  private readonly resizes = new Set<() => void>()
  private readonly titles = new Set<(title: string) => void>()
  constructor(public options: ITerminalOptions) {}
  loadAddon(_fit: FakeFit): void {}
  open(host: FakeHost): void { this.element = new FakeElement(); host.appendChild(this.element) }
  write(data: string): void { this.written.push(data) }
  attachCustomKeyEventHandler(_handler: (event: KeyboardEvent) => boolean): void {}
  onData(listener: (data: string) => void) { this.inputs.add(listener); return { dispose: () => this.inputs.delete(listener) } }
  onResize(listener: () => void) { this.resizes.add(listener); return { dispose: () => this.resizes.delete(listener) } }
  onTitleChange(listener: (title: string) => void) { this.titles.add(listener); return { dispose: () => this.titles.delete(listener) } }
  title(value: string): void { for (const listener of this.titles) listener(value) }
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; for (const listener of this.resizes) listener() }
}
class FakeFit { readonly fit = vi.fn() }
const runtimes: InteractiveTerminalRuntime[] = []
afterEach(async () => { await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose())) })

function harness() {
  const listeners = new Set<(event: InteractiveTerminalEvent) => void>()
  const frames = new Map<number, FrameRequestCallback>()
  const terminals: FakeTerminal[] = []
  let frameId = 0
  let sessionId = 0
  const bridge: InteractiveTerminalBridge = {
    openTerminal: vi.fn(async () => ({ id: `pty-${++sessionId}` })),
    writeTerminal: vi.fn(async () => {}), resizeTerminal: vi.fn(async () => {}), closeTerminal: vi.fn(async () => {}),
    onTerminalEvent: vi.fn((listener) => { listeners.add(listener); return () => listeners.delete(listener) })
  }
  class TestTerminal extends FakeTerminal { constructor(options: ITerminalOptions) { super(options); terminals.push(this) } }
  const dependencies: InteractiveTerminalRuntimeDependencies = {
    getBridge: () => bridge,
    loadTerminal: async () => TestTerminal as unknown as new (options: ITerminalOptions) => Terminal,
    loadFit: async () => FakeFit as unknown as new () => FitAddon,
    readTheme: () => ({ foreground: '#ffffff' }), installMouseZoom: () => () => {},
    frame(callback) { frames.set(++frameId, callback); return frameId }, cancelFrame(id) { frames.delete(id) },
    observeHost: () => () => {}, observeTheme: () => () => {}
  }
  const create = (cwd = '/work', onTitleChange?: (title: string) => void): InteractiveTerminalRuntime => {
    const runtime = new InteractiveTerminalRuntime({ cwd, onTitleChange }, dependencies)
    runtimes.push(runtime)
    return runtime
  }
  const emit = (event: InteractiveTerminalEvent): void => { for (const listener of listeners) listener(event) }
  const settle = async (): Promise<void> => {
    for (let index = 0; index < 12; index++) {
      await Promise.resolve()
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(0)
    }
  }
  return { create, bridge, terminals, emit, settle, listeners, dependencies }
}
const elementHost = (host: FakeHost): HTMLElement => host as unknown as HTMLElement

describe('terminal runtime lifetime independent of React views', () => {
  it('moves the same DOM node and PTY between hosts and consumes output while detached', async () => {
    const test = harness()
    const runtime = test.create('/work/a')
    const original = new FakeHost()
    runtime.attach(elementHost(original))
    await test.settle()
    const terminal = test.terminals[0]
    const node = terminal.element
    const id = runtime.getSnapshot().sessionId!
    runtime.detach(elementHost(original))
    expect(node?.parentElement).toBeNull()
    test.emit({ id, type: 'output', data: 'output while hidden\r\n' })
    expect(terminal.written).toEqual(['output while hidden\r\n'])
    const next = new FakeHost()
    runtime.attach(elementHost(next))
    runtime.detach(elementHost(original))
    await test.settle()
    expect(terminal.element).toBe(node)
    expect(node?.parentElement).toBe(next)
    expect(test.bridge.openTerminal).toHaveBeenCalledTimes(1)
    expect(test.bridge.closeTerminal).not.toHaveBeenCalled()
    expect(terminal.dispose).not.toHaveBeenCalled()
    await runtime.write('pwd\r')
    expect(test.bridge.writeTerminal).toHaveBeenCalledWith(id, 'pwd\r')
  })
  it('keeps independent sessions isolated and closes only the disposed runtime', async () => {
    const test = harness()
    const first = test.create('/work/a')
    const second = test.create('/work/b')
    first.attach(elementHost(new FakeHost()))
    second.attach(elementHost(new FakeHost()))
    await test.settle()
    const firstId = first.getSnapshot().sessionId!
    const secondId = second.getSnapshot().sessionId!
    expect(firstId).not.toBe(secondId)
    test.emit({ id: secondId, type: 'output', data: 'second only' })
    expect(test.terminals[0].written).toEqual([])
    expect(test.terminals[1].written).toEqual(['second only'])
    await first.dispose()
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith(firstId)
    expect(test.bridge.closeTerminal).not.toHaveBeenCalledWith(secondId)
    test.emit({ id: secondId, type: 'output', data: 'still running' })
    expect(test.terminals[1].written).toEqual(['second only', 'still running'])
    expect(test.listeners.size).toBe(1)
  })
  it('replays Unicode output and exit emitted before openTerminal resolves', async () => {
    const test = harness()
    let opened = (_value: { id: string }): void => {}
    vi.mocked(test.bridge.openTerminal).mockImplementation(() => new Promise((resolve) => { opened = resolve }))
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    test.emit({ id: 'unrelated', type: 'output', data: 'other scope' })
    test.emit({ id: 'early', type: 'output', data: '你好🙂\r\n' })
    test.emit({ id: 'early', type: 'exit', exitCode: 7 })
    opened({ id: 'early' })
    await test.settle()
    expect(test.terminals[0].written).toEqual(['你好🙂\r\n'])
    expect(runtime.getSnapshot()).toMatchObject({ state: 'exited', exitCode: 7, sessionId: 'early' })
    await runtime.write('ignored')
    test.terminals[0].resize(103, 37)
    await test.settle()
    expect(test.bridge.writeTerminal).not.toHaveBeenCalled()
    expect(test.bridge.resizeTerminal).not.toHaveBeenCalled()
  })
  it('closes a PTY returned after its owning runtime was disposed', async () => {
    const test = harness()
    let opened = (_value: { id: string }): void => {}
    vi.mocked(test.bridge.openTerminal).mockImplementation(() => new Promise((resolve) => { opened = resolve }))
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    await runtime.dispose()
    expect(test.listeners.size).toBe(0)
    opened({ id: 'late' })
    await test.settle()
    expect(test.bridge.closeTerminal).toHaveBeenCalledTimes(1)
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith('late')
    expect(test.terminals[0].dispose).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().sessionId).toBeNull()
  })
  it('reconfigures fonts, titles and size without reopening the shell', async () => {
    const test = harness()
    const title = vi.fn()
    const runtime = test.create('/work', title)
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    const terminal = test.terminals[0]
    runtime.configure({ fontFamily: 'Menlo', fontSize: 15, uiZoom: 1.25 })
    terminal.title('work — npm dev')
    terminal.resize(103, 37)
    await test.settle()
    expect(terminal.options).toMatchObject({ fontFamily: 'Menlo', fontSize: 15 })
    expect(title).toHaveBeenCalledWith('work — npm dev')
    expect(test.bridge.resizeTerminal).toHaveBeenCalledWith(runtime.getSnapshot().sessionId, { cols: 103, rows: 37 })
    expect(test.bridge.openTerminal).toHaveBeenCalledTimes(1)
  })
  it('serializes input and skips a queued resize after process exit', async () => {
    const test = harness()
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    const first = runtime.write('a')
    const second = runtime.write('b')
    await Promise.all([first, second])
    expect(vi.mocked(test.bridge.writeTerminal).mock.calls.map((call) => call[1])).toEqual(['a', 'b'])
    test.terminals[0].resize(100, 30)
    test.emit({ id: runtime.getSnapshot().sessionId!, type: 'exit', exitCode: 0 })
    await test.settle()
    expect(test.bridge.resizeTerminal).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().error).toBeNull()
  })
  it('restart closes the old shell, unsubscribes, and starts one replacement', async () => {
    const test = harness()
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    const originalId = runtime.getSnapshot().sessionId!
    const restart = runtime.restart()
    await test.settle()
    await restart
    const replacementId = runtime.getSnapshot().sessionId!
    expect(replacementId).not.toBe(originalId)
    expect(test.bridge.closeTerminal).toHaveBeenCalledTimes(1)
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith(originalId)
    expect(test.bridge.openTerminal).toHaveBeenCalledTimes(2)
    expect(test.listeners.size).toBe(1)
    test.emit({ id: originalId, type: 'output', data: 'old' })
    test.emit({ id: replacementId, type: 'output', data: 'new' })
    expect(test.terminals[1].written).toEqual(['new'])
  })
  it('survives effect replay, then disposes on the final lease release', async () => {
    const test = harness()
    const runtime = test.create()
    runtime.retain()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    const id = runtime.getSnapshot().sessionId!
    runtime.release()
    runtime.retain()
    await test.settle()
    expect(test.bridge.closeTerminal).not.toHaveBeenCalled()
    runtime.release()
    await test.settle()
    expect(test.bridge.closeTerminal).toHaveBeenCalledTimes(1)
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith(id)
    expect(() => runtime.attach(elementHost(new FakeHost()))).toThrow('runtime is closed')
  })
  it('does not create xterm or a process when disposed during module loading', async () => {
    const test = harness()
    let loaded = (_value: new (options: ITerminalOptions) => Terminal): void => {}
    test.dependencies.loadTerminal = () => new Promise((resolve) => { loaded = resolve })
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await runtime.dispose()
    loaded(FakeTerminal as unknown as new (options: ITerminalOptions) => Terminal)
    await test.settle()
    expect(test.bridge.openTerminal).not.toHaveBeenCalled()
    expect(test.terminals).toHaveLength(0)
  })
  it('disposal waits for an in-flight restart close and prevents a replacement shell', async () => {
    const test = harness()
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    let finishClose = (): void => {}
    vi.mocked(test.bridge.closeTerminal).mockImplementation(() => new Promise((resolve) => { finishClose = resolve }))
    const restart = runtime.restart()
    let finished = false
    const disposing = runtime.dispose().then(() => { finished = true })
    try {
      await test.settle()
      expect(finished).toBe(false)
      expect(test.bridge.openTerminal).toHaveBeenCalledTimes(1)
      expect(test.bridge.closeTerminal).toHaveBeenCalledTimes(1)
    } finally {
      finishClose()
      await Promise.all([restart, disposing])
    }
    expect(finished).toBe(true)
    expect(test.bridge.openTerminal).toHaveBeenCalledTimes(1)
  })
})

describe('local terminal controller with a real runtime lifecycle', () => {
  it('removes an immediately exiting startup tab and holds its budget until PTY cleanup finishes', async () => {
    const test = harness()
    let tabId = 0
    const registry = new TerminalTabsRegistry(() => `tab-${++tabId}`)
    const controller = registry.get('first')
    const other = registry.get('other')
    let opened = (_value: { id: string }): void => {}
    let finishClose = (): void => {}
    vi.mocked(test.bridge.openTerminal).mockImplementation(() => new Promise((resolve) => { opened = resolve }))
    vi.mocked(test.bridge.closeTerminal).mockImplementation(() => new Promise((resolve) => { finishClose = resolve }))
    const id = controller.create('bottom', '/work')
    const runtime = controller.acquireRuntime(id, () => test.create())
    for (let index = 0; index < 7; index++) other.create('right', '/other')
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    test.emit({ id: 'fast-shell', type: 'output', data: 'exit\r\n' })
    test.emit({ id: 'fast-shell', type: 'exit', exitCode: 0 })
    opened({ id: 'fast-shell' })
    try {
      await test.settle()
      expect(controller.getSnapshot()).toMatchObject({ tabs: [], active: { bottom: null }, visible: { bottom: false }, canCreate: false })
      expect(test.bridge.closeTerminal).toHaveBeenCalledTimes(1)
      expect(test.bridge.closeTerminal).toHaveBeenCalledWith('fast-shell')
      expect(test.listeners.size).toBe(0)
      expect(() => other.create('right', '/other')).toThrow('Maximum number')
    } finally { finishClose() }
    await test.settle()
    expect(other.getSnapshot().canCreate).toBe(true)
    expect(() => other.create('right', '/other')).not.toThrow()
    await registry.dispose()
  })
  it('normal exit selects the adjacent tab while an existing error snapshot survives exit', async () => {
    const test = harness()
    let tabId = 0
    const registry = new TerminalTabsRegistry(() => `tab-${++tabId}`)
    const controller = registry.get('chat')
    const first = controller.create('bottom', '/work')
    const firstRuntime = controller.acquireRuntime(first, () => test.create())
    const second = controller.create('bottom', '/work')
    const secondRuntime = controller.acquireRuntime(second, () => test.create())
    firstRuntime.attach(elementHost(new FakeHost()))
    secondRuntime.attach(elementHost(new FakeHost()))
    await test.settle()
    controller.select(first)
    const firstSession = firstRuntime.getSnapshot().sessionId!
    const secondSession = secondRuntime.getSnapshot().sessionId!
    test.emit({ id: firstSession, type: 'exit', exitCode: 7 })
    await test.settle()
    expect(controller.getSnapshot().tabs.map((tab) => tab.id)).toEqual([second])
    expect(controller.getSnapshot().active.bottom).toBe(second)
    expect(controller.getSnapshot().visible.bottom).toBe(true)
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith(firstSession)
    test.emit({ id: secondSession, type: 'error', message: 'Transport failed' })
    test.emit({ id: secondSession, type: 'exit', exitCode: 1 })
    await test.settle()
    expect(controller.getSnapshot().tabs.map((tab) => tab.id)).toEqual([second])
    expect(secondRuntime.getSnapshot()).toMatchObject({ state: 'exited', error: 'Transport failed', exitCode: 1 })
    expect(test.bridge.closeTerminal).not.toHaveBeenCalledWith(secondSession)
    await registry.dispose()
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith(secondSession)
    expect(test.listeners.size).toBe(0)
  })
  it('removes a supplied runtime that already exited before the controller subscribed', async () => {
    const test = harness()
    const runtime = test.create()
    runtime.attach(elementHost(new FakeHost()))
    await test.settle()
    const session = runtime.getSnapshot().sessionId!
    test.emit({ id: session, type: 'exit', exitCode: 0 })
    expect(runtime.getSnapshot().state).toBe('exited')
    const registry = new TerminalTabsRegistry(() => 'supplied')
    const controller = registry.get('chat')
    const id = controller.create('bottom', '/work')
    controller.acquireRuntime(id, () => runtime)
    await test.settle()
    expect(controller.getSnapshot().tabs).toHaveLength(0)
    expect(controller.getSnapshot().canCreate).toBe(true)
    expect(test.bridge.closeTerminal).toHaveBeenCalledTimes(1)
    expect(test.bridge.closeTerminal).toHaveBeenCalledWith(session)
    await registry.dispose()
  })
})

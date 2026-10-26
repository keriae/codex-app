import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InteractiveTerminalRuntime } from './interactiveTerminalRuntime'
import { terminalShellTitle, terminalTabTitle, TerminalTabsController, TerminalTabsRegistry } from './terminalTabs'

const owners: Array<{ dispose(): Promise<void> }> = []
const createController = (): TerminalTabsController => {
  let index = 0
  const controller = new TerminalTabsController(() => `tab-${++index}`)
  owners.push(controller)
  return controller
}
const createRegistry = (): TerminalTabsRegistry => {
  let index = 0
  const registry = new TerminalTabsRegistry(() => `tab-${++index}`)
  owners.push(registry)
  return registry
}
const fakeRuntime = (dispose = vi.fn(async () => {})): InteractiveTerminalRuntime => ({
  dispose, subscribe: () => () => {}, getSnapshot: () => ({ state: 'starting', error: null, exitCode: null, sessionId: null })
}) as unknown as InteractiveTerminalRuntime
afterEach(async () => { await Promise.all(owners.splice(0).map((owner) => owner.dispose())) })

describe('source-derived terminal titles', () => {
  it('numbers unnamed tabs in panel order and retains custom titles', () => {
    const controller = createController()
    const first = controller.create('bottom', '/work/project/')
    const right = controller.create('right', '/work/project')
    const second = controller.create('bottom', '/work/project')
    let snapshot = controller.getSnapshot()
    expect(snapshot.tabs.map((tab) => terminalTabTitle(tab, snapshot.tabs))).toEqual(['project 1', 'project', 'project 2'])
    controller.setTitle(first, '  npm dev  ')
    controller.setTitle(right, ' ')
    controller.move(second, 'right')
    snapshot = controller.getSnapshot()
    expect(snapshot.tabs.map((tab) => terminalTabTitle(tab, snapshot.tabs))).toEqual(['npm dev', 'project 1', 'project 2'])
  })
  it('uses a directory root and Terminal fallback without inventing a basename', () => {
    const tabs = [
      { id: 'root', cwd: '/', placement: 'bottom' as const },
      { id: 'empty', cwd: ' ', placement: 'right' as const }
    ]
    expect(terminalTabTitle(tabs[0], tabs)).toBe('/')
    expect(terminalTabTitle(tabs[1], tabs)).toBe('Terminal 1')
  })
  it.each([': ', ' — ', ' - ', ' | '])('strips cwd prefixes followed by %s', (separator) => {
    expect(terminalShellTitle(`/work/project${separator}npm dev`, '/work/project')).toBe('npm dev')
    expect(terminalShellTitle(`project${separator}npm dev`, '/work/project')).toBe('npm dev')
  })
  it('removes controls, redundant names and empty OSC titles', () => {
    expect(terminalShellTitle('\u0000\u001f\u007f project \n', '/work/project')).toBeNull()
    expect(terminalShellTitle('/work/project', '/work/project')).toBeNull()
    expect(terminalShellTitle(' \n', '/work/project')).toBeNull()
    expect(terminalShellTitle(' npm\u0007 dev ', '')).toBe('npm dev')
    expect(terminalShellTitle('projector: npm', '/work/project')).toBe('projector: npm')
  })
})

describe('terminal tab ownership', () => {
  it('open reuses the active shell and its cwd while create always adds a tab', () => {
    const controller = createController()
    const first = controller.open('bottom', '/original')
    controller.hide('bottom')
    expect(controller.open('bottom', '/new-worktree')).toBe(first)
    expect(controller.getSnapshot().tabs[0].cwd).toBe('/original')
    const second = controller.create('bottom', '/new-worktree')
    expect(second).not.toBe(first)
    expect(controller.open('bottom', '/third')).toBe(second)
    expect(controller.getSnapshot().visible.bottom).toBe(true)
  })
  it('selects the next neighbor on close, then the previous, and hides the empty panel', async () => {
    const controller = createController()
    const first = controller.create('bottom', '/work')
    const middle = controller.create('bottom', '/work')
    const last = controller.create('bottom', '/work')
    controller.select(middle)
    await controller.close(middle)
    expect(controller.getSnapshot().active.bottom).toBe(last)
    await controller.close(last)
    expect(controller.getSnapshot().active.bottom).toBe(first)
    controller.toggleFullView('bottom')
    await controller.close(first)
    expect(controller.getSnapshot()).toMatchObject({ active: { bottom: null }, visible: { bottom: false }, fullView: { bottom: false } })
  })
  it('close others and close right leave the other panel intact', async () => {
    const controller = createController()
    const first = controller.create('bottom', '/work')
    const right = controller.create('right', '/work')
    const second = controller.create('bottom', '/work')
    const third = controller.create('bottom', '/work')
    await controller.closeToRight(second)
    expect(controller.getSnapshot().tabs.map((tab) => tab.id)).toEqual([first, right, second])
    expect(controller.getSnapshot().tabs.some((tab) => tab.id === third)).toBe(false)
    await controller.closeOthers(second)
    expect(controller.getSnapshot().tabs.map((tab) => tab.id)).toEqual([right, second])
    expect(controller.getSnapshot().active.right).toBe(right)
  })
  it('moving and hiding retain the runtime until actual tab close', async () => {
    const controller = createController()
    const first = controller.create('bottom', '/work')
    const second = controller.create('bottom', '/work')
    const dispose = vi.fn(async () => {})
    const runtime = fakeRuntime(dispose)
    const factory = vi.fn(() => runtime)
    expect(controller.acquireRuntime(first, factory)).toBe(runtime)
    controller.hide('bottom')
    controller.select(first)
    controller.setSize('bottom', 317)
    controller.move(first, 'right')
    expect(controller.acquireRuntime(first, factory)).toBe(runtime)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ active: { bottom: second, right: first }, visible: { bottom: true, right: true } })
    await controller.close(first)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('rejects a ninth tab and frees a reservation after close', async () => {
    const controller = createController()
    for (let index = 0; index < 8; index++) controller.create(index % 2 ? 'right' : 'bottom', '/work')
    expect(controller.getSnapshot().canCreate).toBe(false)
    expect(() => controller.create('bottom', '/work')).toThrow('Maximum number')
    await controller.close(controller.getSnapshot().tabs[0].id)
    expect(controller.getSnapshot().canCreate).toBe(true)
    expect(() => controller.create('bottom', '/work')).not.toThrow()
  })
  it('reorders within a panel without leaving full view or disposing its runtime', () => {
    const controller = createController()
    const first = controller.create('bottom', '/work')
    const second = controller.create('bottom', '/work')
    const last = controller.create('bottom', '/work')
    const dispose = vi.fn(async () => {})
    const runtime = fakeRuntime(dispose)
    controller.acquireRuntime(last, () => runtime)
    controller.toggleFullView('bottom')
    controller.reorder(last, first, 'bottom')
    expect(controller.getSnapshot().tabs.map((tab) => tab.id)).toEqual([last, first, second])
    expect(controller.getSnapshot().fullView.bottom).toBe(true)
    expect(controller.getSnapshot().active.bottom).toBe(last)
    expect(controller.acquireRuntime(last, () => { throw new Error('Must retain existing runtime') })).toBe(runtime)
    expect(dispose).not.toHaveBeenCalled()
  })
  it('inserts a moved tab at the target panel position and hides an emptied source', () => {
    const controller = createController()
    const source = controller.create('bottom', '/source')
    const target = controller.create('right', '/target')
    controller.reorder(source, target, 'right')
    expect(controller.getSnapshot().tabs.map((tab) => [tab.id, tab.placement])).toEqual([[source, 'right'], [target, 'right']])
    expect(controller.getSnapshot()).toMatchObject({ active: { bottom: null, right: source }, visible: { bottom: false, right: true } })
    const before = controller.getSnapshot()
    controller.reorder('another-chat-tab', target, 'right')
    expect(controller.getSnapshot()).toBe(before)
  })
})

describe('root-owned conversation terminal registry', () => {
  it('restores tabs, visibility, sizes and full view when returning to a scope', () => {
    const registry = createRegistry()
    const original = registry.get('thread-a')
    original.create('bottom', '/work/a')
    original.create('right', '/work/a')
    original.setSize('bottom', 321)
    original.setSize('right', 487)
    original.hide('bottom')
    original.toggleFullView('right')
    const before = original.getSnapshot()
    const other = registry.get('thread-b')
    other.create('bottom', '/work/b')
    expect(registry.get('thread-a')).toBe(original)
    expect(original.getSnapshot()).toBe(before)
    expect(other.getSnapshot().tabs).toHaveLength(1)
  })
  it('applies the eight-tab cap to hidden scopes and updates every controller', async () => {
    const registry = createRegistry()
    const first = registry.get('a')
    const second = registry.get('b')
    for (let index = 0; index < 4; index++) {
      first.create('bottom', '/work/a')
      second.create('right', '/work/b')
    }
    first.hide('bottom')
    expect(first.getSnapshot().canCreate).toBe(false)
    expect(second.getSnapshot().canCreate).toBe(false)
    expect(registry.get('c').getSnapshot().canCreate).toBe(false)
    expect(() => registry.get('c').create('bottom', '/work/c')).toThrow('Maximum number')
    await first.close(first.getSnapshot().tabs[0].id)
    expect(second.getSnapshot().canCreate).toBe(true)
    expect(registry.get('c').getSnapshot().canCreate).toBe(true)
  })
  it('keeps a closing process reserved until its asynchronous disposal completes', async () => {
    const registry = createRegistry()
    const first = registry.get('a')
    const second = registry.get('b')
    let finishClose = (): void => {}
    const pending = new Promise<void>((resolve) => { finishClose = resolve })
    const id = first.create('bottom', '/work')
    first.acquireRuntime(id, () => fakeRuntime(vi.fn(() => pending)))
    for (let index = 0; index < 7; index++) second.create('bottom', '/work')
    const closing = first.close(id)
    expect(first.getSnapshot().tabs).toHaveLength(0)
    expect(() => second.create('bottom', '/work')).toThrow('Maximum number')
    finishClose()
    await closing
    expect(() => second.create('bottom', '/work')).not.toThrow()
  })
  it('survives StrictMode effect replay and closes all scope runtimes on final release', async () => {
    const registry = createRegistry()
    const disposeA = vi.fn(async () => {})
    const disposeB = vi.fn(async () => {})
    for (const [scope, dispose] of [['a', disposeA], ['b', disposeB]] as const) {
      const controller = registry.get(scope)
      const id = controller.create('bottom', '/work')
      controller.acquireRuntime(id, () => fakeRuntime(dispose))
    }
    registry.retain()
    registry.release()
    registry.retain()
    await Promise.resolve()
    expect(disposeA).not.toHaveBeenCalled()
    expect(disposeB).not.toHaveBeenCalled()
    registry.release()
    await Promise.resolve()
    await Promise.resolve()
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(disposeB).toHaveBeenCalledTimes(1)
    expect(() => registry.get('a')).toThrow('registry is closed')
  })
  it('root disposal waits for tabs that were already closing', async () => {
    const registry = createRegistry()
    const controller = registry.get('a')
    let finishClose = (): void => {}
    const pending = new Promise<void>((resolve) => { finishClose = resolve })
    const id = controller.create('bottom', '/work')
    const dispose = vi.fn(() => pending)
    controller.acquireRuntime(id, () => fakeRuntime(dispose))
    const closing = controller.close(id)
    let finished = false
    const disposing = registry.dispose().then(() => { finished = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(dispose).toHaveBeenCalledTimes(1)
    finishClose()
    await Promise.all([closing, disposing])
    expect(finished).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

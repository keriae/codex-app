import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// Execute the actual native close handler with synthetic UI bindings, without booting App.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let closeSource = ''
function findClose(node: ts.Node): void {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'close' && ts.isArrowFunction(node.initializer) && node.initializer.getText(source).includes('focusedPanel')) closeSource = node.initializer.getText(source)
  ts.forEachChild(node, findClose)
}
findClose(source)
if (!closeSource) throw new Error('Native close handler not found')
const compiled = ts.transpileModule(`const closeCurrentView = ${closeSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function fixture(overrides: Record<string, unknown> = {}) {
  const cancel = { disabled: false, click: vi.fn() }
  const bindings = {
    windowCloseRequest: null, serverRequestQueue: [] as unknown[], localEnvironmentOpen: false,
    setLocalEnvironmentOpen: vi.fn(), projectModalOpen: false,
    document: { querySelector: vi.fn(() => null as null | { querySelector(): typeof cancel }), activeElement: null },
    threadDialog: null, threadActionBusy: false, setThreadDialog: vi.fn(),
    terminalSheetOpen: false, setTerminalSheetOpen: vi.fn(),
    terminalState: { visible: { bottom: false, right: false } },
    terminalController: { closeActive: vi.fn(async () => {}) },
    sideChatOpen: false, closeSideChat: vi.fn(), settingsOpen: false, primaryView: 'chats', openPrimaryView: vi.fn(),
    rightWorkbenchOpen: true,
    rightWorkbenchChatSelected: false,
    rightSurface: null as 'workspace' | 'subagent' | 'sideChat' | 'browser' | 'terminal' | null,
    openedSubagent: null, closeSubagent: vi.fn(),
    activeBrowserTabId: null as string | null, closeBrowserTab: vi.fn(),
    window: { codex: { requestWindowClose: vi.fn(async () => {}) }, dispatchEvent: vi.fn() },
    setThreadNotice: vi.fn(), displayError: String, CLOSE_WORKSPACE_CONTENT_EVENT: 'close-content', CLOSE_WORKSPACE_FILE_EVENT: 'close-file', CustomEvent: Event,
    ...overrides
  }
  const close = new Function(...Object.keys(bindings), `${compiled}\nreturn closeCurrentView`)(...Object.values(bindings)) as (origin: string) => void
  return { bindings, close, cancel }
}

describe('native Cmd+W modal routing', () => {
  it('preserves a busy project confirmation instead of closing its page or terminal', () => {
    const test = fixture({ primaryView: 'projects', projectModalOpen: true, terminalState: { visible: { bottom: true, right: true } } })
    test.cancel.disabled = true
    test.bindings.document.querySelector.mockReturnValue({ querySelector: () => test.cancel })
    test.close('shortcut')
    expect(test.cancel.click).not.toHaveBeenCalled()
    expect(test.bindings.openPrimaryView).not.toHaveBeenCalled()
    expect(test.bindings.terminalController.closeActive).not.toHaveBeenCalled()
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('cancels an idle project modal found before the observer state catches up', () => {
    const test = fixture()
    test.bindings.document.querySelector.mockReturnValue({ querySelector: () => test.cancel })
    test.close('shortcut')
    expect(test.cancel.click).toHaveBeenCalledOnce()
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('keeps server approvals and busy thread actions open', () => {
    const approval = fixture({ serverRequestQueue: [{}], terminalState: { visible: { bottom: false, right: true } } })
    approval.close('shortcut')
    expect(approval.bindings.terminalController.closeActive).not.toHaveBeenCalled()
    const busy = fixture({ threadDialog: {}, threadActionBusy: true })
    busy.close('shortcut')
    expect(busy.bindings.setThreadDialog).not.toHaveBeenCalled()
    expect(busy.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('cancels idle thread/environment dialogs before routing to underlying content', () => {
    const thread = fixture({ threadDialog: {} })
    thread.close('shortcut')
    expect(thread.bindings.setThreadDialog).toHaveBeenCalledWith(null)
    const environment = fixture({ localEnvironmentOpen: true })
    environment.close('shortcut')
    expect(environment.bindings.setLocalEnvironmentOpen).toHaveBeenCalledWith(false)
  })

  it('retains ordinary terminal and window routing when no modal is present', () => {
    const terminal = fixture({ terminalState: { visible: { bottom: true, right: false } } })
    terminal.close('shortcut')
    expect(terminal.bindings.terminalController.closeActive).toHaveBeenCalledWith('bottom')
    const window = fixture()
    window.close('shortcut')
    expect(window.bindings.window.codex.requestWindowClose).toHaveBeenCalledWith('shortcut')
  })
  it('closes the agent transcript before routing to the underlying window', () => {
    const test = fixture({ rightSurface: 'subagent', openedSubagent: { threadId: 'child', name: 'Agent' } })
    test.close('shortcut')
    expect(test.bindings.closeSubagent).toHaveBeenCalledOnce()
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('closes only the active right-workbench tab when retained tabs coexist', () => {
    const test = fixture({
      rightSurface: 'sideChat',
      sideChatOpen: true,
      openedSubagent: { threadId: 'child', name: 'Agent' }
    })
    test.close('shortcut')
    expect(test.bindings.closeSideChat).toHaveBeenCalledOnce()
    expect(test.bindings.closeSubagent).not.toHaveBeenCalled()
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('delegates workspace Cmd+W to the workspace active-content router', () => {
    const test = fixture({ rightSurface: 'workspace' })
    test.bindings.document.querySelector.mockReturnValue(null)
    test.close('shortcut')
    expect(test.bindings.window.dispatchEvent).toHaveBeenCalledOnce()
    expect(test.bindings.window.dispatchEvent.mock.calls[0][0].type).toBe('close-file')
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('closes the active browser tab before the native window', () => {
    const test = fixture({ rightSurface: 'browser', activeBrowserTabId: 'web-1' })
    test.close('shortcut')
    expect(test.bindings.closeBrowserTab).toHaveBeenCalledWith('web-1')
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })

  it('does not close a retained browser tab while the workbench is hidden', () => {
    const test = fixture({ rightWorkbenchOpen: false, rightSurface: 'browser', activeBrowserTabId: 'web-1' })
    test.close('shortcut')
    expect(test.bindings.closeBrowserTab).not.toHaveBeenCalled()
    expect(test.bindings.window.codex.requestWindowClose).toHaveBeenCalledWith('shortcut')
  })

  it('does not close the retained workbench tab while chat is selected in full view', () => {
    const test = fixture({
      rightWorkbenchChatSelected: true,
      rightSurface: 'browser',
      activeBrowserTabId: 'web-1'
    })
    test.close('shortcut')
    expect(test.bindings.closeBrowserTab).not.toHaveBeenCalled()
    expect(test.bindings.window.codex.requestWindowClose).toHaveBeenCalledWith('shortcut')
  })

  it('closes the active unified right terminal rather than a background workbench tab', () => {
    const test = fixture({ rightSurface: 'terminal', terminalState: { visible: { bottom: false, right: true } } })
    test.close('shortcut')
    expect(test.bindings.terminalController.closeActive).toHaveBeenCalledWith('right')
    expect(test.bindings.window.codex.requestWindowClose).not.toHaveBeenCalled()
  })
})

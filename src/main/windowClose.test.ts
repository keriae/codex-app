import { describe, expect, it, vi } from 'vitest'
import { WindowCloseBroker, WindowCloseController, isWindowCloseResponse } from './windowClose'
import type { ClosableWindow } from './windowClose'
import type { WindowCloseRequest, WindowCloseResponse } from '../shared/api'

const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

describe('recorded native window close confirmation policy', () => {
  function fixture(policy: 'shortcut' | 'always' | 'never' = 'shortcut') {
    let selectedPolicy = policy
    let destroyed = false
    let finish: (response: WindowCloseResponse) => void = () => {}
    const confirm = vi.fn(() => new Promise<WindowCloseResponse>((resolve) => { finish = resolve }))
    const disable = vi.fn(() => { selectedPolicy = 'never' })
    const committed = vi.fn()
    const window: ClosableWindow = {
      isDestroyed: () => destroyed,
      close: () => { if (!controller.shouldPreventClose(window)) committed() }
    }
    const controller = new WindowCloseController(() => selectedPolicy, confirm, disable)
    return { window, controller, confirm, disable, committed, finish: (response: WindowCloseResponse) => finish(response), destroy: () => { destroyed = true } }
  }

  it('warns for Cmd+W but allows the system close button in shortcut-only mode', async () => {
    const shortcut = fixture()
    shortcut.controller.requestClose(shortcut.window, 'shortcut')
    expect(shortcut.confirm).toHaveBeenCalledWith(shortcut.window, 'shortcut')
    expect(shortcut.committed).not.toHaveBeenCalled()
    shortcut.finish({ confirmed: true })
    await settle()
    expect(shortcut.committed).toHaveBeenCalledTimes(1)
    const system = fixture()
    system.window.close()
    expect(system.confirm).not.toHaveBeenCalled()
    expect(system.committed).toHaveBeenCalledTimes(1)
  })

  it('coalesces repeated close attempts and keeps canceled windows open', async () => {
    const test = fixture('always')
    test.window.close()
    test.controller.requestClose(test.window, 'shortcut')
    expect(test.confirm).toHaveBeenCalledTimes(1)
    test.finish({ confirmed: false, doNotAskAgain: true })
    await settle()
    expect(test.disable).not.toHaveBeenCalled()
    expect(test.committed).not.toHaveBeenCalled()
    test.window.close()
    expect(test.confirm).toHaveBeenCalledTimes(2)
  })

  it('persists do-not-ask before approving close and ignores destroyed receivers', async () => {
    const test = fixture('always')
    test.window.close()
    test.finish({ confirmed: true, doNotAskAgain: true })
    await settle()
    expect(test.disable).toHaveBeenCalledTimes(1)
    expect(test.committed).toHaveBeenCalledTimes(1)
    expect(test.disable.mock.invocationCallOrder[0]).toBeLessThan(test.committed.mock.invocationCallOrder[0]!)
    const gone = fixture('always')
    gone.window.close()
    gone.destroy()
    gone.finish({ confirmed: true, doNotAskAgain: true })
    await settle()
    expect(gone.disable).not.toHaveBeenCalled()
    expect(gone.committed).not.toHaveBeenCalled()
  })

  it('never asks in never mode, including native close shortcut requests', () => {
    const test = fixture('never')
    test.controller.requestClose(test.window, 'shortcut')
    expect(test.confirm).not.toHaveBeenCalled()
    expect(test.committed).toHaveBeenCalledTimes(1)
  })
})

describe('renderer-backed window close confirmation broker', () => {
  it('requires a ready document and accepts a strict matching response once', async () => {
    const broker = new WindowCloseBroker<object>()
    const window = {}
    const requests: WindowCloseRequest[] = []
    expect(await broker.confirm(window, 'shortcut', (request) => requests.push(request))).toEqual({ confirmed: false })
    broker.setReady(window, true)
    const pending = broker.confirm(window, 'shortcut', (request) => requests.push(request))
    const request = requests[0]!
    expect(request.origin).toBe('shortcut')
    expect(() => broker.respond({}, request.id, { confirmed: true })).toThrow()
    expect(() => broker.respond(window, request.id, { confirmed: 'true' })).toThrow()
    expect(() => broker.respond(window, request.id, { confirmed: true, extra: true })).toThrow()
    broker.respond(window, request.id, { confirmed: true, doNotAskAgain: false })
    expect(await pending).toEqual({ confirmed: true, doNotAskAgain: false })
    expect(() => broker.respond(window, request.id, { confirmed: true })).toThrow()
    expect(isWindowCloseResponse({ confirmed: false })).toBe(true)
  })

  it('cancels a pending modal on reload and rejects its stale response', async () => {
    const broker = new WindowCloseBroker<object>()
    const window = {}
    let request: WindowCloseRequest | null = null
    broker.setReady(window, true)
    const pending = broker.confirm(window, 'window', (value) => { request = value })
    broker.setReady(window, false)
    expect(await pending).toEqual({ confirmed: false })
    expect(() => broker.respond(window, request!.id, { confirmed: true })).toThrow()
    expect(await broker.confirm(window, 'window', () => {})).toEqual({ confirmed: false })
  })
})

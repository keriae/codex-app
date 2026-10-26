import { describe, expect, it } from 'vitest'
import { RendererDocumentTracker } from './rendererDocument'
import { WindowCloseBroker } from './windowClose'
import type { WindowCloseRequest } from '../shared/api'

describe('native renderer document readiness lifecycle', () => {
  it('rejects queued readiness from an expired document and allows the replacement listener', async () => {
    const documents = new RendererDocumentTracker<object>()
    const broker = new WindowCloseBroker<object>()
    const window = {}
    const oldGeneration = documents.generation(window)
    documents.assertCurrent(window, oldGeneration)
    broker.setReady(window, true)
    let oldRequest: WindowCloseRequest | null = null
    const oldClose = broker.confirm(window, 'shortcut', (request) => { oldRequest = request })
    documents.invalidate(window)
    broker.setReady(window, false)
    expect(await oldClose).toEqual({ confirmed: false })
    expect(() => documents.assertCurrent(window, oldGeneration)).toThrow('expired')
    expect(() => broker.respond(window, oldRequest!.id, { confirmed: true })).toThrow('expired')
    expect(await broker.confirm(window, 'window', () => {})).toEqual({ confirmed: false })
    documents.assertCurrent(window, documents.generation(window))
    broker.setReady(window, true)
    let replacement: WindowCloseRequest | null = null
    const newClose = broker.confirm(window, 'window', (request) => { replacement = request })
    expect(replacement!.id).not.toBe(oldRequest!.id)
    broker.respond(window, replacement!.id, { confirmed: true })
    expect(await newClose).toEqual({ confirmed: true })
  })

  it('rejects malformed generations and tracks each native window independently', () => {
    const documents = new RendererDocumentTracker<object>()
    const one = {}
    const two = {}
    documents.invalidate(one)
    expect(documents.generation(one)).toBe(1)
    expect(documents.generation(two)).toBe(0)
    for (const value of ['1', undefined, NaN, Infinity, -1, 0, 1.5]) {
      expect(() => documents.assertCurrent(one, value)).toThrow()
    }
    expect(() => documents.assertCurrent(one, 1)).not.toThrow()
  })

  it('cancels an in-flight modal when app quitting disables its renderer service', async () => {
    const broker = new WindowCloseBroker<object>()
    const window = {}
    let request: WindowCloseRequest | null = null
    broker.setReady(window, true)
    const pending = broker.confirm(window, 'shortcut', (value) => { request = value })
    broker.setReady(window, false)
    expect(await pending).toEqual({ confirmed: false })
    expect(() => broker.respond(window, request!.id, { confirmed: true, doNotAskAgain: true })).toThrow()
  })
})

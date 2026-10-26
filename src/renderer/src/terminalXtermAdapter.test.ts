import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { installTerminalMouseZoom, macTerminalKeyData, terminalMouseCoordinates } from './terminalXtermAdapter'

const key = (value: string, override: Partial<KeyboardEvent> = {}) => ({
  type: 'keydown', key: value, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...override
})

describe('installed macOS xterm compatibility', () => {
  it.each([
    ['ArrowLeft', '\u0001'], ['ArrowUp', '\u0001'],
    ['ArrowRight', '\u0005'], ['ArrowDown', '\u0005'],
    ['Backspace', '\u0015'], ['Delete', '\u000b']
  ])('maps Command+%s to its original shell editing sequence', (value, sequence) => {
    expect(macTerminalKeyData(key(value))).toBe(sequence)
  })

  it('leaves nonmatching keys and modifier combinations to xterm', () => {
    for (const modifiers of [{ metaKey: false }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { type: 'keyup' }]) {
      expect(macTerminalKeyData(key('ArrowLeft', modifiers))).toBeNull()
    }
    for (const value of ['k', 'c', 'v', 'Enter']) expect(macTerminalKeyData(key(value))).toBeNull()
  })

  it('corrects CSS zoom relative to the physical terminal origin', () => {
    const event = { clientX: 450, clientY: 220 }
    const bounds = { left: 200, top: 120 }
    expect(terminalMouseCoordinates(event, bounds, 1.25)).toEqual({ clientX: 400, clientY: 200 })
    expect(terminalMouseCoordinates(event, bounds, 0.5)).toEqual({ clientX: 700, clientY: 320 })
    for (const zoom of [1, 0, -1, Number.NaN]) expect(terminalMouseCoordinates(event, bounds, zoom)).toBe(event)
  })

  it('adapts and restores xterm mouse, report and selection services', () => {
    const bounds = { left: 200, top: 120 }
    const element = { getBoundingClientRect: () => bounds } as HTMLElement
    const getCoords = vi.fn(function (this: unknown, event: unknown, target: unknown, ...rest: unknown[]) { return { receiver: this, event, target, rest } })
    const getMouseReportCoords = vi.fn(function (this: unknown, event: unknown, _target: unknown) { return { receiver: this, event } })
    const scroll = vi.fn(function (this: unknown, event: unknown) { return { receiver: this, event } })
    const mouse = { getCoords, getMouseReportCoords }
    const selection = { _screenElement: element, _getMouseEventScrollAmount: scroll }
    const terminal = { _core: { _mouseService: mouse, _selectionService: selection } } as unknown as Terminal
    const remove = installTerminalMouseZoom(terminal, () => 1.25)
    const event = { clientX: 450, clientY: 220 }
    expect(mouse.getCoords(event, element, 80, 24)).toEqual({ receiver: mouse, event: { clientX: 400, clientY: 200 }, target: element, rest: [80, 24] })
    expect(mouse.getMouseReportCoords(event, element)).toEqual({ receiver: mouse, event: { clientX: 400, clientY: 200 } })
    expect(selection._getMouseEventScrollAmount(event)).toEqual({ receiver: selection, event: { clientX: 400, clientY: 200 } })
    remove()
    expect(mouse.getCoords).toBe(getCoords)
    expect(mouse.getMouseReportCoords).toBe(getMouseReportCoords)
    expect(selection._getMouseEventScrollAmount).toBe(scroll)
    expect(installTerminalMouseZoom({} as Terminal, () => 1.25)).not.toThrow()
  })
})

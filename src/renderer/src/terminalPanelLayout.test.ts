import { describe, expect, it } from 'vitest'
import {
  clampTerminalPanelSize,
  DEFAULT_TERMINAL_PANEL_SIZE,
  shouldCollapseTerminalPanel,
  terminalPanelDragSize,
  terminalPanelKeyboardSize,
  terminalPanelSizeLimits
} from './terminalPanelLayout'

describe('docked terminal panel geometry', () => {
  it('uses the shipped bottom and right defaults', () => {
    expect(DEFAULT_TERMINAL_PANEL_SIZE).toEqual({ bottom: 280, right: 500 })
    expect(clampTerminalPanelSize(Number.NaN, 'bottom', 900)).toBe(280)
    expect(clampTerminalPanelSize(Number.NaN, 'right', 1200)).toBe(500)
  })

  it('preserves the original bottom minimum and half-height limit', () => {
    expect(terminalPanelSizeLimits('bottom', 800)).toEqual({ minimum: 160, maximum: 400 })
    expect(clampTerminalPanelSize(700, 'bottom', 800)).toBe(400)
    expect(clampTerminalPanelSize(100, 'bottom', 800)).toBe(160)
    expect(clampTerminalPanelSize(280, 'bottom', 300)).toBe(160)
  })

  it('keeps the regular right panel from consuming the conversation minimum', () => {
    expect(terminalPanelSizeLimits('right', 1000)).toEqual({ minimum: 320, maximum: 648 })
    expect(clampTerminalPanelSize(900, 'right', 1000)).toBe(648)
    expect(clampTerminalPanelSize(500, 'right', 600)).toBe(320)
    expect(terminalPanelSizeLimits('right', 1000, true).maximum).toBe(1000)
  })

  it('interprets top/left dragging and the original half-minimum collapse threshold', () => {
    expect(terminalPanelDragSize(280, 600, 550)).toBe(330)
    expect(terminalPanelDragSize(500, 800, 900)).toBe(400)
    expect(shouldCollapseTerminalPanel(79, 'bottom')).toBe(true)
    expect(shouldCollapseTerminalPanel(80, 'bottom')).toBe(false)
    expect(shouldCollapseTerminalPanel(159, 'right')).toBe(true)
    expect(shouldCollapseTerminalPanel(160, 'right')).toBe(false)
  })

  it('resizes only along its keyboard axis and keeps keyboard actions bounded', () => {
    expect(terminalPanelKeyboardSize('ArrowUp', 280, 'bottom', 800)).toBe(290)
    expect(terminalPanelKeyboardSize('ArrowDown', 160, 'bottom', 800)).toBe(160)
    expect(terminalPanelKeyboardSize('ArrowLeft', 500, 'right', 1000, true)).toBe(540)
    expect(terminalPanelKeyboardSize('ArrowRight', 500, 'bottom', 800)).toBeNull()
    expect(terminalPanelKeyboardSize('Home', 500, 'right', 1000)).toBe(320)
    expect(terminalPanelKeyboardSize('End', 280, 'bottom', 800)).toBe(400)
  })
})

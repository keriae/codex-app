import { describe, expect, it } from 'vitest'
import { parseWindowState, restoreWindowBounds } from './windowState'

describe('parseWindowState', () => {
  it('accepts a finite saved window snapshot', () => {
    expect(
      parseWindowState(
        JSON.stringify({
          bounds: { x: 20, y: 30, width: 1200, height: 800 },
          maximized: true,
          fullScreen: false
        })
      )
    ).toEqual({
      bounds: { x: 20, y: 30, width: 1200, height: 800 },
      maximized: true,
      fullScreen: false
    })
  })

  it('rejects malformed, non-finite, and non-positive bounds', () => {
    expect(parseWindowState('{')).toBeNull()
    expect(
      parseWindowState(
        JSON.stringify({ bounds: { x: 0, y: 0, width: -1, height: 800 } })
      )
    ).toBeNull()
    expect(
      parseWindowState(
        JSON.stringify({ bounds: { x: 0, y: 0, width: null, height: 800 } })
      )
    ).toBeNull()
  })
})

describe('restoreWindowBounds', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 }

  it('restores and clamps a window to its visible display', () => {
    expect(
      restoreWindowBounds(
        { x: 1200, y: 700, width: 1000, height: 700 },
        [workArea],
        { width: 1420, height: 900 }
      )
    ).toEqual({ x: 440, y: 200, width: 1000, height: 700 })
  })

  it('falls back when a saved window is no longer on a connected display', () => {
    expect(
      restoreWindowBounds(
        { x: 4000, y: 200, width: 1000, height: 700 },
        [workArea],
        { width: 1420, height: 900 }
      )
    ).toEqual({ width: 1420, height: 900 })
  })

  it('falls back cleanly without display information', () => {
    expect(
      restoreWindowBounds(
        { x: 20, y: 30, width: 1000, height: 700 },
        [],
        { width: 1420, height: 900 }
      )
    ).toEqual({ width: 1420, height: 900 })
  })
})

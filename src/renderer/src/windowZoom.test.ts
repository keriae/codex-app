import { describe, expect, it } from 'vitest'
import { normalizeWindowZoom, readWindowZoom, toLogicalRect, toLogicalViewport } from './windowZoom'

describe('window zoom coordinates', () => {
  it('uses the supported stored factors and falls back for malformed preferences', () => {
    for (const value of [0.5, 1.5, 3, ' 1.5 ']) expect(normalizeWindowZoom(value)).toBe(Number(value))
    for (const value of [null, undefined, '', 'bad', true, 0, 0.4, 3.1, Number.NaN, Number.POSITIVE_INFINITY]) expect(normalizeWindowZoom(value)).toBe(1)
    expect(readWindowZoom()).toBe(1)
  })

  it('converts physical measured rectangles and viewport dimensions to the same logical space', () => {
    expect(toLogicalRect({ top: 45, right: 345, bottom: 90, left: 300, width: 45, height: 45 }, 1.5)).toEqual({ top: 30, right: 230, bottom: 60, left: 200, width: 30, height: 30 })
    expect(toLogicalViewport({ width: 1200, height: 900 }, 1.5)).toEqual({ width: 800, height: 600 })
    expect(toLogicalViewport({ width: 1200, height: 900 }, Number.NaN)).toEqual({ width: 1200, height: 900 })
  })
})

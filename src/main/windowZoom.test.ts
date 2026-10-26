import { describe, expect, it } from 'vitest'
import { isWindowZoom, steppedWindowZoom } from './windowZoom'
import { macosWindowOptions } from './macosWindowOptions'

describe('recorded native window zoom', () => {
  it('steps by ten percent, rounds numeric drift, and keeps target bounds', () => {
    expect(steppedWindowZoom(1, 1)).toBe(1.1)
    expect(steppedWindowZoom(1.2000000000001, -1)).toBe(1.1)
    expect(steppedWindowZoom(0.5, -1)).toBe(0.5)
    expect(steppedWindowZoom(3, 1)).toBe(3)
    expect(macosWindowOptions(1.1).trafficLightPosition).toEqual({ x: 16, y: 17 })
    for (const value of ['1', NaN, Infinity, -1, 0.49, 3.01]) expect(isWindowZoom(value)).toBe(false)
    for (const value of [0.5, 1, 3]) expect(isWindowZoom(value)).toBe(true)
  })
})

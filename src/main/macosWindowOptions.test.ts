import { describe, expect, it } from 'vitest'
import { macosWindowOptions } from './macosWindowOptions'

describe('observed macOS primary window parameters', () => {
  it('aligns the native 14px traffic lights within the 44px titlebar', () => {
    expect(macosWindowOptions()).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 15 },
      acceptFirstMouse: true,
      vibrancy: 'menu',
      minWidth: 480,
      minHeight: 600
    })
    expect(macosWindowOptions(1.5).trafficLightPosition).toEqual({ x: 16, y: 26 })
  })
})

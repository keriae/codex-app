import { describe, expect, it } from 'vitest'
import {
  projectSummaryDisplayMode,
  projectSummaryPresentation
} from './projectSummaryLayout'

describe('project summary responsive layout', () => {
  it('uses the shipped 736px center-column thresholds', () => {
    expect(projectSummaryDisplayMode(1_095)).toBe('overlay')
    expect(projectSummaryDisplayMode(1_096)).toBe('shift')
    expect(projectSummaryDisplayMode(1_535)).toBe('shift')
    expect(projectSummaryDisplayMode(1_536)).toBe('gutter')
  })

  it('adjusts both thresholds for a non-default panel width', () => {
    expect(projectSummaryDisplayMode(1_115, 320)).toBe('overlay')
    expect(projectSummaryDisplayMode(1_116, 320)).toBe('shift')
    expect(projectSummaryDisplayMode(1_575, 320)).toBe('shift')
    expect(projectSummaryDisplayMode(1_576, 320)).toBe('gutter')
  })

  it('never exposes the popover and inline panel together', () => {
    expect(projectSummaryPresentation({
      displayMode: 'overlay',
      pinned: true,
      popoverOpen: true
    })).toEqual({
      displayMode: 'overlay',
      shouldShowInline: false,
      visibleSurface: 'popover'
    })
    expect(projectSummaryPresentation({
      displayMode: 'shift',
      pinned: true,
      popoverOpen: true
    })).toEqual({
      displayMode: 'shift',
      shouldShowInline: true,
      visibleSurface: 'inline'
    })
    expect(projectSummaryPresentation({
      displayMode: 'gutter',
      pinned: false,
      popoverOpen: true
    })).toEqual({
      displayMode: 'gutter',
      shouldShowInline: false,
      visibleSurface: null
    })
  })
})

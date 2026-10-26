import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  initialSidebarWidthState,
  parseSidebarWidth,
  restoreSidebarWidth,
  sidebarWidthStyle
} from './sidebarResize'

describe('clampSidebarWidth', () => {
  it('keeps widths inside the supported range unchanged', () => {
    expect(clampSidebarWidth(288)).toBe(288)
    expect(clampSidebarWidth(512.5)).toBe(512.5)
  })

  it('clamps widths to the supported range', () => {
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 1)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 1)).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('falls back to the recording width for non-finite values', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe('parseSidebarWidth', () => {
  it('uses the recording width when storage is empty or invalid', () => {
    expect(parseSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(parseSidebarWidth('')).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(parseSidebarWidth('not-a-width')).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('restores and clamps persisted widths', () => {
    expect(parseSidebarWidth('514.5')).toBe(514.5)
    expect(parseSidebarWidth('120')).toBe(MIN_SIDEBAR_WIDTH)
    expect(parseSidebarWidth('900')).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('clamps a caller-provided fallback', () => {
    expect(parseSidebarWidth(null, 900)).toBe(MAX_SIDEBAR_WIDTH)
  })
})

describe('restoreSidebarWidth', () => {
  it('migrates the previous reconstruction default to the measured native default', () => {
    expect(restoreSidebarWidth('468')).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(restoreSidebarWidth('467.9')).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('preserves an explicitly resized sidebar', () => {
    expect(restoreSidebarWidth('514.5')).toBe(514.5)
    expect(restoreSidebarWidth('320')).toBe(320)
    expect(restoreSidebarWidth('467')).toBe(467)
  })

  it('preserves 468px after the one-time default migration has completed', () => {
    expect(restoreSidebarWidth('468', true)).toBe(468)
  })
})

describe('initialSidebarWidthState', () => {
  it('plans the old erroneous default migration without writing storage during initialization', () => {
    expect(initialSidebarWidthState('468', null)).toEqual({
      width: DEFAULT_SIDEBAR_WIDTH,
      shouldPersistMigration: true
    })
  })

  it('preserves widths once the one-time migration marker exists', () => {
    expect(initialSidebarWidthState('468', 'true')).toEqual({
      width: 468,
      shouldPersistMigration: false
    })
    expect(initialSidebarWidthState('320', null)).toEqual({
      width: 320,
      shouldPersistMigration: true
    })
  })
})

describe('sidebarWidthStyle', () => {
  it('updates both the preferred width and the layout variable', () => {
    expect(sidebarWidthStyle(512)).toEqual({
      '--codex-sidebar-preferred-width': '512px',
      '--sidebar-width': '512px'
    })
  })

  it('clamps the inline layout value', () => {
    expect(sidebarWidthStyle(999)).toEqual({
      '--codex-sidebar-preferred-width': `${MAX_SIDEBAR_WIDTH}px`,
      '--sidebar-width': `${MAX_SIDEBAR_WIDTH}px`
    })
  })
})

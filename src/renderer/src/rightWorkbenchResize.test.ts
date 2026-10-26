import { describe, expect, it } from 'vitest'
import {
  RIGHT_WORKBENCH_DEFAULT_WIDTH,
  RIGHT_WORKBENCH_MIN_WIDTH,
  RIGHT_WORKBENCH_WIDTH_STORAGE_KEY,
  clampRightWorkbenchWidth,
  parseRightWorkbenchStoredValue,
  resolveRightWorkbenchStoredWidth,
  rightWorkbenchDefaultWidth,
  rightWorkbenchDragWidth,
  rightWorkbenchKeyboardWidth,
  rightWorkbenchMaximumWidth,
  rightWorkbenchRatioToWidth,
  rightWorkbenchWidthBounds,
  rightWorkbenchWidthStyle,
  rightWorkbenchWidthToRatio
} from './rightWorkbenchResize'

describe('right workbench responsive width', () => {
  it('uses the exact persisted-atom storage key from the shipped app', () => {
    expect(RIGHT_WORKBENCH_WIDTH_STORAGE_KEY).toBe(
      'codex:persisted-atom:app-shell:right-panel-width:v3'
    )
  })

  it('derives the recording default from shell height and workspace width', () => {
    expect(rightWorkbenchDefaultWidth({
      workspaceWidth: 1_200,
      shellHeight: 800
    })).toBe(640)
    expect(rightWorkbenchDefaultWidth({
      workspaceWidth: 1_000,
      shellHeight: 300
    })).toBe(640)
    expect(rightWorkbenchDefaultWidth({
      workspaceWidth: 800,
      shellHeight: 800
    })).toBe(448)
    expect(rightWorkbenchDefaultWidth({
      workspaceWidth: 600,
      shellHeight: 800
    })).toBe(RIGHT_WORKBENCH_MIN_WIDTH)
  })

  it('only treats 600 as the responsive sentinel', () => {
    expect(rightWorkbenchDefaultWidth({
      defaultWidth: 599,
      workspaceWidth: 1_200,
      shellHeight: 800
    })).toBe(599)
    expect(rightWorkbenchDefaultWidth({
      defaultWidth: RIGHT_WORKBENCH_DEFAULT_WIDTH,
      workspaceWidth: 1_200,
      shellHeight: 800
    })).toBe(640)
  })

  it('reserves the correct amount for regular, unified, and full layouts', () => {
    expect(rightWorkbenchMaximumWidth(1_200, 'regular')).toBe(848)
    expect(rightWorkbenchMaximumWidth(1_200, 'unified')).toBe(880)
    expect(rightWorkbenchMaximumWidth(1_200, 'full')).toBe(1_200)
    expect(rightWorkbenchWidthBounds(500, 'regular')).toEqual({
      minimum: 320,
      maximum: 320
    })
  })

  it('clamps widths and round-trips their normalized ratio', () => {
    expect(clampRightWorkbenchWidth(100, 1_200)).toBe(320)
    expect(clampRightWorkbenchWidth(1_000, 1_200)).toBe(848)
    expect(rightWorkbenchWidthToRatio(584, 1_200)).toBe(0.5)
    expect(rightWorkbenchRatioToWidth(0.5, 1_200)).toBe(584)
    expect(rightWorkbenchRatioToWidth(2, 1_200)).toBe(848)
  })
})

describe('right workbench persisted width migration', () => {
  it('parses only finite JSON numbers', () => {
    expect(parseRightWorkbenchStoredValue(null)).toBeNull()
    expect(parseRightWorkbenchStoredValue('')).toBeNull()
    expect(parseRightWorkbenchStoredValue('0.5')).toBe(0.5)
    expect(parseRightWorkbenchStoredValue('640')).toBe(640)
    expect(parseRightWorkbenchStoredValue('"640"')).toBeNull()
    expect(parseRightWorkbenchStoredValue('not-json')).toBeNull()
  })

  it('restores ratio values without migration', () => {
    expect(resolveRightWorkbenchStoredWidth({
      storedValue: '0.25',
      workspaceWidth: 1_200,
      shellHeight: 800
    })).toEqual({
      ratio: 0.25,
      source: 'ratio',
      migrated: false
    })
  })

  it('converts old pixel values to the current dynamic ratio', () => {
    expect(resolveRightWorkbenchStoredWidth({
      storedValue: '584',
      workspaceWidth: 1_200,
      shellHeight: 800
    })).toEqual({
      ratio: 0.5,
      source: 'legacy-pixels',
      migrated: true
    })
  })

  it('normalizes the responsive default when no stored value exists', () => {
    const resolved = resolveRightWorkbenchStoredWidth({
      storedValue: null,
      workspaceWidth: 1_200,
      shellHeight: 800
    })
    expect(resolved.source).toBe('default')
    expect(resolved.migrated).toBe(false)
    expect(rightWorkbenchRatioToWidth(resolved.ratio, 1_200)).toBe(640)
  })
})

describe('right workbench resize interaction math', () => {
  it('increases a right pane when its left edge is dragged left', () => {
    expect(rightWorkbenchDragWidth(500, 700, 650)).toBe(550)
    expect(rightWorkbenchDragWidth(500, 700, 750)).toBe(450)
    expect(rightWorkbenchDragWidth(500, 700, 650, 2)).toBe(525)
  })

  it('keeps raw pointer widths outside the normal clamp range', () => {
    expect(rightWorkbenchDragWidth(320, 500, 700)).toBe(120)
    expect(rightWorkbenchDragWidth(800, 500, 300)).toBe(1_000)
  })

  it('supports 10px arrow steps and Home/End', () => {
    expect(rightWorkbenchKeyboardWidth('ArrowLeft', 500, 320, 848)).toBe(510)
    expect(rightWorkbenchKeyboardWidth('ArrowRight', 500, 320, 848)).toBe(490)
    expect(rightWorkbenchKeyboardWidth('Home', 500, 320, 848)).toBe(320)
    expect(rightWorkbenchKeyboardWidth('End', 500, 320, 848)).toBe(848)
    expect(rightWorkbenchKeyboardWidth('ArrowRight', 325, 320, 848)).toBe(320)
    expect(rightWorkbenchKeyboardWidth('Enter', 500, 320, 848)).toBeNull()
  })

  it('publishes both layout variables from one width', () => {
    expect(rightWorkbenchWidthStyle(584)).toEqual({
      '--right-workbench-width': '584px',
      '--right-workbench-titlebar-width': '584px'
    })
  })
})

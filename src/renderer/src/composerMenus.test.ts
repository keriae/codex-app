import { describe, expect, it } from 'vitest'
import {
  approvalModePresentation,
  composerEffortLabel,
  composerPermissionChoices,
  computeComposerPopoverPosition,
  nextComposerMenuIndex,
  nextReasoningEffortIndex,
  permissionProfilePresentation,
  reasoningEffortPercent,
  shortComposerModelLabel
} from './ComposerMenus'

describe('computeComposerPopoverPosition', () => {
  const popover = { width: 320, height: 240 }
  const viewport = { width: 1200, height: 800 }

  it('opens above a composer trigger and honors end alignment', () => {
    expect(
      computeComposerPopoverPosition(
        { top: 700, right: 1100, bottom: 728, left: 1040, width: 60, height: 28 },
        popover,
        viewport,
        'end'
      )
    ).toEqual({ left: 780, top: 452, maxHeight: 684, placement: 'top' })
  })

  it('flips below when there is not enough room above', () => {
    const result = computeComposerPopoverPosition(
      { top: 20, right: 200, bottom: 48, left: 140, width: 60, height: 28 },
      popover,
      viewport
    )
    expect(result.placement).toBe('bottom')
    expect(result.top).toBe(56)
  })

  it('keeps the popover inside the viewport gutter', () => {
    const result = computeComposerPopoverPosition(
      { top: 700, right: 1198, bottom: 728, left: 1180, width: 18, height: 28 },
      popover,
      viewport
    )
    expect(result.left).toBe(872)
  })

  it.each([0.5, 1.5, 3])('preserves logical placement when the window is zoomed to %sx', (zoom) => {
    const logicalAnchor = { top: 700, right: 1100, bottom: 728, left: 1040, width: 60, height: 28 }
    const physicalAnchor = Object.fromEntries(Object.entries(logicalAnchor).map(([key, value]) => [key, value * zoom])) as typeof logicalAnchor
    const result = computeComposerPopoverPosition(
      physicalAnchor,
      { width: popover.width * zoom, height: popover.height * zoom },
      { width: viewport.width * zoom, height: viewport.height * zoom },
      'end', 8, 8, zoom
    )
    expect(result).toEqual(computeComposerPopoverPosition(logicalAnchor, popover, viewport, 'end'))
  })

  it.each([1.5, 3])('bounds a menu to a fixed physical viewport at %sx', (zoom) => {
    const physicalViewport = { width: 600, height: 150 }
    const logicalWidth = physicalViewport.width / zoom - 16
    const result = computeComposerPopoverPosition(
      { top: 2, right: 598, bottom: 30, left: 570, width: 28, height: 28 },
      { width: logicalWidth * zoom, height: 400 * zoom },
      physicalViewport, 'end', 8, 8, zoom
    )
    expect(result.placement).toBe('bottom')
    expect(result.left).toBeCloseTo(8)
    expect(result.maxHeight).toBeLessThanOrEqual(physicalViewport.height / zoom - 16)
    expect(result.top).toBeGreaterThanOrEqual(8)
    expect((result.left + logicalWidth) * zoom).toBeLessThanOrEqual(physicalViewport.width - 8 * zoom)
    expect((result.top + result.maxHeight) * zoom).toBeLessThanOrEqual(physicalViewport.height - 8 * zoom)
  })
})

describe('nextComposerMenuIndex', () => {
  it('wraps in both directions', () => {
    expect(nextComposerMenuIndex(2, 3, 1)).toBe(0)
    expect(nextComposerMenuIndex(0, 3, -1)).toBe(2)
  })

  it('handles an unselected or empty menu', () => {
    expect(nextComposerMenuIndex(-1, 3, 1)).toBe(0)
    expect(nextComposerMenuIndex(-1, 3, -1)).toBe(2)
    expect(nextComposerMenuIndex(0, 0, 1)).toBe(-1)
  })
})

describe('permission profile presentation', () => {
  it('uses neutral upstream permission semantics for read-only and workspace profiles', () => {
    expect(permissionProfilePresentation(':read-only')).toMatchObject({
      kind: 'read-only',
      label: '只读',
      tone: 'neutral',
      icon: 'hand'
    })
    expect(permissionProfilePresentation(':workspace')).toEqual({
      kind: 'workspace',
      label: '请求批准',
      description: '编辑外部文件和使用互联网时始终询问',
      tone: 'neutral',
      icon: 'hand'
    })
    expect(permissionProfilePresentation('workspace-write').tone).toBe('neutral')
  })

  it('uses the upstream neutral trigger treatment for unrestricted access', () => {
    expect(permissionProfilePresentation(':danger-full-access')).toEqual({
      kind: 'full-access',
      label: '完全访问',
      description: '可不受限制地访问互联网和你电脑上的任何文件',
      tone: 'neutral',
      icon: 'shield-alert'
    })
  })

  it('presents auto-review as the neutral shield-code mode, including its legacy value', () => {
    const expected = {
      kind: 'workspace',
      label: '帮我批准',
      description: '仅对检测到的风险操作请求批准',
      tone: 'neutral',
      icon: 'shield-code'
    }
    expect(approvalModePresentation(':workspace', 'auto_review')).toEqual(expected)
    expect(approvalModePresentation(':workspace', 'guardian_subagent')).toEqual(expected)
    expect(approvalModePresentation(':workspace', 'user').label).toBe('请求批准')
  })

  it('builds the exact three upstream approval choices and omits unrelated profiles', () => {
    const choices = composerPermissionChoices([
      { id: ':read-only', allowed: true, description: null },
      { id: ':workspace', allowed: true, description: null },
      { id: ':danger-full-access', allowed: true, description: null },
      { id: 'audit', allowed: true, description: 'Inspect only.' }
    ])
    expect(choices.map(({ id, permission, approvalsReviewer, presentation }) => ({
      id,
      permission,
      approvalsReviewer,
      label: presentation.label,
      description: presentation.description
    }))).toEqual([
      {
        id: 'request-approval',
        permission: ':workspace',
        approvalsReviewer: 'user',
        label: '请求批准',
        description: '编辑外部文件和使用互联网时始终询问'
      },
      {
        id: 'auto-review',
        permission: ':workspace',
        approvalsReviewer: 'auto_review',
        label: '帮我批准',
        description: '仅对检测到的风险操作请求批准'
      },
      {
        id: 'full-access',
        permission: ':danger-full-access',
        approvalsReviewer: 'user',
        label: '完全访问',
        description: '可不受限制地访问互联网和你电脑上的任何文件'
      }
    ])
  })

  it('preserves server descriptions and gives custom profiles a checked shield', () => {
    expect(permissionProfilePresentation('audit', 'Inspect only.')).toEqual({
      kind: 'custom',
      label: 'audit',
      description: 'Inspect only.',
      tone: 'neutral',
      icon: 'shield-check'
    })
  })
})

describe('reasoning effort control', () => {
  it('moves one supported step at a time without wrapping into unsupported values', () => {
    expect(nextReasoningEffortIndex(2, 5, 1)).toBe(3)
    expect(nextReasoningEffortIndex(4, 5, 1)).toBe(4)
    expect(nextReasoningEffortIndex(0, 5, -1)).toBe(0)
    expect(nextReasoningEffortIndex(0, 0, 1)).toBe(-1)
  })

  it('positions discrete effort values at evenly spaced ticks', () => {
    expect(reasoningEffortPercent(0, 5)).toBe(0)
    expect(reasoningEffortPercent(2, 5)).toBe(50)
    expect(reasoningEffortPercent(4, 5)).toBe(100)
    expect(reasoningEffortPercent(9, 5)).toBe(100)
    expect(reasoningEffortPercent(0, 1)).toBe(0)
  })

  it('uses the compact labels shown by the upstream combined trigger', () => {
    expect(shortComposerModelLabel('GPT-5.6-sol')).toBe('5.6 Sol')
    expect(composerEffortLabel('high')).toBe('高')
    expect(composerEffortLabel('ultra')).toBe('Ultra')
  })
})

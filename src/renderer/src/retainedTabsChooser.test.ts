import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RetainedTabsChooser, RetainedTabsChooserRows, type RetainedTabsChooserTab } from './RetainedTabsChooser'
import { retainedTabDisabled, retainedTabsPointInsideTriangle, retainedTabsPointerTriangle, retainedTabsTriggerKeyAction } from './retainedTabsChooserModel'

const destination = { left: 100, right: 360, top: 50, bottom: 150, width: 260, height: 100 }
const tabs: RetainedTabsChooserTab[] = [
  { id: 'workspace:file:one', title: 'one.ts', icon: createElement('svg', { 'data-test-icon': 'file' }) },
  { id: 'browser:one', title: 'Page', titleContent: 'Custom page', icon: createElement('svg'), requiresWorkspaceReady: false }
]

describe('retained-tab pointer grace from the installed source', () => {
  it('extends the approaching edge eight pixels and includes its corners and boundary', () => {
    const triangle = retainedTabsPointerTriangle(destination, 'bottom', { x: 240, y: 30 })!
    expect(triangle.endA).toEqual({ x: 92, y: 50 })
    expect(triangle.endB).toEqual({ x: 368, y: 50 })
    for (const point of [triangle.start, triangle.endA, triangle.endB, { x: 240, y: 45 }, { x: 240, y: 50 }]) {
      expect(retainedTabsPointInsideTriangle(point, triangle)).toBe(true)
    }
    for (const point of [{ x: 91, y: 50 }, { x: 369, y: 50 }, { x: 240, y: 51 }, { x: 240, y: 29 }]) {
      expect(retainedTabsPointInsideTriangle(point, triangle)).toBe(false)
    }
  })

  it('uses the bottom edge when moving back upwards and excludes empty elements', () => {
    const triangle = retainedTabsPointerTriangle(destination, 'top', { x: 240, y: 180 })!
    expect(triangle.endA).toEqual({ x: 92, y: 150 })
    expect(retainedTabsPointInsideTriangle({ x: 240, y: 160 }, triangle)).toBe(true)
    expect(retainedTabsPointInsideTriangle({ x: 240, y: 149 }, triangle)).toBe(false)
    expect(retainedTabsPointerTriangle({ ...destination, width: 0 }, 'top', { x: 240, y: 180 })).toBeNull()
    expect(retainedTabsPointerTriangle(destination, 'top', { x: 240, y: 180 }, { ...destination, height: 0 })).toBeNull()
  })
})

describe('retained-tab chooser contract', () => {
  it('opens only on closed-trigger Down, leaving row navigation to native Tab order', () => {
    expect(retainedTabsTriggerKeyAction(false, 'ArrowDown')).toBe('open')
    for (const key of ['ArrowUp', 'Enter', ' ', 'Tab', 'Home', 'End']) expect(retainedTabsTriggerKeyAction(false, key)).toBeNull()
    for (const key of ['Enter', ' ', 'ArrowDown']) expect(retainedTabsTriggerKeyAction(true, key)).toBe('first')
    expect(retainedTabsTriggerKeyAction(true, 'ArrowUp')).toBe('last')
    for (const key of ['Tab', 'Home', 'End']) expect(retainedTabsTriggerKeyAction(true, key)).toBeNull()
  })

  it('requires readiness by default while retaining explicit independent tabs', () => {
    expect(retainedTabDisabled(false)).toBe(true)
    expect(retainedTabDisabled(false, true)).toBe(true)
    expect(retainedTabDisabled(false, false)).toBe(false)
    expect(retainedTabDisabled(true)).toBe(false)
    const html = renderToStaticMarkup(createElement(RetainedTabsChooserRows, { tabs, workspaceReady: false, onSelect: () => {} }))
    expect(html).toContain('aria-label="one.ts" disabled=""')
    expect(html).toContain('aria-label="以全屏视图打开 one.ts" disabled=""')
    expect(html).toContain('aria-label="Page" data-retained-tab-id="browser:one"')
    expect(html).toContain('Custom page')
    expect(html).toContain('data-workbench-glyph="chevron-up-right-chevron-down-left-sm-light-16"')
  })

  it('keeps split and full actions independent for the same retained identity', () => {
    const onSelect = vi.fn()
    const rows = RetainedTabsChooserRows({ tabs, workspaceReady: true, onSelect }) as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>[]
    rows[0].props.children[0].props.onClick()
    rows[0].props.children[1].props.onClick()
    expect(onSelect.mock.calls).toEqual([['workspace:file:one', 'split'], ['workspace:file:one', 'full']])
  })

  it('uses a separate count description and keeps the initial trigger free of a native title', () => {
    const html = renderToStaticMarkup(createElement(RetainedTabsChooser, { tabs, workspaceReady: true, onReveal: () => {}, onSelect: () => {} }))
    expect(html).toContain('aria-label="显示标签页" aria-pressed="false" aria-description="2 个打开的标签页"')
    expect(html).toContain('aria-haspopup="dialog" aria-expanded="false"')
    expect(html).not.toContain('title="显示标签页"')
    expect(html).not.toContain('role="dialog"')
  })

  it('retains the original 9+ count presentation and nullish title-content semantics', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ ...tabs[0], id: `workspace:file:${index}` as const }))
    const html = renderToStaticMarkup(createElement(RetainedTabsChooser, { tabs: many, workspaceReady: true, onReveal: () => {}, onSelect: () => {} }))
    expect(html).toContain('aria-description="10 个打开的标签页"')
    expect(html).toContain('data-multiple-digits="true">9+</span>')
    const rows = renderToStaticMarkup(createElement(RetainedTabsChooserRows, { tabs: [{ ...tabs[0], titleContent: '' }], workspaceReady: true, onSelect: () => {} }))
    expect(rows).toContain('class="retained-tabs-title" dir="auto"></span>')
  })
})

import { readFileSync } from 'node:fs'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityTooltip, CopyTooltip, copyTooltipPosition } from './ActivityTooltip'

// Execute actual handlers and layout calculations with hook cells and measured
// rectangles. This harness does not mount a native renderer or use any app UI.
const hooks = vi.hoisted(() => ({ cells: [] as unknown[], index: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void> }))
vi.mock('react', async (importOriginal) => {
  const effect = (callback: () => (() => void) | void, deps: unknown[] = []): void => {
    const index = hooks.index++
    const previous = hooks.cells[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && previous.deps.length === deps.length && previous.deps.every((value, i) => Object.is(value, deps[i]))) return
    const cell = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.cells[index] = cell
    hooks.effects.push(() => { previous?.cleanup?.(); cell.cleanup = callback() || undefined })
    if (!previous) hooks.cleanups.push(() => (hooks.cells[index] as { cleanup?: () => void }).cleanup?.())
  }
  return {
    ...await importOriginal<typeof import('react')>(),
    useId: () => 'copy-tooltip-test',
    useState: (initial: unknown) => {
      const index = hooks.index++
      if (!(index in hooks.cells)) hooks.cells[index] = initial
      return [hooks.cells[index], (next: unknown) => { hooks.cells[index] = typeof next === 'function' ? next(hooks.cells[index]) : next }]
    },
    useRef: (initial: unknown) => {
      const index = hooks.index++
      if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }
      return hooks.cells[index]
    },
    useEffect: effect,
    useLayoutEffect: effect
  }
})
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))

type ElementProps = {
  ref?: ((element: unknown) => void) | { current: unknown }
  className?: string
  title?: string
  'aria-describedby'?: string
  'data-state'?: string
  'data-side'?: string
  style?: { left: number; top: number; visibility?: string }
  onPointerEnter?: (event: unknown) => void
  onPointerMove?: (event: unknown) => void
  onPointerLeave?: (event: unknown) => void
  onPointerDown?: (event: unknown) => void
  onFocus?: (event: unknown) => void
  onBlur?: (event: unknown) => void
  onClick?: (event: unknown) => void
  onContextMenu?: (event: unknown) => void
  children?: unknown
}

const listeners = (): { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; dispatchEvent: (event: Event) => void; fire: (name: string, event: unknown) => void } => {
  const map = new Map<string, Set<(event: unknown) => void>>()
  const fire = (name: string, event: unknown): void => map.get(name)?.forEach((callback) => callback(event))
  return {
    addEventListener: vi.fn((name: string, callback: (event: unknown) => void) => { const set = map.get(name) || new Set(); set.add(callback); map.set(name, set) }),
    removeEventListener: vi.fn((name: string, callback: (event: unknown) => void) => { map.get(name)?.delete(callback) }),
    dispatchEvent: (event) => fire(event.type, event),
    fire
  }
}
let doc: ReturnType<typeof listeners>
let win: ReturnType<typeof listeners>
let preferredSide = ''
let focusVisible = true
let bounds = { left: 100, right: 126, top: 100, bottom: 126, width: 26, height: 26 }
let popupSize = { left: 0, right: 80, top: 0, bottom: 30, width: 80, height: 30 }
const trigger = {
  isConnected: true,
  getBoundingClientRect: () => bounds,
  contains: (element: unknown) => element === trigger,
  matches: () => focusVisible
}
const popupElement = { getBoundingClientRect: () => popupSize, contains: (element: unknown) => element === popupElement }
const point = (pointerType = 'mouse'): unknown => ({ pointerType, defaultPrevented: false, target: trigger })
const event = (): unknown => ({ defaultPrevented: false, target: trigger })
function bind(ref: ElementProps['ref'], element: unknown): void {
  if (typeof ref === 'function') ref(element)
  else if (ref) ref.current = element
}
function render(variant: 'copy' | 'userCopy' = 'copy', content = '复制', originalClick = vi.fn(), openDelay?: number): { button: ReactElement<ElementProps>; tooltip: ReactElement<ElementProps> | null } {
  hooks.index = 0
  const fragment = CopyTooltip({ variant, content, openDelay, children: createElement('button', { className: 'original-positioned-button', 'aria-describedby': 'existing-description', onClick: originalClick }, 'copy') }) as ReactElement<{ children: [ReactElement<ElementProps>, ReactElement<ElementProps> | null] }>
  const [button, tooltip] = fragment.props.children
  bind(button.props.ref, trigger)
  if (tooltip) bind(tooltip.props.ref, popupElement)
  hooks.effects.splice(0).forEach((commit) => commit())
  return { button, tooltip: tooltip || null }
}

beforeEach(() => {
  hooks.cells = []; hooks.index = 0; hooks.effects = []; hooks.cleanups = []
  vi.useFakeTimers(); vi.setSystemTime(10_000)
  doc = listeners(); win = listeners()
  preferredSide = ''; focusVisible = true
  bounds = { left: 100, right: 126, top: 100, bottom: 126, width: 26, height: 26 }
  popupSize = { left: 0, right: 80, top: 0, bottom: 30, width: 80, height: 30 }
  trigger.isConnected = true
  vi.stubGlobal('document', { ...doc, body: {} })
  vi.stubGlobal('window', { ...win, innerWidth: 500, innerHeight: 500, getComputedStyle: () => ({ getPropertyValue: () => preferredSide }) })
})
afterEach(() => {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('installed copy tooltip paths', () => {
  it.each([['copy', 150], ['userCopy', 200]] as const)('uses %s hover delay and closes immediately on leave', (variant, delay) => {
    const start = render(variant)
    start.button.props.onPointerEnter?.(point())
    if (variant === 'copy') expect(vi.getTimerCount()).toBe(0)
    start.button.props.onPointerMove?.(point())
    start.button.props.onPointerMove?.(point())
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(delay - 1)
    expect(render(variant).tooltip).toBeNull()
    vi.advanceTimersByTime(1)
    const opened = render(variant)
    expect(opened.button.props['data-state']).toBe('delayed-open')
    expect(opened.button.props['aria-describedby']).toBe('existing-description copy-tooltip-test')
    expect(opened.button.props.className).toBe('original-positioned-button')
    expect(render(variant).tooltip?.props.style).toEqual({ left: 73, top: 68, visibility: undefined })
    opened.button.props.onPointerLeave?.(point())
    expect(render(variant).tooltip).toBeNull()
    expect(render(variant).button.props['aria-describedby']).toBe('existing-description')
  })

  it.each(['copy', 'userCopy'] as const)('opens %s immediately only for a visible keyboard focus', (variant) => {
    focusVisible = false
    render(variant).button.props.onFocus?.(event())
    expect(render(variant).tooltip).toBeNull()
    focusVisible = true
    render(variant).button.props.onFocus?.(event())
    expect(render(variant).button.props['data-state']).toBe('instant-open')
    expect(vi.getTimerCount()).toBe(0)
    render(variant).button.props.onBlur?.(event())
    expect(render(variant).tooltip).toBeNull()
  })

  it.each(['copy', 'userCopy'] as const)('replaces %s pending hover with immediate keyboard focus', (variant) => {
    render(variant).button.props.onPointerMove?.(point())
    expect(vi.getTimerCount()).toBe(1)
    render(variant).button.props.onFocus?.(event())
    expect(render(variant).button.props['data-state']).toBe('instant-open')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['copy', 'userCopy'] as const)('closes %s on copy and does not reopen on content changes or stationary pointer moves', (variant) => {
    const copy = vi.fn()
    const trigger = render(variant, '复制', copy).button
    trigger.props.onPointerMove?.(point())
    trigger.props.onFocus?.(event())
    render(variant, '复制', copy).button.props.onClick?.(event())
    expect(copy).toHaveBeenCalledTimes(1)
    const copied = render(variant, '已复制', copy)
    copied.button.props.onPointerMove?.(point())
    expect(render(variant, '已复制', copy).tooltip).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    copied.button.props.onPointerLeave?.(point())
    const reenter = render(variant, '已复制', copy)
    reenter.button.props.onPointerEnter?.(point())
    reenter.button.props.onPointerMove?.(point())
    expect(render(variant, '已复制', copy).button.props['data-state']).toBe('instant-open')
    expect(render(variant, '已复制', copy).tooltip?.props.children).toMatchObject({ props: { children: '已复制' } })
  })

  it('does not use touch hover or a mouse click focus to open the default copy tooltip', () => {
    const button = render().button
    button.props.onPointerMove?.(point('touch'))
    expect(vi.getTimerCount()).toBe(0)
    button.props.onPointerDown?.(point())
    render().button.props.onFocus?.(event())
    expect(render().tooltip).toBeNull()
    doc.fire('pointerup', {})
    render().button.props.onFocus?.(event())
    expect(render().tooltip).not.toBeNull()
  })

  it('allows the default path first hover after keyboard copying, while user click retains its separate guard', () => {
    render().button.props.onFocus?.(event())
    render().button.props.onClick?.(event())
    expect(render().tooltip).toBeNull()
    render().button.props.onPointerMove?.(point())
    expect(render().button.props['data-state']).toBe('instant-open')
  })

  it('supports an explicit source tooltip delay without changing the copy defaults', () => {
    render('copy', '文件树', vi.fn(), 250).button.props.onPointerMove?.(point())
    vi.advanceTimersByTime(249)
    expect(render('copy', '文件树', vi.fn(), 250).tooltip).toBeNull()
    vi.advanceTimersByTime(1)
    expect(render('copy', '文件树', vi.fn(), 250).tooltip).not.toBeNull()
  })

  it('inherits only the user path bottom preference and flips/centers inside 8px collision padding', () => {
    preferredSide = 'bottom'
    render('userCopy').button.props.onFocus?.(event())
    render('userCopy')
    expect(render('userCopy').tooltip?.props.style).toEqual({ left: 73, top: 128, visibility: undefined })
    expect(render('userCopy').tooltip?.props['data-side']).toBe('bottom')
    expect(copyTooltipPosition({ ...bounds, left: 0, top: 5, bottom: 31 }, popupSize, { width: 500, height: 500 })).toEqual({ left: 8, top: 33, side: 'bottom' })
    expect(copyTooltipPosition({ ...bounds, left: 485, top: 460, bottom: 486 }, popupSize, { width: 500, height: 500 }, 'bottom')).toEqual({ left: 412, top: 428, side: 'top' })
  })

  it('closes user tooltip on window blur and context menu, and both paths on Escape', () => {
    render('userCopy').button.props.onFocus?.(event())
    render('userCopy')
    win.fire('blur', {})
    expect(render('userCopy').tooltip).toBeNull()
    render('userCopy').button.props.onFocus?.(event())
    render('userCopy').button.props.onContextMenu?.(event())
    expect(render('userCopy').tooltip).toBeNull()
    render('userCopy').button.props.onFocus?.(event())
    render('userCopy')
    const escape = { key: 'Escape', stopPropagation: vi.fn() }
    win.fire('keydown', escape)
    expect(escape.stopPropagation).not.toHaveBeenCalled()
    expect(render('userCopy').tooltip).toBeNull()
  })

  it('tracks user anchor scrolling and does not add pointerdown dismissal to the old path', () => {
    render('userCopy').button.props.onFocus?.(event())
    render('userCopy')
    render('userCopy').button.props.onPointerDown?.(point())
    doc.fire('pointerdown', { target: {} })
    expect(render('userCopy').tooltip).not.toBeNull()
    bounds = { ...bounds, top: 180, bottom: 206 }
    win.fire('scroll', {})
    expect(render('userCopy').tooltip?.props.style).toEqual({ left: 73, top: 148, visibility: undefined })
  })

  it('keeps default tooltip content pointer events inside its layer and dismisses outside or Escape', () => {
    render().button.props.onFocus?.(event())
    render()
    doc.fire('pointerdown', { target: popupElement })
    expect(render().tooltip).not.toBeNull()
    doc.fire('pointerdown', { target: {} })
    expect(render().tooltip).toBeNull()
    render().button.props.onFocus?.(event())
    render()
    const escape = { key: 'Escape', stopPropagation: vi.fn() }
    win.fire('keydown', escape)
    expect(escape.stopPropagation).toHaveBeenCalledTimes(1)
    expect(render().tooltip).toBeNull()
  })

  it('cancels delayed hover work when the copy control unmounts', () => {
    render('userCopy').button.props.onPointerEnter?.(point())
    expect(vi.getTimerCount()).toBe(1)
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the existing activity wrapper and limits source geometry to copy variants', () => {
    const html = renderToStaticMarkup(createElement(ActivityTooltip, { content: 'existing activity', children: createElement('button', null, 'activity') }))
    expect(html).toContain('class="activity-tooltip-anchor"')
    const styles = readFileSync(new URL('./activityTooltip.css', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.activity-tooltip\.is-copy\s*\{[^}]*max-width: min\(320px, calc\(100vw - 16px\)\);[^}]*padding: 5px 12px;[^}]*border-radius: 16px;[^}]*background: #181818;[^}]*box-shadow: 0 8px 18px #0f172a33;[^}]*font-size: 13px;[^}]*font-weight: 430;[^}]*letter-spacing: -0\.15px;[^}]*line-height: 18px;/s)
    expect(styles).toContain(".activity-tooltip.is-copy[data-tooltip-variant='userCopy'] > span { text-wrap: balance; }")
    expect(styles).toContain(".activity-tooltip.is-copy[data-tooltip-variant='userCopy'] { z-index: 50; pointer-events: none; }")
    expect(styles).toMatch(/\.activity-tooltip\.is-copy\s*\{[^}]*z-index: auto;[^}]*pointer-events: auto;/s)
    expect(styles).toContain('border-radius: 20px; corner-shape: superellipse(1.5)')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginSidebarSelectionReveal, sidebarSelectionRevealScrollTop } from './sidebarSelectionReveal'

afterEach(() => vi.unstubAllGlobals())

describe('sidebar selection geometry', () => {
  const viewport = { top: 100, height: 330, offsetHeight: 300, clientHeight: 298,
    clientTop: 1, scrollTop: 10, scrollPaddingBottom: 20 }

  it('centers an obscured row using logical dimensions, border and scroll padding at 110%', () => {
    expect(sidebarSelectionRevealScrollTop(viewport, { top: 376.1, height: 35.2 })).toBeCloseTo(137)
    expect(sidebarSelectionRevealScrollTop(viewport, { top: 150, height: 35.2 })).toBeNull()
  })

  it('waits while the viewport or selected row is hidden', () => {
    expect(sidebarSelectionRevealScrollTop({ ...viewport, height: 0, offsetHeight: 0 }, { top: 400, height: 32 })).toBeNull()
    expect(sidebarSelectionRevealScrollTop(viewport, { top: 400, height: 0 })).toBeNull()
  })
})

class FakeElement extends EventTarget {
  parentElement: FakeElement | null = null
  dataset: Record<string, string> = {}
  top = 0
  height = 32
  getBoundingClientRect(): { top: number; height: number } { return { top: this.top, height: this.height } }
}

class FakeScroll extends FakeElement {
  rows: FakeElement[] = []
  height = 200
  offsetHeight = 200
  clientHeight = 200
  clientTop = 0
  scrollTop = 0
  querySelectorAll(): FakeElement[] { return this.rows }
  scrollTo({ top }: { top: number }): void {
    const delta = top - this.scrollTop
    this.scrollTop = Math.max(0, top)
    for (const row of this.rows) row.top -= delta
  }
}

function fixture(initialRow = true): {
  scroll: FakeScroll; row: FakeElement; resize(): void; mutation(): void; flush(): void; start(): () => void
} {
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  const observers: { kind: 'resize' | 'mutation'; callback: () => void; active: boolean }[] = []
  const observer = (kind: 'resize' | 'mutation'): unknown => class {
    entry: (typeof observers)[number]
    constructor(callback: () => void) { this.entry = { kind, callback, active: false }; observers.push(this.entry) }
    observe(): void { this.entry.active = true }
    disconnect(): void { this.entry.active = false }
  }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', observer('resize'))
  vi.stubGlobal('MutationObserver', observer('mutation'))
  vi.stubGlobal('window', { getComputedStyle: () => ({ scrollPaddingBottom: '0px' }) })
  const scroll = new FakeScroll()
  const section = new FakeElement()
  section.parentElement = scroll
  const row = new FakeElement()
  row.parentElement = section
  row.dataset.appActionSidebarThreadId = 'selected'
  row.top = 40
  if (initialRow) scroll.rows = [row]
  const trigger = (kind: 'resize' | 'mutation'): void => {
    for (const entry of observers) if (entry.kind === kind && entry.active) entry.callback()
  }
  return { scroll, row, resize: () => trigger('resize'), mutation: () => trigger('mutation'),
    flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)) },
    start: () => beginSidebarSelectionReveal(scroll as unknown as HTMLDivElement, 'selected') }
}

describe('sidebar selection during asynchronous layout', () => {
  it('keeps observing after the row first becomes visible and after its own scroll event', () => {
    const f = fixture()
    const stop = f.start()
    f.flush()
    expect(f.scroll.scrollTop).toBe(0)
    f.row.top = 260
    f.resize(); f.flush()
    expect(f.scroll.scrollTop).toBe(176)
    f.scroll.dispatchEvent(new Event('scroll'))
    f.row.top += 200
    f.resize(); f.flush()
    expect(f.scroll.scrollTop).toBe(376)
    stop()
  })

  it('reveals a row arriving later but cancels when user scrolling takes over', () => {
    const f = fixture(false)
    const stop = f.start()
    f.flush()
    f.row.top = 300
    f.scroll.rows = [f.row]
    f.mutation(); f.flush()
    expect(f.scroll.scrollTop).toBe(216)
    f.scroll.dispatchEvent(new Event('scroll'))
    f.scroll.scrollTop = 20
    f.scroll.dispatchEvent(new Event('scroll'))
    f.row.top = 500
    f.resize(); f.flush()
    expect(f.scroll.scrollTop).toBe(20)
    stop()
  })

  it.each(['wheel', 'pointerdown', 'keydown'])('cancels a pending hydration reveal after %s', (event) => {
    const f = fixture(false)
    const stop = f.start()
    f.scroll.dispatchEvent(new Event(event))
    f.row.top = 500
    f.scroll.rows = [f.row]
    f.mutation(); f.resize(); f.flush()
    expect(f.scroll.scrollTop).toBe(0)
    stop()
  })
})

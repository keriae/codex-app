export interface SidebarRevealMetrics {
  top: number
  height: number
  offsetHeight: number
  clientHeight: number
  clientTop: number
  scrollTop: number
  scrollPaddingBottom: number
}

/** The DOM rect is zoomed; scrolling and client sizes use logical pixels. */
export function sidebarSelectionRevealScrollTop(
  viewport: SidebarRevealMetrics,
  row: { top: number; height: number }
): number | null {
  const scale = viewport.height / viewport.offsetHeight
  const visibleHeight = viewport.clientHeight - Math.max(0, viewport.scrollPaddingBottom)
  if (!Number.isFinite(scale) || scale <= 0 || visibleHeight <= 0 || row.height <= 0) return null
  const top = (row.top - viewport.top) / scale - viewport.clientTop
  const height = row.height / scale
  if (!Number.isFinite(top) || !Number.isFinite(height)) return null
  if (top >= 0 && top + height <= visibleHeight) return null
  return viewport.scrollTop + top + height / 2 - visibleHeight / 2
}

/** Follow the selected row's layout until the user takes control of scrolling. */
export function beginSidebarSelectionReveal(scroll: HTMLDivElement, selectedThreadId: string): () => void {
  let cancelled = false
  let frame = 0
  let observedRow: HTMLElement | null = null
  let automaticScrollTop: number | null = null
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
  const mutations = new MutationObserver(() => schedule())

  const stop = (): void => {
    if (cancelled) return
    cancelled = true
    cancelAnimationFrame(frame)
    mutations.disconnect()
    resize?.disconnect()
    scroll.removeEventListener('wheel', stop)
    scroll.removeEventListener('pointerdown', stop)
    scroll.removeEventListener('keydown', stop)
    scroll.removeEventListener('scroll', onScroll)
  }
  const onScroll = (): void => {
    // A scroll event from our own reveal must not cancel later layout updates.
    if (automaticScrollTop !== null && scroll.scrollTop === automaticScrollTop) automaticScrollTop = null
    else stop()
  }
  const reveal = (): void => {
    if (cancelled) return
    const row = Array.from(scroll.querySelectorAll<HTMLElement>('[data-app-action-sidebar-thread-id]'))
      .find((element) => element.dataset.appActionSidebarThreadId === selectedThreadId)
    if (!row) return
    if (observedRow !== row) {
      observedRow = row
      resize?.disconnect()
      // A project or section above the row can change height after hydration.
      // Retain ancestor observation after the row first becomes visible.
      for (let parent = row.parentElement; parent; parent = parent.parentElement) {
        resize?.observe(parent)
        if (parent === scroll) break
      }
      mutations.disconnect()
    }
    const bounds = scroll.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const padding = Number.parseFloat(window.getComputedStyle(scroll).scrollPaddingBottom) || 0
    const target = sidebarSelectionRevealScrollTop({
      top: bounds.top,
      height: bounds.height,
      offsetHeight: scroll.offsetHeight,
      clientHeight: scroll.clientHeight,
      clientTop: scroll.clientTop,
      scrollTop: scroll.scrollTop,
      scrollPaddingBottom: padding
    }, rect)
    if (target !== null) {
      scroll.scrollTo({ top: target, behavior: 'instant' })
      automaticScrollTop = scroll.scrollTop
    }
  }
  const schedule = (): void => {
    if (cancelled) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(reveal)
  }

  mutations.observe(scroll, { childList: true, subtree: true })
  scroll.addEventListener('wheel', stop, { passive: true })
  scroll.addEventListener('pointerdown', stop)
  scroll.addEventListener('keydown', stop)
  scroll.addEventListener('scroll', onScroll)
  schedule()
  return stop
}

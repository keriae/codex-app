import { useEffect, type RefObject } from 'react'
import { beginSidebarSelectionReveal } from './sidebarSelectionReveal'

/** Reveal selection after hydration and preserve it through pending layout changes. */
export function useSidebarSelectionReveal(
  scrollRef: RefObject<HTMLDivElement | null>,
  selectedThreadId: string | null
): void {
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !selectedThreadId) return
    return beginSidebarSelectionReveal(scroll, selectedThreadId)
  }, [scrollRef, selectedThreadId])
}

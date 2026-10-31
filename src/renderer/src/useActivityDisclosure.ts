import { useEffect, useRef, useState } from 'react'

/** Keep the disclosure's requested state separate from its animated body. */
export function useActivityDisclosure(): {
  expanded: boolean
  mounted: boolean
  visible: boolean
  setOpen(open: boolean): void
} {
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const frame = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  return { expanded, mounted, visible, setOpen(open) {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (timer.current !== null) window.clearTimeout(timer.current)
    frame.current = null
    timer.current = null
    setExpanded(open)
    const override = document.documentElement.dataset.reducedMotion
    const reducedMotion = override == null ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : override === 'true'
    if (open) {
      setMounted(true)
      if (reducedMotion) setVisible(true)
      else frame.current = requestAnimationFrame(() => { frame.current = null; setVisible(true) })
    } else {
      setVisible(false)
      if (reducedMotion) setMounted(false)
      else timer.current = window.setTimeout(() => { timer.current = null; setMounted(false) }, 300)
    }
  } }
}

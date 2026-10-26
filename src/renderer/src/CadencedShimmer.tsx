import { useEffect, useRef, type ReactNode } from 'react'
import './cadencedShimmer.css'

/** Native r5l/i5l: one 1s sweep after 600ms, repeated every 4s while visible. */
export function CadencedShimmer({ active = true, className = '', children }: { active?: boolean; className?: string; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let visible = false
    let running = false
    let initialTimer: number | undefined
    let repeatTimer: number | undefined
    let endTimer: number | undefined
    const stop = (): void => {
      running = false
      window.clearTimeout(initialTimer)
      window.clearInterval(repeatTimer)
      window.clearTimeout(endTimer)
      element.classList.remove('is-sweeping')
    }
    const sweep = (): void => {
      window.clearTimeout(endTimer)
      element.classList.remove('is-sweeping')
      element.classList.add('is-sweeping')
      endTimer = window.setTimeout(() => element.classList.remove('is-sweeping'), 1000)
    }
    const update = (): void => {
      const override = document.documentElement.dataset.reducedMotion
      const reduced = override == null ? media?.matches : override === 'true'
      const shouldRun = visible && !document.hidden && !reduced
      if (shouldRun === running) return
      if (!shouldRun) { stop(); return }
      running = true
      initialTimer = window.setTimeout(() => { sweep(); repeatTimer = window.setInterval(sweep, 4000) }, 600)
    }
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      update()
    })
    if (intersection) intersection.observe(element)
    else { visible = true; update() }
    const mutation = new MutationObserver(update)
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] })
    media?.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      stop()
      intersection?.disconnect()
      mutation.disconnect()
      media?.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [active])
  if (!active) return <span className={className}>{children}</span>
  return <span ref={ref} className={`cadenced-shimmer ${className}`}>
    {children}
    <span className="cadenced-shimmer-sweep" aria-hidden="true"><span className="cadenced-shimmer-highlight">{children}</span></span>
  </span>
}

import { useSyncExternalStore } from 'react'

export interface WindowRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export function normalizeWindowZoom(value: unknown): number {
  const factor = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof factor === 'number' && Number.isFinite(factor) && factor >= 0.5 && factor <= 3 ? factor : 1
}

export function readWindowZoom(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1
  return normalizeWindowZoom(window.getComputedStyle(document.documentElement).getPropertyValue('--codex-window-zoom'))
}

export function toLogicalRect(rect: WindowRect, zoom = 1): WindowRect {
  const factor = normalizeWindowZoom(zoom)
  return { top: rect.top / factor, right: rect.right / factor, bottom: rect.bottom / factor,
    left: rect.left / factor, width: rect.width / factor, height: rect.height / factor }
}

export function toLogicalViewport(viewport: { width: number; height: number }, zoom = 1): { width: number; height: number } {
  const factor = normalizeWindowZoom(zoom)
  return { width: viewport.width / factor, height: viewport.height / factor }
}

function subscribeWindowZoom(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  return () => observer.disconnect()
}

export function useWindowZoom(): number {
  return useSyncExternalStore(subscribeWindowZoom, readWindowZoom, () => 1)
}

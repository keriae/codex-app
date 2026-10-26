export const MIN_WINDOW_ZOOM = 0.5
export const MAX_WINDOW_ZOOM = 3
// Recorded target renderer constants qHl/JHl/YHl (build 21421).
export const WINDOW_ZOOM_STEP = 0.1

export function isWindowZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= MIN_WINDOW_ZOOM && value <= MAX_WINDOW_ZOOM
}

export function steppedWindowZoom(current: number, delta: -1 | 1): number {
  return Math.max(MIN_WINDOW_ZOOM, Math.min(MAX_WINDOW_ZOOM,
    Math.round((current + delta * WINDOW_ZOOM_STEP) * 100) / 100))
}

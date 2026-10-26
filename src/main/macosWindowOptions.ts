/** Recorded primary-window values from target build 21421's main bundle. */
export function macosWindowOptions(windowZoom = 1): {
  titleBarStyle: 'hiddenInset'
  trafficLightPosition: { x: number; y: number }
  acceptFirstMouse: true
  vibrancy: 'menu'
  minWidth: 480
  minHeight: 600
} {
  const zoom = Number.isFinite(windowZoom) && windowZoom > 0 ? windowZoom : 1
  return {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: Math.round((44 * zoom - 14) / 2) },
    acceptFirstMouse: true,
    vibrancy: 'menu',
    minWidth: 480,
    minHeight: 600
  }
}

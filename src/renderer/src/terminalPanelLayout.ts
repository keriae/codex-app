export type TerminalPanelPlacement = 'bottom' | 'right'
export type TerminalPanelPresentation = 'sheet' | 'docked'

export const DEFAULT_TERMINAL_PANEL_SIZE: Record<TerminalPanelPlacement, number> = {
  bottom: 280,
  right: 500
}

export const MINIMUM_TERMINAL_PANEL_SIZE: Record<TerminalPanelPlacement, number> = {
  bottom: 160,
  right: 320
}

/** Geometry recovered from the installed app's app-shell panel layout. */
export function terminalPanelSizeLimits(
  placement: TerminalPanelPlacement,
  availableSize: number | null,
  fullView = false
): { minimum: number; maximum: number } {
  const minimum = MINIMUM_TERMINAL_PANEL_SIZE[placement]
  if (availableSize === null || !Number.isFinite(availableSize) || availableSize <= 0) {
    return { minimum, maximum: Number.POSITIVE_INFINITY }
  }
  const maximum = fullView
    ? availableSize
    : placement === 'bottom'
      ? availableSize * 0.5
      : availableSize - 352
  return { minimum, maximum: Math.max(minimum, maximum) }
}

export function clampTerminalPanelSize(
  size: number,
  placement: TerminalPanelPlacement,
  availableSize: number | null,
  fullView = false
): number {
  const { minimum, maximum } = terminalPanelSizeLimits(placement, availableSize, fullView)
  const requested = Number.isFinite(size) ? size : DEFAULT_TERMINAL_PANEL_SIZE[placement]
  return Math.max(minimum, Math.min(requested, maximum))
}

export function terminalPanelDragSize(
  startSize: number,
  startCoordinate: number,
  currentCoordinate: number
): number {
  return startSize + startCoordinate - currentCoordinate
}

export function shouldCollapseTerminalPanel(
  size: number,
  placement: TerminalPanelPlacement
): boolean {
  return Number.isFinite(size) && size < MINIMUM_TERMINAL_PANEL_SIZE[placement] * 0.5
}

export function terminalPanelKeyboardSize(
  key: string,
  size: number,
  placement: TerminalPanelPlacement,
  availableSize: number | null,
  shiftKey = false
): number | null {
  const { minimum, maximum } = terminalPanelSizeLimits(placement, availableSize)
  const step = shiftKey ? 40 : 10
  const growKey = placement === 'bottom' ? 'ArrowUp' : 'ArrowLeft'
  const shrinkKey = placement === 'bottom' ? 'ArrowDown' : 'ArrowRight'
  const requested = key === 'Home'
    ? minimum
    : key === 'End'
      ? Number.isFinite(maximum) ? maximum : DEFAULT_TERMINAL_PANEL_SIZE[placement]
      : key === growKey
        ? size + step
        : key === shrinkKey
          ? size - step
          : null
  return requested === null ? null : clampTerminalPanelSize(requested, placement, availableSize)
}

export type ProjectSummaryDisplayMode = 'overlay' | 'shift' | 'gutter'
export type ProjectSummaryVisibleSurface = 'popover' | 'inline' | null

export interface ProjectSummaryPresentation {
  displayMode: ProjectSummaryDisplayMode
  shouldShowInline: boolean
  visibleSurface: ProjectSummaryVisibleSurface
}

/**
 * Responsive thresholds retained from the shipped thread-summary layout.
 * The 736px center column stays fixed while the remaining horizontal space
 * decides whether the summary overlays, shifts, or occupies its own gutter.
 */
export function projectSummaryDisplayMode(
  mainContentWidth: number,
  panelWidth = 300
): ProjectSummaryDisplayMode {
  const safeMainWidth = Number.isFinite(mainContentWidth)
    ? Math.max(0, mainContentWidth)
    : 0
  const safePanelWidth = Number.isFinite(panelWidth)
    ? Math.max(0, panelWidth)
    : 300
  const sideSpace = (safeMainWidth - 736) / 2
  const panelDelta = safePanelWidth - 300
  if (sideSpace < 180 + panelDelta / 2) return 'overlay'
  if (sideSpace < 400 + panelDelta) return 'shift'
  return 'gutter'
}

/** A summary is either a popover or an inline panel; it is never both. */
export function projectSummaryPresentation({
  displayMode,
  pinned,
  popoverOpen
}: {
  displayMode: ProjectSummaryDisplayMode
  pinned: boolean
  popoverOpen: boolean
}): ProjectSummaryPresentation {
  const shouldShowInline = pinned && displayMode !== 'overlay'
  return {
    displayMode,
    shouldShowInline,
    visibleSurface: shouldShowInline
      ? 'inline'
      : displayMode === 'overlay' && popoverOpen
        ? 'popover'
        : null
  }
}

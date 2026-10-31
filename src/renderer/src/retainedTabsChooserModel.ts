export interface RetainedTabsPoint { x: number; y: number }
export interface RetainedTabsRect { left: number; right: number; top: number; bottom: number; width: number; height: number }
export interface RetainedTabsTriangle { start: RetainedTabsPoint; endA: RetainedTabsPoint; endB: RetainedTabsPoint }

/** Direct adaptation of wrn/J0/Y0 (22943): an eight-pixel extended destination edge. */
export function retainedTabsPointerTriangle(destination: RetainedTabsRect, side: 'top' | 'bottom', pointer: RetainedTabsPoint, source?: RetainedTabsRect): RetainedTabsTriangle | null {
  if (destination.width <= 0 || destination.height <= 0 || source && (source.width <= 0 || source.height <= 0)) return null
  const y = side === 'bottom' ? destination.top : destination.bottom
  return { start: pointer, endA: { x: destination.left - 8, y }, endB: { x: destination.right + 8, y } }
}

/** Trn/Ern include all three triangle edges and vertices. */
export function retainedTabsPointInsideTriangle(point: RetainedTabsPoint, triangle: RetainedTabsTriangle): boolean {
  const sign = (a: RetainedTabsPoint, b: RetainedTabsPoint, c: RetainedTabsPoint): number =>
    (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y)
  const first = sign(point, triangle.start, triangle.endA)
  const second = sign(point, triangle.endA, triangle.endB)
  const third = sign(point, triangle.endB, triangle.start)
  return !((first < 0 || second < 0 || third < 0) && (first > 0 || second > 0 || third > 0))
}

export function retainedTabDisabled(workspaceReady: boolean, requiresWorkspaceReady?: boolean): boolean {
  return !workspaceReady && requiresWorkspaceReady !== false
}

/** Ys only assigns arrow navigation to the trigger; popup rows retain native Tab order. */
export function retainedTabsTriggerKeyAction(open: boolean, key: string): 'open' | 'first' | 'last' | null {
  if (!open) return key === 'ArrowDown' ? 'open' : null
  if (key === 'ArrowUp') return 'last'
  return ['Enter', ' ', 'ArrowDown'].includes(key) ? 'first' : null
}

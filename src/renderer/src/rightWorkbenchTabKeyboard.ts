export type RightWorkbenchTabKeyboardKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'Delete'

export type RightWorkbenchTabDirection = 'ltr' | 'rtl'

export type RightWorkbenchTabKeyboardAction<TabId extends string = string> =
  | { type: 'activate'; id: TabId }
  | { type: 'close'; id: TabId; nextActiveId: TabId | null }

export interface ResolveRightWorkbenchTabKeyboardActionOptions<
  TabId extends string = string
> {
  order: readonly TabId[]
  focusedId: TabId
  key: string
  direction?: RightWorkbenchTabDirection
  closable?: boolean
}

const navigationKeys = new Set<string>([
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End'
])

export function isRightWorkbenchTabKeyboardKey(
  key: string
): key is RightWorkbenchTabKeyboardKey {
  return key === 'Delete' || navigationKeys.has(key)
}

/**
 * Returns the single tab that participates in the tab strip's roving tab stop.
 * An invalid or absent active id falls back to the first retained tab.
 */
export function rightWorkbenchRovingTabId<TabId extends string>(
  order: readonly TabId[],
  activeId: TabId | null
): TabId | null {
  if (activeId && order.includes(activeId)) return activeId
  return order[0] ?? null
}

export function rightWorkbenchRovingTabIndex<TabId extends string>(
  order: readonly TabId[],
  activeId: TabId | null,
  id: TabId
): 0 | -1 {
  return rightWorkbenchRovingTabId(order, activeId) === id ? 0 : -1
}

/**
 * Mirrors the recovered native tab-list behavior: horizontal arrows wrap,
 * Home/End jump to an edge, and arrow direction follows document direction.
 */
export function rightWorkbenchTabNavigationTarget<TabId extends string>(
  order: readonly TabId[],
  focusedId: TabId,
  key: string,
  direction: RightWorkbenchTabDirection = 'ltr'
): TabId | null {
  if (!navigationKeys.has(key) || order.length === 0) return null
  const index = order.indexOf(focusedId)
  if (index < 0) return null

  let targetIndex: number
  if (key === 'Home') targetIndex = 0
  else if (key === 'End') targetIndex = order.length - 1
  else {
    const advances =
      (key === 'ArrowRight' && direction === 'ltr') ||
      (key === 'ArrowLeft' && direction === 'rtl')
    targetIndex = (index + (advances ? 1 : -1) + order.length) % order.length
  }

  const target = order[targetIndex] ?? null
  return target === focusedId ? null : target
}

/** Selects the right neighbor after Delete, falling back to the left. */
export function rightWorkbenchActiveAfterDelete<TabId extends string>(
  order: readonly TabId[],
  deletedId: TabId
): TabId | null {
  const index = order.indexOf(deletedId)
  if (index < 0) return null
  return order[index + 1] ?? order[index - 1] ?? null
}

/**
 * Converts a tab-strip key into the small action surface needed by App.tsx.
 * The caller remains responsible for preventDefault, focus, state mutation,
 * and scrollIntoView so this module stays DOM-free and straightforward to test.
 */
export function resolveRightWorkbenchTabKeyboardAction<TabId extends string>({
  order,
  focusedId,
  key,
  direction = 'ltr',
  closable = true
}: ResolveRightWorkbenchTabKeyboardActionOptions<TabId>):
  RightWorkbenchTabKeyboardAction<TabId> | null {
  if (key === 'Delete') {
    if (!closable || !order.includes(focusedId)) return null
    return {
      type: 'close',
      id: focusedId,
      nextActiveId: rightWorkbenchActiveAfterDelete(order, focusedId)
    }
  }

  const id = rightWorkbenchTabNavigationTarget(order, focusedId, key, direction)
  return id ? { type: 'activate', id } : null
}

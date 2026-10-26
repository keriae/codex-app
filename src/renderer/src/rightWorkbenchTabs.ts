export type RightWorkbenchTabId =
  | `workspace:${string}`
  | `subagent:${string}`
  | 'side-chat'
  | `browser:${string}`
  | `terminal:${string}`

export interface RightWorkbenchTabsState {
  order: RightWorkbenchTabId[]
  activeId: RightWorkbenchTabId | null
}

export type RightWorkbenchTabKind = 'workspace' | 'subagent' | 'side-chat' | 'browser' | 'terminal'

export function rightWorkbenchTabKind(id: RightWorkbenchTabId): RightWorkbenchTabKind {
  if (id === 'side-chat') return 'side-chat'
  const separator = id.indexOf(':')
  return id.slice(0, separator) as Exclude<RightWorkbenchTabKind, 'side-chat'>
}

export function rightWorkbenchTabValue(id: RightWorkbenchTabId): string {
  return id === 'side-chat' ? id : id.slice(id.indexOf(':') + 1)
}

function unique(ids: readonly RightWorkbenchTabId[]): RightWorkbenchTabId[] {
  return [...new Set(ids)]
}

function adjacentAvailable(
  previousOrder: readonly RightWorkbenchTabId[],
  removedId: RightWorkbenchTabId,
  available: ReadonlySet<RightWorkbenchTabId>
): RightWorkbenchTabId | null {
  const index = previousOrder.indexOf(removedId)
  if (index < 0) return null
  for (let distance = 1; distance < previousOrder.length; distance += 1) {
    const right = previousOrder[index + distance]
    if (right && available.has(right)) return right
    const left = previousOrder[index - distance]
    if (left && available.has(left)) return left
  }
  return null
}

export function reconcileRightWorkbenchTabs(
  state: RightWorkbenchTabsState,
  availableIds: readonly RightWorkbenchTabId[]
): RightWorkbenchTabsState {
  const availableOrder = unique(availableIds)
  const available = new Set(availableOrder)
  const order = [
    ...state.order.filter((id) => available.has(id)),
    ...availableOrder.filter((id) => !state.order.includes(id))
  ]
  const activeId = state.activeId && available.has(state.activeId)
    ? state.activeId
    : state.activeId
      ? adjacentAvailable(state.order, state.activeId, available) ?? order.at(-1) ?? null
      : order.at(-1) ?? null
  if (
    activeId === state.activeId &&
    order.length === state.order.length &&
    order.every((id, index) => id === state.order[index])
  ) return state
  return { order, activeId }
}

export function openRightWorkbenchTab(
  state: RightWorkbenchTabsState,
  id: RightWorkbenchTabId,
  activate = true
): RightWorkbenchTabsState {
  const order = state.order.includes(id) ? state.order : [...state.order, id]
  const activeId = activate ? id : state.activeId ?? id
  return order === state.order && activeId === state.activeId ? state : { order, activeId }
}

export function activateRightWorkbenchTab(
  state: RightWorkbenchTabsState,
  id: RightWorkbenchTabId
): RightWorkbenchTabsState {
  return openRightWorkbenchTab(state, id, true)
}

export function closeRightWorkbenchTab(
  state: RightWorkbenchTabsState,
  id: RightWorkbenchTabId
): RightWorkbenchTabsState {
  if (!state.order.includes(id)) return state
  const order = state.order.filter((entry) => entry !== id)
  if (state.activeId !== id) return { order, activeId: state.activeId }
  const activeId = adjacentAvailable(state.order, id, new Set(order))
  return { order, activeId }
}

export function moveRightWorkbenchTab(
  state: RightWorkbenchTabsState,
  id: RightWorkbenchTabId,
  beforeId: RightWorkbenchTabId | null
): RightWorkbenchTabsState {
  if (!state.order.includes(id) || beforeId === id) return state
  const remaining = state.order.filter((entry) => entry !== id)
  const insertion = beforeId ? remaining.indexOf(beforeId) : remaining.length
  if (beforeId && insertion < 0) return state
  const order = [
    ...remaining.slice(0, insertion),
    id,
    ...remaining.slice(insertion)
  ]
  return order.every((entry, index) => entry === state.order[index]) ? state : { ...state, order }
}

import type { CommandAction, CommandItem } from './protocol'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizeCommandActions(value: unknown): CommandAction[] {
  if (!Array.isArray(value)) return []
  const actions: CommandAction[] = []
  let changed = false
  for (const entry of value) {
    const action = record(entry)
    if (!action || typeof action.type !== 'string' || typeof action.command !== 'string') {
      changed = true
      continue
    }
    switch (action.type) {
      case 'read':
        if (typeof action.name === 'string' && typeof action.path === 'string') {
          actions.push(entry as CommandAction)
          break
        }
        changed = true
        actions.push({
          ...action,
          type: 'read',
          command: action.command,
          name: typeof action.name === 'string' ? action.name : '',
          path: typeof action.path === 'string' ? action.path : ''
        })
        break
      case 'search':
        if ((action.query == null || typeof action.query === 'string') &&
          (action.path == null || typeof action.path === 'string')) {
          actions.push(entry as CommandAction)
          break
        }
        changed = true
        actions.push({
          ...action,
          type: 'search',
          command: action.command,
          query: typeof action.query === 'string' ? action.query : null,
          path: typeof action.path === 'string' ? action.path : null
        })
        break
      case 'listFiles':
        if (action.path == null || typeof action.path === 'string') {
          actions.push(entry as CommandAction)
          break
        }
        changed = true
        actions.push({
          ...action,
          type: 'listFiles',
          command: action.command,
          path: typeof action.path === 'string' ? action.path : null
        })
        break
      default:
        // Future command classifications remain commands until their semantics are known.
        if (action.type === 'unknown') actions.push(entry as CommandAction)
        else {
          changed = true
          actions.push({ ...action, type: 'unknown', command: action.command })
        }
    }
  }
  return changed ? actions : value as CommandAction[]
}

export function commandDurationMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function normalizeCommandItem(item: CommandItem): CommandItem {
  const hasActions = Object.prototype.hasOwnProperty.call(item, 'commandActions')
  const actions = hasActions ? normalizeCommandActions(item.commandActions) : undefined
  const hasDuration = Object.prototype.hasOwnProperty.call(item, 'durationMs')
  const duration = hasDuration ? commandDurationMs(item.durationMs) : undefined
  if ((!hasActions || actions === item.commandActions) && (!hasDuration || duration === item.durationMs)) return item
  return { ...item, ...(hasActions ? { commandActions: actions } : {}), ...(hasDuration ? { durationMs: duration } : {}) }
}

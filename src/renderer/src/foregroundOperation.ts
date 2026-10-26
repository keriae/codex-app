import type { Thread } from './protocol'
import type { SessionAction } from './state/sessionReducer'

export interface ForegroundOperation { id: string; revision: number; cwd: string }
export interface ForegroundOwner { activeId: string | null; revision: number; cwd: string | null }

export function ownsForegroundOperation(operation: ForegroundOperation, current: ForegroundOwner): boolean {
  return operation.id === current.activeId && operation.revision === current.revision && operation.cwd === current.cwd
}

/** A delayed create still belongs in the catalog, but only its owner can select it. */
export function createdThreadAction(thread: Thread, foreground: boolean): SessionAction {
  return foreground ? {type: 'threadHydrated', thread} : {type: 'threadUpserted', thread}
}

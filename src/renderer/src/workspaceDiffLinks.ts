import type { FileUpdateChange } from './protocol'
import { resolveWorkspaceFileLink } from './workspaceFileLinks'
import type { WorkspaceChangeEntry } from './workspacePaneModel'
import { parseUnifiedDiff } from './unifiedDiff'

export const OPEN_WORKSPACE_DIFF_EVENT = 'codex:open-workspace-diff'
export interface WorkspaceDiffLink { itemId: string; change: FileUpdateChange }
export function dispatchWorkspaceDiffLink(link: WorkspaceDiffLink, target: EventTarget = window): boolean {
  return target.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_DIFF_EVENT, { detail: link }))
}

export function resolveWorkspaceDiffLink(cwd: string, value: unknown): WorkspaceChangeEntry | null {
  if (!value || typeof value !== 'object') return null
  const link = value as WorkspaceDiffLink
  const change = link.change
  if (typeof link.itemId !== 'string' || !link.itemId || !change || typeof change.path !== 'string' ||
      typeof change.diff !== 'string' || !change.kind || !['add', 'delete', 'update'].includes(change.kind.type)) return null
  if (change.kind.type === 'update' && change.kind.move_path != null && typeof change.kind.move_path !== 'string') return null
  const sourcePath = resolveWorkspaceFileLink(cwd, change.path)
  const path = change.kind.type === 'update' && change.kind.move_path
    ? resolveWorkspaceFileLink(cwd, change.kind.move_path) : sourcePath
  if (!sourcePath || !path) return null
  const parsed = parseUnifiedDiff(change.diff)
  return { id: `${link.itemId}:${path}`, itemId: link.itemId, turnId: '', path, sourcePath, diff: change.diff,
    status: undefined, kind: change.kind.type === 'add' ? 'added' : change.kind.type === 'delete' ? 'deleted'
      : sourcePath !== path ? 'moved' : 'modified', additions: parsed.additions, deletions: parsed.deletions }
}

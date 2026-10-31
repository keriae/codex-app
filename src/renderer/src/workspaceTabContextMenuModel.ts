import { toLogicalRect, toLogicalViewport } from './windowZoom'

export const OPEN_WORKSPACE_TAB_CONTEXT_MENU_EVENT = 'codex:workspace-tab-context-menu'

export function resolveWorkspaceTabContextMenu(
  detail: unknown,
  documents: readonly { id?: number | string; path: string }[],
  viewport: { width: number; height: number },
  zoom = 1
): { path: string; x: number; y: number } | null {
  if (!detail || typeof detail !== 'object') return null
  const { tabId, x, y } = detail as Record<string, unknown>
  const localTabId = typeof tabId === 'string' && tabId.startsWith('workspace:') ? tabId.slice(10) : tabId
  if (typeof localTabId !== 'string' || !localTabId.startsWith('file:') ||
    typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null
  const value = localTabId.slice(5)
  // Chrome identifies a document instance by id; paths are retained for older
  // verified callers. Resolve either form against the current store only.
  const document = documents.find((doc) => doc.id !== undefined && String(doc.id) === value) ||
    documents.find((doc) => doc.path === value)
  if (!document) return null
  const path = document.path
  const point = toLogicalRect({ left: x, top: y, right: x, bottom: y, width: 0, height: 0 }, zoom)
  const bounds = toLogicalViewport(viewport, zoom)
  return { path, x: Math.max(4, Math.min(point.left, bounds.width - 204)), y: Math.max(4, Math.min(point.top, bounds.height - 194)) }
}

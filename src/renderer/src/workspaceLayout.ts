export type WorkspaceLayoutMode = 'full' | 'split'
export type WorkspacePrimarySurface = 'chat' | 'content'

export const WORKSPACE_LAYOUTS_KEY = 'codex-replica:workspace-layouts:v1'
export const OPEN_WORKSPACE_CONTENT_EVENT = 'codex-replica:open-workspace-content'
export const CLOSE_WORKSPACE_CONTENT_EVENT = 'codex-replica:close-workspace-content'

/** Stored task layout is independent of the default used when a new task starts. */
export function parseWorkspaceLayouts(raw: string | null): Record<string, WorkspaceLayoutMode> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(
      ([id, mode]) => id.length > 0 && (mode === 'full' || mode === 'split')
    )) as Record<string, WorkspaceLayoutMode>
  } catch { return {} }
}

/** Mirrors the installed mb initializer; opening content is a separate action. */
export function initialWorkspaceLayoutMode(
  defaultFullView: boolean,
  initialPrimarySurface: WorkspacePrimarySurface | null = null
): WorkspaceLayoutMode {
  return initialPrimarySurface !== null || defaultFullView ? 'full' : 'split'
}

export function workspaceSurfaceLayout(mode: WorkspaceLayoutMode, contentOpen: boolean): {
  primarySurface: WorkspacePrimarySurface
  contentFullWidth: boolean
  showChat: boolean
} {
  const contentFullWidth = mode === 'full' && contentOpen
  return { primarySurface: contentOpen ? 'content' : 'chat', contentFullWidth, showChat: !contentFullWidth }
}

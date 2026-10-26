import type { Project } from './protocol'
import { normalizeProjectPath } from './projects'
import { normalizeProjectEdit } from './projectPanelState'
export const PROJECT_PREFERENCES_KEY = 'codex-project-preferences-v1'
export const PROJECT_PINNED_KEY = 'codex-sidebar-pinned-projects-v1'
export const PROJECT_PINNED_EVENT = 'codex:project-pins-changed'
export interface ProjectPreferences { names: Record<string, string>; hiddenPaths: string[] }
export function normalizeProjectPreferences(parsed: unknown): ProjectPreferences {
  const result: ProjectPreferences = { names: {}, hiddenPaths: [] }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  const record = parsed as Record<string, unknown>
  if (record.names && typeof record.names === 'object' && !Array.isArray(record.names)) {
    for (const [key, value] of Object.entries(record.names)) {
      const path = normalizeProjectPath(key)
      // Preserve older profiles' 256-character names; new edits use the current
      // dialog's 200-character limit without erasing existing display metadata.
      if (path && path.length <= 4096 && typeof value === 'string' && value.trim() && value.trim().length <= 256 && !value.includes('\0')) result.names[path] = value.trim()
    }
  }
  if (Array.isArray(record.hiddenPaths)) result.hiddenPaths = [...new Set(record.hiddenPaths.map(normalizeProjectPath).filter((path): path is string => path !== null && path.length <= 4096))]
  return result
}
export function parseProjectPreferences(raw: string | null): ProjectPreferences {
  try {
    return normalizeProjectPreferences(raw ? JSON.parse(raw) : null)
  } catch { /* A corrupt local preference cannot prevent the catalog from opening. */ }
  return { names: {}, hiddenPaths: [] }
}
export function overlayProjectPreferences(projects: readonly Project[], preferences: ProjectPreferences): Project[] {
  const normalized = normalizeProjectPreferences(preferences)
  const hidden = new Set(normalized.hiddenPaths)
  return projects.flatMap((project) => {
    const seen = new Set<string>()
    const roots = project.roots.flatMap((root) => {
      const path = normalizeProjectPath(root.path)
      if (!path || hidden.has(path) || seen.has(path)) return []
      seen.add(path)
      return [{ ...root, path }]
    })
    if (!roots.length) return []
    return [{ ...project, roots, name: normalized.names[roots[0].path] || project.name }]
  })
}
export function editProjectPreference(preferences: ProjectPreferences, oldPath: string, newPath: string, name: string): ProjectPreferences {
  const old = normalizeProjectPath(oldPath)
  if (!old) throw new Error('Invalid original project directory')
  const edit = normalizeProjectEdit(name, newPath)
  const normalized = normalizeProjectPreferences(preferences)
  const names = { ...normalized.names }
  delete names[old]
  names[edit.path] = edit.name
  return { names, hiddenPaths: [...new Set([...normalized.hiddenPaths.filter((entry) => entry !== edit.path), ...(edit.path !== old ? [old] : [])])] }
}

/** Move either a path pin or a legacy server/saved-project ID pin atomically. */
export function migrateProjectPinnedPaths(
  pins: readonly string[],
  oldPath: string,
  newPath: string,
  aliases: readonly string[] = []
): string[] {
  const old = normalizeProjectPath(oldPath)
  const nextPath = normalizeProjectPath(newPath)
  if (!old || !nextPath) throw new Error('Invalid pinned project directory')
  const equivalent = new Set([old, `saved-path:${encodeURIComponent(old)}`, ...aliases])
  const unique = [...new Set(pins.filter((pin) => typeof pin === 'string' && pin.length > 0).map((pin) => normalizeProjectPath(pin) || pin))]
  const wasPinned = unique.some((pin) => equivalent.has(pin) || normalizeProjectPath(pin) === old)
  const retained = unique.filter((pin) => !equivalent.has(pin) && normalizeProjectPath(pin) !== old)
  return wasPinned && !retained.includes(nextPath) ? [...retained, nextPath] : retained
}

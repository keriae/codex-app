import type { ProjectListEntry } from './discoveryPages'
import { normalizeProjectPath } from './projects'

export const PROJECTS_PANEL_SORT_KEY = 'codex-projects-panel-sort-v1'

export interface ProjectPanelSort {
  key: 'modified' | 'name'
  direction: 'ascending' | 'descending'
}

export interface ProjectEdit {
  name: string
  path: string
}

export const DEFAULT_PROJECT_PANEL_SORT: ProjectPanelSort = {
  key: 'modified',
  direction: 'descending'
}

export function parseProjectPanelSort(raw: string | null): ProjectPanelSort {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PROJECT_PANEL_SORT }
    const sort = value as Record<string, unknown>
    if (!['modified', 'name'].includes(String(sort.key)) || !['ascending', 'descending'].includes(String(sort.direction))) return { ...DEFAULT_PROJECT_PANEL_SORT }
    return { key: sort.key as ProjectPanelSort['key'], direction: sort.direction as ProjectPanelSort['direction'] }
  } catch {
    return { ...DEFAULT_PROJECT_PANEL_SORT }
  }
}

export function orderProjectPanelEntries(
  entries: readonly ProjectListEntry[],
  sort: ProjectPanelSort,
  names: Readonly<Record<string, string>> = {}
): ProjectListEntry[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
  return entries.map((entry) => ({ ...entry, name: names[entry.path]?.trim() || entry.name })).sort((left, right) => {
    const nameDelta = collator.compare(left.name, right.name) || left.path.localeCompare(right.path)
    const delta = sort.key === 'modified'
      ? (left.updatedAt ?? 0) - (right.updatedAt ?? 0) || nameDelta
      : nameDelta
    return sort.direction === 'ascending' ? delta : -delta
  })
}

export function visibleProjectPanelPaths(paths: readonly string[], hiddenPaths: readonly string[]): string[] {
  const hidden = new Set(hiddenPaths.map(normalizeProjectPath).filter(Boolean))
  return paths.flatMap((value) => {
    const path = normalizeProjectPath(value)
    return path && !hidden.has(path) ? [path] : []
  })
}

export function normalizeProjectEdit(name: string, path: string): ProjectEdit {
  const normalizedName = name.trim()
  if (!normalizedName || normalizedName.length > 200 || normalizedName.includes('\0')) throw new Error('项目名称须为 1–200 个字符。')
  const normalizedPath = normalizeProjectPath(path)
  if (!normalizedPath || normalizedPath.length > 4096) throw new Error('请选择有效的本地文件夹。')
  return { name: normalizedName, path: normalizedPath }
}

export function nextProjectMenuIndex(
  disabled: readonly boolean[],
  current: number,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
): number {
  const enabled = disabled.flatMap((value, index) => value ? [] : [index])
  if (!enabled.length) return -1
  if (key === 'Home') return enabled[0]
  if (key === 'End') return enabled[enabled.length - 1]
  const position = enabled.indexOf(current)
  if (position < 0) return key === 'ArrowUp' ? enabled[enabled.length - 1] : enabled[0]
  return enabled[(position + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]
}

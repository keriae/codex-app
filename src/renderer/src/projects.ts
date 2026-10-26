import type { Project } from './protocol'

export const SAVED_PROJECTS_KEY = 'codex-saved-projects-v1'

export function normalizeProjectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.includes('\0')) return null
  return trimmed === '/' ? trimmed : trimmed.replace(/\/+$/, '')
}

function deduplicatePaths(paths: readonly unknown[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of paths) {
    const path = normalizeProjectPath(value)
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

export function parseSavedProjectPaths(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? deduplicatePaths(parsed) : []
  } catch {
    return []
  }
}

export function addSavedProjectPath(paths: readonly string[], value: string): string[] {
  const path = normalizeProjectPath(value)
  if (!path) return deduplicatePaths(paths)
  return deduplicatePaths([path, ...paths])
}

export function removeSavedProjectPath(
  paths: readonly string[],
  value: string
): { paths: string[]; index: number } {
  const normalized = deduplicatePaths(paths)
  const path = normalizeProjectPath(value)
  if (!path) return { paths: normalized, index: -1 }
  const index = normalized.indexOf(path)
  return {
    paths: normalized.filter((entry) => entry !== path),
    index
  }
}

export function restoreSavedProjectPath(
  paths: readonly string[],
  value: string,
  index: number
): string[] {
  const path = normalizeProjectPath(value)
  const normalized = deduplicatePaths(paths)
  if (!path) return normalized
  const retained = normalized.filter((entry) => entry !== path)
  const insertionIndex = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, retained.length))
  return [
    ...retained.slice(0, insertionIndex),
    path,
    ...retained.slice(insertionIndex)
  ]
}

function savedProjectId(path: string): string {
  return `saved-path:${encodeURIComponent(path)}`
}

function projectNameForPath(path: string): string {
  return path.split('/').filter(Boolean).at(-1) || path
}

function normalizedProjects(projects: readonly Project[]): Project[] {
  const result: Project[] = []
  const seenProjectIds = new Set<string>()

  for (const project of projects) {
    const id = project.id.trim()
    if (!id || seenProjectIds.has(id)) continue
    const roots = deduplicatePaths(project.roots.map((root) => root.path)).map((path) => ({
      path
    }))
    if (!roots.length) continue
    seenProjectIds.add(id)
    result.push({
      ...project,
      id,
      name: project.name.trim() || projectNameForPath(roots[0].path),
      roots
    })
  }

  return result
}

export function projectCatalogWithSavedPaths(
  projects: readonly Project[],
  savedPaths: readonly string[]
): Project[] {
  const catalog = normalizedProjects(projects)
  const seenProjectIds = new Set<string>()
  const registeredRoots = new Set<string>()

  for (const project of catalog) {
    seenProjectIds.add(project.id)
    project.roots.forEach((root) => registeredRoots.add(root.path))
  }

  for (const path of deduplicatePaths(savedPaths)) {
    if (registeredRoots.has(path)) continue
    const id = savedProjectId(path)
    if (seenProjectIds.has(id)) continue
    seenProjectIds.add(id)
    registeredRoots.add(path)
    catalog.push({
      id,
      name: projectNameForPath(path),
      roots: [{ path }],
      metadata: {},
      position: catalog.length,
      createdAt: 0,
      updatedAt: 0,
      recencyAt: null
    })
  }

  return catalog
}

/**
 * Build the renderer-visible local catalog from folders explicitly saved in this
 * app profile. App-server projects are used only to preserve identity and
 * metadata for matching roots; unrelated projects from a shared Codex home are
 * never adopted into the sidebar.
 */
export function projectCatalogForSavedPaths(
  projects: readonly Project[],
  savedPaths: readonly string[]
): Project[] {
  const paths = deduplicatePaths(savedPaths)
  if (!paths.length) return []

  const savedPathSet = new Set(paths)
  const projectsByRoot = new Map<string, Project>()
  const savedRootsByProjectId = new Map<string, string[]>()

  for (const project of normalizedProjects(projects)) {
    for (const root of project.roots) {
      if (!projectsByRoot.has(root.path)) projectsByRoot.set(root.path, project)
      if (!savedPathSet.has(root.path)) continue
      const roots = savedRootsByProjectId.get(project.id) || []
      if (!roots.includes(root.path)) roots.push(root.path)
      savedRootsByProjectId.set(project.id, roots)
    }
  }

  const result: Project[] = []
  const seenProjectIds = new Set<string>()
  for (const path of paths) {
    const project = projectsByRoot.get(path)
    if (project) {
      if (seenProjectIds.has(project.id)) continue
      seenProjectIds.add(project.id)
      const roots = paths
        .filter((savedPath) => savedRootsByProjectId.get(project.id)?.includes(savedPath))
        .map((savedPath) => ({ path: savedPath }))
      result.push({ ...project, roots })
      continue
    }

    const id = savedProjectId(path)
    if (seenProjectIds.has(id)) continue
    seenProjectIds.add(id)
    result.push({
      id,
      name: projectNameForPath(path),
      roots: [{ path }],
      metadata: {},
      position: result.length,
      createdAt: 0,
      updatedAt: 0,
      recencyAt: null
    })
  }

  return result
}

export function deriveProjectPaths(
  projects: readonly Project[],
  savedPaths: readonly string[]
): string[] {
  return deduplicatePaths([
    ...projects.flatMap((project) => project.roots.map((root) => root.path)),
    ...savedPaths
  ])
}

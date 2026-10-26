import type { AppContext } from '../../shared/api'
import type { Project, Thread } from './protocol'
import { normalizeProjectPath } from './projects'

export const SELECTED_PROJECT_KEY = 'codex-selected-local-project-v1'

export type SelectedWorkspaceTarget =
  | { kind: 'local'; path: string }
  | { kind: 'remote'; hostId: string; projectId: string; path: string }
  | { kind: 'projectless'; path: string | null }

export type SelectedProjectPreference =
  | { stored: false }
  | { stored: true; path: string | null; target?: SelectedWorkspaceTarget }

export function parseSelectedProject(raw: string | null): SelectedProjectPreference {
  if (raw === null) return {stored: false}
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null) return {stored: true, path: null}
    const path = normalizeProjectPath(value)
    if (path && path !== '/') return {stored: true, path, target: {kind: 'local', path}}
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>
      const kind = candidate.kind
      const storedPath = candidate.path === null ? null : normalizeProjectPath(candidate.path)
      if (kind === 'projectless' && (candidate.path === null || (storedPath && storedPath !== '/'))) {
        return {stored: true, path: null, target: {kind, path: storedPath}}
      }
      if (kind === 'local' && storedPath && storedPath !== '/') {
        return {stored: true, path: storedPath, target: {kind, path: storedPath}}
      }
      if (kind === 'remote' && storedPath && storedPath !== '/' &&
          typeof candidate.hostId === 'string' && candidate.hostId.trim() &&
          typeof candidate.projectId === 'string' && candidate.projectId.trim()) {
        return {
          stored: true,
          path: storedPath,
          target: {
            kind,
            path: storedPath,
            hostId: candidate.hostId.trim(),
            projectId: candidate.projectId.trim()
          }
        }
      }
    }
  } catch { /* Ignore a malformed preference without blocking startup. */ }
  return {stored: false}
}

/** Restore the selected local root; first launch uses catalog order, not chat recency. */
export function initialProjectPath(context: AppContext, projects: readonly Project[], preference: SelectedProjectPreference): string | null {
  if (context.initialCwdSource !== 'home') return null
  const paths = [...new Set(projects.flatMap((project) => project.roots.map((root) => normalizeProjectPath(root.path)))
    .filter((path): path is string => Boolean(path && path !== '/')))]
  if (preference.stored && preference.target && preference.target.kind !== 'local') return null
  if (preference.stored && preference.path === null) return null
  if (preference.stored && preference.path && paths.includes(preference.path)) return preference.path
  return paths[0] ?? null
}

export function canRestoreInitialProject(expected: {revision: number; scope: string}, current: {
  revision: number; scope: string; selectedThreadId: string | null; activeSubmissionId: string | null
}): boolean {
  return expected.revision === current.revision && expected.scope === current.scope &&
    current.selectedThreadId === null && current.activeSubmissionId === null
}

/**
 * app-server threads only persist a cwd/project id, while the desktop UI also
 * distinguishes a deliberately projectless chat. Treat a local cwd that is not
 * represented by the project catalog (or an explicitly saved root) as
 * projectless when reopening the thread.
 */
export function localThreadProjectKind(
  thread: Pick<Thread, 'cwd' | 'projectId'>,
  projects: readonly Project[],
  savedProjectPaths: readonly string[]
): 'local' | 'projectless' {
  if (thread.projectId && projects.some((project) => project.id === thread.projectId)) return 'local'
  const cwd = normalizeProjectPath(thread.cwd)
  if (!cwd) return 'projectless'
  const knownPaths = new Set([
    ...savedProjectPaths,
    ...projects.flatMap((project) => project.roots.map((root) => root.path))
  ].map(normalizeProjectPath).filter((path): path is string => Boolean(path)))
  return knownPaths.has(cwd) ? 'local' : 'projectless'
}

export function rememberSelectedProject(storage: Pick<Storage, 'setItem'>, path: string | null): void {
  const normalized = path === null ? null : normalizeProjectPath(path)
  if (path !== null && (!normalized || normalized === '/')) return
  try { storage.setItem(SELECTED_PROJECT_KEY, JSON.stringify(normalized)) } catch { /* Selection remains usable without persistence. */ }
}

export function rememberSelectedWorkspace(
  storage: Pick<Storage, 'setItem'>,
  target: SelectedWorkspaceTarget
): void {
  const path = target.path === null ? null : normalizeProjectPath(target.path)
  if (target.path !== null && (!path || path === '/')) return
  const value: SelectedWorkspaceTarget = target.kind === 'remote'
    ? {...target, hostId: target.hostId.trim(), projectId: target.projectId.trim(), path: path!}
    : target.kind === 'local'
      ? {kind: 'local', path: path!}
      : {kind: 'projectless', path}
  if (value.kind === 'remote' && (!value.hostId || !value.projectId)) return
  try { storage.setItem(SELECTED_PROJECT_KEY, JSON.stringify(value)) } catch { /* Selection remains usable without persistence. */ }
}

import type { Project, Thread } from './protocol'
import type {
  RemoteConnection,
  RemoteConnectionState,
  RemoteProject
} from '../../shared/api'

export const SIDEBAR_PROJECT_PREVIEW_LIMIT = 5

const SIDEBAR_REMOTE_HOST_COLORS = [
  '#12bde8',
  '#b390ff',
  '#ff9f43',
  '#52c7b8',
  '#f071a7'
] as const

export function sidebarRemoteHostColor(hostId: string): string {
  let hash = 2166136261
  for (let index = 0; index < hostId.length; index += 1) {
    hash ^= hostId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return SIDEBAR_REMOTE_HOST_COLORS[(hash >>> 0) % SIDEBAR_REMOTE_HOST_COLORS.length]
}

export interface SidebarProjectCollection {
  id: string
  projectId?: string
  name: string
  roots: string[]
  path: string
  threads: Thread[]
  kind?: 'remote'
  hostId?: string
  hostLabel?: string
  hostState?: RemoteConnectionState
  hostColor?: string
}

export interface SidebarCollections {
  pinned: Thread[]
  projects: SidebarProjectCollection[]
  recent: Thread[]
  projectlessRecent: Thread[]
}

export function normalizeSidebarWorkspacePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path === '/' || path.includes('\0')) return null
  return path.replace(/\/+$/, '')
}

export function buildSidebarCollections(
  threads: readonly Thread[],
  pinnedThreadIds: readonly string[],
  projects: readonly Project[],
  remoteProjects: readonly RemoteProject[] = [],
  remoteConnections: readonly RemoteConnection[] = []
): SidebarCollections {
  const pinnedIds = new Set(pinnedThreadIds)
  const normalizedProjects: SidebarProjectCollection[] = []
  const projectsById = new Map<string, SidebarProjectCollection>()
  const projectsByRoot = new Map<string, SidebarProjectCollection>()
  const remoteProjectsById = new Map<string, SidebarProjectCollection>()
  const remoteProjectsByRoot = new Map<string, SidebarProjectCollection>()
  const remoteConnectionsByHost = new Map(
    remoteConnections.map((connection) => [connection.hostId, connection] as const)
  )

  for (const project of projects) {
    const id = project.id.trim()
    if (!id || projectsById.has(id)) continue
    const roots = [
      ...new Set(
        project.roots
          .map((root) => normalizeSidebarWorkspacePath(root.path))
          .filter((path): path is string => Boolean(path))
      )
    ]
    if (!roots.length) continue
    const collection: SidebarProjectCollection = {
      id,
      name: project.name.trim() || roots[0].split('/').filter(Boolean).at(-1) || roots[0],
      roots,
      path: roots[0],
      threads: []
    }
    projectsById.set(id, collection)
    for (const root of roots) {
      if (!projectsByRoot.has(root)) projectsByRoot.set(root, collection)
    }
    normalizedProjects.push(collection)
  }

  for (const project of remoteProjects) {
    const projectId = project.id.trim()
    const hostId = project.hostId.trim()
    const path = normalizeSidebarWorkspacePath(project.remotePath)
    if (!projectId || !hostId || !path) continue
    const lookupKey = `${hostId}\0${projectId}`
    if (remoteProjectsById.has(lookupKey)) continue
    const connection = remoteConnectionsByHost.get(hostId)
    const collection: SidebarProjectCollection = {
      id: `remote:${hostId}:${projectId}`,
      projectId,
      name: project.label.trim() || path.split('/').filter(Boolean).at(-1) || path,
      roots: [path],
      path,
      threads: [],
      kind: 'remote',
      hostId,
      hostLabel: connection?.host.trim() || connection?.displayName.trim() || hostId,
      hostState: connection?.state || 'disconnected',
      hostColor: sidebarRemoteHostColor(hostId)
    }
    remoteProjectsById.set(lookupKey, collection)
    remoteProjectsByRoot.set(`${hostId}\0${path}`, collection)
    normalizedProjects.push(collection)
  }

  const projectForThread = (thread: Thread): SidebarProjectCollection | null => {
    const hostId = typeof thread.hostId === 'string' && thread.hostId.trim()
      ? thread.hostId.trim()
      : 'local'
    const projectId = typeof thread.projectId === 'string' ? thread.projectId.trim() : ''
    if (hostId !== 'local') {
      if (projectId) return remoteProjectsById.get(`${hostId}\0${projectId}`) || null
      const path = normalizeSidebarWorkspacePath(thread.cwd)
      return path ? remoteProjectsByRoot.get(`${hostId}\0${path}`) || null : null
    }
    if (projectId) return projectsById.get(projectId) || null
    const path = normalizeSidebarWorkspacePath(thread.cwd)
    return path ? projectsByRoot.get(path) || null : null
  }

  const projectlessRecent: Thread[] = []

  for (const thread of threads) {
    const project = projectForThread(thread)
    if (project) project.threads.push(thread)
    else if (!thread.hostId || thread.hostId === 'local') projectlessRecent.push(thread)
  }

  return {
    pinned: threads.filter(
      (thread) => pinnedIds.has(thread.id) && projectForThread(thread)
    ),
    projects: normalizedProjects,
    recent: [...threads],
    projectlessRecent
  }
}

export function projectThreadsForDisplay(
  threads: readonly Thread[],
  expanded: boolean,
  selectedThreadId?: string | null
): Thread[] {
  if (expanded) return [...threads]
  const preview = threads.slice(0, SIDEBAR_PROJECT_PREVIEW_LIMIT)
  // The shipped sidebar retains its usual preview and appends the selected
  // chat when it falls outside that preview, without expanding the project.
  const selected = selectedThreadId
    ? threads.slice(SIDEBAR_PROJECT_PREVIEW_LIMIT).find((thread) => thread.id === selectedThreadId)
    : undefined
  return selected ? [...preview, selected] : preview
}

export function threadHasActiveSidebarTurn(thread: Thread): boolean {
  if (thread.status?.type === 'active') return true
  return thread.turns.some((turn) => turn.status === 'inProgress')
}

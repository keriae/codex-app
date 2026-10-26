import type { Thread } from './protocol'
import type { SidebarProjectCollection } from './sidebarModel'

export type SidebarSortMode = 'recent' | 'manual'
export type SidebarGroupingMode = 'project' | 'host' | 'combined'

export interface SidebarDisplayGroup extends SidebarProjectCollection {
  groupingKind?: 'connection'
  memberProjectIds?: string[]
}

function threadRecency(thread: Thread): number {
  return thread.recencyAt ?? thread.updatedAt
}

export function sortSidebarThreads(
  threads: readonly Thread[],
  mode: SidebarSortMode
): Thread[] {
  if (mode === 'manual') return [...threads]
  return [...threads].sort((left, right) => threadRecency(right) - threadRecency(left))
}

export function recentThreadsForSidebar(
  threads: readonly Thread[],
  projectlessThreads: readonly Thread[],
  includeProjectThreads: boolean
): Thread[] {
  return includeProjectThreads ? [...threads] : [...projectlessThreads]
}

export function sidebarProjectGroupsForMode(
  projects: readonly SidebarProjectCollection[],
  mode: SidebarGroupingMode
): SidebarDisplayGroup[] {
  if (mode === 'combined') return []
  if (mode === 'project') return projects.map((project) => ({ ...project }))

  const groups = new Map<string, SidebarDisplayGroup>()
  for (const project of projects) {
    const hostId = project.kind === 'remote'
      ? project.hostId?.trim() || `remote:${project.id}`
      : 'local'
    const groupId = `connection:${hostId}`
    const existing = groups.get(groupId)
    const memberProjectIds = [project.id, project.projectId]
      .filter((projectId): projectId is string => Boolean(projectId))
    if (existing) {
      existing.roots = [...new Set([...existing.roots, ...project.roots])]
      existing.threads = [...existing.threads, ...project.threads]
      existing.memberProjectIds = [
        ...new Set([...(existing.memberProjectIds || []), ...memberProjectIds])
      ]
      continue
    }

    const remote = project.kind === 'remote'
    groups.set(groupId, {
      id: groupId,
      projectId: remote ? project.projectId : undefined,
      name: remote ? project.hostLabel || hostId : '本地',
      roots: [...project.roots],
      path: project.path,
      threads: [...project.threads],
      kind: remote ? 'remote' : undefined,
      hostId: remote ? hostId : undefined,
      hostLabel: remote ? '' : undefined,
      hostState: project.hostState,
      hostColor: project.hostColor,
      groupingKind: 'connection',
      memberProjectIds
    })
  }
  return [...groups.values()]
}

import { describe, expect, it } from 'vitest'
import type { Thread } from './protocol'
import {
  recentThreadsForSidebar,
  sidebarProjectGroupsForMode,
  sortSidebarThreads
} from './sidebarViewPreferences'
import type { SidebarProjectCollection } from './sidebarModel'

function thread(
  id: string,
  cwd: string,
  updatedAt: number,
  recencyAt?: number,
  projectId: string | null = null
): Thread {
  return {
    id,
    preview: id,
    cwd,
    createdAt: updatedAt,
    updatedAt,
    recencyAt,
    projectId,
    turns: []
  }
}

describe('sidebar view preferences', () => {
  it('toggles registered project chats in recent without hiding projectless chats', () => {
    const project = thread('project', '/workspace/project', 30, undefined, 'project-id')
    const unregistered = thread('unregistered', '/workspace/one-off', 20)
    const empty = thread('empty', '', 10)

    expect(
      recentThreadsForSidebar(
        [project, unregistered, empty],
        [unregistered, empty],
        false
      )
    ).toEqual([unregistered, empty])
    expect(
      recentThreadsForSidebar(
        [project, unregistered, empty],
        [unregistered, empty],
        true
      )
    ).toEqual([project, unregistered, empty])
  })

  it('uses recency for recent sorting and preserves incoming manual order', () => {
    const older = thread('older', '', 10, 40)
    const newer = thread('newer', '', 30, 50)

    expect(sortSidebarThreads([older, newer], 'recent')).toEqual([newer, older])
    expect(sortSidebarThreads([older, newer], 'manual')).toEqual([older, newer])
  })

  it('switches between project, connection, and one-list sidebar organization', () => {
    const localThread = thread('local-thread', '/workspace/local', 30, undefined, 'local-project')
    const remoteA = { ...thread('remote-a', '/srv/a', 20, undefined, 'remote-a'), hostId: 'host-a' }
    const remoteB = { ...thread('remote-b', '/srv/b', 10, undefined, 'remote-b'), hostId: 'host-a' }
    const projects: SidebarProjectCollection[] = [
      {
        id: 'local-project', name: 'Local project', roots: ['/workspace/local'],
        path: '/workspace/local', threads: [localThread]
      },
      {
        id: 'remote:host-a:remote-a', projectId: 'remote-a', name: 'Remote A',
        roots: ['/srv/a'], path: '/srv/a', threads: [remoteA], kind: 'remote',
        hostId: 'host-a', hostLabel: '10.0.0.1', hostState: 'connected', hostColor: '#12bde8'
      },
      {
        id: 'remote:host-a:remote-b', projectId: 'remote-b', name: 'Remote B',
        roots: ['/srv/b'], path: '/srv/b', threads: [remoteB], kind: 'remote',
        hostId: 'host-a', hostLabel: '10.0.0.1', hostState: 'connected', hostColor: '#12bde8'
      }
    ]

    expect(sidebarProjectGroupsForMode(projects, 'project')).toEqual(projects)
    expect(sidebarProjectGroupsForMode(projects, 'combined')).toEqual([])
    expect(sidebarProjectGroupsForMode(projects, 'host')).toEqual([
      expect.objectContaining({
        id: 'connection:local', name: '本地', groupingKind: 'connection',
        memberProjectIds: ['local-project'], threads: [localThread]
      }),
      expect.objectContaining({
        id: 'connection:host-a', name: '10.0.0.1', groupingKind: 'connection',
        memberProjectIds: [
          'remote:host-a:remote-a', 'remote-a',
          'remote:host-a:remote-b', 'remote-b'
        ], roots: ['/srv/a', '/srv/b'],
        threads: [remoteA, remoteB], kind: 'remote', hostId: 'host-a'
      })
    ])
  })
})

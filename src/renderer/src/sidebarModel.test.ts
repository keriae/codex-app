import { describe, expect, it } from 'vitest'
import type { Project, Thread } from './protocol'
import type { RemoteConnection, RemoteProject } from '../../shared/api'
import {
  buildSidebarCollections,
  projectThreadsForDisplay,
  SIDEBAR_PROJECT_PREVIEW_LIMIT,
  sidebarRemoteHostColor,
  threadHasActiveSidebarTurn
} from './sidebarModel'

function thread(
  id: string,
  cwd: string,
  updatedAt: number,
  name = id,
  projectId?: string | null
): Thread {
  return {
    id,
    preview: name,
    name,
    cwd,
    createdAt: updatedAt,
    updatedAt,
    projectId,
    turns: []
  }
}

function project(
  id: string,
  name: string,
  roots: string[],
  position = 0
): Project {
  return {
    id,
    name,
    roots: roots.map((path) => ({ path })),
    metadata: {},
    position,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null
  }
}

function expectedProject(value: Project, threads: Thread[]) {
  const roots = [...new Set(value.roots.map((root) => root.path.replace(/\/+$/, '')))]
  return { id: value.id, name: value.name, roots, path: roots[0], threads }
}

describe('sidebar collections', () => {
  it('keeps empty, root, and unregistered cwd chats exclusively in recent', () => {
    const explicitProject = project('repo-id', 'repo', ['/workspace/repo'])
    const workspace = thread('workspace', '/workspace/repo', 40)
    const empty = thread('empty', '', 30)
    const whitespace = thread('whitespace', '   ', 20)
    const root = thread('root', '/', 10)
    const oneOff = thread('one-off', '/workspace/one-off', 5)

    const collections = buildSidebarCollections(
      [workspace, empty, whitespace, root, oneOff],
      ['workspace', 'empty', 'root', 'one-off'],
      [explicitProject]
    )

    expect(collections.projects).toEqual([expectedProject(explicitProject, [workspace])])
    expect(collections.pinned).toEqual([workspace])
    expect(collections.recent).toEqual([workspace, empty, whitespace, root, oneOff])
    expect(collections.projectlessRecent).toEqual([empty, whitespace, root, oneOff])
  })

  it('creates ordered groups for every explicit project, including empty projects', () => {
    const alphaProject = project('alpha-id', 'Alpha', ['/workspace/alpha'], 0)
    const betaProject = project('beta-id', 'Beta', ['/workspace/beta'], 1)
    const emptyProject = project('empty-id', 'Empty', ['/workspace/empty'], 2)
    const alpha = thread('alpha', '/workspace/alpha', 10)
    const betaNewest = thread('beta-new', '/workspace/beta', 50)
    const betaOlder = thread('beta-old', '/workspace/beta', 20)

    const collections = buildSidebarCollections(
      [alpha, betaNewest, betaOlder],
      [],
      [alphaProject, betaProject, emptyProject]
    )

    expect(collections.projects).toEqual([
      expectedProject(alphaProject, [alpha]),
      expectedProject(betaProject, [betaNewest, betaOlder]),
      expectedProject(emptyProject, [])
    ])
  })

  it('uses a known project id before cwd and never assigns an unknown project id', () => {
    const alphaProject = project('alpha-id', 'Alpha', ['/workspace/alpha'])
    const betaProject = project('beta-id', 'Beta', ['/workspace/beta'])
    const byId = thread('by-id', '/workspace/beta', 20, 'by-id', 'alpha-id')
    const unknown = thread('unknown', '/workspace/alpha', 10, 'unknown', 'missing-id')

    const collections = buildSidebarCollections(
      [byId, unknown],
      ['by-id', 'unknown'],
      [alphaProject, betaProject]
    )

    expect(collections.projects[0].threads).toEqual([byId])
    expect(collections.projects[1].threads).toEqual([])
    expect(collections.pinned).toEqual([byId])
    expect(collections.projectlessRecent).toEqual([unknown])
  })

  it('matches normalized roots exactly across multi-root projects', () => {
    const multiRoot = project('multi-id', 'Multi', [
      '/workspace/repo/',
      '/workspace/second',
      '/workspace/repo'
    ])
    const first = thread('first', '/workspace/repo/', 3)
    const second = thread('second', '/workspace/second', 2)
    const prefixOnly = thread('prefix-only', '/workspace/repo-other', 1)

    const collections = buildSidebarCollections(
      [first, second, prefixOnly],
      [],
      [multiRoot]
    )

    expect(collections.projects).toEqual([expectedProject(multiRoot, [first, second])])
    expect(collections.projectlessRecent).toEqual([prefixOnly])
  })

  it('shows every pinned project chat instead of truncating the section', () => {
    const projects = [
      project('one-id', 'One', ['/workspace/one']),
      project('two-id', 'Two', ['/workspace/two']),
      project('three-id', 'Three', ['/workspace/three'])
    ]
    const first = thread('first', '/workspace/one', 30)
    const second = thread('second', '/workspace/two', 20)
    const third = thread('third', '/workspace/three', 10)

    expect(
      buildSidebarCollections(
        [first, second, third],
        ['first', 'second', 'third'],
        projects
      ).pinned
    ).toEqual([first, second, third])
  })

  it('previews five project chats and reveals the full group when expanded', () => {
    const threads = Array.from({ length: 7 }, (_, index) =>
      thread(`thread-${index + 1}`, '/workspace/repo', 100 - index)
    )

    expect(SIDEBAR_PROJECT_PREVIEW_LIMIT).toBe(5)
    expect(projectThreadsForDisplay(threads, false)).toEqual(threads.slice(0, 5))
    expect(projectThreadsForDisplay(threads, true)).toEqual(threads)
  })

  it('keeps the selected older chat visible without replacing or expanding the recent preview', () => {
    const threads = Array.from({ length: 10 }, (_, index) => thread(`chat-${index}`, '/workspace/repo', 100 - index))
    expect(projectThreadsForDisplay(threads, false, 'chat-8')).toEqual([
      ...threads.slice(0, 5), threads[8]
    ])
    expect(projectThreadsForDisplay(threads, false, 'chat-2')).toEqual(threads.slice(0, 5))
    expect(projectThreadsForDisplay(threads, false, 'another-project')).toEqual(threads.slice(0, 5))
    expect(projectThreadsForDisplay(threads, true, 'chat-8')).toEqual(threads)
  })

  it('preserves incoming global recent order and per-project thread order', () => {
    const repoProject = project('repo-id', 'Repo', ['/workspace/repo'])
    const otherProject = project('other-id', 'Other', ['/workspace/other'])
    const first = thread('first', '/workspace/repo', 1)
    const second = thread('second', '/workspace/repo', 3)
    const third = thread('third', '/workspace/other', 2)
    const recent = thread('recent', '', 4)
    const input = [first, recent, second, third]

    const collections = buildSidebarCollections(input, [], [repoProject, otherProject])

    expect(collections.recent).toEqual(input)
    expect(collections.projects[0].threads).toEqual([first, second])
    expect(collections.projectlessRecent).toEqual([recent])
  })

  it('merges remote projects by host and keeps same project ids isolated across hosts', () => {
    const remoteProjects: RemoteProject[] = [
      { id: 'repo-id', hostId: 'host-a', label: '[repo-a]', remotePath: '/srv/repo' },
      { id: 'repo-id', hostId: 'host-b', label: '[repo-b]', remotePath: '/srv/repo' }
    ]
    const remoteConnections: RemoteConnection[] = [
      { hostId: 'host-a', displayName: 'GPU A', host: '192.0.2.10', state: 'connected' },
      { hostId: 'host-b', displayName: 'GPU B', host: '192.0.2.11', state: 'connecting' }
    ]
    const hostA = { ...thread('remote-a', '/srv/repo', 20, 'remote-a', 'repo-id'), hostId: 'host-a' }
    const hostB = { ...thread('remote-b', '/srv/repo', 10, 'remote-b', 'repo-id'), hostId: 'host-b' }

    const collections = buildSidebarCollections(
      [hostA, hostB],
      ['remote-a'],
      [],
      remoteProjects,
      remoteConnections
    )

    expect(collections.projects).toEqual([
      {
        id: 'remote:host-a:repo-id', projectId: 'repo-id', name: '[repo-a]',
        roots: ['/srv/repo'], path: '/srv/repo', threads: [hostA], kind: 'remote',
        hostId: 'host-a', hostLabel: '192.0.2.10', hostState: 'connected', hostColor: '#b390ff'
      },
      {
        id: 'remote:host-b:repo-id', projectId: 'repo-id', name: '[repo-b]',
        roots: ['/srv/repo'], path: '/srv/repo', threads: [hostB], kind: 'remote',
        hostId: 'host-b', hostLabel: '192.0.2.11', hostState: 'connecting', hostColor: '#f071a7'
      }
    ])
    expect(collections.pinned).toEqual([hostA])
    expect(collections.projectlessRecent).toEqual([])
  })

  it('keeps remote host colors stable when connection ordering changes', () => {
    const remoteProjects: RemoteProject[] = [
      { id: 'repo-a', hostId: 'host-a', label: 'A', remotePath: '/srv/a' },
      { id: 'repo-b', hostId: 'host-b', label: 'B', remotePath: '/srv/b' }
    ]
    const remoteConnections: RemoteConnection[] = [
      { hostId: 'host-a', displayName: 'A', host: '192.0.2.10', state: 'connected' },
      { hostId: 'host-b', displayName: 'B', host: '192.0.2.11', state: 'connected' }
    ]

    const colors = (connections: RemoteConnection[]) => Object.fromEntries(
      buildSidebarCollections([], [], [], remoteProjects, connections).projects.map((project) => [
        project.hostId,
        project.hostColor
      ])
    )

    expect(colors(remoteConnections)).toEqual(colors([...remoteConnections].reverse()))
    expect(colors(remoteConnections)).toEqual({
      'host-a': sidebarRemoteHostColor('host-a'),
      'host-b': sidebarRemoteHostColor('host-b')
    })
  })

  it('matches remote threads by host and cwd when project ids are absent', () => {
    const remoteProject: RemoteProject = {
      id: 'remote-id', hostId: 'host-a', label: 'Remote', remotePath: '/srv/repo/'
    }
    const matching = { ...thread('matching', '/srv/repo/', 20), hostId: 'host-a' }
    const wrongHost = { ...thread('wrong-host', '/srv/repo', 10), hostId: 'host-b' }

    const collections = buildSidebarCollections(
      [matching, wrongHost], [], [], [remoteProject], []
    )

    expect(collections.projects[0].threads).toEqual([matching])
    expect(collections.recent).toEqual([matching, wrongHost])
    expect(collections.projectlessRecent).toEqual([])
  })

  it('recognizes live sidebar threads from catalog status or an in-progress turn', () => {
    expect(
      threadHasActiveSidebarTurn({
        ...thread('catalog-active', '/workspace/project', 30),
        status: { type: 'active', activeFlags: [] }
      })
    ).toBe(true)
    expect(
      threadHasActiveSidebarTurn({
        ...thread('turn-active', '/workspace/project', 20),
        turns: [{ id: 'turn-1', status: 'inProgress', items: [] }]
      })
    ).toBe(true)
    expect(threadHasActiveSidebarTurn(thread('idle', '/workspace/project', 10))).toBe(false)
  })
})

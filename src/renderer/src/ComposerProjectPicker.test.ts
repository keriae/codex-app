import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteConnection, RemoteProject } from '../../shared/api'
import {
  ComposerProjectPicker,
  composerProjectChoices,
  filterComposerProjectChoices
} from './ComposerProjectPicker'
import type { Project } from './protocol'

function project(id: string, name: string, roots: string[]): Project {
  return {
    id,
    name,
    roots: roots.map((path) => ({ path })),
    metadata: {},
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null
  }
}

const remoteProjects: RemoteProject[] = [
  { id: 'remote-one', hostId: 'ssh-one', label: 'Backend', remotePath: '/srv/backend' },
  { id: 'remote-two', hostId: 'ssh-offline', label: 'Archive', remotePath: '/srv/archive' }
]

const remoteConnections: RemoteConnection[] = [
  { hostId: 'ssh-one', displayName: 'devbox', host: 'devbox.internal', state: 'connected' },
  { hostId: 'ssh-offline', displayName: 'archive', host: 'archive.internal', state: 'disconnected' }
]

describe('composerProjectChoices', () => {
  it('flattens local roots, suppresses duplicate paths and appends remote projects with host state', () => {
    expect(composerProjectChoices([
      project('one', 'One', ['/work/one', '/work/shared']),
      project('two', 'Two', ['/work/shared', '/work/two'])
    ], remoteProjects, remoteConnections)).toEqual([
      { id: 'local:one:/work/one', label: 'One', path: '/work/one', projectKind: 'local', projectId: 'one' },
      { id: 'local:one:/work/shared', label: 'One', path: '/work/shared', projectKind: 'local', projectId: 'one' },
      { id: 'local:two:/work/two', label: 'Two', path: '/work/two', projectKind: 'local', projectId: 'two' },
      {
        id: 'remote:remote-one', label: 'Backend', path: '/srv/backend', projectKind: 'remote',
        projectId: 'remote-one', hostId: 'ssh-one', hostDisplayName: 'devbox', connected: true
      },
      {
        id: 'remote:remote-two', label: 'Archive', path: '/srv/archive', projectKind: 'remote',
        projectId: 'remote-two', hostId: 'ssh-offline', hostDisplayName: 'archive', connected: false
      }
    ])
  })

  it('searches project labels, paths and remote host names', () => {
    const choices = composerProjectChoices([project('one', 'Frontend', ['/work/frontend'])], remoteProjects, remoteConnections)
    expect(filterComposerProjectChoices(choices, 'DEVBOX').map(({projectId}) => projectId)).toEqual(['remote-one'])
    expect(filterComposerProjectChoices(choices, '/work/front').map(({projectId}) => projectId)).toEqual(['one'])
    expect(filterComposerProjectChoices(choices, 'missing')).toEqual([])
  })

  it('matches the original compact searchable menu and footer action order', () => {
    const html = renderToStaticMarkup(createElement(ComposerProjectPicker, {
      projects: [project('one', 'Frontend', ['/work/frontend'])],
      remoteProjects,
      remoteConnections,
      selectedRemoteProjectId: 'remote-one',
      onSelect: vi.fn(),
      onSelectRemote: vi.fn(),
      onAdd: vi.fn(),
      onAddRemote: vi.fn(),
      onSelectProjectless: vi.fn(),
      onClose: vi.fn()
    }))
    expect(html).toContain('role="dialog" aria-label="选择项目"')
    expect(html).toContain('placeholder="搜索项目"')
    expect(html).toContain('devbox')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-disabled="true" disabled=""')
    expect(html).not.toContain('在项目中使用 Work')
    expect(html.indexOf('新建远程项目')).toBeLessThan(html.indexOf('新建项目'))
    expect(html.indexOf('新建项目')).toBeLessThan(html.indexOf('不在项目中工作'))
  })

  it('uses the original empty-state copy', () => {
    const html = renderToStaticMarkup(createElement(ComposerProjectPicker, {
      projects: [],
      onSelect: vi.fn(),
      onAdd: vi.fn(),
      onClose: vi.fn()
    }))
    expect(html).toContain('未找到项目')
    expect(html).not.toContain('没有找到项目')
  })
})

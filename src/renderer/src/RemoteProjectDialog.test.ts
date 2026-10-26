import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteConnection, RemotePathValidation } from '../../shared/api'
import {
  RemoteDirectoryBrowser,
  RemoteProjectDialog,
  clearRemoteDirectoryCacheForTests,
  connectedRemoteConnections,
  loadRemoteDirectoryCached,
  normalizeRemoteProjectPath,
  peekRemoteDirectoryCache,
  prefetchRemoteDirectories,
  remoteDirectoryBreadcrumbs,
  remoteDirectoryEntries,
  remotePathDecision,
  remoteProjectName
} from './RemoteProjectDialog'

beforeEach(() => clearRemoteDirectoryCacheForTests())

const connected: RemoteConnection = {
  hostId: 'ssh-devbox',
  displayName: 'devbox',
  host: 'devbox.internal',
  state: 'connected'
}

const disconnected: RemoteConnection = {
  hostId: 'ssh-offline',
  displayName: 'offline',
  host: 'offline.internal',
  state: 'disconnected'
}

function renderDialog(connections: RemoteConnection[], initialPath = ''): string {
  return renderToStaticMarkup(createElement(RemoteProjectDialog, {
    connections,
    initialPath,
    onAddRemote: vi.fn(),
    onListDirectory: vi.fn(async () => ({
      path: initialPath || '/home/test',
      parentPath: initialPath ? '/srv/work' : '/home',
      entries: []
    })),
    onValidatePath: vi.fn(async (_hostId: string, path: string) => ({
      requestedPath: path,
      path,
      exists: true,
      isDirectory: true
    })),
    onCreateDirectory: vi.fn(),
    onCreate: vi.fn(),
    onClose: vi.fn()
  }))
}

describe('remote project setup dialog', () => {
  it('normalizes POSIX paths and derives an omitted project name from the folder', () => {
    expect(normalizeRemoteProjectPath(' /srv/work/codex/// ')).toBe('/srv/work/codex')
    expect(normalizeRemoteProjectPath('/')).toBe('/')
    expect(normalizeRemoteProjectPath('srv/work')).toBeNull()
    expect(normalizeRemoteProjectPath('/srv/\0work')).toBeNull()
    expect(remoteProjectName('', '/srv/work/codex')).toBe('codex')
    expect(remoteProjectName(' My project ', '/srv/work/codex')).toBe('My project')
  })

  it('keeps only connected SSH hosts in the selectable device list', () => {
    expect(connectedRemoteConnections([disconnected, connected])).toEqual([connected])
  })

  it('builds navigable breadcrumbs and sorts directory-only entries', () => {
    expect(remoteDirectoryBreadcrumbs('/srv/work/codex')).toEqual([
      {label: '/', path: '/'},
      {label: 'srv', path: '/srv'},
      {label: 'work', path: '/srv/work'},
      {label: 'codex', path: '/srv/work/codex'}
    ])
    expect(remoteDirectoryEntries({
      path: '/srv',
      parentPath: '/',
      entries: [
        {name: 'file.txt', path: '/srv/file.txt', isDirectory: false},
        {name: 'zeta', path: '/srv/zeta', isDirectory: true},
        {name: 'Alpha', path: '/srv/Alpha', isDirectory: true}
      ]
    }).map(({name}) => name)).toEqual(['Alpha', 'zeta'])
  })

  it('deduplicates hot directory reads and prefetches child folders like the native picker', async () => {
    const loader = vi.fn(async (_hostId: string, path?: string) => ({
      path: path || '/home/test',
      parentPath: '/home',
      entries: []
    }))
    const first = loadRemoteDirectoryCached(loader, connected.hostId, '/home/test')
    const second = loadRemoteDirectoryCached(loader, connected.hostId, '/home/test')
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    await loadRemoteDirectoryCached(loader, connected.hostId, '/home/test')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(peekRemoteDirectoryCache(connected.hostId, '/home/test')?.path).toBe('/home/test')

    await prefetchRemoteDirectories(loader, connected.hostId, [
      {name: 'one', path: '/home/test/one', isDirectory: true},
      {name: 'notes.txt', path: '/home/test/notes.txt', isDirectory: false},
      {name: 'two', path: '/home/test/two', isDirectory: true}
    ])
    expect(loader.mock.calls.map(([, path]) => path)).toEqual([
      '/home/test',
      '/home/test/one',
      '/home/test/two'
    ])
  })

  it('keeps a slow directory request deduplicated until it settles', async () => {
    let resolveListing!: (listing: { path: string; parentPath: string; entries: never[] }) => void
    const loader = vi.fn(() => new Promise<{ path: string; parentPath: string; entries: never[] }>((resolve) => {
      resolveListing = resolve
    }))
    const first = loadRemoteDirectoryCached(loader, connected.hostId, '/slow', 0)
    const second = loadRemoteDirectoryCached(loader, connected.hostId, '/slow', 0)
    expect(second).toBe(first)
    expect(loader).toHaveBeenCalledTimes(1)
    resolveListing({ path: '/slow', parentPath: '/', entries: [] })
    await first
  })

  it('renders the original compact folder-only list without invented breadcrumbs or row chevrons', () => {
    const html = renderToStaticMarkup(createElement(RemoteDirectoryBrowser, {
      listing: {
        path: '/srv/work',
        parentPath: '/srv',
        entries: [
          {name: 'README.md', path: '/srv/work/README.md', isDirectory: false},
          {name: 'backend', path: '/srv/work/backend', isDirectory: true}
        ]
      },
      loading: false,
      error: null,
      onNavigate: vi.fn(),
      onRetry: vi.fn()
    }))
    expect(html).toContain('role="listbox"')
    expect(html).toContain('title="/srv/work/backend"')
    expect(html).toContain('>backend</span>')
    expect(html).not.toContain('README.md')
    expect(html).not.toContain('aria-label="远程文件夹路径"')
    expect(html).not.toContain('lucide-chevron-right')
  })

  it('turns validation responses into ready, missing and invalid decisions', () => {
    const validation = (update: Partial<RemotePathValidation>): RemotePathValidation => ({
      requestedPath: '/srv/project',
      path: '/srv/project',
      exists: true,
      isDirectory: true,
      ...update
    })
    expect(remotePathDecision(validation({}))).toEqual({kind: 'ready', path: '/srv/project'})
    expect(remotePathDecision(validation({exists: false}))).toEqual({kind: 'missing', path: '/srv/project'})
    expect(remotePathDecision(validation({isDirectory: false}))).toEqual({kind: 'error', message: '所选路径不是文件夹。'})
    expect(remotePathDecision(validation({path: null, requestedPath: 'relative'})).kind).toBe('error')
  })

  it('renders the original remote project hierarchy without a native select', () => {
    const html = renderDialog([connected, disconnected])
    expect(html).toContain('role="dialog" aria-modal="true"')
    expect(html).toContain('创建项目')
    expect(html).toContain('>名称</span>')
    expect(html).toContain('源文件夹')
    expect(html).toContain('devbox')
    expect(html).toContain('在 <strong>devbox</strong> 上添加文件夹')
    expect(html).toContain('>取消</button>')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('offline')
  })

  it('shows the no-connected-host blocker and Add remote entry', () => {
    const html = renderDialog([disconnected])
    expect(html).toContain('选择远程设备')
    expect(html).toContain('目前没有连接任何远程主机。')
    expect(html).toContain('>添加远程主机</button>')
    expect(html).toMatch(/type="submit"[^>]*disabled=""/)
  })

  it('renders the original close and folder confirmation labels', () => {
    const html = renderDialog([connected])
    expect(html).toContain('aria-label="关闭"')
    expect(html).toContain('title="关闭"')
    const source = readFileSync(new URL('./RemoteProjectDialog.tsx', import.meta.url), 'utf8')
    expect(source).toContain('>使用文件夹</button>')
    expect(source).toContain('aria-label="转到上一级文件夹"')
    expect(source).toContain('aria-label="所选文件夹路径"')
    expect(source).not.toContain('转到\n')
    expect(source).not.toContain('刷新文件夹')
    expect(source).toContain('event.target === event.currentTarget && !locked')
  })

  it('locks the measured native dialog geometry into CSS', () => {
    const styles = readFileSync(new URL('./RemoteProjectDialog.css', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.remote-project-dialog\s*\{[^}]*width: min\(520px,[^}]*border-radius: 25px;/s)
    expect(styles).toMatch(/\.remote-project-folder-dialog\s*\{[^}]*width: min\(520px,[^}]*height: min\(404px,[^}]*border-radius: 25px;/s)
    expect(styles).toMatch(/\.remote-project-directory-list > button\s*\{[^}]*min-height: 30\.57px;[^}]*background: transparent;/s)
    expect(styles).toMatch(/\.remote-project-nested-backdrop\s*\{[^}]*background: transparent;[^}]*backdrop-filter: none;/s)
    expect(styles).toContain(":root[data-theme='light'] .remote-project-dialog-backdrop { background: rgb(0 0 0 / 25%); }")
  })

  it('keeps the folder path border unchanged while typing or keyboard focusing', () => {
    const styles = readFileSync(new URL('./RemoteProjectDialog.css', import.meta.url), 'utf8')
    expect(styles).toMatch(
      /\.remote-project-folder-path-row input:focus,\s*\.remote-project-folder-path-row input:focus-visible\s*\{[^}]*border-color: rgb\(252 252 252 \/ 15\.7%\);[^}]*outline: 0;[^}]*box-shadow: none;/s
    )
    expect(styles).toMatch(
      /:root\[data-theme='light'\] \.remote-project-folder-path-row input:focus,\s*:root\[data-theme='light'\] \.remote-project-folder-path-row input:focus-visible\s*\{[^}]*border-color: rgb\(13 13 13 \/ 12%\);[^}]*outline: 0;[^}]*box-shadow: none;/s
    )
  })

  it('keeps focus on the composite project-name shell instead of drawing clipped input edges', () => {
    const styles = readFileSync(new URL('./RemoteProjectDialog.css', import.meta.url), 'utf8')
    expect(styles).toMatch(
      /\.remote-project-name-input:focus-within\s*\{[^}]*border-color: rgb\(100 164 224 \/ 76%\);/s
    )
    expect(styles).toMatch(
      /\.remote-project-name-input input:focus,\s*\.remote-project-name-input input:focus-visible\s*\{[^}]*border: 0;[^}]*outline: 0;[^}]*box-shadow: none;/s
    )
    expect(styles).toMatch(
      /:root\[data-theme='light'\] \.remote-project-name-input\s*\{[^}]*border-color: rgb\(26 28 31 \/ 8%\);[^}]*background: rgb\(255 255 255 \/ 96%\);/s
    )
    expect(styles).toMatch(
      /:root\[data-theme='light'\] \.remote-project-name-input:focus-within\s*\{[^}]*border-color: rgb\(51 156 255\);/s
    )
  })

  it('renders a selected remote source as an editable folder row', () => {
    const html = renderDialog([connected], '/srv/work/codex')
    expect(html).toContain('class="remote-project-source-row"')
    expect(html).toContain('<strong>codex</strong>')
    expect(html).toContain('/srv/work/codex')
    expect(html).toContain('aria-label="移除文件夹"')
  })
})

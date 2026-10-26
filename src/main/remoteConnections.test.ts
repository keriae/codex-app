import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeRemotePath, RemoteConnectionStore } from './remoteConnections'

const directories: string[] = []

function fixture(): { directory: string; store: RemoteConnectionStore } {
  const directory = mkdtempSync(join(tmpdir(), 'codex-remote-connections-'))
  directories.push(directory)
  return { directory, store: new RemoteConnectionStore(directory) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('remote connection persistence', () => {
  it('persists SSH aliases and direct host options without storing runtime status', () => {
    const { directory, store } = fixture()
    const alias = store.saveConnection({ sshAlias: 'build-box', displayName: 'Build box' })
    const direct = store.saveConnection({
      host: 'dev@example.internal',
      port: 2222,
      identityFile: '/Users/test/.ssh/codex_ed25519'
    })

    expect(alias).toMatchObject({ sshAlias: 'build-box', host: 'build-box', displayName: 'Build box' })
    expect(direct).toMatchObject({
      host: 'dev@example.internal',
      displayName: 'dev@example.internal',
      port: 2222,
      identityFile: '/Users/test/.ssh/codex_ed25519'
    })
    expect(new RemoteConnectionStore(directory).listConnections()).toEqual([alias, direct])
    const file = JSON.parse(readFileSync(join(directory, 'remote-connections.json'), 'utf8'))
    expect(file.connections[0]).not.toHaveProperty('state')
  })

  it('migrates the replica alias-only connection file on read', () => {
    const { directory } = fixture()
    writeFileSync(join(directory, 'remote-connections.json'), JSON.stringify({
      version: 1,
      connections: [{ hostId: 'legacy-host', sshAlias: 'legacy-box', displayName: 'Legacy' }],
      projects: []
    }))
    expect(new RemoteConnectionStore(directory).listConnections()).toEqual([{
      hostId: 'legacy-host',
      sshAlias: 'legacy-box',
      host: 'legacy-box',
      displayName: 'Legacy'
    }])
  })

  it('rejects ambiguous aliases and invalid SSH option values', () => {
    const { store } = fixture()
    store.saveConnection({ sshAlias: 'SharedHost' })
    expect(() => store.saveConnection({ sshAlias: 'sharedhost' })).toThrow('already configured')
    expect(() => store.saveConnection({ host: '-oProxyCommand=bad' })).toThrow('invalid')
    expect(() => store.saveConnection({ host: 'box', port: 0 })).toThrow('between 1 and 65535')
    expect(() => store.saveConnection({ host: 'box', identityFile: 'relative/key' })).toThrow('absolute')
  })

  it('clears an edited port and rejects duplicate display names in the persistence layer', () => {
    const { directory, store } = fixture()
    const connection = store.saveConnection({
      host: 'dev.example.com', displayName: 'Development', port: 2222
    })
    expect(store.saveConnection({ hostId: connection.hostId, port: null })).not.toHaveProperty('port')
    expect(new RemoteConnectionStore(directory).getConnection(connection.hostId)).not.toHaveProperty('port')
    expect(() => store.saveConnection({ host: 'other.example.com', displayName: 'development' }))
      .toThrow('Display name')
  })
})

describe('remote project persistence', () => {
  it('deduplicates a canonical path per host while allowing the same path on another host', () => {
    const { store } = fixture()
    const first = store.saveConnection({ sshAlias: 'first' })
    const second = store.saveConnection({ sshAlias: 'second' })
    const project = store.createProject({ hostId: first.hostId, remotePath: '/work/app/../app/' })
    expect(project).toMatchObject({ hostId: first.hostId, remotePath: '/work/app', label: 'app' })
    expect(() => store.createProject({ hostId: first.hostId, remotePath: '/work/app' })).toThrow('already a project')
    expect(store.createProject({ hostId: second.hostId, remotePath: '/work/app' })).toMatchObject({
      hostId: second.hostId,
      remotePath: '/work/app'
    })
  })

  it('cascades projects when their connection is deleted', () => {
    const { store } = fixture()
    const connection = store.saveConnection({ sshAlias: 'project-box' })
    store.createProject({ hostId: connection.hostId, remotePath: '/srv/project' })
    store.deleteConnection(connection.hostId)
    expect(store.listConnections()).toEqual([])
    expect(store.listProjects()).toEqual([])
  })

  it('requires normalized absolute POSIX paths', () => {
    expect(normalizeRemotePath('/srv/project/../app')).toBe('/srv/app')
    expect(() => normalizeRemotePath('srv/app')).toThrow('absolute')
    expect(() => normalizeRemotePath('/srv/app\nother')).toThrow('invalid')
  })
})

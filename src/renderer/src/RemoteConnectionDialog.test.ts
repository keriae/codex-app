import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { remoteConnectionDraft, remoteConnectionSaveOptions } from './RemoteConnectionDialog'

const source = readFileSync(new URL('./RemoteConnectionDialog.tsx', import.meta.url), 'utf8')

describe('remote connection editor', () => {
  it('builds a direct hostname connection with an identity file', () => {
    expect(remoteConnectionSaveOptions({
      displayName: 'Build host', targetKind: 'hostname', sshHost: 'dev@example.com',
      sshPort: '2222', authMode: 'identity', identity: '~/.ssh/id_ed25519'
    })).toEqual({
      displayName: 'Build host', host: 'dev@example.com', port: 2222,
      identityFile: '~/.ssh/id_ed25519'
    })
  })

  it('explicitly clears a saved direct-host port when the edited field is empty', () => {
    expect(remoteConnectionSaveOptions({
      displayName: 'Build host', targetKind: 'hostname', sshHost: 'dev@example.com',
      sshPort: '', authMode: 'none', identity: ''
    }, 'remote-one')).toEqual({
      hostId: 'remote-one', displayName: 'Build host', host: 'dev@example.com',
      port: null, identityFile: ''
    })
  })

  it('uses an SSH config alias without direct-only fields', () => {
    expect(remoteConnectionSaveOptions({
      displayName: 'Prod', targetKind: 'alias', sshHost: 'prod-box', sshPort: '2200',
      authMode: 'none', identity: ''
    }, 'remote-one')).toEqual({hostId: 'remote-one', displayName: 'Prod', sshAlias: 'prod-box', identityFile: ''})

    expect(remoteConnectionSaveOptions({
      displayName: 'Prod', targetKind: 'alias', sshHost: 'prod-box', sshPort: 'not-a-port',
      authMode: 'identity', identity: 'not/an/absolute/path'
    }, 'remote-one')).toEqual({hostId: 'remote-one', displayName: 'Prod', sshAlias: 'prod-box', identityFile: ''})
  })

  it('rejects invalid ports and relative identity paths', () => {
    expect(() => remoteConnectionSaveOptions({
      displayName: 'Host', targetKind: 'hostname', sshHost: 'host', sshPort: '0',
      authMode: 'none', identity: ''
    })).toThrow('1–65535')
    expect(() => remoteConnectionSaveOptions({
      displayName: 'Host', targetKind: 'hostname', sshHost: 'host', sshPort: '',
      authMode: 'identity', identity: 'id_ed25519'
    })).toThrow('绝对路径')
  })

  it('hydrates existing aliases', () => {
    expect(remoteConnectionDraft({
      hostId: 'remote-one', displayName: 'Remote', host: 'remote', sshAlias: 'remote',
      identityFile: '/tmp/id', state: 'disconnected'
    })).toMatchObject({targetKind: 'alias', sshHost: 'remote', authMode: 'identity'})
  })

  it('matches the original labels and alias-only editor behavior', () => {
    expect(source).toContain("connection ? '编辑连接' : '添加 SSH 连接'")
    expect(source).toContain("draft.targetKind === 'alias' ? '别名' : '主机名'")
    expect(source).toContain('role="group" aria-label="SSH 身份验证方法"')
    expect(source).toContain('aria-pressed={draft.authMode === mode}')
    expect(source).toContain("['none', '无身份验证']")
    expect(source).toContain("['identity', '身份文件']")
    expect(source).toContain("draft.targetKind === 'hostname' && (")
    expect(source).not.toContain('<select')
  })

  it('uses the measured native modal and control geometry', () => {
    const styles = readFileSync(new URL('./RemoteConnectionDialog.css', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.remote-connection-dialog\s*\{[^}]*width: min\(520px,[^}]*border-radius: 25px;/s)
    expect(styles).toMatch(/\.remote-dialog-name-input\s*\{[^}]*height: 40px;[^}]*border-radius: 15px;/s)
    expect(styles).toMatch(/\.remote-dialog-auth-segment\s*\{[^}]*height: 24px;[^}]*gap: 2px;/s)
    expect(styles).toMatch(
      /\.remote-dialog-name-input input:focus,\s*\.remote-dialog-name-input input:focus-visible\s*\{[^}]*border: 0;[^}]*outline: 0;[^}]*box-shadow: none;/s
    )
  })

  it('shows duplicate display-name validation immediately and focuses the name field', () => {
    expect(source).toContain('const visibleError = duplicateName')
    expect(source).toContain('使用此显示名称的连接已存在')
    expect(source).toContain('ref={displayNameRef} autoFocus')
  })
})

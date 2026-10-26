import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discoverSshAliases,
  discoverSshConnections,
  parseSshConfigDirective,
  parseSshResolvedConfig,
  resolveSshAlias,
  type SshCommandRunner
} from './sshConfigDiscovery'

const directories: string[] = []

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'codex-ssh-config-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('ssh_config parsing', () => {
  it('supports whitespace, equals, comments, quotes and escapes', () => {
    expect(parseSshConfigDirective('  Host = build-box # comment')).toEqual({
      name: 'Host', values: ['build-box']
    })
    expect(parseSshConfigDirective('Include "config files/*.conf" other\\ file')).toEqual({
      name: 'Include', values: ['config files/*.conf', 'other file']
    })
    expect(parseSshConfigDirective('IdentityFile "/Users/me/.ssh/key file"')).toEqual({
      name: 'IdentityFile', values: ['/Users/me/.ssh/key file']
    })
    expect(parseSshConfigDirective('  # only a comment')).toBeNull()
    expect(() => parseSshConfigDirective('Host "unterminated')).toThrow('unterminated')
  })

  it('parses the first effective hostname, port and non-none identity', () => {
    expect(parseSshResolvedConfig([
      'host build-box',
      'hostname build.internal',
      'hostname ignored.internal',
      'port invalid',
      'port 2222',
      'identityfile none',
      'identityfile "/Users/me/.ssh/build key"',
      'identityfile /Users/me/.ssh/ignored'
    ].join('\n'))).toEqual({
      hostname: 'build.internal',
      port: 2222,
      identityFile: '/Users/me/.ssh/build key'
    })
  })
})

describe('SSH alias discovery', () => {
  it('recurses through root-relative, home and glob Includes while breaking cycles', () => {
    const directory = fixture()
    const home = join(directory, 'home')
    const ssh = join(home, '.ssh')
    const fragments = join(ssh, 'fragments')
    const homeFragments = join(home, 'shared')
    mkdirSync(fragments, { recursive: true })
    mkdirSync(homeFragments, { recursive: true })
    const config = join(ssh, 'config')
    writeFileSync(config, [
      'Include fragments/*.conf',
      'Include ~/shared/home.conf',
      'Host root-box',
      '  Include ignored-inside-host.conf'
    ].join('\n'))
    writeFileSync(join(fragments, 'a.conf'), [
      'Include fragments/b.conf',
      'Host fragment-box'
    ].join('\n'))
    writeFileSync(join(fragments, 'b.conf'), [
      'Include config',
      'Host nested-box'
    ].join('\n'))
    writeFileSync(join(homeFragments, 'home.conf'), 'Host home-box\n')
    writeFileSync(join(ssh, 'ignored-inside-host.conf'), 'Host ignored-box\n')

    expect(discoverSshAliases(config, { homeDirectory: home })).toEqual([
      'fragment-box',
      'home-box',
      'nested-box',
      'root-box'
    ])
  })

  it('collects only the first explicit alias per Host and excludes patterns and colima', () => {
    const directory = fixture()
    const config = join(directory, 'config')
    writeFileSync(config, [
      'Host * explicit-first explicit-second',
      'Host !negative wildcard?.example [range] literal-second',
      'Host only-*',
      'Host colima',
      'Host COLIMA',
      'Host z-box',
      'Host a-box',
      'Host z-box'
    ].join('\n'))

    expect(discoverSshAliases(config)).toEqual([
      'a-box',
      'explicit-first',
      'literal-second',
      'z-box'
    ])
  })

  it('returns an empty list for a missing entrypoint and enforces traversal limits', () => {
    const directory = fixture()
    expect(discoverSshAliases(join(directory, 'missing'))).toEqual([])

    const config = join(directory, 'config')
    writeFileSync(config, 'Host one\nHost two\n')
    expect(() => discoverSshAliases(config, { maxAliases: 1 })).toThrow('too many aliases')

    writeFileSync(config, 'x'.repeat(50))
    expect(() => discoverSshAliases(config, { maxConfigBytes: 10 })).toThrow('too large')
  })

  it('uses an injectable globber and ignores non-file matches', () => {
    const directory = fixture()
    const config = join(directory, 'config')
    const included = join(directory, 'included.conf')
    const folder = join(directory, 'folder')
    mkdirSync(folder)
    writeFileSync(config, 'Include custom-pattern\nHost root\n')
    writeFileSync(included, 'Host included\n')
    const glob = vi.fn(() => [included, folder, join(directory, 'vanished')])

    expect(discoverSshAliases(config, { glob })).toEqual(['included', 'root'])
    expect(glob).toHaveBeenCalledWith(join(directory, 'custom-pattern'))
  })
})

describe('SSH alias resolution', () => {
  it('runs OpenSSH effective-config resolution with the original argument order', async () => {
    const runSshCommand = vi.fn<SshCommandRunner>(async () => ({
      code: 0,
      stdout: 'hostname build.internal\nport 2202\nidentityfile ~/.ssh/build_ed25519\n',
      stderr: ''
    }))
    const result = await resolveSshAlias({
      entrypointPath: '/Users/test/.ssh/config',
      sshAlias: 'build-box',
      runSshCommand,
      timeoutMs: 3210,
      maxOutputBytes: 4567
    })

    expect(result).toEqual({
      displayName: 'build-box',
      sshAlias: 'build-box',
      host: 'build.internal',
      port: 2202,
      identityFile: '~/.ssh/build_ed25519'
    })
    expect(runSshCommand).toHaveBeenCalledWith(
      ['-G', '-F', '/Users/test/.ssh/config', 'build-box'],
      { signal: undefined, timeoutMs: 3210, maxOutputBytes: 4567 }
    )
  })

  it('filters github.com and aliases that OpenSSH cannot resolve', async () => {
    const githubRunner: SshCommandRunner = async () => ({
      code: 0, stdout: 'hostname GitHub.COM\nport 22\n', stderr: ''
    })
    expect(await resolveSshAlias({
      entrypointPath: '/tmp/config', sshAlias: 'github-work', runSshCommand: githubRunner
    })).toBeNull()

    const failedRunner: SshCommandRunner = async () => ({ code: 255, stdout: '', stderr: 'bad config' })
    expect(await resolveSshAlias({
      entrypointPath: '/tmp/config', sshAlias: 'broken', runSshCommand: failedRunner
    })).toBeNull()
  })

  it('resolves the discovered catalog in deterministic order', async () => {
    const directory = fixture()
    const config = join(directory, 'config')
    writeFileSync(config, 'Host zed\nHost alpha\nHost github\n')
    const runSshCommand: SshCommandRunner = async (args) => {
      const alias = args.at(-1)
      return {
        code: 0,
        stdout: `hostname ${alias === 'github' ? 'github.com' : `${alias}.internal`}\nport 22\n`,
        stderr: ''
      }
    }

    expect(await discoverSshConnections(config, { runSshCommand })).toEqual([
      { displayName: 'alpha', sshAlias: 'alpha', host: 'alpha.internal', port: 22 },
      { displayName: 'zed', sshAlias: 'zed', host: 'zed.internal', port: 22 }
    ])
  })

  it('rejects option-like, wildcard and whitespace aliases before invoking ssh', async () => {
    const runSshCommand = vi.fn<SshCommandRunner>()
    for (const sshAlias of ['-oProxyCommand=bad', 'wild*', 'two words']) {
      await expect(resolveSshAlias({
        entrypointPath: '/tmp/config', sshAlias, runSshCommand
      })).rejects.toThrow('invalid')
    }
    expect(runSshCommand).not.toHaveBeenCalled()
  })
})

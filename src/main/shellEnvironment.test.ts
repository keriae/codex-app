import { describe, expect, it, vi } from 'vitest'
import {
  hydrateShellEnvironment,
  type ShellEnvironmentRunner
} from './shellEnvironment'

const marker = Buffer.from('\0_SHELL_ENV_DELIMITER_\0')

function shellOutput(entries: string[], before = '', after = ''): Buffer {
  return Buffer.concat([
    Buffer.from(before),
    marker,
    Buffer.from(`${entries.join('\0')}\0`),
    marker,
    Buffer.from(after)
  ])
}

describe('hydrateShellEnvironment', () => {
  it('skips shell execution outside macOS', async () => {
    const runShell = vi.fn<ShellEnvironmentRunner>()

    await expect(
      hydrateShellEnvironment({ platform: 'linux', runShell })
    ).resolves.toBe('skipped')
    expect(runShell).not.toHaveBeenCalled()
  })

  it('loads the login shell with a bounded bootstrap environment and merges values', async () => {
    const environment: NodeJS.ProcessEnv = { EXISTING: 'kept' }
    const runShell = vi.fn<ShellEnvironmentRunner>(async () =>
      shellOutput(
        ['PATH=/custom/bin:/usr/bin', 'PROVIDER_TOKEN=dummy-secret', 'EQUALS=a=b=c'],
        'startup noise\n',
        '\nshutdown noise'
      )
    )

    const result = await hydrateShellEnvironment({
      environment,
      getUserShell: () => '/custom/login-shell',
      platform: 'darwin',
      runShell
    })

    expect(result).toBe('loaded')
    expect(JSON.stringify(result)).not.toContain('dummy-secret')
    expect(environment).toMatchObject({
      EXISTING: 'kept',
      PATH: '/custom/bin:/usr/bin',
      PROVIDER_TOKEN: 'dummy-secret',
      EQUALS: 'a=b=c'
    })
    expect(runShell).toHaveBeenCalledWith(
      '/custom/login-shell',
      ['-ilc', expect.stringContaining('command env -0')],
      expect.objectContaining({
        env: {
          CODEX_SHELL: '1',
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTARTED: 'true',
          ZSH_TMUX_AUTOSTART: 'false'
        },
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('falls back to zsh when the configured login shell fails', async () => {
    const shells: string[] = []
    const environment: NodeJS.ProcessEnv = {}
    const runShell: ShellEnvironmentRunner = async (executable) => {
      shells.push(executable)
      if (executable === '/broken/shell') throw new Error('unavailable')
      return shellOutput(['PATH=/fallback/bin'])
    }

    await expect(
      hydrateShellEnvironment({
        environment,
        getUserShell: () => '/broken/shell',
        platform: 'darwin',
        runShell
      })
    ).resolves.toBe('loaded')
    expect(shells).toEqual(['/broken/shell', '/bin/zsh'])
    expect(environment.PATH).toBe('/fallback/bin')
  })

  it('times out without merging a late or partial environment', async () => {
    const environment: NodeJS.ProcessEnv = { EXISTING: 'kept' }
    const runShell: ShellEnvironmentRunner = async (_executable, _args, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener('abort', () => resolve(shellOutput(['LATE=value'])), {
          once: true
        })
      })

    await expect(
      hydrateShellEnvironment({
        environment,
        getUserShell: () => '/bin/zsh',
        platform: 'darwin',
        runShell,
        timeoutMs: 5
      })
    ).resolves.toBe('timed_out')
    expect(environment).toEqual({ EXISTING: 'kept' })
  })

  it('rejects malformed shell output without exposing or merging it', async () => {
    const environment: NodeJS.ProcessEnv = { EXISTING: 'kept' }

    await expect(
      hydrateShellEnvironment({
        environment,
        getUserShell: () => '/bin/zsh',
        platform: 'darwin',
        runShell: async () => Buffer.from('PROVIDER_TOKEN=dummy-secret\0')
      })
    ).resolves.toBe('failed')
    expect(environment).toEqual({ EXISTING: 'kept' })
  })
})

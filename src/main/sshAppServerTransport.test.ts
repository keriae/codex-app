import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  shellQuote,
  isPermanentSshFailure,
  parseCodexVersionOutput,
  remoteAppServerBootstrapCommand,
  SshAppServerConnector,
  sshBaseArguments,
  type SshSpawn
} from './sshAppServerTransport'

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kill = vi.fn(() => true)

  close(code = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('close', code, signal)
  }

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams
  }
}

describe('SSH command construction', () => {
  it('uses an SSH config alias as the target with desktop keepalive options', () => {
    expect(sshBaseArguments({ host: 'ignored.example', sshAlias: 'dev-box', port: 2222 })).toEqual([
      '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=12',
      'dev-box'
    ])
  })

  it('passes direct host, port, identity, and connect timeout without a shell', () => {
    expect(sshBaseArguments({
      host: 'developer@example.internal',
      port: 2222,
      identityFile: '/Users/test/.ssh/codex key',
      connectTimeoutSeconds: 12
    })).toEqual([
      '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=12',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=12',
      '-i', '/Users/test/.ssh/codex key',
      '-p', '2222',
      'developer@example.internal'
    ])
  })

  it('quotes arbitrary remote paths as one POSIX shell argument', () => {
    expect(shellQuote("/srv/alice's project")).toBe("'/srv/alice'\"'\"'s project'")
  })

  it('parses compatible Codex versions and classifies permanent SSH authentication failures', () => {
    expect(parseCodexVersionOutput('codex-cli 0.164.0-alpha.11.1')).toEqual([0, 164, 0])
    expect(parseCodexVersionOutput('unexpected')).toBeNull()
    expect(isPermanentSshFailure('Permission denied (publickey).')).toBe(true)
    expect(isPermanentSshFailure('connect to host example port 22: Connection timed out')).toBe(false)
  })

  it('only kills the per-user desktop SSH socket server before bootstrapping', () => {
    const command = remoteAppServerBootstrapCommand('/opt/codex/bin/codex')
    expect(command).toContain('CODEX_SSH_SKIP_APP_SERVER_BOOT')
    expect(command).toContain('pkill -9 -U "$(id -u)"')
    expect(command).toContain('[d]esktop-ssh-websocket-v0\\.sock')
    expect(command).toContain("'/opt/codex/bin/codex'")
    expect(command).not.toMatch(/pkill[^&]+app-server/u)
  })

  it('resets the bootstrap state after app-server initialization fails', () => {
    const connector = new SshAppServerConnector({ host: 'dev-box' })
    const state = connector as unknown as { bootstrapped: boolean }
    state.bootstrapped = true
    connector.onAppServerInitializationFailed()
    expect(state.bootstrapped).toBe(false)
  })
})

describe('remote login commands', () => {
  it('uses the original 0.141.0 compatibility floor while accepting development builds', async () => {
    for (const version of ['0.141.0', '0.0.0']) {
      const connector = new SshAppServerConnector({ host: 'dev-box' })
      const runRemoteCommand = vi.spyOn(connector, 'runRemoteCommand')
        .mockResolvedValueOnce({ code: 0, signal: null, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ code: 0, signal: null, stdout: `codex-cli ${version}\n`, stderr: '' })
        .mockResolvedValueOnce({ code: 0, signal: null, stdout: '', stderr: '' })
      await expect((connector as unknown as { bootstrap(): Promise<void> }).bootstrap()).resolves.toBeUndefined()
      expect(runRemoteCommand).toHaveBeenCalledTimes(3)
      await connector.dispose()
    }

    const connector = new SshAppServerConnector({ host: 'dev-box' })
    vi.spyOn(connector, 'runRemoteCommand')
      .mockResolvedValueOnce({ code: 0, signal: null, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, signal: null, stdout: 'codex-cli 0.140.9\n', stderr: '' })
    await expect((connector as unknown as { bootstrap(): Promise<void> }).bootstrap()).rejects.toMatchObject({
      retryable: false,
      stage: 'remote_codex_lookup'
    })
    await connector.dispose()
  })

  it('treats a failed version probe as advisory like the original client', async () => {
    const connector = new SshAppServerConnector({ host: 'dev-box' })
    const runRemoteCommand = vi.spyOn(connector, 'runRemoteCommand')
      .mockResolvedValueOnce({ code: 0, signal: null, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 127, signal: null, stdout: '', stderr: 'probe failed' })
      .mockResolvedValueOnce({ code: 0, signal: null, stdout: '', stderr: '' })
    await expect((connector as unknown as { bootstrap(): Promise<void> }).bootstrap()).resolves.toBeUndefined()
    expect(runRemoteCommand).toHaveBeenCalledTimes(3)
    await connector.dispose()
  })

  it('strips shell startup output through the random marker and preserves command output', async () => {
    const child = new FakeChild()
    const spawnProcess = vi.fn<SshSpawn>((command, args) => {
      expect(command).toBe('ssh')
      const remoteCommand = args.at(-1) ?? ''
      const marker = /[0-9a-f]{32}/u.exec(remoteCommand)?.[0]
      expect(marker).toBeTruthy()
      queueMicrotask(() => {
        child.stdout.write(`remote shell banner\n${marker}directory\n/srv/project\n`)
        child.stderr.write('debug1: harmless transport log\n')
        child.close(0)
      })
      return child.asChild()
    })
    const connector = new SshAppServerConnector(
      { host: 'dev-box', sshAlias: 'dev-box' },
      { spawnProcess }
    )
    await expect(connector.runRemoteCommand('pwd')).resolves.toEqual({
      code: 0,
      signal: null,
      stdout: 'directory\n/srv/project\n',
      stderr: 'debug1: harmless transport log\n'
    })
    expect(spawnProcess.mock.calls[0]?.[1]).toContain('dev-box')
    await connector.dispose()
  })

  it('cancels the child when its AbortSignal is already aborted', async () => {
    const child = new FakeChild()
    const connector = new SshAppServerConnector(
      { host: 'dev-box' },
      { spawnProcess: () => child.asChild() }
    )
    await expect(connector.runRemoteCommand('pwd', { signal: AbortSignal.abort() })).rejects.toThrow('canceled')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await connector.dispose()
  })
})

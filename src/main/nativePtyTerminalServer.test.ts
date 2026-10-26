import type { IPty } from 'node-pty'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { JsonMap, RpcNotification } from '../shared/api'
import { NativePtyTerminalServer } from './nativePtyTerminalServer'

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => { throw new Error('Unexpected default PTY spawn') })
}))

class FakePty {
  readonly pid = 42
  readonly process = '/bin/zsh'
  readonly cols = 80
  readonly rows = 24
  handleFlowControl = false
  readonly writes: Array<string | Buffer> = []
  readonly resizes: Array<[number, number]> = []
  readonly kills: Array<string | undefined> = []
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  readonly onData = (listener: (data: string) => void): { dispose(): void } => {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }
  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } => {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }
  write(data: string | Buffer): void { this.writes.push(data) }
  resize(cols: number, rows: number): void { this.resizes.push([cols, rows]) }
  kill(signal?: string): void { this.kills.push(signal) }
  clear(): void {}
  pause(): void {}
  resume(): void {}
  emitData(data: string): void { for (const listener of this.dataListeners) listener(data) }
  emitExit(exitCode: number): void { for (const listener of [...this.exitListeners]) listener({ exitCode }) }
}

const request = (processId = 'terminal-1'): JsonMap => ({
  command: ['/bin/zsh', '-l'],
  processId,
  tty: true,
  disableTimeout: true,
  disableOutputCap: true,
  cwd: '/synthetic/project',
  size: { cols: 80, rows: 24 },
  env: { TERM: 'xterm-256color', TERMINFO: null, TERMINFO_DIRS: null }
})

describe('native local PTY transport', () => {
  it('keeps node-pty unpacked and repairs the macOS helper before packaging', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const prepareScript = readFileSync(
      new URL('../../scripts/prepare-node-pty.cjs', import.meta.url),
      'utf8'
    )

    expect(packageJson.build.asarUnpack).toContain('node_modules/node-pty/**/*')
    expect(packageJson.build.beforePack).toBe('scripts/prepare-node-pty.cjs')
    expect(packageJson.scripts['package:mac']).toContain('npm run prepare:native')
    expect(prepareScript).toContain("chmodSync(helper, currentMode | 0o111)")
  })

  it('starts the fixed login shell with the user environment outside app-server sandboxing', async () => {
    const pty = new FakePty()
    const spawnPty = vi.fn<typeof import('node-pty').spawn>(() => pty as unknown as IPty)
    const server = new NativePtyTerminalServer(spawnPty)
    const submitted = vi.fn()
    const notifications: RpcNotification[] = []
    server.on('notification', (notification) => notifications.push(notification))
    const previousHome = process.env.HOME
    process.env.HOME = '/Users/tester'
    const pending = server.executeStandaloneCommand<{ exitCode: number | null }>(request(), {
      onSubmitted: submitted
    })

    expect(spawnPty).toHaveBeenCalledWith('/bin/zsh', ['-l'], expect.objectContaining({
      name: 'xterm-256color', cols: 80, rows: 24, cwd: '/synthetic/project',
      env: expect.objectContaining({ HOME: '/Users/tester', TERM: 'xterm-256color' })
    }))
    const environment = spawnPty.mock.calls[0][2].env!
    expect(environment).not.toHaveProperty('TERMINFO')
    expect(environment).not.toHaveProperty('TERMINFO_DIRS')
    expect(submitted).toHaveBeenCalledOnce()

    pty.emitData('提示符 % ')
    expect(notifications).toEqual([{
      method: 'command/exec/outputDelta',
      params: {
        processId: 'terminal-1', stream: 'stdout',
        deltaBase64: Buffer.from('提示符 % ').toString('base64')
      }
    }])
    await server.request('command/exec/write', {
      processId: 'terminal-1', deltaBase64: Buffer.from('pwd\r').toString('base64')
    })
    await server.request('command/exec/resize', {
      processId: 'terminal-1', size: { cols: 120, rows: 40 }
    })
    expect(pty.writes).toEqual([Buffer.from('pwd\r')])
    expect(pty.resizes).toEqual([[120, 40]])

    pty.emitExit(0)
    await expect(pending).resolves.toEqual({ exitCode: 0 })
    await expect(server.request('command/exec/terminate', { processId: 'terminal-1' })).resolves.toEqual({})
    await expect(server.request('command/exec/write', {
      processId: 'terminal-1', deltaBase64: Buffer.from('late').toString('base64')
    })).rejects.toThrow('unavailable')
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  })

  it('kills the child on cancellation and validates native-only request methods', async () => {
    const pty = new FakePty()
    const server = new NativePtyTerminalServer(() => pty as unknown as IPty)
    const cancellation = new AbortController()
    const pending = server.executeStandaloneCommand<{ exitCode: number | null }>(request(), {
      signal: cancellation.signal
    })
    cancellation.abort()
    expect(pty.kills).toEqual([undefined])
    await expect(server.request('command/exec/terminate', { processId: 'terminal-1' })).resolves.toEqual({})
    expect(pty.kills).toEqual([undefined, undefined])
    await expect(server.request('command/exec/write', {
      processId: 'terminal-1', deltaBase64: 'not-base64'
    })).rejects.toThrow('Invalid native terminal input')
    await expect(server.request('command/exec/unknown', { processId: 'terminal-1' })).rejects.toThrow('Unsupported')
    pty.emitExit(129)
    await expect(pending).resolves.toEqual({ exitCode: 129 })
  })

  it('does not spawn after an already canceled launch', async () => {
    const spawnPty = vi.fn<typeof import('node-pty').spawn>(() => new FakePty() as unknown as IPty)
    const server = new NativePtyTerminalServer(spawnPty)
    const cancellation = new AbortController()
    cancellation.abort()
    await expect(server.executeStandaloneCommand(request(), { signal: cancellation.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnPty).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promisify } from 'node:util'
import { loadMacWorkspaceApplicationIcon } from './workspaceTargetIcons'

const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, { [promisify.custom]: fixture.execute })
}))
vi.mock('node:fs/promises', () => ({
  mkdtemp: fixture.mkdtemp,
  readFile: fixture.readFile,
  rm: fixture.rm,
  stat: fixture.stat
}))

const bundle = '/Applications/Example.app'
const temporary = '/private/tmp/codex-workspace-icon-fixture'
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

beforeEach(() => {
  vi.resetAllMocks()
  fixture.execute.mockResolvedValue({ stdout: 'Example\n', stderr: '' })
  fixture.mkdtemp.mockResolvedValue(temporary)
  fixture.stat.mockResolvedValue({ isFile: () => true, size: 4096 })
  fixture.readFile.mockResolvedValue(png)
  fixture.rm.mockResolvedValue(undefined)
})

describe('macOS workspace app icon decoding', () => {
  it('resolves bundle artwork, decodes a Retina PNG, and cleans the temporary directory', async () => {
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(fixture.execute).toHaveBeenNthCalledWith(1, '/usr/bin/plutil', [
      '-extract', 'CFBundleIconFile', 'raw', '-o', '-', `${bundle}/Contents/Info.plist`
    ], { timeout: 3000, maxBuffer: 4096 })
    expect(fixture.stat).toHaveBeenCalledWith(`${bundle}/Contents/Resources/Example.icns`)
    expect(fixture.execute).toHaveBeenNthCalledWith(2, '/usr/bin/sips', [
      '-s', 'format', 'png', '-z', '32', '32', `${bundle}/Contents/Resources/Example.icns`, '--out', `${temporary}/icon.png`
    ], { timeout: 5000, maxBuffer: 4096 })
    expect(fixture.rm).toHaveBeenCalledWith(temporary, { recursive: true, force: true })
  })

  it('preserves an explicit artwork suffix', async () => {
    fixture.execute.mockResolvedValueOnce({ stdout: 'Example.png\n', stderr: '' })
    await loadMacWorkspaceApplicationIcon(bundle)
    expect(fixture.stat).toHaveBeenCalledWith(`${bundle}/Contents/Resources/Example.png`)
  })

  it.each(['../Example.icns', '/tmp/Example.icns', '.', '..', ''])('rejects a resource name outside the bundle: %s', async (name) => {
    fixture.execute.mockResolvedValueOnce({ stdout: name, stderr: '' })
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    expect(fixture.stat).not.toHaveBeenCalled()
    expect(fixture.mkdtemp).not.toHaveBeenCalled()
  })

  it('does not decode oversized or non-file artwork', async () => {
    fixture.stat.mockResolvedValueOnce({ isFile: () => true, size: 32 * 1024 * 1024 + 1 })
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    fixture.stat.mockResolvedValueOnce({ isFile: () => false, size: 4096 })
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    expect(fixture.mkdtemp).not.toHaveBeenCalled()
  })

  it('rejects invalid or oversized decoder output and still removes temporary files', async () => {
    fixture.readFile.mockResolvedValueOnce(Buffer.from('not a PNG'))
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    fixture.readFile.mockResolvedValueOnce(Buffer.concat([png, Buffer.alloc(1024 * 1024)]))
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    expect(fixture.rm).toHaveBeenCalledTimes(2)
  })

  it('falls back after a decoder error without leaving a temporary directory', async () => {
    fixture.execute.mockResolvedValueOnce({ stdout: 'Example', stderr: '' }).mockRejectedValueOnce(new Error('decode failed'))
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    expect(fixture.readFile).not.toHaveBeenCalled()
    expect(fixture.rm).toHaveBeenCalledWith(temporary, { recursive: true, force: true })
  })

  it('falls back when macOS cannot read the bundle plist', async () => {
    fixture.execute.mockRejectedValueOnce(new Error('plist unavailable'))
    expect(await loadMacWorkspaceApplicationIcon(bundle)).toBeUndefined()
    expect(fixture.mkdtemp).not.toHaveBeenCalled()
  })
})

import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWorkspaceFileSaveRequest, saveWorkspaceFile } from './workspaceFiles'

describe('workspace text save service', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'codex-editor-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  it('writes UTF-8, preserves file mode and truncates old trailing content', async () => {
    const path = join(root, 'script.sh')
    await writeFile(path, 'original long contents\n', { mode: 0o755 })
    const result = await saveWorkspaceFile({ root, path, text: '你好\r\n', expectedText: 'original long contents\n' })
    expect(result.outcome).toBe('saved')
    expect(await readFile(path, 'utf8')).toBe('你好\r\n')
    expect((await stat(path)).mode & 0o777).toBe(0o755)
    expect(result.file.sizeBytes).toBe(Buffer.byteLength('你好\r\n'))
  })
  it('supports empty documents', async () => {
    const path = join(root, 'empty.txt')
    await writeFile(path, 'remove me')
    await saveWorkspaceFile({ root, path, text: '', expectedText: 'remove me' })
    expect(await readFile(path, 'utf8')).toBe('')
  })
  it('returns the disk conflict without changing any bytes', async () => {
    const path = join(root, 'source.ts')
    await writeFile(path, 'new disk content')
    const result = await saveWorkspaceFile({ root, path, text: 'local draft', expectedText: 'old disk content' })
    expect(result).toMatchObject({ outcome: 'conflict', file: { text: 'new disk content' } })
    expect(await readFile(path, 'utf8')).toBe('new disk content')
  })
  it('rejects a symlink outside the selected workspace', async () => {
    const nested = join(root, 'nested')
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'untouched')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(nested)
    const path = join(nested, 'link.txt')
    await symlink(outside, path)
    await expect(saveWorkspaceFile({ root: nested, path, text: 'changed', expectedText: 'untouched' })).rejects.toThrow('outside')
    expect(await readFile(outside, 'utf8')).toBe('untouched')
  })
  it('rejects unsupported binary files and malformed or oversized requests', async () => {
    const path = join(root, 'binary.bin')
    await writeFile(path, Buffer.from([0, 1, 2]))
    await expect(saveWorkspaceFile({ root, path, text: '', expectedText: '' })).rejects.toThrow('Binary')
    expect(isWorkspaceFileSaveRequest({ root, path, text: 'x', expectedText: '', extra: true })).toBe(false)
    expect(isWorkspaceFileSaveRequest({ root, path, text: '\0', expectedText: '' })).toBe(false)
    expect(isWorkspaceFileSaveRequest({ root, path, text: '字'.repeat(200000), expectedText: '' })).toBe(false)
  })
})

import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { isWorkspaceSaveCopyRequest, saveWorkspaceFileCopy } from './workspaceFileActions'

const roots: string[] = []
async function root() { const path = await mkdtemp(join(tmpdir(), 'codex-save-copy-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

it('saves exact binary bytes or the unsaved editor draft to the dialog-selected destination', async () => {
  const directory = await root(); const path = join(directory, 'source'); const dest = join(directory, 'copy')
  const bytes = Buffer.from([0, 1, 255, 5]); await writeFile(path, bytes)
  expect(await saveWorkspaceFileCopy({ root: directory, path }, async () => dest)).toEqual({ path: dest })
  expect(await readFile(dest)).toEqual(bytes)
  await saveWorkspaceFileCopy({ root: directory, path, text: 'unsaved draft\n你好' }, async () => dest)
  expect(await readFile(dest, 'utf8')).toBe('unsaved draft\n你好')
  expect(await readFile(path)).toEqual(bytes)
  expect(await readdir(directory)).toEqual(expect.arrayContaining(['source', 'copy']))
  expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false)
})

it('cancels without writing and blocks stale document completion or invalid sources', async () => {
  const directory = await root(); const path = join(directory, 'source'); await writeFile(path, 'original')
  expect(await saveWorkspaceFileCopy({ root: directory, path }, async () => null)).toEqual({ path: null })
  const dest = join(directory, 'copy')
  await expect(saveWorkspaceFileCopy({ root: directory, path }, async () => dest, () => { throw new Error('reloaded') })).rejects.toThrow('reloaded')
  const outside = await root(); const secret = join(outside, 'secret'); await writeFile(secret, 'secret')
  const link = join(directory, 'outside'); await symlink(secret, link)
  const choose = vi.fn(async () => dest)
  await expect(saveWorkspaceFileCopy({ root: directory, path: link }, choose)).rejects.toThrow('outside')
  expect(choose).not.toHaveBeenCalled()
  expect(isWorkspaceSaveCopyRequest({ root: directory, path, destination: secret })).toBe(false)
  expect(await readFile(path, 'utf8')).toBe('original')
})

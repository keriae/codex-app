import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JsonMap } from '../shared/api'
import {
  MAX_WORKSPACE_DIRECTORY_ENTRIES,
  MAX_WORKSPACE_FILE_BYTES,
  readWorkspaceDirectory,
  readWorkspaceFile,
  WorkspaceRootGrants
} from './workspaceFiles'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-workspace-files-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('workspace file bridge', () => {
  it('requires roots to be granted by main-process state', () => {
    const grants = new WorkspaceRootGrants()
    grants.grant('/synthetic/workspace')

    expect(
      grants.allows({ root: '/synthetic/workspace', path: '/synthetic/workspace/src/App.tsx' })
    ).toBe(true)
    expect(
      grants.allows({ root: '/synthetic/other', path: '/synthetic/other/private.txt' })
    ).toBe(false)
  })

  it('uses fs/readDirectory, sorts folders first, and caps visible entries', async () => {
    const root = await temporaryDirectory()
    const source = join(root, 'src')
    await mkdir(source)
    const entries = [
      { fileName: 'z.ts', isDirectory: false, isFile: true },
      { fileName: 'components', isDirectory: true, isFile: false },
      ...Array.from({ length: MAX_WORKSPACE_DIRECTORY_ENTRIES }, (_, index) => ({
        fileName: `file-${index}.ts`,
        isDirectory: false,
        isFile: true
      }))
    ]
    const request = vi.fn(async (_method: string, _params?: JsonMap) => ({ entries }))

    const result = await readWorkspaceDirectory({ request }, { root, path: source })

    expect(request).toHaveBeenCalledWith('fs/readDirectory', { path: await realpath(source) })
    expect(result.entries).toHaveLength(MAX_WORKSPACE_DIRECTORY_ENTRIES)
    expect(result.entries[0]).toEqual({
      fileName: 'components',
      path: join(source, 'components'),
      isDirectory: true,
      isFile: false
    })
    expect(result.truncated).toBe(true)
  })

  it('reads a bounded UTF-8 file through fs/readFile', async () => {
    const root = await temporaryDirectory()
    const filePath = join(root, 'hello.ts')
    const contents = 'export const greeting = "hello"\n'
    await writeFile(filePath, contents)
    const request = vi.fn(async (_method: string, _params?: JsonMap) => ({
      dataBase64: Buffer.from(contents).toString('base64')
    }))

    const result = await readWorkspaceFile({ request }, { root, path: filePath })

    expect(request).toHaveBeenCalledWith('fs/readFile', { path: await realpath(filePath) })
    expect(result).toEqual({
      path: filePath,
      kind: 'text',
      mimeType: 'text/typescript',
      text: contents,
      sizeBytes: Buffer.byteLength(contents)
    })
  })

  it('returns a bounded supported image as base64 for reusable renderer previews', async () => {
    const root = await temporaryDirectory()
    const filePath = join(root, 'preview.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await writeFile(filePath, bytes)
    const request = vi.fn(async () => ({ dataBase64: bytes.toString('base64') }))

    const result = await readWorkspaceFile({ request }, { root, path: filePath })

    expect(result).toEqual({
      path: filePath,
      kind: 'image',
      mimeType: 'image/png',
      dataBase64: bytes.toString('base64'),
      sizeBytes: bytes.byteLength
    })
  })

  it('rejects binary and oversized files before asking app-server to read them', async () => {
    const root = await temporaryDirectory()
    const binaryPath = join(root, 'image.bin')
    const largePath = join(root, 'large.txt')
    await writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]))
    await writeFile(largePath, Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1, 0x61))
    const request = vi.fn(async () => ({ dataBase64: '' }))

    await expect(readWorkspaceFile({ request }, { root, path: binaryPath })).rejects.toThrow(
      'Binary files cannot be previewed'
    )
    await expect(readWorkspaceFile({ request }, { root, path: largePath })).rejects.toThrow(
      'File is too large to preview'
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a symlink that resolves outside the selected workspace', async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const outsideFile = join(outside, 'secret.txt')
    const linkedFile = join(root, 'linked-secret.txt')
    await writeFile(outsideFile, 'not available to this workspace')
    await symlink(outsideFile, linkedFile)
    const request = vi.fn(async () => ({ dataBase64: '' }))

    await expect(readWorkspaceFile({ request }, { root, path: linkedFile })).rejects.toThrow(
      'Workspace path resolves outside the selected project'
    )
    expect(request).not.toHaveBeenCalled()
  })
})

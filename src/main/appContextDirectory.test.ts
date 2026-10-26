import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateAppContextDirectory } from './appContextDirectory'

const temporaryDirectories: string[] = []
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-app-context-'))
  temporaryDirectories.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('native app context directory validation', () => {
  it('accepts an existing non-Git directory and normalizes its path', async () => {
    const directory = await fixture()
    await mkdir(join(directory, 'project'))
    await expect(validateAppContextDirectory(join(directory, 'project', '..', 'project'))).resolves.toBe(join(directory, 'project'))
  })

  it('rejects a project removed from disk before workspace lookup', async () => {
    const directory = await fixture()
    const project = join(directory, 'removed')
    await mkdir(project)
    await rm(project, { recursive: true })
    await expect(validateAppContextDirectory(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an ordinary file from a stale project catalog', async () => {
    const directory = await fixture()
    const file = join(directory, 'file')
    await writeFile(file, 'project metadata')
    await expect(validateAppContextDirectory(file)).rejects.toThrow('Working directory is not a directory')
  })

  it('preserves a valid explicit symlink directory path', async () => {
    const directory = await fixture()
    const project = join(directory, 'project')
    const selectedPath = join(directory, 'selected-project')
    await mkdir(project)
    await symlink(project, selectedPath)
    await expect(validateAppContextDirectory(selectedPath)).resolves.toBe(selectedPath)
  })
})

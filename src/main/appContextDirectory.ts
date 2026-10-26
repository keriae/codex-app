import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Context lookup cannot turn a stale catalog entry into a usable workspace. */
export async function validateAppContextDirectory(cwd: string): Promise<string> {
  const normalizedCwd = resolve(cwd)
  if (!(await stat(normalizedCwd)).isDirectory()) {
    throw new Error(`Working directory is not a directory: ${normalizedCwd}`)
  }
  return normalizedCwd
}

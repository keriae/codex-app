import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkspacePathRequest } from '../shared/api'
import { isAllowedWorkspacePathRequest } from './ipcSecurity'

const MAX_SAVED_ROOTS = 4096

function validRoot(value: unknown): value is string {
  return typeof value === 'string' && isAllowedWorkspacePathRequest({ root: value, path: value })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Main-owned selections and verified local server threads survive app restart. */
export class WorkspaceRootGrants {
  private readonly roots = new Set<string>()
  private readonly filePath: string | null

  constructor(userDataDirectory?: string) {
    this.filePath = userDataDirectory ? join(userDataDirectory, 'workspace-root-grants.json') : null
    if (!this.filePath) return
    try {
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.roots) ||
          value.roots.length > MAX_SAVED_ROOTS || Object.keys(value).some((key) => key !== 'version' && key !== 'roots')) return
      for (const root of value.roots) if (validRoot(root)) this.roots.add(root)
    } catch { /* First launch, stale or invalid files do not grant access. */ }
  }

  grant(root: string): void {
    if (!validRoot(root)) throw new Error('Cannot grant an invalid workspace root')
    this.grantMany([root])
  }

  allows(request: WorkspacePathRequest): boolean {
    return this.roots.has(request.root) && isAllowedWorkspacePathRequest(request)
  }

  /** A renderer-supplied cwd alone never reaches this grant operation. */
  async rememberThreadResult(method: string, result: unknown): Promise<void> {
    if (!['thread/start', 'thread/resume', 'thread/read', 'thread/list'].includes(method) || !isRecord(result)) return
    const records = method === 'thread/list' ? result.data : [result.thread]
    if (!Array.isArray(records)) return
    const directories = [...new Set(records.slice(0, 1000).flatMap((thread) =>
      isRecord(thread) && typeof thread.id === 'string' && thread.id.length > 0 && validRoot(thread.cwd)
        ? [thread.cwd] : []))]
    await this.rememberDirectories(directories)
  }

  /** Current public Project roots are explicit { path } entries, never metadata/nested paths. */
  async rememberProjectResult(method: string, result: unknown): Promise<void> {
    if (!['project/list', 'project/read', 'project/create'].includes(method) || !isRecord(result)) return
    const projects = method === 'project/list' ? result.data : [result.project]
    if (!Array.isArray(projects)) return
    const directories = [...new Set(projects.slice(0, 1000).flatMap((project) => {
      if (!isRecord(project) || typeof project.id !== 'string' || project.id.length === 0 ||
          project.id.length > 256 || !Array.isArray(project.roots)) return []
      return project.roots.slice(0, 100).flatMap((root) =>
        isRecord(root) && validRoot(root.path) ? [root.path] : [])
    }))].slice(0, MAX_SAVED_ROOTS)
    await this.rememberDirectories(directories)
  }

  private async rememberDirectories(directories: string[]): Promise<void> {
    const checked = await Promise.allSettled(directories.map(async (cwd) => {
      const canonical = await realpath(cwd)
      if (!validRoot(canonical) || !(await stat(canonical)).isDirectory()) return []
      return [cwd, canonical]
    }))
    this.grantMany(checked.flatMap((result) => result.status === 'fulfilled' ? result.value : []))
  }

  private grantMany(roots: string[]): void {
    const next = new Set(this.roots)
    for (const root of roots) {
      if (!validRoot(root)) continue
      if (next.size >= MAX_SAVED_ROOTS && !next.has(root)) next.delete(next.values().next().value!)
      next.add(root)
    }
    if (next.size === this.roots.size && [...next].every((root) => this.roots.has(root))) return
    if (this.filePath) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, roots: [...next] })}\n`, { mode: 0o600 })
      renameSync(temporaryPath, this.filePath)
    }
    this.roots.clear()
    for (const root of next) this.roots.add(root)
  }
}

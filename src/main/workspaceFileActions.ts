import { copyFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { WorkspaceOpenTarget, WorkspaceOpenTargetId, WorkspaceSaveCopyRequest } from '../shared/api'
import { isAllowedWorkspacePathRequest } from './ipcSecurity'
import { canonicalWorkspaceTarget, MAX_WORKSPACE_FILE_BYTES } from './workspaceFiles'

const APPLICATIONS = {
  vscode: { label: 'Visual Studio Code', paths: ['/Applications/Visual Studio Code.app'] },
  cursor: { label: 'Cursor', paths: ['/Applications/Cursor.app'] },
  zed: { label: 'Zed', paths: ['/Applications/Zed.app'] },
  windsurf: { label: 'Windsurf', paths: ['/Applications/Windsurf.app'] }
} as const

export async function workspaceTargetApplication(target: WorkspaceOpenTargetId): Promise<string | null> {
  if (target === 'finder' || target === 'terminal') return null
  if (!Object.hasOwn(APPLICATIONS, target)) throw new Error('Unsupported workspace app')
  for (const path of APPLICATIONS[target].paths) {
    try { if ((await stat(path)).isDirectory()) return path } catch { /* App is not installed. */ }
  }
  throw new Error('The selected app is no longer installed')
}

export async function listWorkspaceOpenTargets(): Promise<WorkspaceOpenTarget[]> {
  const available = await Promise.all((Object.keys(APPLICATIONS) as Array<keyof typeof APPLICATIONS>).map(async (id) => {
    try { await workspaceTargetApplication(id); return { id, label: APPLICATIONS[id].label } } catch { return null }
  }))
  return [{ id: 'terminal', label: 'Terminal' }, { id: 'finder', label: 'Finder' }, ...available.filter((item): item is NonNullable<typeof item> => item !== null)]
}

export function isWorkspaceSaveCopyRequest(value: unknown): value is WorkspaceSaveCopyRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return Object.keys(request).every((key) => ['root', 'path', 'text'].includes(key)) &&
    isAllowedWorkspacePathRequest({ root: request.root, path: request.path }) &&
    (request.text === undefined || (typeof request.text === 'string' && Buffer.byteLength(request.text) <= MAX_WORKSPACE_FILE_BYTES))
}

/** The save dialog supplies the destination; renderer input can only select the source. */
export async function saveWorkspaceFileCopy(
  request: WorkspaceSaveCopyRequest,
  choose: (defaultPath: string) => Promise<string | null>,
  assertCurrent: () => void = () => {}
): Promise<{ path: string | null }> {
  if (!isWorkspaceSaveCopyRequest(request)) throw new Error('Invalid workspace copy request')
  await canonicalWorkspaceTarget({ root: request.root, path: request.path }, 'file')
  const destination = await choose(request.path)
  assertCurrent()
  if (destination === null) return { path: null }
  const source = await canonicalWorkspaceTarget({ root: request.root, path: request.path }, 'file')
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
  try {
    // Write beside the user-selected destination and atomically replace it. This
    // preserves bytes for binary files and avoids following a destination symlink.
    if (request.text === undefined) await copyFile(source, temporary)
    else await writeFile(temporary, request.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    assertCurrent()
    await rename(temporary, destination)
    return { path: destination }
  } finally { await rm(temporary, { force: true }) }
}

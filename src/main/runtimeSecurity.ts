import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, parse, relative, resolve, sep } from 'node:path'

export const APP_PROTOCOL_SCHEME = 'app'
export const APP_PROTOCOL_HOST = '-'
export const APP_ENTRY_URL = 'app://-/index.html'

export function replicaProfileName(isPackaged: boolean): string {
  return isPackaged ? 'Codex Replica' : 'Codex Replica Development'
}

/**
 * Resolves the Electron profile directory, with an explicit absolute-path
 * override for isolated automation and demo runs.
 */
export function resolveReplicaUserDataDirectory(
  appDataDirectory: string,
  isPackaged: boolean,
  override?: string
): string {
  if (override === undefined || override === '') {
    return resolve(appDataDirectory, replicaProfileName(isPackaged))
  }

  if (override.includes('\0') || !isAbsolute(override)) {
    throw new Error('CODEX_REPLICA_USER_DATA_PATH must be an absolute path')
  }

  const directory = resolve(override)
  if (directory === parse(directory).root) {
    throw new Error('CODEX_REPLICA_USER_DATA_PATH cannot be a filesystem root')
  }

  return directory
}

/**
 * Maps the deliberately narrow app://- origin into the built renderer folder.
 * The returned path is always a descendant of rendererRoot.
 */
export function resolveRendererAssetPath(
  requestUrl: string,
  rendererRoot: string
): string | null {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }

  if (
    parsed.protocol !== `${APP_PROTOCOL_SCHEME}:` ||
    parsed.hostname !== APP_PROTOCOL_HOST ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    !parsed.pathname.startsWith('/')
  ) {
    return null
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }

  if (pathname.includes('\0') || pathname.endsWith('/')) return null

  const root = resolve(rendererRoot)
  const candidate = resolve(root, pathname.slice(1))
  const relativePath = relative(root, candidate)

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null
  }

  return candidate
}

/**
 * Resolves an existing renderer asset through the filesystem before it is
 * handed to Electron. Returning the canonical target prevents a symlink below
 * rendererRoot from being swapped into a file:// escape after the lexical URL
 * checks above.
 */
export async function resolveRendererAssetFilePath(
  requestUrl: string,
  rendererRoot: string
): Promise<string | null> {
  const candidate = resolveRendererAssetPath(requestUrl, rendererRoot)
  if (!candidate) return null

  try {
    const [root, canonicalCandidate] = await Promise.all([
      realpath(rendererRoot),
      realpath(candidate)
    ])
    const relativePath = relative(root, canonicalCandidate)
    if (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      return null
    }
    if (!(await stat(canonicalCandidate)).isFile()) return null
    return canonicalCandidate
  } catch {
    return null
  }
}

type PermissionCheckHandler = (...args: unknown[]) => boolean
type PermissionRequestHandler = (
  webContents: unknown,
  permission: unknown,
  callback: (permissionGranted: boolean) => void,
  details: unknown
) => void

export interface PermissionGuardSession {
  setPermissionCheckHandler(handler: PermissionCheckHandler): void
  setPermissionRequestHandler(handler: PermissionRequestHandler): void
}

/** Deny-by-default until a concrete renderer capability requires a reviewed exception. */
export function installPermissionDenyPolicy(targetSession: PermissionGuardSession): void {
  targetSession.setPermissionCheckHandler(() => false)
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

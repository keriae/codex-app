/** Normalize a POSIX absolute path before checking the workspace boundary. */
export function normalizeAbsoluteWorkspacePath(path: string): string | null {
  if (!path.startsWith('/') || /[\0\r\n]/.test(path)) return null
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join('/')}`
}

/** macOS ships these three root symlinks; do not infer arbitrary symlinks. */
export function workspacePathComparisonKey(path: string): string | null {
  const normalized = normalizeAbsoluteWorkspacePath(path)
  return normalized?.replace(/^\/(var|tmp|etc)(?=\/|$)/, '/private/$1') ?? null
}

function containedSuffix(root: string, path: string): string | null {
  if (path === root) return ''
  const prefix = root === '/' ? '/' : `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : null
}

/**
 * Keep the active root's spelling in every file request. The main process
 * requires lexical containment before its independent realpath check.
 */
export function resolveWorkspacePath(root: string, linkedPath: string): string | null {
  const normalizedRoot = normalizeAbsoluteWorkspacePath(root.replace(/\/+$/, '') || '/')
  if (!normalizedRoot || !linkedPath || /[\0\r\n]/.test(linkedPath)) return null
  const candidate = normalizeAbsoluteWorkspacePath(linkedPath.startsWith('/')
    ? linkedPath
    : `${normalizedRoot === '/' ? '' : normalizedRoot}/${linkedPath}`)
  if (!candidate) return null
  if (containedSuffix(normalizedRoot, candidate) !== null) return candidate

  const comparisonRoot = workspacePathComparisonKey(normalizedRoot)!
  const suffix = containedSuffix(comparisonRoot, workspacePathComparisonKey(candidate)!)
  if (suffix === null) return null
  return suffix ? `${normalizedRoot === '/' ? '' : normalizedRoot}/${suffix}` : normalizedRoot
}

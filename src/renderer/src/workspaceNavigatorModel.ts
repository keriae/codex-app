import type { WorkspaceDirectoryEntry } from '../../shared/api'

export const WORKSPACE_NAVIGATOR_DEFAULT_WIDTH = 250
export const WORKSPACE_NAVIGATOR_MIN_WIDTH = 200
export const WORKSPACE_NAVIGATOR_MAX_RATIO = 0.6
export const WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY = 'codex:workspace-directory-tree-width:v1'
export const WORKSPACE_NAVIGATOR_SECTIONS_STORAGE_KEY = 'codex:workspace-directory-tree-sections:v1'

export interface WorkspaceNavigatorSections {
  changedFilesExpanded: boolean
  allFilesExpanded: boolean
  collapsedChangedPaths: string[]
}

export const DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS: WorkspaceNavigatorSections = {
  changedFilesExpanded: true,
  allFilesExpanded: true,
  collapsedChangedPaths: []
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function workspaceNavigatorMaximumWidth(hostWidth: number): number {
  if (!Number.isFinite(hostWidth) || hostWidth <= 0) return Number.POSITIVE_INFINITY
  return Math.max(WORKSPACE_NAVIGATOR_MIN_WIDTH, hostWidth * WORKSPACE_NAVIGATOR_MAX_RATIO)
}

export function clampWorkspaceNavigatorWidth(rawWidth: number, hostWidth: number): number {
  const safeWidth = Number.isFinite(rawWidth) ? rawWidth : WORKSPACE_NAVIGATOR_DEFAULT_WIDTH
  return Math.min(
    workspaceNavigatorMaximumWidth(hostWidth),
    Math.max(WORKSPACE_NAVIGATOR_MIN_WIDTH, safeWidth)
  )
}

export function parseWorkspaceNavigatorWidth(stored: string | null, hostWidth: number): number {
  if (stored === null || stored.trim() === '') {
    return clampWorkspaceNavigatorWidth(WORKSPACE_NAVIGATOR_DEFAULT_WIDTH, hostWidth)
  }
  const parsed = Number(stored)
  return clampWorkspaceNavigatorWidth(parsed, hostWidth)
}

export function readWorkspaceNavigatorWidth(
  storage: StorageLike | null,
  hostWidth: number
): number {
  try {
    return parseWorkspaceNavigatorWidth(
      storage?.getItem(WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY) ?? null,
      hostWidth
    )
  } catch {
    return clampWorkspaceNavigatorWidth(WORKSPACE_NAVIGATOR_DEFAULT_WIDTH, hostWidth)
  }
}

export function persistWorkspaceNavigatorWidth(
  storage: StorageLike | null,
  rawWidth: number,
  hostWidth: number
): number {
  const width = clampWorkspaceNavigatorWidth(rawWidth, hostWidth)
  try {
    storage?.setItem(WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // The live resize remains usable when persistence is unavailable.
  }
  return width
}

export function parseWorkspaceNavigatorSections(stored: string | null): WorkspaceNavigatorSections {
  if (!stored) return { ...DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS }
  try {
    const value: unknown = JSON.parse(stored)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ...DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS }
    }
    const record = value as Record<string, unknown>
    return {
      changedFilesExpanded: typeof record.changedFilesExpanded === 'boolean'
        ? record.changedFilesExpanded
        : DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS.changedFilesExpanded,
      allFilesExpanded: typeof record.allFilesExpanded === 'boolean'
        ? record.allFilesExpanded
        : DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS.allFilesExpanded,
      collapsedChangedPaths: Array.isArray(record.collapsedChangedPaths)
        ? record.collapsedChangedPaths.filter((path): path is string => typeof path === 'string')
        : []
    }
  } catch {
    return { ...DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS }
  }
}

export function workspaceNavigatorSectionsStorageKey(scope?: string | null): string {
  return scope
    ? `${WORKSPACE_NAVIGATOR_SECTIONS_STORAGE_KEY}:${encodeURIComponent(scope)}`
    : WORKSPACE_NAVIGATOR_SECTIONS_STORAGE_KEY
}

export function readWorkspaceNavigatorSections(
  storage: StorageLike | null,
  scope?: string | null
): WorkspaceNavigatorSections {
  try {
    return parseWorkspaceNavigatorSections(
      storage?.getItem(workspaceNavigatorSectionsStorageKey(scope)) ?? null
    )
  } catch {
    return { ...DEFAULT_WORKSPACE_NAVIGATOR_SECTIONS }
  }
}

export function persistWorkspaceNavigatorSections(
  storage: StorageLike | null,
  sections: WorkspaceNavigatorSections,
  scope?: string | null
): WorkspaceNavigatorSections {
  const normalized = {
    changedFilesExpanded: Boolean(sections.changedFilesExpanded),
    allFilesExpanded: Boolean(sections.allFilesExpanded),
    collapsedChangedPaths: [...new Set(
      sections.collapsedChangedPaths.filter((path) => typeof path === 'string' && path.length > 0)
    )].sort()
  }
  try {
    storage?.setItem(workspaceNavigatorSectionsStorageKey(scope), JSON.stringify(normalized))
  } catch {
    // Section toggles remain usable when persistence is unavailable.
  }
  return normalized
}

export interface WorkspaceNavigatorDirectoryState {
  entries: readonly WorkspaceDirectoryEntry[]
  status?: 'loading' | 'ready' | 'error'
}

const RECURSIVE_SEARCH_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'target',
  'vendor'
])

export function isWorkspaceNavigatorRecursiveSearchExcluded(
  entry: WorkspaceDirectoryEntry
): boolean {
  return entry.isDirectory && RECURSIVE_SEARCH_EXCLUDED_DIRECTORIES.has(entry.fileName.toLocaleLowerCase())
}

/**
 * Collect matching files plus every directory required to reveal them. Large
 * generated/vendor folders remain visible when their own name matches, but
 * recursive search never walks into them.
 */
export function collectWorkspaceNavigatorSearchPaths(
  root: string,
  directories: Readonly<Record<string, WorkspaceNavigatorDirectoryState | undefined>>,
  filter: string
): Set<string> {
  const query = filter.trim().toLocaleLowerCase()
  if (!query) return new Set()

  const matches = new Set<string>()
  const visited = new Set<string>()

  const visit = (directory: string, ancestors: readonly string[]): boolean => {
    if (visited.has(directory)) return false
    visited.add(directory)
    const state = directories[directory]
    if (!state || (state.status !== undefined && state.status !== 'ready')) return false

    let branchMatches = false
    for (const entry of state.entries) {
      const selfMatches = entry.fileName.toLocaleLowerCase().includes(query)
      let descendantMatches = false
      if (entry.isDirectory && !isWorkspaceNavigatorRecursiveSearchExcluded(entry)) {
        descendantMatches = visit(entry.path, [...ancestors, directory])
      }
      if (!selfMatches && !descendantMatches) continue
      branchMatches = true
      matches.add(entry.path)
      for (const ancestor of ancestors) matches.add(ancestor)
      matches.add(directory)
    }
    return branchMatches
  }

  visit(root, [])
  return matches
}

export interface WorkspaceNavigatorChangeLike {
  id: string
  path: string
  additions: number
  deletions: number
}

export interface WorkspaceNavigatorChangedDirectoryNode<
  T extends WorkspaceNavigatorChangeLike = WorkspaceNavigatorChangeLike
> {
  kind: 'directory'
  id: string
  path: string
  name: string
  children: WorkspaceNavigatorChangedNode<T>[]
}

export interface WorkspaceNavigatorChangedFileNode<T extends WorkspaceNavigatorChangeLike> {
  kind: 'file'
  id: string
  path: string
  name: string
  change: T
}

export type WorkspaceNavigatorChangedNode<T extends WorkspaceNavigatorChangeLike = WorkspaceNavigatorChangeLike> =
  | WorkspaceNavigatorChangedDirectoryNode<T>
  | WorkspaceNavigatorChangedFileNode<T>

function relativeWorkspacePath(root: string, path: string): string {
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedPath = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalizedRoot || normalizedRoot === '/') return normalizedPath.replace(/^\/+/, '')
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath.replace(/^\/+/, '')
}

function compareChangedNodes(
  left: WorkspaceNavigatorChangedNode,
  right: WorkspaceNavigatorChangedNode
): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

/** Builds the sectioned changed-file hierarchy used by the installed app. */
export function buildWorkspaceNavigatorChangedTree<T extends WorkspaceNavigatorChangeLike>(
  root: string,
  changes: readonly T[],
  filter = ''
): WorkspaceNavigatorChangedNode<T>[] {
  const query = filter.trim().toLocaleLowerCase()
  const rootNodes: WorkspaceNavigatorChangedNode<T>[] = []
  const directories = new Map<string, WorkspaceNavigatorChangedDirectoryNode<T>>()

  for (const change of changes) {
    const relativePath = relativeWorkspacePath(root, change.path)
    if (!relativePath || (query && !relativePath.toLocaleLowerCase().includes(query))) continue
    const segments = relativePath.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let parentNodes = rootNodes
    let parentPath = ''
    for (const segment of segments.slice(0, -1)) {
      const directoryPath = parentPath ? `${parentPath}/${segment}` : segment
      let directory = directories.get(directoryPath)
      if (!directory) {
        directory = {
          kind: 'directory',
          id: `directory:${directoryPath}`,
          path: directoryPath,
          name: segment,
          children: []
        }
        directories.set(directoryPath, directory)
        parentNodes.push(directory)
      }
      parentNodes = directory.children
      parentPath = directoryPath
    }

    parentNodes.push({
      kind: 'file',
      id: change.id,
      path: relativePath,
      name: segments.at(-1) || relativePath,
      change
    })
  }

  const sortNodes = (nodes: WorkspaceNavigatorChangedNode<T>[]): void => {
    nodes.sort(compareChangedNodes)
    for (const node of nodes) if (node.kind === 'directory') sortNodes(node.children)
  }
  sortNodes(rootNodes)
  return rootNodes
}

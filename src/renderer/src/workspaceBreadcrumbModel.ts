import { workspacePathName } from './workspaceFileModel'

export interface WorkspaceBreadcrumbSegment {
  label: string
  path: string
  directoryPath: string | null
  activePath: string | null
  expandActivePath: boolean
}

// The installed fileSource breadcrumb uses the containing directory as the
// menu root, with the clicked ancestor selected and expanded (pEa / Qt / $t).
export function workspaceBreadcrumbSegments(root: string | null | undefined, path: string | null): WorkspaceBreadcrumbSegment[] {
  const normalizedRoot = root?.replace(/\/+$/, '') || (root ? '/' : null)
  if (!path) return normalizedRoot ? [{ label: workspacePathName(normalizedRoot), path: normalizedRoot, directoryPath: normalizedRoot, activePath: null, expandActivePath: false }] : []
  const absolutePath = path.startsWith('/') ? path : normalizedRoot ? `${normalizedRoot === '/' ? '' : normalizedRoot}/${path}` : path
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`
  if (!normalizedRoot || (absolutePath !== normalizedRoot && !absolutePath.startsWith(prefix))) {
    return absolutePath.split('/').filter(Boolean).map((label, index, parts) => ({
      label,
      path: `${absolutePath.startsWith('/') ? '/' : ''}${parts.slice(0, index + 1).join('/')}`,
      directoryPath: null,
      activePath: null,
      expandActivePath: false
    }))
  }
  const parts = absolutePath.slice(normalizedRoot.length).split('/').filter(Boolean)
  return [
    { label: workspacePathName(normalizedRoot), path: normalizedRoot, directoryPath: normalizedRoot, activePath: null, expandActivePath: false },
    ...parts.map((label, index) => {
      const parent = `${normalizedRoot === '/' ? '' : normalizedRoot}/${parts.slice(0, index).join('/')}`.replace(/\/$/, '') || '/'
      const activePath = `${parent === '/' ? '' : parent}/${label}`
      return { label, path: activePath, directoryPath: parent, activePath, expandActivePath: index < parts.length - 1 }
    })
  ]
}

// Yt/Xt gives ancestors increasing collapse priority, preserving the filename.
export function workspaceBreadcrumbCollapseCount(widths: readonly number[], available: number, gap = 4): number {
  let width = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * gap
  let hidden = 0
  while (hidden < widths.length - 1 && width > Math.max(0, available) + 0.5) {
    width -= widths[hidden] + gap
    hidden++
  }
  return hidden
}

export interface BreadcrumbTreeItem {
  path: string
  parentPath: string | null
  isDirectory: boolean
  expanded: boolean
}

export type BreadcrumbTreeAction = { type: 'focus' | 'expand' | 'collapse' | 'select'; path: string }

export function workspaceBreadcrumbTreeAction(items: readonly BreadcrumbTreeItem[], path: string, key: string): BreadcrumbTreeAction | null {
  const index = items.findIndex((item) => item.path === path)
  if (index < 0) return null
  const item = items[index]
  const focus = (target: BreadcrumbTreeItem | undefined): BreadcrumbTreeAction | null => target ? { type: 'focus', path: target.path } : null
  if (key === 'ArrowDown') return focus(items[index + 1])
  if (key === 'ArrowUp') return focus(items[index - 1])
  if (key === 'Home') return focus(items[0])
  if (key === 'End') return focus(items.at(-1))
  if (key === 'ArrowRight' && item.isDirectory) return item.expanded
    ? focus(items.find((child) => child.parentPath === path)) : { type: 'expand', path }
  if (key === 'ArrowLeft') return item.isDirectory && item.expanded
    ? { type: 'collapse', path } : focus(items.find((parent) => parent.path === item.parentPath))
  if (key === 'Enter' || key === ' ') return { type: item.isDirectory ? item.expanded ? 'collapse' : 'expand' : 'select', path }
  return null
}

import { describe, expect, it } from 'vitest'
import { resolveWorkspaceTabContextMenu } from './workspaceTabContextMenuModel'

describe('workspace tab context menu', () => {
  const documents = [{ id: 1, path: '/project/alpha.ts' }, { id: 'second', path: '/project/beta.ts' }]
  const viewport = { width: 1200, height: 900 }

  it('accepts only an existing file tab with finite pointer coordinates', () => {
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:/project/alpha.ts', x: 600, y: 20 }, documents, viewport)).toEqual({ path: '/project/alpha.ts', x: 600, y: 20 })
    for (const detail of [null, {}, { tabId: 'terminal:1', x: 1, y: 1 }, { tabId: 'file:/other/file.ts', x: 1, y: 1 },
      { tabId: 'file:/project/alpha.ts', x: Number.NaN, y: 1 }, { tabId: 'file:/project/alpha.ts', x: 1, y: Number.POSITIVE_INFINITY }]) {
      expect(resolveWorkspaceTabContextMenu(detail, documents, viewport)).toBeNull()
    }
  })

  it('resolves actual numeric and string chrome document ids instead of treating them as file paths', () => {
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:1', x: 600, y: 20 }, documents, viewport)).toEqual({ path: '/project/alpha.ts', x: 600, y: 20 })
    expect(resolveWorkspaceTabContextMenu({ tabId: 'workspace:file:1', x: 600, y: 20 }, documents, viewport)).toEqual({ path: '/project/alpha.ts', x: 600, y: 20 })
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:second', x: 600, y: 20 }, documents, viewport)).toEqual({ path: '/project/beta.ts', x: 600, y: 20 })
    expect(resolveWorkspaceTabContextMenu({ tabId: 'workspace:terminal:1', x: 600, y: 20 }, documents, viewport)).toBeNull()
  })

  it('rejects a stale tab instance after its path is closed and reopened with a new id', () => {
    const reopened = [{ id: 3, path: '/project/alpha.ts' }]
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:1', x: 600, y: 20 }, reopened, viewport)).toBeNull()
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:3', x: 600, y: 20 }, reopened, viewport)).toEqual({ path: '/project/alpha.ts', x: 600, y: 20 })
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:/project/alpha.ts', x: 600, y: 20 }, reopened, viewport)).toEqual({ path: '/project/alpha.ts', x: 600, y: 20 })
  })

  it('positions inside the logical viewport at window zoom and near every edge', () => {
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:/project/alpha.ts', x: 600, y: 60 }, documents, viewport, 1.5)).toEqual({ path: '/project/alpha.ts', x: 400, y: 40 })
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:/project/alpha.ts', x: 1199, y: 899 }, documents, viewport, 1.5)).toEqual({ path: '/project/alpha.ts', x: 596, y: 406 })
    expect(resolveWorkspaceTabContextMenu({ tabId: 'file:/project/alpha.ts', x: -20, y: -20 }, documents, { width: 180, height: 150 }, 1.5)).toEqual({ path: '/project/alpha.ts', x: 4, y: 4 })
  })
})

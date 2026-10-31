import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { isAllowedWorkspacePathRequest } from '../../main/ipcSecurity'
import type { ThreadSession } from './state/sessionReducer'
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer'
import { resolveWorkspaceDiffLink } from './workspaceDiffLinks'
import { WorkspaceDocuments } from './workspaceDocuments'
import { collectWorkspacePaneSnapshot, workspaceChangesMatch } from './workspacePaneModel'

const root = '/var/folders/test/T/codex-fixture'
const canonicalRoot = `/private${root}`
const relativePath = 'lib/deep/buttons.ts'
const diff = '@@ -1 +1 @@\n-export const buttonLabels = ["Copy", "Wrap", "Files"];\n+export const buttonLabels = ["Copied", "Wrap", "Files"];\n'

describe('resumed macOS workspace changes', () => {
  it('keeps a resumed canonical file change selectable and its diff available for rendering and preview', async () => {
    const change = { path: `${canonicalRoot}/${relativePath}`, kind: { type: 'update' as const, move_path: null }, diff }
    const session: ThreadSession = { activeTurnId: null, running: false, error: null,
      turns: [{ id: 'turn', status: 'completed', items: [{ id: 'edit', type: 'fileChange', status: 'completed', changes: [change] }] }] }
    const snapshot = collectWorkspacePaneSnapshot(session, root)
    expect(snapshot.changes).toHaveLength(1)
    const selected = snapshot.changes[0]
    expect(selected).toMatchObject({ path: `${root}/${relativePath}`, sourcePath: `${root}/${relativePath}`, additions: 1, deletions: 1, diff })

    const linked = resolveWorkspaceDiffLink(root, { itemId: 'edit', change })!
    expect(linked).toMatchObject({ path: selected.path, sourcePath: selected.sourcePath, additions: 1, deletions: 1, diff })
    expect(workspaceChangesMatch(root, selected, linked)).toBe(true)
    const refreshed = collectWorkspacePaneSnapshot(session, canonicalRoot).changes[0]
    expect(workspaceChangesMatch(root, selected, refreshed)).toBe(true)

    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change: selected, cwd: root, onOpenFile: () => {} }))
    expect(html).toContain('data-diff-mode="auto"')
    expect(html).toContain('data-workspace-diff-glyph="auto"')
    expect(html).toContain('Copied')
    expect(html).not.toContain('没有可显示的文本差异')

    const readWorkspaceFile = vi.fn(async (nativeRoot: string, path: string) => {
      expect(isAllowedWorkspacePathRequest({ root: nativeRoot, path })).toBe(true)
      return { path, kind: 'text' as const, text: 'export const buttonLabels = ["Copied", "Wrap", "Files"];', mimeType: 'text/typescript', sizeBytes: 61 }
    })
    const store = new WorkspaceDocuments(root, { readWorkspaceFile, saveWorkspaceFile: vi.fn() })
    await store.open(linked.path)
    expect(readWorkspaceFile).toHaveBeenCalledWith(root, `${root}/${relativePath}`)
    expect(store.getSnapshot().activePath).toBe(selected.path)
    expect(store.find(selected.path)?.status).toBe('ready')
  })

  it('resolves moved paths on either side without accepting an outside-workspace move', () => {
    expect(resolveWorkspaceDiffLink(root, { itemId: 'edit', change: {
      path: `${canonicalRoot}/old.ts`, kind: { type: 'update', move_path: `${root}/new.ts` }, diff
    } })).toMatchObject({ sourcePath: `${root}/old.ts`, path: `${root}/new.ts`, kind: 'moved' })
    expect(resolveWorkspaceDiffLink(root, { itemId: 'edit', change: {
      path: `${canonicalRoot}/old.ts`, kind: { type: 'update', move_path: `${canonicalRoot}/../outside.ts` }, diff
    } })).toBeNull()
    expect(resolveWorkspaceDiffLink(root, { itemId: 'edit', change: {
      path: `${canonicalRoot}/../outside.ts`, kind: { type: 'update', move_path: `${root}/new.ts` }, diff
    } })).toBeNull()
  })
})

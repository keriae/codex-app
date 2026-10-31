import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './unifiedDiff'
import { parseWorkspaceDiffPreferences, splitWorkspaceDiffLines, workspaceDiffSeparatorLabels } from './workspaceDiffModel'
import { resolveWorkspaceDiffLink } from './workspaceDiffLinks'
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer'
import { collectWorkspacePaneSnapshot, workspaceChangesMatch } from './workspacePaneModel'
import type { ThreadSession } from './state/sessionReducer'

describe('workspace diff review', () => {
  it('aligns unequal replacement blocks without carrying lines across hunks', () => {
    const diff = parseUnifiedDiff('@@ -3,3 +3,2 @@\n-old1\n-old2\n+new1\n same\n@@ -20 +19 @@\n-finalOld\n+finalNew')
    const rows = splitWorkspaceDiffLines(diff.lines)
    expect(rows.map((row) => [row.before?.content ?? null, row.after?.content ?? null])).toEqual([
      ['@@ -3,3 +3,2 @@', null], ['old1', 'new1'], ['old2', null], ['same', 'same'],
      ['@@ -20 +19 @@', null], ['finalOld', 'finalNew']
    ])
    expect(rows[4].kind).toBe('separator')
    expect(rows[5].before?.oldLineNumber).toBe(20)
    expect(rows[5].after?.newLineNumber).toBe(19)
  })
  it('keeps add-only and delete-only blocks on their correct sides', () => {
    const rows = splitWorkspaceDiffLines(parseUnifiedDiff('+added\n same\n-removed').lines)
    expect(rows.map((r) => [r.before?.content ?? null, r.after?.content ?? null])).toEqual([
      [null, 'added'], ['same', 'same'], ['removed', null]
    ])
  })
  it('labels untouched source ranges between hunks like the native review surface', () => {
    const diff = parseUnifiedDiff([
      '@@ -237,4 +237,4 @@',
      ' context',
      '-before',
      '+after',
      ' context',
      ' context',
      '@@ -941,4 +941,4 @@',
      ' context',
      '-before',
      '+after',
      ' context',
      ' context',
      '@@ -945 +945 @@',
      '-adjacent',
      '+replacement'
    ].join('\n'))
    const hunks = diff.lines.filter((line) => line.kind === 'hunk')
    const labels = workspaceDiffSeparatorLabels(diff.lines)

    expect(hunks).toHaveLength(3)
    expect(labels.get(hunks[0])).toBe('236 unmodified lines')
    expect(labels.get(hunks[1])).toBe('700 unmodified lines')
    expect(labels.get(hunks[2])).toBe('@@ -945 +945 @@')
  })
  it('uses singular copy when exactly one source line precedes the first hunk', () => {
    const diff = parseUnifiedDiff('@@ -2 +2 @@\n-old\n+new')
    const hunk = diff.lines.find((line) => line.kind === 'hunk')!

    expect(workspaceDiffSeparatorLabels(diff.lines).get(hunk)).toBe('1 unmodified line')
  })
  it('accepts a deleted file patch without reading its missing current path', () => {
    const change = resolveWorkspaceDiffLink('/project', { itemId: 'edit1', change: {
      path: 'old.ts', kind: { type: 'delete' }, diff: '@@ -1 +0,0 @@\n-const lost = true'
    } })!
    expect(change.path).toBe('/project/old.ts')
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project', onOpenFile: () => {} }))
    expect(html).toContain('const</span>')
    expect(html).toContain('data-kind="deletion"')
    expect(html).toContain('aria-label="“变更”选项" aria-haspopup="menu"')
    for (const label of ['加载完整文件', '渲染预览', '词级差异', '隐藏空白字符', '隐藏导入内容', '复制 git apply 命令']) expect(html).toContain(label)
    expect(html).not.toContain('在文件中搜索')
    expect(html).not.toContain('复制绝对路径')
    expect(html).not.toContain('复制仓库相对路径')
    expect(html).not.toContain('lucide-file-code-2')
    expect(html).toContain('aria-label="刷新"')
    expect(html).toContain('aria-label="自动换行"')
    expect(html).toContain('aria-label="折叠全部差异"')
    expect(html).toContain('aria-label="自动差异视图：改用统一差异视图"')
    expect(html).not.toContain('aria-label="复制路径"')
    expect(html).not.toContain('aria-label="文件预览选项"')
    expect(html).not.toContain('无法打开文件')
  })
  it('resolves moved files inside the selected project and rejects escaping paths', () => {
    const link = { itemId: 'move', change: { path: 'a.ts', kind: { type: 'update', move_path: 'folder/b.ts' }, diff: '-old\n+new' } }
    expect(resolveWorkspaceDiffLink('/project', link)).toMatchObject({ kind: 'moved', sourcePath: '/project/a.ts', path: '/project/folder/b.ts' })
    expect(resolveWorkspaceDiffLink('/project', { ...link, change: { ...link.change, path: '../outside.ts' } })).toBeNull()
    expect(resolveWorkspaceDiffLink('/project', { ...link, change: { ...link.change, kind: { type: 'update', move_path: 5 } } })).toBeNull()
    expect(resolveWorkspaceDiffLink('/project', { ...link, change: { ...link.change, diff: null } })).toBeNull()
    expect(resolveWorkspaceDiffLink('/project', {itemId: 'ordinary', change: {
      path: 'a.ts', kind: {type: 'update'}, diff: '-old\n+new'
    }})).toMatchObject({kind: 'modified', path: '/project/a.ts'})
  })
  it('ignores invalid saved diff options', () => {
    expect(parseWorkspaceDiffPreferences('{')).toMatchObject({ style: 'auto', wrap: false })
    expect(parseWorkspaceDiffPreferences('{"style":"split","wrap":true}')).toMatchObject({ style: 'split', wrap: true })
    expect(parseWorkspaceDiffPreferences('{"style":"unknown","wrap":"yes"}')).toMatchObject({ style: 'auto', wrap: false })
  })

  it('matches a clicked relative patch to its catalog row and follows the same item stream', () => {
    const selected = resolveWorkspaceDiffLink('/project', { itemId: 'edit1', change: {
      path: './src/../file.ts', kind: { type: 'update', move_path: null }, diff: '-old\n+first'
    } })!
    const session: ThreadSession = { activeTurnId: 'turn1', running: true, error: null, turns: [{
      id: 'turn1', status: 'inProgress', items: [{ id: 'edit1', type: 'fileChange', status: 'inProgress', changes: [{
        path: 'file.ts', kind: { type: 'update', move_path: null }, diff: '-old\n+streamed\n+more'
      }] }]
    }] }
    const snapshot = collectWorkspacePaneSnapshot(session, '/project')
    const current = snapshot.changes.find((change) => workspaceChangesMatch('/project', selected, change))!
    expect(current.path).toBe('/project/file.ts')
    expect(current.itemId).toBe('edit1')
    expect(current.diff).toContain('+streamed')
    expect(current.additions).toBe(2)
    expect(current.status).toBe('inProgress')
  })

  it('keeps a historical item separate when a later tool edits the same path', () => {
    const selected = resolveWorkspaceDiffLink('/project', { itemId: 'old-edit', change: {
      path: 'file.ts', kind: { type: 'delete' }, diff: '-old'
    } })!
    const later = { ...selected, id: 'turn2:new-edit:/project/file.ts', turnId: 'turn2', itemId: 'new-edit', diff: '+new' }
    expect(workspaceChangesMatch('/project', selected, later)).toBe(false)
    expect(workspaceChangesMatch('/project', { ...selected, turnId: 'turn1' }, { ...later, itemId: 'old-edit' })).toBe(false)
  })

  it('normalizes mixed catalog path spellings into one current row', () => {
    const session: ThreadSession = { activeTurnId: null, running: false, error: null, turns: [{
      id: 'turn1', status: 'completed', items: [
        { id: 'first', type: 'fileChange', changes: [{ path: './folder/../file.ts', kind: { type: 'add' }, diff: '+first' }] },
        { id: 'second', type: 'fileChange', changes: [{ path: '/project/file.ts', kind: { type: 'update', move_path: null }, diff: '-first\n+second' }] }
      ]
    }] }
    const snapshot = collectWorkspacePaneSnapshot(session, '/project')
    expect(snapshot.changes).toHaveLength(1)
    expect(snapshot.changes[0].itemId).toBe('second')
  })

  it('retains moved-source identity and event patch statistics without requiring a disk read', () => {
    const selected = resolveWorkspaceDiffLink('/project', { itemId: 'move1', change: {
      path: 'old.ts', kind: { type: 'update', move_path: './new.ts' }, diff: '-one\n-two\n+new'
    } })!
    expect(selected).toMatchObject({ additions: 1, deletions: 2 })
    const current = { ...selected, id: 'turn1:move1:new.ts', turnId: 'turn1', path: 'new.ts', sourcePath: './old.ts' }
    expect(workspaceChangesMatch('/project', selected, current)).toBe(true)
    expect(workspaceChangesMatch('/project', selected, { ...current, sourcePath: 'different.ts' })).toBe(false)
  })
})

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer'
import { beginEditingDiffComment, diffCommentLineAt, saveDiffCommentDraft, selectDiffCommentLine,
  type DiffCommentAttachment, type DiffCommentDraft, type DiffCommentLine } from './diffComments'
import { parseUnifiedDiff } from './unifiedDiff'
import type { WorkspaceChangeEntry } from './workspacePaneModel'
import { buildTurnInput } from './composerAttachments'

// Execute the actual viewer handlers with synthetic React bindings. This covers
// callback effects, not browser focus, painting or pointer dispatch.
const source = ts.createSourceFile('WorkspaceDiffViewer.tsx', readFileSync(new URL('./WorkspaceDiffViewer.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers = new Map<string, string>()
function collect(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
    ['selectLine', 'saveComment', 'deleteComment'].includes(node.name.text)) handlers.set(node.name.text, node.initializer.getText(source))
  ts.forEachChild(node, collect)
}
collect(source)
if (handlers.size !== 3) throw new Error('Workspace diff comment handlers not found')
const compiled = ts.transpileModule([...handlers].map(([name, text]) => `const ${name} = ${text};`).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const patch = '@@ -4,2 +4,2 @@\n-old\n+new\n same'
const change: WorkspaceChangeEntry = { id: 'change', turnId: 'turn', path: '/project/file.ts', sourcePath: '/project/file.ts',
  diff: patch, kind: 'modified', status: 'completed', additions: 1, deletions: 1 }
const comment = (id: string, side: 'left' | 'right' = 'right', path = 'file.ts'): DiffCommentAttachment => ({
  id, type: 'comment', position: { path, side, line: 4 }, content: [{ content_type: 'text', text: id }], localWorkspaceRoot: '/project'
})

function fixture(initial: DiffCommentAttachment[] = [], readonly = false, patchText = patch) {
  let comments = initial
  let draft: DiffCommentDraft | null = null
  const diff = parseUnifiedDiff(patchText)
  const onCommentsChange = vi.fn((next: DiffCommentAttachment[]) => { comments = next })
  const setCommentDraft = vi.fn((update: DiffCommentDraft | null | ((previous: DiffCommentDraft | null) => DiffCommentDraft | null)) => {
    draft = typeof update === 'function' ? update(draft) : update
  })
  const render = () => {
    const bindings = { onCommentsChange: readonly ? undefined : onCommentsChange, setCommentDraft, commentDraft: draft,
      comments, diff, sourceLines: diff.lines, path: 'file.ts', cwd: '/project', saveDiffCommentDraft, selectDiffCommentLine }
    return new Function(...Object.keys(bindings), `${compiled}\nreturn {selectLine,saveComment,deleteComment}`)(...Object.values(bindings)) as {
      selectLine(line: DiffCommentLine, extend: boolean): void; saveComment(): void; deleteComment(id: string): void
    }
  }
  return { render, diff, getDraft: () => draft, getComments: () => comments, onCommentsChange, setCommentDraft,
    text: (text: string) => { draft = draft ? { ...draft, text } : null }, edit: (item: DiffCommentAttachment) => { draft = beginEditingDiffComment(item, diff.lines) } }
}

describe('workspace diff comment handlers', () => {
  it('saves a reversed Shift selection on the deletion side and submits the captured hunk', () => {
    const state = fixture([comment('other', 'right', 'other.ts')])
    state.render().selectLine(diffCommentLineAt(state.diff.lines, 'left', 5)!, false)
    state.render().selectLine(diffCommentLineAt(state.diff.lines, 'left', 4)!, true)
    state.text('Review removed code')
    state.render().saveComment()
    expect(state.onCommentsChange).toHaveBeenCalledTimes(1)
    expect(state.getDraft()).toBeNull()
    const saved = state.getComments()[1]
    expect(saved.position).toEqual({ path: 'file.ts', side: 'left', line: 5, start_line: 4 })
    expect(saved.localDiffHunk).toBe(patch)
    expect(state.getComments()[0].id).toBe('other')
    expect(buildTurnInput('', [], [saved])[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Side: L\nLines: 4-5\nDiff hunk:') })
  })

  it('rejects blank submissions without emitting callbacks or discarding the draft', () => {
    const state = fixture()
    state.render().selectLine(diffCommentLineAt(state.diff.lines, 'right', 4)!, false)
    state.text('  ')
    state.render().saveComment()
    expect(state.onCommentsChange).not.toHaveBeenCalled()
    expect(state.getDraft()?.text).toBe('  ')
  })

  it('edits text under the same id and deletes only that attachment', () => {
    const state = fixture([comment('first'), comment('second', 'left')])
    state.edit(state.getComments()[0]); state.text('Updated comment'); state.render().saveComment()
    expect(state.getComments().map((item) => item.id)).toEqual(['first', 'second'])
    expect(state.getComments()[0].content[0].text).toBe('Updated comment')
    state.edit(state.getComments()[0]); state.render().deleteComment('first')
    expect(state.getDraft()).toBeNull()
    expect(state.getComments().map((item) => item.id)).toEqual(['second'])
  })

  it('performs no comment mutations when the parent supplies no writable callback', () => {
    const state = fixture([comment('first')], true)
    state.render().selectLine(diffCommentLineAt(state.diff.lines, 'right', 4)!, false)
    state.render().saveComment(); state.render().deleteComment('first')
    expect(state.setCommentDraft).not.toHaveBeenCalled()
    expect(state.onCommentsChange).not.toHaveBeenCalled()
    expect(state.getComments()).toHaveLength(1)
  })
})

describe('workspace diff comment surface', () => {
  it.each([
    { anchor: 'left' as const, end: 'right' as const, location: 'L259-R260' },
    { anchor: 'right' as const, end: 'left' as const, location: 'R259-L260' }
  ])('renders the saved $location selection without adding a duplicate endpoint side', ({ anchor, end, location }) => {
    const mixedPatch = '@@ -259,2 +259,2 @@\n-before\n+after\n same'
    const state = fixture([], false, mixedPatch)
    state.render().selectLine(diffCommentLineAt(state.diff.lines, anchor, 259)!, false)
    state.render().selectLine(diffCommentLineAt(state.diff.lines, end, 260)!, true)
    state.text('Review both sides')
    state.render().saveComment()
    expect(state.onCommentsChange).toHaveBeenCalledOnce()
    expect(state.getComments()[0].position).toMatchObject({ side: end, line: 260, start_side: anchor, start_line: 259 })
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change: { ...change, diff: mixedPatch },
      cwd: '/project', onOpenFile: () => {}, comments: state.getComments(), onCommentsChange: () => {} }))
    expect(html).toContain(`<strong>你</strong><span>${location}</span>`)
    expect(html).toContain(`aria-label="第 ${location} 行的评论"`)
    expect(html).not.toContain(`aria-label="第 ${end} ${location} 行的评论"`)
  })

  it.each([
    { side: 'left' as const, line: 4, start_line: undefined, location: 'L4', accessible: '左侧 4' },
    { side: 'right' as const, line: 4, start_line: undefined, location: 'R4', accessible: '右侧 4' },
    { side: 'left' as const, line: 5, start_line: 4, location: 'L4-5', accessible: '左侧 4-5' },
    { side: 'right' as const, line: 5, start_line: 4, location: 'R4-5', accessible: '右侧 4-5' }
  ])('preserves the single-side $location visible and accessible location', ({ side, line, start_line, location, accessible }) => {
    const saved = comment('single-side', side)
    saved.position = { ...saved.position, line, ...(start_line == null ? {} : { start_line }) }
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project',
      onOpenFile: () => {}, comments: [saved] }))
    expect(html).toContain(`<strong>你</strong><span>${location}</span>`)
    expect(html).toContain(`aria-label="第 ${accessible} 行的评论"`)
  })

  it('exposes only valid left and right line-number actions when writable', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project', onOpenFile: () => {},
      onCommentsChange: () => {}, comments: [comment('visible'), comment('different-file', 'right', 'different.ts')] }))
    expect(html).toContain('aria-label="在左侧第 4 行添加评论"')
    expect(html).toContain('aria-label="在右侧第 4 行添加评论"')
    expect(html).not.toContain('data-comment-line="0"')
    expect(html).toContain('aria-label="编辑评论"')
    expect(html).toContain('<p>visible</p>')
    expect(html).not.toContain('<p>different-file</p>')
  })

  it('renders existing comments without exposing inactive edit or add actions', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project', onOpenFile: () => {},
      comments: [comment('saved')] }))
    expect(html).toContain('<p>saved</p>')
    expect(html).not.toContain('添加评论')
    expect(html).not.toContain('aria-label="编辑评论"')
  })

  it('keeps multiple comments on missing patch lines reachable without duplicate rendering', () => {
    const missing = [comment('first'), comment('second')].map((item) => ({ ...item, position: { ...item.position, line: 70 } }))
    const html = renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project', onOpenFile: () => {},
      comments: missing, onCommentsChange: () => {} }))
    expect(html).toContain('隐藏或已更改行上的评论')
    expect(html.match(/<p>first<\/p>/g)).toHaveLength(1)
    expect(html.match(/<p>second<\/p>/g)).toHaveLength(1)
  })
})

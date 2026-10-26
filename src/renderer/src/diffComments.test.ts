import { describe, expect, it } from 'vitest'
import { beginEditingDiffComment, createDiffComment, diffCommentLineAt, diffCommentMatchesFile, diffCommentText,
  formatDiffCommentLines, isDiffCommentLineSelected, localDiffHunkForRange, normalizeDiffCommentRange,
  saveDiffCommentDraft, selectDiffCommentLine, serializeDiffComment, type DiffCommentAttachment } from './diffComments'
import { parseUnifiedDiff } from './unifiedDiff'
import { buildTurnInput } from './composerAttachments'

const patch = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,3 +10,3 @@\n first\n-old\n+new\n last\n@@ -30 +30 @@\n-before\n+after'
const lines = parseUnifiedDiff(patch).lines
const point = (side: 'left' | 'right', number: number) => diffCommentLineAt(lines, side, number)!
const comment = (options: Partial<DiffCommentAttachment> = {}): DiffCommentAttachment => ({
  id: 'comment-1', type: 'comment', position: { path: 'src/a.ts', side: 'right', line: 12, start_line: 10 },
  content: [{ content_type: 'text', text: 'Handle the empty case.' }], localWorkspaceRoot: '/project', ...options
})

describe('local diff comment selection and editing', () => {
  it('normalizes reversed deletion-side Shift ranges and preserves the original anchor', () => {
    const initial = selectDiffCommentLine(null, point('left', 12), false, lines)
    const range = selectDiffCommentLine({ ...initial, text: 'Review deletions' }, point('left', 10), true, lines)
    expect(range.anchor.line).toBe(12)
    expect(range.range).toEqual({ start: point('left', 10), end: point('left', 12) })
    expect(range.text).toBe('Review deletions')
    const saved = saveDiffCommentDraft({ draft: range, comments: [], path: 'src/a.ts', workspaceRoot: '/project', lines })!
    expect(saved[0].position).toEqual({ path: 'src/a.ts', side: 'left', line: 12, start_line: 10 })
    expect(saved[0].localDiffHunk).toBe('@@ -10,3 +10,3 @@\n first\n-old\n+new\n last')
  })

  it('uses patch order for mixed-side ranges rather than comparing left and right numbers', () => {
    const anchor = { side: 'right' as const, line: 4, index: 8 }
    const target = { side: 'left' as const, line: 70, index: 4 }
    const range = normalizeDiffCommentRange(anchor, target)
    const saved = createDiffComment({ path: 'a.ts', range, text: 'Both sides', id: 'mixed' })!
    expect(saved.position).toEqual({ path: 'a.ts', side: 'right', line: 4, start_line: 70, start_side: 'left' })
    expect(formatDiffCommentLines(saved)).toBe('L70-R4')
    expect(isDiffCommentLineSelected({ side: 'left', line: 72, index: 7 }, range)).toBe(true)
    expect(isDiffCommentLineSelected({ side: 'left', line: 73, index: 9 }, range)).toBe(false)
  })

  it('retains both actual hunks for a range crossing hunk boundaries', () => {
    const range = normalizeDiffCommentRange(point('right', 11), point('right', 30))
    expect(localDiffHunkForRange(lines, range)).toBe(patch.slice(patch.indexOf('@@')))
    expect(localDiffHunkForRange([], range)).toBe('')
  })

  it('uses headerless patch lines and preserves no-newline metadata', () => {
    const headerless = parseUnifiedDiff('--- a/a.ts\n+++ b/a.ts\n-old\n+new\n\\ No newline at end of file').lines
    const target = diffCommentLineAt(headerless, 'right', 1)!
    expect(localDiffHunkForRange(headerless, { start: target, end: target })).toBe('-old\n+new\n\\ No newline at end of file')
  })

  it('captures the hunk at selection time even when the streaming patch later changes', () => {
    const draft = { ...selectDiffCommentLine(null, point('right', 11), false, lines), text: 'About this code' }
    const newerLines = parseUnifiedDiff('@@ -1 +1 @@\n-other\n+unrelated').lines
    const saved = saveDiffCommentDraft({ draft, comments: [], path: 'src/a.ts', lines: newerLines })!
    expect(saved[0].position.line).toBe(11)
    expect(saved[0].localDiffHunk).toContain('-old\n+new')
    expect(saved[0].localDiffHunk).not.toContain('unrelated')
  })

  it('reanchors Shift selection to a current line when the old anchor disappeared during streaming', () => {
    const draft = { ...selectDiffCommentLine(null, point('right', 11), false, lines), text: 'Keep my draft' }
    const currentLines = parseUnifiedDiff('@@ -1 +1 @@\n-other\n+current').lines
    const current = diffCommentLineAt(currentLines, 'right', 1)!
    const selected = selectDiffCommentLine(draft, current, true, currentLines)
    expect(selected.range).toEqual({ start: current, end: current })
    expect(selected.text).toBe('Keep my draft')
    expect(selected.localDiffHunk).toContain('+current')
  })

  it('edits only the text while preserving identity, position and original hunk', () => {
    const original = comment({ localDiffHunk: '@@ original hunk' })
    const unrelated = comment({ id: 'other-file', position: { path: 'b.ts', side: 'left', line: 3 } })
    const draft = beginEditingDiffComment(original, lines)!
    const next = saveDiffCommentDraft({ draft: { ...draft, text: 'Updated\nbody' }, comments: [original, unrelated],
      path: 'src/a.ts', workspaceRoot: '/different-root', lines: [] })!
    expect(next[0]).toEqual({ ...original, content: [{ content_type: 'text', text: 'Updated\nbody' }] })
    expect(next[1]).toBe(unrelated)
  })

  it('keeps comments editable when their source lines disappear and rejects empty saves', () => {
    const original = comment()
    const draft = beginEditingDiffComment(original, [])!
    expect(draft.range.end).toMatchObject({ side: 'right', line: 12, index: -1 })
    expect(saveDiffCommentDraft({ draft: { ...draft, text: ' ' }, comments: [original], path: 'src/a.ts', lines: [] })).toBeNull()
    expect(saveDiffCommentDraft({ draft, comments: [], path: 'src/a.ts', lines: [] })).toBeNull()
    expect(createDiffComment({ path: 'a', range: { start: point('right', 10), end: point('right', 10) }, text: '  ' })).toBeNull()
  })

  it('matches relative and absolute paths within the same workspace without leaking between roots', () => {
    const original = comment()
    expect(diffCommentMatchesFile(original, '/project/src/a.ts', '/project/')).toBe(true)
    expect(diffCommentMatchesFile(original, './src/../src/a.ts', '/project')).toBe(true)
    expect(diffCommentMatchesFile(original, 'src/a.ts', '/other-project')).toBe(false)
    expect(diffCommentMatchesFile(original, 'src/b.ts', '/project')).toBe(false)
    expect(diffCommentMatchesFile(original, '/project/src/a.ts', null)).toBe(true)
  })
})

describe('original User Comment prompt serialization', () => {
  it('matches the recovered local comment format exactly', () => {
    const original = comment({ localDiffHunk: '@@ -1 +1 @@\n-old\n+new' })
    expect(serializeDiffComment(original, 2)).toBe('\n## User Comment 2\nFile: src/a.ts\nWorkspace: /project\nSide: R\nLines: 10-12\nDiff hunk:\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\nComment:\nHandle the empty case.\n')
  })

  it('joins text parts and includes mixed-side labels while omitting absent optional context', () => {
    const mixed = comment({ position: { path: 'file.ts', side: 'right', line: 7, start_side: 'left', start_line: 9 },
      localWorkspaceRoot: undefined, localDiffHunk: '  ', content: [{ content_type: 'text', text: 'A' }, { content_type: 'text', text: 'B' }] })
    expect(serializeDiffComment(mixed, 1)).toBe('\n## User Comment 1\nFile: file.ts\nSide: L-R\nLines: L9-R7\nComment:\nAB\n')
    expect(diffCommentText(mixed)).toBe('AB')
  })

  it('adds comments to the real turn input without replacing file and image attachments', () => {
    const original = comment()
    const second = comment({ id: 'second', position: { path: 'gone.ts', side: 'left', line: 2 } })
    const input = buildTurnInput('  Fix these  ', [{ kind: 'file', name: 'reference', path: '/project/ref.md' },
      { kind: 'image', name: 'preview', path: '/project/image.png' }], [original, second])
    expect(input[0]).toEqual({ type: 'text', text: `Fix these${serializeDiffComment(original, 1)}${serializeDiffComment(second, 2)}`, text_elements: [] })
    expect(input.slice(1)).toEqual([{ type: 'mention', name: 'reference', path: '/project/ref.md' }, { type: 'localImage', path: '/project/image.png' }])
    expect(buildTurnInput(' ', [], [original])).toEqual([{ type: 'text', text: serializeDiffComment(original, 1), text_elements: [] }])
  })
})

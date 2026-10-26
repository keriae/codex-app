import { describe, expect, it } from 'vitest'
import { collapseDiffLines, parseUnifiedDiff, type ParsedDiffLine } from './unifiedDiff'

describe('parseUnifiedDiff', () => {
  it('parses metadata, multiple hunks, statistics, and old/new line numbers', () => {
    const parsed = parseUnifiedDiff(
      [
        'diff --git a/example.ts b/example.ts',
        'index 1111111..2222222 100644',
        '--- a/example.ts',
        '+++ b/example.ts',
        '@@ -2,3 +2,4 @@ export function example() {',
        ' keep',
        '-oldValue',
        '+newValue',
        '+anotherValue',
        ' tail',
        '@@ -10,2 +11 @@',
        '-removed',
        ' final',
        '\\ No newline at end of file'
      ].join('\n')
    )

    expect(parsed).toMatchObject({ additions: 2, deletions: 2, hunks: 2, isBinary: false })
    expect(parsed.lines.slice(0, 4).every((line) => line.kind === 'metadata')).toBe(true)
    expect(parsed.lines[5]).toMatchObject({
      kind: 'context',
      content: 'keep',
      oldLineNumber: 2,
      newLineNumber: 2
    })
    expect(parsed.lines[6]).toMatchObject({
      kind: 'deletion',
      oldLineNumber: 3,
      newLineNumber: null
    })
    expect(parsed.lines[7]).toMatchObject({
      kind: 'addition',
      oldLineNumber: null,
      newLineNumber: 3
    })
    expect(parsed.lines[8]).toMatchObject({ kind: 'addition', newLineNumber: 4 })
    expect(parsed.lines[11]).toMatchObject({ kind: 'deletion', oldLineNumber: 10 })
    expect(parsed.lines[12]).toMatchObject({
      kind: 'context',
      oldLineNumber: 11,
      newLineNumber: 11
    })
    expect(parsed.lines[13]).toMatchObject({ kind: 'metadata' })
  })

  it('derives useful line numbers for a headerless patch', () => {
    const parsed = parseUnifiedDiff('-old\n+new\n unchanged')

    expect(parsed).toMatchObject({ additions: 1, deletions: 1, hunks: 0 })
    expect(parsed.lines).toMatchObject([
      { kind: 'deletion', oldLineNumber: 1, newLineNumber: null },
      { kind: 'addition', oldLineNumber: null, newLineNumber: 1 },
      { kind: 'context', oldLineNumber: 2, newLineNumber: 2 }
    ])
  })

  it('normalizes CRLF and handles zero-length hunk ranges', () => {
    const parsed = parseUnifiedDiff('@@ -0,0 +1,2 @@\r\n+first\r\n+second\r\n')

    expect(parsed.additions).toBe(2)
    expect(parsed.lines[1]).toMatchObject({ kind: 'addition', newLineNumber: 1 })
    expect(parsed.lines[2]).toMatchObject({ kind: 'addition', newLineNumber: 2 })
  })

  it('recognizes binary patches without treating metadata as additions', () => {
    const parsed = parseUnifiedDiff(
      'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ'
    )

    expect(parsed).toMatchObject({ additions: 0, deletions: 0, hunks: 0, isBinary: true })
    expect(parsed.lines.every((line) => line.kind === 'metadata')).toBe(true)
  })
})

describe('collapseDiffLines', () => {
  it('keeps deterministic head and tail windows for a large diff', () => {
    const lines = Array.from({ length: 20 }, (_, index) => ({
      kind: 'context',
      raw: ` line ${index}`,
      content: `line ${index}`,
      marker: ' ',
      oldLineNumber: index + 1,
      newLineNumber: index + 1
    })) as ParsedDiffLine[]

    const collapsed = collapseDiffLines(lines, 10, 3)
    expect(collapsed.head).toHaveLength(7)
    expect(collapsed.tail.map((line) => line.content)).toEqual(['line 17', 'line 18', 'line 19'])
    expect(collapsed.omittedCount).toBe(10)
  })

  it('does not copy or truncate a short diff', () => {
    const lines: ParsedDiffLine[] = []
    const collapsed = collapseDiffLines(lines)
    expect(collapsed).toEqual({ head: lines, tail: [], omittedCount: 0 })
  })
})

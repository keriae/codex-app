import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff, type ParsedUnifiedDiff } from './unifiedDiff'
import {
  workspaceDiffPreviewMode, workspaceDiffSnapshotFromDisk, workspaceFullDiffLines,
  workspaceImportHiddenLines, type WorkspaceDiffSnapshot
} from './workspaceDiffPresentation'

const multiHunkPatch = [
  'diff --git a/sample.txt b/sample.txt',
  '--- a/sample.txt',
  '+++ b/sample.txt',
  '@@ -2 +2,2 @@', '-old', '+new', '+inserted',
  '@@ -5,2 +6 @@', '-removed', ' finish'
].join('\n')
const multiHunkBefore = 'start\nold\nmiddle\nuntouched\nremoved\nfinish\ntail\n'
const multiHunkAfter = 'start\nnew\ninserted\nmiddle\nuntouched\nfinish\ntail\n'

function importFixture(beforeImport: string, afterImport: string): { diff: ParsedUnifiedDiff; snapshot: WorkspaceDiffSnapshot } {
  return {
    diff: parseUnifiedDiff(`@@ -1,3 +1,3 @@\n // header\n-${beforeImport}\n+${afterImport}\n const value = 1;`),
    snapshot: { before: `// header\n${beforeImport}\nconst value = 1;\n`, after: `// header\n${afterImport}\nconst value = 1;\n` }
  }
}

describe('workspace full diff snapshots', () => {
  it('reverses multiple numbered hunks against exact disk content', () => {
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff(multiHunkPatch), multiHunkAfter)).toEqual({
      before: multiHunkBefore, after: multiHunkAfter
    })
  })

  it('rejects mismatched content, counts, offsets, overlapping hunks and headerless patches', () => {
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff(multiHunkPatch), multiHunkAfter.replace('new\n', 'different\n'))).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('@@ -1,2 +1 @@\n-old\n+new'), 'new\n')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('@@ -2 +1 @@\n-old\n+new'), 'new\n')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('@@ -4 +4 @@\n-old\n+new'), 'new\n')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+new'), 'new\n')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('-old\n+new'), 'new\n')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('Binary files a/image.png and b/image.png differ'), 'new\n')).toBeNull()
  })

  it.each([
    ['@@ -0,0 +1 @@\n+first', 'first\nrest\n', 'rest\n'],
    ['@@ -1,0 +2 @@\n+inserted', 'first\ninserted\nrest\n', 'first\nrest\n'],
    ['@@ -1 +0,0 @@\n-first', 'rest\n', 'first\nrest\n'],
    ['@@ -2 +1,0 @@\n-removed', 'first\nrest\n', 'first\nremoved\nrest\n'],
    ['@@ -0,0 +1 @@\n+first', 'first\n', ''],
    ['@@ -1 +0,0 @@\n-last', '', 'last\n']
  ])('reconstructs inserted or deleted empty ranges: %s', (patch, current, previous) => {
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff(patch), current)).toEqual({ before: previous, after: current })
  })

  it('preserves the disk CRLF convention when reconstructing previous content', () => {
    const patch = '@@ -2 +2 @@\r\n-old\r\n+new\r\n'
    const current = 'start\r\nnew\r\nfinish\r\n'
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff(patch), current)).toEqual({
      before: 'start\r\nold\r\nfinish\r\n', after: current
    })
  })

  it.each([
    ['@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new', 'new\n', 'old'],
    ['@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file', 'new', 'old\n'],
    ['@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file', 'new', 'old'],
    ['@@ -1,2 +1,2 @@\n-old\n+new\n tail\n\\ No newline at end of file', 'new\ntail', 'old\ntail'],
    ['@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new', 'new\r\n', 'old']
  ])('honors each side of no-newline markers: %s', (patch, current, previous) => {
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff(patch), current)).toEqual({ before: previous, after: current })
  })

  it('rejects a disk newline that contradicts an explicit new-side EOF marker', () => {
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file'), 'new\n')).toBeNull()
  })

  it('rejects a missing disk newline when the patch reaches EOF without a no-newline marker', () => {
    expect(workspaceDiffSnapshotFromDisk(parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new'), 'new')).toBeNull()
  })

  it('fills all untouched ranges and retains each original changed line object', () => {
    const diff = parseUnifiedDiff(multiHunkPatch)
    const full = workspaceFullDiffLines(diff, { before: multiHunkBefore, after: multiHunkAfter })
    expect(full.map((line) => line.raw)).toEqual([
      ' start', '-old', '+new', '+inserted', ' middle', ' untouched', '-removed', ' finish', ' tail'
    ])
    for (const line of diff.lines.filter((line) => line.kind === 'deletion' || line.kind === 'addition')) {
      expect(full.find((candidate) => candidate.raw === line.raw)).toBe(line)
    }
    expect(full[0]).toMatchObject({ oldLineNumber: 1, newLineNumber: 1 })
    expect(full[4]).toMatchObject({ oldLineNumber: 3, newLineNumber: 4 })
    expect(full.at(-1)).toMatchObject({ oldLineNumber: 7, newLineNumber: 7 })
  })

  it('retains partial lines if numbered hunks or untouched snapshot ranges cannot be reconciled', () => {
    const headerless = parseUnifiedDiff('-old\n+new')
    expect(workspaceFullDiffLines(headerless, { before: 'old\n', after: 'new\n' })).toBe(headerless.lines)
    const diff = parseUnifiedDiff(multiHunkPatch)
    expect(workspaceFullDiffLines(diff, { before: multiHunkBefore.replace('start', 'other'), after: multiHunkAfter })).toBe(diff.lines)
    expect(workspaceFullDiffLines(diff, { before: multiHunkBefore + 'extra\n', after: multiHunkAfter })).toBe(diff.lines)
  })
})

describe('workspace file preview modes', () => {
  it.each(['markdown', 'md', 'mdown', 'mdx', 'mkd'])('previews .%s only when rich preview is enabled and the file exists', (extension) => {
    expect(workspaceDiffPreviewMode(`/project/NOTES.${extension.toUpperCase()}`, false, true)).toBe('markdown')
    expect(workspaceDiffPreviewMode(`/project/notes.${extension}`, false, false)).toBe('diff')
    expect(workspaceDiffPreviewMode(`/project/notes.${extension}`, true, true)).toBe('diff')
  })

  it.each(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp'])('previews .%s bitmaps independently of rich preview and deletion', (extension) => {
    expect(workspaceDiffPreviewMode(`/project/image.${extension}`, false, false)).toBe('image')
    expect(workspaceDiffPreviewMode(`/project/image.${extension.toUpperCase()}`, true, false)).toBe('image')
  })

  it('uses the rich-preview switch for SVG and independent PDF previews', () => {
    expect(workspaceDiffPreviewMode('/project/image.svg', false, false)).toBe('diff')
    expect(workspaceDiffPreviewMode('/project/image.svg', false, true)).toBe('image')
    expect(workspaceDiffPreviewMode('/project/image.svg', true, true)).toBe('image')
    expect(workspaceDiffPreviewMode('/project/report.PDF', false, false)).toBe('pdf')
    expect(workspaceDiffPreviewMode('/project/report.pdf', true, true)).toBe('pdf')
  })

  it.each(['/project/README', 'md', 'png', 'pdf', '/project/md', '/project/png', '/project/pdf', '/project/.md', '/project/.svg', '/project/folder.md/README', 'C:\\project\\.pdf', '/project/notes.md.'])('requires a real extension on the filename: %s', (path) => {
    expect(workspaceDiffPreviewMode(path, false, true)).toBe('diff')
  })
})

describe('workspace import-only hunks', () => {
  it.each(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'])('hides the entire .%s import-only hunk, including its context and header', (extension) => {
    const { diff, snapshot } = importFixture('import oldValue from "old";', 'import newValue from "new";')
    expect(workspaceImportHiddenLines(diff, snapshot, `source.${extension}`, 'modified', []).size).toBe(diff.lines.length)
  })

  it('accepts TypeScript type imports and multiline TSX imports', () => {
    const typed = importFixture('import type { Old } from "old";', 'import type { New } from "new";')
    expect(workspaceImportHiddenLines(typed.diff, typed.snapshot, 'types.ts', 'modified', []).size).toBe(typed.diff.lines.length)
    const before = 'import {\n  Old,\n} from "old";\nconst element = <div />;\n'
    const after = 'import {\n  New,\n} from "new";\nconst element = <div />;\n'
    const diff = parseUnifiedDiff('@@ -1,4 +1,4 @@\n import {\n-  Old,\n+  New,\n } from "old";\n const element = <div />;')
    expect(workspaceImportHiddenLines(diff, { before, after }, 'source.tsx', 'modified', []).size).toBe(diff.lines.length)
  })

  it.each(['py', 'pyi'])('supports .%s Python imports and from-imports', (extension) => {
    const diff = parseUnifiedDiff('@@ -1,3 +1,3 @@\n-import old_module\n-from old_package import value\n+import new_module\n+from new_package import value\n print(value)')
    const snapshot = { before: 'import old_module\nfrom old_package import value\nprint(value)\n', after: 'import new_module\nfrom new_package import value\nprint(value)\n' }
    expect(workspaceImportHiddenLines(diff, snapshot, `source.${extension}`, 'modified', []).size).toBe(diff.lines.length)
  })

  it('keeps a hunk when a left- or right-side annotation covers a context line', () => {
    const { diff, snapshot } = importFixture('import Old from "old";', 'import New from "new";')
    for (const side of ['left', 'right'] as const) {
      expect(workspaceImportHiddenLines(diff, snapshot, 'source.js', 'modified', [{ side, line: 3 }]).size).toBe(0)
    }
    expect(workspaceImportHiddenLines(diff, snapshot, 'source.js', 'modified', [{ side: 'right', line: 4 }]).size).toBe(diff.lines.length)
  })

  it('hides import-only hunks separately and keeps a later mixed code hunk', () => {
    const diff = parseUnifiedDiff('@@ -1 +1 @@\n-import Old from "old";\n+import New from "new";\n@@ -3 +3 @@\n-const value = 1;\n+const value = 2;')
    const snapshot = { before: 'import Old from "old";\n\nconst value = 1;\n', after: 'import New from "new";\n\nconst value = 2;\n' }
    const hidden = workspaceImportHiddenLines(diff, snapshot, 'source.js', 'modified', [])
    expect([...hidden]).toEqual(expect.arrayContaining(diff.lines.slice(0, 3)))
    expect(hidden.size).toBe(3)
    for (const line of diff.lines.slice(3)) expect(hidden.has(line)).toBe(false)
    const mixed = parseUnifiedDiff('@@ -1,2 +1,2 @@\n-import Old from "old";\n-const value = 1;\n+import New from "new";\n+const value = 2;')
    expect(workspaceImportHiddenLines(mixed, { before: snapshot.before.replace('\n\n', '\n'), after: snapshot.after.replace('\n\n', '\n') }, 'source.js', 'modified', []).size).toBe(0)
  })

  it.each([
    ['import Old from "old"; const value = 1;', 'import New from "new"; const value = 2;'],
    ['const value = 1; import Old from "old";', 'const value = 2; import New from "new";'],
    ['import { Old } from "old";', 'import { from "new";']
  ])('rejects same-line code or invalid imports: %s', (beforeImport, afterImport) => {
    const { diff, snapshot } = importFixture(beforeImport, afterImport)
    expect(workspaceImportHiddenLines(diff, snapshot, 'source.js', 'modified', []).size).toBe(0)
  })

  it('permits a trailing comment and blank changed lines but retains whitespace-only hunks', () => {
    const { diff, snapshot } = importFixture('import Old from "old"; // old module', 'import New from "new"; // new module')
    expect(workspaceImportHiddenLines(diff, snapshot, 'source.js', 'modified', []).size).toBe(diff.lines.length)
    const blankDiff = parseUnifiedDiff('@@ -1,2 +1,2 @@\n-import Old from "old";\n-\n+import New from "new";\n+  ')
    expect(workspaceImportHiddenLines(blankDiff, { before: 'import Old from "old";\n\n', after: 'import New from "new";\n  \n' }, 'source.js', 'modified', []).size).toBe(blankDiff.lines.length)
    const whitespace = parseUnifiedDiff('@@ -1 +1 @@\n- \n+  ')
    expect(workspaceImportHiddenLines(whitespace, { before: ' \n', after: '  \n' }, 'source.js', 'modified', []).size).toBe(0)
  })

  it('preserves partial patches without snapshots, added/deleted files and unsupported parsers', () => {
    const { diff, snapshot } = importFixture('import Old from "old";', 'import New from "new";')
    expect(workspaceImportHiddenLines(diff, null, 'source.js', 'modified', []).size).toBe(0)
    for (const kind of ['added', 'deleted']) expect(workspaceImportHiddenLines(diff, snapshot, 'source.js', kind, []).size).toBe(0)
    for (const path of ['source.go', 'source.rs', 'Source.java', 'source.txt', 'README']) {
      expect(workspaceImportHiddenLines(diff, snapshot, path, 'modified', []).size).toBe(0)
    }
    const headerless = parseUnifiedDiff('-import Old from "old";\n+import New from "new";')
    expect(workspaceImportHiddenLines(headerless, snapshot, 'source.js', 'modified', []).size).toBe(0)
  })
})


describe('mixed line-ending snapshot boundary', () => {
  it('rejects a mixed disk file rather than rewriting untouched line terminators', () => {
    const patch = parseUnifiedDiff('@@ -2 +2 @@\n-old\n+new')
    expect(workspaceDiffSnapshotFromDisk(patch, 'start\r\nnew\nfinish\r\n')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(patch, 'start\rnew\rfinish\r')).toBeNull()
    expect(workspaceDiffSnapshotFromDisk(patch, 'start\r\nnew\r\nfinish\r\n')).toEqual({
      before: 'start\r\nold\r\nfinish\r\n', after: 'start\r\nnew\r\nfinish\r\n'
    })
  })
})

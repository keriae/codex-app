import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { pythonLanguage } from '@codemirror/lang-python'
import type { Parser } from '@lezer/common'
import type { ParsedDiffLine, ParsedUnifiedDiff } from './unifiedDiff'

export interface WorkspaceDiffSnapshot { before: string; after: string }
interface PatchHunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: ParsedDiffLine[] }
const HUNK = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/
const splitText = (text: string): string[] => {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}
const extensionOf = (path: string): string => {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function patchHunks(diff: ParsedUnifiedDiff): PatchHunk[] | null {
  const hunks: PatchHunk[] = []
  let active: PatchHunk | null = null
  for (const line of diff.lines) {
    if (line.kind === 'hunk') {
      const match = HUNK.exec(line.raw)
      if (!match) return null
      active = { oldStart: Number(match[1]), oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]), newCount: match[4] === undefined ? 1 : Number(match[4]), lines: [] }
      hunks.push(active)
    } else if (line.kind !== 'metadata') {
      if (!active) return null
      active.lines.push(line)
    }
  }
  return hunks.length ? hunks : null
}

/** Reverse only exact, numbered patch hunks. No fuzzy matching or unrelated disk mutation. */
export function workspaceDiffSnapshotFromDisk(diff: ParsedUnifiedDiff, currentText: string): WorkspaceDiffSnapshot | null {
  if (diff.isBinary) return null
  // A normalized patch cannot establish individual terminators in a mixed-ending file.
  if (/\r(?!\n)/.test(currentText) || (currentText.includes('\r\n') && currentText.replaceAll('\r\n', '').includes('\n'))) return null
  const hunks = patchHunks(diff)
  if (!hunks) return null
  const after = splitText(currentText)
  const before: string[] = []
  let cursor = 0
  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter((line) => line.kind !== 'addition').map((line) => line.content)
    const newLines = hunk.lines.filter((line) => line.kind !== 'deletion').map((line) => line.content)
    if (oldLines.length !== hunk.oldCount || newLines.length !== hunk.newCount) return null
    const newOffset = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1
    const oldOffset = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    if (newOffset < cursor || newOffset > after.length || oldOffset !== before.length + newOffset - cursor) return null
    if (newLines.some((line, index) => after[newOffset + index] !== line)) return null
    before.push(...after.slice(cursor, newOffset), ...oldLines)
    cursor = newOffset + newLines.length
  }
  before.push(...after.slice(cursor))
  // Preserve the disk newline convention; the patch's no-newline markers override each side.
  const separator = currentText.includes('\r\n') ? '\r\n' : '\n'
  let beforeNewline = currentText.endsWith('\n')
  // If the changed range reaches old EOF, its own marker determines that side's ending.
  // A new-side EOF marker must never erase the old newline.
  let oldEnd = -1, newEnd = -1
  diff.lines.forEach((line, index) => {
    if (before.length > 0 && line.oldLineNumber === before.length) oldEnd = index
    if (after.length > 0 && line.newLineNumber === after.length) newEnd = index
  })
  if (oldEnd >= 0) beforeNewline = diff.lines[oldEnd + 1]?.raw !== '\\ No newline at end of file'
  if (newEnd >= 0 && (diff.lines[newEnd + 1]?.raw === '\\ No newline at end of file') === currentText.endsWith('\n')) return null
  return { before: before.join(separator) + (before.length && beforeNewline ? separator : ''), after: currentText }
}

/** Full snapshots supply untouched source lines while preserving the original changed line objects. */
export function workspaceFullDiffLines(diff: ParsedUnifiedDiff, snapshot: WorkspaceDiffSnapshot, ignoreWhitespace = false): ParsedDiffLine[] {
  const hunks = patchHunks(diff)
  if (!hunks) return diff.lines
  const before = splitText(snapshot.before), after = splitText(snapshot.after)
  const result: ParsedDiffLine[] = []
  let oldCursor = 0, newCursor = 0
  const context = (oldEnd: number, newEnd: number): boolean => {
    if (oldEnd - oldCursor !== newEnd - newCursor) return false
    while (oldCursor < oldEnd) {
      const normalize = (value: string): string => ignoreWhitespace ? value.replace(/[ \t\r\n\f\v]/g, '') : value
      if (normalize(before[oldCursor]) !== normalize(after[newCursor])) return false
      const content = after[newCursor]
      result.push({ kind: 'context', raw: ` ${content}`, content, marker: ' ', oldLineNumber: ++oldCursor, newLineNumber: ++newCursor })
    }
    return true
  }
  for (const hunk of hunks) {
    if (!context(hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1,
      hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1)) return diff.lines
    result.push(...hunk.lines)
    oldCursor += hunk.oldCount; newCursor += hunk.newCount
  }
  if (!context(before.length, after.length)) return diff.lines
  return result
}

export type WorkspaceDiffPreviewMode = 'diff' | 'markdown' | 'image' | 'pdf'
/** app-initial ypr/bpr: bitmap previews are independent of the rich-preview setting. */
export function workspaceDiffPreviewMode(path: string, deleted: boolean, richPreview: boolean): WorkspaceDiffPreviewMode {
  const extension = extensionOf(path)
  if (richPreview && !deleted && ['markdown', 'md', 'mdown', 'mdx', 'mkd'].includes(extension ?? '')) return 'markdown'
  if (['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp'].includes(extension ?? '') || (extension === 'svg' && richPreview)) return 'image'
  return extension === 'pdf' ? 'pdf' : 'diff'
}

function importParser(path: string): { parser: Parser; node: string } | null {
  const extension = extensionOf(path)
  const language = extension === 'tsx' ? tsxLanguage : ['ts', 'mts', 'cts'].includes(extension ?? '') ? typescriptLanguage
    : extension === 'jsx' ? jsxLanguage : ['js', 'mjs', 'cjs'].includes(extension ?? '') ? javascriptLanguage
      : ['py', 'pyi'].includes(extension) ? pythonLanguage : null
  return language ? { parser: language.parser, node: ['py', 'pyi'].includes(extension) ? 'ImportStatement' : 'ImportDeclaration' } : null
}

/** Direct translation of file-diff-presentation Le/Re, with the existing JS/Python parsers. */
function importLineNumbers(text: string, parser: Parser, nodeName: string): Set<number> {
  const result = new Set<number>()
  if (text.length > 1_000_000) return result
  const lines = splitText(text)
  const starts = [0]
  const normalized = text.replace(/\r\n/g, '\n')
  for (let index = 0; index < normalized.length; index++) if (normalized[index] === '\n') starts.push(index + 1)
  const lineAt = (offset: number): number => {
    let lower = 0, upper = starts.length
    while (lower < upper) { const middle = (lower + upper) >>> 1; if (starts[middle] <= offset) lower = middle + 1; else upper = middle }
    return lower - 1
  }
  parser.parse(normalized).iterate({ enter({ node }) {
    if (node.parent?.parent != null || node.name !== nodeName) return
    const first = lineAt(node.from), last = lineAt(node.to - 1)
    let end = node.to
    for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
      const nextLine = starts[last + 1] ?? normalized.length
      if (sibling.from >= nextLine || sibling.to > nextLine || !['LineComment', 'BlockComment', 'Comment'].includes(sibling.name) ||
        normalized.slice(end, sibling.from).trim()) break
      end = sibling.to
    }
    if (lines[first]?.slice(0, node.from - starts[first]).trim() || lines[last]?.slice(end - starts[last]).trim()) return false
    let error = false
    node.toTree().iterate({ enter({ type }) { if (type.isError) error = true } })
    if (!error) for (let line = first; line <= last; line++) result.add(line + 1)
    return false
  } })
  return result
}

/** Imports hide only whole import-only hunks; any attached comment keeps its hunk. */
export function workspaceImportHiddenLines(diff: ParsedUnifiedDiff, snapshot: WorkspaceDiffSnapshot | null,
  path: string, kind: string, annotations: readonly { side: 'left' | 'right'; line: number }[]): Set<ParsedDiffLine> {
  const hidden = new Set<ParsedDiffLine>()
  const language = importParser(path)
  if (!snapshot || !language || kind === 'added' || kind === 'deleted') return hidden
  const hunks = patchHunks(diff)
  if (!hunks) return hidden
  const oldImports = importLineNumbers(snapshot.before, language.parser, language.node)
  const newImports = importLineNumbers(snapshot.after, language.parser, language.node)
  for (const hunk of hunks) {
    if (annotations.some(({ side, line }) => side === 'left'
      ? line >= hunk.oldStart && line < hunk.oldStart + hunk.oldCount
      : line >= hunk.newStart && line < hunk.newStart + hunk.newCount)) continue
    let hasImport = false, onlyImports = true
    for (const line of hunk.lines) {
      if (line.kind === 'context' || !line.content.trim()) continue
      const imported = line.kind === 'deletion' ? oldImports.has(line.oldLineNumber!) : newImports.has(line.newLineNumber!)
      if (imported) hasImport = true
      else { onlyImports = false; break }
    }
    if (hasImport && onlyImports) {
      for (const line of hunk.lines) hidden.add(line)
      const header = diff.lines.find((line) => line.kind === 'hunk' && HUNK.exec(line.raw)?.[1] === String(hunk.oldStart) &&
        HUNK.exec(line.raw)?.[3] === String(hunk.newStart))
      if (header) hidden.add(header)
    }
  }
  return hidden
}

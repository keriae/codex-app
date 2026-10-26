import type { ParsedDiffLine } from './unifiedDiff'

export type DiffCommentSide = 'left' | 'right'

/** Local comment attachment shape recovered from the installed review editor. */
export interface DiffCommentAttachment {
  id: string
  type: 'comment'
  content: readonly { content_type: 'text'; text: string }[]
  position: {
    path: string
    side: DiffCommentSide
    line: number
    start_line?: number
    start_side?: DiffCommentSide
  }
  localWorkspaceRoot?: string
  localDiffHunk?: string
}

export interface DiffCommentLine {
  side: DiffCommentSide
  line: number
  /** Index in the original parsed patch, including hunk headers. */
  index: number
}

export interface DiffCommentRange {
  start: DiffCommentLine
  end: DiffCommentLine
}

export interface DiffCommentDraft {
  anchor: DiffCommentLine
  range: DiffCommentRange
  text: string
  editingId: string | null
  localDiffHunk?: string
}

let fallbackId = 0
function newCommentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `diff-comment-${Date.now()}-${++fallbackId}`
}

export function diffCommentText(comment: DiffCommentAttachment): string {
  return comment.content.map((part) => part.text).join('')
}

export function diffCommentRange(comment: DiffCommentAttachment): {
  startSide: DiffCommentSide; startLine: number; endSide: DiffCommentSide; endLine: number
} {
  const { position } = comment
  return { startSide: position.start_side ?? position.side, startLine: position.start_line ?? position.line,
    endSide: position.side, endLine: position.line }
}

/** Matches the original Mln line-range formatter, including mixed-side ranges. */
export function formatDiffCommentLines(comment: DiffCommentAttachment): string {
  const { startSide, startLine, endSide, endLine } = diffCommentRange(comment)
  if (startSide !== endSide) return `${startSide === 'left' ? 'L' : 'R'}${startLine}-${endSide === 'left' ? 'L' : 'R'}${endLine}`
  const first = Math.min(startLine, endLine)
  const last = Math.max(startLine, endLine)
  return first === last ? String(last) : `${first}-${last}`
}

/** The original local User Comment prompt fragment starts and ends with a newline. */
export function serializeDiffComment(comment: DiffCommentAttachment, promptNumber: number): string {
  const { startSide, endSide } = diffCommentRange(comment)
  const side = startSide === endSide ? (endSide === 'left' ? 'L' : 'R')
    : `${startSide === 'left' ? 'L' : 'R'}-${endSide === 'left' ? 'L' : 'R'}`
  let result = `\n## User Comment ${promptNumber}\nFile: ${comment.position.path}\n`
  if (comment.localWorkspaceRoot != null) result += `Workspace: ${comment.localWorkspaceRoot}\n`
  result += `Side: ${side}\nLines: ${formatDiffCommentLines(comment)}\n`
  if (comment.localDiffHunk != null && comment.localDiffHunk.trim().length > 0) {
    result += `Diff hunk:\n\`\`\`diff\n${comment.localDiffHunk}\n\`\`\`\n`
  }
  return `${result}Comment:\n${diffCommentText(comment)}\n`
}

export function serializeDiffComments(comments: readonly DiffCommentAttachment[]): string {
  return comments.map((comment, index) => serializeDiffComment(comment, index + 1)).join('')
}

export function normalizeDiffCommentRange(anchor: DiffCommentLine, target: DiffCommentLine): DiffCommentRange {
  // For one side, source line numbers are authoritative even if a view reorders rows.
  const reverse = anchor.side === target.side ? anchor.line > target.line : anchor.index > target.index
  return reverse ? { start: target, end: anchor } : { start: anchor, end: target }
}

export function selectDiffCommentLine(
  draft: DiffCommentDraft | null, target: DiffCommentLine, extend: boolean, lines?: readonly ParsedDiffLine[]
): DiffCommentDraft {
  const previousAnchor = extend && draft && !draft.editingId ? draft.anchor : target
  const anchor = lines ? diffCommentLineAt(lines, previousAnchor.side, previousAnchor.line) ?? target : previousAnchor
  const range = normalizeDiffCommentRange(anchor, target)
  return { anchor, range, text: draft && !draft.editingId ? draft.text : '', editingId: null,
    ...(lines ? { localDiffHunk: localDiffHunkForRange(lines, range) } : {}) }
}

export function diffCommentLineAt(lines: readonly ParsedDiffLine[], side: DiffCommentSide, number: number): DiffCommentLine | null {
  const index = lines.findIndex((line) => (side === 'left' ? line.oldLineNumber : line.newLineNumber) === number)
  return index < 0 ? null : { side, line: number, index }
}

/** Retain the actual patch hunk(s), without reconstructing code from the current file. */
export function localDiffHunkForRange(lines: readonly ParsedDiffLine[], range: DiffCommentRange): string {
  const first = Math.min(range.start.index, range.end.index)
  const last = Math.max(range.start.index, range.end.index)
  if (first < 0 || last >= lines.length) return ''
  let start = first
  while (start > 0 && lines[start].kind !== 'hunk') start -= 1
  if (lines[start]?.kind !== 'hunk') {
    start = 0
    while (start < lines.length && lines[start].kind === 'metadata') start += 1
  }
  let end = last + 1
  while (end < lines.length && lines[end].kind !== 'hunk' &&
    !(lines[end].kind === 'metadata' && lines[end].raw.startsWith('diff --git '))) end += 1
  return lines.slice(start, end).map((line) => line.raw).join('\n')
}

export function createDiffComment(options: {
  path: string
  workspaceRoot?: string | null
  range: DiffCommentRange
  text: string
  localDiffHunk?: string
  id?: string
}): DiffCommentAttachment | null {
  if (!options.text.trim()) return null
  const { start, end } = normalizeDiffCommentRange(options.range.start, options.range.end)
  if (![start.line, end.line].every((line) => Number.isSafeInteger(line) && line > 0)) return null
  return { id: options.id ?? newCommentId(), type: 'comment', content: [{ content_type: 'text', text: options.text }],
    position: { path: options.path, side: end.side, line: end.line,
      ...(start.line !== end.line || start.side !== end.side ? { start_line: start.line } : {}),
      ...(start.side !== end.side ? { start_side: start.side } : {}) },
    ...(options.workspaceRoot != null ? { localWorkspaceRoot: options.workspaceRoot } : {}),
    ...(options.localDiffHunk != null ? { localDiffHunk: options.localDiffHunk } : {}) }
}

export function beginEditingDiffComment(comment: DiffCommentAttachment, lines: readonly ParsedDiffLine[]): DiffCommentDraft | null {
  const { startSide, startLine, endSide, endLine } = diffCommentRange(comment)
  const start = diffCommentLineAt(lines, startSide, startLine)
  const end = diffCommentLineAt(lines, endSide, endLine)
  // Stored comments remain editable after a streaming patch removes their lines.
  const anchor = start ?? { side: startSide, line: startLine, index: -1 }
  return { anchor, range: { start: anchor, end: end ?? { side: endSide, line: endLine, index: -1 } },
    text: diffCommentText(comment), editingId: comment.id, localDiffHunk: comment.localDiffHunk }
}

export function saveDiffCommentDraft(options: {
  draft: DiffCommentDraft
  comments: readonly DiffCommentAttachment[]
  path: string
  workspaceRoot?: string | null
  lines: readonly ParsedDiffLine[]
}): DiffCommentAttachment[] | null {
  const existing = options.draft.editingId ? options.comments.find((comment) => comment.id === options.draft.editingId) : undefined
  if (options.draft.editingId && !existing) return null
  if (!options.draft.text.trim()) return null
  const comment = existing
    ? { ...existing, content: [{ content_type: 'text' as const, text: options.draft.text }] }
    : createDiffComment({ path: options.path, workspaceRoot: options.workspaceRoot, range: options.draft.range,
      text: options.draft.text, localDiffHunk: options.draft.localDiffHunk ?? localDiffHunkForRange(options.lines, options.draft.range) })
  if (!comment) return null
  return existing ? options.comments.map((item) => item.id === existing.id ? comment : item) : [...options.comments, comment]
}

export function diffCommentMatchesFile(comment: DiffCommentAttachment, path: string, workspaceRoot?: string | null): boolean {
  const normalizedRoot = (root: string): string => root === '/' ? root : root.replace(/\/+$/, '')
  if (comment.localWorkspaceRoot != null && workspaceRoot != null &&
    normalizedRoot(comment.localWorkspaceRoot) !== normalizedRoot(workspaceRoot)) return false
  const normalizedPath = (value: string): string => {
    const segments: string[] = []
    for (const segment of value.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..' && segments.length && segments.at(-1) !== '..') segments.pop()
      else if (segment !== '..' || !value.startsWith('/')) segments.push(segment)
    }
    return `${value.startsWith('/') ? '/' : ''}${segments.join('/')}`
  }
  const absolute = (value: string, root?: string | null): string => normalizedPath(value.startsWith('/') || !root
    ? value : `${normalizedRoot(root)}/${value}`)
  return absolute(comment.position.path, comment.localWorkspaceRoot ?? workspaceRoot) === absolute(path, workspaceRoot)
}

export function isDiffCommentLineSelected(line: DiffCommentLine, range: DiffCommentRange | null): boolean {
  if (!range) return false
  if (range.start.side === range.end.side) {
    return line.side === range.end.side && line.line >= Math.min(range.start.line, range.end.line) &&
      line.line <= Math.max(range.start.line, range.end.line)
  }
  return line.index >= Math.min(range.start.index, range.end.index) && line.index <= Math.max(range.start.index, range.end.index)
}

/** Excludes local identity so scope migration can deduplicate the same attachment. */
export function diffCommentFingerprint(comment: DiffCommentAttachment): string {
  return JSON.stringify([comment.position.path, comment.position.side, comment.position.line,
    comment.position.start_line ?? comment.position.line, comment.position.start_side ?? comment.position.side,
    comment.localWorkspaceRoot ?? null, comment.localDiffHunk ?? null, diffCommentText(comment)])
}

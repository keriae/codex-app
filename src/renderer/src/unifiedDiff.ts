export type DiffLineKind = 'addition' | 'deletion' | 'context' | 'hunk' | 'metadata'

export interface ParsedDiffLine {
  kind: DiffLineKind
  raw: string
  content: string
  marker: '+' | '-' | ' ' | ''
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface ParsedUnifiedDiff {
  lines: ParsedDiffLine[]
  additions: number
  deletions: number
  hunks: number
  isBinary: boolean
}

export interface CollapsedDiffLines {
  head: ParsedDiffLine[]
  tail: ParsedDiffLine[]
  omittedCount: number
}

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/

function metadataLine(line: string): ParsedDiffLine {
  return {
    kind: 'metadata',
    raw: line,
    content: line,
    marker: '',
    oldLineNumber: null,
    newLineNumber: null
  }
}

function isPatchMetadata(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('---\t') ||
    line.startsWith('+++ ') ||
    line.startsWith('+++\t') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('dissimilarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('copy from ') ||
    line.startsWith('copy to ') ||
    line.startsWith('Binary files ') ||
    line === 'GIT binary patch' ||
    line.startsWith('literal ') ||
    line.startsWith('delta ')
  )
}

function sourceLines(diff: string): string[] {
  if (!diff) return []
  const lines = diff.replace(/\r\n?/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Parse the textual unified diff emitted by app-server fileChange items.
 *
 * Some server versions send a complete patch with @@ headers, while others
 * send only prefixed patch lines. Headerless patches use best-effort line
 * numbers beginning at one so the review UI remains useful.
 */
export function parseUnifiedDiff(diff: string): ParsedUnifiedDiff {
  const rawLines = sourceLines(diff)
  const hasHunkHeaders = rawLines.some((line) => HUNK_HEADER.test(line))
  const lines: ParsedDiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let additions = 0
  let deletions = 0
  let hunks = 0
  let inHunk = !hasHunkHeaders
  let oldLinesRemaining = 0
  let newLinesRemaining = 0

  const finishHunkIfComplete = (): void => {
    if (hasHunkHeaders && oldLinesRemaining === 0 && newLinesRemaining === 0) {
      inHunk = false
    }
  }

  for (const raw of rawLines) {
    const hunk = HUNK_HEADER.exec(raw)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[3])
      oldLinesRemaining = hunk[2] === undefined ? 1 : Number(hunk[2])
      newLinesRemaining = hunk[4] === undefined ? 1 : Number(hunk[4])
      hunks += 1
      inHunk = true
      lines.push({
        kind: 'hunk',
        raw,
        content: raw,
        marker: '',
        oldLineNumber: null,
        newLineNumber: null
      })
      continue
    }

    if (raw.startsWith('\\ No newline at end of file')) {
      lines.push(metadataLine(raw))
      continue
    }

    if ((!inHunk || !hasHunkHeaders) && isPatchMetadata(raw)) {
      lines.push(metadataLine(raw))
      continue
    }

    if (inHunk && raw.startsWith('+')) {
      lines.push({
        kind: 'addition',
        raw,
        content: raw.slice(1),
        marker: '+',
        oldLineNumber: null,
        newLineNumber: newLine
      })
      additions += 1
      newLine += 1
      if (hasHunkHeaders) newLinesRemaining = Math.max(0, newLinesRemaining - 1)
      finishHunkIfComplete()
      continue
    }

    if (inHunk && raw.startsWith('-')) {
      lines.push({
        kind: 'deletion',
        raw,
        content: raw.slice(1),
        marker: '-',
        oldLineNumber: oldLine,
        newLineNumber: null
      })
      deletions += 1
      oldLine += 1
      if (hasHunkHeaders) oldLinesRemaining = Math.max(0, oldLinesRemaining - 1)
      finishHunkIfComplete()
      continue
    }

    if (inHunk && raw.startsWith(' ')) {
      lines.push({
        kind: 'context',
        raw,
        content: raw.slice(1),
        marker: ' ',
        oldLineNumber: oldLine,
        newLineNumber: newLine
      })
      oldLine += 1
      newLine += 1
      if (hasHunkHeaders) {
        oldLinesRemaining = Math.max(0, oldLinesRemaining - 1)
        newLinesRemaining = Math.max(0, newLinesRemaining - 1)
      }
      finishHunkIfComplete()
      continue
    }

    lines.push(metadataLine(raw))
  }

  return {
    lines,
    additions,
    deletions,
    hunks,
    isBinary: rawLines.some(
      (line) => line === 'GIT binary patch' || line.startsWith('Binary files ')
    )
  }
}

export function collapseDiffLines(
  lines: ParsedDiffLine[],
  maxLines = 240,
  tailLines = 24
): CollapsedDiffLines {
  const safeMax = Math.max(1, Math.floor(maxLines))
  if (lines.length <= safeMax) {
    return { head: lines, tail: [], omittedCount: 0 }
  }

  const safeTail = Math.max(0, Math.min(Math.floor(tailLines), safeMax - 1))
  const headCount = safeMax - safeTail
  return {
    head: lines.slice(0, headCount),
    tail: safeTail ? lines.slice(-safeTail) : [],
    omittedCount: lines.length - safeMax
  }
}

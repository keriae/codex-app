import type { ParsedDiffLine } from './unifiedDiff'

export interface SplitDiffRow {
  kind: 'source' | 'separator'
  before: ParsedDiffLine | null
  after: ParsedDiffLine | null
}

const WORKSPACE_HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/

/** Match the native review surface's compact context bars between hunks. */
export function workspaceDiffSeparatorLabels(
  lines: readonly ParsedDiffLine[]
): Map<ParsedDiffLine, string> {
  const labels = new Map<ParsedDiffLine, string>()
  let previousOldEnd = 1
  for (const line of lines) {
    if (line.kind !== 'hunk') continue
    const match = WORKSPACE_HUNK_HEADER.exec(line.raw)
    if (!match) continue
    const oldStart = Number(match[1])
    const oldCount = match[2] === undefined ? 1 : Number(match[2])
    const unmodified = Math.max(0, oldStart - previousOldEnd)
    labels.set(line, unmodified > 0
      ? `${unmodified.toLocaleString('en-US')} unmodified ${unmodified === 1 ? 'line' : 'lines'}`
      : line.content)
    previousOldEnd = oldStart + oldCount
  }
  return labels
}

/** Align replacements within a single hunk; metadata must never join two edits. */
export function splitWorkspaceDiffLines(lines: readonly ParsedDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let before: ParsedDiffLine[] = []
  let after: ParsedDiffLine[] = []
  const flush = (): void => {
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      rows.push({ kind: 'source', before: before[i] ?? null, after: after[i] ?? null })
    }
    before = []; after = []
  }
  for (const line of lines) {
    if (line.kind === 'deletion') {
      if (after.length) flush()
      before.push(line)
    } else if (line.kind === 'addition') {
      after.push(line)
    } else {
      flush()
      rows.push(line.kind === 'context'
        ? { kind: 'source', before: line, after: line }
        : { kind: 'separator', before: line, after: null })
    }
  }
  flush()
  return rows
}

export type WorkspaceDiffStyle = 'unified' | 'split'
export const WORKSPACE_DIFF_PREFERENCES_KEY = 'codex-workspace-diff-preferences-v1'
export function parseWorkspaceDiffPreferences(raw: string | null): { style: WorkspaceDiffStyle; wrap: boolean } {
  try {
    const value = raw ? JSON.parse(raw) : null
    return { style: value?.style === 'split' ? 'split' : 'unified', wrap: value?.wrap === true }
  } catch { return { style: 'unified', wrap: false } }
}

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

export type WorkspaceDiffStyle = 'unified' | 'split' | 'auto'
export type WorkspaceDiffLayout = Exclude<WorkspaceDiffStyle, 'auto'>
export const WORKSPACE_AUTO_DIFF_SPLIT_MIN_WIDTH = 800
export const WORKSPACE_DIFF_PREFERENCES_KEY = 'codex-workspace-diff-preferences-v1'
export interface WorkspaceDiffPreferences {
  style: WorkspaceDiffStyle
  wrap: boolean
  loadFullFiles: boolean
  richPreview: boolean
  wordDiffs: boolean
  hideWhitespace: boolean
  hideImports: boolean
}
export function parseWorkspaceDiffPreferences(raw: string | null): WorkspaceDiffPreferences {
  const defaults: WorkspaceDiffPreferences = { style: 'auto', wrap: false, loadFullFiles: true,
    richPreview: false, wordDiffs: true, hideWhitespace: false, hideImports: false }
  try {
    const value = raw ? JSON.parse(raw) : null
    return { ...defaults, style: value?.style === 'split' || value?.style === 'unified' ? value.style : 'auto',
      wrap: value?.wrap === true, loadFullFiles: value?.loadFullFiles !== false,
      richPreview: value?.richPreview === true, wordDiffs: value?.wordDiffs !== false,
      hideWhitespace: value?.hideWhitespace === true, hideImports: value?.hideImports === true }
  } catch { return defaults }
}

/** review-header-toolbar.Be cycles the selected mode, independently of layout. */
export function nextWorkspaceDiffStyle(style: WorkspaceDiffStyle): WorkspaceDiffStyle {
  return style === 'unified' ? 'split' : style === 'split' ? 'auto' : 'unified'
}

/** app-initial.Eqa gates Auto split on both change kinds and an 800px file width. */
export function resolveWorkspaceDiffStyle(
  style: WorkspaceDiffStyle,
  statistics: { additions: number; deletions: number },
  width: number | null
): WorkspaceDiffLayout {
  if (style !== 'auto') return style
  return width !== null && Number.isFinite(width) && width >= WORKSPACE_AUTO_DIFF_SPLIT_MIN_WIDTH &&
    statistics.additions > 0 && statistics.deletions > 0 ? 'split' : 'unified'
}

/** Installed zh-CN labels describe the next action rather than the current layout. */
export function workspaceDiffStyleLabel(style: WorkspaceDiffStyle): string {
  return style === 'unified' ? '切换到拆分差异视图'
    : style === 'split' ? '将差异视图切换为自动布局'
      : '自动差异视图：改用统一差异视图'
}

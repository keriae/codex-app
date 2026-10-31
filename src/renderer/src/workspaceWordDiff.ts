import type { ParsedDiffLine } from './unifiedDiff'
import { splitWorkspaceDiffLines } from './workspaceDiffModel'

export interface WorkspaceWordDiffSpan {
  start: number
  length: number
}

interface DiffComponent {
  count: number
  added: boolean
  removed: boolean
  previousComponent?: DiffComponent
}

interface DiffPath {
  oldPosition: number
  lastComponent?: DiffComponent
}

interface WordChange {
  value: string
  added: boolean
  removed: boolean
}

interface WordSegment {
  changed: boolean
  value: string
}

const WORD_CHARACTER_RANGES = 'a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}'
const WORD_TOKENS = new RegExp(`(\\r?\\n)|[${WORD_CHARACTER_RANGES}]+|[^\\S\\n\\r]+|[^${WORD_CHARACTER_RANGES}]`, 'ug')
const MAX_CHANGED_LINES = 2000
const MAX_LINE_LENGTH = 1000

function withoutLineEnding(value: string): string {
  let end = value.length
  if (value.charCodeAt(end - 1) === 10) {
    end--
    if (value.charCodeAt(end - 1) === 13) end--
  }
  return value.slice(0, end)
}

function addToPath(path: DiffPath, added: boolean, removed: boolean): DiffPath {
  const previous = path.lastComponent
  return {
    oldPosition: path.oldPosition + (removed ? 1 : 0),
    lastComponent: previous && previous.added === added && previous.removed === removed
      ? { count: previous.count + 1, added, removed, previousComponent: previous.previousComponent }
      : { count: 1, added, removed, previousComponent: previous }
  }
}

function extractCommon(path: DiffPath, newTokens: string[], oldTokens: string[], diagonal: number): number {
  let oldPosition = path.oldPosition
  let newPosition = oldPosition - diagonal
  let count = 0
  while (newPosition + 1 < newTokens.length && oldPosition + 1 < oldTokens.length &&
    oldTokens[oldPosition + 1] === newTokens[newPosition + 1]) {
    oldPosition++
    newPosition++
    count++
  }
  if (count) {
    path.lastComponent = { count, added: false, removed: false, previousComponent: path.lastComponent }
  }
  path.oldPosition = oldPosition
  return newPosition
}

function buildValues(component: DiffComponent | undefined, newTokens: string[], oldTokens: string[]): WordChange[] {
  const components: DiffComponent[] = []
  for (let current = component; current; current = current.previousComponent) components.push(current)
  components.reverse()
  let oldPosition = 0
  let newPosition = 0
  return components.map(({ count, added, removed }) => {
    if (removed) {
      const value = oldTokens.slice(oldPosition, oldPosition + count).join('')
      oldPosition += count
      return { value, added, removed }
    }
    const value = newTokens.slice(newPosition, newPosition + count).join('')
    newPosition += count
    if (!added) oldPosition += count
    return { value, added, removed }
  })
}

/** Transcribe app-initial gh/hnt: strict tokens and the native Myers path tie-break. */
function diffWordsWithSpace(before: string, after: string): WordChange[] {
  const oldTokens = before.match(WORD_TOKENS) ?? []
  const newTokens = after.match(WORD_TOKENS) ?? []
  const initial: DiffPath = { oldPosition: -1 }
  const paths = new Map<number, DiffPath>([[0, initial]])
  let newPosition = extractCommon(initial, newTokens, oldTokens, 0)
  if (initial.oldPosition + 1 >= oldTokens.length && newPosition + 1 >= newTokens.length) {
    return buildValues(initial.lastComponent, newTokens, oldTokens)
  }
  let minimumDiagonal = -Infinity
  let maximumDiagonal = Infinity
  for (let editLength = 1; editLength <= oldTokens.length + newTokens.length; editLength++) {
    for (let diagonal = Math.max(minimumDiagonal, -editLength);
      diagonal <= Math.min(maximumDiagonal, editLength); diagonal += 2) {
      const removePath = paths.get(diagonal - 1)
      const addPath = paths.get(diagonal + 1)
      if (removePath) paths.delete(diagonal - 1)
      const addPosition = addPath ? addPath.oldPosition - diagonal : -1
      const canAdd = addPath !== undefined && addPosition >= 0 && addPosition < newTokens.length
      const canRemove = removePath !== undefined && removePath.oldPosition + 1 < oldTokens.length
      if (!canAdd && !canRemove) {
        paths.delete(diagonal)
        continue
      }
      // A tied old position selects deletion, matching gh.diffWithOptionsObj.
      const path = !canRemove || (canAdd && removePath!.oldPosition < addPath!.oldPosition)
        ? addToPath(addPath!, true, false)
        : addToPath(removePath!, false, true)
      newPosition = extractCommon(path, newTokens, oldTokens, diagonal)
      if (path.oldPosition + 1 >= oldTokens.length && newPosition + 1 >= newTokens.length) {
        return buildValues(path.lastComponent, newTokens, oldTokens)
      }
      paths.set(diagonal, path)
      if (path.oldPosition + 1 >= oldTokens.length) maximumDiagonal = Math.min(maximumDiagonal, diagonal - 1)
      if (newPosition + 1 >= newTokens.length) minimumDiagonal = Math.max(minimumDiagonal, diagonal + 1)
    }
  }
  return []
}

/** app-initial irt joins single neutral characters into the preceding change, except the final item. */
function appendSegment(segments: WordSegment[], change: WordChange, neutral: boolean, last: boolean): void {
  const previous = segments.at(-1)
  if (!previous || last) {
    segments.push({ changed: !neutral, value: change.value })
  } else if (neutral === !previous.changed || (neutral && change.value.length === 1 && previous.changed)) {
    previous.value += change.value
  } else {
    segments.push({ changed: !neutral, value: change.value })
  }
}

function segmentSpans(segments: WordSegment[]): WorkspaceWordDiffSpan[] {
  const spans: WorkspaceWordDiffSpan[] = []
  let position = 0
  for (const segment of segments) {
    if (segment.changed) spans.push({ start: position, length: segment.value.length })
    position += segment.value.length
  }
  return spans
}

/** Match code-diff's word-alt spans; source objects stay intact for both review layouts. */
export function workspaceWordDiffSpans(
  lines: readonly ParsedDiffLine[], enabled: boolean
): Map<ParsedDiffLine, WorkspaceWordDiffSpan[]> {
  const spans = new Map<ParsedDiffLine, WorkspaceWordDiffSpan[]>()
  if (!enabled || lines.filter((line) => line.kind === 'addition' || line.kind === 'deletion').length > MAX_CHANGED_LINES) return spans
  for (const { kind, before, after } of splitWorkspaceDiffLines(lines)) {
    if (kind !== 'source' || before?.kind !== 'deletion' || after?.kind !== 'addition') continue
    const beforeText = withoutLineEnding(before.content)
    const afterText = withoutLineEnding(after.content)
    if (beforeText.length > MAX_LINE_LENGTH || afterText.length > MAX_LINE_LENGTH) continue
    const changes = diffWordsWithSpace(beforeText, afterText)
    const deletions: WordSegment[] = []
    const additions: WordSegment[] = []
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i]
      const last = i === changes.length - 1
      if (!change.added && !change.removed) {
        appendSegment(deletions, change, true, last)
        appendSegment(additions, change, true, last)
      } else if (change.removed) {
        appendSegment(deletions, change, false, last)
      } else {
        appendSegment(additions, change, false, last)
      }
    }
    const beforeSpans = segmentSpans(deletions)
    const afterSpans = segmentSpans(additions)
    if (beforeSpans.length) spans.set(before, beforeSpans)
    if (afterSpans.length) spans.set(after, afterSpans)
  }
  return spans
}

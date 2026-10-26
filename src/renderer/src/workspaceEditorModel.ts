import { EditorState, type Extension } from '@codemirror/state'
import { historyField } from '@codemirror/commands'

export type WorkspaceEditorMode = 'source' | 'markdown'

/** Mirrors the shipped mode switch: save dirty content and reject stale switches. */
export class WorkspaceEditorModeController {
  activeMode: WorkspaceEditorMode
  activeSave: (() => Promise<boolean>) | null = null
  hasUnsavedChanges = false
  constructor(mode: WorkspaceEditorMode) { this.activeMode = mode }
  async switchTo(mode: WorkspaceEditorMode): Promise<boolean> {
    if (mode === this.activeMode) return false
    const previous = this.activeMode
    const save = this.activeSave
    if ((this.hasUnsavedChanges && !await save?.()) || this.activeMode !== previous || this.activeSave !== save) return false
    this.activeMode = mode
    return true
  }
}

export interface WorkspaceEditorSnapshot {
  state: unknown
  content: string
  mode: WorkspaceEditorMode
  scrollTop: number
  scrollLeft: number
}

export function captureWorkspaceEditor(state: EditorState, mode: WorkspaceEditorMode, scrollTop: number, scrollLeft: number): WorkspaceEditorSnapshot {
  return { state: state.toJSON({ history: historyField }), content: state.doc.toString(), mode, scrollTop, scrollLeft }
}

export function restoreWorkspaceEditor(snapshot: WorkspaceEditorSnapshot | undefined, content: string, extensions: Extension): EditorState {
  if (snapshot?.content === content) {
    try { return EditorState.fromJSON(snapshot.state, { extensions }, { history: historyField }) } catch { /* Invalid snapshots do not replace a current draft. */ }
  }
  return EditorState.create({ doc: content, extensions })
}

export function workspaceGoToLine(value: string, count: number): number | null {
  if (!/^-?\d+$/.test(value.trim())) return null
  const line = Number(value)
  if (!Number.isSafeInteger(line) || line === 0) return null
  const last = Math.max(1, count)
  return Math.min(last, Math.max(1, line < 0 ? last + 1 + line : line))
}

/** Map an accepted disk reload through the editor instead of replacing every position. */
export function workspaceEditorDocumentChange(before: string, after: string): {from: number; to: number; insert: string} | null {
  if (before === after) return null
  let from = 0, suffix = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++
  // Keep a common high surrogate with its low surrogate in the replacement.
  if (from > 0 && /[\uD800-\uDBFF]/.test(before[from - 1])) from--
  while (suffix < before.length - from && suffix < after.length - from && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  return {from, to: before.length - suffix, insert: after.slice(from, after.length - suffix)}
}

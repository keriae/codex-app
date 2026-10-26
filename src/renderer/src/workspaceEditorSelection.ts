import { resolveWorkspaceFileLink } from './workspaceFileLinks'

export const ADD_WORKSPACE_SELECTION_TO_COMPOSER_EVENT = 'codex:add-workspace-selection-to-composer'

export interface WorkspaceEditorPosition { line: number; character: number }
export interface WorkspaceEditorRange { start: WorkspaceEditorPosition; end: WorkspaceEditorPosition }
export interface WorkspaceEditorSelection {
  root: string
  path: string
  selectedText: string
  range: WorkspaceEditorRange
  instruction?: string
}
export interface WorkspaceEditorFileReference { kind: 'file'; root: string; path: string; instruction?: string }
export type WorkspaceComposerReference = WorkspaceEditorSelection | WorkspaceEditorFileReference

function position(value: unknown): WorkspaceEditorPosition | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return Number.isSafeInteger(item.line) && Number(item.line) >= 0 &&
    Number.isSafeInteger(item.character) && Number(item.character) >= 0
    ? { line: Number(item.line), character: Number(item.character) } : null
}

/** Line/character positions use the original editor's zero-based, exclusive-end contract. */
export function validatedWorkspaceSelection(value: unknown, expectedRoot?: string): WorkspaceEditorSelection | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (item.kind !== undefined || typeof item.root !== 'string' || typeof item.path !== 'string' ||
    typeof item.selectedText !== 'string' || !item.selectedText.trim() || item.selectedText.length > 512 * 1024 ||
    (expectedRoot !== undefined && item.root !== expectedRoot) || resolveWorkspaceFileLink(item.root, item.path) !== item.path) return null
  const range = item.range as Record<string, unknown> | undefined
  const start = position(range?.start)
  const end = position(range?.end)
  if (!start || !end || end.line < start.line ||
    (end.line === start.line && end.character <= start.character)) return null
  const selectedLines = item.selectedText.split('\n')
  if (end.line - start.line !== selectedLines.length - 1 ||
    end.character !== (selectedLines.length === 1 ? start.character : 0) + selectedLines.at(-1)!.length) return null
  if (item.instruction !== undefined && (typeof item.instruction !== 'string' || !item.instruction.trim())) return null
  return { root: item.root, path: item.path, selectedText: item.selectedText, range: { start, end },
    ...(typeof item.instruction === 'string' ? { instruction: item.instruction.trim() } : {}) }
}

export function workspaceSelectionLineLabel(range: WorkspaceEditorRange): string {
  // An exclusive end at the beginning of the next line does not include that line.
  const end = range.end.character === 0 && range.end.line > range.start.line ? range.end.line : range.end.line + 1
  return end === range.start.line + 1 ? `第 ${end} 行` : `第 ${range.start.line + 1}–${end} 行`
}

export function workspaceSelectionPrompt(selection: WorkspaceEditorSelection): string {
  const { start, end } = selection.range
  const href = `${encodedPath(selection.path)}#L${start.line + 1}C${start.character + 1}-L${end.line + 1}C${end.character + 1}`
  const name = escapedName(selection.path)
  let backticks = 3
  for (const match of selection.selectedText.matchAll(/`+/g)) backticks = Math.max(backticks, match[0].length + 1)
  const fence = '`'.repeat(backticks)
  return `[${name} (${workspaceSelectionLineLabel(selection.range)})](${href})\n\n${selection.instruction ? `${selection.instruction}\n\n` : ''}${fence}\n${selection.selectedText}\n${fence}`
}

function encodedPath(path: string): string { return path.split('/').map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/') }
function escapedName(path: string): string { return (path.split('/').at(-1) || path).replace(/[\\[\]`*_]/g, '\\$&') }

export function validatedWorkspaceComposerReference(value: unknown, expectedRoot?: string): WorkspaceComposerReference | null {
  if (!value || typeof value !== 'object' || (value as {kind?: unknown}).kind !== 'file') return validatedWorkspaceSelection(value, expectedRoot)
  const item = value as Record<string, unknown>
  if (item.selectedText !== undefined || item.range !== undefined || typeof item.root !== 'string' || typeof item.path !== 'string' ||
    (expectedRoot !== undefined && item.root !== expectedRoot) || resolveWorkspaceFileLink(item.root, item.path) !== item.path ||
    (item.instruction !== undefined && (typeof item.instruction !== 'string' || !item.instruction.trim()))) return null
  return { kind: 'file', root: item.root, path: item.path,
    ...(typeof item.instruction === 'string' ? {instruction: item.instruction.trim()} : {}) }
}

export function workspaceReferencePrompt(reference: WorkspaceComposerReference): string {
  return 'kind' in reference ? `[${escapedName(reference.path)}](${encodedPath(reference.path)})${reference.instruction ? `\n\n${reference.instruction}` : ''}` : workspaceSelectionPrompt(reference)
}

export function dispatchWorkspaceReference(reference: WorkspaceComposerReference, target: EventTarget = window): boolean {
  const detail = validatedWorkspaceComposerReference(reference)
  return detail !== null && target.dispatchEvent(new CustomEvent<WorkspaceComposerReference>(ADD_WORKSPACE_SELECTION_TO_COMPOSER_EVENT, { detail }))
}

export function dispatchWorkspaceSelection(selection: WorkspaceEditorSelection, target: EventTarget = window): boolean {
  const detail = validatedWorkspaceSelection(selection)
  return detail !== null && dispatchWorkspaceReference(detail, target)
}

export function workspaceSelectionFromOffsets(root: string, path: string, content: string, from: number, to: number): WorkspaceEditorSelection | null {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < 0 || from > content.length || to > content.length || from === to) return null
  if (from > to) [from, to] = [to, from]
  const at = (offset: number): WorkspaceEditorPosition => {
    const before = content.slice(0, offset)
    const lines = before.split('\n')
    return { line: lines.length - 1, character: lines.at(-1)!.length }
  }
  return validatedWorkspaceSelection({ root, path, selectedText: content.slice(from, to), range: { start: at(from), end: at(to) } })
}

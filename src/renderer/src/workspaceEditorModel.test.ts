import { describe, expect, it } from 'vitest'
import { Compartment, EditorState } from '@codemirror/state'
import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { captureWorkspaceEditor, restoreWorkspaceEditor, WorkspaceEditorModeController, workspaceEditorDocumentChange, workspaceGoToLine } from './workspaceEditorModel'

describe('workspace editor retained state', () => {
  it('retains selections and real undo/redo history when a tab or appearance remounts', () => {
    const appearance = new Compartment()
    let state = EditorState.create({doc: 'hello\nworld', extensions: [history(), appearance.of([])]})
    state = state.update({changes: {from: 6, to: 11, insert: 'changed'}, selection: {anchor: 6, head: 13}}).state
    state = state.update({effects: appearance.reconfigure([])}).state
    const snapshot = captureWorkspaceEditor(state, 'markdown', 123, 45)
    state = restoreWorkspaceEditor(snapshot, 'hello\nchanged', history())
    expect(state.selection.main).toMatchObject({from: 6, to: 13})
    expect(snapshot).toMatchObject({mode: 'markdown', scrollTop: 123, scrollLeft: 45})
    expect(undoDepth(state)).toBe(1)
    const dispatch = (transaction: {state: EditorState}) => {state = transaction.state}
    expect(undo({state, dispatch})).toBe(true)
    expect(state.doc.toString()).toBe('hello\nworld')
    expect(redoDepth(state)).toBe(1)
    expect(redo({state, dispatch})).toBe(true)
    expect(state.doc.toString()).toBe('hello\nchanged')
  })
  it('never restores an old tab snapshot over a newer retained draft', () => {
    const state = EditorState.create({doc: 'old', extensions: history()})
    expect(restoreWorkspaceEditor(captureWorkspaceEditor(state, 'source', 0, 0), 'new draft', history()).doc.toString()).toBe('new draft')
    expect(restoreWorkspaceEditor({...captureWorkspaceEditor(state, 'source', 0, 0), state: null}, 'old', history()).doc.toString()).toBe('old')
  })
  it('saves dirty source before switching and refuses failed or stale switches', async () => {
    const controller = new WorkspaceEditorModeController('markdown')
    controller.hasUnsavedChanges = true
    controller.activeSave = async () => false
    expect(await controller.switchTo('source')).toBe(false)
    expect(controller.activeMode).toBe('markdown')
    let finish!: (saved: boolean) => void
    controller.activeSave = () => new Promise((resolve) => {finish = resolve})
    const pending = controller.switchTo('source')
    controller.activeSave = async () => true
    finish(true)
    expect(await pending).toBe(false)
    expect(await controller.switchTo('source')).toBe(true)
    expect(controller.activeMode).toBe('source')
    expect(await controller.switchTo('source')).toBe(false)
  })
  it('uses signed, clamped integer go-to-line positions from the original editor', () => {
    expect(workspaceGoToLine('-1', 10)).toBe(10)
    expect(workspaceGoToLine('-2', 10)).toBe(9)
    expect(workspaceGoToLine('-99', 10)).toBe(1)
    expect(workspaceGoToLine('99', 10)).toBe(10)
    expect(workspaceGoToLine(' 2 ', 10)).toBe(2)
    for (const value of ['', '0', '-0', '2.5', '+2', '1e2', '9007199254740992']) expect(workspaceGoToLine(value, 10)).toBeNull()
  })
  it('maps accepted external edits without moving selections in unchanged file regions', () => {
    const state = EditorState.create({doc: 'header\nvalue=1\nfooter', selection: {anchor: 2}})
    const changes = workspaceEditorDocumentChange(state.doc.toString(), 'header\nvalue=2\nfooter')!
    const updated = state.update({changes}).state
    expect(updated.doc.toString()).toBe('header\nvalue=2\nfooter')
    expect(updated.selection.main.head).toBe(2)
    expect(workspaceEditorDocumentChange('😀', '😁')).toEqual({from: 0, to: 2, insert: '😁'})
    expect(workspaceEditorDocumentChange('same', 'same')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { validatedWorkspaceComposerReference, validatedWorkspaceSelection, workspaceReferencePrompt, workspaceSelectionFromOffsets, workspaceSelectionLineLabel, workspaceSelectionPrompt } from './workspaceEditorSelection'

describe('workspace editor composer references', () => {
  it('captures backward and multiline selections with UTF-16 columns and exclusive ends', () => {
    const content = '首行\nA😀中\nlast'
    const selection = workspaceSelectionFromOffsets('/root', '/root/文档.md', content, 8, 3)!
    expect(selection).toMatchObject({selectedText: 'A😀中\n', range: {start: {line: 1, character: 0}, end: {line: 2, character: 0}}})
    expect(workspaceSelectionLineLabel(selection.range)).toBe('第 2 行')
    expect(workspaceSelectionFromOffsets('/root', '/root/文档.md', content, 4, 6)?.range).toEqual({start: {line: 1, character: 1}, end: {line: 1, character: 3}})
  })
  it('keeps file references explicit and rejects empty, malformed or out-of-scope selections', () => {
    const selection = workspaceSelectionFromOffsets('/root', '/root/a.md', 'abc', 0, 2)!
    expect(validatedWorkspaceComposerReference({kind: 'file', root: '/root', path: '/root/a.md'}, '/root')).toEqual({kind: 'file', root: '/root', path: '/root/a.md'})
    for (const value of [
      {...selection, kind: 'file'}, {...selection, selectedText: ''}, {...selection, selectedText: ' '},
      {...selection, range: {start: {line: 0, character: 0}, end: {line: 0, character: 99}}},
      {...selection, path: '/elsewhere/a.md'}, {...selection, root: '/elsewhere'},
      {...selection, instruction: ' '}, {root: '/root', path: '/root/a.md'}
    ]) expect(validatedWorkspaceComposerReference(value, '/root')).toBeNull()
    expect(validatedWorkspaceSelection(selection, '/root')).toEqual(selection)
    for (const [from, to] of [[0, 0], [-1, 2], [0, 9], [0.5, 2]]) expect(workspaceSelectionFromOffsets('/root', '/root/a.md', 'abc', from, to)).toBeNull()
  })
  it('encodes filenames and preserves fenced selected source with exact linked positions', () => {
    const selection = {...workspaceSelectionFromOffsets('/root', '/root/a] (x).md', '````\nhello', 0, 10)!, instruction: '修改这里'}
    const prompt = workspaceSelectionPrompt(selection)
    expect(prompt).toContain('[a\\] (x).md (第 1–2 行)](/root/a%5D%20%28x%29.md#L1C1-L2C6)')
    expect(prompt).toContain('修改这里\n\n`````\n````\nhello\n`````')
    expect(workspaceReferencePrompt({kind: 'file', root: '/root', path: '/root/a.md'})).toBe('[a.md](/root/a.md)')
    expect(workspaceReferencePrompt({kind: 'file', root: '/root', path: '/root/a)*_.md'})).toBe('[a)\\*\\_.md](/root/a%29%2A_.md)')
  })
})

import { describe, expect, it } from 'vitest'
import {
  composerAttachmentPickerProperties,
  describeComposerAttachment
} from './composerAttachments'

describe('describeComposerAttachment', () => {
  it('classifies supported raster images without reading them', () => {
    expect(describeComposerAttachment('/test-fixtures/reference.PNG')).toEqual({
      kind: 'image',
      name: 'reference.PNG',
      fsPath: '/test-fixtures/reference.PNG',
      path: '/test-fixtures/reference.PNG'
    })
  })

  it('treats other selected files as file mentions', () => {
    expect(describeComposerAttachment('/test-fixtures/notes.md')).toEqual({
      kind: 'file',
      name: 'notes.md',
      fsPath: '/test-fixtures/notes.md',
      path: '/test-fixtures/notes.md'
    })
  })

  it('describes directories as file mentions with a trailing path separator', () => {
    expect(describeComposerAttachment('/test-fixtures/project', true)).toEqual({
      kind: 'file',
      name: 'project',
      fsPath: '/test-fixtures/project',
      path: '/test-fixtures/project/'
    })
    expect(describeComposerAttachment('/test-fixtures/project/', true)).toEqual({
      kind: 'file',
      name: 'project',
      fsPath: '/test-fixtures/project',
      path: '/test-fixtures/project/'
    })
  })

  it('uses the original macOS file and folder picker capabilities', () => {
    expect(composerAttachmentPickerProperties('darwin')).toEqual([
      'openFile',
      'openDirectory',
      'multiSelections'
    ])
    expect(composerAttachmentPickerProperties('linux')).toEqual([
      'openFile',
      'multiSelections'
    ])
  })

  it('rejects non-absolute paths', () => {
    expect(describeComposerAttachment('../notes.md')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildTurnInput,
  isDirectoryAttachmentPath,
  mergeComposerAttachments
} from './composerAttachments'

const image = {
  kind: 'image' as const,
  name: 'reference.png',
  path: '/test-fixtures/reference.png'
}
const file = {
  kind: 'file' as const,
  name: 'notes.md',
  path: '/test-fixtures/notes.md'
}
const directory = {
  kind: 'file' as const,
  name: 'project',
  fsPath: '/test-fixtures/project',
  path: '/test-fixtures/project/'
}

describe('composer attachments', () => {
  it('builds the app-server 0.163.0 structured input schema', () => {
    expect(buildTurnInput('  Review these  ', [image, file])).toEqual([
      { type: 'text', text: 'Review these', text_elements: [] },
      { type: 'localImage', path: image.path },
      { type: 'mention', name: file.name, path: file.path }
    ])
  })

  it('supports attachment-only turns', () => {
    expect(buildTurnInput('  ', [file])).toEqual([
      { type: 'mention', name: file.name, path: file.path }
    ])
  })

  it('submits selected directories as mentions with a trailing separator', () => {
    expect(buildTurnInput('', [directory])).toEqual([
      { type: 'mention', name: directory.name, path: '/test-fixtures/project/' }
    ])
    expect(isDirectoryAttachmentPath(directory.path)).toBe(true)
    expect(isDirectoryAttachmentPath(file.path)).toBe(false)
  })

  it('deduplicates repeated selections by path', () => {
    expect(mergeComposerAttachments([image], [image, file])).toEqual([image, file])
  })
})

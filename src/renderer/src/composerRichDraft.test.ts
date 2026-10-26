import { describe, expect, it } from 'vitest'
import {
  addComposerDocumentTemplate,
  materializeComposerRichDraft,
  parseComposerRichDraft,
  serializeComposerRichDraft
} from './composerRichDraft'

describe('composer rich draft', () => {
  it('extracts installed plugin invocations into visual mentions', () => {
    expect(parseComposerRichDraft('Draft a report $documents $pdf ')).toEqual({
      pluginMentions: [
        { id: 'documents', label: 'Documents' },
        { id: 'pdf', label: 'PDF' }
      ],
      templates: [],
      text: 'Draft a report '
    })
  })

  it('round-trips visual mentions and document templates', () => {
    const parsed = parseComposerRichDraft(
      '$documents [[codex-template:project-brief]] Summarize the launch'
    )
    expect(serializeComposerRichDraft(parsed)).toBe(
      '$documents [[codex-template:project-brief]] Summarize the launch'
    )
  })

  it('adds each template once and materializes the measured template prompt', () => {
    const selected = addComposerDocumentTemplate('$documents ', 'project-brief')
    expect(addComposerDocumentTemplate(selected, 'project-brief')).toBe(selected)
    expect(materializeComposerRichDraft(selected)).toBe(
      '$documents Use the 项目简介 template.'
    )
  })
})

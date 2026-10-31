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
  it.each([
    '  def render():\n    return "hello"\n',
    'First line  \nSecond line\n\n  - nested item\n',
    '\tconst aligned  =  1;\r\n\treturn aligned;  \r\n',
    '   leading and trailing spaces   ',
    '\n\n\t  '
  ])('preserves pasted text through editor updates and submission: %j', (text) => {
    const parsed = parseComposerRichDraft(text)
    expect(parsed.text).toBe(text)
    expect(serializeComposerRichDraft(parsed)).toBe(text)
    expect(materializeComposerRichDraft(text)).toBe(text)
  })

  it('retains exact code indentation and Markdown hard breaks with selected chips', () => {
    const text = '  if ready:\n    write("report")  \n\n'
    const selected = `$documents [[codex-template:project-brief]] ${text}`
    const parsed = parseComposerRichDraft(selected)
    expect(parsed.text).toBe(text)
    expect(serializeComposerRichDraft(parsed)).toBe(selected)
    expect(materializeComposerRichDraft(selected)).toBe(`$documents Use the 项目简介 template. ${text}`)
  })

  it('leaves known variable names and template syntax inside code untouched', () => {
    const text = [
      'Compare `$documents` with ``use ` $pdf ` here``.',
      '```sh',
      'echo $documents $pdf',
      '[[codex-template:project-brief]]',
      '```',
      '~~~text',
      '$presentations',
      '~~~~',
      '    $documents',
      '\t$pdf',
      ''
    ].join('\n')
    expect(parseComposerRichDraft(text)).toEqual({ pluginMentions: [], templates: [], text })
    expect(materializeComposerRichDraft(text)).toBe(text)
  })

  it('keeps variable text while code is being typed before the closing delimiter', () => {
    for (const text of ['```sh\necho $documents ', 'Use `$pdf ']) {
      expect(parseComposerRichDraft(text)).toEqual({ pluginMentions: [], templates: [], text })
    }
  })

  it('extracts an invocation outside code while preserving the code and unknown names', () => {
    const text = 'Use `$documents` with $custom-plugin and [[codex-template:custom]]  '
    const parsed = parseComposerRichDraft(`${text}$pdf `)
    expect(parsed.pluginMentions).toEqual([{ id: 'pdf', label: 'PDF' }])
    expect(parsed.templates).toEqual([])
    expect(parsed.text).toBe(text)
    expect(serializeComposerRichDraft(parsed)).toBe(`$pdf ${text}`)
  })

  it('does not treat inherited object properties or escaped variables as plugins', () => {
    const text = '$constructor $toString \\$documents \\$pdf '
    expect(parseComposerRichDraft(text)).toEqual({ pluginMentions: [], templates: [], text })
  })

  it('removes repeated known invocations once from text without changing other spacing', () => {
    const parsed = parseComposerRichDraft('Before  $pdf $pdf after  \n')
    expect(parsed.pluginMentions).toEqual([{ id: 'pdf', label: 'PDF' }])
    expect(parsed.text).toBe('Before  after  \n')
  })
})

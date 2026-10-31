export interface ComposerPluginMention {
  id: string
  label: string
}

export interface ComposerDocumentTemplate {
  id: string
  name: string
  fileName: string
  kind: 'word'
  previewTitle: string
  previewSubtitle: string
}

export interface ParsedComposerRichDraft {
  pluginMentions: ComposerPluginMention[]
  templates: ComposerDocumentTemplate[]
  text: string
}

const PLUGIN_LABELS: Readonly<Record<string, string>> = {
  documents: 'Documents',
  pdf: 'PDF',
  spreadsheets: 'Spreadsheets',
  presentations: 'Presentations',
  'template-creator': 'Template Creator',
  browser: '浏览器',
  computer: '电脑',
  latex: 'LaTeX',
  visualize: 'Visualize',
  zotero: 'Zotero'
}

export const COMPOSER_DOCUMENT_TEMPLATES: readonly ComposerDocumentTemplate[] = [
  {
    id: 'project-brief',
    name: '项目简介',
    fileName: 'project-brief.docx',
    kind: 'word',
    previewTitle: 'Project Brief',
    previewSubtitle: 'Align stakeholders before execution.'
  },
  {
    id: 'meeting-notes',
    name: '会议记录',
    fileName: 'meeting-notes.docx',
    kind: 'word',
    previewTitle: 'Meeting Notes',
    previewSubtitle: 'Capture decisions and follow-ups.'
  },
  {
    id: 'report-outline',
    name: '报告大纲',
    fileName: 'report-outline.docx',
    kind: 'word',
    previewTitle: 'Report Outline',
    previewSubtitle: 'Start a professional report.'
  }
]

const templatesById = new Map(COMPOSER_DOCUMENT_TEMPLATES.map((template) => [template.id, template]))
const richTokenPattern = /(^|\s)(?:\$([a-z0-9][a-z0-9-]*)|\[\[codex-template:([a-z0-9-]+)\]\])(?=\s|$)/giu

interface TextRange { start: number; end: number }

/** Code is draft text, even when it contains a name also used by a plugin. */
function draftCodeRanges(draft: string): TextRange[] {
  const ranges: TextRange[] = []
  let fence: { start: number; marker: string; length: number } | null = null
  let offset = 0
  for (const line of draft.split(/(?<=\n)/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/u.exec(line)
    if (marker) {
      if (!fence) {
        fence = { start: offset, marker: marker[1][0], length: marker[1].length }
      } else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) {
        ranges.push({ start: fence.start, end: offset + line.length })
        fence = null
      }
    }
    if (!fence && /^(?: {4}|\t)/u.test(line)) {
      ranges.push({ start: offset, end: offset + line.length })
    }
    offset += line.length
  }
  if (fence) ranges.push({ start: fence.start, end: draft.length })

  const insideFence = (index: number): boolean => ranges.some(({ start, end }) => index >= start && index < end)
  const backticks = Array.from(draft.matchAll(/`+/gu))
  for (let index = 0; index < backticks.length; index += 1) {
    const opening = backticks[index]
    const start = opening.index
    if (insideFence(start)) continue
    let closingIndex = index + 1
    while (closingIndex < backticks.length &&
      (insideFence(backticks[closingIndex].index) || backticks[closingIndex][0].length !== opening[0].length)) {
      closingIndex += 1
    }
    const closing = backticks[closingIndex]
    ranges.push({ start, end: closing ? closing.index + closing[0].length : draft.length })
    index = closing ? closingIndex : backticks.length
  }
  return ranges
}

export function composerPluginLabel(pluginId: string): string {
  return PLUGIN_LABELS[pluginId] || pluginId
}

export function parseComposerRichDraft(draft: string): ParsedComposerRichDraft {
  const pluginIds: string[] = []
  const templateIds: string[] = []
  const codeRanges = draftCodeRanges(draft)
  const removals: TextRange[] = []
  for (const match of draft.matchAll(richTokenPattern)) {
    const start = match.index + match[1].length
    if (codeRanges.some((range) => start >= range.start && start < range.end)) continue
    const pluginId = match[2]?.toLowerCase()
    const templateId = match[3]?.toLowerCase()
    if (pluginId && Object.hasOwn(PLUGIN_LABELS, pluginId)) {
      if (!pluginIds.includes(pluginId)) pluginIds.push(pluginId)
    } else if (templateId && templatesById.has(templateId)) {
      if (!templateIds.includes(templateId)) templateIds.push(templateId)
    } else continue
    const end = match.index + match[0].length
    // One ASCII space belongs to the serialized chip. Every other whitespace
    // character belongs to the user's text, including indentation/hard breaks.
    removals.push({ start, end: end + (draft[end] === ' ' ? 1 : 0) })
  }

  let visible = ''
  let offset = 0
  for (const { start, end } of removals) {
    visible += draft.slice(offset, start)
    offset = end
  }
  visible += draft.slice(offset)

  return {
    pluginMentions: pluginIds.map((id) => ({ id, label: composerPluginLabel(id) })),
    templates: templateIds.map((id) => templatesById.get(id)!),
    text: visible
  }
}

export function serializeComposerRichDraft(draft: ParsedComposerRichDraft): string {
  const tokens = [
    ...draft.pluginMentions.map(({ id }) => `$${id}`),
    ...draft.templates.map(({ id }) => `[[codex-template:${id}]]`)
  ]
  return tokens.length > 0 ? `${tokens.join(' ')} ${draft.text}` : draft.text
}

export function addComposerDocumentTemplate(
  draft: string,
  templateId: string
): string {
  const parsed = parseComposerRichDraft(draft)
  const template = templatesById.get(templateId)
  if (!template || parsed.templates.some(({ id }) => id === templateId)) return draft
  return serializeComposerRichDraft({ ...parsed, templates: [...parsed.templates, template] })
}

export function materializeComposerRichDraft(draft: string): string {
  const parsed = parseComposerRichDraft(draft)
  return [
    ...parsed.pluginMentions.map(({ id }) => `$${id}`),
    ...parsed.templates.map(({ name }) => `Use the ${name} template.`),
    parsed.text
  ].filter(Boolean).join(' ')
}

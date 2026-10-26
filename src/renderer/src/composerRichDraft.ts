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
const pluginTokenPattern = /(^|\s)\$([a-z0-9][a-z0-9-]*)(?=\s|$)/giu
const templateTokenPattern = /(^|\s)\[\[codex-template:([a-z0-9-]+)\]\](?=\s|$)/giu

function removeRichToken(source: string, match: string, leadingWhitespace: string): string {
  if (!leadingWhitespace) return source.replace(match, '')
  const replacement = leadingWhitespace.includes('\n') ? '\n' : ' '
  return source.replace(match, replacement)
}

function tidyVisibleDraft(value: string): string {
  return value
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/ {2,}/gu, ' ')
    .trimStart()
}

export function composerPluginLabel(pluginId: string): string {
  return PLUGIN_LABELS[pluginId] || pluginId
}

export function parseComposerRichDraft(draft: string): ParsedComposerRichDraft {
  const pluginIds: string[] = []
  const templateIds: string[] = []
  let visible = draft

  for (const match of draft.matchAll(pluginTokenPattern)) {
    const pluginId = match[2]?.toLowerCase()
    if (!pluginId || !(pluginId in PLUGIN_LABELS) || pluginIds.includes(pluginId)) continue
    pluginIds.push(pluginId)
    visible = removeRichToken(visible, match[0], match[1] || '')
  }

  for (const match of draft.matchAll(templateTokenPattern)) {
    const templateId = match[2]?.toLowerCase()
    if (!templateId || !templatesById.has(templateId) || templateIds.includes(templateId)) continue
    templateIds.push(templateId)
    visible = removeRichToken(visible, match[0], match[1] || '')
  }

  return {
    pluginMentions: pluginIds.map((id) => ({ id, label: composerPluginLabel(id) })),
    templates: templateIds.map((id) => templatesById.get(id)!),
    text: tidyVisibleDraft(visible)
  }
}

export function serializeComposerRichDraft(draft: ParsedComposerRichDraft): string {
  const tokens = [
    ...draft.pluginMentions.map(({ id }) => `$${id}`),
    ...draft.templates.map(({ id }) => `[[codex-template:${id}]]`)
  ]
  const text = draft.text.trimStart()
  const value = [...tokens, text].filter(Boolean).join(' ')
  return text || tokens.length === 0 ? value : `${value} `
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

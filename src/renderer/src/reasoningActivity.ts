import ReactMarkdown from 'react-markdown'
import type { ReasoningItem } from './protocol'

// N3n in the shipped client uses summary, not the raw reasoning content channel.
export function reasoningSummaryMarkdown(item: ReasoningItem): string {
  const [first, ...rest] = item.summary || []
  if (!first || rest.length === 0) return first || ''
  return [first.startsWith('**') ? first : `**${first}**`, ...rest].join('\n\n')
}

type MarkdownNode = {
  type: string
  value?: string
  alt?: string | null
  children?: MarkdownNode[]
}

function markdownText(node: MarkdownNode): string {
  if (typeof node.value === 'string') return node.value
  if (node.alt) return node.alt
  return node.children?.map(markdownText).join('') || ''
}

function parseHeadingLine(markdown: string): { text: string; strongOnly: boolean } {
  const parsed = { text: '', strongOnly: false }
  // The declared Markdown renderer exposes its synchronous parser through remark.
  // Capture the mdast before rendering and leave an empty tree for the unused output.
  ReactMarkdown({
    children: markdown,
    remarkPlugins: [() => (tree: unknown) => {
      const root = tree as MarkdownNode
      const first = root.children?.[0]
      parsed.text = markdownText(root).trim()
      parsed.strongOnly = first?.type === 'paragraph'
        && first.children?.length === 1
        && first.children[0].type === 'strong'
      root.children = []
    }]
  })
  return parsed
}

function isCommentLine(line: string): boolean {
  let text = line
  while (text.startsWith('<!--')) {
    const end = text.indexOf('-->')
    if (end === -1) return true
    text = text.slice(end + 3).trimStart()
  }
  return !text || '<!--'.startsWith(text)
}

function summaryHeading(markdown: string): string | null {
  const lines = markdown.trimEnd().split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line || isCommentLine(line)) continue
    if (/^[\p{L}\p{M}\p{N} .,!?'"’()-]+$/u.test(line)
      && !line.startsWith('-')
      && !/^\d+[.)](?: |$)/.test(line)) return line
    try {
      const { text, strongOnly } = parseHeadingLine(line)
      if (!text) continue
      return strongOnly ? summaryHeading(text) ?? text : text
    } catch {
      // A malformed streamed line must not hide an earlier usable summary line.
    }
  }
  return null
}

// rCo in the shipped client selects the last meaningful line from N3n(summary).
export function reasoningActivityHeading(item: ReasoningItem): string | null {
  return summaryHeading(reasoningSummaryMarkdown(item))
}

export function reasoningBody(markdown: string): string {
  const trimmed = markdown.trimStart()
  const boldHeading = trimmed.match(/^\*\*[^\n]*?\*\*/)
  if (boldHeading) return trimmed.slice(boldHeading[0].length).trim()
  if (trimmed.startsWith('**')) return ''
  const heading = trimmed.match(/^#{1,3}[^\n]*(?:\n|$)/)
  return (heading ? trimmed.slice(heading[0].length) : trimmed).trim()
}

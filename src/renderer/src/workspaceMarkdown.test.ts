import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { DecorationSet } from '@codemirror/view'
import { workspaceMarkdownDecorations, workspaceMarkdownExtension, workspaceMarkdownFileLink, workspaceMarkdownLinkAt } from './workspaceMarkdown'
import { workspaceMarkdownFrontmatter } from './workspaceMarkdownFrontmatter'

function state(doc: string, anchor = doc.length) { return EditorState.create({doc, selection: {anchor}, extensions: markdown({base: markdownLanguage})}) }
function decorations(set: DecorationSet) {
  const result: Array<{from: number; to: number; className: string; block: boolean; widget: boolean}> = []
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, decoration) => { result.push({from, to, className: decoration.spec.class ?? '', block: decoration.spec.block === true, widget: !!decoration.spec.widget}) })
  return result
}

describe('editable Markdown preview', () => {
  it('hides inline markers outside the selection and reveals them while editing', () => {
    const doc = '# Heading\n\n**strong** *italic* ~~gone~~ `code` [label](./other.md)\n'
    const idle = decorations(workspaceMarkdownDecorations(state(doc), false))
    expect(idle.filter((item) => item.from === 0 && item.to === 2)).toHaveLength(1)
    const strong = doc.indexOf('**strong**')
    expect(idle.some((item) => item.from === strong && item.to === strong + 2)).toBe(true)
    const editing = decorations(workspaceMarkdownDecorations(state(doc, strong + 3), true))
    expect(editing.some((item) => item.from === strong && item.to === strong + 2)).toBe(false)
    expect(editing.some((item) => item.className === 'cm-markdown-strong')).toBe(true)
    expect(idle.some((item) => item.className === 'cm-markdown-strikethrough')).toBe(true)
    expect(idle.some((item) => item.className === 'cm-markdown-heading cm-markdown-heading-1')).toBe(true)
  })
  it('renders closed fences and tables without treating incomplete Mermaid as a widget', () => {
    const doc = '```typescript\nconst x = 1\n```\n\n| A | B |\n|---|---|\n| C | D |\n\n```mermaid\ngraph TD\nA --> B\n```\n'
    const idle = decorations(workspaceMarkdownDecorations(state(doc), false))
    expect(idle.some((item) => item.className === 'cm-markdown-code-line cm-markdown-code-line-first')).toBe(true)
    expect(idle.filter((item) => item.className === 'cm-markdown-table-cell')).toHaveLength(4)
    expect(idle.filter((item) => item.block && item.widget)).toHaveLength(1)
    const editing = decorations(workspaceMarkdownDecorations(state(doc, doc.indexOf('graph TD')), true))
    expect(editing.some((item) => item.block && item.widget)).toBe(false)
    expect(decorations(workspaceMarkdownDecorations(state('```mermaid\ngraph TD'), false)).some((item) => item.widget)).toBe(false)
    expect(() => EditorState.create({doc, extensions: [markdown({base: markdownLanguage}), workspaceMarkdownExtension('/root', '/root/a.md')]})).not.toThrow()
  })
  it('resolves decoded relative local links and reads links from their rendered labels', () => {
    expect(workspaceMarkdownFileLink('/root', '/root/docs/a.md', '../other%20file.md#L4C2')).toEqual({path: '/root/other file.md', line: 4, column: 2})
    expect(workspaceMarkdownFileLink('/root', '/root/docs/a.md', '../../outside.md')).toBeNull()
    expect(workspaceMarkdownFileLink('/root', '/root/a.md', 'javascript:alert(1)')).toBeNull()
    const doc = '[label](https://example.com?a=1&amp;b=2) and <https://example.org>'
    expect(workspaceMarkdownLinkAt(state(doc), 3)).toBe('https://example.com?a=1&b=2')
    expect(workspaceMarkdownLinkAt(state(doc), doc.indexOf('example.org'))).toBe('https://example.org')
    expect(workspaceMarkdownLinkAt(state(doc), doc.indexOf('and'))).toBeNull()
  })
  it('matches installed scalar/list frontmatter and leaves plain thematic rules visible', () => {
    const doc = '\uFEFF---\ntitle: "A\\nB"\ntags: [one, "two, three", \'it\'\'s\']\nauthors:\n - Alice\n - Bob\nobject:\n nested: hidden\nblock: |\n---\n# Body'
    expect(workspaceMarkdownFrontmatter(doc)?.entries).toEqual([{key: 'title', value: 'A\nB'}, {key: 'tags', value: ['one', 'two, three', "it's"]}, {key: 'authors', value: ['Alice', 'Bob']}])
    const metadata = workspaceMarkdownFrontmatter(doc)!
    expect(decorations(workspaceMarkdownDecorations(state(doc), false)).some((item) => item.from === 0 && item.to === metadata.to && item.block)).toBe(true)
    for (const value of ['---\nplain text\n---\nbody', '---\ntitle: A\nbody', 'body\n---\nkey: value\n---']) expect(workspaceMarkdownFrontmatter(value)).toBeNull()
  })
})

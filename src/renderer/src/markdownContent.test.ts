import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './App'

describe('MarkdownContent', () => {
  it('keeps Markdown component identities stable across streamed token updates', () => {
    const componentMap = (content: ReactNode): unknown =>
      (content as ReactElement<{ children: ReactElement<{ components: unknown }> }>).props
        .children.props.components
    const initial = MarkdownContent({
      text: '```mermaid\nflowchart LR\n  A --> B\n```\n\nNext',
      streaming: true
    })
    const updated = MarkdownContent({
      text: '```mermaid\nflowchart LR\n  A --> B\n```\n\nNext token',
      streaming: true
    })

    expect(componentMap(updated)).toBe(componentMap(initial))
  })

  it('promotes Mermaid fences into an interactive diagram block', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: 'Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter'
      })
    )

    expect(html).toContain('class="mermaid-diagram is-loading"')
    expect(html).toContain('class="mermaid-diagram-loading is-placeholder"')
    expect(html).toContain('aria-label="正在加载 Mermaid 图表"')
    expect(html).toContain('class="mermaid-diagram-stage"')
    expect(html).not.toContain('<pre><div class="mermaid-diagram"')
  })

  it('renders ordinary code fences with language and copy chrome', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, { text: '```ts\nconst value = 1\n```' })
    )

    expect(html).toContain('class="markdown-code-block"')
    expect(html).toContain('TypeScript')
    expect(html).toContain('aria-label="复制代码"')
    expect(html).toContain('language-typescript')
    expect(html).not.toContain('mermaid-diagram')
  })

  it('reveals code copy only after the trailing streamed fence closes', () => {
    const openFence = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```text\npartial output',
        streaming: true
      })
    )
    const closedFence = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```text\ncomplete output\n```',
        streaming: true
      })
    )

    expect(openFence).toContain('aria-label="开启代码自动换行"')
    expect(openFence).not.toContain('aria-label="复制代码"')
    expect(closedFence).toContain('aria-label="复制代码"')
  })

  it('renders local source references as blue workspace file links', () => {
    const fileLink = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '- [src/main/index.ts (line 299)](src/main/index.ts#L299)'
      })
    )
    const externalLink = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '[Codex repository](https://github.com/openai/codex)'
      })
    )
    const implicitLocation = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '[App source](src/renderer/src/App.tsx#L277)'
      })
    )

    expect(fileLink).toContain('class="markdown-workspace-file-link"')
    expect(fileLink).toContain('class="markdown-workspace-file-icon"')
    expect(fileLink).toContain('data-workspace-path="src/main/index.ts"')
    expect(fileLink).toContain('data-workspace-line="299"')
    expect(fileLink).toContain('>TS</span>')
    expect(implicitLocation).toContain('App source (line 277)')
    expect(implicitLocation).toContain('markdown-workspace-file-icon is-react')
    expect(implicitLocation).toContain('lucide-atom')
    expect(externalLink).toContain('href="https://github.com/openai/codex"')
    expect(externalLink).not.toContain('markdown-workspace-file-link')
  })

  it('renders Codex source citations as workspace links without touching code spans', () => {
    const citation = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: 'See 【src/renderer/src/App.tsx†L277C9-L283C4】.'
      })
    )
    const code = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '`【src/main/index.ts†L299-L306】`\n\n```text\n【README.md†L5】\n```'
      })
    )

    expect(citation).toContain('class="markdown-workspace-file-link"')
    expect(citation).toContain('data-workspace-path="src/renderer/src/App.tsx"')
    expect(citation).toContain('data-workspace-line="277"')
    expect(citation).toContain('data-workspace-column="9"')
    expect(citation).toContain('data-workspace-end-line="283"')
    expect(citation).toContain('App.tsx (lines 277–283)')
    expect(citation).not.toContain('>src/renderer/src/App.tsx (lines 277–283)<')
    expect(code).not.toContain('markdown-workspace-file-link')
  })

  it('keeps only a trailing in-progress Mermaid fence in its loading state', () => {
    const streaming = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --> B',
        streaming: true
      })
    )
    const completedEarlierBlock = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --> B\n```\n\nNext section',
        streaming: true
      })
    )
    const completedTrailingBlock = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --> B\n```',
        streaming: true
      })
    )

    expect(streaming).toContain('is-loading is-streaming')
    expect(completedEarlierBlock).toContain('class="mermaid-diagram is-loading"')
    expect(completedEarlierBlock).not.toContain('is-streaming')
    expect(completedTrailingBlock).toContain('class="mermaid-diagram is-loading"')
    expect(completedTrailingBlock).not.toContain('is-streaming')
  })
})

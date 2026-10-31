import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodeBlock, highlightCode, normalizeCodeLanguage } from './CodeBlock'

const styles = readFileSync(new URL('./CodeBlock.css', import.meta.url), 'utf8')

describe('CodeBlock', () => {
  it('normalizes common fence aliases and falls back safely', () => {
    expect(normalizeCodeLanguage('ts')).toBe('typescript')
    expect(normalizeCodeLanguage('HTML')).toBe('xml')
    expect(normalizeCodeLanguage('made-up-language')).toBe('plaintext')
  })

  it('escapes source text while highlighting known syntax', () => {
    const html = highlightCode('const value = "<safe>"', 'ts')

    expect(html).toContain('hljs-keyword')
    expect(html).toContain('&lt;safe&gt;')
    expect(html).not.toContain('<safe>')
  })

  it('renders the target-style language and copy chrome', () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlock, { code: 'const value = 1', language: 'ts' })
    )

    expect(html).toContain('class="markdown-code-block"')
    expect(html).toContain('TypeScript')
    expect(html).toContain('viewBox="0 0 20 20"')
    expect(html).not.toContain('lucide-')
    expect(html).toContain('aria-label="启用自动换行"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="复制代码"')
    expect(html).not.toContain('>Copy<')
    expect(html).toContain('language-typescript')
  })

  it('localizes the plaintext label shown in the recorded UI', () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlock, { code: 'plain text', language: 'text' })
    )

    expect(html).toContain('纯文本')
    expect(html).toContain('language-plaintext')
  })

  it('can hide copy chrome while a streamed fence is still open', () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlock, {
        code: 'partial output',
        language: 'text',
        copyable: false
      })
    )

    expect(html).toContain('aria-label="启用自动换行"')
    expect(html).not.toContain('aria-label="复制代码"')
    expect(html).not.toContain('lucide-copy')
  })

  it('keeps the recorded unified surface and wrapping states', () => {
    expect(styles).toMatch(
      /\.markdown-code-block\s*\{[^}]*border-radius: 20px;[^}]*background: #181818;/s
    )
    expect(styles).toMatch(
      /\.markdown-code-block figcaption\s*\{[^}]*min-height: 48px;[^}]*padding: 0 6px 0 20px;[^}]*background: transparent;/s
    )
    expect(styles).toMatch(
      /\.markdown-body \.markdown-code-block > pre\s*\{[^}]*margin: 0;[^}]*padding: 0 20px 12px;[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent;/s
    )
    expect(styles).not.toMatch(/\.markdown-code-block figcaption\s*\{[^}]*border-bottom:/s)
    expect(styles).toMatch(
      /\.markdown-code-block\.is-wrapped code\.hljs\s*\{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/s
    )
  })
})

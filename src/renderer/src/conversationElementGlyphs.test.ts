import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ActivityGlyph } from './ActivityGlyph'
import { conversationElementGlyphs } from './conversationElementGlyphs'
import { ToolActivity } from './ToolActivity'

vi.mock('./useActivityDisclosure', () => ({
  useActivityDisclosure: () => ({ expanded: true, mounted: true, visible: true, setOpen: vi.fn() })
}))

// Independent fingerprints from build 22943 static AST/SVG extraction.
const sourceGeometryHashes = {
  systemError: '520754940aa553cd86ed90f2dc9c84c14bf90d47df5ce80b6f845d8ed8efa75c',
  streamError: '4ddc2a356b85640a820eed8d63a7376f1303bd65185fcd1439aeee7af26bec45',

  read: '9bc2e826b30f738d14118cf79d0799de473fc5efb231391d5bb71ce727f628d5',
  copySmall: '8d45358cf5bdc157b21a7047b253e0e02ebdb98c86e8f34806672ffafa11351e',
  checkSmall: 'f523f67b4f432bdf1c9ed768d079bc828eebae8374218bc6e07e0adbee30037d',
  codeOverflow: 'd6e200a0f1c8244bb620c1abdecf9a7d9758e743bf6ae2103f856eefe7e087e0',
  codeWrap: 'cafaf97f39adbfb3c617b7b4810515d0300e33ad4a1b46aaacd7bd85ffdb9d33',
  codeLanguage: '4e01e8ed0e2653bd18842c6ba826dc15ed19a9e58fe3340c2745d69f59fd436d',
  more: '173b133a662fd0047c86e36a4417633ffc5c3b2497cc45e0752eb18fa5b1c8a4',
  fork: 'f1f169e4941d0c82ffea3766db7bf42daa933a1d72fc87ee701792c354ef0549',
  close: 'b3b4e2d5fac39e272d3c4667e731ea521f14232e35a2750939d612fc277e321c',
  contextCompaction: 'a82c119e0c176718daf270f18e3ce476d5ccb434bf250be67c899bab96e2282b',
  code: '7d2d7dbb474b7876767064da29e5c7d2307be38cf8b8ff164d185506286aed03'
} as const

describe('installed conversation element SVG geometry', () => {
  it.each(Object.keys(sourceGeometryHashes) as Array<keyof typeof sourceGeometryHashes>)('preserves %s canvas and every filled path', (kind) => {
    const geometry = conversationElementGlyphs[kind]
    expect(createHash('sha256').update(JSON.stringify(geometry)).digest('hex')).toBe(sourceGeometryHashes[kind])
    const html = renderToStaticMarkup(createElement(ActivityGlyph, { kind, 'aria-hidden': true }))
    expect(html).toContain(`viewBox="${geometry.viewBox}"`)
    expect(html).toContain(`width="${geometry.width}" height="${geometry.height}"`)
    for (const path of geometry.paths) expect(html).toContain(`d="${path.d}"`)
    expect(html).not.toContain('stroke=')
    expect(html).not.toContain('lucide')
  })

  it('uses the source code-slash glyph for the raw-output entry with its exact label', () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, {
      item: { type: 'mcpToolCall', id: 'tool', server: 'example', tool: 'read', status: 'completed' }
    }))
    expect(html).toContain('aria-label="显示原始工具调用输出"')
    expect(html).toContain(`d="${conversationElementGlyphs.code.paths[0].d}"`)
    expect(html).not.toContain('lucide-braces')
  })

  it('uses the source text-selection glyph for context compaction', () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, {
      item: { type: 'contextCompaction', id: 'compaction', status: 'completed' }
    }))
    expect(html).toContain('上下文已自动压缩')
    expect(html).toContain(`d="${conversationElementGlyphs.contextCompaction.paths[0].d}"`)
    expect(html).not.toContain('lucide-minimize')
  })

  it.each([
    [false, 'systemError'],
    [true, 'streamError']
  ] as const)('uses the installed error asset when willRetry is %s', (willRetry, kind) => {
    const html = renderToStaticMarkup(createElement(ToolActivity, {
      item: { type: 'error', id: 'error', willRetry, message: '连接失败', additionalDetails: '连接详情' }
    }))
    expect(html).toContain(`class="tool-activity-system-error${willRetry ? ' is-retrying' : ''}" role="status"`)
    expect(html).toContain('width="16" height="16" viewBox="0 0 16 16"')
    for (const path of conversationElementGlyphs[kind].paths) expect(html).toContain(`d="${path.d}"`)
    expect(html).toContain('<span>连接失败</span>')
    expect(html).toContain('<details><summary>显示详情</summary><pre>连接详情</pre></details>')
    expect(html).not.toContain('lucide')
    expect(html).not.toContain('stroke=')
  })

  it('uses the installed default code-toolbar density and avoids a selected fill', () => {
    const styles = readFileSync(new URL('./CodeBlock.css', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.markdown-code-actions\s*\{[^}]*gap: 1px/s)
    expect(styles).toMatch(/figcaption button\s*\{[^}]*width: 36px;[^}]*height: 36px;[^}]*border-radius: 50%/s)
    expect(styles).toContain('.markdown-code-language > svg { width: 20px; height: 20px; }')
    expect(styles).not.toContain('button.is-active')
  })
})

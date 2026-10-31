import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RawToolOutputDialog } from './ToolActivity'

vi.mock('react-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-dom')>(),
  createPortal: (children: unknown) => children
}))
const styles = readFileSync(new URL('./toolActivity.css', import.meta.url), 'utf8')
afterEach(() => vi.unstubAllGlobals())

describe('raw tool output dialog', () => {
  it('uses the source JSON toolbar and keeps invocation data inspectable', () => {
    vi.stubGlobal('document', { body: {} })
    const html = renderToStaticMarkup(createElement(RawToolOutputDialog, {
      item: {
        type: 'mcpToolCall', id: 'call', server: 'example', tool: 'lookup', status: 'completed',
        arguments: { query: '<safe>' }, result: { content: [{ type: 'text', text: 'found' }] }
      },
      onClose: vi.fn()
    }))
    expect(html).toContain('role="dialog" aria-modal="true"')
    expect(html).toContain('原始 example.lookup 工具调用输出')
    expect(html).toContain('class="tool-raw-output-close" aria-label="关闭对话框"')
    expect(html).toContain('language-json')
    expect(html).toContain('aria-label="启用自动换行"')
    expect(html).toContain('aria-label="复制代码"')
    expect(html).toContain('&lt;safe&gt;')
    expect(html).toContain('found')
    expect(html).not.toContain('复制原始输出')
    expect(html).not.toContain('lucide-')
  })

  it('keeps dialog sizing and toolbar styling scoped to their own elements', () => {
    expect(styles).toMatch(/\.tool-raw-output-dialog\s*\{[^}]*width: 520px;[^}]*max-width: 92vw;[^}]*padding: 20px;[^}]*border-radius: 20px;/s)
    expect(styles).toMatch(/\.tool-raw-output-close\s*\{[^}]*top: 16px;[^}]*right: 16px;[^}]*padding: 4px;[^}]*border-radius: 4px;/s)
    expect(styles).toMatch(/\.tool-raw-output-code > \.markdown-code-block > pre\s*\{\s*max-height: 512px;/s)
    expect(styles).not.toMatch(/\.tool-raw-output-dialog button\s*\{/)
    expect(styles).not.toMatch(/\.tool-raw-output-code button\s*\{/)
  })
})

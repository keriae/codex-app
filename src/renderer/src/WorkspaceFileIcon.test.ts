import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceFileIcon, workspaceFileIconToken } from './WorkspaceFileIcon'
import recovered from './assets/workspaceFileIcons.json'

describe('recovered workspace file icons', () => {
  it('preserves filename precedence over ordinary extensions', () => {
    expect(workspaceFileIconToken('/project/.gitignore')).toBe('git')
    expect(workspaceFileIconToken('/project/package.json')).toBe('json')
    expect(workspaceFileIconToken('/project/vite.config.ts')).toBe('vite')
    expect(workspaceFileIconToken('/project/Dockerfile')).toBe('docker')
    expect(workspaceFileIconToken('/project/prettier.config.js')).toBe('prettier')
  })
  it('preserves the complete set and compound filename suffixes', () => {
    expect(workspaceFileIconToken('/project/App.tsx')).toBe('react')
    expect(workspaceFileIconToken('/project/definition.d.ts')).toBe('typescript')
    expect(workspaceFileIconToken('/project/content.mdx.tsx')).toBe('markdown')
    expect(workspaceFileIconToken('/project/styles.scss')).toBe('sass')
    expect(workspaceFileIconToken('/project/data.jsonl')).toBe('json')
    expect(workspaceFileIconToken('/project/example.unknown')).toBe('default')
  })
  it('renders the inert recovered glyph with its original color token', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceFileIcon, { path: '/project/file.ts' }))
    expect(html).toContain('data-workspace-file-icon="typescript"')
    expect(html).toContain('var(--workspace-file-icon-typescript, var(--text-muted))')
    expect(html).toContain('opacity=".2"')
    expect(html).not.toContain('<script')
  })
  it('keeps every recovered payload within static SVG shapes and local gradient references', () => {
    const tags = new Set(['path', 'defs', 'linearGradient', 'stop'])
    for (const symbol of Object.values(recovered.symbols)) {
      expect(symbol.viewBox).toMatch(/^0 0 \d+ \d+$/)
      for (const match of symbol.body.matchAll(/<\/?([\w:-]+)\b/g)) expect(tags.has(match[1])).toBe(true)
      expect(symbol.body).not.toMatch(/\b(?:on\w+|href|xlink:href|src|style)\s*=/i)
      expect(symbol.body).not.toMatch(/(?:https?:|data:|javascript:|<\?)/i)
      const ids = new Set([...symbol.body.matchAll(/\bid="([\w-]+)"/g)].map((match) => match[1]))
      for (const match of symbol.body.matchAll(/url\(([^)]+)\)/g)) {
        expect(match[1]).toMatch(/^#[\w-]+$/)
        expect(ids.has(match[1].slice(1))).toBe(true)
      }
    }
    const tokens = [...Object.values(recovered.fileNames), ...Object.values(recovered.extensions), ...Object.values(recovered.completeExtensions)]
    for (const token of tokens) expect(Object.hasOwn(recovered.symbols, token)).toBe(true)
  })
})

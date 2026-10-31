import { createHash } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkbenchElementGlyph } from './WorkbenchElementGlyph'
import glyphs from './assets/workbenchElementGlyphs.json'
import evidence from '../../../reverse/workbench-element-evidence-2026-10-31.json'

describe('original macOS workbench glyphs', () => {
  it('retains every exact path payload recorded in the source evidence', () => {
    for (const [name, glyph] of Object.entries(glyphs)) {
      const original = evidence.glyphs.find((item) => item.name === name)
      expect(original, name).toBeDefined()
      expect(createHash('sha256').update(glyph.body).digest('hex'), name).toBe(original?.bodySha256)
      expect(glyph.viewBox).toBe(`0 0 ${glyph.width} ${glyph.height}`)
    }
  })

  it('keeps original canvas geometry when scaling and rotating a tab close or tree chevron', () => {
    const close = renderToStaticMarkup(createElement(WorkbenchElementGlyph, { name: 'tab-close-original-21', size: 14 }))
    expect(close).toContain('width="14" height="14" viewBox="0 0 21 21"')
    const chevron = renderToStaticMarkup(createElement(WorkbenchElementGlyph, { name: 'chevron-down-md-light-12', rotate: -90 }))
    expect(chevron).toContain('width="12" height="12" viewBox="0 0 12 12"')
    expect(chevron).toContain('transform:rotate(-90deg)')
    const fileTree = renderToStaticMarkup(createElement(WorkbenchElementGlyph, { name: 'file-tree-toggle-original-20', size: 18 }))
    expect(fileTree).toContain('width="18" height="18" viewBox="0 0 20 20"')
  })

  it('limits embedded SVG to inert paths using the inherited foreground color', () => {
    for (const glyph of Object.values(glyphs)) {
      expect([...glyph.body.matchAll(/<\/?([\w:-]+)\b/g)].every((match) => match[1] === 'path')).toBe(true)
      expect(glyph.body).not.toMatch(/\b(?:on\w+|href|xlink:href|src|style)\s*=|(?:https?:|data:|javascript:|url\()/i)
      expect(glyph.body).toContain('fill="currentColor"')
    }
  })
})

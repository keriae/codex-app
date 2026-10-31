import type { CSSProperties, ReactNode } from 'react'
import glyphs from './assets/workbenchElementGlyphs.json'

export type WorkbenchElementGlyphName = keyof typeof glyphs

/** Inert paths extracted from the installed macOS app's custom icon assets. */
export function WorkbenchElementGlyph({ name, className, size, rotate, style }: {
  name: WorkbenchElementGlyphName
  className?: string
  size?: number
  rotate?: number
  style?: CSSProperties
}): ReactNode {
  const glyph = glyphs[name]
  return <svg width={size ?? glyph.width} height={size ?? glyph.height} viewBox={glyph.viewBox}
    className={className} data-workbench-glyph={name} aria-hidden="true" focusable="false" fill="none" stroke="none"
    style={{ flexShrink: 0, ...(rotate ? { transform: `rotate(${rotate}deg)` } : {}), ...style }}
    dangerouslySetInnerHTML={{ __html: glyph.body }} />
}

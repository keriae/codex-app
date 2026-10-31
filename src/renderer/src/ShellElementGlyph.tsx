import type { CSSProperties, ReactNode, SVGProps } from 'react'
import glyphs from './assets/shellElementGlyphs.json'

export type ShellElementGlyphName = keyof typeof glyphs | 'check' | 'chevron-down' | 'lock' | 'shield-check'

/** Shipped 22943 glyph geometry; sizing remains owned by each original control. */
export function ShellElementGlyph({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: ShellElementGlyphName }): ReactNode {
  if (Object.hasOwn(glyphs, name)) {
    const glyph = glyphs[name as keyof typeof glyphs]
    const p3 = name === 'multicolor-scribble-light-16'
    return <svg width={glyph.width} height={glyph.height} viewBox={glyph.viewBox} fill={glyph.fill} stroke="none"
      aria-hidden="true" focusable="false" {...props} style={{ flexShrink: 0,
        ...(p3 ? { '--icon-authored-04bb9f': 'var(--icon-p3-authored-04bb9f, #04BB9F)' } as CSSProperties : {}), ...props.style }}
      data-icon-p3={p3 ? name : undefined}
      data-shell-glyph={name} dangerouslySetInnerHTML={{ __html: glyph.body }} />
  }
  if (name === 'lock') {
    return <svg width={18} height={18} viewBox="0 0 18 18" fill="none" aria-hidden="true" {...props}>
      <rect x={3.19995} y={6.20001} width={11.6} height={8.8} rx={2.25} stroke="currentColor" strokeWidth={1.33} />
      <path d="M5.30005 6.29999V5.99999C5.30005 3.95653 6.9566 2.29999 9.00005 2.29999C11.0435 2.29999 12.7 3.95653 12.7 5.99999V6.29999" stroke="currentColor" strokeWidth={1.33} strokeLinejoin="round" />
      <path d="M8.5 10.5H9.5" stroke="currentColor" strokeWidth={1.33} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  }
  if (name === 'shield-check') {
    return <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M15.344 10.036a1 1 0 1 0-1.688-1.072l-2.474 3.896-.943-1.034a1 1 0 0 0-1.478 1.348l1.826 2a1 1 0 0 0 1.583-.138l3.174-5Z" />
      <path fillRule="evenodd" d="M13.203 1.935a3 3 0 0 0-2.405 0l-6 2.625A3 3 0 0 0 3 7.308V13a9 9 0 1 0 18 0V7.308a3 3 0 0 0-1.797-2.748l-6-2.625Zm-1.604 1.832a1 1 0 0 1 .802 0l6 2.625a1 1 0 0 1 .599.916V13a7 7 0 1 1-14 0V7.308a1 1 0 0 1 .6-.916l6-2.625Z" clipRule="evenodd" />
    </svg>
  }
  return <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
    {name === 'check'
      ? <path d="M11.5625 4.0338C11.7255 3.79403 12.0522 3.73111 12.292 3.89415C12.5315 4.05717 12.5934 4.38398 12.4306 4.62364L7.53904 11.818C7.30088 12.1681 6.80224 12.215 6.50291 11.9156L3.62791 9.03478C3.42314 8.82953 3.42368 8.4964 3.62889 8.29161C3.83415 8.08683 4.16726 8.08733 4.37205 8.29259L6.92478 10.8512L11.5625 4.0338Z" fill="currentColor" />
      : <path d="M11.6289 6.29537C11.8339 6.09035 12.166 6.09035 12.3711 6.29537C12.5761 6.5004 12.5761 6.83253 12.3711 7.03756L8.60641 10.8022C8.27129 11.1369 7.72863 11.1369 7.39352 10.8022L3.62887 7.03756C3.42384 6.83253 3.42384 6.5004 3.62887 6.29537C3.83389 6.09035 4.16603 6.09035 4.37105 6.29537L7.99996 9.92428L11.6289 6.29537Z" fill="currentColor" />}
  </svg>
}

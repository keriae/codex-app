import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  adjacentDiagramViewerZoom,
  anchorDiagramViewerPan,
  constrainDiagramViewerPan,
  DIAGRAM_VIEWER_ZOOM_STEPS,
  diagramMenuPlacement,
  diagramViewerZoomFloor,
  fitDiagramZoom,
  hasImprovedFlowchartTheme,
  MermaidDiagram,
  MermaidSourceFallback,
  mermaidRenderConfig,
  mermaidThemeVariables,
  sanitizeMermaidSource,
  svgDimensionsFromMarkup,
  zoomFromWheel
} from './MermaidDiagram'

const styles = readFileSync(new URL('./mermaidDiagram.css', import.meta.url), 'utf8')

describe('MermaidDiagram parity contract', () => {
  it('renders the original preview lifecycle shell before Mermaid is ready', () => {
    const html = renderToStaticMarkup(
      createElement(MermaidDiagram, { code: 'flowchart LR\n  A --> B' })
    )

    expect(html).toContain('class="mermaid-diagram is-loading"')
    expect(html).toContain('class="mermaid-preview"')
    expect(html).toContain('class="mermaid-diagram-stage"')
    expect(html).toContain('class="mermaid-diagram-layer is-pending"')
    expect(html).toContain('class="mermaid-diagram-loading is-placeholder"')
    expect(html).toContain('aria-label="正在加载 Mermaid 图表"')
    expect(html).toContain('data-markdown-copy="code-block"')
    expect(html).toContain('data-wide-markdown-block-kind="mermaid"')
  })

  it('does not parse or reserve a wide preview for an open streaming fence', () => {
    const html = renderToStaticMarkup(
      createElement(MermaidDiagram, {
        code: 'flowchart LR\n  A --',
        streaming: true
      })
    )

    expect(html).toContain('class="mermaid-diagram is-loading is-streaming"')
    expect(html).toContain('data-markdown-copy="exclude"')
    expect(html).toContain('data-mermaid-streaming="true"')
    expect(html).toContain('正在加载图表')
    expect(html).not.toContain('data-wide-markdown-block')
    expect(html).not.toContain('data-markdown-copy-text')
  })

  it('uses the measured Mermaid configuration and intrinsic sizing', () => {
    const config = mermaidRenderConfig('dark')

    expect(config.theme).toBe('base')
    expect(config.securityLevel).toBe('strict')
    expect(config.suppressErrorRendering).toBe(true)
    expect(config.htmlLabels).toBe(false)
    expect(config.layout).toBe('chatgpt-flowchart')
    expect(config.flowchart).toMatchObject({ htmlLabels: false, useMaxWidth: false })
    expect(config.sequence).toEqual({ useMaxWidth: false })
    expect(mermaidRenderConfig('dark', false).layout).toBe('elk')
    expect(hasImprovedFlowchartTheme('%% comment\nflowchart LR\n A --> B')).toBe(true)
    expect(hasImprovedFlowchartTheme('sequenceDiagram\n A->>B: Hello')).toBe(false)
  })

  it('keeps the measured dark/default visualization tokens', () => {
    const theme = mermaidThemeVariables('dark')

    expect(theme.fontFamily).toBe('-apple-system, "system-ui", "Segoe UI", sans-serif')
    expect(theme.background).toBe('transparent')
    expect(theme.flowchartNodeColor).toBe('rgb(0, 40, 77)')
    expect(theme.flowchartDecisionColor).toBe('#000e1a')
    expect(theme.flowchartTextColor).toBe('#99ceff')
    expect(theme.lineColor).toBe('rgba(252, 252, 252, 0.498)')
    expect(theme.cScale0).toBe('rgb(31, 78, 148)')
    expect(theme.cScale6).toBe('rgb(31, 78, 148)')
  })

  it('removes unsafe directives and click callbacks before rendering', () => {
    expect(
      sanitizeMermaidSource(
        '%%{init: {"theme":"dark"}}%%\nflowchart LR\nA --> B\nclick A callback'
      )
    ).toBe('flowchart LR\nA --> B')
    expect(
      sanitizeMermaidSource(
        '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA --> B'
      )
    ).toBeNull()
  })

  it('preserves intrinsic view-box dimensions', () => {
    expect(
      svgDimensionsFromMarkup('<svg width="100%" viewBox="4 4 526.359375 176"></svg>')
    ).toEqual({ width: 526.359375, height: 176 })
    expect(svgDimensionsFromMarkup('<svg width="640" height="480"></svg>')).toEqual({
      width: 640,
      height: 480
    })
  })

  it('fits and wheel-zooms like the shared image viewer', () => {
    expect(fitDiagramZoom(1_000, 600, 526.359375, 176)).toBe(1)
    expect(fitDiagramZoom(400, 100, 526.359375, 176)).toBeCloseTo(100 / 176)
    expect(fitDiagramZoom(400, 100, 100_000, 100_000)).toBe(0.01)
    expect(zoomFromWheel(0.5, -100)).toBeCloseTo(0.5 * Math.exp(0.5))
    expect(zoomFromWheel(0.5, 100)).toBeCloseTo(0.5 * Math.exp(-0.5))
  })

  it('uses the recovered 25–500 percent ramp while preserving arbitrary fit zoom', () => {
    expect(DIAGRAM_VIEWER_ZOOM_STEPS).toEqual([
      0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5
    ])
    expect(adjacentDiagramViewerZoom(0.4505, -1, 0.4505)).toBe(0.33)
    expect(adjacentDiagramViewerZoom(0.4505, 1, 0.4505)).toBe(0.5)
    expect(adjacentDiagramViewerZoom(5, 1, 0.45)).toBe(5)
    expect(diagramViewerZoomFloor(0.1)).toBe(0.1)
  })

  it('anchors zoom under the pointer and constrains pan to diagram bounds', () => {
    expect(anchorDiagramViewerPan({ x: 0, y: 0 }, { x: 100, y: 50 }, 1, 2)).toEqual({
      x: -100,
      y: -50
    })
    expect(constrainDiagramViewerPan(
      { x: 500, y: -500 },
      { width: 800, height: 600 },
      { width: 1_000, height: 800 },
      1
    )).toEqual({ x: 100, y: -100 })
    expect(constrainDiagramViewerPan(
      { x: 40, y: 20 },
      { width: 800, height: 600 },
      { width: 200, height: 100 },
      1
    )).toEqual({ x: 0, y: 0 })
  })

  it('flips the actions menu only when the lower viewport would clip it', () => {
    expect(diagramMenuPlacement(200, 236, 100, 800)).toBe('down')
    expect(diagramMenuPlacement(720, 756, 100, 800)).toBe('up')
    expect(styles).toContain('.mermaid-diagram-menu.is-up')
    expect(styles).toContain('bottom: 40px')
  })

  it('falls back to copyable plaintext source when Mermaid rendering fails', () => {
    const html = renderToStaticMarkup(createElement(MermaidSourceFallback, {
      source: 'flowchart LR\n  A[<unsafe>] --> B',
      error: 'Parse error'
    }))

    expect(html).toContain('data-mermaid-render-status="error"')
    expect(html).toContain('aria-label="复制 Mermaid 源代码"')
    expect(html).toContain('flowchart LR')
    expect(html).toContain('&lt;unsafe&gt;')
    expect(html).not.toContain('Invalid or unsupported diagram')
  })
})

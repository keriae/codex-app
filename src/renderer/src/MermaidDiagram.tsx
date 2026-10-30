import { copyTextToClipboard } from './clipboard'
import {
  Check,
  Code2,
  Copy,
  Download,
  Maximize2,
  Minus,
  MoreHorizontal,
  Plus,
  X
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import type {
  InternalHelpers,
  LayoutData,
  LayoutLoaderDefinition,
  RenderOptions,
  SVG
} from 'mermaid'
import { ActivityTooltip } from './ActivityTooltip'
import './mermaidDiagram.css'

type DiagramTheme = 'dark' | 'light'

interface MermaidRenderState {
  code: string
  error: string | null
  svg: string | null
}

interface SvgSnapshot {
  height: number
  markup: string
  width: number
}

export interface DiagramViewerSize {
  height: number
  width: number
}

export interface DiagramViewerPoint {
  x: number
  y: number
}

interface MermaidDiagramProps {
  code: string
  onShowSource?(): void
  streaming?: boolean
}

const SVG_FALLBACK_WIDTH = 1_200
const SVG_FALLBACK_HEIGHT = 800
export const DIAGRAM_VIEWER_ZOOM_STEPS = [
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
  4,
  5
] as const
const MIN_VIEWER_FIT_ZOOM = 0.01
const MAX_VIEWER_ZOOM = DIAGRAM_VIEWER_ZOOM_STEPS.at(-1)!
const VIEWER_PADDING = 16

let mermaidRenderSequence = 0
let codexFlowchartRegistration: Promise<void> | null = null
let mermaidRenderQueue: Promise<void> = Promise.resolve()

function nextRenderId(reactId: string): string {
  mermaidRenderSequence += 1
  return `codex-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${mermaidRenderSequence}`
}

type MermaidRuntime = typeof import('mermaid')['default']

interface FlowchartEdge {
  arrowTypeEnd?: string
  arrowTypeStart?: string
  height?: number
  label?: string
  points?: Array<{ x: number; y: number }>
  width?: number
  [key: string]: unknown
}

const DECISION_SHAPES = new Set(['diamond', 'diam', 'decision', 'question'])
const RECTANGLE_SHAPES = new Set([
  'rect',
  'squareRect',
  'proc',
  'process',
  'rectangle',
  'rounded',
  'roundedRect',
  'event'
])

function patchFlowchartNodes(layout: LayoutData): void {
  for (const node of layout.nodes) {
    if (node.isGroup) continue
    if (DECISION_SHAPES.has(node.shape || '')) {
      node.shape = 'rect'
      node.cssClasses = `${node.cssClasses || ''} mermaid-decision`
    }
    if (RECTANGLE_SHAPES.has(node.shape || '')) {
      node.shape = 'rect'
      node.padding = 16
      node.labelPaddingX = 36
      node.height = Math.max(node.height || 0, 60)
    }
  }
}

function shortenPointMarkerSegments(edge: FlowchartEdge): FlowchartEdge {
  const points = edge.points || []
  const adjusted = points.map((point) => ({ ...point }))
  const endpoints: Array<[number, number, string | undefined]> = [
    [0, 1, edge.arrowTypeStart],
    [points.length - 1, points.length - 2, edge.arrowTypeEnd]
  ]

  for (const [endpointIndex, neighborIndex, arrowType] of endpoints) {
    const endpoint = points[endpointIndex]
    const neighbor = points[neighborIndex]
    if (arrowType !== 'arrow_point' || !endpoint || !neighbor) continue
    const dx = neighbor.x - endpoint.x
    const dy = neighbor.y - endpoint.y
    const length = Math.hypot(dx, dy)
    if (length === 0) continue
    const inset = Math.min(8, Math.max(0, length / 2 - 4))
    adjusted[endpointIndex] = {
      x: endpoint.x + (dx / length) * inset,
      y: endpoint.y + (dy / length) * inset
    }
  }

  return { ...edge, points: adjusted }
}

function patchedFlowchartHelpers(helpers: InternalHelpers): InternalHelpers {
  const insertEdge = helpers.insertEdge as (
    ...args: unknown[]
  ) => ReturnType<InternalHelpers['insertEdge']>
  return {
    ...helpers,
    insertEdge(
      element: unknown,
      edge: FlowchartEdge,
      ...rest: unknown[]
    ): ReturnType<InternalHelpers['insertEdge']> {
      return insertEdge(element, shortenPointMarkerSegments(edge), ...rest)
    },
    async insertEdgeLabel(element: unknown, edge: FlowchartEdge): Promise<SVGGElement> {
      const label = await helpers.insertEdgeLabel(element, edge)
      const background = label.querySelector<SVGRectElement>('rect.background')
      const text = label.querySelector<SVGTextElement>('text')
      if (edge.label && background && text) {
        const textBox = text.getBBox()
        const height = Math.max(26, textBox.height + 8)
        const verticalInset = (height - textBox.height) / 2
        background.setAttribute('x', String(textBox.x - 12))
        background.setAttribute('y', String(textBox.y - verticalInset))
        background.setAttribute('width', String(textBox.width + 24))
        background.setAttribute('height', String(height))
        background.style.removeProperty('stroke')

        const labelBox = label.getBBox()
        edge.width = labelBox.width
        edge.height = labelBox.height
        label.parentElement?.setAttribute(
          'transform',
          `translate(${-labelBox.x - labelBox.width / 2},${-labelBox.y - labelBox.height / 2})`
        )
      }
      return label
    }
  }
}

function patchFlowchartMarkers(svg: SVG): void {
  const selection = svg as unknown as {
    selectAll(selector: string): {
      attr(name: string, value: string | number): ReturnType<typeof selection.selectAll>
      selectAll(selector: string): ReturnType<typeof selection.selectAll>
      style(name: string, value: string): ReturnType<typeof selection.selectAll>
    }
  }
  const arrowMarkers = selection.selectAll(
    'marker[id$="-pointEnd"], marker[id*="-pointEnd_"], marker[id$="-pointStart"], marker[id*="-pointStart_"]'
  )
  arrowMarkers
    .attr('viewBox', '-5 -5 10 10')
    .attr('markerWidth', 10)
    .attr('markerHeight', 10)
    .attr('refX', 0)
    .attr('refY', 0)
    .selectAll('path')
    .style('fill', 'none')
    .style('stroke-width', '1')
    .style('stroke-dasharray', 'none')
    .style('stroke-linecap', 'round')
    .style('stroke-linejoin', 'round')

  const diagonal = 4.5 / Math.SQRT2
  const shoulder = 4 - diagonal
  selection
    .selectAll('marker[id$="-pointEnd"] path, marker[id*="-pointEnd_"] path')
    .attr('d', `M 0 0 L 4 0 M ${shoulder} ${-diagonal} L 4 0 L ${shoulder} ${diagonal}`)
  selection
    .selectAll('marker[id$="-pointStart"] path, marker[id*="-pointStart_"] path')
    .attr('d', `M 0 0 L -4 0 M ${-shoulder} ${-diagonal} L -4 0 L ${-shoulder} ${diagonal}`)
}

function codexFlowchartLayout(elkLayout: LayoutLoaderDefinition): LayoutLoaderDefinition {
  return {
    name: 'chatgpt-flowchart',
    algorithm: elkLayout.algorithm,
    loader: async () => {
      const elkRenderer = await elkLayout.loader()
      return {
        async render(
          layout: LayoutData,
          svg: SVG,
          helpers: InternalHelpers,
          options?: RenderOptions
        ): Promise<void> {
          patchFlowchartNodes(layout)
          await elkRenderer.render(
            layout,
            svg,
            patchedFlowchartHelpers(helpers),
            options
          )
          patchFlowchartMarkers(svg)
        }
      }
    }
  }
}

function shadowIsolatedLayout(layout: LayoutLoaderDefinition): LayoutLoaderDefinition {
  return {
    ...layout,
    loader: async () => {
      const renderer = await layout.loader()
      return {
        async render(
          data: LayoutData,
          svg: SVG,
          helpers: InternalHelpers,
          options?: RenderOptions
        ): Promise<void> {
          const svgNode = svg.node()
          if (!(svgNode instanceof SVGElement) || !svgNode.parentElement) {
            throw new Error('Missing Mermaid render container')
          }

          const host = svgNode.ownerDocument.createElement('div')
          svgNode.parentElement.append(host)
          const shadowRoot = host.attachShadow({ mode: 'open' })
          shadowRoot.append(svgNode)
          const isolatedSvg = (svg as unknown as {
            selectAll(
              selector: (this: SVGElement) => SVGElement[]
            ): SVG
          }).selectAll(function selectCurrentSvg(this: SVGElement): SVGElement[] {
            return [this]
          })
          const insertMarkers = helpers.insertMarkers as (...args: unknown[]) => void
          const insertEdge = helpers.insertEdge as (...args: unknown[]) => unknown

          try {
            await renderer.render(
              data,
              isolatedSvg,
              {
                ...helpers,
                insertMarkers(...args: unknown[]): void {
                  insertMarkers(...args)
                  for (const marker of svgNode.querySelectorAll('marker')) {
                    host.append(marker.cloneNode(true))
                  }
                },
                insertEdge(...args: unknown[]): ReturnType<InternalHelpers['insertEdge']> {
                  const result = insertEdge(...args) as ReturnType<InternalHelpers['insertEdge']>
                  for (const marker of host.querySelectorAll('marker')) {
                    if (!shadowRoot.getElementById(marker.id)) {
                      svgNode.append(marker.cloneNode(true))
                    }
                  }
                  return result
                }
              },
              options
            )
          } finally {
            host.before(svgNode)
            host.remove()
          }
        }
      }
    }
  }
}

async function registerCodexFlowchartLayout(mermaid: MermaidRuntime): Promise<void> {
  codexFlowchartRegistration ??= import('@mermaid-js/layout-elk').then(({ default: layouts }) => {
    const elkLayout = layouts.find(({ name }) => name === 'elk')
    if (!elkLayout) throw new Error('Mermaid ELK layout is unavailable')
    mermaid.registerLayoutLoaders(
      [...layouts, codexFlowchartLayout(elkLayout)].map(shadowIsolatedLayout)
    )
  })
  await codexFlowchartRegistration
}

function queueMermaidRender<T>(render: () => Promise<T>): Promise<T> {
  const result = mermaidRenderQueue.then(render)
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function currentDiagramTheme(): DiagramTheme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function useDiagramTheme(): DiagramTheme {
  const [theme, setTheme] = useState<DiagramTheme>(currentDiagramTheme)

  useEffect(() => {
    const update = (): void => setTheme(currentDiagramTheme())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  return theme
}

function paletteEntries(palette: string[]): Record<string, string> {
  const entries: Record<string, string> = {}
  for (let index = 0; index < 12; index += 1) {
    const color = palette[index % palette.length]
    entries[`cScale${index}`] = color
    entries[`pie${index + 1}`] = color
    if (index < 8) {
      entries[`fillType${index}`] = color
      entries[`git${index}`] = color
    }
  }
  return entries
}

export function mermaidThemeVariables(theme: DiagramTheme): Record<string, string> {
  const dark = theme === 'dark'
  const palette = dark
    ? [
        'rgb(31, 78, 148)',
        'rgb(58, 132, 63)',
        'rgb(172, 79, 35)',
        'rgb(217, 163, 55)',
        'rgb(120, 73, 209)',
        'rgb(171, 79, 122)'
      ]
    : [
        'rgb(83, 154, 248)',
        'rgb(107, 198, 127)',
        'rgb(239, 139, 87)',
        'rgb(248, 212, 93)',
        'rgb(184, 151, 244)',
        'rgb(246, 142, 188)'
      ]
  const background = dark ? 'rgb(17, 17, 17)' : 'rgb(255, 255, 255)'
  const text = dark ? 'rgb(252, 252, 252)' : 'rgb(25, 25, 25)'
  const primary = dark ? 'rgb(21, 35, 56)' : 'rgb(229, 243, 255)'
  const primaryBorder = dark ? 'rgb(31, 78, 148)' : 'rgb(83, 154, 248)'
  const secondaryBorder = dark ? 'rgb(58, 132, 63)' : 'rgb(107, 198, 127)'
  const subtle = dark ? 'rgba(252, 252, 252, 0.03)' : 'rgba(25, 25, 25, 0.03)'
  const subtleBorder = dark ? 'rgba(252, 252, 252, 0.082)' : 'rgba(25, 25, 25, 0.082)'
  const line = dark ? 'rgba(252, 252, 252, 0.498)' : 'rgba(25, 25, 25, 0.498)'

  return {
    fontFamily: '-apple-system, "system-ui", "Segoe UI", sans-serif',
    fontSize: '14px',
    background: 'transparent',
    surfaceColor: background,
    primaryColor: primary,
    primaryTextColor: text,
    primaryBorderColor: primaryBorder,
    secondaryColor: subtle,
    secondaryTextColor: text,
    secondaryBorderColor: secondaryBorder,
    tertiaryColor: subtle,
    tertiaryTextColor: text,
    tertiaryBorderColor: subtleBorder,
    textColor: text,
    titleColor: text,
    lineColor: line,
    arrowheadColor: line,
    mainBkg: primary,
    nodeBkg: primary,
    nodeBorder: primaryBorder,
    nodeTextColor: text,
    clusterBkg: subtle,
    clusterBorder: subtleBorder,
    edgeLabelBackground: background,
    flowchartNodeColor: dark ? 'rgb(0, 40, 77)' : 'rgb(229, 243, 255)',
    flowchartNodeBorderColor: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    flowchartTextColor: dark ? '#99ceff' : '#004f99',
    flowchartDecisionColor: dark ? '#000e1a' : '#f5faff',
    flowchartLineColor: dark ? 'rgb(26, 62, 95)' : 'rgb(206, 219, 229)',
    flowchartEdgeLabelColor: dark ? '#000e1a' : '#f5faff',
    flowchartEdgeLabelBorderColor: dark ? 'rgb(26, 62, 95)' : 'rgb(206, 219, 229)',
    actorBkg: primary,
    actorBorder: primaryBorder,
    actorTextColor: text,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: text,
    labelBoxBkgColor: background,
    labelBoxBorderColor: subtleBorder,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: subtle,
    noteBorderColor: secondaryBorder,
    noteTextColor: text,
    sectionBkgColor: subtle,
    sectionBkgColor2: primary,
    taskBkgColor: primary,
    taskBorderColor: primaryBorder,
    activeTaskBkgColor: primary,
    activeTaskBorderColor: primaryBorder,
    doneTaskBkgColor: subtle,
    doneTaskBorderColor: subtleBorder,
    critBkgColor: subtle,
    critBorderColor: secondaryBorder,
    taskTextColor: text,
    taskTextOutsideColor: text,
    pieTitleTextColor: text,
    pieSectionTextColor: text,
    pieLegendTextColor: text,
    pieStrokeColor: background,
    pieStrokeWidth: '2px',
    pieOuterStrokeColor: background,
    pieOuterStrokeWidth: '2px',
    quadrant1TextFill: text,
    quadrant2TextFill: text,
    quadrant3TextFill: text,
    quadrant4TextFill: text,
    quadrantPointTextFill: text,
    quadrantXAxisTextFill: text,
    quadrantYAxisTextFill: text,
    quadrantTitleFill: text,
    ...paletteEntries(palette)
  }
}

function flowchartThemeCss(theme: Record<string, string>): string {
  return `
.node text {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: normal;
  fill: ${theme.flowchartTextColor};
}
.edgeLabels text {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.08px;
  fill: ${theme.flowchartTextColor};
}
.node tspan[font-weight="normal"],
.edgeLabels tspan[font-weight="normal"] {
  font-weight: 600;
}
.edgeLabel .label rect {
  opacity: 1;
  rx: 13px;
  ry: 13px;
  fill: ${theme.flowchartEdgeLabelColor};
  stroke: ${theme.flowchartEdgeLabelBorderColor};
  stroke-width: 1px;
}
.node rect,
.node circle,
.node ellipse,
.node polygon,
.node path {
  fill: ${theme.flowchartNodeColor};
  stroke: ${theme.flowchartNodeBorderColor};
  stroke-width: 1px;
}
.node rect {
  rx: 16px;
  ry: 16px;
}
.node.mermaid-decision .label-container {
  fill: ${theme.flowchartDecisionColor};
  stroke: ${theme.flowchartLineColor};
  stroke-dasharray: 2 2;
}
.edgePaths .flowchart-link {
  stroke: ${theme.lineColor};
  stroke-width: 1px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.marker {
  fill: ${theme.lineColor};
  stroke: ${theme.lineColor};
}
`
}

export function hasImprovedFlowchartTheme(source: string): boolean {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%')) continue
    return /^\s*(?:flowchart|graph)\b/i.test(line)
  }
  return false
}

export function mermaidRenderConfig(
  theme: DiagramTheme,
  improvedFlowchart = true
): Record<string, unknown> {
  const themeVariables = mermaidThemeVariables(theme)
  const intrinsic = { useMaxWidth: false }
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    layout: improvedFlowchart ? 'chatgpt-flowchart' : 'elk',
    themeVariables,
    ...(improvedFlowchart ? { themeCSS: flowchartThemeCss(themeVariables) } : {}),
    darkMode: theme === 'dark',
    fontFamily: themeVariables.fontFamily,
    htmlLabels: false,
    flowchart: { ...intrinsic, htmlLabels: false },
    sequence: intrinsic,
    gantt: intrinsic,
    journey: intrinsic,
    class: intrinsic,
    state: intrinsic,
    er: intrinsic,
    pie: intrinsic,
    quadrantChart: intrinsic,
    xyChart: intrinsic,
    requirement: intrinsic,
    mindmap: intrinsic,
    kanban: intrinsic,
    timeline: intrinsic,
    gitGraph: intrinsic,
    c4: intrinsic,
    sankey: intrinsic,
    block: intrinsic,
    packet: intrinsic,
    architecture: intrinsic,
    radar: intrinsic
  }
}

export function sanitizeMermaidSource(source: string): string | null {
  let rejected = false
  const withoutDirectives = source.replace(/%%\{[\s\S]*?\}%%/g, (directive) => {
    if (/['"]?securityLevel['"]?\s*:/i.test(directive)) rejected = true
    return ''
  })
  if (rejected) return null
  const sanitized = withoutDirectives.replace(/^\s*click\s+.*$/gim, '').trim()
  return sanitized || null
}

function svgOpeningTag(markup: string): string {
  return markup.match(/<svg\b[^>]*>/i)?.[0] || ''
}

function svgAttribute(markup: string, name: string): string | null {
  const openingTag = svgOpeningTag(markup)
  const expression = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')
  return openingTag.match(expression)?.[2] || null
}

export function svgDimensionsFromMarkup(markup: string): { width: number; height: number } {
  const viewBox = (svgAttribute(markup, 'viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const positiveAttribute = (name: string): number => {
    const attribute = svgAttribute(markup, name) || ''
    if (!/^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(attribute)) return 0
    const value = Number.parseFloat(attribute)
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  const width = positiveAttribute('width') || viewBox[2] || SVG_FALLBACK_WIDTH
  const height = positiveAttribute('height') || viewBox[3] || SVG_FALLBACK_HEIGHT
  return {
    width: Number.isFinite(width) && width > 0 ? width : SVG_FALLBACK_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : SVG_FALLBACK_HEIGHT
  }
}

export function fitDiagramZoom(
  viewportWidth: number,
  viewportHeight: number,
  naturalWidth: number,
  naturalHeight: number
): number {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return 1
  }
  return Math.max(
    MIN_VIEWER_FIT_ZOOM,
    Math.min(1, viewportWidth / naturalWidth, viewportHeight / naturalHeight)
  )
}

export function zoomFromWheel(current: number, deltaY: number, deltaMode = 0): number {
  const normalizedDelta = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1)
  return Math.max(
    MIN_VIEWER_FIT_ZOOM,
    Math.min(MAX_VIEWER_ZOOM, current * Math.exp(-normalizedDelta / 200))
  )
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function diagramViewerZoomFloor(fitZoom: number): number {
  return Math.max(
    MIN_VIEWER_FIT_ZOOM,
    Math.min(
      DIAGRAM_VIEWER_ZOOM_STEPS[0],
      finitePositive(fitZoom, DIAGRAM_VIEWER_ZOOM_STEPS[0])
    )
  )
}

export function clampDiagramViewerZoom(zoom: number, fitZoom: number): number {
  const value = Number.isFinite(zoom) ? zoom : fitZoom
  return Math.min(MAX_VIEWER_ZOOM, Math.max(diagramViewerZoomFloor(fitZoom), value))
}

export function adjacentDiagramViewerZoom(
  current: number,
  direction: -1 | 1,
  fitZoom: number
): number {
  const floor = diagramViewerZoomFloor(fitZoom)
  const ramp = [...new Set([floor, fitZoom, ...DIAGRAM_VIEWER_ZOOM_STEPS])]
    .filter((value) => value >= floor && value <= MAX_VIEWER_ZOOM)
    .sort((left, right) => left - right)
  const epsilon = 0.0005
  if (direction > 0) {
    return ramp.find((value) => value > current + epsilon) ?? MAX_VIEWER_ZOOM
  }
  return ramp.toReversed().find((value) => value < current - epsilon) ?? floor
}

export function constrainDiagramViewerPan(
  pan: DiagramViewerPoint,
  viewport: DiagramViewerSize,
  diagram: DiagramViewerSize,
  zoom: number
): DiagramViewerPoint {
  const overflowX = Math.max(0, (diagram.width * zoom - viewport.width) / 2)
  const overflowY = Math.max(0, (diagram.height * zoom - viewport.height) / 2)
  return {
    x: Math.max(-overflowX, Math.min(overflowX, Number.isFinite(pan.x) ? pan.x : 0)),
    y: Math.max(-overflowY, Math.min(overflowY, Number.isFinite(pan.y) ? pan.y : 0))
  }
}

export function anchorDiagramViewerPan(
  pan: DiagramViewerPoint,
  anchorFromCenter: DiagramViewerPoint,
  currentZoom: number,
  nextZoom: number
): DiagramViewerPoint {
  const ratio = nextZoom / finitePositive(currentZoom, nextZoom)
  return {
    x: anchorFromCenter.x - (anchorFromCenter.x - pan.x) * ratio,
    y: anchorFromCenter.y - (anchorFromCenter.y - pan.y) * ratio
  }
}

export function diagramMenuPlacement(
  triggerTop: number,
  triggerBottom: number,
  menuHeight: number,
  viewportHeight: number
): 'down' | 'up' {
  const below = viewportHeight - triggerBottom
  const above = triggerTop
  return below < menuHeight + 8 && above > below ? 'up' : 'down'
}

function wheelPixels(value: number, mode: number, viewportLength: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return value * 16
  if (mode === WheelEvent.DOM_DELTA_PAGE) return value * viewportLength
  return value
}

function focusableViewerControls(container: HTMLElement | null): HTMLElement[] {
  return Array.from(
    container?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href]:not([aria-disabled="true"])'
    ) || []
  )
}

function normalizeRenderedSvg(markup: string): string {
  const template = document.createElement('template')
  template.innerHTML = markup
  const svg = template.content.querySelector('svg')
  if (!(svg instanceof SVGSVGElement)) return markup

  const dimensions = svgDimensionsFromMarkup(svg.outerHTML)
  svg.classList.add('codex-mermaid-svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Mermaid diagram')
  svg.style.width = `${dimensions.width}px`
  svg.style.height = 'auto'
  svg.style.maxWidth = '100%'

  for (const node of svg.querySelectorAll('.node')) {
    if (node.querySelector(':scope > polygon, :scope > path, :scope .label-container[points]')) {
      node.classList.add('mermaid-decision')
    }
  }
  return svg.outerHTML
}

function captureSvgSnapshot(svg: SVGSVGElement | null): SvgSnapshot | null {
  if (!svg) return null
  const clone = svg.cloneNode(true)
  if (!(clone instanceof SVGSVGElement)) return null
  const viewBoxWidth = svg.viewBox.baseVal.width
  const viewBoxHeight = svg.viewBox.baseVal.height
  const fallback = svgDimensionsFromMarkup(svg.outerHTML)
  const width = viewBoxWidth > 0 ? viewBoxWidth : fallback.width
  const height = viewBoxHeight > 0 ? viewBoxHeight : fallback.height

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.maxWidth = 'none'
  clone.style.maxHeight = 'none'
  return {
    width,
    height,
    markup: new XMLSerializer().serializeToString(clone)
  }
}

async function waitForFonts(): Promise<void> {
  if ('fonts' in document) await document.fonts.ready
}

async function snapshotPng(snapshot: SvgSnapshot, background: string): Promise<Blob> {
  await waitForFonts()
  const source = new Blob([snapshot.markup], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.decoding = 'async'
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to decode the rendered diagram.'))
    })
    image.src = objectUrl
    if (typeof image.decode === 'function') {
      await image.decode().catch(() => loaded)
    } else {
      await loaded
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(snapshot.width * 2))
    canvas.height = Math.max(1, Math.ceil(snapshot.height * 2))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas export is unavailable.')
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Unable to export the diagram.'))),
        'image/png'
      )
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

function DiagramFullscreen({
  code,
  onClose,
  onDownload,
  snapshot
}: {
  code: string
  onClose(): void
  onDownload(): void
  snapshot: SvgSnapshot | null
}): ReactNode {
  const [fitZoom, setFitZoom] = useState(0.5)
  const [zoom, setZoom] = useState(0.5)
  const [pan, setPan] = useState<DiagramViewerPoint>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fitZoomRef = useRef(0.5)
  const zoomRef = useRef(0.5)
  const panRef = useRef<DiagramViewerPoint>({ x: 0, y: 0 })
  const initializedRef = useRef(false)
  const pointerRef = useRef<{
    id: number
    moved: boolean
    pan: DiagramViewerPoint
    start: DiagramViewerPoint
  } | null>(null)

  const commitZoom = useCallback((value: number): void => {
    zoomRef.current = value
    setZoom(value)
  }, [])

  const commitPan = useCallback((value: DiagramViewerPoint): void => {
    panRef.current = value
    setPan(value)
  }, [])

  const viewerViewport = useCallback((): DiagramViewerSize => ({
    width: Math.max(1, (viewportRef.current?.clientWidth || 1) - VIEWER_PADDING * 2),
    height: Math.max(1, (viewportRef.current?.clientHeight || 1) - VIEWER_PADDING * 2)
  }), [])

  const clampPan = useCallback((value: DiagramViewerPoint, nextZoom = zoomRef.current): DiagramViewerPoint => {
    if (!snapshot) return { x: 0, y: 0 }
    return constrainDiagramViewerPan(value, viewerViewport(), snapshot, nextZoom)
  }, [snapshot, viewerViewport])

  const measureFit = useCallback((): void => {
    if (!snapshot) return
    const viewport = viewerViewport()
    const nextFit = fitDiagramZoom(
      viewport.width,
      viewport.height,
      snapshot.width,
      snapshot.height
    )
    const wasFollowingFit =
      !initializedRef.current || Math.abs(zoomRef.current - fitZoomRef.current) < 0.001
    fitZoomRef.current = nextFit
    setFitZoom(nextFit)
    if (wasFollowingFit) {
      commitZoom(nextFit)
      commitPan({ x: 0, y: 0 })
    } else {
      commitPan(clampPan(panRef.current, zoomRef.current))
    }
    initializedRef.current = true
  }, [clampPan, commitPan, commitZoom, snapshot, viewerViewport])

  const updateZoom = useCallback((next: number, anchor?: DiagramViewerPoint): void => {
    const value = clampDiagramViewerZoom(next, fitZoomRef.current)
    if (Math.abs(value - zoomRef.current) < 0.0001) return
    const anchored = anchor
      ? anchorDiagramViewerPan(panRef.current, anchor, zoomRef.current, value)
      : panRef.current
    commitZoom(value)
    commitPan(clampPan(anchored, value))
  }, [clampPan, commitPan, commitZoom])

  const resetView = useCallback((): void => {
    commitZoom(fitZoomRef.current)
    commitPan({ x: 0, y: 0 })
  }, [commitPan, commitZoom])

  useLayoutEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const appRoot = document.querySelector<HTMLElement>('#root')
    const previousInert = appRoot?.inert ?? false
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden') ?? null
    const previousOverflow = document.body.style.overflow
    if (appRoot) {
      appRoot.inert = true
      appRoot.setAttribute('aria-hidden', 'true')
    }
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      if (appRoot) {
        appRoot.inert = previousInert
        if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden')
        else appRoot.setAttribute('aria-hidden', previousAriaHidden)
      }
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    initializedRef.current = false
    fitZoomRef.current = 0.5
    zoomRef.current = 0.5
    panRef.current = { x: 0, y: 0 }
    setFitZoom(0.5)
    setZoom(0.5)
    setPan({ x: 0, y: 0 })
    measureFit()
    const viewport = viewportRef.current
    if (!viewport) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureFit)
      return () => window.removeEventListener('resize', measureFit)
    }
    const observer = new ResizeObserver(measureFit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [measureFit])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Tab') {
        const focusable = focusableViewerControls(dialogRef.current)
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first) {
          event.preventDefault()
          dialogRef.current?.focus()
        } else if (
          !dialogRef.current?.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        resetView()
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        updateZoom(adjacentDiagramViewerZoom(zoomRef.current, 1, fitZoomRef.current))
      } else if (event.key === '-') {
        event.preventDefault()
        updateZoom(adjacentDiagramViewerZoom(zoomRef.current, -1, fitZoomRef.current))
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, resetView, updateZoom])

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const viewport = viewerViewport()
    const deltaX = wheelPixels(event.deltaX, event.deltaMode, viewport.width)
    const deltaY = wheelPixels(event.deltaY, event.deltaMode, viewport.height)
    if (event.ctrlKey) {
      const bounds = event.currentTarget.getBoundingClientRect()
      const anchor = {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2
      }
      updateZoom(zoomFromWheel(zoomRef.current, event.deltaY, event.deltaMode), anchor)
      return
    }
    commitPan(clampPan({
      x: panRef.current.x - deltaX,
      y: panRef.current.y - deltaY
    }))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!snapshot || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      pan: panRef.current,
      moved: false
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    const delta = {
      x: event.clientX - pointer.start.x,
      y: event.clientY - pointer.start.y
    }
    if (Math.abs(delta.x) + Math.abs(delta.y) > 3) pointer.moved = true
    commitPan(clampPan({
      x: pointer.pan.x + delta.x,
      y: pointer.pan.y + delta.y
    }))
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current?.id !== event.pointerId) return
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return createPortal(
    <div
      ref={dialogRef}
      className="diagram-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid diagram preview"
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="diagram-lightbox-actions" data-markdown-copy="exclude">
        <button
          type="button"
          aria-label="下载图像"
          title="下载图像"
          disabled={!snapshot}
          onClick={onDownload}
        >
          <Download />
        </button>
        <button ref={closeRef} type="button" aria-label="关闭预览" title="关闭" onClick={onClose}>
          <X />
        </button>
      </div>
      <div
        ref={viewportRef}
        className={`diagram-lightbox-viewport${dragging ? ' is-dragging' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => {
          finishPointer(event)
          pointerRef.current = null
        }}
        onClick={(event) => {
          const pointer = pointerRef.current
          if (event.target === event.currentTarget && (!pointer || !pointer.moved)) onClose()
          pointerRef.current = null
        }}
      >
        {snapshot && (
          <div
            className="diagram-lightbox-canvas"
            style={{
              width: snapshot.width,
              height: snapshot.height,
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`
            }}
            aria-label={code.slice(0, 120)}
            dangerouslySetInnerHTML={{ __html: snapshot.markup }}
          />
        )}
      </div>
      <div className="diagram-lightbox-zoom" aria-label="缩放控制" data-markdown-copy="exclude">
        <button
          type="button"
          aria-label="缩小"
          disabled={zoom <= diagramViewerZoomFloor(fitZoom) + 0.0005}
          onClick={() => updateZoom(adjacentDiagramViewerZoom(zoom, -1, fitZoom))}
        >
          <Minus />
        </button>
        <button
          type="button"
          className="diagram-lightbox-zoom-value"
          aria-label="重置缩放"
          title="适应窗口"
          onClick={resetView}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="放大"
          disabled={zoom >= MAX_VIEWER_ZOOM - 0.0005}
          onClick={() => updateZoom(adjacentDiagramViewerZoom(zoom, 1, fitZoom))}
        >
          <Plus />
        </button>
      </div>
    </div>,
    document.body
  )
}

export function MermaidSourceFallback({
  error,
  source
}: {
  error?: string | null
  source: string
}): ReactNode {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const copySource = async (): Promise<void> => {
    try {
      await copyTextToClipboard(source)
      setCopied(true)
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure
      className="mermaid-source-fallback"
      role="status"
      aria-label="Mermaid 图表无法渲染，已显示源代码"
      title={error || undefined}
      data-mermaid-render-status="error"
    >
      <figcaption>
        <span>mermaid</span>
        <button
          type="button"
          aria-label={copied ? 'Mermaid 源代码已复制' : '复制 Mermaid 源代码'}
          title={copied ? '已复制' : '复制代码'}
          data-markdown-copy="exclude"
          onClick={() => void copySource()}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </figcaption>
      <pre><code>{source}</code></pre>
    </figure>
  )
}

export function MermaidDiagram({
  code,
  onShowSource,
  streaming = false
}: MermaidDiagramProps): ReactNode {
  const source = code.trim()
  const theme = useDiagramTheme()
  const reactId = useId()
  const [state, setState] = useState<MermaidRenderState>({
    code: source,
    error: null,
    svg: null
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPlacement, setMenuPlacement] = useState<'down' | 'up'>('down')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerSnapshot, setViewerSnapshot] = useState<SvgSnapshot | null>(null)
  const [copied, setCopied] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const expandTriggerRef = useRef<HTMLButtonElement>(null)
  const menuInitialFocusRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const svgLayerRef = useRef<HTMLDivElement>(null)
  const viewerRequestRef = useRef(0)
  const menuId = `${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-mermaid-menu`

  useEffect(() => {
    let cancelled = false
    const renderId = nextRenderId(reactId)
    const sanitized = sanitizeMermaidSource(source)
    setState({ code: source, error: null, svg: null })
    setExportError(null)
    // The original preview deliberately avoids parsing an open Mermaid fence.
    // Besides wasting work on every token, rendering here flashes Mermaid's
    // syntax error before the model has finished the diagram.
    if (streaming) return
    if (!sanitized) {
      setState({ code: source, error: 'Invalid or unsupported diagram', svg: null })
      return
    }

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        await registerCodexFlowchartLayout(mermaid)
        return await queueMermaidRender(async () => {
          mermaid.initialize(
            mermaidRenderConfig(theme, hasImprovedFlowchartTheme(sanitized))
          )
          const container = document.createElement('div')
          container.inert = true
          container.setAttribute('aria-hidden', 'true')
          container.style.position = 'fixed'
          container.style.inset = '0'
          container.style.visibility = 'hidden'
          document.body.append(container)
          try {
            await new Promise<void>((resolve) => {
              const timeout = window.setTimeout(resolve, 50)
              requestAnimationFrame(() => {
                window.clearTimeout(timeout)
                window.setTimeout(resolve, 0)
              })
            })
            return await mermaid.render(renderId, sanitized, container)
          } finally {
            container.replaceChildren()
            container.remove()
          }
        })
      })
      .then(({ svg }) => {
        if (!cancelled) {
          setState({ code: source, error: null, svg: normalizeRenderedSvg(svg) })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            code: source,
            error: error instanceof Error ? error.message : String(error),
            svg: null
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [reactId, source, streaming, theme])

  const menuItems = useCallback((): HTMLButtonElement[] => Array.from(
    menuPanelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []
  ), [])

  const closeMenu = useCallback((restoreFocus = false): void => {
    setMenuOpen(false)
    if (restoreFocus) menuTriggerRef.current?.focus({ preventScroll: true })
  }, [])

  const updateMenuPlacement = useCallback((): void => {
    const trigger = menuTriggerRef.current
    const menu = menuPanelRef.current
    if (!trigger || !menu) return
    const triggerBounds = trigger.getBoundingClientRect()
    setMenuPlacement(diagramMenuPlacement(
      triggerBounds.top,
      triggerBounds.bottom,
      menu.offsetHeight,
      window.innerHeight
    ))
  }, [])

  useLayoutEffect(() => {
    if (!menuOpen) return
    updateMenuPlacement()
    const items = menuItems()
    const initialIndex = Math.max(0, Math.min(items.length - 1, menuInitialFocusRef.current))
    items[initialIndex]?.focus({ preventScroll: true })
  }, [menuItems, menuOpen, updateMenuPlacement])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updateMenuPlacement)
    window.addEventListener('scroll', updateMenuPlacement, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updateMenuPlacement)
      window.removeEventListener('scroll', updateMenuPlacement, true)
    }
  }, [closeMenu, menuOpen, updateMenuPlacement])

  useEffect(() => () => {
    viewerRequestRef.current += 1
  }, [])

  const inlineSnapshot = (): SvgSnapshot | null =>
    captureSvgSnapshot(svgLayerRef.current?.querySelector('svg') || null)

  const backgroundColor = (): string => {
    const root = rootRef.current
    if (!root) return '#111111'
    const probe = document.createElement('span')
    probe.style.position = 'absolute'
    probe.style.pointerEvents = 'none'
    probe.style.visibility = 'hidden'
    probe.style.backgroundColor = 'var(--background)'
    root.append(probe)
    const resolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : '#111111'
  }

  const copyCode = async (): Promise<void> => {
    try {
      await copyTextToClipboard(source)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_200)
    } catch {
      setCopied(false)
    }
  }

  const download = async (preferredSnapshot?: SvgSnapshot | null): Promise<void> => {
    setExportError(null)
    try {
      const snapshot = preferredSnapshot || inlineSnapshot()
      if (!snapshot) throw new Error('Preview is not ready for export.')
      downloadBlob(await snapshotPng(snapshot, backgroundColor()), 'mermaid-diagram.png')
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    }
  }

  const openFullscreen = async (): Promise<void> => {
    const request = viewerRequestRef.current + 1
    viewerRequestRef.current = request
    setViewerOpen(true)
    setViewerSnapshot(null)
    setExportError(null)
    try {
      await waitForFonts()
      const snapshot = inlineSnapshot()
      if (!snapshot) throw new Error('Couldn’t open diagram preview.')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (viewerRequestRef.current === request) setViewerSnapshot(snapshot)
    } catch (error) {
      if (viewerRequestRef.current === request) {
        setViewerOpen(false)
        setExportError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const closeViewer = (): void => {
    viewerRequestRef.current += 1
    setViewerOpen(false)
    setViewerSnapshot(null)
  }

  const openMenu = (initialIndex = 0): void => {
    menuInitialFocusRef.current = initialIndex
    setMenuOpen(true)
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = menuItems()
    if (items.length === 0) return
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
      return
    } else if (event.key === 'Tab') {
      event.preventDefault()
      closeMenu(false)
      ;(event.shiftKey ? menuTriggerRef.current : expandTriggerRef.current)?.focus({
        preventScroll: true
      })
      return
    }
    if (nextIndex !== null) {
      event.preventDefault()
      items[nextIndex]?.focus({ preventScroll: true })
    }
  }

  const stopPointer = (event: ReactPointerEvent): void => event.stopPropagation()
  const ready = !streaming && state.code === source && Boolean(state.svg)
  const failed = !streaming && state.code === source && Boolean(state.error)
  const settled = ready || failed
  const rootState = failed
    ? 'is-ready is-error'
    : settled
      ? 'is-ready'
      : `is-loading${streaming ? ' is-streaming' : ''}`

  return (
    <div
      ref={rootRef}
      className={`mermaid-diagram ${rootState}`}
      data-markdown-copy={streaming ? 'exclude' : 'code-block'}
      data-markdown-copy-text={streaming ? undefined : `\`\`\`mermaid\n${source}\n\`\`\``}
      data-wide-markdown-block={streaming || failed ? undefined : 'true'}
      data-wide-markdown-block-kind={streaming || failed ? undefined : 'mermaid'}
    >
      <div className={`mermaid-preview${streaming ? ' is-streaming' : ''}`} tabIndex={-1}>
        {!settled && (
          <div
            className={`mermaid-diagram-loading ${
              streaming ? 'is-streaming' : 'is-placeholder'
            }`}
            data-mermaid-streaming={streaming ? 'true' : undefined}
            role="status"
            aria-label={streaming ? undefined : '正在加载 Mermaid 图表'}
          >
            {streaming && <span>正在加载图表</span>}
          </div>
        )}
        <div className="mermaid-diagram-stage">
          <div
            ref={svgLayerRef}
            className={`mermaid-diagram-layer${settled ? ' is-ready' : ' is-pending'}`}
          >
            {ready && (
              <div
                className="mermaid-diagram-svg"
                data-mermaid-render-status="ready"
                dangerouslySetInnerHTML={{ __html: state.svg || '' }}
              />
            )}
            {failed && (
              <MermaidSourceFallback source={source} error={state.error} />
            )}
          </div>
        </div>
        {ready && (
          <div
            className="mermaid-diagram-actions"
            data-markdown-copy="exclude"
            onPointerDown={stopPointer}
          >
            <div ref={menuRef} className="mermaid-diagram-menu-anchor">
              <ActivityTooltip content="图表选项">
                <button
                  ref={menuTriggerRef}
                  type="button"
                  aria-label="图表选项"
                  aria-haspopup="menu"
                  aria-controls={menuOpen ? menuId : undefined}
                  aria-expanded={menuOpen}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      openMenu(event.key === 'ArrowUp' ? Number.MAX_SAFE_INTEGER : 0)
                    }
                  }}
                  onClick={() => {
                    if (menuOpen) closeMenu(false)
                    else openMenu(0)
                  }}
                >
                  <MoreHorizontal />
                </button>
              </ActivityTooltip>
              {menuOpen && (
                <div
                  ref={menuPanelRef}
                  id={menuId}
                  className={`mermaid-diagram-menu${menuPlacement === 'up' ? ' is-up' : ''}`}
                  role="menu"
                  aria-label="图表选项"
                  onKeyDown={onMenuKeyDown}
                >
                  {onShowSource && (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
                      onClick={() => {
                        closeMenu(true)
                        onShowSource()
                      }}
                    >
                      <Code2 />
                      <span>显示源代码</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
                    onClick={() => {
                      closeMenu(true)
                      void copyCode()
                    }}
                  >
                    {copied ? <Check /> : <Code2 />}
                    <span>{copied ? '已复制' : '复制为代码'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
                    onClick={() => {
                      closeMenu(true)
                      void download()
                    }}
                  >
                    <Download />
                    <span>下载图像</span>
                  </button>
                </div>
              )}
            </div>
            <ActivityTooltip content="展开图表">
              <button
                ref={expandTriggerRef}
                type="button"
                aria-label="展开图表"
                onClick={() => void openFullscreen()}
              >
                <Maximize2 />
              </button>
            </ActivityTooltip>
          </div>
        )}
      </div>
      {exportError && <div className="mermaid-export-error" role="status">{exportError}</div>}
      {viewerOpen && (
        <DiagramFullscreen
          code={source}
          snapshot={viewerSnapshot}
          onClose={closeViewer}
          onDownload={() => void download(viewerSnapshot)}
        />
      )}
    </div>
  )
}

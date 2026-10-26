import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  adjacentImageViewerZoom,
  anchorImageViewerPan,
  constrainImageViewerPan,
  imageViewerFitZoom,
  ThreadImagePreview
} from './ThreadImagePreview'

const styles = readFileSync(new URL('./ThreadImagePreview.css', import.meta.url), 'utf8')

describe('ThreadImagePreview', () => {
  it('renders an explicitly expanded server-provided image with preview chrome', () => {
    const source =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const html = renderToStaticMarkup(
      createElement(ThreadImagePreview, {
        path: '/workspace/result.png',
        inlineSource: source,
        defaultExpanded: true
      })
    )

    expect(html).toContain('已查看 1 张图像')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-label="预览 result.png"')
    expect(html).toContain(source)
  })

  it('starts image-view activities collapsed without mounting preview chrome', () => {
    const source =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const html = renderToStaticMarkup(
      createElement(ThreadImagePreview, {
        inlineSource: source
      })
    )

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('thread-image-preview-row')
  })

  it('renders user-message images immediately without the activity disclosure row', () => {
    const source =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const html = renderToStaticMarkup(
      createElement(ThreadImagePreview, {
        path: '/workspace/codex-clipboard.png',
        inlineSource: source,
        presentation: 'message'
      })
    )

    expect(html).toContain('thread-image-item is-message-attachment')
    expect(html).toContain('thread-image-preview-row')
    expect(html).toContain('aria-label="预览 codex-clipboard.png"')
    expect(html).not.toContain('thread-image-heading')
  })

  it('matches the compact activity-row typography and hides the disclosure until interaction', () => {
    const itemRule = styles.match(/\.thread-image-item\s*\{([^}]*)\}/)?.[1] || ''
    const headingRule = styles.match(/\.thread-image-heading\s*\{([^}]*)\}/)?.[1] || ''
    const chevronRule = styles.match(/\.thread-image-heading > svg:last-child\s*\{([^}]*)\}/)?.[1] || ''

    expect(itemRule).toContain('margin: 0')
    expect(headingRule).toContain('14px/21px')
    expect(headingRule).toContain('min-height: 21px')
    expect(headingRule).toContain('gap: 4px')
    expect(headingRule).toContain('var(--text) 60%')
    expect(styles).toContain('margin-right: 2px')
    expect(chevronRule).toContain('var(--text) 60%')
    expect(chevronRule).toContain('opacity: 0')
    expect(styles).toContain('.thread-image-heading:hover > svg:last-child')
    expect(styles).toContain('.thread-image-heading-icon svg')
  })
})

describe('thread image full-screen viewer math', () => {
  it('fits the Retina recording screenshot at the observed 45 percent', () => {
    expect(imageViewerFitZoom(
      { width: 1939, height: 1141 },
      { width: 3878, height: 2282 }
    )).toBeCloseTo(0.4505, 3)
  })

  it('walks the recovered viewer zoom ramp around an arbitrary fit value', () => {
    expect(adjacentImageViewerZoom(0.4505, -1, 0.4505)).toBe(0.33)
    expect(adjacentImageViewerZoom(0.4505, 1, 0.4505)).toBe(0.5)
    expect(adjacentImageViewerZoom(5, 1, 0.45)).toBe(5)
    expect(adjacentImageViewerZoom(0.1, -1, 0.1)).toBe(0.1)
    expect(adjacentImageViewerZoom(0.1, 1, 0.1)).toBe(0.25)
  })

  it('anchors zoom under the pointer and constrains panning to image bounds', () => {
    expect(anchorImageViewerPan({ x: 0, y: 0 }, { x: 100, y: 50 }, 1, 2)).toEqual({ x: -100, y: -50 })
    expect(constrainImageViewerPan(
      { x: 500, y: -500 },
      { width: 800, height: 600 },
      { width: 1000, height: 800 },
      1
    )).toEqual({ x: 100, y: -100 })
    expect(constrainImageViewerPan(
      { x: 40, y: 20 },
      { width: 800, height: 600 },
      { width: 200, height: 100 },
      1
    )).toEqual({ x: 0, y: 0 })
  })

  it('uses the recorded flat overlay controls instead of a card header', () => {
    expect(styles).toContain('.thread-image-viewer-actions')
    expect(styles).toContain('top: 16px')
    expect(styles).toContain('right: 8px')
    expect(styles).toContain('bottom: 28px')
    expect(styles).toContain('width: 40px')
    expect(styles).not.toContain('.thread-image-lightbox header')
  })
})

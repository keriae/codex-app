import {
  ChevronDown,
  Download,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  Minus,
  Plus,
  X
} from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import './ThreadImagePreview.css'

interface LoadedImage {
  source: string
  name: string
  mimeType: string
}

type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; image: LoadedImage }
  | { status: 'error'; message: string }

export interface ImageViewerSize {
  width: number
  height: number
}

export interface ImageViewerPoint {
  x: number
  y: number
}

export const IMAGE_VIEWER_ZOOM_STEPS = [
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

const IMAGE_VIEWER_MIN_FIT_ZOOM = 0.01
const IMAGE_VIEWER_MAX_ZOOM = IMAGE_VIEWER_ZOOM_STEPS.at(-1)!
const IMAGE_VIEWER_HORIZONTAL_FIT_PADDING = 96
const IMAGE_VIEWER_VERTICAL_FIT_PADDING = 48

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function imageViewerFitZoom(
  viewport: ImageViewerSize,
  image: ImageViewerSize
): number {
  const viewportWidth = finitePositive(viewport.width, 1)
  const viewportHeight = finitePositive(viewport.height, 1)
  const imageWidth = finitePositive(image.width, 1)
  const imageHeight = finitePositive(image.height, 1)
  const width = Math.max(1, viewportWidth - IMAGE_VIEWER_HORIZONTAL_FIT_PADDING * 2)
  const height = Math.max(1, viewportHeight - IMAGE_VIEWER_VERTICAL_FIT_PADDING * 2)
  return Math.max(
    IMAGE_VIEWER_MIN_FIT_ZOOM,
    Math.min(1, width / imageWidth, height / imageHeight)
  )
}

export function imageViewerZoomFloor(fitZoom: number): number {
  return Math.max(
    IMAGE_VIEWER_MIN_FIT_ZOOM,
    Math.min(IMAGE_VIEWER_ZOOM_STEPS[0], finitePositive(fitZoom, IMAGE_VIEWER_ZOOM_STEPS[0]))
  )
}

export function clampImageViewerZoom(zoom: number, fitZoom: number): number {
  const value = Number.isFinite(zoom) ? zoom : fitZoom
  return Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(imageViewerZoomFloor(fitZoom), value))
}

export function adjacentImageViewerZoom(
  current: number,
  direction: -1 | 1,
  fitZoom: number
): number {
  const floor = imageViewerZoomFloor(fitZoom)
  const candidates = [...new Set([floor, fitZoom, ...IMAGE_VIEWER_ZOOM_STEPS])]
    .filter((value) => value >= floor && value <= IMAGE_VIEWER_MAX_ZOOM)
    .sort((left, right) => left - right)
  const epsilon = 0.0005
  if (direction > 0) {
    return candidates.find((value) => value > current + epsilon) ?? IMAGE_VIEWER_MAX_ZOOM
  }
  return candidates.toReversed().find((value) => value < current - epsilon) ?? floor
}

export function constrainImageViewerPan(
  pan: ImageViewerPoint,
  viewport: ImageViewerSize,
  image: ImageViewerSize,
  zoom: number
): ImageViewerPoint {
  const overflowX = Math.max(0, (image.width * zoom - viewport.width) / 2)
  const overflowY = Math.max(0, (image.height * zoom - viewport.height) / 2)
  return {
    x: Math.max(-overflowX, Math.min(overflowX, Number.isFinite(pan.x) ? pan.x : 0)),
    y: Math.max(-overflowY, Math.min(overflowY, Number.isFinite(pan.y) ? pan.y : 0))
  }
}

export function anchorImageViewerPan(
  pan: ImageViewerPoint,
  anchorFromCenter: ImageViewerPoint,
  currentZoom: number,
  nextZoom: number
): ImageViewerPoint {
  const ratio = nextZoom / finitePositive(currentZoom, nextZoom)
  return {
    x: anchorFromCenter.x - (anchorFromCenter.x - pan.x) * ratio,
    y: anchorFromCenter.y - (anchorFromCenter.y - pan.y) * ratio
  }
}

function wheelPixels(value: number, mode: number, viewportLength: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return value * 16
  if (mode === WheelEvent.DOM_DELTA_PAGE) return value * viewportLength
  return value
}

function pathName(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'image'
}

function safeInlineImageSource(source: string | null | undefined): string | null {
  if (!source) return null
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/i.test(source)
    ? source
    : null
}

function focusableViewerControls(container: HTMLElement | null): HTMLElement[] {
  return Array.from(
    container?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]:not([aria-disabled="true"])') || []
  )
}

export function ThreadImagePreview({
  path,
  inlineSource,
  label = '已查看 1 张图像',
  defaultExpanded = false,
  presentation = 'activity'
}: {
  path?: string | null
  inlineSource?: string | null
  label?: string
  defaultExpanded?: boolean
  presentation?: 'activity' | 'message'
}): ReactNode {
  const acceptedInlineSource = useMemo(
    () => safeInlineImageSource(inlineSource),
    [inlineSource]
  )
  const [state, setState] = useState<ImageState>(() =>
    acceptedInlineSource
      ? {
          status: 'ready',
          image: {
            source: acceptedInlineSource,
            name: path ? pathName(path) : 'generated-image.png',
            mimeType: acceptedInlineSource.slice(5, acceptedInlineSource.indexOf(';'))
          }
        }
      : { status: 'loading' }
  )
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerReady, setViewerReady] = useState(false)
  const [fitZoom, setFitZoom] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<ImageViewerPoint>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewerImageRef = useRef<HTMLImageElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const thumbnailRef = useRef<HTMLButtonElement>(null)
  const naturalSizeRef = useRef<ImageViewerSize>({ width: 1, height: 1 })
  const fitZoomRef = useRef(1)
  const zoomRef = useRef(1)
  const panRef = useRef<ImageViewerPoint>({ x: 0, y: 0 })
  const initializedRef = useRef(false)
  const pointerRef = useRef<{
    id: number
    start: ImageViewerPoint
    pan: ImageViewerPoint
    moved: boolean
  } | null>(null)

  const commitZoom = useCallback((value: number): void => {
    zoomRef.current = value
    setZoom(value)
  }, [])

  const commitPan = useCallback((value: ImageViewerPoint): void => {
    panRef.current = value
    setPan(value)
  }, [])

  useEffect(() => {
    if (acceptedInlineSource) {
      setState({
        status: 'ready',
        image: {
          source: acceptedInlineSource,
          name: path ? pathName(path) : 'generated-image.png',
          mimeType: acceptedInlineSource.slice(5, acceptedInlineSource.indexOf(';'))
        }
      })
      return
    }
    if (!path) {
      setState({ status: 'error', message: '图像不可用' })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })
    void window.codex.readThreadImage(path).then((result) => {
      if (cancelled) return
      setState({
        status: 'ready',
        image: {
          source: `data:${result.mimeType};base64,${result.dataBase64}`,
          name: pathName(path),
          mimeType: result.mimeType
        }
      })
    }).catch(() => {
      if (!cancelled) setState({ status: 'error', message: '图像不可用' })
    })

    return () => {
      cancelled = true
    }
  }, [acceptedInlineSource, path])

  const viewerViewport = useCallback((): ImageViewerSize => ({
    width: Math.max(1, canvasRef.current?.clientWidth || 1),
    height: Math.max(1, canvasRef.current?.clientHeight || 1)
  }), [])

  const clampPan = useCallback((value: ImageViewerPoint, nextZoom = zoomRef.current): ImageViewerPoint =>
    constrainImageViewerPan(value, viewerViewport(), naturalSizeRef.current, nextZoom), [viewerViewport])

  const measureAndFit = useCallback((): void => {
    const element = viewerImageRef.current
    if (!element || element.naturalWidth <= 0 || element.naturalHeight <= 0) return
    naturalSizeRef.current = { width: element.naturalWidth, height: element.naturalHeight }
    const nextFit = imageViewerFitZoom(viewerViewport(), naturalSizeRef.current)
    const wasFollowingFit = !initializedRef.current || Math.abs(zoomRef.current - fitZoomRef.current) < 0.001
    fitZoomRef.current = nextFit
    setFitZoom(nextFit)
    if (wasFollowingFit) {
      commitZoom(nextFit)
      commitPan({ x: 0, y: 0 })
    } else {
      commitPan(clampPan(panRef.current, zoomRef.current))
    }
    initializedRef.current = true
    setViewerReady(true)
  }, [clampPan, commitPan, commitZoom, viewerViewport])

  const updateZoom = useCallback((next: number, anchor?: ImageViewerPoint): void => {
    const value = clampImageViewerZoom(next, fitZoomRef.current)
    if (Math.abs(value - zoomRef.current) < 0.0001) return
    const anchored = anchor
      ? anchorImageViewerPan(panRef.current, anchor, zoomRef.current, value)
      : panRef.current
    commitZoom(value)
    commitPan(clampPan(anchored, value))
  }, [clampPan, commitPan, commitZoom])

  const resetViewer = useCallback((): void => {
    commitZoom(fitZoomRef.current)
    commitPan({ x: 0, y: 0 })
  }, [commitPan, commitZoom])

  useLayoutEffect(() => {
    if (!viewerOpen) return
    initializedRef.current = false
    setViewerReady(false)
    const previousFocus = document.activeElement as HTMLElement | null
    const appRoot = document.querySelector<HTMLElement>('#root')
    const previousInert = appRoot?.inert ?? false
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden') ?? null
    const previousOverflow = document.body.style.overflow
    closeRef.current?.focus({ preventScroll: true })
    if (appRoot) {
      appRoot.inert = true
      appRoot.setAttribute('aria-hidden', 'true')
    }
    document.body.style.overflow = 'hidden'
    return () => {
      if (appRoot) {
        appRoot.inert = previousInert
        if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden')
        else appRoot.setAttribute('aria-hidden', previousAriaHidden)
      }
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      else if (thumbnailRef.current?.isConnected) thumbnailRef.current.focus({ preventScroll: true })
    }
  }, [viewerOpen])

  useEffect(() => {
    if (!viewerOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setViewerOpen(false)
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
        resetViewer()
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        updateZoom(adjacentImageViewerZoom(zoomRef.current, 1, fitZoomRef.current))
      } else if (event.key === '-') {
        event.preventDefault()
        updateZoom(adjacentImageViewerZoom(zoomRef.current, -1, fitZoomRef.current))
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [resetViewer, updateZoom, viewerOpen])

  useEffect(() => {
    if (!viewerOpen) return
    const canvas = canvasRef.current
    if (!canvas) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureAndFit)
      return () => window.removeEventListener('resize', measureAndFit)
    }
    const observer = new ResizeObserver(measureAndFit)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [measureAndFit, viewerOpen])

  const image = state.status === 'ready' ? state.image : null
  const messagePresentation = presentation === 'message'
  const previewVisible = messagePresentation || expanded
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const viewport = viewerViewport()
    const deltaX = wheelPixels(event.deltaX, event.deltaMode, viewport.width)
    const deltaY = wheelPixels(event.deltaY, event.deltaMode, viewport.height)
    if (event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      const anchor = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2
      }
      updateZoom(zoomRef.current * Math.exp(-deltaY * 0.01), anchor)
      return
    }
    commitPan(clampPan({
      x: panRef.current.x - deltaX,
      y: panRef.current.y - deltaY
    }))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }

  return (
    <div className={`thread-image-item${messagePresentation ? ' is-message-attachment' : ''}`}>
      {!messagePresentation && (
        <button
          type="button"
          className="thread-image-heading"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="thread-image-heading-icon" aria-hidden="true"><Images /></span>
          <span>{label}</span>
          <ChevronDown className={expanded ? 'is-expanded' : ''} />
        </button>
      )}
      {previewVisible && (
        <div className="thread-image-preview-row">
          {state.status === 'loading' && (
            <div className="thread-image-placeholder" role="status" aria-label="正在载入图像">
              <LoaderCircle className="spin" />
            </div>
          )}
          {state.status === 'error' && (
            <div className="thread-image-placeholder is-error" role="status">
              <ImageIcon />
              <span>{state.message}</span>
            </div>
          )}
          {image && (
            <button
              ref={thumbnailRef}
              type="button"
              className="thread-image-thumbnail"
              aria-label={`预览 ${image.name}`}
              onClick={() => {
                fitZoomRef.current = 1
                zoomRef.current = 1
                panRef.current = { x: 0, y: 0 }
                setFitZoom(1)
                setZoom(1)
                setPan({ x: 0, y: 0 })
                setViewerOpen(true)
              }}
            >
              <img src={image.source} alt={image.name} />
            </button>
          )}
        </div>
      )}
      {viewerOpen && image && createPortal(
        <div className="thread-image-lightbox" role="presentation">
          <section
            ref={dialogRef}
            className="thread-image-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={`预览 ${image.name}`}
            tabIndex={-1}
          >
            <div className="thread-image-viewer-actions" data-markdown-copy="exclude">
              <a
                href={image.source}
                download={image.name}
                aria-label="下载图像"
                title="下载"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Download />
              </a>
              <button
                ref={closeRef}
                type="button"
                aria-label="关闭预览"
                title="关闭"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setViewerOpen(false)}
              >
                <X />
              </button>
            </div>
            <div
              ref={canvasRef}
              className={`thread-image-canvas${dragging ? ' is-dragging' : ''}`}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onClick={(event) => {
                const pointer = pointerRef.current
                if (event.target === event.currentTarget && pointer && !pointer.moved) {
                  setViewerOpen(false)
                }
                pointerRef.current = null
              }}
            >
              <img
                ref={viewerImageRef}
                className={viewerReady ? 'is-ready' : ''}
                src={image.source}
                alt={image.name}
                draggable={false}
                onLoad={measureAndFit}
                style={{
                  transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`
                }}
              />
              {!viewerReady && <LoaderCircle className="thread-image-viewer-loading spin" aria-label="正在载入图像" />}
            </div>
            <div className="thread-image-viewer-zoom" aria-label="缩放控制" data-markdown-copy="exclude">
              <button
                type="button"
                aria-label="缩小"
                disabled={zoom <= imageViewerZoomFloor(fitZoom) + 0.0005}
                onClick={() => updateZoom(adjacentImageViewerZoom(zoom, -1, fitZoom))}
              >
                <Minus />
              </button>
              <button
                type="button"
                className="thread-image-viewer-zoom-value"
                aria-label="重置缩放"
                title="适应窗口"
                onClick={resetViewer}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="放大"
                disabled={zoom >= IMAGE_VIEWER_MAX_ZOOM - 0.0005}
                onClick={() => updateZoom(adjacentImageViewerZoom(zoom, 1, fitZoom))}
              >
                <Plus />
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  )
}

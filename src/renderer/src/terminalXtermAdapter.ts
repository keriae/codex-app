import type { ITheme, Terminal } from '@xterm/xterm'

export function macTerminalKeyData(event: Pick<KeyboardEvent, 'type' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (event.type !== 'keydown' || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp': return '\u0001'
    case 'ArrowRight':
    case 'ArrowDown': return '\u0005'
    case 'Backspace': return '\u0015'
    case 'Delete': return '\u000b'
    default: return null
  }
}

/** Resolve the same terminal theme variables used by the shipped renderer. */
export function readXtermTheme(element: HTMLElement): ITheme {
  const local = getComputedStyle(element)
  const root = getComputedStyle(document.documentElement)
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  element.appendChild(probe)
  const color = (key: string, fallback?: string): string | undefined => {
    const value = local.getPropertyValue(key).trim() || root.getPropertyValue(key).trim() || fallback
    if (!value) return undefined
    probe.style.color = value
    return getComputedStyle(probe).color || value
  }
  const theme: ITheme = {
    background: color('--color-codex-terminal-background', local.backgroundColor),
    foreground: color('--color-codex-terminal-foreground', local.color),
    cursor: color('--color-codex-terminal-foreground', local.color),
    selectionBackground: color('--color-codex-terminal-selection', '#77777766'),
    selectionInactiveBackground: color('--color-codex-terminal-selection-inactive', '#77777740')
  }
  for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const) {
    const suffix = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    const value = color(`--color-codex-terminal-ansi-${suffix}`)
    if (value) theme[name] = value
  }
  probe.remove()
  return theme
}

interface CoordinateEvent { clientX: number; clientY: number }

export function terminalMouseCoordinates(
  event: CoordinateEvent,
  bounds: Pick<DOMRect, 'left' | 'top'>,
  zoom: number
): CoordinateEvent {
  return !Number.isFinite(zoom) || zoom <= 0 || zoom === 1 ? event : {
    clientX: bounds.left + (event.clientX - bounds.left) / zoom,
    clientY: bounds.top + (event.clientY - bounds.top) / zoom
  }
}

/**
 * The shipped xterm-window-zoom adapter corrects pointer coordinates for CSS
 * zoom. These guarded private hooks preserve that behavior with xterm 6.
 */
export function installTerminalMouseZoom(terminal: Terminal, getZoom: () => number): () => void {
  const core = (terminal as unknown as { _core?: {
    _mouseService?: {
      getCoords(event: CoordinateEvent, element: HTMLElement, ...rest: unknown[]): unknown
      getMouseReportCoords(event: CoordinateEvent, element: HTMLElement): unknown
    }
    _selectionService?: {
      _screenElement?: HTMLElement
      _getMouseEventScrollAmount?(event: CoordinateEvent): unknown
    }
  } })._core
  const mouse = core?._mouseService
  if (!mouse?.getCoords || !mouse.getMouseReportCoords) return () => {}
  const coords = mouse.getCoords
  const report = mouse.getMouseReportCoords
  const adjust = (event: CoordinateEvent, element: HTMLElement): CoordinateEvent => terminalMouseCoordinates(event, element.getBoundingClientRect(), getZoom())
  mouse.getCoords = (event, element, ...rest) => coords.call(mouse, adjust(event, element), element, ...rest)
  mouse.getMouseReportCoords = (event, element) => report.call(mouse, adjust(event, element), element)
  const selection = core?._selectionService
  const scroll = selection?._getMouseEventScrollAmount
  const screen = selection?._screenElement
  if (selection && scroll && screen) {
    selection._getMouseEventScrollAmount = (event) => scroll.call(selection, adjust(event, screen))
  }
  return () => {
    mouse.getCoords = coords
    mouse.getMouseReportCoords = report
    if (selection && scroll) selection._getMouseEventScrollAmount = scroll
  }
}

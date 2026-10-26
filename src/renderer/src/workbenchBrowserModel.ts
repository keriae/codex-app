import type { BrowserViewBounds, BrowserViewState } from '../../shared/api'

export interface WorkbenchBrowserTab {
  id: string
  state: BrowserViewState | null
}

export interface BrowserViewportRect {
  left: number
  top: number
  width: number
  height: number
}

let fallbackTabSequence = 0
const MAX_WORKBENCH_BROWSER_URL_LENGTH = 8_192

/** Recovered from the installed browser extension overflow action. */
export const WORKBENCH_BROWSER_WEB_STORE_URL = 'https://chromewebstore.google.com/'

function generatedBrowserTabId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `web-${globalThis.crypto.randomUUID()}`
  }
  fallbackTabSequence += 1
  return `web-${Date.now().toString(36)}-${fallbackTabSequence.toString(36)}`
}

export function createWorkbenchBrowserTab(id = generatedBrowserTabId()): WorkbenchBrowserTab {
  return { id, state: null }
}

export function updateWorkbenchBrowserTab(
  tab: WorkbenchBrowserTab,
  state: BrowserViewState
): WorkbenchBrowserTab {
  if (tab.id !== state.id || tab.state === state) return tab
  return { ...tab, state }
}

export function hasWorkbenchBrowserPage(state: BrowserViewState | null): boolean {
  const url = state?.url.trim().toLowerCase() || ''
  return url !== '' && url !== 'about:blank'
}

export function workbenchBrowserAddress(state: BrowserViewState | null): string {
  return hasWorkbenchBrowserPage(state) ? state!.url : ''
}

function explicitWebUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      url.href.length <= MAX_WORKBENCH_BROWSER_URL_LENGTH
    ) ? url.href : null
  } catch {
    return null
  }
}

function hostLikeUrl(value: string): string | null {
  if (/\s/.test(value)) return null
  const host = value.split(/[/?#]/, 1)[0]?.replace(/:\d+$/, '') || ''
  const localhost = host.toLowerCase() === 'localhost'
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
  const domain = host.includes('.') && !host.startsWith('.') && !host.endsWith('.')
  if (!localhost && !ipv4 && !domain) return null
  try {
    const url = new URL(`${localhost || ipv4 ? 'http' : 'https'}://${value}`)
    return !url.username && !url.password && url.href.length <= MAX_WORKBENCH_BROWSER_URL_LENGTH
      ? url.href
      : null
  } catch {
    return null
  }
}

/** Mirrors an omnibox: web URLs navigate directly and all other input becomes a search. */
export function normalizeWorkbenchBrowserAddress(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return explicitWebUrl(trimmed)
  const hostLike = hostLikeUrl(trimmed)
  if (hostLike) return hostLike
  const search = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  return search.length <= MAX_WORKBENCH_BROWSER_URL_LENGTH ? search : null
}

export function workbenchBrowserBounds(rect: BrowserViewportRect): BrowserViewBounds {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height))
  }
}

export function sameWorkbenchBrowserBounds(
  left: BrowserViewBounds | null,
  right: BrowserViewBounds
): boolean {
  return Boolean(
    left &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

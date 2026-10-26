import type {
  BrowserWindow,
  Rectangle,
  WebContentsView,
  WebContentsViewConstructorOptions,
  WebPreferences
} from 'electron'
import type { BrowserViewBounds, BrowserViewEvent, BrowserViewState } from '../shared/api'
import type { BrowserHistoryRecorder } from './browserHistory'

const MAX_BROWSER_VIEWS = 16
const MAX_BROWSER_VIEW_URL_LENGTH = 8_192
const MAX_BROWSER_VIEW_TITLE_LENGTH = 512
const MAX_BROWSER_VIEW_BOUND = 32_768
const BROWSER_VIEW_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const ERR_ABORTED = -3

export const SECURE_BROWSER_VIEW_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
  spellcheck: true
} satisfies WebPreferences)

export type BrowserViewFactory = (
  options: WebContentsViewConstructorOptions
) => WebContentsView

interface BrowserViewEntry {
  readonly id: string
  readonly view: WebContentsView
  active: boolean
  bounds: Rectangle
  url: string
  title: string
  loading: boolean
  error: string | null
  navigation: number
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && BROWSER_VIEW_ID.test(value)
}

/**
 * The native browser surface intentionally accepts only ordinary web URLs. This
 * excludes file:, javascript:, data: and custom-protocol navigations from both
 * renderer requests and page-created popups.
 */
export function normalizeBrowserViewUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_BROWSER_VIEW_URL_LENGTH ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) return null

  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.href.length > MAX_BROWSER_VIEW_URL_LENGTH
    ) return null
    return parsed.href
  } catch {
    return null
  }
}

function parseBounds(value: unknown): BrowserViewBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid browser view bounds')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 4 ||
    keys.some((key) => !['x', 'y', 'width', 'height'].includes(key))
  ) throw new Error('Invalid browser view bounds')

  const bounds = {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height
  }
  if (Object.values(bounds).some((part) =>
    typeof part !== 'number' ||
    !Number.isInteger(part) ||
    part < 0 ||
    part > MAX_BROWSER_VIEW_BOUND
  )) throw new Error('Invalid browser view bounds')
  return bounds as BrowserViewBounds
}

function fitBoundsToWindow(bounds: BrowserViewBounds, windowBounds: Rectangle): Rectangle {
  if (
    !Number.isInteger(windowBounds.width) ||
    !Number.isInteger(windowBounds.height) ||
    windowBounds.width < 0 ||
    windowBounds.height < 0
  ) throw new Error('Browser window bounds are unavailable')

  const x = Math.min(bounds.x, windowBounds.width)
  const y = Math.min(bounds.y, windowBounds.height)
  return {
    x,
    y,
    width: Math.min(bounds.width, windowBounds.width - x),
    height: Math.min(bounds.height, windowBounds.height - y)
  }
}

function boundedText(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum)
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return boundedText(message || 'Navigation failed', MAX_BROWSER_VIEW_TITLE_LENGTH)
}

function isAbortedNavigation(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error && error.code === ERR_ABORTED) return true
  return error instanceof Error && /ERR_ABORTED/u.test(error.message)
}

export class BrowserViews {
  private readonly entries = new Map<string, BrowserViewEntry>()
  private activeId: string | null = null
  private disposed = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly createNativeView: BrowserViewFactory,
    private readonly emit: (event: BrowserViewEvent) => void,
    private readonly history?: BrowserHistoryRecorder
  ) {}

  create(idValue: unknown): BrowserViewState {
    this.assertAvailable()
    const id = this.parseId(idValue)
    const existing = this.entries.get(id)
    if (existing) return this.state(existing)
    if (this.entries.size >= MAX_BROWSER_VIEWS) throw new Error('Too many browser views')

    const view = this.createNativeView({
      webPreferences: { ...SECURE_BROWSER_VIEW_WEB_PREFERENCES }
    })
    const entry: BrowserViewEntry = {
      id,
      view,
      active: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      url: '',
      title: '',
      loading: false,
      error: null,
      navigation: 0
    }
    this.entries.set(id, entry)
    try {
      view.setBounds(entry.bounds)
      view.setVisible(false)
      this.installNavigationPolicy(entry)
      this.window.contentView.addChildView(view)
    } catch (error) {
      this.entries.delete(id)
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
      throw error
    }
    return this.state(entry)
  }

  async navigate(idValue: unknown, urlValue: unknown): Promise<void> {
    const entry = this.requireEntry(idValue)
    const url = normalizeBrowserViewUrl(urlValue)
    if (!url) throw new Error('Invalid browser view URL')

    entry.url = url
    entry.loading = true
    entry.error = null
    const navigation = ++entry.navigation
    this.emitState(entry)
    try {
      await entry.view.webContents.loadURL(url)
    } catch (error) {
      if (
        this.entries.get(entry.id) === entry &&
        entry.navigation === navigation &&
        !entry.view.webContents.isDestroyed()
      ) {
        entry.loading = false
        if (!isAbortedNavigation(error) && !entry.error) entry.error = errorMessage(error)
        this.emitState(entry)
      }
      if (isAbortedNavigation(error)) return
      throw error
    }
  }

  goBack(idValue: unknown): void {
    const entry = this.requireEntry(idValue)
    if (entry.view.webContents.navigationHistory.canGoBack()) {
      entry.navigation += 1
      entry.error = null
      entry.view.webContents.navigationHistory.goBack()
    }
  }

  goForward(idValue: unknown): void {
    const entry = this.requireEntry(idValue)
    if (entry.view.webContents.navigationHistory.canGoForward()) {
      entry.navigation += 1
      entry.error = null
      entry.view.webContents.navigationHistory.goForward()
    }
  }

  reload(idValue: unknown): void {
    const entry = this.requireEntry(idValue)
    entry.navigation += 1
    entry.loading = true
    entry.error = null
    entry.view.webContents.reload()
    this.emitState(entry)
  }

  stop(idValue: unknown): void {
    const entry = this.requireEntry(idValue)
    entry.navigation += 1
    entry.view.webContents.stop()
    entry.loading = false
    this.emitState(entry)
  }

  setBounds(idValue: unknown, value: unknown): void {
    const entry = this.requireEntry(idValue)
    const bounds = fitBoundsToWindow(parseBounds(value), this.window.getContentBounds())
    entry.bounds = bounds
    entry.view.setBounds(bounds)
    this.updateVisibility(entry)
  }

  setActive(idValue: unknown, activeValue: unknown): void {
    const entry = this.requireEntry(idValue)
    if (typeof activeValue !== 'boolean') throw new Error('Invalid browser view active state')

    if (activeValue) {
      for (const candidate of this.entries.values()) {
        candidate.active = candidate === entry
        this.updateVisibility(candidate)
      }
      this.activeId = entry.id
      // Adding an existing child again raises it above any inactive native view.
      this.window.contentView.addChildView(entry.view)
      this.updateVisibility(entry)
    } else {
      entry.active = false
      if (this.activeId === entry.id) this.activeId = null
      this.updateVisibility(entry)
    }
  }

  close(idValue: unknown): void {
    this.assertAvailable()
    const id = this.parseId(idValue)
    const entry = this.entries.get(id)
    if (!entry) return
    this.closeEntry(entry)
  }

  /** Clears views owned by a renderer document while keeping the window reusable. */
  reset(): void {
    if (this.disposed) return
    for (const entry of [...this.entries.values()]) this.closeEntry(entry)
  }

  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
  }

  private installNavigationPolicy(entry: BrowserViewEntry): void {
    const contents = entry.view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      const normalized = normalizeBrowserViewUrl(url)
      if (normalized && this.entries.get(entry.id) === entry) {
        this.emit({ type: 'open-new-tab', sourceId: entry.id, url: normalized })
      }
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame || normalizeBrowserViewUrl(event.url)) return
      event.preventDefault()
      this.navigationBlocked(entry)
    })
    contents.on('will-redirect', (event) => {
      if (!event.isMainFrame || normalizeBrowserViewUrl(event.url)) return
      event.preventDefault()
      this.navigationBlocked(entry)
    })
    contents.on('did-start-loading', () => {
      entry.loading = true
      entry.error = null
      this.emitState(entry)
    })
    contents.on('did-stop-loading', () => {
      entry.loading = false
      this.emitState(entry)
    })
    contents.on('did-navigate', (_event, url) => this.navigationCommitted(entry, url))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.navigationCommitted(entry, url)
    })
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      entry.title = boundedText(title, MAX_BROWSER_VIEW_TITLE_LENGTH)
      if (entry.url) this.history?.updateTitle(entry.url, entry.title)
      this.emitState(entry)
    })
    contents.on('did-fail-load', (_event, errorCode, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return
      const normalized = normalizeBrowserViewUrl(validatedUrl)
      if (normalized) entry.url = normalized
      entry.loading = false
      entry.error = boundedText(description || `Navigation failed (${errorCode})`, MAX_BROWSER_VIEW_TITLE_LENGTH)
      this.emitState(entry)
    })
    contents.on('render-process-gone', (_event, details) => {
      entry.loading = false
      entry.error = boundedText(`Page process exited: ${details.reason}`, MAX_BROWSER_VIEW_TITLE_LENGTH)
      this.emitState(entry)
    })
    contents.once('destroyed', () => {
      if (this.entries.get(entry.id) !== entry) return
      this.entries.delete(entry.id)
      if (this.activeId === entry.id) this.activeId = null
      entry.active = false
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(entry.view)
    })
  }

  private navigationCommitted(entry: BrowserViewEntry, value: string): void {
    const url = normalizeBrowserViewUrl(value)
    if (!url) {
      entry.view.webContents.stop()
      this.navigationBlocked(entry)
      return
    }
    entry.url = url
    entry.error = null
    this.history?.recordVisit(url)
    this.emitState(entry)
  }

  private navigationBlocked(entry: BrowserViewEntry): void {
    entry.loading = false
    entry.error = 'Blocked navigation to an unsupported URL'
    this.emitState(entry)
  }

  private state(entry: BrowserViewEntry): BrowserViewState {
    const contents = entry.view.webContents
    return {
      id: entry.id,
      url: entry.url,
      title: entry.title,
      loading: entry.loading,
      canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
      canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
      error: entry.error
    }
  }

  private emitState(entry: BrowserViewEntry): void {
    if (this.disposed || this.entries.get(entry.id) !== entry || entry.view.webContents.isDestroyed()) return
    this.emit({ type: 'state', state: this.state(entry) })
  }

  private updateVisibility(entry: BrowserViewEntry): void {
    entry.view.setVisible(
      entry.active && entry.bounds.width > 0 && entry.bounds.height > 0
    )
  }

  private closeEntry(entry: BrowserViewEntry): void {
    this.entries.delete(entry.id)
    entry.navigation += 1
    if (this.activeId === entry.id) this.activeId = null
    entry.active = false
    if (!this.window.isDestroyed()) {
      entry.view.setVisible(false)
      this.window.contentView.removeChildView(entry.view)
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  private requireEntry(idValue: unknown): BrowserViewEntry {
    this.assertAvailable()
    const entry = this.entries.get(this.parseId(idValue))
    if (!entry || entry.view.webContents.isDestroyed()) {
      throw new Error('Browser view is unavailable')
    }
    return entry
  }

  private parseId(value: unknown): string {
    if (!validId(value)) throw new Error('Invalid browser view id')
    return value
  }

  private assertAvailable(): void {
    if (this.disposed || this.window.isDestroyed()) throw new Error('Browser window is unavailable')
  }
}

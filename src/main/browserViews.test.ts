import { EventEmitter } from 'node:events'
import type {
  BrowserWindow,
  Rectangle,
  WebContentsView,
  WebContentsViewConstructorOptions
} from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserViewEvent } from '../shared/api'
import {
  BrowserViews,
  normalizeBrowserViewUrl,
  SECURE_BROWSER_VIEW_WEB_PREFERENCES
} from './browserViews'

class FakeNavigationHistory {
  back = false
  forward = false
  readonly goBack = vi.fn()
  readonly goForward = vi.fn()

  canGoBack(): boolean { return this.back }
  canGoForward(): boolean { return this.forward }
}

class FakeWebContents extends EventEmitter {
  readonly navigationHistory = new FakeNavigationHistory()
  readonly loadURL = vi.fn(async (_url: string): Promise<void> => {})
  readonly reload = vi.fn()
  readonly stop = vi.fn()
  readonly close = vi.fn((_options: { waitForBeforeUnload: boolean }) => {
    this.destroyed = true
  })
  destroyed = false
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null

  isDestroyed(): boolean { return this.destroyed }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.windowOpenHandler = handler
  }
}

class FakeView {
  readonly webContents = new FakeWebContents()
  bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  visible = true
  readonly setBounds = vi.fn((bounds: Rectangle) => { this.bounds = { ...bounds } })
  readonly setVisible = vi.fn((visible: boolean) => { this.visible = visible })
}

class FakeContentView {
  readonly children: FakeView[] = []
  readonly addChildView = vi.fn((view: FakeView) => {
    const current = this.children.indexOf(view)
    if (current >= 0) this.children.splice(current, 1)
    this.children.push(view)
  })
  readonly removeChildView = vi.fn((view: FakeView) => {
    const current = this.children.indexOf(view)
    if (current >= 0) this.children.splice(current, 1)
  })
}

function fixture(contentBounds: Rectangle = { x: 50, y: 70, width: 800, height: 600 }) {
  const contentView = new FakeContentView()
  const window = {
    contentView,
    getContentBounds: () => ({ ...contentBounds }),
    isDestroyed: () => false
  } as unknown as BrowserWindow
  const events: BrowserViewEvent[] = []
  const history = { recordVisit: vi.fn(), updateTitle: vi.fn() }
  const created: { options: WebContentsViewConstructorOptions; view: FakeView }[] = []
  const browserViews = new BrowserViews(
    window,
    (options) => {
      const view = new FakeView()
      created.push({ options, view })
      return view as unknown as WebContentsView
    },
    (event) => events.push(event),
    history
  )
  return { browserViews, contentView, created, events, history }
}

function navigationEvent(url: string, isMainFrame = true) {
  return { url, isMainFrame, preventDefault: vi.fn() }
}

describe('native browser view security', () => {
  it('creates an initially hidden view with immutable secure web preferences', () => {
    const test = fixture()
    expect(test.browserViews.create('browser:one')).toEqual({
      id: 'browser:one', url: '', title: '', loading: false,
      canGoBack: false, canGoForward: false, error: null
    })
    expect(test.created).toHaveLength(1)
    expect(test.created[0].options.webPreferences).toEqual(SECURE_BROWSER_VIEW_WEB_PREFERENCES)
    expect(test.created[0].options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false
    })
    expect(test.created[0].view.visible).toBe(false)
    expect(test.contentView.children).toEqual([test.created[0].view])
    expect(test.browserViews.create('browser:one').id).toBe('browser:one')
    expect(test.created).toHaveLength(1)
  })

  it('rejects malformed identifiers and caps native view allocation', () => {
    const test = fixture()
    for (const id of ['', '../escape', 'space id', `x${'a'.repeat(128)}`, null]) {
      expect(() => test.browserViews.create(id)).toThrow('Invalid browser view id')
    }
    for (let index = 0; index < 16; index++) test.browserViews.create(`browser:${index}`)
    expect(() => test.browserViews.create('browser:overflow')).toThrow('Too many browser views')
  })

  it('accepts only absolute credential-free HTTP(S) URLs', () => {
    expect(normalizeBrowserViewUrl('https://example.com/docs?q=one#two')).toBe(
      'https://example.com/docs?q=one#two'
    )
    expect(normalizeBrowserViewUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    for (const url of [
      '', 'example.com', ' file:///tmp/a ', 'file:///tmp/a', 'javascript:alert(1)',
      'data:text/html,test', 'https://user:secret@example.com', 'https://example.com\n'
    ]) expect(normalizeBrowserViewUrl(url)).toBeNull()
  })

  it('blocks non-web main-frame navigation and turns valid popups into tab events', async () => {
    const test = fixture()
    test.browserViews.create('browser:source')
    const contents = test.created[0].view.webContents

    await expect(test.browserViews.navigate('browser:source', 'file:///tmp/private')).rejects.toThrow(
      'Invalid browser view URL'
    )
    await test.browserViews.navigate('browser:source', 'https://example.com')
    expect(contents.loadURL).toHaveBeenCalledWith('https://example.com/')

    expect(contents.windowOpenHandler?.({ url: 'https://openai.com/research' })).toEqual({ action: 'deny' })
    expect(test.events.at(-1)).toEqual({
      type: 'open-new-tab', sourceId: 'browser:source', url: 'https://openai.com/research'
    })
    const eventCount = test.events.length
    expect(contents.windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(test.events).toHaveLength(eventCount)

    const blocked = navigationEvent('file:///tmp/private')
    contents.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(test.events.at(-1)).toMatchObject({
      type: 'state',
      state: { id: 'browser:source', error: 'Blocked navigation to an unsupported URL' }
    })

    const subframe = navigationEvent('data:text/html,embedded', false)
    contents.emit('will-frame-navigate', subframe)
    expect(subframe.preventDefault).not.toHaveBeenCalled()
    const redirect = navigationEvent('custom:redirect')
    contents.emit('will-redirect', redirect)
    expect(redirect.preventDefault).toHaveBeenCalledOnce()
  })
})

describe('native browser view lifecycle and state', () => {
  it('strictly validates and clips renderer bounds to the window content area', () => {
    const test = fixture()
    test.browserViews.create('browser:a')
    test.browserViews.create('browser:b')
    const [a, b] = test.created.map(({ view }) => view)

    test.browserViews.setBounds('browser:a', { x: 700, y: 550, width: 500, height: 500 })
    expect(a.bounds).toEqual({ x: 700, y: 550, width: 100, height: 50 })
    test.browserViews.setActive('browser:a', true)
    expect(a.visible).toBe(true)

    test.browserViews.setBounds('browser:b', { x: 20, y: 30, width: 400, height: 300 })
    test.browserViews.setActive('browser:b', true)
    expect(a.visible).toBe(false)
    expect(b.visible).toBe(true)
    expect(test.contentView.children.at(-1)).toBe(b)
    test.browserViews.setActive('browser:b', false)
    expect(b.visible).toBe(false)

    for (const bounds of [
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0.5, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 32_769, height: 1 },
      { x: 0, y: 0, width: 1, height: 1, extra: true },
      null
    ]) expect(() => test.browserViews.setBounds('browser:a', bounds)).toThrow(
      'Invalid browser view bounds'
    )
    expect(() => test.browserViews.setActive('browser:a', 'yes')).toThrow(
      'Invalid browser view active state'
    )
  })

  it('publishes navigation state and routes toolbar controls through navigation history', () => {
    const test = fixture()
    test.browserViews.create('browser:state')
    const contents = test.created[0].view.webContents
    contents.navigationHistory.back = true
    contents.navigationHistory.forward = true

    contents.emit('did-start-loading')
    contents.emit('did-navigate', {}, 'https://example.com/page')
    const titleEvent = { preventDefault: vi.fn() }
    contents.emit('page-title-updated', titleEvent, 'Example')
    contents.emit('did-stop-loading')
    expect(titleEvent.preventDefault).toHaveBeenCalledOnce()
    expect(test.history.recordVisit).toHaveBeenCalledWith('https://example.com/page')
    expect(test.history.updateTitle).toHaveBeenCalledWith('https://example.com/page', 'Example')
    expect(test.events.at(-1)).toEqual({
      type: 'state',
      state: {
        id: 'browser:state',
        url: 'https://example.com/page',
        title: 'Example',
        loading: false,
        canGoBack: true,
        canGoForward: true,
        error: null
      }
    })

    test.browserViews.goBack('browser:state')
    test.browserViews.goForward('browser:state')
    expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce()
    expect(contents.navigationHistory.goForward).toHaveBeenCalledOnce()
    test.browserViews.reload('browser:state')
    expect(contents.reload).toHaveBeenCalledOnce()
    expect(test.events.at(-1)).toMatchObject({ type: 'state', state: { loading: true } })
    test.browserViews.stop('browser:state')
    expect(contents.stop).toHaveBeenCalledOnce()
    expect(test.events.at(-1)).toMatchObject({ type: 'state', state: { loading: false } })

    const previousEvents = test.events.length
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/page', true)
    expect(test.events).toHaveLength(previousEvents)
    contents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://missing.invalid', true)
    expect(test.events.at(-1)).toMatchObject({
      type: 'state', state: { url: 'https://missing.invalid/', error: 'NAME_NOT_RESOLVED' }
    })
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(test.events.at(-1)).toMatchObject({
      type: 'state', state: { error: 'Page process exited: crashed' }
    })
  })

  it('does not turn an intentionally aborted load into a page error', async () => {
    const test = fixture()
    test.browserViews.create('browser:abort')
    const contents = test.created[0].view.webContents
    contents.loadURL.mockRejectedValueOnce(Object.assign(new Error('ERR_ABORTED (-3)'), { code: -3 }))
    await expect(test.browserViews.navigate('browser:abort', 'https://example.com')).resolves.toBeUndefined()
    expect(test.events.at(-1)).toMatchObject({
      type: 'state', state: { loading: false, error: null }
    })
  })

  it('closes native contents without beforeunload and resets safely across renderer documents', () => {
    const test = fixture()
    test.browserViews.create('browser:one')
    const first = test.created[0].view
    test.browserViews.close('browser:one')
    expect(test.contentView.children).toHaveLength(0)
    expect(first.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(() => test.browserViews.close('browser:one')).not.toThrow()

    test.browserViews.create('browser:two')
    test.browserViews.reset()
    expect(test.contentView.children).toHaveLength(0)
    expect(() => test.browserViews.create('browser:after-reset')).not.toThrow()
    const externallyDestroyed = test.created.at(-1)!.view
    externallyDestroyed.webContents.destroyed = true
    externallyDestroyed.webContents.emit('destroyed')
    expect(test.contentView.children).toHaveLength(0)
    expect(() => test.browserViews.create('browser:after-reset')).not.toThrow()
    test.browserViews.dispose()
    expect(test.contentView.children).toHaveLength(0)
    expect(() => test.browserViews.create('browser:disposed')).toThrow('Browser window is unavailable')
  })
})

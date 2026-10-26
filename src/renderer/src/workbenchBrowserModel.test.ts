import { describe, expect, it } from 'vitest'
import type { BrowserViewState } from '../../shared/api'
import {
  createWorkbenchBrowserTab,
  hasWorkbenchBrowserPage,
  normalizeWorkbenchBrowserAddress,
  sameWorkbenchBrowserBounds,
  updateWorkbenchBrowserTab,
  WORKBENCH_BROWSER_WEB_STORE_URL,
  workbenchBrowserAddress,
  workbenchBrowserBounds
} from './workbenchBrowserModel'

function state(id: string, url: string): BrowserViewState {
  return {
    id,
    url,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
  }
}

describe('workbench browser tabs', () => {
  it('creates an empty tab and accepts state only for the matching native view', () => {
    const tab = createWorkbenchBrowserTab('web-1')
    expect(tab).toEqual({ id: 'web-1', state: null })
    expect(updateWorkbenchBrowserTab(tab, state('web-2', 'https://example.com/'))).toBe(tab)
    expect(updateWorkbenchBrowserTab(tab, state('web-1', 'https://example.com/'))).toEqual({
      id: 'web-1',
      state: state('web-1', 'https://example.com/')
    })
  })

  it('distinguishes the new-tab home from a navigated native view', () => {
    expect(hasWorkbenchBrowserPage(null)).toBe(false)
    expect(hasWorkbenchBrowserPage(state('web-1', 'about:blank'))).toBe(false)
    expect(workbenchBrowserAddress(state('web-1', 'about:blank'))).toBe('')
    expect(hasWorkbenchBrowserPage(state('web-1', 'https://openai.com/'))).toBe(true)
    expect(workbenchBrowserAddress(state('web-1', 'https://openai.com/'))).toBe('https://openai.com/')
  })
})

describe('workbench browser omnibox', () => {
  it('uses the recovered Chrome Web Store destination', () => {
    expect(WORKBENCH_BROWSER_WEB_STORE_URL).toBe('https://chromewebstore.google.com/')
  })

  it('normalizes explicit web URLs, hostnames and local development addresses', () => {
    expect(normalizeWorkbenchBrowserAddress(' https://openai.com/docs ')).toBe('https://openai.com/docs')
    expect(normalizeWorkbenchBrowserAddress('github.com/openai/codex')).toBe('https://github.com/openai/codex')
    expect(normalizeWorkbenchBrowserAddress('localhost:5173/health')).toBe('http://localhost:5173/health')
    expect(normalizeWorkbenchBrowserAddress('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
  })

  it('turns plain text and unsupported schemes into safe searches', () => {
    expect(normalizeWorkbenchBrowserAddress('codex desktop app')).toBe(
      'https://www.google.com/search?q=codex%20desktop%20app'
    )
    expect(normalizeWorkbenchBrowserAddress('javascript:alert(1)')).toBe(
      'https://www.google.com/search?q=javascript%3Aalert(1)'
    )
    expect(normalizeWorkbenchBrowserAddress('   ')).toBeNull()
  })

  it('does not hand the native view URLs that its security boundary will reject', () => {
    expect(normalizeWorkbenchBrowserAddress('https://user:secret@example.com')).toBeNull()
    expect(normalizeWorkbenchBrowserAddress(`https://example.com/${'x'.repeat(8_192)}`)).toBeNull()
    expect(normalizeWorkbenchBrowserAddress('user:secret@example.com')).toBe(
      'https://www.google.com/search?q=user%3Asecret%40example.com'
    )
  })
})

describe('workbench browser native bounds', () => {
  it('rounds and clamps renderer geometry for Electron', () => {
    const bounds = workbenchBrowserBounds({ left: -0.3, top: 44.4, width: 799.6, height: 655.5 })
    expect(bounds).toEqual({ x: 0, y: 44, width: 800, height: 656 })
    expect(sameWorkbenchBrowserBounds(null, bounds)).toBe(false)
    expect(sameWorkbenchBrowserBounds({ ...bounds }, bounds)).toBe(true)
  })
})

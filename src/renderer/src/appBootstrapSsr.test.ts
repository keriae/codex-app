import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => { vi.unstubAllGlobals() })

describe('integrated desktop application startup rendering', () => {
  it('renders the real App with isolated browser preferences while native effects remain deferred', () => {
    const storage = new Map<string, string>()
    const localStorage = {
      getItem: (key: string): string | null => storage.get(key) ?? null,
      setItem: (key: string, value: string): void => { storage.set(key, value) },
      removeItem: (key: string): void => { storage.delete(key) }
    }
    const nativeAccess = vi.fn(() => { throw new Error('Native bridge must not execute during static startup rendering') })
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('window', {
      localStorage,
      matchMedia: () => ({ matches: true }),
      codex: new Proxy({}, { get: nativeAccess })
    })
    const html = renderToStaticMarkup(createElement(App))
    expect(html).toContain('class="app-shell')
    expect(html).toContain('<textarea')
    expect(html).toContain('Codex')
    expect(html).not.toContain('window-close-overlay')
    expect(nativeAccess).not.toHaveBeenCalled()
    expect(storage.size).toBe(0)
  })
})

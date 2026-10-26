import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserHistoryStore, normalizeBrowserHistoryUrl } from './browserHistory'

const directories: string[] = []

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'codex-browser-history-'))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('browser history top sites', () => {
  it('ranks persisted visits and updates the recovered page title', () => {
    const root = directory()
    const changed = vi.fn()
    const store = new BrowserHistoryStore(root, changed)
    store.recordVisit('https://example.com/docs#intro', null, 10)
    store.updateTitle('https://example.com/docs#other', 'Example docs')
    store.recordVisit('https://openai.com/', 'OpenAI', 20)
    store.recordVisit('https://example.com/docs', 'Example docs', 30)

    expect(store.list()).toEqual([
      { url: 'https://example.com/docs', title: 'Example docs', visitCount: 2, lastVisitTime: 30 },
      { url: 'https://openai.com/', title: 'OpenAI', visitCount: 1, lastVisitTime: 20 }
    ])
    expect(new BrowserHistoryStore(root).list()).toEqual(store.list())
    expect(JSON.parse(readFileSync(store.filePath, 'utf8')).version).toBe(1)
    expect(changed).toHaveBeenCalled()
  })

  it('persists dismissal and restores the same site for undo', () => {
    const root = directory()
    const store = new BrowserHistoryStore(root)
    store.recordVisit('https://example.com/', 'Example', 10)
    store.recordVisit('https://openai.com/', 'OpenAI', 20)

    expect(store.dismiss('https://openai.com/').map((site) => site.url)).toEqual([
      'https://example.com/'
    ])
    expect(new BrowserHistoryStore(root).list().map((site) => site.url)).toEqual([
      'https://example.com/'
    ])
    expect(store.restore('https://openai.com/').map((site) => site.url)).toEqual([
      'https://openai.com/',
      'https://example.com/'
    ])
  })

  it('accepts only credential-free HTTP(S) history URLs and removes fragments', () => {
    expect(normalizeBrowserHistoryUrl('https://example.com/path#part')).toBe('https://example.com/path')
    for (const value of ['example.com', 'file:///tmp/a', 'https://user:secret@example.com', ' https://example.com ']) {
      expect(normalizeBrowserHistoryUrl(value)).toBeNull()
    }
  })
})

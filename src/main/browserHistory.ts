import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserTopSite } from '../shared/api'

const HISTORY_VERSION = 1
const MAX_HISTORY_ENTRIES = 200
const MAX_URL_LENGTH = 8_192
const MAX_TITLE_LENGTH = 512

interface BrowserHistoryEntry extends BrowserTopSite {
  dismissed: boolean
}

interface BrowserHistorySnapshot {
  version: number
  entries: BrowserHistoryEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeBrowserHistoryUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
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
      parsed.href.length > MAX_URL_LENGTH
    ) return null
    parsed.hash = ''
    return parsed.href
  } catch {
    return null
  }
}

function boundedTitle(value: unknown, url: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, MAX_TITLE_LENGTH)
  }
  try {
    return new URL(url).hostname.slice(0, MAX_TITLE_LENGTH)
  } catch {
    return url.slice(0, MAX_TITLE_LENGTH)
  }
}

function parseEntry(value: unknown): BrowserHistoryEntry | null {
  if (!isRecord(value)) return null
  const url = normalizeBrowserHistoryUrl(value.url)
  if (
    !url ||
    typeof value.visitCount !== 'number' ||
    !Number.isSafeInteger(value.visitCount) ||
    value.visitCount < 1 ||
    typeof value.lastVisitTime !== 'number' ||
    !Number.isFinite(value.lastVisitTime) ||
    value.lastVisitTime < 0
  ) return null
  return {
    url,
    title: boundedTitle(value.title, url),
    visitCount: value.visitCount,
    lastVisitTime: value.lastVisitTime,
    dismissed: value.dismissed === true
  }
}

function parseSnapshot(raw: string): BrowserHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== HISTORY_VERSION || !Array.isArray(value.entries)) return []
    const byUrl = new Map<string, BrowserHistoryEntry>()
    for (const candidate of value.entries.slice(0, MAX_HISTORY_ENTRIES)) {
      const entry = parseEntry(candidate)
      if (!entry) continue
      const previous = byUrl.get(entry.url)
      if (!previous || previous.lastVisitTime < entry.lastVisitTime) byUrl.set(entry.url, entry)
    }
    return [...byUrl.values()]
  } catch {
    return []
  }
}

function ranked(entries: Iterable<BrowserHistoryEntry>): BrowserHistoryEntry[] {
  return [...entries].sort((left, right) =>
    right.visitCount - left.visitCount ||
    right.lastVisitTime - left.lastVisitTime ||
    left.url.localeCompare(right.url)
  )
}

export interface BrowserHistoryRecorder {
  recordVisit(url: string, title?: string | null): void
  updateTitle(url: string, title: string): void
}

export class BrowserHistoryStore implements BrowserHistoryRecorder {
  readonly filePath: string
  private readonly entries = new Map<string, BrowserHistoryEntry>()

  constructor(
    userDataDirectory: string,
    private readonly onChange: (sites: BrowserTopSite[]) => void = () => {}
  ) {
    this.filePath = join(userDataDirectory, 'browser-history.json')
    try {
      for (const entry of parseSnapshot(readFileSync(this.filePath, 'utf8'))) {
        this.entries.set(entry.url, entry)
      }
    } catch { /* First launch and stale browser history start empty. */ }
  }

  list(limit = 4): BrowserTopSite[] {
    const count = Math.max(0, Math.min(MAX_HISTORY_ENTRIES, Math.floor(limit)))
    return ranked(this.entries.values())
      .filter((entry) => !entry.dismissed)
      .slice(0, count)
      .map(({ url, title, visitCount, lastVisitTime }) => ({
        url,
        title,
        visitCount,
        lastVisitTime
      }))
  }

  recordVisit(value: string, title?: string | null, now = Date.now()): void {
    const url = normalizeBrowserHistoryUrl(value)
    if (!url || !Number.isFinite(now) || now < 0) return
    const previous = this.entries.get(url)
    this.entries.set(url, {
      url,
      title: boundedTitle(title || previous?.title, url),
      visitCount: (previous?.visitCount ?? 0) + 1,
      lastVisitTime: now,
      dismissed: previous?.dismissed ?? false
    })
    this.trimAndSave()
  }

  updateTitle(value: string, title: string): void {
    const url = normalizeBrowserHistoryUrl(value)
    const previous = url ? this.entries.get(url) : undefined
    if (!url || !previous || !title.trim()) return
    const nextTitle = boundedTitle(title, url)
    if (nextTitle === previous.title) return
    this.entries.set(url, { ...previous, title: nextTitle })
    this.saveAndEmit()
  }

  dismiss(value: unknown): BrowserTopSite[] {
    const url = normalizeBrowserHistoryUrl(value)
    if (!url) throw new Error('Invalid browser history URL')
    const previous = this.entries.get(url)
    if (previous && !previous.dismissed) {
      this.entries.set(url, { ...previous, dismissed: true })
      this.saveAndEmit()
    }
    return this.list()
  }

  restore(value: unknown): BrowserTopSite[] {
    const url = normalizeBrowserHistoryUrl(value)
    if (!url) throw new Error('Invalid browser history URL')
    const previous = this.entries.get(url)
    if (previous?.dismissed) {
      this.entries.set(url, { ...previous, dismissed: false })
      this.saveAndEmit()
    }
    return this.list()
  }

  private trimAndSave(): void {
    const entries = ranked(this.entries.values())
    if (entries.length > MAX_HISTORY_ENTRIES) {
      this.entries.clear()
      for (const entry of entries.slice(0, MAX_HISTORY_ENTRIES)) this.entries.set(entry.url, entry)
    }
    this.saveAndEmit()
  }

  private saveAndEmit(): void {
    const snapshot: BrowserHistorySnapshot = {
      version: HISTORY_VERSION,
      entries: ranked(this.entries.values())
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
    this.onChange(this.list())
  }
}

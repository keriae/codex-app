import type { WorkspaceFileResult, WorkspaceFileSaveResult, WorkspaceTextFileResult } from '../../shared/api'
import { workspaceErrorMessage } from './workspaceFileModel'
import { resolveWorkspaceFileLink } from './workspaceFileLinks'

export interface WorkspaceDocument {
  id: number
  path: string
  status: 'loading' | 'ready' | 'error'
  result?: WorkspaceFileResult
  text?: string
  preview: boolean
  saving: boolean
  error?: string
  conflict?: string
  diskTypeChanged?: boolean
  saveFailed?: boolean
  line: number | null
}

interface DocumentClient {
  readWorkspaceFile(root: string, path: string): Promise<WorkspaceFileResult>
  saveWorkspaceFile(root: string, path: string, text: string, expectedText: string): Promise<WorkspaceFileSaveResult>
}

export interface WorkspaceDocumentsSnapshot { documents: WorkspaceDocument[]; activePath: string | null }
interface DocumentStorage { read(): unknown; write(value: unknown): void }
function recoveredTextBaseline(path: string, text: string): WorkspaceTextFileResult {
  return { path, kind: 'text', mimeType: 'text/plain', text, sizeBytes: new TextEncoder().encode(text).byteLength }
}
export function documentIsDirty(document: WorkspaceDocument): boolean {
  return document.result?.kind === 'text' && (document.text !== document.result.text || document.conflict !== undefined || document.diskTypeChanged === true || document.saveFailed === true)
}

/** Tab instances own their async results; an old load/save cannot overwrite a reopened tab. */
export class WorkspaceDocuments {
  private snapshot: WorkspaceDocumentsSnapshot = { documents: [], activePath: null }
  private listeners = new Set<() => void>()
  private nextId = 0
  private saves = new Map<number, Promise<boolean>>()
  private timers = new Map<number, ReturnType<typeof setTimeout>>()
  private readVersions = new Map<number, number>()
  private pendingReloads = new Set<number>()
  private restoredDrafts = new Map<number, {text: string; base: string}>()
  private restored = false
  constructor(readonly root: string, private client: DocumentClient, private storage?: DocumentStorage) {
    try {
      const saved = storage?.read() as {tabs?: unknown; activePath?: unknown} | undefined
      if (!saved || !Array.isArray(saved.tabs)) return
      const documents: WorkspaceDocument[] = []
      for (const entry of saved.tabs.slice(0, 30)) {
        if (!entry || typeof entry !== 'object') continue
        const tab = entry as Record<string, unknown>
        if (typeof tab.path !== 'string' || resolveWorkspaceFileLink(root, tab.path) !== tab.path || documents.some((doc) => doc.path === tab.path)) continue
        const doc: WorkspaceDocument = {id: ++this.nextId, path: tab.path, preview: tab.preview === true, line: Number.isSafeInteger(tab.line) && Number(tab.line) > 0 ? Number(tab.line) : null, status: 'loading', saving: false}
        if (typeof tab.text === 'string' && typeof tab.base === 'string' && tab.text.length <= 512 * 1024 && tab.base.length <= 512 * 1024) this.restoredDrafts.set(doc.id, {text: tab.text, base: tab.base})
        documents.push(doc)
      }
      this.snapshot = {documents, activePath: documents.some((doc) => doc.path === saved.activePath) ? String(saved.activePath) : documents[0]?.path ?? null}
    } catch { /* A malformed or full desktop profile must not block opening the project. */ }
  }
  getSnapshot = (): WorkspaceDocumentsSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.restored) { this.restored = true; const documents = this.snapshot.documents; queueMicrotask(() => documents.forEach((doc) => { void this.load(doc) })) }
    return () => this.listeners.delete(listener)
  }
  private emit(documents = this.snapshot.documents, activePath = this.snapshot.activePath): void {
    this.snapshot = { documents, activePath }
    try { this.storage?.write({activePath, tabs: documents.map((doc) => {
      // A pending write may change the disk baseline even when an undo has
      // returned the editor to the previous baseline. Keep that text durable.
      const draft = (documentIsDirty(doc) || doc.saving) && doc.result?.kind === 'text' ? {text: doc.text, base: doc.result.text} : this.restoredDrafts.get(doc.id)
      return {path: doc.path, preview: doc.preview, line: doc.line, ...draft}
    })}) } catch { /* In-memory drafts remain available when local storage is full. */ }
    this.listeners.forEach((listener) => listener())
  }
  private update(id: number, change: Partial<WorkspaceDocument>): void {
    this.emit(this.snapshot.documents.map((doc) => doc.id === id ? { ...doc, ...change } : doc))
  }
  activate(path: string): void { if (this.snapshot.documents.some((doc) => doc.path === path)) this.emit(undefined, path) }
  pin(path: string): void { const doc = this.find(path); if (doc) this.update(doc.id, { preview: false }) }
  find(path: string): WorkspaceDocument | undefined { return this.snapshot.documents.find((doc) => doc.path === path) }
  async open(path: string, line: number | null = null, preview = true): Promise<void> {
    const existing = this.find(path)
    if (existing) {
      this.update(existing.id, { line: line ?? existing.line, preview: existing.preview && preview })
      this.activate(path)
      if (existing.status === 'error') await this.reload(path)
      return
    }
    const document: WorkspaceDocument = { id: ++this.nextId, path, status: 'loading', preview, saving: false, line }
    this.emit([...this.snapshot.documents.filter((doc) => !doc.preview || documentIsDirty(doc) || doc.saving || this.restoredDrafts.has(doc.id)), document], path)
    await this.load(document)
  }
  private async load(document: WorkspaceDocument): Promise<void> {
    const version = (this.readVersions.get(document.id) || 0) + 1
    this.readVersions.set(document.id, version)
    try {
      const result = await this.client.readWorkspaceFile(this.root, document.path)
      if (this.readVersions.get(document.id) !== version || this.find(document.path)?.id !== document.id) return
      const draft = this.restoredDrafts.get(document.id)
      this.restoredDrafts.delete(document.id)
      if (draft && result.kind !== 'text') {
        // The recovered text is an editing baseline, not the current disk
        // contents. Native save still validates the actual file type.
        this.update(document.id, { status: 'ready', result: recoveredTextBaseline(document.path, draft.base), text: draft.text,
          conflict: undefined, diskTypeChanged: true, saveFailed: false, error: '磁盘上的文件类型已改变。未保存的更改已保留。' })
      } else this.update(document.id, { status: 'ready', result: draft && result.kind === 'text' ? {...result, text: draft.base} : result,
        text: result.kind === 'text' ? draft?.text ?? result.text : undefined, conflict: draft && result.kind === 'text' && draft.base !== result.text ? result.text : undefined, diskTypeChanged: false, saveFailed: false, error: undefined })
    } catch (error) {
      if (this.readVersions.get(document.id) !== version || this.find(document.path)?.id !== document.id) return
      const draft = this.restoredDrafts.get(document.id)
      if (draft) {
        this.restoredDrafts.delete(document.id)
        this.update(document.id, { status: 'ready', result: recoveredTextBaseline(document.path, draft.base), text: draft.text,
          conflict: undefined, diskTypeChanged: false, saveFailed: true, error: workspaceErrorMessage(error) })
      } else this.update(document.id, { status: 'error', error: workspaceErrorMessage(error) })
    }
  }
  async reload(path: string): Promise<void> {
    const doc = this.find(path)
    if (!doc) return
    if (doc.saving) { this.pendingReloads.add(doc.id); return }
    if (doc.status !== 'ready') { this.update(doc.id, { status: 'loading', error: undefined }); await this.load(doc); return }
    const version = (this.readVersions.get(doc.id) || 0) + 1
    this.readVersions.set(doc.id, version)
    try {
      const disk = await this.client.readWorkspaceFile(this.root, path)
      const current = this.find(path)
      if (!current || current.id !== doc.id || this.readVersions.get(doc.id) !== version) return
      if (current.saving) { this.pendingReloads.add(doc.id); return }
      if (disk.kind === 'text' && current.result?.kind === 'text' && documentIsDirty(current)) {
        this.update(doc.id, { conflict: disk.text !== current.result.text ? disk.text : undefined, diskTypeChanged: false, saveFailed: false, error: undefined })
      } else if (documentIsDirty(current)) this.update(doc.id, { diskTypeChanged: true, error: '磁盘上的文件类型已改变。未保存的更改已保留。' })
      else this.update(doc.id, { status: 'ready', result: disk, text: disk.kind === 'text' ? disk.text : undefined, diskTypeChanged: false, saveFailed: false, error: undefined, conflict: undefined })
    } catch (error) { if (this.readVersions.get(doc.id) === version) this.update(doc.id, { error: workspaceErrorMessage(error) }) }
  }
  edit(path: string, text: string): void {
    const doc = this.find(path)
    if (!doc || doc.result?.kind !== 'text') return
    this.update(doc.id, { text, preview: false, error: undefined })
    this.scheduleSave(doc.id)
  }
  private scheduleSave(id: number): void {
    clearTimeout(this.timers.get(id))
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); const doc = this.snapshot.documents.find((d) => d.id === id); if (doc) void this.save(doc.path) }, 3000))
  }
  async save(path: string): Promise<boolean> {
    const doc = this.find(path)
    if (!doc || doc.status !== 'ready' || doc.result?.kind !== 'text' || doc.conflict !== undefined) return false
    clearTimeout(this.timers.get(doc.id)); this.timers.delete(doc.id)
    const pending = this.saves.get(doc.id)
    if (pending) return await pending ? this.save(path) : false
    if (!documentIsDirty(doc)) return true
    const text = doc.text ?? doc.result.text
    this.readVersions.set(doc.id, (this.readVersions.get(doc.id) || 0) + 1)
    this.update(doc.id, { saving: true, error: undefined })
    const promise = this.client.saveWorkspaceFile(this.root, path, text, doc.result.text).then((response) => {
      const current = this.find(path)
      if (!current || current.id !== doc.id) return false
      if (response.outcome === 'conflict') { this.update(doc.id, { conflict: response.file.text, saving: false }); return false }
      this.update(doc.id, { result: response.file, saving: false, diskTypeChanged: false, saveFailed: false, error: undefined })
      if (documentIsDirty(this.find(path)!)) this.scheduleSave(doc.id)
      return true
    }).catch((error) => { this.update(doc.id, { saving: false, saveFailed: true, error: workspaceErrorMessage(error) }); return false }).finally(async () => {
      this.saves.delete(doc.id)
      if (this.pendingReloads.delete(doc.id)) await this.reload(path)
    })
    this.saves.set(doc.id, promise)
    return await promise
  }
  async resolveConflict(path: string, action: 'disk' | 'local'): Promise<boolean> {
    const doc = this.find(path)
    if (!doc || doc.conflict === undefined || doc.result?.kind !== 'text') return false
    const disk = doc.conflict
    this.update(doc.id, { result: { ...doc.result, text: disk }, text: action === 'disk' ? disk : doc.text, conflict: undefined, saveFailed: false, error: undefined })
    return action === 'disk' || await this.save(path)
  }
  async close(path: string, discard = false): Promise<boolean> {
    const doc = this.find(path)
    if (!doc) return true
    if (!discard && this.restoredDrafts.has(doc.id) && doc.status !== 'ready') return false
    if (!discard && (documentIsDirty(doc) || doc.saving || this.saves.has(doc.id)) && !await this.save(path)) return false
    const current = this.find(path)
    if (!current || current.id !== doc.id) return false
    if (!discard && documentIsDirty(current)) return false
    clearTimeout(this.timers.get(doc.id)); this.timers.delete(doc.id)
    this.readVersions.delete(doc.id); this.pendingReloads.delete(doc.id); this.restoredDrafts.delete(doc.id)
    const index = this.snapshot.documents.indexOf(current)
    const documents = this.snapshot.documents.filter((entry) => entry.id !== doc.id)
    this.emit(documents, this.snapshot.activePath === path ? documents[index]?.path ?? documents[index - 1]?.path ?? null : this.snapshot.activePath)
    return true
  }
}

// Keep tab drafts when a chat or its workspace surface is temporarily unmounted.
const stores = new Map<string, WorkspaceDocuments>()
export function workspaceDocumentsForScope(scope: string, root: string, client: DocumentClient): WorkspaceDocuments {
  const key = `${scope}\0${root}`
  let store = stores.get(key)
  if (!store) {
    const storageKey = `codex-workspace-tabs-v1:${scope}:${root}`
    const storage = typeof localStorage === 'undefined' ? undefined : {
      read: () => JSON.parse(localStorage.getItem(storageKey) || 'null') as unknown,
      write: (value: unknown) => localStorage.setItem(storageKey, JSON.stringify(value))
    }
    store = new WorkspaceDocuments(root, client, storage); stores.set(key, store)
  }
  return store
}

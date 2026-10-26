import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { basicSetup } from 'codemirror'
import { Compartment, Prec, Transaction, type EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, search, SearchQuery, setSearchQuery } from '@codemirror/search'
import { ArrowDown, ArrowUp, ListOrdered, LoaderCircle, Redo2, Search, Undo2, X } from 'lucide-react'
import { documentIsDirty, type WorkspaceDocument, type WorkspaceDocuments } from './workspaceDocuments'
import { dispatchWorkspaceSelection, workspaceSelectionFromOffsets, workspaceSelectionLineLabel, type WorkspaceEditorSelection } from './workspaceEditorSelection'
import { captureWorkspaceEditor, restoreWorkspaceEditor, WorkspaceEditorModeController, workspaceEditorDocumentChange, workspaceGoToLine, type WorkspaceEditorMode, type WorkspaceEditorSnapshot } from './workspaceEditorModel'
import { workspaceMarkdownExtension } from './workspaceMarkdown'
import { workspaceMarkdownFrontmatter } from './workspaceMarkdownFrontmatter'

const snapshots = new WeakMap<WorkspaceDocuments, Map<number, WorkspaceEditorSnapshot>>()
const normalize = (text: string): string => text.replace(/\r\n?/g, '\n')
function preserveLineEndings(text: string, base: string): string {
  return text === normalize(base) ? base : base.includes('\r\n') ? text.replaceAll('\n', '\r\n') : base.includes('\r') ? text.replaceAll('\n', '\r') : text
}
interface FloatingSelection { detail: WorkspaceEditorSelection; left: number; top: number }

export function useWorkspaceEditorRuntime(document: WorkspaceDocument, store: WorkspaceDocuments, parent: RefObject<HTMLDivElement | null>, active: boolean, extensions: Extension, isMarkdown: boolean) {
  const editor = useRef<EditorView | null>(null)
  const current = useRef(document)
  const saved = snapshots.get(store)?.get(document.id)
  const [mode, setMode] = useState<WorkspaceEditorMode>(saved?.mode ?? (isMarkdown ? 'markdown' : 'source'))
  const modeRef = useRef(mode)
  const controller = useRef(new WorkspaceEditorModeController(mode))
  const applying = useRef(false)
  const [switching, setSwitching] = useState(false)
  const [history, setHistory] = useState({undo: false, redo: false, line: 1, column: 1})
  const [selection, setSelection] = useState<FloatingSelection | null>(null)
  const [instruction, setInstruction] = useState('')
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  const dragging = useRef(false)
  const [panel, setPanel] = useState<'find' | 'line' | null>(null)
  const panelRef = useRef(panel)
  const [query, setQuery] = useState('')
  const [match, setMatch] = useState({current: 0, total: 0})
  const [lineValue, setLineValue] = useState('')
  const [lineError, setLineError] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const lineSnapshot = useRef<{selection: EditorSelection; scroll: ReturnType<EditorView['scrollSnapshot']>} | null>(null)
  const lastReveal = useRef<number | null>(saved ? document.line : null)
  const modeChange = useRef<((mode: WorkspaceEditorMode) => void) | null>(null)
  current.current = document; modeRef.current = mode; panelRef.current = panel; editingRef.current = editing

  const saveUntilClean = useCallback(async (): Promise<boolean> => {
    for (;;) {
      const latest = store.find(document.path)
      if (!latest || latest.id !== document.id || latest.conflict !== undefined) return false
      if (!documentIsDirty(latest)) return true
      if (!await store.save(document.path)) return false
    }
  }, [document.id, document.path, store])
  controller.current.activeSave = saveUntilClean
  controller.current.hasUnsavedChanges = documentIsDirty(document)

  const updateSelection = useCallback(() => {
    const view = editor.current
    if (!view || dragging.current || editingRef.current) return
    const range = view.state.selection.main
    if (!view.hasFocus || range.empty || panelRef.current) { setSelection(null); return }
    const detail = workspaceSelectionFromOffsets(store.root, document.path, view.state.doc.toString(), range.from, range.to)
    const start = view.coordsAtPos(range.from), end = view.coordsAtPos(range.to)
    setSelection(detail && start && end ? {detail, left: start.top === end.top ? (start.left + end.right) / 2 : start.left, top: Math.min(start.top, end.top) - 8} : null)
  }, [document.path, store.root])
  const updateMatch = (view: EditorView) => {
    const query = getSearchQuery(view.state), selection = view.state.selection.main
    let current = 0, total = 0
    if (query.valid) {
      const cursor = query.getCursor(view.state)
      for (let next = cursor.next(); !next.done && total < 10000; next = cursor.next()) {
        total++; if (next.value.from === selection.from && next.value.to === selection.to) current = total
      }
    }
    setMatch({current, total})
  }
  const openFind = (): boolean => {
    const view = editor.current
    if (!view) return false
    if (lineSnapshot.current) view.dispatch({selection: lineSnapshot.current.selection, effects: lineSnapshot.current.scroll})
    lineSnapshot.current = null; panelRef.current = 'find'; setPanel('find'); setSelection(null)
    openSearchPanel(view); setQuery(getSearchQuery(view.state).search); updateMatch(view)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
    return true
  }
  const openLine = (): boolean => {
    const view = editor.current
    if (!view) return false
    if (panelRef.current === 'line') { input.current?.focus(); return true }
    closeSearchPanel(view)
    lineSnapshot.current = {selection: view.state.selection, scroll: view.scrollSnapshot()}
    panelRef.current = 'line'; setPanel('line'); setLineValue(''); setLineError(false); setSelection(null)
    requestAnimationFrame(() => input.current?.focus())
    return true
  }
  const closePanel = (cancel = true): void => {
    const view = editor.current, snapshot = lineSnapshot.current
    if (view) {
      closeSearchPanel(view)
      if (cancel && snapshot) view.dispatch({selection: snapshot.selection, effects: snapshot.scroll})
    }
    lineSnapshot.current = null; panelRef.current = null; setPanel(null); view?.focus()
  }
  const goLine = (line: number): void => {
    const view = editor.current
    if (view) { const target = view.state.doc.line(line); view.dispatch({selection: {anchor: target.from}, effects: EditorView.scrollIntoView(target.from, {y: 'center'})}) }
  }

  useEffect(() => {
    if (!parent.current) return
    const theme = new Compartment(), appearance = new Compartment()
    const dark = () => window.document.documentElement.getAttribute('data-theme') !== 'light'
    const cached = snapshots.get(store)?.get(document.id)
    const view = new EditorView({parent: parent.current, state: restoreWorkspaceEditor(cached, normalize(current.current.text ?? ''), [
      search({top: true, createPanel: () => { const dom = window.document.createElement('div'); dom.hidden = true; return {dom} }}),
      Prec.highest(keymap.of([
        {key: 'Mod-s', run: () => { void store.save(document.path); return true }},
        {key: 'Mod-f', run: openFind},
        {key: 'Mod-g', run: (view) => { if (panelRef.current !== 'find') return openFind(); findNext(view); return true }, shift: (view) => { findPrevious(view); return true }},
        {key: 'Mod-Alt-g', run: openLine}, {key: 'Ctrl-g', run: openLine}, indentWithTab
      ])), basicSetup, extensions,
      theme.of(EditorView.theme({}, {dark: dark()})),
      appearance.of(modeRef.current === 'markdown' ? workspaceMarkdownExtension(store.root, document.path) : []),
      EditorView.contentAttributes.of({'aria-label': `编辑 ${document.path}`, spellcheck: 'false'}),
      EditorView.domEventHandlers({mousedown: () => { dragging.current = true; setSelection(null); return false }}),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applying.current) store.edit(document.path, preserveLineEndings(update.state.doc.toString(), current.current.result?.kind === 'text' ? current.current.result.text : ''))
        if (update.docChanged && lineSnapshot.current) {
          lineSnapshot.current.selection = lineSnapshot.current.selection.map(update.changes)
          lineSnapshot.current.scroll = lineSnapshot.current.scroll.map(update.changes) ?? lineSnapshot.current.scroll
        }
        const head = update.state.selection.main.head, line = update.state.doc.lineAt(head)
        setHistory({undo: undoDepth(update.state) > 0, redo: redoDepth(update.state) > 0, line: line.number, column: head - line.from + 1})
        if (panelRef.current === 'find') updateMatch(update.view)
        if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged || update.viewportChanged) updateSelection()
      })
    ])})
    editor.current = view
    const changeMode = (next: WorkspaceEditorMode): void => view.dispatch({effects: [appearance.reconfigure(next === 'markdown' ? workspaceMarkdownExtension(store.root, document.path) : []), view.scrollSnapshot()]})
    modeChange.current = changeMode
    if (cached) { view.scrollDOM.scrollTop = cached.scrollTop; view.scrollDOM.scrollLeft = cached.scrollLeft }
    const head = view.state.selection.main.head, line = view.state.doc.lineAt(head)
    setHistory({undo: undoDepth(view.state) > 0, redo: redoDepth(view.state) > 0, line: line.number, column: head - line.from + 1})
    const observer = new MutationObserver(() => view.dispatch({effects: theme.reconfigure(EditorView.theme({}, {dark: dark()}))}))
    observer.observe(window.document.documentElement, {attributes: true, attributeFilter: ['data-theme']})
    const mouseUp = () => { dragging.current = false; updateSelection() }
    window.document.addEventListener('mouseup', mouseUp); view.scrollDOM.addEventListener('scroll', updateSelection)
    return () => {
      let cache = snapshots.get(store); if (!cache) { cache = new Map(); snapshots.set(store, cache) }
      cache.set(document.id, captureWorkspaceEditor(view.state, modeRef.current, view.scrollDOM.scrollTop, view.scrollDOM.scrollLeft))
      for (const id of cache.keys()) if (!store.getSnapshot().documents.some((doc) => doc.id === id)) cache.delete(id)
      observer.disconnect(); window.document.removeEventListener('mouseup', mouseUp); view.scrollDOM.removeEventListener('scroll', updateSelection)
      view.destroy(); editor.current = null; modeChange.current = null
    }
  }, [document.id, document.path, store, updateSelection])
  useEffect(() => {
    const view = editor.current, text = normalize(document.text ?? '')
    if (!view) return
    const changes = workspaceEditorDocumentChange(view.state.doc.toString(), text)
    if (!changes) return
    applying.current = true
    try { view.dispatch({changes, annotations: Transaction.addToHistory.of(false), effects: view.scrollSnapshot()}) } finally { applying.current = false }
  }, [document.text])
  useEffect(() => {
    const view = editor.current
    if (!active || !view) { setSelection(null); setEditing(false); editingRef.current = false; return }
    view.requestMeasure()
    if (document.line !== null && document.line !== lastReveal.current) {
      lastReveal.current = document.line
      goLine(Math.max(1, Math.min(document.line, view.state.doc.lines)))
    }
  }, [active, document.line, document.status])
  useEffect(() => {
    if (!editing) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-text-file-editor-selection-toolbar]')) return
      editingRef.current = false; setEditing(false); setInstruction(''); setSelection(null)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [editing])
  const switchMode = async () => {
    if (switching) return
    setSwitching(true)
    const next = mode === 'markdown' ? 'source' : 'markdown'
    try {
      if (await controller.current.switchTo(next) && editor.current) { setSelection(null); setEditing(false); editingRef.current = false; modeChange.current?.(next); modeRef.current = next; setMode(next); editor.current.requestMeasure() }
    } finally { setSwitching(false) }
  }
  const sendSelection = (edit: boolean) => {
    if (!selection || (edit && !instruction.trim())) return
    dispatchWorkspaceSelection({...selection.detail, ...(edit ? {instruction: instruction.trim()} : {})})
    setSelection(null); setEditing(false); editingRef.current = false; setInstruction('')
  }

  const metadata = mode === 'markdown' ? workspaceMarkdownFrontmatter(normalize(document.text ?? '')) : null
  return {mode, history,
    metadata: metadata?.entries.length ? <div className="workspace-markdown-frontmatter" aria-label="文件属性"><dl>{metadata.entries.map(({key, value}, index) => <div key={index} style={{display: 'contents'}}><dt>{key}</dt><dd>{Array.isArray(value) ? value.map((item, index) => <span key={index}>{item}</span>) : value}</dd></div>)}</dl></div> : null,
    toolbar: <>{isMarkdown && <button type="button" className="workspace-editor-mode-button" disabled={switching || document.saving} onClick={() => void switchMode()}>{switching && <LoaderCircle className="spin" />}{mode === 'markdown' ? '查看源代码' : '查看预览'}</button>}<button title="在文件中查找 (⌘F)" aria-label="在文件中查找" onClick={openFind}><Search /></button><button title="转到行" aria-label="转到行" onClick={openLine}><ListOrdered /></button></>,
    panels: panel && <form className={`workspace-editor-search-panel is-${panel}`} role={panel === 'find' ? 'search' : undefined} onSubmit={(event) => {
      event.preventDefault()
      if (panel === 'find') { if (editor.current) findNext(editor.current); return }
      const target = workspaceGoToLine(lineValue, editor.current?.state.doc.lines ?? 1)
      if (target === null) { setLineError(true); return }
      goLine(target); closePanel(false)
    }}>{panel === 'find' ? <Search /> : <label htmlFor={`editor-input-${document.id}`}>行</label>}<input key={panel} id={`editor-input-${document.id}`} ref={input} aria-label={panel === 'find' ? '在文件中查找' : '转到行'} aria-invalid={panel === 'line' && lineError} value={panel === 'find' ? query : lineValue} placeholder={panel === 'find' ? '在文件中查找…' : `1–${editor.current?.state.doc.lines ?? 1}`} onChange={(event) => {
      const value = event.target.value, view = editor.current
      if (panel === 'find') { setQuery(value); if (view) { view.dispatch({effects: setSearchQuery.of(new SearchQuery({search: value, literal: true}))}); if (value) findNext(view); updateMatch(view) } }
      else { setLineValue(value); setLineError(false); const target = workspaceGoToLine(value, view?.state.doc.lines ?? 1); if (target !== null) goLine(target) }
    }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closePanel() } else if (panel === 'find' && event.key === 'Enter' && event.shiftKey) { event.preventDefault(); if (editor.current) findPrevious(editor.current) } }} />
      {panel === 'find' ? <><span aria-live="polite">{query ? `${match.current} / ${match.total}${match.total === 10000 ? '+' : ''}` : ''}</span><button type="button" disabled={!match.total} aria-label="上一个匹配" onClick={() => { if (editor.current) findPrevious(editor.current) }}><ArrowUp /></button><button type="button" disabled={!match.total} aria-label="下一个匹配" onClick={() => { if (editor.current) findNext(editor.current) }}><ArrowDown /></button></> : lineError && <span role="alert">请输入有效的整数行号</span>}<button type="button" aria-label={panel === 'find' ? '关闭查找' : '关闭转到行'} onClick={() => closePanel()}><X /></button></form>,
    undoControls: (history.undo || history.redo) && <div className="workspace-editor-undo-controls"><button title="撤销 (⌘Z)" aria-label="撤销" disabled={!history.undo} onClick={() => { if (editor.current) { undo(editor.current); editor.current.focus() } }}><Undo2 /></button><button title="重做 (⇧⌘Z)" aria-label="重做" disabled={!history.redo} onClick={() => { if (editor.current) { redo(editor.current); editor.current.focus() } }}><Redo2 /></button></div>,
    positionButton: <button onClick={openLine}>行 {history.line}，列 {history.column}</button>,
    floating: active && selection && createPortal(<div className={`workspace-selection-toolbar${editing ? ' is-editing' : ''}`} style={{left: Math.max(editing ? 220 : 80, Math.min(selection.left, window.innerWidth - (editing ? 220 : 80))), top: Math.max(48, selection.top)}} data-text-file-editor-selection-toolbar>
      {editing ? <form onSubmit={(event) => { event.preventDefault(); sendSelection(true) }}><input aria-label="编辑说明" placeholder="描述编辑内容…" autoFocus value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditing(false); editingRef.current = false; editor.current?.focus() } }} /><button type="submit" disabled={!instruction.trim()} aria-label="提交编辑指令"><ArrowUp /></button></form> : <><button onMouseDown={(event) => event.preventDefault()} onClick={() => sendSelection(false)}>添加到对话</button><button onMouseDown={(event) => event.preventDefault()} onClick={() => { editingRef.current = true; setEditing(true) }}>编辑</button></>}
      <span className="workspace-selection-range" title={selection.detail.path}>{workspaceSelectionLineLabel(selection.detail.range)}</span>
    </div>, window.document.body)
  }
}

import { useRef, type ReactNode } from 'react'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Check, CircleAlert, LoaderCircle, RefreshCw, Save } from 'lucide-react'
import { languageForWorkspaceFile } from './workspaceFileModel'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { WorkspaceFileToolbar } from './WorkspaceFileToolbar'
import { documentIsDirty, type WorkspaceDocument, type WorkspaceDocuments } from './workspaceDocuments'
import { useWorkspaceEditorRuntime } from './workspaceEditorRuntime'
import './WorkspaceTextEditor.css'

function languageExtension(path: string) {
  const language = languageForWorkspaceFile(path)
  if (language === 'typescript' || language === 'javascript') return javascript({ typescript: language === 'typescript', jsx: /\.[jt]sx$/i.test(path) })
  if (language === 'json') return json()
  if (language === 'css' || language === 'scss') return css()
  if (language === 'html') return html()
  if (language === 'markdown') return markdown({ base: markdownLanguage })
  if (language === 'python') return python()
  return []
}
const sourceHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--editor-keyword, #c586c0)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--editor-string, #ce9178)' },
  { tag: tags.comment, color: 'var(--editor-comment, #6a9955)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--editor-number, #b5cea8)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--editor-function, #dcdcaa)' },
  { tag: [tags.typeName, tags.className], color: 'var(--editor-type, #4ec9b0)' }
])

export function WorkspaceTextEditor({ document, store, active, onSelectFile, toolbarActions, toolbarTarget }: {
  document: WorkspaceDocument
  store: WorkspaceDocuments
  active: boolean
  onSelectFile?(path: string): void
  toolbarTarget?: HTMLElement | null
  toolbarActions?: ReactNode | ((editorTools: ReactNode) => ReactNode)
}) {
  const parent = useRef<HTMLDivElement>(null)
  const editor = useWorkspaceEditorRuntime(document, store, parent, active,
    [languageExtension(document.path), syntaxHighlighting(sourceHighlight)], languageForWorkspaceFile(document.path) === 'markdown')
  const dirty = documentIsDirty(document)
  return <section className={`workspace-text-editor is-${editor.mode}`} hidden={!active} aria-label="文件编辑器" data-editor-mode={editor.mode}>
    {active && <WorkspaceFileToolbar target={toolbarTarget}>
      <WorkspaceBreadcrumbs root={store.root} path={document.path} onSelectFile={onSelectFile} />
      {typeof toolbarActions === 'function' ? toolbarActions(editor.toolbar) : <>
        <div className="workspace-editor-file-controls">
          {editor.toolbar}
          <button type="button" title="重新载入文件" aria-label="重新载入文件" disabled={document.saving} onClick={() => void store.reload(document.path)}><RefreshCw /></button>
          <button type="button" title="保存 (⌘S)" aria-label="保存文件" disabled={!dirty || document.saving || document.conflict !== undefined} onClick={() => void store.save(document.path)}>
            {document.saving ? <LoaderCircle className="spin" /> : <Save />}
          </button>
        </div>
        {toolbarActions}
      </>}
    </WorkspaceFileToolbar>}
    {editor.panels}
    {document.conflict !== undefined && <div className="workspace-editor-conflict" role="alert"><CircleAlert /><span>磁盘上的文件已更改。</span><button onClick={() => void store.resolveConflict(document.path, 'disk')}>使用磁盘内容</button><button onClick={() => void store.resolveConflict(document.path, 'local')}>保留我的更改</button></div>}
    {document.error && <div className="workspace-editor-conflict" role="alert"><CircleAlert /><span>{document.error}</span><button onClick={() => void store.save(document.path)}>重试保存</button></div>}
    {editor.metadata}
    <div className="workspace-codemirror" ref={parent} />
    {editor.undoControls}
    <footer className="workspace-editor-status"><span>{languageForWorkspaceFile(document.path)} · UTF-8 · {document.text?.includes('\r\n') ? 'CRLF' : 'LF'}</span>{editor.positionButton}<span>{document.saving ? '正在保存…' : dirty ? '未保存' : <><Check /> 已保存</>}</span></footer>
    {editor.floating}
  </section>
}

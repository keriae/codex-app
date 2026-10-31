import { GitCompareArrows } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkspaceFileResult } from '../../shared/api'
import { collapseDiffLines, parseUnifiedDiff, type ParsedDiffLine } from './unifiedDiff'
import { tokenizeWorkspaceCodeLine, workspaceRelativePath } from './workspaceFileModel'
import type { WorkspaceChangeEntry } from './workspacePaneModel'
import { nextWorkspaceDiffStyle, parseWorkspaceDiffPreferences, resolveWorkspaceDiffStyle, splitWorkspaceDiffLines, workspaceDiffSeparatorLabels, workspaceDiffStyleLabel, WORKSPACE_DIFF_PREFERENCES_KEY, type WorkspaceDiffStyle } from './workspaceDiffModel'
import './WorkspaceDiffViewer.css'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { WorkspaceFileToolbar } from './WorkspaceFileToolbar'
import { useWorkspaceDiffControls, WorkspaceDiffOptions } from './WorkspaceDiffControls'
import { workspaceDiffPreviewMode, workspaceDiffSnapshotFromDisk, workspaceFullDiffLines,
  workspaceImportHiddenLines, type WorkspaceDiffSnapshot } from './workspaceDiffPresentation'
import { workspaceWordDiffSpans, type WorkspaceWordDiffSpan } from './workspaceWordDiff'
import { WorkspaceDiffJumpToFile } from './WorkspaceDiffJumpToFile'
import { beginEditingDiffComment, diffCommentLineAt, diffCommentMatchesFile, diffCommentText, formatDiffCommentLines,
  isDiffCommentLineSelected, saveDiffCommentDraft, selectDiffCommentLine,
  type DiffCommentAttachment, type DiffCommentDraft, type DiffCommentLine, type DiffCommentSide } from './diffComments'

// Inert 16px artwork from the installed review-header-toolbar assets.
// The selected mode remains visible even when Auto resolves to unified layout.
const DIFF_STYLE_GLYPHS: Record<WorkspaceDiffStyle, string> = {
  "unified": "<path d=\"M13.4746 4.53271C13.4744 3.79209 12.8744 3.19214 12.1338 3.19189H3.86621C3.12559 3.19214 2.52564 3.79209 2.52539 4.53271V11.4663C2.52539 12.2071 3.12544 12.8079 3.86621 12.8081H12.1338C12.8746 12.8079 13.4746 12.2071 13.4746 11.4663V4.53271ZM14.5254 11.4663C14.5254 12.787 13.4545 13.8577 12.1338 13.8579H3.86621C2.54554 13.8577 1.47461 12.787 1.47461 11.4663V4.53271C1.47486 3.2122 2.54569 2.14136 3.86621 2.14111H12.1338C13.4543 2.14136 14.5251 3.2122 14.5254 4.53271V11.4663Z\" fill=\"currentColor\"/> <path d=\"M11.7613 4.53857C12.0927 4.53857 12.3613 4.8072 12.3613 5.13857L12.3613 6.95692C12.3613 7.28829 12.0927 7.55692 11.7613 7.55692L4.23965 7.55692C3.90828 7.55692 3.63965 7.28829 3.63965 6.95692L3.63965 5.13857C3.63965 4.8072 3.90828 4.53857 4.23965 4.53857L11.7613 4.53857Z\" fill=\"#F84E63\" fill-opacity=\"0.5\"/> <path d=\"M11.7613 8.43506C12.0927 8.43506 12.3613 8.70369 12.3613 9.03506L12.3613 10.8608C12.3613 11.1921 12.0927 11.4608 11.7613 11.4608L4.23965 11.4608C3.90828 11.4608 3.63965 11.1921 3.63965 10.8608L3.63965 9.03506C3.63965 8.70369 3.90828 8.43506 4.23965 8.43506L11.7613 8.43506Z\" fill=\"#36D958\" fill-opacity=\"0.5\"/>",
  "split": "<path d=\"M13.4746 4.53271C13.4744 3.79209 12.8744 3.19214 12.1338 3.19189H3.86621C3.12559 3.19214 2.52564 3.79209 2.52539 4.53271V11.4663C2.52539 12.2071 3.12544 12.8079 3.86621 12.8081H12.1338C12.8746 12.8079 13.4746 12.2071 13.4746 11.4663V4.53271ZM14.5254 11.4663C14.5254 12.787 13.4545 13.8577 12.1338 13.8579H3.86621C2.54554 13.8577 1.47461 12.787 1.47461 11.4663V4.53271C1.47486 3.2122 2.54569 2.14136 3.86621 2.14111H12.1338C13.4543 2.14136 14.5251 3.2122 14.5254 4.53271V11.4663Z\" fill=\"currentColor\"/> <path d=\"M3.63916 5.13857C3.63916 4.8072 3.90779 4.53857 4.23916 4.53857H6.84237C7.17374 4.53857 7.44237 4.8072 7.44237 5.13857V10.8604C7.44237 11.1917 7.17374 11.4604 6.84237 11.4604H4.23916C3.90779 11.4604 3.63916 11.1917 3.63916 10.8604V5.13857Z\" fill=\"#F84E63\" fill-opacity=\"0.5\"/> <path d=\"M8.54834 5.13857C8.54834 4.8072 8.81697 4.53857 9.14834 4.53857H11.7608C12.0922 4.53857 12.3608 4.8072 12.3608 5.13857V10.8604C12.3608 11.1917 12.0922 11.4604 11.7608 11.4604H9.14834C8.81697 11.4604 8.54834 11.1917 8.54834 10.8604V5.13857Z\" fill=\"#36D958\" fill-opacity=\"0.5\"/>",
  "auto": "<path d=\"M13.4746 4.53296C13.4744 3.79234 12.8744 3.19238 12.1338 3.19214H3.86621C3.12559 3.19238 2.52564 3.79234 2.52539 4.53296V11.4666C2.52539 12.2074 3.12544 12.8081 3.86621 12.8083H12.1338C12.8746 12.8081 13.4746 12.2074 13.4746 11.4666V4.53296ZM14.5254 11.4666C14.5254 12.7873 13.4545 13.8579 12.1338 13.8582H3.86621C2.54554 13.8579 1.47461 12.7873 1.47461 11.4666V4.53296C1.47486 3.21244 2.54569 2.1416 3.86621 2.14136H12.1338C13.4543 2.1416 14.5251 3.21244 14.5254 4.53296V11.4666Z\" fill=\"currentColor\"/> <path d=\"M4.24 4.54H11.66L3.64 10.76V5.14C3.64 4.80863 3.90863 4.54 4.24 4.54Z\" fill=\"#F84E63\" fill-opacity=\"0.5\"/> <path d=\"M12.36 5.24V10.86C12.36 11.1914 12.0914 11.46 11.76 11.46H4.34L12.36 5.24Z\" fill=\"#36D958\" fill-opacity=\"0.5\"/>"
}

function WorkspaceDiffStyleIcon({ style }: { style: WorkspaceDiffStyle }): ReactNode {
  return <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="none" aria-hidden="true" focusable="false"
    data-workspace-diff-glyph={style} dangerouslySetInnerHTML={{ __html: DIFF_STYLE_GLYPHS[style] }} />
}

const NO_COMMENTS: readonly DiffCommentAttachment[] = []

export interface WorkspaceDiffCommentProps {
  comments?: readonly DiffCommentAttachment[]
  onCommentsChange?: (comments: DiffCommentAttachment[]) => void
  /** Same independent conversation/draft identity used by the parent store. */
  commentScopeKey?: string
}

function Source({ line, spans = [] }: { line: ParsedDiffLine | null; spans?: WorkspaceWordDiffSpan[] }): ReactNode {
  let offset = 0
  return <code>{line && tokenizeWorkspaceCodeLine(line.content).map((token, i) => {
    const start = offset, end = start + token.text.length
    offset = end
    const boundaries = [...new Set([start, end, ...spans.flatMap((span) => [span.start, span.start + span.length])
      .filter((position) => position > start && position < end)])].sort((left, right) => left - right)
    return <span className={`workspace-token is-${token.kind}`} key={i}>{boundaries.slice(0, -1).map((position, part) => {
      const next = boundaries[part + 1]
      const changed = spans.some((span) => position >= span.start && next <= span.start + span.length)
      return changed ? <span data-diff-span="" className="workspace-diff-word" key={part}>{token.text.slice(position - start, next - start)}</span>
        : <Fragment key={part}>{token.text.slice(position - start, next - start)}</Fragment>
    })}</span>
  })}</code>
}

export function WorkspaceDiffViewer({ change, cwd, onSelectFile, onRefresh, showRefreshGitQueries = true, refreshGitQueriesDisabled = false, refreshing = false, comments = NO_COMMENTS, onCommentsChange, commentScopeKey, toolbarActions, toolbarTarget, jumpChanges, onJumpToChange,
  showCopyGitApplyCommand = true, copyGitApplyCommandDisabled = true, onClickCopyGitApplyCommand }: {
  change: WorkspaceChangeEntry
  cwd: string | null | undefined
  onOpenFile(): void
  jumpChanges?: readonly WorkspaceChangeEntry[]
  onJumpToChange?(change: WorkspaceChangeEntry): void
  onSelectFile?(path: string): void
  toolbarTarget?: HTMLElement | null
  onRefresh?(): void
  showRefreshGitQueries?: boolean
  refreshGitQueriesDisabled?: boolean
  refreshing?: boolean
  showCopyGitApplyCommand?: boolean
  copyGitApplyCommandDisabled?: boolean
  onClickCopyGitApplyCommand?(): void
  toolbarActions?: ReactNode | ((leadingControls: ReactNode, fileControls: ReactNode) => ReactNode)
} & WorkspaceDiffCommentProps): ReactNode {
  const diff = useMemo(() => parseUnifiedDiff(change.diff), [change.diff])
  const [preferences, setPreferences] = useState(() => parseWorkspaceDiffPreferences(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(WORKSPACE_DIFF_PREFERENCES_KEY)))
  const [showAll, setShowAll] = useState(false)
  const [fileRevision, setFileRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; result: WorkspaceFileResult; snapshot: WorkspaceDiffSnapshot | null } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFullFile, setLoadingFullFile] = useState(false)
  const [whitespacePatch, setWhitespacePatch] = useState<{ key: string; patch: string } | null>(null)
  const [whitespaceError, setWhitespaceError] = useState<string | null>(null)
  const [collapsedAll, setCollapsedAll] = useState(false)
  const [commentDraft, setCommentDraft] = useState<DiffCommentDraft | null>(null)
  const layoutRef = useRef<HTMLElement>(null)
  const [fileWidth, setFileWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = layoutRef.current
    if (!element || preferences.style !== 'auto') return
    // clientWidth is in logical CSS pixels, including when the window is zoomed.
    const resize = (): void => setFileWidth(element.clientWidth)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [preferences.style])
  const loadKey = `${cwd ?? ''}\0${change.id}\0${change.diff}\0${fileRevision}`
  const previewMode = workspaceDiffPreviewMode(change.path, change.kind === 'deleted', preferences.richPreview)
  const needsFullFile = ((preferences.loadFullFiles && !collapsedAll) || preferences.hideWhitespace || preferences.hideImports) &&
    change.kind !== 'added' && change.kind !== 'deleted' &&
    !diff.isBinary && diff.additions + diff.deletions > 0
  const needsPreviewFile = previewMode === 'markdown' || previewMode === 'image'
  const currentLoaded = loaded?.key === loadKey ? loaded : null
  const snapshot = currentLoaded?.snapshot ?? null
  useEffect(() => {
    if (currentLoaded) {
      setLoadingFullFile(false)
      if (needsFullFile && !currentLoaded.snapshot) setFileError('完整文件与当前差异不匹配，保留部分差异')
      return
    }
    if ((!needsFullFile && !needsPreviewFile) || !cwd) { setLoadingFullFile(false); return }
    let active = true
    setLoadingFullFile(true); setFileError(null)
    void window.codex.readWorkspaceFile(cwd, change.path).then((result) => {
      if (!active) return
      const reconstructed = result.kind === 'text' ? workspaceDiffSnapshotFromDisk(diff, result.text) : null
      setLoaded({ key: loadKey, result, snapshot: reconstructed })
      if (needsFullFile && !reconstructed) setFileError('完整文件与当前差异不匹配，保留部分差异')
    }).catch(() => {
      if (active) setFileError(needsPreviewFile ? '无法加载文件预览，保留文本差异' : '无法加载完整文件，保留部分差异')
    }).finally(() => { if (active) setLoadingFullFile(false) })
    return () => { active = false }
  }, [loadKey, cwd, change.path, diff, needsFullFile, needsPreviewFile, currentLoaded])
  const whitespaceKey = snapshot ? loadKey : null
  useEffect(() => {
    setWhitespaceError(null)
    if (!preferences.hideWhitespace || !snapshot || !whitespaceKey || whitespacePatch?.key === whitespaceKey) return
    let active = true
    void window.codex.diffWorkspaceText(snapshot.before, snapshot.after, { ignoreWhitespace: true }).then((patch) => {
      if (active) setWhitespacePatch({ key: whitespaceKey, patch })
    }).catch(() => { if (active) setWhitespaceError('无法重新计算空白差异，保留当前差异') })
    return () => { active = false }
  }, [preferences.hideWhitespace, snapshot, whitespaceKey, whitespacePatch?.key])
  const reviewDiff = useMemo(() => preferences.hideWhitespace && whitespaceKey && whitespacePatch?.key === whitespaceKey
    ? parseUnifiedDiff(whitespacePatch.patch) : diff, [preferences.hideWhitespace, whitespaceKey, whitespacePatch, diff])
  const sourceLines = useMemo(() => preferences.loadFullFiles && snapshot
    ? workspaceFullDiffLines(reviewDiff, snapshot, preferences.hideWhitespace) : reviewDiff.lines,
  [preferences.loadFullFiles, snapshot, reviewDiff, preferences.hideWhitespace])
  const path = cwd ? workspaceRelativePath(cwd, change.path) : change.path
  const fileComments = comments.filter((comment) => diffCommentMatchesFile(comment, path, cwd))
  const annotations = [...fileComments.map((comment) => ({ side: comment.position.side, line: comment.position.line })),
    ...(commentDraft ? [commentDraft.range.start, commentDraft.range.end] : [])]
  const hiddenImports = preferences.hideImports
    ? workspaceImportHiddenLines(reviewDiff, snapshot, change.path, change.kind, annotations) : new Set<ParsedDiffLine>()
  const displayedLines = sourceLines.filter((line) => !hiddenImports.has(line))
  const wordSpans = useMemo(() => workspaceWordDiffSpans(reviewDiff.lines, preferences.wordDiffs), [reviewDiff, preferences.wordDiffs])
  const resolvedStyle = resolveWorkspaceDiffStyle(preferences.style, reviewDiff, fileWidth)
  const styleLabel = workspaceDiffStyleLabel(preferences.style)
  const visible = collapseDiffLines(displayedLines, 1_000, 100)
  const portions = showAll || !visible.omittedCount ? [displayedLines] : [visible.head, visible.tail]
  const separatorLabels = useMemo(() => workspaceDiffSeparatorLabels(reviewDiff.lines), [reviewDiff.lines])
  const lineIndices = useMemo(() => new Map(sourceLines.map((line, index) => [line, index])), [sourceLines])
  useEffect(() => { setCommentDraft(null) }, [commentScopeKey, change.id])
  useEffect(() => { setCommentDraft((draft) => {
    if (!draft) return draft
    const anchor = diffCommentLineAt(sourceLines, draft.anchor.side, draft.anchor.line)
    const start = diffCommentLineAt(sourceLines, draft.range.start.side, draft.range.start.line)
    const end = diffCommentLineAt(sourceLines, draft.range.end.side, draft.range.end.line)
    return anchor && start && end ? { ...draft, anchor, range: { start, end } } : draft
  }) }, [sourceLines])
  const selectLine = (line: DiffCommentLine, extend: boolean): void => {
    if (!onCommentsChange) return
    setCommentDraft((previous) => selectDiffCommentLine(previous, line, extend, sourceLines))
  }
  const saveComment = (): void => {
    if (!onCommentsChange || !commentDraft) return
    const next = saveDiffCommentDraft({ draft: commentDraft, comments, path, workspaceRoot: cwd, lines: sourceLines })
    if (!next) return
    onCommentsChange(next)
    setCommentDraft(null)
  }
  const deleteComment = (id: string): void => {
    if (!onCommentsChange) return
    onCommentsChange(comments.filter((comment) => comment.id !== id))
    setCommentDraft((previous) => previous?.editingId === id ? null : previous)
  }
  const lineNumber = (line: ParsedDiffLine | null, side: DiffCommentSide): ReactNode => {
    const number = line && (side === 'left' ? line.oldLineNumber : line.newLineNumber)
    if (number == null || !line) return <span className="workspace-diff-number" />
    const location = { side, line: number, index: lineIndices.get(line)! }
    const sideLabel = side === 'left' ? '左侧' : '右侧'
    return onCommentsChange ? <button type="button" className={`workspace-diff-number workspace-diff-comment-gutter${isDiffCommentLineSelected(location, commentDraft?.range ?? null) ? ' is-selected' : ''}`}
      data-comment-side={side} data-comment-line={number} aria-label={`在${sideLabel}第 ${number} 行添加评论`}
      title="添加评论；按住 Shift 可选择多行" onClick={(event) => selectLine(location, event.shiftKey)}>
      <span>{number}</span><span className="workspace-diff-comment-plus" aria-hidden="true">+</span>
    </button> : <span className="workspace-diff-number">{number}</span>
  }
  const renderCommentEditor = (): ReactNode => commentDraft && <form className="workspace-diff-comment workspace-diff-comment-editor"
    aria-label={commentDraft.editingId ? '编辑评论' : '添加评论'} onSubmit={(event) => { event.preventDefault(); saveComment() }}>
    <textarea key={commentDraft.editingId ?? 'new-comment'} autoFocus rows={3} placeholder="添加评论…" aria-label="评论"
      value={commentDraft.text} onChange={(event) => setCommentDraft((previous) => previous ? { ...previous, text: event.target.value } : previous)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCommentDraft(null) }
        else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); saveComment() }
      }} />
    <div className="workspace-diff-comment-actions">
      {commentDraft.editingId && <button type="button" className="is-danger" onClick={() => deleteComment(commentDraft.editingId!)}>删除</button>}
      <span />
      <button type="button" onClick={() => setCommentDraft(null)}>取消</button>
      <button type="submit" className="is-primary" disabled={!commentDraft.text.trim()}>{commentDraft.editingId ? '保存' : '评论'}</button>
    </div>
  </form>
  const renderComments = (side: DiffCommentSide, number: number | null): ReactNode => {
    if (number == null) return null
    const attached = fileComments.filter((comment) => comment.position.side === side && comment.position.line === number)
    const isDraftHere = commentDraft?.range.end.side === side && commentDraft.range.end.line === number
    if (!attached.length && !isDraftHere) return null
    return <div className={`workspace-diff-comment-group is-${side}`}>
      {attached.map((comment) => {
        if (commentDraft?.editingId === comment.id) return null
        const lines = formatDiffCommentLines(comment)
        const mixedSides = (comment.position.start_side ?? side) !== side
        const location = mixedSides ? lines : `${side === 'left' ? 'L' : 'R'}${lines}`
        return <article className="workspace-diff-comment" key={comment.id}
          aria-label={`第 ${mixedSides ? lines : `${side === 'left' ? '左侧' : '右侧'} ${lines}`} 行的评论`}>
          <div className="workspace-diff-comment-heading"><strong>你</strong><span>{location}</span>
            {onCommentsChange && <button type="button" aria-label="编辑评论" onClick={() => setCommentDraft(beginEditingDiffComment(comment, sourceLines))}>编辑</button>}
          </div><p>{diffCommentText(comment)}</p>
        </article>
      })}
      {isDraftHere && renderCommentEditor()}
    </div>
  }
  const renderAnnotations = (left: number | null, right: number | null): ReactNode => {
    const before = renderComments('left', left)
    const after = renderComments('right', right)
    return before || after ? <div className="workspace-diff-annotations">{before}{after}</div> : null
  }
  const displayedLineKeys = new Set(portions.flatMap((lines) => lines.flatMap((line) => [
    ...(line.oldLineNumber != null ? [`left:${line.oldLineNumber}`] : []),
    ...(line.newLineNumber != null ? [`right:${line.newLineNumber}`] : [])
  ])))
  const unplacedComments = fileComments.filter((comment) => !displayedLineKeys.has(`${comment.position.side}:${comment.position.line}`))
  const unplacedLocations = [...new Map(unplacedComments.map((comment) => [`${comment.position.side}:${comment.position.line}`, comment])).values()]
  const unplacedDraft = commentDraft && !displayedLineKeys.has(`${commentDraft.range.end.side}:${commentDraft.range.end.line}`)
  const updatePreferences = (next: typeof preferences): void => {
    setPreferences(next)
    try { localStorage.setItem(WORKSPACE_DIFF_PREFERENCES_KEY, JSON.stringify(next)) } catch { /* Session state remains usable. */ }
  }
  const retryFile = (): void => {
    setFileRevision((revision) => revision + 1)
    setLoaded(null); setWhitespacePatch(null); setFileError(null); setWhitespaceError(null)
  }
  const refreshDiff = (): void => { retryFile(); onRefresh?.() }
  const controls = useWorkspaceDiffControls({
    wrap: preferences.wrap,
    onToggleWrap: () => updatePreferences({ ...preferences, wrap: !preferences.wrap }),
    expanded: !collapsedAll,
    onToggleExpanded: () => setCollapsedAll((collapsed) => !collapsed),
    styleLabel,
    styleIcon: <WorkspaceDiffStyleIcon style={preferences.style} />,
    onCycleStyle: () => updatePreferences({ ...preferences, style: nextWorkspaceDiffStyle(preferences.style) }),
    onRefresh: onRefresh ? refreshDiff : undefined, showRefreshGitQueries, refreshGitQueriesDisabled, refreshing, toolbarTarget,
    trailingMenu: (close) => <WorkspaceDiffOptions preferences={preferences} onChange={updatePreferences} onClose={close}
      showCopyGitApplyCommand={showCopyGitApplyCommand} copyGitApplyCommandDisabled={copyGitApplyCommandDisabled}
      onClickCopyGitApplyCommand={onClickCopyGitApplyCommand} />
  })
  const diffLeadingControls = <div className="workspace-diff-controls workspace-diff-leading-controls">
    {controls.leadingControls}
    {onJumpToChange && <WorkspaceDiffJumpToFile changes={jumpChanges ?? [change]} cwd={cwd} onSelectChange={onJumpToChange} />}
  </div>
  const diffFileControls = controls.fileControls
  return <section ref={layoutRef} className={`workspace-diff-viewer${preferences.wrap ? ' is-wrapped' : ''}${collapsedAll ? ' is-collapsed' : ''}`} aria-label={`${path} 中的更改`}>
    <WorkspaceFileToolbar target={toolbarTarget} className="workspace-diff-toolbar">
      <WorkspaceBreadcrumbs root={cwd} path={change.path} onSelectFile={onSelectFile} />
      {typeof toolbarActions === 'function'
        ? toolbarActions(diffLeadingControls, diffFileControls)
        : <>{diffLeadingControls}{diffFileControls}{toolbarActions}</>}
    </WorkspaceFileToolbar>
    {loadingFullFile && <div role="status" className="workspace-diff-file-status">正在加载完整文件…</div>}
    {(needsFullFile || needsPreviewFile) && fileError && <div role="status" className="workspace-diff-copy-error">{fileError}
      <button type="button" onClick={retryFile}>重试</button></div>}
    {whitespaceError && <div role="status" className="workspace-diff-copy-error">{whitespaceError}</div>}
    {previewMode === 'markdown' && currentLoaded?.result.kind === 'text' && <div className="workspace-diff-rich-preview is-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentLoaded.result.text}</ReactMarkdown>
    </div>}
    {previewMode === 'image' && currentLoaded && (currentLoaded.result.kind === 'image'
      ? <div className="workspace-diff-rich-preview is-image"><img alt={path}
          src={`data:${currentLoaded.result.mimeType};base64,${currentLoaded.result.dataBase64}`} /></div>
      : currentLoaded.result.mimeType === 'image/svg+xml' && <div className="workspace-diff-rich-preview is-image">
          <img alt={path} src={`data:image/svg+xml,${encodeURIComponent(currentLoaded.result.text)}`} /></div>)}
    <div className="workspace-diff-scroll" hidden={(previewMode === 'markdown' && currentLoaded?.result.kind === 'text') ||
      (previewMode === 'image' && (currentLoaded?.result.kind === 'image' || currentLoaded?.result.mimeType === 'image/svg+xml'))} tabIndex={0} data-diff-style={resolvedStyle} data-diff-mode={preferences.style}>
      {displayedLines.length === 0 && <div className="workspace-code-empty"><GitCompareArrows /><strong>没有可显示的文本差异</strong></div>}
      {portions.map((lines, portion) => <div key={portion}>
        {portion === 1 && <div className="workspace-diff-separator"><button type="button" onClick={() => setShowAll(true)}>显示隐藏的 {visible.omittedCount.toLocaleString()} 行</button></div>}
        {resolvedStyle === 'unified' ? lines.map((line, i) =>
          line.kind === 'hunk' || line.kind === 'metadata'
            ? <div className="workspace-diff-separator" title={line.kind === 'hunk' ? line.raw : undefined} key={i}>{separatorLabels.get(line) || line.content}</div>
            : <Fragment key={i}><div className={`workspace-diff-line is-${line.kind}`} data-kind={line.kind}>
                {lineNumber(line, 'left')}{lineNumber(line, 'right')}
                <span className="workspace-diff-marker" aria-hidden="true">{line.marker}</span><Source line={line} spans={wordSpans.get(line)} />
              </div>{renderAnnotations(line.oldLineNumber, line.newLineNumber)}</Fragment>)
          : splitWorkspaceDiffLines(lines).map((row, i) => row.kind === 'separator'
            ? <div className="workspace-diff-separator" title={row.before?.kind === 'hunk' ? row.before.raw : undefined} key={i}>{row.before ? separatorLabels.get(row.before) || row.before.content : null}</div>
            : <Fragment key={i}><div className="workspace-diff-split-row">
                <div className={`workspace-diff-split-cell${row.before ? ` is-${row.before.kind}` : ' is-empty'}`}>
                  {lineNumber(row.before, 'left')}<Source line={row.before} spans={row.before ? wordSpans.get(row.before) : undefined} />
                </div>
                <div className={`workspace-diff-split-cell${row.after ? ` is-${row.after.kind}` : ' is-empty'}`}>
                  {lineNumber(row.after, 'right')}<Source line={row.after} spans={row.after ? wordSpans.get(row.after) : undefined} />
                </div>
              </div>{renderAnnotations(row.before?.oldLineNumber ?? null, row.after?.newLineNumber ?? null)}</Fragment>)}
      </div>)}
      {(unplacedComments.length > 0 || unplacedDraft) && <div className="workspace-diff-unplaced-comments">
        <div className="workspace-diff-separator">隐藏或已更改行上的评论</div>
        {unplacedLocations.map((comment) => <Fragment key={`${comment.position.side}:${comment.position.line}`}>{renderComments(comment.position.side, comment.position.line)}</Fragment>)}
        {unplacedDraft && !unplacedComments.some((comment) => comment.position.side === commentDraft.range.end.side && comment.position.line === commentDraft.range.end.line) && renderCommentEditor()}
      </div>}
      {diff.isBinary && <div className="workspace-diff-separator">二进制文件已更改</div>}
    </div>
  </section>
}

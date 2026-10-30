import { copyTextToClipboard } from './clipboard'
import { Check, ChevronDown, Clipboard, Columns2, FileCode2, GitCompareArrows, MoreHorizontal, RefreshCw, Search, WrapText } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { collapseDiffLines, parseUnifiedDiff, type ParsedDiffLine } from './unifiedDiff'
import { tokenizeWorkspaceCodeLine, workspaceBreadcrumbs, workspaceRelativePath } from './workspaceFileModel'
import type { WorkspaceChangeEntry } from './workspacePaneModel'
import { parseWorkspaceDiffPreferences, splitWorkspaceDiffLines, workspaceDiffSeparatorLabels, WORKSPACE_DIFF_PREFERENCES_KEY } from './workspaceDiffModel'
import './WorkspaceDiffViewer.css'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { WorkspaceFileToolbar } from './WorkspaceFileToolbar'
import { beginEditingDiffComment, diffCommentMatchesFile, diffCommentText, formatDiffCommentLines,
  isDiffCommentLineSelected, saveDiffCommentDraft, selectDiffCommentLine,
  type DiffCommentAttachment, type DiffCommentDraft, type DiffCommentLine, type DiffCommentSide } from './diffComments'

const NO_COMMENTS: readonly DiffCommentAttachment[] = []

export interface WorkspaceDiffCommentProps {
  comments?: readonly DiffCommentAttachment[]
  onCommentsChange?: (comments: DiffCommentAttachment[]) => void
  /** Same independent conversation/draft identity used by the parent store. */
  commentScopeKey?: string
}

function Source({ line }: { line: ParsedDiffLine | null }): ReactNode {
  return <code>{line && tokenizeWorkspaceCodeLine(line.content).map((token, i) =>
    <span className={`workspace-token is-${token.kind}`} key={i}>{token.text}</span>)}</code>
}

export function WorkspaceDiffViewer({ change, cwd, onOpenFile, onSelectFile, onRefresh, comments = NO_COMMENTS, onCommentsChange, commentScopeKey, toolbarActions, toolbarTarget }: {
  change: WorkspaceChangeEntry
  cwd: string | null | undefined
  onOpenFile(): void
  onSelectFile?(path: string): void
  toolbarTarget?: HTMLElement | null
  onRefresh?(): void
  toolbarActions?: ReactNode | ((leadingControls: ReactNode, fileControls: ReactNode) => ReactNode)
} & WorkspaceDiffCommentProps): ReactNode {
  const diff = useMemo(() => parseUnifiedDiff(change.diff), [change.diff])
  const [preferences, setPreferences] = useState(() => parseWorkspaceDiffPreferences(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(WORKSPACE_DIFF_PREFERENCES_KEY)))
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedAll, setCollapsedAll] = useState(false)
  const [commentDraft, setCommentDraft] = useState<DiffCommentDraft | null>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const visible = collapseDiffLines(diff.lines, 1_000, 100)
  const portions = showAll || !visible.omittedCount ? [diff.lines] : [visible.head, visible.tail]
  const separatorLabels = useMemo(() => workspaceDiffSeparatorLabels(diff.lines), [diff.lines])
  const path = cwd ? workspaceRelativePath(cwd, change.path) : change.path
  const breadcrumbs = cwd
    ? workspaceBreadcrumbs(cwd, change.path)
    : path.replaceAll('\\', '/').split('/').filter(Boolean)
  const fileComments = comments.filter((comment) => diffCommentMatchesFile(comment, path, cwd))
  const lineIndices = useMemo(() => new Map(diff.lines.map((line, index) => [line, index])), [diff.lines])
  useEffect(() => { setCommentDraft(null) }, [commentScopeKey, change.id])
  useEffect(() => {
    if (!copyMenuOpen) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && optionsRef.current?.contains(event.target)) return
      setCopyMenuOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setCopyMenuOpen(false)
      optionsRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [copyMenuOpen])
  const selectLine = (line: DiffCommentLine, extend: boolean): void => {
    if (!onCommentsChange) return
    setCommentDraft((previous) => selectDiffCommentLine(previous, line, extend, diff.lines))
  }
  const saveComment = (): void => {
    if (!onCommentsChange || !commentDraft) return
    const next = saveDiffCommentDraft({ draft: commentDraft, comments, path, workspaceRoot: cwd, lines: diff.lines })
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
            {onCommentsChange && <button type="button" aria-label="编辑评论" onClick={() => setCommentDraft(beginEditingDiffComment(comment, diff.lines))}>编辑</button>}
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
  const copyPath = async (value: string): Promise<void> => {
    try {
      await copyTextToClipboard(value)
      setCopied(true); setCopyError(null)
    } catch { setCopyError('无法复制路径') }
  }
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const searchMatches = normalizedSearchQuery
    ? diff.lines.filter((line) => line.content.toLocaleLowerCase().includes(normalizedSearchQuery))
    : []
  const searchMatchCount = searchMatches.length
  const searchFileType = path.includes('.') ? `*.${path.split('.').at(-1)}` : '*'
  const lineMatchesSearch = (line: ParsedDiffLine | null): boolean => Boolean(
    line && normalizedSearchQuery && line.content.toLocaleLowerCase().includes(normalizedSearchQuery)
  )
  const diffLeadingControls = <div className="workspace-diff-controls workspace-diff-leading-controls">
    <div ref={optionsRef} className="workspace-diff-options-control">
      <button type="button" title="“变更”选项" aria-label="“变更”选项" aria-haspopup="menu"
        aria-expanded={copyMenuOpen} onClick={() => setCopyMenuOpen((open) => !open)}><MoreHorizontal /></button>
      <div className="workspace-diff-options-menu" role="menu" hidden={!copyMenuOpen}>
        <button type="button" role="menuitem" onClick={() => { setCopyMenuOpen(false); setSearchOpen(true) }}><Search /><span>在文件中搜索</span></button>
        <button type="button" role="menuitem" onClick={() => { setCopyMenuOpen(false); void copyPath(change.path) }}><Clipboard /><span>复制绝对路径</span></button>
        <button type="button" role="menuitem" onClick={() => { setCopyMenuOpen(false); void copyPath(path) }}>{copied ? <Check /> : <Clipboard />}<span>复制仓库相对路径</span></button>
      </div>
    </div>
    <button type="button" title="跳转到文件" aria-label="跳转到文件" disabled={change.kind === 'deleted'} onClick={onOpenFile}><FileCode2 /></button>
    <button type="button" title="刷新" aria-label="刷新" onClick={onRefresh}><RefreshCw /></button>
  </div>
  const diffFileControls = <div className="workspace-diff-controls workspace-diff-file-controls">
    <button type="button" aria-label="自动换行" aria-pressed={preferences.wrap}
      title="自动换行" onClick={() => updatePreferences({ ...preferences, wrap: !preferences.wrap })}><WrapText /></button>
    <button type="button" aria-label={collapsedAll ? '展开全部差异' : '折叠全部差异'} aria-pressed={collapsedAll}
      title={collapsedAll ? '展开全部差异' : '折叠全部差异'} onClick={() => setCollapsedAll((collapsed) => !collapsed)}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 9.5h7M13 14.5h4M4 7l3 3 3-3M4 17l3-3 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <button type="button" aria-label={preferences.style === 'split' ? '自动差异视图：改用统一差异视图' : '自动差异视图：改用拆分差异视图'} aria-pressed={preferences.style === 'split'}
      title={preferences.style === 'split' ? '统一差异视图' : '拆分差异视图'}
      onClick={() => updatePreferences({ ...preferences, style: preferences.style === 'split' ? 'unified' : 'split' })}><Columns2 /></button>
  </div>
  return <section className={`workspace-diff-viewer${preferences.wrap ? ' is-wrapped' : ''}${collapsedAll ? ' is-collapsed' : ''}`} aria-label={`${path} 中的更改`}>
    <WorkspaceFileToolbar target={toolbarTarget} className="workspace-diff-toolbar">
      <WorkspaceBreadcrumbs root={cwd} path={change.path} onSelectFile={onSelectFile} />
      {typeof toolbarActions === 'function'
        ? toolbarActions(diffLeadingControls, diffFileControls)
        : <>{diffLeadingControls}{diffFileControls}{toolbarActions}</>}
    </WorkspaceFileToolbar>
    {searchOpen && <div className="workspace-file-search-overlay" role="presentation" onMouseDown={() => { setSearchOpen(false); setSearchQuery('') }}>
      <section className="workspace-file-search-dialog" role="dialog" aria-modal="true" aria-label="在文件中搜索" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspace-file-search-filters" aria-label="搜索类型">
          {[['全部', 'All'], ['操作', 'Actions'], ['聊天', 'Chats'], ['文件', 'Files'], ['文本', 'Text']].map(([label, key]) => <button type="button" className={key === 'Text' ? 'is-active' : ''} key={key}>{label}</button>)}
          <span>Tab</span>
          <span className="workspace-file-search-spacer" />
          <button type="button">范围：{breadcrumbs[0] || '工作区'} <ChevronDown /></button>
          <label>文件类型 <input value={searchFileType} readOnly aria-label="文件类型" /></label>
        </div>
        <label className="workspace-file-search-input">
          <Search />
          <input autoFocus value={searchQuery} aria-label="搜索文件" placeholder="搜索文件"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); setSearchQuery('') } }} />
          {normalizedSearchQuery && <span>{searchMatchCount} 个结果</span>}
        </label>
        <div className="workspace-file-search-results">
          {!normalizedSearchQuery ? <span>输入内容以搜索文件</span> : searchMatches.length === 0 ? <span>没有结果</span>
            : searchMatches.slice(0, 40).map((line, index) => <button type="button" key={`${line.raw}:${index}`}>
              <FileCode2 /><span>{line.content || line.raw}</span><small>{line.newLineNumber ?? line.oldLineNumber ?? '—'}</small>
            </button>)}
        </div>
      </section>
    </div>}
    {copyError && <div role="status" className="workspace-diff-copy-error">{copyError}</div>}
    <div className="workspace-diff-scroll" tabIndex={0} data-diff-style={preferences.style}>
      {diff.lines.length === 0 && <div className="workspace-code-empty"><GitCompareArrows /><strong>没有可显示的文本差异</strong></div>}
      {portions.map((lines, portion) => <div key={portion}>
        {portion === 1 && <div className="workspace-diff-separator"><button type="button" onClick={() => setShowAll(true)}>显示隐藏的 {visible.omittedCount.toLocaleString()} 行</button></div>}
        {preferences.style === 'unified' ? lines.map((line, i) =>
          line.kind === 'hunk' || line.kind === 'metadata'
            ? <div className="workspace-diff-separator" title={line.kind === 'hunk' ? line.raw : undefined} key={i}>{separatorLabels.get(line) || line.content}</div>
            : <Fragment key={i}><div className={`workspace-diff-line is-${line.kind}${lineMatchesSearch(line) ? ' is-search-match' : ''}`} data-kind={line.kind}>
                {lineNumber(line, 'left')}{lineNumber(line, 'right')}
                <span className="workspace-diff-marker" aria-hidden="true">{line.marker}</span><Source line={line} />
              </div>{renderAnnotations(line.oldLineNumber, line.newLineNumber)}</Fragment>)
          : splitWorkspaceDiffLines(lines).map((row, i) => row.kind === 'separator'
            ? <div className="workspace-diff-separator" title={row.before?.kind === 'hunk' ? row.before.raw : undefined} key={i}>{row.before ? separatorLabels.get(row.before) || row.before.content : null}</div>
            : <Fragment key={i}><div className="workspace-diff-split-row">
                <div className={`workspace-diff-split-cell${row.before ? ` is-${row.before.kind}` : ' is-empty'}${lineMatchesSearch(row.before) ? ' is-search-match' : ''}`}>
                  {lineNumber(row.before, 'left')}<Source line={row.before} />
                </div>
                <div className={`workspace-diff-split-cell${row.after ? ` is-${row.after.kind}` : ' is-empty'}${lineMatchesSearch(row.after) ? ' is-search-match' : ''}`}>
                  {lineNumber(row.after, 'right')}<Source line={row.after} />
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

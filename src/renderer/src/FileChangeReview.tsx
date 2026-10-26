import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clipboard,
  FileDiff,
  LoaderCircle,
  Undo2
} from 'lucide-react'
import { type MouseEvent, type ReactNode, useMemo, useState } from 'react'
import type { FileChangeItem, FileUpdateChange } from './protocol'
import { dispatchWorkspaceDiffLink } from './workspaceDiffLinks'
import { OPEN_WORKSPACE_CONTENT_EVENT } from './workspaceLayout'
import {
  collapseDiffLines,
  parseUnifiedDiff,
  type ParsedDiffLine,
  type ParsedUnifiedDiff
} from './unifiedDiff'

const INITIAL_DIFF_LINE_LIMIT = 240
const INITIAL_DIFF_TAIL_LINES = 24

interface ParsedFileChange {
  change: FileUpdateChange
  diff: ParsedUnifiedDiff
}

interface ChangePresentation {
  badge: 'A' | 'D' | 'M' | 'R'
  label: 'Added' | 'Deleted' | 'Modified' | 'Moved'
  className: 'added' | 'deleted' | 'modified' | 'moved'
  destinationPath: string | null
}

function presentationFor(change: FileUpdateChange): ChangePresentation {
  if (change.kind.type === 'add') {
    return { badge: 'A', label: 'Added', className: 'added', destinationPath: null }
  }
  if (change.kind.type === 'delete') {
    return { badge: 'D', label: 'Deleted', className: 'deleted', destinationPath: null }
  }
  if (change.kind.move_path) {
    return {
      badge: 'R',
      label: 'Moved',
      className: 'moved',
      destinationPath: change.kind.move_path
    }
  }
  return { badge: 'M', label: 'Modified', className: 'modified', destinationPath: null }
}

function DiffStatus({ status }: { status?: string }): ReactNode {
  if (status === 'inProgress') {
    return <LoaderCircle className="file-change-status spin" aria-label="Updating files" />
  }
  if (status === 'failed' || status === 'declined') {
    return <CircleAlert className="file-change-status failed" aria-label="File update failed" />
  }
  return <CircleCheck className="file-change-status complete" aria-label="Files updated" />
}

function DiffLine({ line }: { line: ParsedDiffLine }): ReactNode {
  return (
    <div className={`unified-diff-line ${line.kind}`} data-kind={line.kind}>
      <span className="unified-diff-line-number" aria-hidden="true">
        {line.oldLineNumber ?? ''}
      </span>
      <span className="unified-diff-line-number" aria-hidden="true">
        {line.newLineNumber ?? ''}
      </span>
      <span className="unified-diff-marker" aria-hidden="true">
        {line.marker}
      </span>
      <code>{line.content}</code>
    </div>
  )
}

function FileDiffPanel({
  file,
  itemId,
  defaultOpen
}: {
  file: ParsedFileChange
  itemId: string
  defaultOpen: boolean
}): ReactNode {
  const [showEntireDiff, setShowEntireDiff] = useState(false)
  const [copied, setCopied] = useState(false)
  const presentation = presentationFor(file.change)
  const displayedPath = presentation.destinationPath || file.change.path
  const canCopyPath =
    typeof navigator !== 'undefined' &&
    globalThis.isSecureContext === true &&
    typeof navigator.clipboard?.writeText === 'function'
  const collapsed = collapseDiffLines(
    file.diff.lines,
    INITIAL_DIFF_LINE_LIMIT,
    INITIAL_DIFF_TAIL_LINES
  )
  const hasTruncatedLines = collapsed.omittedCount > 0

  const copyPath = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!canCopyPath) return
    void navigator.clipboard.writeText(displayedPath).then(
      () => setCopied(true),
      () => setCopied(false)
    )
  }

  return (
    <details className="file-diff-panel" open={defaultOpen}>
      <summary>
        <ChevronRight className="file-diff-disclosure" />
        <span
          className={`file-diff-kind ${presentation.className}`}
          title={presentation.label}
          aria-label={presentation.label}
        >
          {presentation.badge}
        </span>
        <span
          className="file-diff-path"
          title={
            presentation.destinationPath
              ? `${file.change.path} → ${presentation.destinationPath}`
              : file.change.path
          }
        >
          <span>{file.change.path}</span>
          {presentation.destinationPath && (
            <>
              <ArrowRight />
              <span>{presentation.destinationPath}</span>
            </>
          )}
        </span>
        <span className="file-diff-stat" aria-label={`${file.diff.additions} additions`}>
          +{file.diff.additions}
        </span>
        <span className="file-diff-stat deletions" aria-label={`${file.diff.deletions} deletions`}>
          −{file.diff.deletions}
        </span>
        <button type="button" className="file-diff-copy" aria-label={`Open diff ${displayedPath}`} title="Open diff"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); dispatchWorkspaceDiffLink({ itemId, change: file.change }) }}><FileDiff /></button>
        {canCopyPath && (
          <button
            type="button"
            className="file-diff-copy"
            aria-label={`Copy path ${displayedPath}`}
            title={copied ? 'Path copied' : 'Copy path'}
            onClick={copyPath}
          >
            {copied ? <Check /> : <Clipboard />}
          </button>
        )}
      </summary>
      <div className="unified-diff" aria-label={`Changes in ${displayedPath}`}>
        {file.diff.lines.length === 0 ? (
          <div className="unified-diff-empty">No textual diff available</div>
        ) : (
          <div className="unified-diff-scroll">
            {(showEntireDiff ? file.diff.lines : collapsed.head).map((line, index) => (
              <DiffLine key={`head-${index}-${line.oldLineNumber}-${line.newLineNumber}`} line={line} />
            ))}
            {!showEntireDiff && hasTruncatedLines && (
              <div className="unified-diff-truncation">
                <button type="button" onClick={() => setShowEntireDiff(true)}>
                  Show {collapsed.omittedCount.toLocaleString()} hidden lines
                </button>
              </div>
            )}
            {!showEntireDiff &&
              collapsed.tail.map((line, index) => (
                <DiffLine key={`tail-${index}-${line.oldLineNumber}-${line.newLineNumber}`} line={line} />
              ))}
          </div>
        )}
        {file.diff.isBinary && <div className="unified-diff-binary">Binary file changed</div>}
        {showEntireDiff && hasTruncatedLines && (
          <div className="unified-diff-collapse">
            <button type="button" onClick={() => setShowEntireDiff(false)}>
              Collapse large diff
            </button>
          </div>
        )}
      </div>
    </details>
  )
}

export function FileChangeReview({ item }: { item: FileChangeItem }): ReactNode {
  const files = useMemo<ParsedFileChange[]>(
    () =>
      (item.changes || []).map((change) => ({
        change,
        diff: parseUnifiedDiff(change.diff)
      })),
    [item.changes]
  )
  const additions = files.reduce((total, file) => total + file.diff.additions, 0)
  const deletions = files.reduce((total, file) => total + file.diff.deletions, 0)
  const primaryPath = files[0]?.change.path || ''
  const primaryName = primaryPath.split('/').filter(Boolean).at(-1) || primaryPath
  const title = files.length === 1 ? `已编辑 ${primaryName}` : `已编辑 ${files.length} 个文件`

  return (
    <details className="file-change-review">
      <summary className="file-change-review-heading">
        <span className="tool-card-icon">
          <FileDiff />
        </span>
        <span className="tool-card-heading">
          <strong>{title}</strong>
          <small>
            <span className="file-change-total-stat" aria-label={`${additions} additions`}>
              +{additions}
            </span>{' '}
            <span className="file-change-total-stat deletions" aria-label={`${deletions} deletions`}>
              −{deletions}
            </span>
          </small>
        </span>
        <span className="file-change-undo">撤销 <Undo2 /></span>
        <button type="button" className="file-change-view" onClick={(event) => {
          event.preventDefault(); event.stopPropagation()
          if (files.length === 1) dispatchWorkspaceDiffLink({ itemId: item.id, change: files[0].change })
          else window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT, { detail: { tab: 'changes' } }))
        }}>查看变更</button>
        <DiffStatus status={item.status} />
      </summary>
      {files.length > 0 ? (
        <div className="file-change-list">
          {files.map((file, index) => (
            <FileDiffPanel
              key={`${file.change.path}-${file.change.kind.type}-${index}`}
              file={file}
              itemId={item.id}
              defaultOpen={files.length === 1}
            />
          ))}
        </div>
      ) : (
        <div className="file-change-empty">Waiting for file changes…</div>
      )}
    </details>
  )
}

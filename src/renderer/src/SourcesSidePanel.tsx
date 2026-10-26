import {
  FileText,
  Globe2,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkspacePaneSnapshot, WorkspaceSourceKind } from './workspacePaneModel'
import {
  workspacePanelSourcesFromSnapshot,
  type WorkspacePanelSourceEntry
} from './workspaceSummaryPanelsModel'
import './workspaceSummaryPanels.css'

export interface SourcesSidePanelProps {
  snapshot: WorkspacePaneSnapshot
  sources?: readonly WorkspacePanelSourceEntry[]
  onOpenFile?(path: string, source: WorkspacePanelSourceEntry): void
  onOpenImage?(path: string, source: WorkspacePanelSourceEntry): void
  onOpenWeb?(url: string, source: WorkspacePanelSourceEntry): void
  onClose?(): void
}

interface SourceGroup {
  kind: WorkspaceSourceKind
  label: string
  entries: readonly WorkspacePanelSourceEntry[]
}

function SourceIcon({ kind }: { kind: WorkspaceSourceKind }): ReactNode {
  if (kind === 'image') return <ImageIcon />
  if (kind === 'web') return <Globe2 />
  return <FileText />
}

function sourceAction(
  source: WorkspacePanelSourceEntry,
  props: Pick<SourcesSidePanelProps, 'onOpenFile' | 'onOpenImage' | 'onOpenWeb'>
): (() => void) | null {
  if (source.kind === 'attachment' && source.path && props.onOpenFile) {
    return () => props.onOpenFile?.(source.path as string, source)
  }
  if (source.kind === 'image' && source.path && props.onOpenImage) {
    return () => props.onOpenImage?.(source.path as string, source)
  }
  if (source.kind === 'web' && source.url && props.onOpenWeb) {
    return () => props.onOpenWeb?.(source.url as string, source)
  }
  return null
}

function SourceRow({
  source,
  onOpenFile,
  onOpenImage,
  onOpenWeb
}: Pick<SourcesSidePanelProps, 'onOpenFile' | 'onOpenImage' | 'onOpenWeb'> & {
  source: WorkspacePanelSourceEntry
}): ReactNode {
  const action = sourceAction(source, { onOpenFile, onOpenImage, onOpenWeb })
  const content = <>
    <span className={`workspace-summary-source-icon is-${source.kind}`} aria-hidden="true">
      <SourceIcon kind={source.kind} />
    </span>
    <span className="workspace-summary-source-copy">
      <strong>{source.title}</strong>
      <span className="workspace-summary-source-metadata" title={source.metadata}>{source.metadata}</span>
      <small>{source.purpose}</small>
    </span>
  </>

  return (
    <li className="workspace-summary-source-row" data-source-kind={source.kind} data-actionable={Boolean(action)}>
      {action ? (
        <button type="button" aria-label={`打开${source.kind === 'image' ? '图片' : source.kind === 'web' ? '网页' : '文件'} ${source.title}`} onClick={action}>
          {content}
        </button>
      ) : (
        <div className="workspace-summary-source-static">{content}</div>
      )}
    </li>
  )
}

export function SourcesSidePanel({
  snapshot,
  sources = workspacePanelSourcesFromSnapshot(snapshot),
  onOpenFile,
  onOpenImage,
  onOpenWeb,
  onClose
}: SourcesSidePanelProps): ReactNode {
  const groups: SourceGroup[] = [
    { kind: 'attachment', label: '附件与文件', entries: sources.filter((source) => source.kind === 'attachment') },
    { kind: 'image', label: '图片', entries: sources.filter((source) => source.kind === 'image') },
    { kind: 'web', label: 'Web 搜索', entries: sources.filter((source) => source.kind === 'web') }
  ]

  return (
    <aside className="workspace-summary-side-panel workspace-sources-side-panel" aria-label="来源">
      <header className="workspace-summary-side-panel-header">
        <span className="workspace-summary-side-panel-title"><Link2 aria-hidden="true" /><strong>来源</strong></span>
        <span className="workspace-summary-side-panel-count" aria-label={`${sources.length} 个来源`}>{sources.length}</span>
        {onClose && <button type="button" className="workspace-summary-side-panel-close" aria-label="关闭来源" onClick={onClose}><X /></button>}
      </header>

      {snapshot.updating && (
        <div className="workspace-summary-side-panel-live" role="status">
          <LoaderCircle className="workspace-summary-panel-spin" />
          <span>正在收集来源…</span>
        </div>
      )}

      <div className="workspace-summary-side-panel-scroll">
        {groups.map((group) => group.entries.length > 0 && (
          <section className="workspace-summary-panel-section" data-source-group={group.kind} key={group.kind} aria-labelledby={`workspace-source-group-${group.kind}`}>
            <h2 id={`workspace-source-group-${group.kind}`}>{group.label}<span>{group.entries.length}</span></h2>
            <ul aria-label={group.label}>
              {group.entries.map((source) => <SourceRow key={source.id} source={source} onOpenFile={onOpenFile} onOpenImage={onOpenImage} onOpenWeb={onOpenWeb} />)}
            </ul>
          </section>
        ))}

        {sources.length === 0 && (
          <div className="workspace-summary-side-panel-empty">
            <Link2 aria-hidden="true" />
            <strong>暂无来源</strong>
            <span>附件、图片和 Web 搜索结果会显示在这里。</span>
          </div>
        )}
      </div>
    </aside>
  )
}

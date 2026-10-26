import {
  Ellipsis,
  FileText,
  Globe2,
  Image as ImageIcon,
  Link2,
  Plus,
  SquarePlus
} from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { SubagentAvatar } from './SubagentActivity'
import { subagentActivityLabel } from './subagentActivityModel'
import type {
  WorkspacePanelSourceEntry,
  WorkspacePanelSubagentEntry
} from './workspaceSummaryPanelsModel'
import './ProjectSummaryPopover.css'

export type ProjectSummarySubagent = Pick<
  WorkspacePanelSubagentEntry,
  'threadId' | 'name' | 'status'
>

export type ProjectSummarySource = Pick<
  WorkspacePanelSourceEntry,
  'id' | 'title' | 'kind'
> &
  Partial<Pick<WorkspacePanelSourceEntry, 'turnId' | 'path' | 'url'>> & {
    thumbnailUrl?: string
  }

export interface ProjectSummaryPopoverProps {
  projectName: string
  changesCount: number
  subagents: readonly ProjectSummarySubagent[]
  sources: readonly ProjectSummarySource[]
  open: boolean
  onClose(): void
  onOpenChanges(): void
  onOpenSubagents(): void
  onOpenSource(source?: ProjectSummarySource): void
  onOpenProjectMenu?(): void
  onAddSource?(): void
  anchorRef?: RefObject<HTMLElement | null>
  maxVisibleSources?: number
}

export interface ProjectSummarySubagentCounts {
  running: number
  completed: number
}

function subagentIsDone(status: ProjectSummarySubagent['status']): boolean {
  return status === 'completed' || status === 'interrupted' || status === 'failed'
}

export function projectSummarySubagentCounts(
  subagents: readonly ProjectSummarySubagent[]
): ProjectSummarySubagentCounts {
  const completed = subagents.filter((subagent) => subagentIsDone(subagent.status)).length
  return { running: subagents.length - completed, completed }
}

export function projectSummaryVisibleSources(
  sources: readonly ProjectSummarySource[],
  maximum = 3
): readonly ProjectSummarySource[] {
  const limit = Math.max(0, maximum)
  if (!limit) return []

  // The native compact card puts the latest turn first while preserving the
  // attachment order inside each individual user message.
  const turnGroups: ProjectSummarySource[][] = []
  const turnIndexes = new Map<string, number>()
  for (const source of sources) {
    const identity = source.turnId || `source:${source.id}`
    const existing = turnIndexes.get(identity)
    if (existing === undefined) {
      turnIndexes.set(identity, turnGroups.length)
      turnGroups.push([source])
    } else {
      turnGroups[existing].push(source)
    }
  }
  return turnGroups.toReversed().flat().slice(0, limit)
}

function sourceIcon(source: ProjectSummarySource): ReactNode {
  if (source.kind === 'web') return <Globe2 />
  if (source.kind === 'attachment') return <FileText />
  return <ImageIcon />
}

function SourceThumbnail({ source }: { source: ProjectSummarySource }): ReactNode {
  return (
    <span className="project-summary-source-thumbnail" data-source-kind={source.kind}>
      {source.thumbnailUrl ? (
        <img src={source.thumbnailUrl} alt="" draggable={false} />
      ) : (
        sourceIcon(source)
      )}
    </span>
  )
}

function zoomFactor(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--codex-window-zoom')
    .trim()
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function ProjectSummaryPopover({
  projectName,
  changesCount,
  subagents,
  sources,
  open,
  onClose,
  onOpenChanges,
  onOpenSubagents,
  onOpenSource,
  onOpenProjectMenu,
  onAddSource,
  anchorRef,
  maxVisibleSources = 3
}: ProjectSummaryPopoverProps): ReactNode {
  const popoverRef = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const [loadedThumbnails, setLoadedThumbnails] = useState<Record<string, string>>({})
  const counts = projectSummarySubagentCounts(subagents)
  const visibleSources = useMemo(
    () => projectSummaryVisibleSources(sources, maxVisibleSources).map((source) => ({
      ...source,
      thumbnailUrl: source.thumbnailUrl || (source.path ? loadedThumbnails[source.path] : undefined)
    })),
    [loadedThumbnails, maxVisibleSources, sources]
  )
  const hasSubagents = subagents.length > 0
  const hasSources = sources.length > 0
  const visibleSubagents = [...subagents]
    .sort((left, right) => Number(subagentIsDone(left.status)) - Number(subagentIsDone(right.status)))
    .slice(0, 3)
  const subagentDescription = subagents
    .map((subagent) => `${subagent.name}，${subagentActivityLabel(subagent.status)}`)
    .join('；')

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setPosition(null)
      return
    }

    const updatePosition = (): void => {
      const anchor = anchorRef.current
      if (!anchor) return
      const zoom = zoomFactor()
      const bounds = anchor.getBoundingClientRect()
      setPosition({
        top: (bounds.bottom + 7) / zoom,
        right: Math.max(8, (window.innerWidth - bounds.right) / zoom),
        maxHeight: Math.max(160, (window.innerHeight - bounds.bottom - 15) / zoom)
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open])

  useEffect(() => {
    if (!open) return
    const paths = [...new Set(visibleSources.flatMap((source) =>
      source.kind === 'image' && source.path && !source.thumbnailUrl ? [source.path] : []
    ))]
    if (!paths.length) return
    let cancelled = false
    void Promise.all(paths.map(async (path) => {
      try {
        const result = await window.codex.readThreadImage(path)
        if (!result.mimeType.startsWith('image/')) return null
        return [path, `data:${result.mimeType};base64,${result.dataBase64}`] as const
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      const resolved = entries.filter((entry) => entry !== null)
      if (resolved.length) {
        setLoadedThumbnails((current) => ({ ...current, ...Object.fromEntries(resolved) }))
      }
    })
    return () => { cancelled = true }
  }, [open, visibleSources])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        target instanceof Node &&
        (popoverRef.current?.contains(target) || anchorRef?.current?.contains(target))
      ) return
      if (
        target instanceof Element &&
        target.closest(
          '[data-app-shell-tab-strip-controller="right"], [role="tabpanel"][data-app-shell-tab-panel-controller="right"]'
        )
      ) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchorRef, onClose, open])

  if (!open) return null

  const activate = (action: () => void): void => {
    onClose()
    action()
  }
  const openSource = (source?: ProjectSummarySource): void => {
    activate(() => onOpenSource(source))
  }
  const changesLabel = changesCount === 1
    ? '查看变更，1 个文件'
    : `查看变更，${Math.max(0, changesCount)} 个文件`
  const subagentsLabel = subagentDescription
    ? `打开子智能体，${counts.running} 个运行中，${counts.completed} 完成。${subagentDescription}`
    : '打开子智能体，暂无子智能体'

  const panel = (
    <aside
      ref={popoverRef}
      className="project-summary-popover"
      role="dialog"
      aria-label={`${projectName} 项目摘要`}
      data-state="open"
      style={position || undefined}
    >
      <header className="project-summary-header">
        <strong title={projectName}>{projectName}</strong>
        <button
          type="button"
          className="project-summary-icon-button"
          aria-label={`${projectName} 项目操作`}
          disabled={!onOpenProjectMenu}
          onClick={() => onOpenProjectMenu && activate(onOpenProjectMenu)}
        >
          <Ellipsis />
        </button>
      </header>

      <button
        type="button"
        className="project-summary-row project-summary-changes"
        data-change-count={Math.max(0, changesCount)}
        aria-label={changesLabel}
        onClick={() => activate(onOpenChanges)}
      >
        <SquarePlus />
        <span>变更</span>
      </button>

      {hasSubagents && (
        <>
          <div className="project-summary-divider" role="separator" />
          <section className="project-summary-section" aria-labelledby="project-summary-subagents-heading">
            <h2 id="project-summary-subagents-heading">子智能体</h2>
            <button
              type="button"
              className="project-summary-row project-summary-subagents"
              aria-label={subagentsLabel}
              title={subagentDescription || undefined}
              onClick={() => activate(onOpenSubagents)}
            >
              <span className="project-summary-agent-avatars" aria-hidden="true">
                {visibleSubagents.map((subagent) => (
                  <SubagentAvatar seed={subagent.threadId || subagent.name} key={subagent.threadId} />
                ))}
              </span>
              <span className="project-summary-agent-running">
                {counts.running > 0 ? `${counts.running} 个运行中` : '无运行中'}
              </span>
              <span className="project-summary-agent-completed">{counts.completed} 完成</span>
            </button>
          </section>
        </>
      )}

      {hasSources && (
        <>
          <div className="project-summary-divider" role="separator" />
          <section className="project-summary-section project-summary-sources" aria-labelledby="project-summary-sources-heading">
            <div className="project-summary-sources-header">
              <h2 id="project-summary-sources-heading">来源</h2>
              <button
                type="button"
                className="project-summary-icon-button project-summary-add-source"
                aria-label="添加来源"
                onClick={() => activate(onAddSource || (() => onOpenSource()))}
              >
                <Plus />
              </button>
            </div>
            <ul className="project-summary-source-list" aria-label="最近来源">
              {visibleSources.map((source) => (
                <li key={source.id}>
                  <button
                    type="button"
                    className="project-summary-source-row"
                    aria-label={`打开来源 ${source.title}`}
                    title={source.title}
                    onClick={() => openSource(source)}
                  >
                    <SourceThumbnail source={source} />
                    <span>{source.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="project-summary-row project-summary-view-all"
              aria-label={`查看全部来源，共 ${sources.length} 项`}
              onClick={() => openSource()}
            >
              <Link2 />
              <span>查看全部</span>
            </button>
          </section>
        </>
      )}
    </aside>
  )

  return typeof document === 'undefined' ? panel : createPortal(panel, document.body)
}

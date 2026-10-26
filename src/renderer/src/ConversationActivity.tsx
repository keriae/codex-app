import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Folder,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { CommandItem, ThreadItem } from './protocol'
import {
  commandActivityCopy,
  commandActivityRows,
  conversationActivityUnits,
  type CommandActivityKind,
  type CompletedActivitySummary
} from './commandActivity'
import { dispatchWorkspaceFileLink } from './workspaceFileLinks'
import { CadencedShimmer } from './CadencedShimmer'
import {
  conversationActivityProjection,
  isConversationActivityInProgress,
  latestConversationReasoning
} from './conversationActivityModel'
import './conversationActivity.css'
import { SubagentActivityGroup } from './SubagentActivity'

export function CommandActivityIcon({ kind }: { kind: CommandActivityKind | CompletedActivitySummary['kind'] }): ReactNode {
  if (kind === 'tools') return <span className="conversation-activity-icon" aria-hidden="true"><Wrench /></span>
  if (kind === 'webSearch') return <span className="conversation-activity-icon" aria-hidden="true"><Globe /></span>
  const Icon = kind === 'read' || kind === 'exploration' ? BookOpen : kind === 'search' ? Search
    : kind === 'listFiles' ? Folder : kind === 'edits' ? Pencil : SquareTerminal
  return <span className="conversation-activity-icon" aria-hidden="true"><Icon /></span>
}

export function CommandActivity({ item, compact = false }: { item: CommandItem; compact?: boolean }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [selectedRow, setSelectedRow] = useState(0)
  const [commandExpanded, setCommandExpanded] = useState(false)
  const contentId = useId()
  const detailedRows = commandActivityRows(item)
  const rows = compact || !detailedRows.length ? [commandActivityCopy(item)] : detailedRows
  const command = detailedRows[selectedRow]?.command || detailedRows.at(-1)?.command || item.command
  return (
    <div className={`conversation-command-item${compact ? ' is-compact' : ''}`} data-status={item.status}>
      <div className="conversation-command-rows">
        {rows.map((row, index) => (
          <button type="button" key={index} className="conversation-command-row"
            data-command-activity-kind={row.kind} aria-expanded={expanded && selectedRow === index} aria-controls={contentId}
            onClick={() => { setSelectedRow(index); setCommandExpanded(false); setExpanded((value) => selectedRow !== index || !value) }}>
            <CommandActivityIcon kind={row.kind} />
            <span className="activity-item-copy" style={{ gap: (row.kind === 'search' && (row.action === '已对' || row.detail === '文件')) || (row.kind === 'listFiles' && row.detail === '文件') ? 0 : 5 }}>
              <CadencedShimmer active={item.status === 'inProgress'}>{row.action}</CadencedShimmer>{row.detail && <span
                className={`command-activity-detail${row.kind === 'read' ? ' is-file' : ''}`}
                title={'path' in row && row.path ? String(row.path) : undefined}
                role={row.kind === 'read' && 'path' in row && row.path ? 'link' : undefined}
                tabIndex={row.kind === 'read' && 'path' in row && row.path ? 0 : undefined}
                onClick={(event) => {
                  if (row.kind !== 'read' || !('path' in row) || !row.path) return
                  event.stopPropagation()
                  dispatchWorkspaceFileLink({ path: String(row.path), line: 1 })
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  if (row.kind !== 'read' || !('path' in row) || !row.path) return
                  event.preventDefault(); event.stopPropagation()
                  dispatchWorkspaceFileLink({ path: String(row.path), line: 1 })
                }}
              >{row.detail}</span>}
            </span>
          </button>
        ))}
      </div>
      {expanded && (
        <div className="conversation-command-output" id={contentId}>
          <div className="conversation-command-caption">Shell{item.cwd && <span>{item.cwd}</span>}</div>
          <div className="conversation-command-code">
            <pre className={`conversation-command-source${commandExpanded ? ' is-expanded' : ''}`} tabIndex={0}
              onClick={() => setCommandExpanded((value) => !value)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCommandExpanded((value) => !value) } }}
            >{command}</pre>
            <button type="button" className="conversation-command-copy" aria-label="复制命令" onClick={() => void navigator.clipboard?.writeText(command)}><Copy /></button>
          </div>
          <div className="conversation-command-code">
            <pre className="conversation-command-text">{item.aggregatedOutput || (item.status === 'inProgress' ? '' : '无输出')}</pre>
            {item.aggregatedOutput && <button type="button" className="conversation-command-copy" aria-label="复制输出" onClick={() => void navigator.clipboard?.writeText(item.aggregatedOutput || '')}><Copy /></button>}
          </div>
          <div className="conversation-command-exit">{item.status === 'inProgress' ? null : item.exitCode === 0 ? <><Check />成功</> : item.exitCode !== null && item.exitCode !== undefined ? `退出码 ${item.exitCode}` : '未知'}</div>
        </div>
      )}
    </div>
  )
}

function ActivityGroup({
  items, label, kind, renderItem
}: {
  items: ThreadItem[]
  label: string
  kind: CompletedActivitySummary['kind']
  renderItem(item: ThreadItem, grouped: boolean): ReactNode
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const frame = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  const contentId = useId()
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  const toggle = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (timer.current !== null) window.clearTimeout(timer.current)
    if (expanded) {
      setExpanded(false)
      timer.current = window.setTimeout(() => setMounted(false), 300)
    } else {
      setMounted(true)
      frame.current = requestAnimationFrame(() => setExpanded(true))
    }
  }
  return (
    <div className="conversation-activity-group" data-command-activity-summary={kind}>
      <button
        type="button"
        className="conversation-activity-group-heading"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={toggle}
      >
        <CommandActivityIcon kind={kind} />
        <span>{label}</span>
        <ChevronDown className={`activity-group-chevron${expanded ? ' is-expanded' : ''}`} />
      </button>
      {mounted && (
        <div className={`conversation-activity-group-collapse${expanded ? ' is-expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}>
          <div className="conversation-activity-group-body" id={contentId}>
            {items.map((item) => <div key={item.id} className="conversation-activity-group-item">{renderItem(item, true)}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}

/** Group visible work, using reasoning only when no concrete live action exists. */
export function ConversationActivityItems({
  items,
  live = false,
  preserveSingleItemGroups = false,
  completedHeader = false,
  renderItem
}: {
  items: ThreadItem[]
  live?: boolean
  preserveSingleItemGroups?: boolean
  completedHeader?: boolean
  renderItem(item: ThreadItem, grouped: boolean): ReactNode
}): ReactNode {
  const projection = conversationActivityProjection(items)
  const visibleItems = projection.items
  const hasActiveActivity = live && visibleItems.some((item) => isConversationActivityInProgress(item, true))
  const reasoning = live && !hasActiveActivity ? latestConversationReasoning(items) : null
  const units = conversationActivityUnits(visibleItems, live, {
    preserveSingleItemGroups,
    completedHeader
  })
  const subagentsByAnchor = new Map(projection.subagentGroups.map((group) => [group.anchorItemId, group]))
  const groupedSubagentIds = new Set(projection.subagentGroups.flatMap((group) => group.itemIds))
  return (
    <div className="conversation-activity-list">
      {units.map((unit) => {
        if (unit.kind === 'group') {
          return (
            <ActivityGroup key={unit.key} items={unit.items} label={unit.summary.label}
              kind={unit.summary.kind} renderItem={renderItem} />
          )
        }
        const item = unit.item
        const subagentGroup = subagentsByAnchor.get(item.id)
        if (subagentGroup) return <div className="conversation-activity-unit" key={`subagent-activity:${item.id}`}><SubagentActivityGroup items={subagentGroup.items} /></div>
        if (groupedSubagentIds.has(item.id)) return null
        const content = renderItem(
          item,
          item.type === 'commandExecution' && !isConversationActivityInProgress(item, live)
        )
        return content == null || content === false ? null : <div className="conversation-activity-unit" key={unit.key}>{content}</div>
      })}
      {reasoning && <div className="conversation-thinking-status">{renderItem(reasoning, false)}</div>}
    </div>
  )
}

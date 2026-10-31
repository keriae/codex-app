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
import { ActivityGlyph } from './ActivityGlyph'
import { commandOutputDisplayCommand, commandOutputText } from './commandOutput'
import { copyTextToClipboard } from './clipboard'
import { useActivityDisclosure } from './useActivityDisclosure'
import { useCommandActivityTiming } from './useCommandActivityTiming'
import { ActivityTooltip } from './ActivityTooltip'

export function CommandActivityIcon({ kind }: { kind: CommandActivityKind | CompletedActivitySummary['kind'] }): ReactNode {
  const glyph = kind === 'exploration' ? 'read' : kind === 'commands' ? 'command' : kind
  return <span className="conversation-activity-icon" aria-hidden="true"><ActivityGlyph kind={glyph} /></span>
}

export function CommandCopyButton({ text, label }: { text: string; label: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])
  const copy = async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await copyTextToClipboard(text)
      if (!mounted.current) return
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // A rejected clipboard write must never display the success state.
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const description = copied ? '已复制' : label
  return <ActivityTooltip variant="copy" content={description}><button type="button" className="conversation-command-copy" aria-label={copied ? '已复制' : '复制'}
    aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={copied ? undefined : (event) => { event.stopPropagation(); void copy() }}
  ><ActivityGlyph kind={copied ? 'copied' : 'copy'} /></button></ActivityTooltip>
}

export function CommandOutput({ item, command: rawCommand, id }: { item: CommandItem; command: string; id?: string }): ReactNode {
  const [commandExpanded, setCommandExpanded] = useState(false)
  const command = commandOutputDisplayCommand(rawCommand)
  const output = commandOutputText(item)
  return (
    <div className="conversation-command-output" id={id}>
      {command && <div className="conversation-command-code conversation-command-line">
        <div className={`conversation-command-source${commandExpanded ? ' is-expanded' : ''}`}
          role="button" tabIndex={0} aria-label={`$ ${command}`} aria-expanded={commandExpanded}
          onClick={() => setCommandExpanded(true)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCommandExpanded(true) } }}
        ><span className="conversation-command-prompt" aria-hidden="true">$</span>{command}</div>
        <CommandCopyButton text={command} label="复制命令" />
      </div>}
      <div className="conversation-command-code conversation-command-stream">
        <div className="conversation-command-scroll"><pre className="conversation-command-text">{output}</pre></div>
        {item.aggregatedOutput && <CommandCopyButton text={item.aggregatedOutput} label="复制输出" />}
      </div>
      <div className="conversation-command-exit">{item.status === 'inProgress' ? null : item.executionStatus === 'interrupted' ? '已停止' : item.exitCode === 0 ? <><ActivityGlyph kind="check" />成功</> : `退出码 ${item.exitCode ?? '未知'}`}</div>
    </div>
  )
}

export function CommandActivity({ item, compact = false }: { item: CommandItem; compact?: boolean }): ReactNode {
  const { expanded, mounted, visible, setOpen } = useActivityDisclosure()
  const [selectedRow, setSelectedRow] = useState(0)
  const contentId = useId()
  const timedItem = useCommandActivityTiming(item, !compact)
  const detailedRows = commandActivityRows(timedItem, { expandedRow: expanded ? selectedRow : null })
  const rows = compact || !detailedRows.length ? [commandActivityCopy(item)] : detailedRows
  const command = (compact ? detailedRows.at(-1)?.command : detailedRows[selectedRow]?.command) || item.command
  return (
    <div className={`conversation-command-item${compact ? ' is-compact' : ''}`} data-status={item.status}>
      <div className="conversation-command-rows">
        {rows.map((row, index) => {
          const filePath = row.kind === 'read'
            ? ('path' in row && row.path ? String(row.path) : detailedRows.at(-1)?.path || null)
            : null
          const disclosure = row.kind === 'command'
          const rowExpanded = expanded && selectedRow === index
          return <div key={index} className={`conversation-command-row${disclosure ? ' has-disclosure' : ''}`}
            data-command-activity-kind={row.kind}>
            {disclosure && <button type="button" className="conversation-command-toggle"
              aria-labelledby={`${contentId}-row-${index}`} aria-expanded={rowExpanded} aria-controls={contentId}
              onClick={() => { setSelectedRow(index); setOpen(selectedRow !== index || !expanded) }} />}
            <span className="conversation-command-summary" id={`${contentId}-row-${index}`}>
            {row.kind === 'command' && item.executionStatus === 'interrupted'
              ? <span className="conversation-activity-icon" aria-hidden="true"><ActivityGlyph kind="stopped" /></span>
              : <CommandActivityIcon kind={row.kind} />}
            <span className="activity-item-copy" style={{ gap: (row.kind === 'search' && (row.action === '已对' || row.detail === '文件')) || (row.kind === 'listFiles' && row.detail === '文件') ? 0 : 5 }}>
              <CadencedShimmer active={item.status === 'inProgress'}>{row.action}</CadencedShimmer>
              {row.detail && (filePath ? <button type="button" className="command-activity-detail is-file"
                data-agent-activity-file-link="" title={filePath}
                onClick={() => dispatchWorkspaceFileLink({ path: filePath, line: 1 })}
              >{row.detail}</button> : <span className="command-activity-detail">{row.detail}</span>)}
            </span>
            </span>
            {disclosure && <ActivityGlyph kind="chevron" className={`activity-command-chevron${rowExpanded ? ' is-expanded' : ''}`} aria-hidden="true" />}
          </div>
        })}
      </div>
      {mounted && (compact
        // Lj opens qj's detailed item first; GT owns a separate output toggle.
        // The active summary itself deliberately has no elapsed-time label.
        ? <div className={`conversation-activity-group-collapse${visible ? ' is-expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}>
          <div className="conversation-activity-group-body" id={contentId}>
            <div className="conversation-activity-group-item"><CommandActivity item={item} /></div>
          </div>
        </div>
        : <div className={`conversation-command-collapse${visible ? ' is-expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}>
          <div><CommandOutput key={selectedRow} item={item} command={command} id={contentId} /></div>
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
  const { expanded, mounted, visible, setOpen } = useActivityDisclosure()
  const contentId = useId()
  return (
    <div className="conversation-activity-group" data-command-activity-summary={kind}>
      <button
        type="button"
        className="conversation-activity-group-heading"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setOpen(!expanded)}
      >
        <CommandActivityIcon kind={kind} />
        <span>{label}</span>
        <ActivityGlyph kind="chevron" className={`activity-group-chevron${expanded ? ' is-expanded' : ''}`} aria-hidden="true" />
      </button>
      {mounted && (
        <div className={`conversation-activity-group-collapse${visible ? ' is-expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}>
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

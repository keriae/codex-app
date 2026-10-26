import {
  Bot,
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { SubagentAvatar } from './SubagentActivity'
import type { WorkspacePaneSnapshot } from './workspacePaneModel'
import {
  workspacePanelSubagentIsDone,
  workspacePanelSubagentsFromSnapshot,
  type WorkspacePanelSubagentEntry
} from './workspaceSummaryPanelsModel'
import './workspaceSummaryPanels.css'

export interface SubagentsSidePanelProps {
  snapshot: WorkspacePaneSnapshot
  subagents?: readonly WorkspacePanelSubagentEntry[]
  previewCharacters?: number
  onSelectAgent?(threadId: string, name: string, agent: WorkspacePanelSubagentEntry): void
  onClose?(): void
}

export function truncateWorkspacePanelPreview(value: string, limit: number): string {
  if (limit <= 0 || value.length <= limit) return value
  return `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
}

function StatusIcon({ entry }: { entry: WorkspacePanelSubagentEntry }): ReactNode {
  if (entry.status === 'completed') return <CircleCheck />
  if (entry.status === 'failed' || entry.status === 'interrupted') return <CircleAlert />
  if (entry.status === 'waiting') return <Clock3 />
  return <LoaderCircle className="workspace-summary-panel-spin" />
}

function AgentRow({
  entry,
  previewCharacters,
  onSelectAgent
}: {
  entry: WorkspacePanelSubagentEntry
  previewCharacters: number
  onSelectAgent?: SubagentsSidePanelProps['onSelectAgent']
}): ReactNode {
  const canSelect = entry.selectable && Boolean(onSelectAgent)
  const preview = entry.preview ? truncateWorkspacePanelPreview(entry.preview, previewCharacters) : null
  return (
    <li className="workspace-summary-agent-row" data-agent-status={entry.status} data-actionable={canSelect}>
      <button
        type="button"
        disabled={!canSelect}
        aria-label={`打开子智能体 ${entry.name}，${entry.statusLabel}`}
        onClick={() => onSelectAgent?.(entry.threadId, entry.name, entry)}
      >
        <span className="workspace-summary-agent-avatar"><SubagentAvatar seed={entry.threadId} /></span>
        <span className="workspace-summary-agent-copy">
          <span className="workspace-summary-agent-heading">
            <strong>{entry.name}</strong>
            <span className="workspace-summary-agent-status"><StatusIcon entry={entry} />{entry.statusLabel}</span>
          </span>
          {preview && <span className="workspace-summary-agent-preview" title={entry.preview}>{preview}</span>}
          {entry.model && <small>{entry.model}</small>}
        </span>
      </button>
    </li>
  )
}

function AgentSection({
  id,
  label,
  entries,
  previewCharacters,
  onSelectAgent
}: {
  id: string
  label: 'Active' | 'Done'
  entries: readonly WorkspacePanelSubagentEntry[]
  previewCharacters: number
  onSelectAgent?: SubagentsSidePanelProps['onSelectAgent']
}): ReactNode {
  return (
    <section className="workspace-summary-panel-section workspace-summary-agent-section" data-agent-group={label.toLowerCase()} aria-labelledby={id}>
      <h2 id={id}>{label}<span>{entries.length}</span></h2>
      {entries.length > 0 ? (
        <ul aria-label={`${label} subagents`}>
          {entries.map((entry) => <AgentRow key={entry.threadId} entry={entry} previewCharacters={previewCharacters} onSelectAgent={onSelectAgent} />)}
        </ul>
      ) : (
        <p className="workspace-summary-panel-section-empty">{label === 'Active' ? '没有正在运行的子智能体' : '暂无已完成的子智能体'}</p>
      )}
    </section>
  )
}

export function SubagentsSidePanel({
  snapshot,
  subagents = workspacePanelSubagentsFromSnapshot(snapshot),
  previewCharacters = 140,
  onSelectAgent,
  onClose
}: SubagentsSidePanelProps): ReactNode {
  const active = subagents.filter((entry) => !workspacePanelSubagentIsDone(entry))
  const done = subagents.filter(workspacePanelSubagentIsDone)
  const activeCount = snapshot.collaboration.activeAgents || active.length
  const doneCount = snapshot.collaboration.completedAgents || done.length

  return (
    <aside className="workspace-summary-side-panel workspace-subagents-side-panel" aria-label="子智能体">
      <header className="workspace-summary-side-panel-header">
        <span className="workspace-summary-side-panel-title"><Bot aria-hidden="true" /><strong>子智能体</strong></span>
        <span className="workspace-summary-side-panel-status" aria-label={`${activeCount} 个运行中，${doneCount} 个已完成`}>
          {activeCount > 0 ? `${activeCount} 个运行中` : '无运行中'} · {doneCount} 完成
        </span>
        {onClose && <button type="button" className="workspace-summary-side-panel-close" aria-label="关闭子智能体" onClick={onClose}><X /></button>}
      </header>

      {snapshot.updating && active.length === 0 && (
        <div className="workspace-summary-side-panel-live" role="status">
          <LoaderCircle className="workspace-summary-panel-spin" />
          <span>正在载入子智能体…</span>
        </div>
      )}

      <div className="workspace-summary-side-panel-scroll">
        <AgentSection id="workspace-subagents-active" label="Active" entries={active} previewCharacters={previewCharacters} onSelectAgent={onSelectAgent} />
        <AgentSection id="workspace-subagents-done" label="Done" entries={done} previewCharacters={previewCharacters} onSelectAgent={onSelectAgent} />
      </div>
    </aside>
  )
}

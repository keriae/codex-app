import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import type { ToolItem } from './protocol'
import { subagentActivityEntries, subagentActivityLabel, subagentAvatarIndex, subagentDisplayName, subagentGroupEntries, subagentGroupStatus } from './subagentActivityModel'
import { ActivityTooltip } from './ActivityTooltip'
import './subagentActivity.css'

export interface SubagentActivityContextValue {
  onOpen(threadId: string, name: string): void
  parentModel?: string | null
  names?: Map<string, string>
}

export const SubagentActivityContext = createContext<SubagentActivityContextValue | null>(null)

export function SubagentAvatar({ seed }: { seed: string }): ReactNode {
  const index = subagentAvatarIndex(seed)
  const style = {
    '--subagent-avatar-hue': String((index * 47 + 205) % 360),
    '--subagent-avatar-turn': `${(index % 8) * 45}deg`
  } as CSSProperties
  return (
    <span className="subagent-activity-avatar" data-avatar-index={index} style={style} aria-hidden="true">
      <span className="subagent-avatar-mark" />
    </span>
  )
}

export function SubagentActivity({ item, names, onOpen }: {
  item: ToolItem
  names?: Map<string, string>
  onOpen?(threadId: string, name: string): void
}): ReactNode {
  const context = useContext(SubagentActivityContext)
  const open = onOpen || context?.onOpen
  if (item.type === 'subAgentActivity' && item.kind === 'interacted') {
    const name = typeof item.agentPath === 'string' ? subagentDisplayName(item.agentPath) : null
    return <div className="activity-item static"><MessageSquare /><span>{name ? `已向 ${name} 发送消息` : '已向父代理发送消息'}</span></div>
  }
  const entries = subagentActivityEntries(item, names || context?.names)
  if (!entries.length) return null
  return (
    <div className="subagent-activity-list">
      {entries.map((entry) => (
        <button type="button" key={entry.threadId} className="subagent-activity-row" data-status={entry.status}
          aria-label={`打开子智能体 ${entry.name}`} data-testid="subagent-activity-row"
          onClick={() => open?.(entry.threadId, entry.name)} disabled={!open}>
          <SubagentAvatar seed={entry.threadId} />
          <span className="subagent-activity-copy"><span>{entry.name}</span><span> {subagentActivityLabel(entry.status)}</span></span>
        </button>
      ))}
    </div>
  )
}

/** wk/Tk in sites-end-resource: up to four avatars, names for three agents, then overflow. */
export function SubagentActivityGroup({ items, names, onOpen }: { items: ToolItem[]; names?: Map<string, string>; onOpen?(threadId: string, name: string): void }): ReactNode {
  const context = useContext(SubagentActivityContext)
  const open = onOpen || context?.onOpen
  const [overflowOpen, setOverflowOpen] = useState(false)
  const entries = subagentGroupEntries(items, names || context?.names)
  if (!entries.length) return null
  const namedCount = entries.length > 3 ? 2 : entries.length
  const status = subagentGroupStatus(entries)
  const statusLabel = status === 'updated' ? '有了更新' : status === 'interrupted' ? '被中断' : status === 'completed' ? '已完成' : status === 'failed' ? '完成时出现错误' : '开始工作'
  const nameNode = (index: number): ReactNode => {
    const entry = entries[index]
    return open ? <button type="button" className="subagent-inline-name" aria-label={`打开子智能体 ${entry.name}`} onClick={() => open(entry.threadId, entry.name)}>{entry.name}</button> : entry.name
  }
  return <div className="subagent-inline-activity" data-testid="subagent-activity-inline-group" data-status={status}>
    <span className="subagent-inline-avatars">{entries.slice(0, 4).map((entry, index) => index < namedCount || !open ? <SubagentAvatar seed={entry.threadId} key={entry.threadId} />
      : <ActivityTooltip content={entry.name} key={entry.threadId}><button type="button" className="subagent-inline-avatar-button" aria-label={`打开子智能体 ${entry.name}`} onClick={() => open(entry.threadId, entry.name)}><SubagentAvatar seed={entry.threadId} /></button></ActivityTooltip>)}</span>
    <span className="subagent-inline-summary">{nameNode(0)}{entries.length === 2 && <>和{nameNode(1)}</>}{entries.length === 3 && <>、{nameNode(1)}和{nameNode(2)}</>}
      {entries.length > 3 && <>、{nameNode(1)}和<button type="button" className="subagent-inline-name" aria-expanded={overflowOpen} onClick={() => setOverflowOpen((value) => !value)}>另外{entries.length - 2}个子智能体</button></>}{statusLabel}
      {overflowOpen && <span className="subagent-inline-overflow">{entries.slice(2).map((entry, index) => <span key={entry.threadId}>{nameNode(index + 2)}</span>)}</span>}
    </span>
  </div>
}

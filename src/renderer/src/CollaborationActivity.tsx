import { Bot, ChevronRight } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ToolItem } from './protocol'
import { CadencedShimmer } from './CadencedShimmer'
import { collaborationHeader, collaborationModelLabel, collaborationRows, type CollaborationAgent } from './collaborationActivityModel'
import './collaborationActivity.css'
import { SubagentActivityContext } from './SubagentActivity'
import { ActivityTooltip } from './ActivityTooltip'

function PromptPreview({ prompt }: { prompt: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => setOverflowing(element.scrollWidth > element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [prompt])
  return <span ref={ref} className="collaboration-prompt-preview"><ActivityTooltip content={overflowing ? prompt : undefined} multiline>{prompt}</ActivityTooltip></span>
}

function AgentName({ agent, onOpen }: { agent: CollaborationAgent; onOpen?(threadId: string, name: string): void }): ReactNode {
  const title = agent.model ? `使用 ${collaborationModelLabel(agent.model)}` : undefined
  return (
    <span className="collaboration-agent">
      <ActivityTooltip content={title}>{onOpen ? <button type="button" className="collaboration-agent-name" aria-label={`打开子智能体 ${agent.name}`} onClick={() => onOpen(agent.threadId, agent.name)}>{agent.name}</button>
        : <span className="collaboration-agent-name">{agent.name}</span>}</ActivityTooltip>
      {agent.role && <span> ({agent.role})</span>}
    </span>
  )
}

export function CollaborationActivity({ items, parentModel, names, onOpen }: {
  items: ToolItem[]
  parentModel?: string | null
  names?: Map<string, string>
  onOpen?(threadId: string, name: string): void
}): ReactNode {
  const context = useContext(SubagentActivityContext)
  const open = onOpen || context?.onOpen
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(0)
  const header = collaborationHeader(items)
  const rows = collaborationRows(items, parentModel || context?.parentModel, names || context?.names)
  useEffect(() => {
    const body = bodyRef.current
    if (!body || !expanded) return
    const update = (): void => setBodyHeight(body.scrollHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(body)
    return () => observer.disconnect()
  }, [expanded, items, parentModel, names])
  if (!header) return null
  return (
    <div className="collaboration-activity" data-status={header.status}>
      <button type="button" className="collaboration-activity-heading" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)}>
        <span className="collaboration-activity-icon" aria-hidden="true"><Bot /></span>
        <span className="collaboration-header-copy"><CadencedShimmer active={header.status === 'inProgress'} className="collaboration-header-action">{header.action}</CadencedShimmer>{header.countLabel}</span>
        <ChevronRight className={`collaboration-disclosure${expanded ? ' is-expanded' : ''}`} />
      </button>
      <div className={`collaboration-activity-body${expanded ? ' is-expanded' : ''}`} id={contentId} aria-hidden={!expanded} inert={!expanded}
        style={{ height: expanded ? bodyHeight : 0, opacity: expanded ? 1 : 0, visibility: expanded ? 'visible' : 'hidden' }}>
        <div ref={bodyRef} className="collaboration-activity-rows" data-testid="multi-agent-action-rows">
          {rows.map((row) => (
            <div key={row.key} className={`collaboration-activity-row is-${row.kind}`}>
              {row.kind === 'spawn' ? <><span>已使用以下指令创建 </span>{row.agent && <AgentName agent={row.agent} onOpen={open} />}<span>：</span><PromptPreview prompt={row.prompt || ''} /></>
                : row.kind === 'message' ? <><span>{row.action} </span>{row.agent && <AgentName agent={row.agent} onOpen={open} />}<span>：</span><PromptPreview prompt={row.prompt || ''} /></>
                  : row.kind === 'prompt' ? <>{row.action}<span className="collaboration-prompt-detail">{row.prompt}</span></>
                    : <>{row.action}{row.agent && <> <AgentName agent={row.agent} onOpen={open} />{row.stateSuffix}</>}</>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

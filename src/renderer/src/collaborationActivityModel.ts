import type { ThreadItem, ToolItem } from './protocol'

export type CollaborationAction =
  | 'spawnAgent' | 'sendInput' | 'sendMessage' | 'followupTask'
  | 'interruptAgent' | 'listAgents' | 'resumeAgent' | 'closeAgent'
export type CollaborationStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted'

export interface CollaborationAgent {
  threadId: string
  name: string
  role: string | null
  model: string | null
}

export interface CollaborationRow {
  key: string
  kind: 'agent' | 'spawn' | 'message' | 'generic' | 'prompt'
  action: string
  agent?: CollaborationAgent
  prompt?: string
  stateSuffix?: string
}

interface ActionItem {
  id: string
  action: CollaborationAction
  status: CollaborationStatus
  receiverIds: string[]
  spawnReceiverIds: string[]
  threads: Map<string, Record<string, unknown>>
  states: Record<string, unknown>
  prompt: string | null
  model: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const actionAliases: Record<string, CollaborationAction> = {
  spawnAgent: 'spawnAgent', spawn_agent: 'spawnAgent',
  sendInput: 'sendInput', send_input: 'sendInput',
  sendMessage: 'sendMessage', send_message: 'sendMessage',
  followupTask: 'followupTask', followup_task: 'followupTask',
  interruptAgent: 'interruptAgent', interrupt_agent: 'interruptAgent',
  listAgents: 'listAgents', list_agents: 'listAgents',
  resumeAgent: 'resumeAgent', resume_agent: 'resumeAgent',
  closeAgent: 'closeAgent', close_agent: 'closeAgent'
}

const labels: Record<CollaborationAction, Record<CollaborationStatus, string>> = {
  spawnAgent: { inProgress: '创建中', completed: '已创建', failed: '创建失败', interrupted: '已中断' },
  sendInput: { inProgress: '正在发送消息', completed: '已发送消息', failed: '无法发送消息', interrupted: '已中断' },
  sendMessage: { inProgress: '正在发送消息', completed: '已发送消息', failed: '无法发送消息', interrupted: '已中断' },
  followupTask: { inProgress: '正在发送消息', completed: '已发送消息', failed: '无法发送消息', interrupted: '已中断' },
  interruptAgent: { inProgress: '正在中断', completed: '已中断', failed: '中断未成功', interrupted: '已中断' },
  // These are the installed zh-CN translations, including the unusual list wording.
  listAgents: { inProgress: '房源', completed: '挂牌', failed: '列出未成功', interrupted: '已中断' },
  resumeAgent: { inProgress: '正在恢复', completed: '已恢复', failed: '无法恢复', interrupted: '已中断' },
  closeAgent: { inProgress: '正在关闭', completed: '已关闭', failed: '无法关闭', interrupted: '已中断' }
}

const stateLabels: Record<string, string> = {
  pendingInit: '待定初始化', running: '正在运行', interrupted: '已中断',
  shutdown: '关闭', completed: '已完成', errored: '出错', notFound: '找不到'
}

function status(value: unknown): CollaborationStatus {
  return value === 'inProgress' || value === 'failed' || value === 'interrupted' ? value : 'completed'
}

function sourceAgent(thread: Record<string, unknown> | null): Record<string, unknown> | null {
  const source = record(thread?.source)
  return record(record(source?.subAgent)?.thread_spawn)
}

function normalizeItem(item: ToolItem): ActionItem | null {
  if (item.type !== 'collabAgentToolCall') return null
  const action = actionAliases[text(item.action) || text(item.tool) || '']
  // The installed item conversion hides wait calls entirely.
  if (!action) return null
  const states = record(item.agentsStates) || {}
  const receiverIds = new Set(Object.keys(states))
  const spawnReceiverIds = new Set<string>()
  const threads = new Map<string, Record<string, unknown>>()
  for (const value of Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []) {
    const id = text(value)
    if (id) { receiverIds.add(id); spawnReceiverIds.add(id) }
  }
  for (const value of Array.isArray(item.receiverThreads) ? item.receiverThreads : []) {
    const receiver = record(value)
    const id = text(receiver?.threadId) || text(receiver?.id)
    if (!id || !receiver) continue
    receiverIds.add(id)
    spawnReceiverIds.add(id)
    threads.set(id, record(receiver.thread) || receiver)
  }
  return {
    id: item.id, action, status: status(item.status), receiverIds: [...receiverIds].sort(), spawnReceiverIds: [...spawnReceiverIds], threads, states,
    prompt: typeof item.prompt === 'string' ? item.prompt : null,
    model: typeof item.model === 'string' && item.model.trim() ? item.model : null
  }
}

function actionItems(items: ToolItem[]): ActionItem[] {
  return items.flatMap((item) => {
    const normalized = normalizeItem(item)
    return normalized ? [normalized] : []
  })
}

/** Current native renderer uses standalone multi-agent actions, each with items:[item]. */
export function collaborationActivityGroups(items: ThreadItem[]): ToolItem[][] {
  return items.flatMap((item) => item.type === 'collabAgentToolCall' && normalizeItem(item) ? [[item]] : [])
}

export function collaborationActionLabel(action: CollaborationAction, state: CollaborationStatus): string {
  return labels[action][state]
}

export function collaborationHeader(items: ToolItem[]): { action: string; countLabel: string; label: string; status: CollaborationStatus } | null {
  const actions = actionItems(items)
  if (!actions.length) return null
  // uT: running beats failed, which beats interrupted, which beats completed.
  const state = actions.some((item) => item.status === 'inProgress') ? 'inProgress'
    : actions.some((item) => item.status === 'failed') ? 'failed'
      : actions.some((item) => item.status === 'interrupted') ? 'interrupted' : 'completed'
  const ids = new Set(actions.flatMap((item) => item.receiverIds))
  const count = ids.size || actions.length
  const action = labels[actions[0].action][state]
  const countLabel = count > 0 ? `${count} 个智能体` : ''
  return { action, countLabel, label: action + countLabel, status: state }
}

/** Spo in app-initial: the same model spelling used by the native "Uses …" tooltip. */
export function collaborationModelLabel(model: string): string {
  if (!model.trimStart().toLowerCase().startsWith('gpt')) return model
  const separator = /^gpt-\d/iu.test(model.trimStart()) ? ' ' : '-'
  return model.split(/(\s+)/).map((part) => !part.trim() ? part : part.split('-').map((word, index) =>
    word.toLowerCase() === 'gpt' ? 'GPT' : word.toLowerCase() === 'oai' ? 'OAI'
      : index > 0 && word ? word[0].toUpperCase() + word.slice(1) : word
  ).join(separator).replace(/^GPT (?=\d)/u, 'GPT-')).join('')
}

export function collaborationRows(items: ToolItem[], parentModel?: string | null, names: Map<string, string> = new Map()): CollaborationRow[] {
  const actions = actionItems(items)
  const models = new Map<string, string>()
  for (const item of actions) {
    const model = item.model || (parentModel?.trim() ? parentModel : null)
    if (item.action === 'spawnAgent' && model) for (const id of item.spawnReceiverIds) models.set(id, model)
  }
  const rows: CollaborationRow[] = []
  for (const item of actions) {
    const agents = item.receiverIds.flatMap((threadId) => {
      const thread = item.threads.get(threadId) || null
      const state = record(item.states[threadId])
      const source = sourceAgent(thread)
      // R4t/mT: nickname or source nickname, with a leading @ removed.
      const nickname = text(thread?.agentNickname) || text(source?.agent_nickname)
        || text(names.get(threadId)) || text(state?.agentNickname)
      const name = nickname?.startsWith('@') ? nickname.slice(1) : nickname
      if (!name) return []
      const role = text(thread?.agentRole ?? source?.agent_role)
      return [{ threadId, name, role: role && role !== 'default' ? role : null, model: models.get(threadId) || null }]
    })
    const hasPrompt = item.prompt != null && !!item.prompt.trim()
    const spawn = item.action === 'spawnAgent' && item.status === 'completed' && hasPrompt
    const message = ['sendInput', 'sendMessage', 'followupTask'].includes(item.action) && hasPrompt
    const action = labels[item.action][item.status]
    if (!agents.length) rows.push({ key: `row-generic-${item.id}`, kind: 'generic', action })
    for (const agent of agents) {
      const state = record(item.states[agent.threadId])
      const stateLabel = stateLabels[text(state?.status) || '']
      const stateSuffix = !['closeAgent', 'resumeAgent'].includes(item.action) && stateLabel
        ? ` (${stateLabel}${text(state?.message) ? `: ${state?.message}` : ''})` : ''
      rows.push({
        key: `row-${item.id}-${agent.threadId}`, kind: spawn ? 'spawn' : message ? 'message' : 'agent', action, agent,
        prompt: spawn || message ? item.prompt || '' : undefined, stateSuffix
      })
    }
    // sT: prompts for other actions are separate wrapping metadata rows.
    if (!spawn && !message && hasPrompt) rows.push({ key: `meta-prompt-${item.id}`, kind: 'prompt', action: '输入：', prompt: item.prompt || '' })
  }
  return rows
}

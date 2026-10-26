import type { ThreadItem, ToolItem } from './protocol'
import type { ThreadSession } from './state/sessionReducer'
import {
  subagentActivityEntries,
  subagentActivityLabel,
  subagentNames,
  type SubagentActivityEntry
} from './subagentActivityModel'
import type {
  WorkspacePaneSnapshot,
  WorkspaceSourceEntry,
  WorkspaceSourceKind
} from './workspacePaneModel'

export interface WorkspacePanelSourceEntry {
  id: string
  turnId: string
  kind: WorkspaceSourceKind
  title: string
  metadata: string
  purpose: string
  path?: string
  url?: string
}

export interface WorkspacePanelSubagentEntry {
  threadId: string
  turnId: string
  name: string
  status: SubagentActivityEntry['status']
  statusLabel: string
  preview?: string
  model?: string
  selectable: boolean
}

export interface WorkspaceSummaryPanelsModel {
  sources: WorkspacePanelSourceEntry[]
  subagents: WorkspacePanelSubagentEntry[]
}

interface MutableSource {
  entry: Omit<WorkspacePanelSourceEntry, 'purpose'>
  ids: Set<string>
  purposes: Set<string>
  order: number
}

interface WebCandidate {
  url: string
  title?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizedPreview(value: unknown): string | null {
  const result = text(value)
  return result ? result.replace(/\s+/g, ' ') : null
}

function fileName(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || path
}

function fileMetadata(kind: WorkspaceSourceKind, path: string): string {
  const extension = fileName(path).split('.').at(-1)
  if (kind === 'image') return extension && extension !== fileName(path)
    ? `图片 · ${extension.toUpperCase()}`
    : '图片'
  return extension && extension !== fileName(path)
    ? `文件 · ${extension.toUpperCase()}`
    : '文件'
}

function urlMetadata(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.hostname}${path}`
  } catch {
    return url
  }
}

function urlTitle(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  } catch {
    return url
  }
}

function webCandidates(value: unknown, output: WebCandidate[], depth = 0): void {
  if (depth > 4 || output.length >= 16) return
  if (Array.isArray(value)) {
    for (const item of value) webCandidates(item, output, depth + 1)
    return
  }
  const item = record(value)
  if (!item) return
  const url = text(item.url) || text(item.uri) || text(item.href)
  if (url && !output.some((candidate) => candidate.url === url)) {
    output.push({ url, title: text(item.title) || text(item.name) || undefined })
  }
  for (const key of ['sources', 'results', 'items', 'links', 'citations', 'content', 'structuredContent']) {
    if (key in item) webCandidates(item[key], output, depth + 1)
  }
}

function sourceFallback(source: WorkspaceSourceEntry): WorkspacePanelSourceEntry {
  return {
    id: source.id,
    turnId: source.turnId,
    kind: source.kind,
    title: source.label,
    metadata: source.kind === 'web' ? 'Web 搜索' : source.kind === 'image' ? '图片' : '文件',
    purpose: source.kind === 'web' ? '用于检索网页' : '用于当前对话'
  }
}

export function workspacePanelSourcesFromSnapshot(
  snapshot: WorkspacePaneSnapshot
): WorkspacePanelSourceEntry[] {
  return snapshot.sources.map(sourceFallback)
}

function fallbackSubagents(snapshot: WorkspacePaneSnapshot): WorkspacePanelSubagentEntry[] {
  const entries: WorkspacePanelSubagentEntry[] = []
  if (snapshot.collaboration.activeAgents > 0) {
    entries.push({
      threadId: '__workspace-active-agents__',
      turnId: '',
      name: '正在工作的子智能体',
      status: 'active',
      statusLabel: '正在工作',
      preview: `${snapshot.collaboration.activeAgents} 个运行中`,
      selectable: false
    })
  }
  if (snapshot.collaboration.completedAgents > 0) {
    entries.push({
      threadId: '__workspace-completed-agents__',
      turnId: '',
      name: '已完成的子智能体',
      status: 'completed',
      statusLabel: '已完成',
      preview: `${snapshot.collaboration.completedAgents} 完成`,
      selectable: false
    })
  }
  return entries
}

export function workspacePanelSubagentsFromSnapshot(
  snapshot: WorkspacePaneSnapshot
): WorkspacePanelSubagentEntry[] {
  return fallbackSubagents(snapshot)
}

function addSource(
  sources: Map<string, MutableSource>,
  input: Omit<WorkspacePanelSourceEntry, 'purpose'> & { purpose: string },
  order: number
): void {
  const identity = input.path || input.url || input.title
  const key = `${input.kind}:${identity}`
  const existing = sources.get(key)
  if (existing) {
    existing.ids.add(input.id)
    existing.purposes.add(input.purpose)
    if (!existing.entry.path && input.path) existing.entry.path = input.path
    if (!existing.entry.url && input.url) existing.entry.url = input.url
    if (input.title.length > existing.entry.title.length) existing.entry.title = input.title
    return
  }
  const { purpose, ...entry } = input
  sources.set(key, { entry, ids: new Set([input.id]), purposes: new Set([purpose]), order })
}

function sourceEntries(
  session: ThreadSession | undefined,
  snapshot: WorkspacePaneSnapshot
): WorkspacePanelSourceEntry[] {
  if (!session) return workspacePanelSourcesFromSnapshot(snapshot)
  const sources = new Map<string, MutableSource>()
  let order = 0

  for (const turn of session.turns) {
    for (const item of turn.items) {
      order += 1
      if (item.type === 'userMessage') {
        for (const content of item.content || []) {
          const input = record(content)
          const path = text(input?.path)
          if (!path || (input?.type !== 'localImage' && input?.type !== 'mention')) continue
          const kind: WorkspaceSourceKind = input.type === 'localImage' ? 'image' : 'attachment'
          addSource(sources, {
            id: `${turn.id}:${item.id}:${kind}:${path}`,
            turnId: turn.id,
            kind,
            title: text(input.name) || fileName(path),
            metadata: fileMetadata(kind, path),
            purpose: kind === 'image' ? '附加到用户消息' : '在用户消息中提及',
            path
          }, order)
        }
        continue
      }

      if (item.type === 'imageView') {
        const path = text(item.path)
        if (path) addSource(sources, {
          id: `${turn.id}:${item.id}:image:${path}`,
          turnId: turn.id,
          kind: 'image',
          title: fileName(path),
          metadata: fileMetadata('image', path),
          purpose: '由 Codex 查看',
          path
        }, order)
        continue
      }

      if (item.type === 'imageGeneration') {
        const path = text(item.savedPath)
        if (path) addSource(sources, {
          id: `${turn.id}:${item.id}:generated:${path}`,
          turnId: turn.id,
          kind: 'image',
          title: fileName(path),
          metadata: `生成图片 · ${text(item.status) || '未知状态'}`,
          purpose: '由 Codex 生成',
          path
        }, order)
        continue
      }

      if (item.type !== 'webSearch') continue
      const query = text(item.query) || 'Web 搜索'
      const candidates: WebCandidate[] = []
      webCandidates(item.action, candidates)
      webCandidates(item.sources, candidates)
      webCandidates(item.results, candidates)
      webCandidates(item.contentItems, candidates)
      webCandidates(item.result, candidates)
      if (!candidates.length) {
        addSource(sources, {
          id: `${turn.id}:${item.id}:web`,
          turnId: turn.id,
          kind: 'web',
          title: query,
          metadata: 'Web 搜索',
          purpose: '用于检索网页'
        }, order)
      } else {
        for (const candidate of candidates) addSource(sources, {
          id: `${turn.id}:${item.id}:web:${candidate.url}`,
          turnId: turn.id,
          kind: 'web',
          title: candidate.title || urlTitle(candidate.url),
          metadata: urlMetadata(candidate.url),
          purpose: query === 'Web 搜索' ? '搜索结果' : `搜索结果 · ${query}`,
          url: candidate.url
        }, order)
      }
    }
  }

  const values = [...sources.values()]
  for (const source of snapshot.sources) {
    const duplicate = values.some(({ entry, ids }) => (
      ids.has(source.id)
      || (source.kind === 'web'
        && entry.kind === 'web'
        && [...ids].some((id) => id.startsWith(`${source.id}:`)))
      || (entry.kind === source.kind && entry.title === source.label)
    ))
    if (!duplicate) {
      const fallback = sourceFallback(source)
      values.push({
        entry: {
          id: fallback.id,
          turnId: fallback.turnId,
          kind: fallback.kind,
          title: fallback.title,
          metadata: fallback.metadata
        },
        ids: new Set([fallback.id]),
        purposes: new Set([fallback.purpose]),
        order: ++order
      })
    }
  }

  return values
    .sort((left, right) => left.order - right.order)
    .map(({ entry, purposes }) => ({ ...entry, purpose: [...purposes].join(' · ') }))
}

function matchingReceiver(item: ToolItem, threadId: string): Record<string, unknown> | null {
  for (const value of Array.isArray(item.receiverThreads) ? item.receiverThreads : []) {
    const receiver = record(value)
    const thread = record(receiver?.thread) || receiver
    if (text(receiver?.threadId) === threadId || text(thread?.id) === threadId) return thread
  }
  return null
}

function subagentDetails(item: ToolItem, threadId: string): { preview?: string; model?: string } {
  const state = record(record(item.agentsStates)?.[threadId])
  const receiver = matchingReceiver(item, threadId)
  const preview = [
    state?.lastAgentMessage,
    state?.lastMessage,
    state?.summary,
    state?.message,
    state?.task,
    receiver?.preview,
    receiver?.summary,
    receiver?.task,
    receiver?.prompt,
    item.preview,
    item.summary,
    item.message,
    item.task,
    item.prompt
  ].map(normalizedPreview).find(Boolean)
  const model = text(state?.model) || text(receiver?.model) || text(item.model) || undefined
  return { preview: preview || undefined, model }
}

function subagentEntries(
  session: ThreadSession | undefined,
  snapshot: WorkspacePaneSnapshot
): WorkspacePanelSubagentEntry[] {
  if (!session) return fallbackSubagents(snapshot)
  const allItems: ThreadItem[] = session.turns.flatMap((turn) => turn.items)
  const names = subagentNames(allItems)
  const entries = new Map<string, WorkspacePanelSubagentEntry & { order: number }>()
  let order = 0

  for (const turn of session.turns) {
    for (const item of turn.items) {
      if (item.type !== 'subAgentActivity' && item.type !== 'collabAgentToolCall') continue
      order += 1
      for (const entry of subagentActivityEntries(item, names)) {
        const details = subagentDetails(item, entry.threadId)
        const previous = entries.get(entry.threadId)
        entries.set(entry.threadId, {
          threadId: entry.threadId,
          turnId: turn.id,
          name: entry.name,
          status: entry.status,
          statusLabel: subagentActivityLabel(entry.status),
          preview: details.preview || previous?.preview,
          model: details.model || previous?.model,
          selectable: true,
          order
        })
      }
    }
  }

  if (!entries.size) return fallbackSubagents(snapshot)
  return [...entries.values()]
    .sort((left, right) => right.order - left.order)
    .map(({ order: _order, ...entry }) => entry)
}

export function collectWorkspaceSummaryPanelsModel(
  session: ThreadSession | undefined,
  snapshot: WorkspacePaneSnapshot
): WorkspaceSummaryPanelsModel {
  return {
    sources: sourceEntries(session, snapshot),
    subagents: subagentEntries(session, snapshot)
  }
}

export function workspacePanelSubagentIsDone(entry: WorkspacePanelSubagentEntry): boolean {
  return entry.status === 'completed' || entry.status === 'interrupted' || entry.status === 'failed'
}

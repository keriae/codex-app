import type {
  CommandItem,
  FileChangeItem,
  FileUpdateChange,
  ThreadItem
} from './protocol'
import type { ThreadSession } from './state/sessionReducer'
import { resolveWorkspaceFileLink } from './workspaceFileLinks'
import { parseUnifiedDiff } from './unifiedDiff'

export type WorkspacePaneTab = 'changes' | 'output'
export type WorkspacePaneSurface = 'files' | 'sources' | 'subagents' | WorkspacePaneTab
export type WorkspacePaneCloseAction =
  | 'close-summary'
  | 'close-change'
  | 'close-source-image'
  | 'close-document'
  | 'collapse'
export type WorkspaceChangeKind = 'added' | 'deleted' | 'modified' | 'moved'
export type WorkspaceSourceKind = 'attachment' | 'image' | 'web'
export type WorkspaceSummaryKind = 'changes' | 'collaboration' | 'sources' | 'output'

export interface WorkspaceChangeEntry {
  id: string
  itemId?: string
  turnId: string
  path: string
  sourcePath: string
  diff: string
  kind: WorkspaceChangeKind
  status: FileChangeItem['status']
  additions: number
  deletions: number
}

/** Match a streamed change to its originating tool item, independent of path spelling. */
export function workspaceChangesMatch(cwd: string | null | undefined, left: WorkspaceChangeEntry, right: WorkspaceChangeEntry): boolean {
  if (left.id === right.id) return true
  if (!left.itemId || !right.itemId || left.itemId !== right.itemId) return false
  if (left.turnId && right.turnId && left.turnId !== right.turnId) return false
  const path = (value: string): string | null => cwd ? resolveWorkspaceFileLink(cwd, value) : value
  const leftPath = path(left.path)
  const leftSource = path(left.sourcePath)
  return Boolean(leftPath && leftSource && leftPath === path(right.path) && leftSource === path(right.sourcePath))
}

export interface WorkspaceCommandEntry {
  id: string
  turnId: string
  command: string
  cwd?: string
  status: CommandItem['status']
  output: string
  exitCode?: number | null
}

export interface WorkspaceSourceEntry {
  id: string
  turnId: string
  kind: WorkspaceSourceKind
  label: string
}

export interface WorkspaceCollaborationSummary {
  calls: number
  agents: number
  activeAgents: number
  completedAgents: number
}

export interface WorkspaceSummaryItem {
  kind: WorkspaceSummaryKind
  label: string
  detail: string
}

export interface WorkspacePaneSnapshot {
  changes: WorkspaceChangeEntry[]
  commands: WorkspaceCommandEntry[]
  sources: WorkspaceSourceEntry[]
  collaboration: WorkspaceCollaborationSummary
  updating: boolean
}

/** Resolve Cmd+W/titlebar close against the visible workspace content first. */
export function workspacePaneCloseAction({
  activeTab,
  hasDisplayedChange,
  hasSourceImage,
  hasActiveDocument
}: {
  activeTab: WorkspacePaneSurface
  hasDisplayedChange: boolean
  hasSourceImage: boolean
  hasActiveDocument: boolean
}): WorkspacePaneCloseAction {
  if (activeTab === 'sources' || activeTab === 'subagents') return 'close-summary'
  if (activeTab === 'changes') return hasDisplayedChange ? 'close-change' : 'collapse'
  if (activeTab === 'output') return 'collapse'
  if (hasSourceImage) return 'close-source-image'
  if (hasActiveDocument) return 'close-document'
  return 'collapse'
}

function fileChangeItem(item: ThreadItem): FileChangeItem | null {
  return item.type === 'fileChange' ? (item as FileChangeItem) : null
}

function commandItem(item: ThreadItem): CommandItem | null {
  return item.type === 'commandExecution' ? (item as CommandItem) : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sourceLabel(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || path
}

function presentationFor(change: FileUpdateChange): {
  path: string
  kind: WorkspaceChangeKind
} {
  if (change.kind.type === 'add') return { path: change.path, kind: 'added' }
  if (change.kind.type === 'delete') return { path: change.path, kind: 'deleted' }
  if (change.kind.move_path) return { path: change.kind.move_path, kind: 'moved' }
  return { path: change.path, kind: 'modified' }
}

export function collectWorkspacePaneSnapshot(
  session: ThreadSession | undefined,
  cwd?: string | null
): WorkspacePaneSnapshot {
  if (!session) {
    return {
      changes: [],
      commands: [],
      sources: [],
      collaboration: { calls: 0, agents: 0, activeAgents: 0, completedAgents: 0 },
      updating: false
    }
  }

  const changesByPath = new Map<string, WorkspaceChangeEntry>()
  const commands: WorkspaceCommandEntry[] = []
  const sources = new Map<string, WorkspaceSourceEntry>()
  const agentStates = new Map<string, string>()
  let collaborationCalls = 0
  let updating = session.running

  for (const turn of session.turns) {
    for (const item of turn.items) {
      if (item.type === 'userMessage') {
        for (const content of item.content || []) {
          const input = record(content)
          const path = stringValue(input?.path)
          if (!path || (input?.type !== 'localImage' && input?.type !== 'mention')) continue
          const kind: WorkspaceSourceKind = input.type === 'localImage' ? 'image' : 'attachment'
          sources.set(`${kind}:${path}`, {
            id: `${turn.id}:${item.id}:${kind}:${path}`,
            turnId: turn.id,
            kind,
            label: sourceLabel(path)
          })
        }
      }

      if (item.type === 'imageView') {
        const path = stringValue(item.path)
        if (path) {
          sources.set(`image:${path}`, {
            id: `${turn.id}:${item.id}:image:${path}`,
            turnId: turn.id,
            kind: 'image',
            label: sourceLabel(path)
          })
        }
      }

      if (item.type === 'webSearch') {
        const query = stringValue(item.query)
        if (query) {
          sources.set(`web:${item.id}`, {
            id: `${turn.id}:${item.id}:web`,
            turnId: turn.id,
            kind: 'web',
            label: query
          })
        }
      }

      if (item.type === 'collabAgentToolCall') {
        collaborationCalls += 1
        if (item.status === 'inProgress') updating = true
        const agentsStates = record(item.agentsStates)
        for (const [agentId, value] of Object.entries(agentsStates || {})) {
          const state = record(value)
          agentStates.set(agentId, stringValue(state?.status) || 'unknown')
        }
        if (Array.isArray(item.receiverThreadIds)) {
          for (const value of item.receiverThreadIds) {
            const agentId = stringValue(value)
            if (agentId && !agentStates.has(agentId)) agentStates.set(agentId, 'unknown')
          }
        }
      }

      const fileItem = fileChangeItem(item)
      if (fileItem) {
        if (fileItem.status === 'inProgress') updating = true
        for (const change of fileItem.changes || []) {
          const presentation = presentationFor(change)
          const parsed = parseUnifiedDiff(change.diff || '')
          const path = cwd ? resolveWorkspaceFileLink(cwd, presentation.path) || presentation.path : presentation.path
          const sourcePath = cwd ? resolveWorkspaceFileLink(cwd, change.path) || change.path : change.path
          changesByPath.set(path, {
            id: `${turn.id}:${fileItem.id}:${path}`,
            itemId: fileItem.id,
            turnId: turn.id,
            path,
            sourcePath,
            diff: change.diff || '',
            kind: presentation.kind,
            status: fileItem.status,
            additions: parsed.additions,
            deletions: parsed.deletions
          })
        }
        continue
      }

      const command = commandItem(item)
      if (!command) continue
      if (command.status === 'inProgress') updating = true
      commands.push({
        id: `${turn.id}:${command.id}`,
        turnId: turn.id,
        command: command.command || '',
        cwd: command.cwd,
        status: command.status,
        output: command.aggregatedOutput || '',
        exitCode: command.exitCode
      })
    }
  }

  const statuses = [...agentStates.values()]
  return {
    changes: [...changesByPath.values()],
    commands,
    sources: [...sources.values()],
    collaboration: {
      calls: collaborationCalls,
      agents: agentStates.size,
      activeAgents: statuses.filter((status) => status === 'pendingInit' || status === 'running').length,
      completedAgents: statuses.filter((status) => status === 'completed' || status === 'shutdown').length
    },
    updating
  }
}

export function workspacePaneSummaryItems(
  snapshot: WorkspacePaneSnapshot
): WorkspaceSummaryItem[] {
  const additions = snapshot.changes.reduce((total, change) => total + change.additions, 0)
  const deletions = snapshot.changes.reduce((total, change) => total + change.deletions, 0)
  const items: WorkspaceSummaryItem[] = []

  if (snapshot.changes.length > 0) {
    items.push({
      kind: 'changes',
      label: '变更',
      detail: `${snapshot.changes.length} 个文件 · +${additions} −${deletions}`
    })
  }
  if (snapshot.collaboration.calls > 0) {
    const statuses = [
      snapshot.collaboration.activeAgents > 0
        ? `${snapshot.collaboration.activeAgents} 个运行中`
        : '',
      snapshot.collaboration.completedAgents > 0
        ? `${snapshot.collaboration.completedAgents} 完成`
        : ''
    ].filter(Boolean)
    const detail = statuses.length > 0
      ? statuses.join(' · ')
      : snapshot.collaboration.agents > 0
        ? `${snapshot.collaboration.agents} 个智能体`
        : `${snapshot.collaboration.calls} 项协作`
    items.push({ kind: 'collaboration', label: '子智能体', detail })
  }
  if (snapshot.sources.length > 0) {
    const firstSource = snapshot.sources[0].label
    const detail = snapshot.sources.length === 1
      ? firstSource
      : `${firstSource} 等 ${snapshot.sources.length} 项`
    items.push({ kind: 'sources', label: '来源', detail })
  }
  if (snapshot.commands.length > 0) {
    items.push({ kind: 'output', label: '输出', detail: `${snapshot.commands.length} 条命令` })
  }

  return items
}

export function workspacePaneSummary(
  snapshot: WorkspacePaneSnapshot,
  loading = false
): string {
  const items = workspacePaneSummaryItems(snapshot)
  if (items.length === 0) {
    return loading || snapshot.updating ? '正在收集工作区活动…' : '创建文件或站点'
  }
  return items.map((item) => `${item.label} ${item.detail}`).join(' · ')
}

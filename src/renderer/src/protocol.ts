export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'

export type ApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent'

export interface TextInput {
  type: 'text'
  text: string
  text_elements: unknown[]
}

export interface LocalImageInput {
  type: 'localImage'
  path: string
  detail?: 'auto' | 'low' | 'high' | 'original'
}

export interface MentionInput {
  type: 'mention'
  name: string
  path: string
}

export type UserInput = TextInput | LocalImageInput | MentionInput

export interface UserMessageItem {
  type: 'userMessage'
  id: string
  clientId?: string | null
  content: Array<UserInput | Record<string, unknown>>
}

export interface AgentMessageItem {
  type: 'agentMessage'
  id: string
  text: string
  phase?: string | null
}

export interface ReasoningItem {
  type: 'reasoning'
  id: string
  summary: string[]
  content: string[]
}

export interface PlanItem {
  type: 'plan'
  id: string
  text: string
}

export type CommandAction =
  | {
      type: 'read'
      command: string
      name: string
      path: string
    }
  | {
      type: 'listFiles'
      command: string
      path?: string | null
    }
  | {
      type: 'search'
      command: string
      query?: string | null
      path?: string | null
    }
  | {
      type: 'unknown'
      command: string
    }

export interface CommandItem {
  type: 'commandExecution'
  id: string
  command: string
  commandActions?: CommandAction[]
  cwd?: string
  status?: 'inProgress' | 'completed' | 'failed' | 'declined'
  executionStatus?: string
  aggregatedOutput?: string | null
  exitCode?: number | null
  durationMs?: number | null
}

export interface FileUpdateChange {
  path: string
  kind:
    | { type: 'add' }
    | { type: 'delete' }
    | { type: 'update'; move_path: string | null }
  diff: string
  [key: string]: unknown
}

export interface FileChangeItem {
  type: 'fileChange'
  id: string
  status?: 'inProgress' | 'completed' | 'failed' | 'declined'
  changes?: FileUpdateChange[]
}

export interface ImageViewItem {
  type: 'imageView'
  id: string
  path: string
}

export interface ImageGenerationItem {
  type: 'imageGeneration'
  id: string
  status: string
  revisedPrompt?: string | null
  result?: string | null
  transparentBackground?: boolean
  failure?: { message?: string; [key: string]: unknown } | null
  savedPath?: string | null
}

export interface ToolItem {
  type:
    | 'hookPrompt'
    | 'mcpToolCall'
    | 'dynamicToolCall'
    | 'collabAgentToolCall'
    | 'subAgentActivity'
    | 'webSearch'
    | 'contextCompaction'
    | 'enteredReviewMode'
    | 'exitedReviewMode'
    | 'error'
    | 'unknown'
  id: string
  status?: string
  tool?: string
  server?: string
  namespace?: string | null
  arguments?: unknown
  result?: {
    content?: unknown[]
    structuredContent?: unknown
    isError?: boolean
    _meta?: Record<string, unknown> | null
    [key: string]: unknown
  } | null
  error?: { message?: string; [key: string]: unknown } | null
  success?: boolean | null
  contentItems?: unknown[] | null
  durationMs?: number | null
  progress?: Array<{ message: string; [key: string]: unknown }>
  [key: string]: unknown
}

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | PlanItem
  | CommandItem
  | FileChangeItem
  | ImageViewItem
  | ImageGenerationItem
  | ToolItem

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'

export interface TurnError {
  message: string
  codexErrorInfo?: unknown
  additionalDetails?: string | null
  misalignment?: unknown
  [key: string]: unknown
}

export interface Turn {
  id: string
  rootTurnId?: string | null
  items: ThreadItem[]
  status: TurnStatus
  error?: TurnError | null
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
  activityCompletedAtMs?: number | null
  itemsView?: unknown
}

export type ThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'systemError' }
  | { type: 'active'; activeFlags: Array<'waitingOnApproval' | 'waitingOnUserInput'> }

export interface Thread {
  id: string
  /** Desktop host that owns the app-server thread; omitted means local. */
  hostId?: string
  sessionId?: string
  forkedFromId?: string | null
  parentThreadId?: string | null
  ephemeral?: boolean
  historyMode?: 'legacy' | 'paginated'
  preview: string
  name?: string | null
  cwd: string
  model?: string | null
  reasoningEffort?: ReasoningEffort | null
  createdAt: number
  updatedAt: number
  recencyAt?: number | null
  projectId?: string | null
  status?: ThreadStatus | null
  turns: Turn[]
}

export interface ProjectRoot {
  path: string
}

export interface Project {
  id: string
  name: string
  roots: ProjectRoot[]
  metadata: Record<string, string>
  position: number
  createdAt: number
  updatedAt: number
  recencyAt: number | null
}

export interface ModelOption {
  id: string
  model: string
  displayName: string
  description: string
  isDefault: boolean
  defaultReasoningEffort: ReasoningEffort
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort
    description: string
  }>
}

export interface PermissionProfile {
  id: string
  description: string | null
  allowed: boolean
}

export interface Page<T> {
  data: T[]
  nextCursor?: string | null
  backwardsCursor?: string | null
}

export interface ThreadSearchEntry {
  thread: Thread
  snippet: string
}

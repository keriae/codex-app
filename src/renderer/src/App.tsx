import { copyTextToClipboard } from './clipboard'
import { shouldActivateWorkbenchTerminal, useRightWorkbenchSessions } from './rightWorkbenchSessions'
import { hasVisibleFinalAnswer, turnWorkDuration } from './turnTiming'
import {
  Archive,
  ArrowDown,
  Atom,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  CirclePlus,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  GitFork,
  GitCompareArrows,
  Globe2,
  Image as ImageIcon,
  LoaderCircle,
  Link2,
  ListFilter,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  PanelsTopLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  TerminalSquare,
  Wrench,
  X
} from 'lucide-react'
import {
  Children,
  createContext,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkWorkspaceFileCitations } from './remarkWorkspaceFileCitations'
import type {
  AppContext,
  BrowserViewEvent,
  WindowCloseRequest,
  OpenThreadRequest,
  WindowCloseOrigin,
  BackendStatus,
  ComposerAttachmentSelection,
  ExternalAgentImportResult,
  RemoteConnection,
  RemoteProject,
  RpcServerRequest,
  RpcServerResponse,
  ScheduledTaskRunRequest
} from '../../shared/api'
import {
  buildTurnInput,
  isDirectoryAttachmentPath,
  mergeComposerAttachments
} from './composerAttachments'
import {
  completedActivityStatusLabel,
  liveActivityStatusLabel,
  workedForActivityStatusLabel,
  type WorkedForActivityItem
} from './activityStatus'
import { ConversationActivityItems, CommandActivity } from './ConversationActivity'
import {
  conversationActivityItems,
  conversationTurnActivityPhase,
  hasConversationActivity
} from './conversationActivityModel'
import { CadencedShimmer } from './CadencedShimmer'
import { SubagentActivity, SubagentActivityContext } from './SubagentActivity'
import { SubagentThreadPanel } from './SubagentThreadPanel'
import { readSubagentThread } from './subagentThreadModel'
import { ToolActivity } from './ToolActivity'
import { CollaborationActivity } from './CollaborationActivity'
import { subagentNames } from './subagentActivityModel'
import { reasoningActivityHeading, reasoningBody, reasoningSummaryMarkdown } from './reasoningActivity'
import { CodeBlock } from './CodeBlock'
import { ownsForegroundOperation, createdThreadAction } from './foregroundOperation'
import { PreparedWorktreeCache } from './preparedWorktreeCache'
import { canReclaimDraftSubmission, draftRecoveryWorktreeChoice } from './draftSubmissionLifecycle'
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTINGS_KEY,
  updateDesktopSettings,
  useDesktopSettings
} from './desktopSettings'
import { conversationIsAtBottom } from './conversationScroll'
import { FileChangeReview } from './FileChangeReview'
import { MermaidDiagram } from './MermaidDiagram'
import {
  ComposerAddMenu,
  ComposerContextStrip,
  type ComposerAddMenuAction,
  type ComposerAddMenuEntry
} from './ComposerAddMenu'
import { ComposerProjectPicker } from './ComposerProjectPicker'
import { RemoteConnectionDialog } from './RemoteConnectionDialog'
import { RemoteProjectDialog } from './RemoteProjectDialog'
import {
  SshConnectionDiscoveryDialog,
  type SshDiscoveryAlias
} from './SshConnectionDiscoveryDialog'
import {
  ComposerPluginMentionChip,
  ComposerTemplateTray
} from './ComposerTemplateTray'
import {
  addComposerDocumentTemplate,
  materializeComposerRichDraft,
  parseComposerRichDraft,
  serializeComposerRichDraft
} from './composerRichDraft'
import {
  collaborationModeForTurn,
  composerModeIndicator,
  composerModePlaceholder,
  insertPluginInvocation,
  type ComposerMode
} from './composerMode'
import { EmptyConversationProjectHero } from './EmptyConversationHero'
import { ComposerModelMenus, ComposerPermissionMenu } from './ComposerMenus'
import { MarketplacePage } from './MarketplacePage'
import { ProjectsPanel } from './ProjectsPanel'
import { ProjectActionDialog, type ProjectDialogMode as SidebarProjectDialogMode } from './ProjectActionDialog'
import { ProjectArchiveDialog } from './ProjectArchiveDialog'
import { ScheduledTasksPage } from './ScheduledTasksPage'
import { LocalEnvironmentDialog, type NewThreadWorktreeChoice } from './LocalEnvironmentDialog'
import { archiveAllProjectThreads, loadAllProjectThreads, stopAndArchiveProjectThread, type ProjectThreadOperationsClient } from './projectThreadOperations'
import { readWindowZoom, toLogicalRect, useWindowZoom } from './windowZoom'
import { WindowCloseDialog } from './WindowCloseDialog'
import { UltraFullAccessDialog } from './UltraFullAccessDialog'
import { FullAccessConfirmDialog } from './FullAccessConfirmDialog'
import {
  isFullAccessPermission,
  needsUltraFullAccessConfirmation,
  restrictedPermissionFallback
} from './ultraFullAccess'
import { InteractiveTerminalPanel, useTerminalTabsController, useTerminalTabsSnapshot } from './InteractiveTerminalPanel'
import { terminalTabTitle } from './terminalTabs'
import { createNavigationHistory, currentNavigationEntry, pushNavigationEntry, replaceCurrentNavigationEntry, resolveDraftNavigationEntries, navigateBack, navigateForward, canNavigateBack, canNavigateForward, sameNavigationEntry, type NavigationHistory } from './navigationHistory'
import { parseProjectPreferences, overlayProjectPreferences, editProjectPreference, migrateProjectPinnedPaths, PROJECT_PREFERENCES_KEY, PROJECT_PINNED_KEY, PROJECT_PINNED_EVENT } from './projectPreferences'
import type { ProjectEdit } from './projectPanelState'
import { canRestoreInitialProject, initialProjectPath, localThreadProjectKind, parseSelectedProject, rememberSelectedProject, rememberSelectedWorkspace, SELECTED_PROJECT_KEY } from './selectedProject'
import type {
  ApprovalsReviewer,
  ModelOption,
  Page,
  PermissionProfile,
  Project,
  ReasoningEffort,
  Thread,
  ThreadSearchEntry,
  ThreadItem,
  Turn,
  UserInput
} from './protocol'
import {
  initialSessionState,
  sessionReducer,
  type ThreadSession
} from './state/sessionReducer'
import { ServerRequestDialog } from './ServerRequestDialog'
import { SettingsPage, type SettingsSectionId } from './SettingsPage'
import { ProfileMenu } from './ProfileMenu'
import { TerminalSheet } from './TerminalSheet'
import { ThreadActionDialog, type ThreadDialogMode } from './ThreadActionDialog'
import { ThreadImagePreview } from './ThreadImagePreview'
import { UserMessageImages } from './UserMessageImages'
import { CollapsibleUserMessage } from './CollapsibleUserMessage'
import { QueuedMessageList } from './QueuedMessageList'
import {
  createOptimisticQueuedMessage,
  queuedMessageFromServer,
  queuedMessageTransferText,
  reconcileQueuedSubmissions,
  removeQueuedMessage,
  updateQueuedMessage,
  upsertQueuedMessage,
  type QueuedMessage,
  type ServerQueuedSubmission
} from './queuedMessages'
import {
  WorkspacePane,
  ACTIVATE_WORKSPACE_TAB_EVENT,
  CLOSE_WORKSPACE_FILE_EVENT,
  CLOSE_WORKSPACE_TAB_EVENT,
  type WorkspaceChromeState
} from './WorkspacePane'
import { ADD_WORKSPACE_SELECTION_TO_COMPOSER_EVENT, validatedWorkspaceComposerReference, workspaceReferencePrompt } from './workspaceEditorSelection'
import { DiffCommentsStore, useDiffComments } from './diffCommentsStore'
import { diffCommentText, formatDiffCommentLines, type DiffCommentAttachment } from './diffComments'
import { dispatchWorkspaceDiffLink } from './workspaceDiffLinks'
import { parseWorkspaceLayouts, WORKSPACE_LAYOUTS_KEY, OPEN_WORKSPACE_CONTENT_EVENT, CLOSE_WORKSPACE_CONTENT_EVENT, type WorkspaceLayoutMode } from './workspaceLayout'
import {
  dispatchWorkspaceFileLink,
  dispatchWorkspaceSourceImage,
  parseWorkspaceFileLink,
  workspaceFileLabelHasLocation,
  workspaceFileLocationLabel,
  workspaceFileTypeLabel
} from './workspaceFileLinks'
import {
  TitlebarConversationMenu,
  type ConversationMenuAction
} from './TitlebarMenus'
import {
  enqueueServerRequest,
  isInteractiveServerRequest,
  partitionServerRequestsForThread,
  rejectedSideChatRequestResponse,
  removeServerRequest,
  resolvedServerRequestId,
  serverRequestDestination,
  serverRequestIdKey,
  unsupportedServerRequestResponse
} from './serverRequests'
import {
  addSavedProjectPath,
  normalizeProjectPath,
  deriveProjectPaths,
  parseSavedProjectPaths,
  projectCatalogForSavedPaths,
  removeSavedProjectPath,
  restoreSavedProjectPath,
  SAVED_PROJECTS_KEY
} from './projects'
import {
  MODEL_PREFERENCE_KEY,
  selectInitialModel
} from './modelPreference'
import {
  orderThreadsWithPins,
  parseThreadPreferences,
  removeThreadPreferences,
  setThreadPinned,
  setThreadUnread,
  type ThreadPreferences
} from './threadPreferences'
import {
  buildSidebarCollections,
  projectThreadsForDisplay,
  SIDEBAR_PROJECT_PREVIEW_LIMIT,
  threadHasActiveSidebarTurn,
  type SidebarProjectCollection
} from './sidebarModel'
import {
  recentThreadsForSidebar,
  sidebarProjectGroupsForMode,
  sortSidebarThreads,
  type SidebarDisplayGroup,
  type SidebarGroupingMode,
  type SidebarSortMode
} from './sidebarViewPreferences'
import {
  acceptNextCursor,
  hasAuthoritativeClientMessage,
  isTerminalTurnStatus,
  isThreadReadyForComposer,
  isUnknownMutationError,
  latestUserTurnTarget,
  revertDisabledReason,
  turnsInChronologicalOrder,
  type ThreadTurnsPage
} from './threadContinuity'
import { hydrateThreadForSelection, type ThreadResumeResponse } from './threadHydration'
import { ThreadResumeNotice } from './ThreadResumeNotice'
import {
  ThreadGoalBar,
  ThreadGoalCompletion,
  ThreadGoalReplaceDialog,
  ThreadGoalResumeDialog
} from './ThreadGoalBar'
import {
  EMPTY_THREAD_GOAL_STATE,
  clearCurrentThreadGoal,
  mergeThreadGoalCompletionAnchor,
  mergeThreadGoalState,
  threadGoalAutomaticClearKey,
  threadGoalCompletionAnchorTurnId,
  threadGoalMatchesCompletedAt,
  threadGoalNeedsResumeConfirmation,
  type ThreadGoal,
  type ThreadGoalCompletionAnchor,
  type ThreadGoalLifecycleState,
  type ThreadGoalStatus
} from './threadGoal'
import { SidebarResizeHandle, useSidebarWidth } from './sidebarResize'
import {
  claimPendingInterruptTurnId,
  forkTurnAction,
  interruptibleTurnId,
  requestPendingInterrupt,
  shouldRetryForkWithoutPredictionMode,
  type PendingSideChatStart
} from './sideChatLifecycle'
import {
  activateRightWorkbenchTab,
  closeRightWorkbenchTab,
  moveRightWorkbenchTab,
  openRightWorkbenchTab,
  reconcileRightWorkbenchTabs,
  rightWorkbenchTabKind,
  rightWorkbenchTabValue,
  type RightWorkbenchTabId,
  type RightWorkbenchTabsState
} from './rightWorkbenchTabs'
import {
  resolveRightWorkbenchTabKeyboardAction,
  rightWorkbenchRovingTabIndex
} from './rightWorkbenchTabKeyboard'
import {
  RightWorkbenchResizeHandle,
  useRightWorkbenchResize
} from './rightWorkbenchResize'
import {
  activateRightWorkbenchSurface,
  collapseRightWorkbenchView,
  enterRightWorkbenchFullView,
  revealRightWorkbenchView,
  rightWorkbenchViewFlags,
  selectRightWorkbenchChat,
  toggleRightWorkbenchFullView as toggleRightWorkbenchViewFull,
  workspaceLayoutForRightWorkbenchView
} from './rightWorkbenchViewModel'
import { WorkbenchBrowser } from './WorkbenchBrowser'
import { createWorkbenchBrowserTab, type WorkbenchBrowserTab } from './workbenchBrowserModel'
import { collectWorkbenchBrowserRecents } from './workbenchBrowserRecents'
import { workbenchLauncherSelectionStrategy, type WorkbenchLauncherTool } from './workbenchLauncherModel'
import { collectWorkspacePaneSnapshot } from './workspacePaneModel'
import { collectWorkspaceSummaryPanelsModel } from './workspaceSummaryPanelsModel'
import { ProjectSummaryPopover, type ProjectSummarySource } from './ProjectSummaryPopover'
import {
  SidebarHoverCard,
  SidebarMarqueeText,
  SidebarTooltip
} from './SidebarHoverCard'
import {
  projectSummaryDisplayMode,
  projectSummaryPresentation
} from './projectSummaryLayout'

type Theme = 'dark' | 'light'
type ThemePreference = Theme | 'system'

function readStoredThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem('codex-theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Keep the in-memory system default when storage is unavailable.
  }
  return DEFAULT_DESKTOP_SETTINGS.appearance
}

function hasStoredPreference(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

function storeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem('codex-theme', preference)
  } catch {
    // Theme switching remains usable for the lifetime of this window.
  }
}
type CatalogView = 'active' | 'archived'
type PrimaryView = 'chats' | 'scheduled' | 'marketplace' | 'projects'
type RightWorkbenchSurface = 'workspace' | 'subagent' | 'sideChat' | 'browser' | 'terminal'

const workspaceWorkbenchTabId = (id: string): RightWorkbenchTabId => `workspace:${id}`
const subagentWorkbenchTabId = (id: string): RightWorkbenchTabId => `subagent:${id}`
const browserWorkbenchTabId = (id: string): RightWorkbenchTabId => `browser:${id}`
const RIGHT_WORKBENCH_TAB_DRAG_TYPE = 'application/x-codex-right-workbench-tab'
const PROJECT_SUMMARY_PINNED_KEY = 'codex-project-summary-pinned'


const THREAD_PREFERENCES_KEY = 'codex-thread-preferences-v1'
const QUEUEING_ENABLED_KEY = 'codex-composer-queueing-enabled-v1'

function appContextHostId(context: AppContext | null | undefined): string {
  return context?.hostId || 'local'
}

function threadHostId(thread: Thread | null | undefined): string {
  return thread?.hostId || 'local'
}

function navigationWorkspaceFields(context: AppContext | null | undefined): {
  hostId: string
  projectKind: 'local' | 'remote' | 'projectless'
  projectId: string | null
} {
  const hostId = appContextHostId(context)
  return {
    hostId,
    projectKind: context?.projectKind || (hostId === 'local' ? 'local' : 'remote'),
    projectId: context?.projectId ?? null
  }
}

function asProjectlessContext(context: AppContext): AppContext {
  return {
    ...context,
    hostId: 'local',
    hostDisplayName: 'Local',
    projectKind: 'projectless',
    projectId: null
  }
}

function canonicalApprovalsReviewer(
  reviewer: ApprovalsReviewer | null | undefined
): ApprovalsReviewer {
  return reviewer === 'guardian_subagent' ? 'auto_review' : reviewer || 'user'
}

interface ThreadStartResponse {
  thread: Thread
  model: string
  cwd: string
  reasoningEffort?: ReasoningEffort | null
  activePermissionProfile?: { id?: string } | null
  approvalsReviewer?: ApprovalsReviewer | null
}

interface ThreadReadResponse {
  thread: Thread
}

interface ThreadRevertResponse {
  thread: Thread
  turnsBackwardsCursor?: string | null
  itemsBackwardsCursor?: string | null
}

interface ThreadSearchPage extends Page<ThreadSearchEntry> {}

interface ThreadDialogState {
  mode: ThreadDialogMode
  thread: Thread
  turnId?: string
}

interface SidebarProjectDialogState {
  mode: SidebarProjectDialogMode
  project: ProjectEdit
}

interface SidebarProjectArchiveState {
  project: SidebarProjectCollection
}

interface ComposerDraftState {
  text: string
  attachments: ComposerAttachmentSelection[]
}

interface PendingUserMessage {
  item: ThreadItem
  text: string
  attachments: ComposerAttachmentSelection[]
}

interface PendingSteerRecovery {
  threadId: string
  turnId: string
  clientId: string
  text: string
  attachments: ComposerAttachmentSelection[]
  comments: readonly DiffCommentAttachment[]
}

interface ThreadQueueListResponse {
  data: ServerQueuedSubmission[]
  nextCursor?: string | null
}

interface ThreadQueueAddResponse {
  queuedSubmission: ServerQueuedSubmission
}

interface ThreadQueueUpdateResponse {
  queuedSubmission: ServerQueuedSubmission
}

interface ThreadQueueDeleteResponse {
  deleted: boolean
}

interface ThreadQueueStartResponse {
  turn: Turn
}

interface RightWorkbenchTitleTab {
  id: RightWorkbenchTabId
  label: string
  title: string
  kind: 'workspace' | 'file' | 'changes' | 'output' | 'sources' | 'subagents' | 'subagent' | 'side-chat' | 'browser' | 'terminal'
  dirty?: boolean
}

function browserTabLabel(tab: WorkbenchBrowserTab): string {
  if (tab.state?.title.trim()) return tab.state.title.trim()
  if (tab.state?.url) {
    try { return new URL(tab.state.url).hostname || tab.state.url }
    catch { return tab.state.url }
  }
  return '新标签页'
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const THREAD_GOAL_STATUSES = new Set<ThreadGoalStatus>([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete'
])

function threadGoalFromUnknown(value: unknown): ThreadGoal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const goal = value as Record<string, unknown>
  const tokenBudget = goal.tokenBudget ?? null
  if (
    typeof goal.threadId !== 'string' ||
    typeof goal.objective !== 'string' ||
    typeof goal.status !== 'string' ||
    !THREAD_GOAL_STATUSES.has(goal.status as ThreadGoalStatus) ||
    (tokenBudget !== null && typeof tokenBudget !== 'number') ||
    typeof goal.tokensUsed !== 'number' ||
    typeof goal.timeUsedSeconds !== 'number' ||
    typeof goal.createdAt !== 'number' ||
    typeof goal.updatedAt !== 'number'
  ) {
    return null
  }
  return { ...goal, tokenBudget } as unknown as ThreadGoal
}

function titleForThread(thread: Thread): string {
  if (thread.name?.trim()) return thread.name.trim()
  const firstLine = thread.preview
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return firstLine || '新聊天'
}

function conversationMarkdown(thread: Thread, session: ThreadSession | undefined): string {
  const lines = [`# ${titleForThread(thread)}`, '']
  for (const turn of session?.turns || []) {
    for (const item of turn.items) {
      if (item.type === 'userMessage') {
        const text = item.content
          .filter(
            (part): part is { type: 'text'; text: string; text_elements: unknown[] } =>
              part.type === 'text' && typeof part.text === 'string'
          )
          .map((part) => part.text)
          .join('\n')
          .trim()
        if (text) lines.push('## You', '', text, '')
      } else if (item.type === 'agentMessage' && item.text?.trim()) {
        lines.push('## Codex', '', item.text.trim(), '')
      }
    }
  }
  return `${lines.join('\n').trim()}\n`
}

function compactPath(path: string): string {
  const pieces = path.split('/').filter(Boolean)
  return pieces.at(-1) || path
}

function timeLabel(timestamp: number): string {
  const now = Date.now() / 1000
  const delta = Math.max(0, now - timestamp)
  if (delta < 60) return 'now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  if (delta < 604800) return `${Math.floor(delta / 86400)}d`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(timestamp * 1000)
  )
}

function sidebarRelativeTimeLabel(timestamp: number): string {
  const delta = Math.max(0, Date.now() / 1000 - timestamp)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 604800) return `${Math.floor(delta / 86400)} 天前`
  if (delta < 2592000) return `${Math.floor(delta / 604800)} 周前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
    new Date(timestamp * 1000)
  )
}

function abbreviatedSidebarPath(path: string): string {
  const macHome = path.match(/^\/Users\/[^/]+(?=\/|$)/)?.[0]
  if (macHome) return `~${path.slice(macHome.length)}`
  const pieces = path.split('/').filter(Boolean)
  if (pieces.length <= 4) return path
  return `/${pieces.slice(0, 2).join('/')}/…/${pieces.slice(-2).join('/')}`
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function markdownNodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return markdownNodeText(child.props.children)
      }
      return ''
    })
    .join('')
}

function fencedBlockIsClosed(source: string): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const opening = lines[0]?.match(/^ {0,3}(`{3,}|~{3,})/)
  if (!opening) return true

  const marker = opening[1][0]
  const minimumLength = opening[1].length
  return lines.slice(1).some((line) => {
    const closing = line.match(/^ {0,3}([`~]+)[\t ]*$/)
    if (!closing || closing[1].length < minimumLength) return false
    return [...closing[1]].every((character) => character === marker)
  })
}

interface MarkdownRenderContextValue {
  streaming: boolean
  text: string
}

const MarkdownRenderContext = createContext<MarkdownRenderContextValue>({
  streaming: false,
  text: ''
})

// Keep the component types stable while an answer streams. Defining these
// functions inside MarkdownContent makes ReactMarkdown see a new `pre` type on
// every token, which unmounts completed Mermaid diagrams and flashes their
// loading placeholders until they render again.
const markdownComponents: Components = {
  a: function MarkdownLink({ href, children }) {
    const childText = markdownNodeText(children)
    const fileLink = parseWorkspaceFileLink(href, childText)
    if (fileLink) {
      const locationLabel = workspaceFileLocationLabel(fileLink)
      const appendedLocation =
        locationLabel && !workspaceFileLabelHasLocation(childText) ? locationLabel : ''
      const usesReactIcon = /\.[jt]sx$/i.test(fileLink.path)
      return (
        <a
          className="markdown-workspace-file-link"
          href={href}
          title={`在工作区打开 ${fileLink.path}${locationLabel ? ` ${locationLabel}` : ''}`}
          data-workspace-path={fileLink.path}
          data-workspace-line={fileLink.line ?? undefined}
          data-workspace-column={fileLink.column}
          data-workspace-end-line={fileLink.endLine}
          data-workspace-end-column={fileLink.endColumn}
          onClick={(event) => {
            event.preventDefault()
            dispatchWorkspaceFileLink(fileLink)
          }}
        >
          <span
            className={`markdown-workspace-file-icon${usesReactIcon ? ' is-react' : ''}`}
            aria-hidden="true"
          >
            {usesReactIcon ? <Atom /> : workspaceFileTypeLabel(fileLink.path)}
          </span>
          <span>
            {children}
            {appendedLocation ? ` ${appendedLocation}` : null}
          </span>
        </a>
      )
    }
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault()
          if (href) void window.codex.openExternal(href).catch(() => undefined)
        }}
      >
        {children}
      </a>
    )
  },
  pre: function MarkdownPre({ children, node }) {
    const { streaming, text } = useContext(MarkdownRenderContext)
    const child = Children.count(children) === 1 ? Children.only(children) : null
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const classes = child.props.className?.split(/\s+/).filter(Boolean) || []
      const code = Children.toArray(child.props.children).join('').replace(/\n$/, '')
      const startOffset = node?.position?.start.offset
      const endOffset = node?.position?.end.offset
      const isTrailingStreamingBlock =
        streaming &&
        (typeof endOffset !== 'number' || text.slice(endOffset).trim().length === 0)
      const blockSource =
        typeof startOffset === 'number'
          ? text.slice(startOffset, typeof endOffset === 'number' ? endOffset : undefined)
          : text
      const isOpenTrailingFence =
        isTrailingStreamingBlock && !fencedBlockIsClosed(blockSource)
      if (classes.includes('language-mermaid')) {
        return <MermaidDiagram code={code} streaming={isOpenTrailingFence} />
      }
      const language = classes
        .find((className) => className.startsWith('language-'))
        ?.slice('language-'.length)
      return <CodeBlock code={code} language={language} copyable={!isOpenTrailingFence} />
    }
    return <pre>{children}</pre>
  }
}

export function MarkdownContent({
  text,
  streaming = false
}: {
  text: string
  streaming?: boolean
}): ReactNode {
  return (
    <MarkdownRenderContext.Provider value={{ streaming, text }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWorkspaceFileCitations]}
        urlTransform={(url) =>
          /^file:/i.test(url) && parseWorkspaceFileLink(url) ? url : defaultUrlTransform(url)
        }
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </MarkdownRenderContext.Provider>
  )
}

function useTheme(): [Theme, () => void, ThemePreference, (value: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readStoredThemePreference)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    storeThemePreference(preference)
  }, [preference, theme])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystem = (): void => setSystemDark(query.matches)
    const updatePreference = (event: StorageEvent): void => {
      if (event.key !== 'codex-theme') return
      setPreference(event.newValue === 'dark' || event.newValue === 'light'
        ? event.newValue : 'system')
    }
    query.addEventListener('change', updateSystem)
    window.addEventListener('storage', updatePreference)
    return () => {
      query.removeEventListener('change', updateSystem)
      window.removeEventListener('storage', updatePreference)
    }
  }, [])

  const updatePreference = (value: ThemePreference): void => {
    setPreference(value)
    updateDesktopSettings({ appearance: value })
  }

  return [
    theme,
    () => updatePreference(theme === 'dark' ? 'light' : 'dark'),
    preference,
    updatePreference
  ]
}

function App(): ReactNode {
  const desktopSettings = useDesktopSettings()
  const [desktopPreferencesReady, setDesktopPreferencesReady] = useState(false)
  const [workspaceLayouts, setWorkspaceLayouts] = useState(() => parseWorkspaceLayouts(localStorage.getItem(WORKSPACE_LAYOUTS_KEY)))
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState)
  const [draftTerminalScope, setDraftTerminalScope] = useState(() => `draft:${crypto.randomUUID()}`)
  const draftTerminalScopeRef = useRef(draftTerminalScope)
  const terminalScopes = useRef(new Map<string, string>())
  const rightWorkbenchScope = state.selectedThreadId
    ? terminalScopes.current.get(state.selectedThreadId) || state.selectedThreadId
    : draftTerminalScope
  const {
    store: workbenchSessions, workspaceOpen, setWorkspaceOpen,
    workspaceChromeState, setWorkspaceChromeState, rightWorkbenchTabs, setRightWorkbenchTabsState,
    rightWorkbenchView, setRightWorkbenchView, browserTabs, setBrowserTabs, allBrowserTabs,
    openedSubagents, setOpenedSubagents, activeSubagentId, setActiveSubagentId
  } = useRightWorkbenchSessions(rightWorkbenchScope)
  const workspaceOwnerScopeRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    workspaceOwnerScopeRef.current = workspaceOpen ? rightWorkbenchScope : null
  }, [rightWorkbenchScope, workspaceOpen])
  const {
    open: rightWorkbenchVisible,
    fullView: rightWorkbenchFullView,
    chatSelected: rightWorkbenchChatSelected,
    workbenchSurfaceVisible: rightWorkbenchSurfaceVisible
  } = rightWorkbenchViewFlags(rightWorkbenchView)
  const [projectSummaryPinned, setProjectSummaryPinned] = useState(
    () => localStorage.getItem(PROJECT_SUMMARY_PINNED_KEY) !== 'false'
  )
  const [projectSummaryPopoverOpen, setProjectSummaryPopoverOpen] = useState(false)
  const [rendererOverlayOpen, setRendererOverlayOpen] = useState(false)
  const projectSummaryAnchorRef = useRef<HTMLButtonElement>(null)
  const rightWorkbenchTabsRef = useRef(rightWorkbenchTabs)
  rightWorkbenchTabsRef.current = rightWorkbenchTabs
  const setRightWorkbenchTabs = (update: RightWorkbenchTabsState | ((current: RightWorkbenchTabsState) => RightWorkbenchTabsState)): void => {
    const next = typeof update === 'function' ? update(rightWorkbenchTabsRef.current) : update
    rightWorkbenchTabsRef.current = next
    setRightWorkbenchTabsState(next)
  }
  const [newThreadWorkspaceLayout, setNewThreadWorkspaceLayout] = useState<WorkspaceLayoutMode>(() => desktopSettings.defaultFullView ? 'full' : 'split')
  const [bootstrapReady, setBootstrapReady] = useState(false)
  const [backend, setBackend] = useState<BackendStatus>({ state: 'starting', mode: 'direct' })
  const [context, setContextState] = useState<AppContext | null>(null)
  const contextRef = useRef<AppContext | null>(context)
  const setContext = (next: AppContext | null): void => { contextRef.current = next; setContextState(next) }
  const terminalController = useTerminalTabsController(state.selectedThreadId ? terminalScopes.current.get(state.selectedThreadId) || state.selectedThreadId : draftTerminalScope)
  const terminalState = useTerminalTabsSnapshot(terminalController)
  const terminalWorkbenchSelectionRef = useRef({ scope: rightWorkbenchScope, id: null as string | null })
  const preparedWorktrees = useRef(new PreparedWorktreeCache())
  const [modelId, setModelId] = useState('')
  const [effort, setEffort] = useState<ReasoningEffort>('medium')
  const [permission, setPermission] = useState(':workspace')
  const [approvalsReviewer, setApprovalsReviewer] = useState<ApprovalsReviewer>('user')
  const [pendingFullAccessSelection, setPendingFullAccessSelection] = useState<{
    permission: string
    approvalsReviewer: ApprovalsReviewer
  } | null>(null)
  const [pendingUltraSelection, setPendingUltraSelection] = useState<{
    modelId: string
    effort: ReasoningEffort
    fallbackPermission: string | null
  } | null>(null)
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraftState>>({})
  const [composerModes, setComposerModes] = useState<Record<string, ComposerMode>>({})
  const [composerProjectPickerOpen, setComposerProjectPickerOpen] = useState(false)
  const [threadGoals, setThreadGoals] = useState<Record<string, ThreadGoalLifecycleState>>({})
  const [completedGoalTurnAnchors, setCompletedGoalTurnAnchors] = useState<
    Record<string, ThreadGoalCompletionAnchor>
  >({})
  const [goalResumeConfirmation, setGoalResumeConfirmation] = useState<ThreadGoal | null>(null)
  const [goalResumeBusy, setGoalResumeBusy] = useState(false)
  const [goalReplacementConfirmation, setGoalReplacementConfirmation] = useState<{
    goal: ThreadGoal
    objective: string
  } | null>(null)
  const [diffCommentsStore] = useState(() => new DiffCommentsStore())
  const diffCommentScope = state.selectedThreadId || draftTerminalScope
  const diffComments = useDiffComments(diffCommentsStore, diffCommentScope)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('codex-sidebar-open') !== 'false'
  )
  const [primaryView, setPrimaryView] = useState<PrimaryView>('chats')
  const [savedProjectPaths, setSavedProjectPaths] = useState<string[]>(() =>
    parseSavedProjectPaths(localStorage.getItem(SAVED_PROJECTS_KEY))
  )
  const [projects, setProjects] = useState<Project[]>([])
  const [remoteConnections, setRemoteConnections] = useState<RemoteConnection[]>([])
  const [remoteProjects, setRemoteProjects] = useState<RemoteProject[]>([])
  const [remoteCatalogLoaded, setRemoteCatalogLoaded] = useState(false)
  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false)
  const [remoteDiscoveryOpen, setRemoteDiscoveryOpen] = useState(false)
  const [remoteDiscoveredAliases, setRemoteDiscoveredAliases] = useState<SshDiscoveryAlias[]>([])
  const [remoteSelectedAliases, setRemoteSelectedAliases] = useState<string[]>([])
  const [remoteDiscoveryRefreshing, setRemoteDiscoveryRefreshing] = useState(false)
  const [remoteDiscoverySaving, setRemoteDiscoverySaving] = useState(false)
  const [remoteDiscoveryError, setRemoteDiscoveryError] = useState<string | null>(null)
  const [remoteConnectionDialogOpen, setRemoteConnectionDialogOpen] = useState(false)
  const [remoteConnectionBusy, setRemoteConnectionBusy] = useState(false)
  const [remoteConnectionError, setRemoteConnectionError] = useState<string | null>(null)
  const importCatalogRevision = useRef(0)
  const initialWorkspaceRestoreStarted = useRef(false)
  const [projectPreferences, setProjectPreferences] = useState(() => parseProjectPreferences(localStorage.getItem(PROJECT_PREFERENCES_KEY)))
  const [projectPins, toggleProjectPin] = usePersistedSidebarList(PROJECT_PINNED_KEY)
  const [navigation, setNavigationState] = useState(() => createNavigationHistory({
    view: 'chats', threadId: null, cwd: null, hostId: 'local', projectKind: 'local', projectId: null,
    draftId: draftTerminalScope
  }))
  const navigationRef = useRef(navigation)
  const setNavigation = (update: NavigationHistory | ((history: NavigationHistory) => NavigationHistory)): void => {
    const next = typeof update === 'function' ? update(navigationRef.current) : update
    navigationRef.current = next
    setNavigationState(next)
  }
  const [navigationBusy, setNavigationBusy] = useState(false)
  const navigationInFlight = useRef(false)
  const navigationActionRevision = useRef(0)
  const activeMainSubmission = useRef<string | null>(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [windowCloseRequest, setWindowCloseRequest] = useState<WindowCloseRequest | null>(null)
  const [localEnvironmentOpen, setLocalEnvironmentOpen] = useState(false)
  const [draftWorktreeChoices, setDraftWorktreeChoices] = useState<Record<string, NewThreadWorktreeChoice>>({})
  const newThreadWorktreeChoice = draftWorktreeChoices[draftTerminalScope] || null
  const setNewThreadWorktreeChoice = (choice: NewThreadWorktreeChoice): void => {
    setDraftWorktreeChoices((choices) => ({...choices, [draftTerminalScope]: choice}))
  }
  const [worktreeCreating, setWorktreeCreating] = useState(false)
  const [windowZoom, setWindowZoom] = useState(1)
  const [pendingOpenThreads, setPendingOpenThreads] = useState<OpenThreadRequest[]>([])
  const openingThreadIds = useRef(new Set<string>())
  const nativeActions = useRef<{ command(command: string): void; close(origin: WindowCloseOrigin): void }>({command: () => {}, close: () => {}})
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ThreadSearchEntry[] | null>(null)
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [catalogView, setCatalogView] = useState<CatalogView>('active')
  const [threadsNextCursor, setThreadsNextCursor] = useState<string | null>(null)
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([])
  const [archivedNextCursor, setArchivedNextCursor] = useState<string | null>(null)
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [threadPreferences, setThreadPreferences] = useState<ThreadPreferences>(() =>
    parseThreadPreferences(localStorage.getItem(THREAD_PREFERENCES_KEY))
  )
  const [threadDialog, setThreadDialog] = useState<ThreadDialogState | null>(null)
  const [threadActionBusy, setThreadActionBusy] = useState(false)
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const [sidebarProjectDialog, setSidebarProjectDialog] = useState<SidebarProjectDialogState | null>(null)
  const [sidebarProjectActionBusy, setSidebarProjectActionBusy] = useState(false)
  const [sidebarProjectActionError, setSidebarProjectActionError] = useState<string | null>(null)
  const [sidebarProjectArchive, setSidebarProjectArchive] = useState<SidebarProjectArchiveState | null>(null)
  const [compactingThreadIds, setCompactingThreadIds] = useState<string[]>([])
  const [threadNotice, setThreadNotice] = useState<{
    message: string
    archivedThread?: Thread
    removedProject?: {
      path: string
      name: string
      index: number
      wasPinned: boolean
    }
  } | null>(null)
  const [failedDraftRecoveries, setFailedDraftRecoveries] = useState<{
    id: string; cwd: string; text: string; attachments: ComposerAttachmentSelection[]; message: string
    worktreeChoice?: NewThreadWorktreeChoice | null
    commentScope?: string
  }[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('general')
  const [terminalSheetOpen, setTerminalSheetOpen] = useState(false)
  const [backgroundTerminalSize, setBackgroundTerminalSize] = useState(500)
  const [sideChatOpen, setSideChatOpen] = useState(false)
  const openedSubagent = openedSubagents.find((entry) => entry.threadId === activeSubagentId)
    || openedSubagents.at(-1)
    || null
  const [sideChatDraft, setSideChatDraft] = useState('')
  const [sideChatAttachments, setSideChatAttachments] = useState<
    ComposerAttachmentSelection[]
  >([])
  const [sideChatAttachmentError, setSideChatAttachmentError] = useState<string | null>(null)
  const [sideChatThreadId, setSideChatThreadId] = useState<string | null>(null)
  const [sideChatStarting, setSideChatStarting] = useState(false)
  const [mainTurnStarting, setMainTurnStarting] = useState(false)
  const [mainTurnThinking, setMainTurnThinking] = useState(false)
  const [pendingUserMessage, setPendingUserMessage] = useState<PendingUserMessage | null>(null)
  const [pendingDraftSubmissions, setPendingDraftSubmissions] = useState<Record<string, {id: string; message: PendingUserMessage}>>({})
  const pendingDraftSubmissionsRef = useRef(new Map<string, {id: string; message: PendingUserMessage}>())
  const [queuedMessagesByThread, setQueuedMessagesByThread] = useState<Record<string, QueuedMessage[]>>({})
  const queuedMessagesByThreadRef = useRef<Record<string, QueuedMessage[]>>({})
  const queueLoads = useRef(new Map<string, Promise<QueuedMessage[]>>())
  const queueServerRevisions = useRef(new Map<string, number>())
  const queueActiveMutations = useRef(new Map<string, number>())
  const queueMutationWaiters = useRef(new Map<string, Set<() => void>>())
  const queueStarts = useRef(new Set<string>())
  const [editingQueuedMessage, setEditingQueuedMessage] = useState<{
    threadId: string
    messageId: string
  } | null>(null)
  const [queueingEnabled, setQueueingEnabled] = useState(
    () => localStorage.getItem(QUEUEING_ENABLED_KEY) !== 'false'
  )
  const removedThreadIds = useRef(new Set<string>())
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null)
  const [resumedThreadId, updateResumedThreadId] = useState<string | null>(null)
  const resumedThreadIdRef = useRef<string | null>(null)
  const setResumedThreadId = (threadId: string | null): void => {
    resumedThreadIdRef.current = threadId
    updateResumedThreadId(threadId)
  }
  const [hydrating, setHydrating] = useState(false)
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null)
  const [historyLoadingEarlier, setHistoryLoadingEarlier] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [steering, setSteering] = useState(false)
  const [serverRequestQueue, setServerRequestQueue] = useState<RpcServerRequest[]>([])
  const [serverRequestBusy, setServerRequestBusy] = useState(false)
  const [serverRequestError, setServerRequestError] = useState<string | null>(null)
  const [theme, toggleTheme, themePreference, setThemePreference] = useTheme()
  const sidebarWidth = useSidebarWidth()
  const rightWorkbenchContainerRef = useRef<HTMLDivElement>(null)
  const rightWorkbenchResize = useRightWorkbenchResize({
    containerRef: rightWorkbenchContainerRef,
    enabled: !settingsOpen && primaryView === 'chats',
    uiZoom: windowZoom,
    widthMode: 'unified'
  })
  const selectSequence = useRef(0)
  const searchSequence = useRef(0)
  const seenThreadCursors = useRef(new Set<string>())
  const seenArchivedCursors = useRef(new Set<string>())
  const seenSearchCursors = useRef(new Set<string>())
  const seenHistoryCursors = useRef(new Set<string>())
  const selectedThreadIdRef = useRef<string | null>(state.selectedThreadId)
  const stateRef = useRef(state)
  const scheduledRunIds = useRef(new Set<string>())
  const scheduledRunTail = useRef<Promise<void>>(Promise.resolve())
  const scheduledRunExecutorRef = useRef<(run: ScheduledTaskRunRequest) => Promise<void>>(async () => {})
  const sideChatOpenRef = useRef(sideChatOpen)
  const sideChatThreadIdRef = useRef<string | null>(sideChatThreadId)
  const sideChatGeneration = useRef(0)
  const pendingSideChatStart = useRef<PendingSideChatStart | null>(null)
  const discardedSideChatThreadIds = useRef(new Set<string>())
  const serverRequestQueueRef = useRef<RpcServerRequest[]>(serverRequestQueue)
  const seenServerRequestIds = useRef(new Set<string>())
  const pendingSteerRecoveries = useRef(new Map<string, PendingSteerRecovery>())
  const interruptedTurnIds = useRef(new Set<string>())
  const threadGoalRevisions = useRef(new Map<string, number>())
  const automaticGoalClears = useRef(new Set<string>())
  const dismissedGoalConfirmations = useRef(new Set<string>())
  const reconnectThreadId = useRef<string | null>(null)
  const previousBackendState = useRef<BackendStatus['state']>(backend.state)
  const hostIdForThreadId = (threadId: string): string => threadHostId(
    stateRef.current.threads.find((thread) => thread.id === threadId) ||
    stateRef.current.transientThreads[threadId]
  )

  const bumpThreadGoalRevision = (threadId: string): number => {
    const revision = (threadGoalRevisions.current.get(threadId) || 0) + 1
    threadGoalRevisions.current.set(threadId, revision)
    return revision
  }
  const mergeThreadGoal = (goal: ThreadGoal, completedTurnId?: string | null): void => {
    bumpThreadGoalRevision(goal.threadId)
    setThreadGoals((goals) => {
      const previous = goals[goal.threadId] || EMPTY_THREAD_GOAL_STATE
      const next = mergeThreadGoalState(previous, goal)
      return next === previous ? goals : { ...goals, [goal.threadId]: next }
    })
    if (goal.status === 'complete' && completedTurnId !== undefined) {
      setCompletedGoalTurnAnchors((anchors) => {
        const previous = anchors[goal.threadId] || null
        const next = mergeThreadGoalCompletionAnchor(previous, goal, completedTurnId)
        return !next || next === previous
          ? anchors
          : { ...anchors, [goal.threadId]: next }
      })
    }
    if (!threadGoalNeedsResumeConfirmation(goal.status)) {
      setGoalResumeConfirmation((confirmation) =>
        confirmation?.threadId === goal.threadId ? null : confirmation
      )
    }
  }
  const clearThreadGoal = (threadId: string): void => {
    bumpThreadGoalRevision(threadId)
    setThreadGoals((goals) => {
      const previous = goals[threadId]
      if (!previous) return goals
      const next = clearCurrentThreadGoal(previous, threadId)
      return next === previous ? goals : { ...goals, [threadId]: next }
    })
    setGoalResumeConfirmation((confirmation) =>
      confirmation?.threadId === threadId ? null : confirmation
    )
    setGoalReplacementConfirmation((confirmation) =>
      confirmation?.goal.threadId === threadId ? null : confirmation
    )
  }
  const automaticallyClearCompletedGoal = async (goal: ThreadGoal): Promise<void> => {
    const key = threadGoalAutomaticClearKey(goal)
    if (automaticGoalClears.current.has(key)) return
    automaticGoalClears.current.add(key)
    try {
      await window.codex.invoke<{ cleared: boolean }>('thread/goal/clear', {
        threadId: goal.threadId,
        origin: 'automatic'
      }, hostIdForThreadId(goal.threadId))
    } catch {
      // A clear failure can have an unknown outcome. The shipped client sends
      // this mutation once and waits for `thread/goal/cleared` or later
      // hydration instead of retrying and risking a newer goal.
    }
  }
  const acceptThreadGoal = (goal: ThreadGoal, completedTurnId?: string | null): void => {
    mergeThreadGoal(goal, completedTurnId)
    if (goal.status === 'complete') void automaticallyClearCompletedGoal(goal)
  }
  const updateThreadGoal = async (
    threadId: string,
    patch: { objective?: string; status?: ThreadGoalStatus }
  ): Promise<ThreadGoal> => {
    const revisionAtStart = threadGoalRevisions.current.get(threadId) || 0
    const response = await window.codex.invoke<{ goal: ThreadGoal }>('thread/goal/set', {
      threadId,
      ...patch,
      origin: 'user'
    }, hostIdForThreadId(threadId))
    const goal = threadGoalFromUnknown(response.goal)
    if (!goal || goal.threadId !== threadId) {
      throw new Error('The server returned an invalid goal update.')
    }
    if ((threadGoalRevisions.current.get(threadId) || 0) === revisionAtStart) {
      acceptThreadGoal(goal)
    }
    return goal
  }
  const removeThreadGoal = async (threadId: string): Promise<void> => {
    const revisionAtStart = threadGoalRevisions.current.get(threadId) || 0
    await window.codex.invoke<{ cleared: boolean }>('thread/goal/clear', {
      threadId,
      origin: 'user'
    }, hostIdForThreadId(threadId))
    if ((threadGoalRevisions.current.get(threadId) || 0) === revisionAtStart) {
      clearThreadGoal(threadId)
    }
  }
  const maybePromptToResumeGoal = (goal: ThreadGoal): void => {
    if (!threadGoalNeedsResumeConfirmation(goal.status)) return
    const key = `${goal.threadId}:${goal.updatedAt}:${goal.status}`
    if (dismissedGoalConfirmations.current.has(key)) return
    setGoalResumeConfirmation(goal)
  }
  const dismissGoalResumeConfirmation = (): void => {
    const goal = goalResumeConfirmation
    if (goal) {
      dismissedGoalConfirmations.current.add(
        `${goal.threadId}:${goal.updatedAt}:${goal.status}`
      )
    }
    setGoalResumeConfirmation(null)
  }
  const resumeConfirmedGoal = async (): Promise<void> => {
    const goal = goalResumeConfirmation
    if (!goal || goalResumeBusy) return
    setGoalResumeBusy(true)
    try {
      await updateThreadGoal(goal.threadId, { status: 'active' })
      setGoalResumeConfirmation(null)
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
    } finally {
      setGoalResumeBusy(false)
    }
  }

  const markNavigationAction = (): number => {
    const revision = ++navigationActionRevision.current
    navigationInFlight.current = false
    activeMainSubmission.current = null
    setNavigationBusy(false)
    setMainTurnStarting(false)
    setMainTurnThinking(false)
    setWorktreeCreating(false)
    setPendingUserMessage(null)
    return revision
  }
  const invalidateRemovedThreadSelection = (threadId: string): void => {
    removedThreadIds.current.add(threadId)
    if (selectedThreadIdRef.current !== threadId) return
    markNavigationAction()
    // Notifications can precede mutation acknowledgements and React's reducer
    // commit. Invalidate both route ownership and an outstanding history read
    // immediately, before either asynchronous result can select this chat again.
    selectedThreadIdRef.current = null
    selectSequence.current += 1
    reconnectThreadId.current = null
    setLoadedThreadId(null)
    setResumedThreadId(null)
    setHydrating(false)
    setHistoryLoadingEarlier(false)
    setHistoryNextCursor(null)
    setHistoryError(null)
    const scope = `draft:${crypto.randomUUID()}`
    draftTerminalScopeRef.current = scope
    setDraftTerminalScope(scope)
    setNavigation((history) => {
      const current = currentNavigationEntry(history)
      return current?.view === 'chats' && current.threadId === threadId
        ? replaceCurrentNavigationEntry(history, {
            view: 'chats', threadId: null, cwd: contextRef.current?.cwd || null,
            ...navigationWorkspaceFields(contextRef.current), draftId: scope
          })
        : history
    })
  }

  useEffect(() => {
    localStorage.setItem(PROJECT_SUMMARY_PINNED_KEY, String(projectSummaryPinned))
  }, [projectSummaryPinned])

  useEffect(() => {
    setProjectSummaryPopoverOpen(false)
  }, [primaryView, settingsOpen, state.selectedThreadId])

  useEffect(() => {
    const update = (): void => setProjectModalOpen(Boolean(document.querySelector('.project-dialog-backdrop')))
    const observer = new MutationObserver(update)
    observer.observe(document.body, {childList: true, subtree: true})
    update()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const overlaySelector = [
      '[role="dialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '.project-summary-popover',
      '.thread-image-preview-backdrop',
      '.mermaid-diagram-lightbox'
    ].join(',')
    const update = (): void => setRendererOverlayOpen(Boolean(document.querySelector(overlaySelector)))
    const observer = new MutationObserver(update)
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'class']})
    update()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.codex.onDesktopPreferencesChanged((preferences) => updateDesktopSettings(preferences))
    void window.codex.getDesktopPreferences().then((preferences) => {
      if (cancelled) return
      if (!hasStoredPreference(DESKTOP_SETTINGS_KEY)) updateDesktopSettings(preferences)
      if (!hasStoredPreference('codex-theme') && preferences.appearance) {
        setThemePreference(preferences.appearance)
      }
      setDesktopPreferencesReady(true)
    }).catch((error) => {
      if (!cancelled) setThreadNotice({ message: displayError(error) })
    })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  useEffect(() => {
    if (!desktopPreferencesReady) return
    void window.codex.updateDesktopPreferences({
      permissionNotifications: desktopSettings.permissionNotifications,
      appearance: themePreference,
      questionNotifications: desktopSettings.questionNotifications,
      dotNotifications: desktopSettings.dotNotifications,
      turnCompletionNotifications: desktopSettings.turnCompletionNotifications,
      preventSleepWhileRunning: desktopSettings.preventSleepWhileRunning,
      closeWindowConfirmation: desktopSettings.closeWindowConfirmation
    }).catch((error) => setThreadNotice({ message: displayError(error) }))
  }, [desktopPreferencesReady, themePreference, desktopSettings.permissionNotifications,
    desktopSettings.questionNotifications, desktopSettings.dotNotifications,
    desktopSettings.turnCompletionNotifications, desktopSettings.preventSleepWhileRunning, desktopSettings.closeWindowConfirmation])

  useEffect(() => {
    const root = document.documentElement
    const overrides = {
      '--main': desktopSettings.backgroundColor !== DEFAULT_DESKTOP_SETTINGS.backgroundColor
        ? desktopSettings.backgroundColor : null,
      '--text': desktopSettings.foregroundColor !== DEFAULT_DESKTOP_SETTINGS.foregroundColor
        ? desktopSettings.foregroundColor : null
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value) root.style.setProperty(key, value)
      else root.style.removeProperty(key)
    }
    if (desktopSettings.fontFamily !== 'system') {
      root.style.fontFamily = desktopSettings.fontFamily
    } else root.style.removeProperty('font-family')
  }, [desktopSettings.backgroundColor, desktopSettings.foregroundColor, desktopSettings.fontFamily])

  useEffect(() => { localStorage.setItem(PROJECT_PREFERENCES_KEY, JSON.stringify(projectPreferences)) }, [projectPreferences])
  useEffect(() => { localStorage.setItem(WORKSPACE_LAYOUTS_KEY, JSON.stringify(workspaceLayouts)) }, [workspaceLayouts])

  useEffect(() => {
    let cancelled = false
    let zoomRevision = 0
    const unsubscribeZoom = window.codex.onWindowZoomChanged((factor) => { zoomRevision += 1; if (!cancelled) setWindowZoom(factor) })
    const unsubscribeClose = window.codex.onWindowCloseRequested(setWindowCloseRequest)
    const unsubscribeView = window.codex.onCloseCurrentViewRequested((origin) => nativeActions.current.close(origin))
    const unsubscribeOpen = window.codex.onOpenThread((request) => {
      if (openingThreadIds.current.has(request.id)) return
      setPendingOpenThreads((queue) => queue.some((entry) => entry.id === request.id) ? queue : [...queue, request])
    })
    const initialZoomRevision = zoomRevision
    void window.codex.getWindowZoom().then((factor) => { if (!cancelled && zoomRevision === initialZoomRevision) setWindowZoom(factor) }).catch((error) => { if (!cancelled) setThreadNotice({message: displayError(error)}) })
    return () => { cancelled = true; unsubscribeZoom(); unsubscribeClose(); unsubscribeView(); unsubscribeOpen() }
  }, [])

  useEffect(() => { document.documentElement.style.setProperty('--codex-window-zoom', String(windowZoom)) }, [windowZoom])

  selectedThreadIdRef.current = state.selectedThreadId
  draftTerminalScopeRef.current = draftTerminalScope
  stateRef.current = state
  sideChatOpenRef.current = sideChatOpen
  sideChatThreadIdRef.current = sideChatThreadId
  serverRequestQueueRef.current = serverRequestQueue

  const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId)
  const selectedSession = state.selectedThreadId
    ? state.sessions[state.selectedThreadId]
    : undefined
  const selectedThreadGoalState = state.selectedThreadId
    ? threadGoals[state.selectedThreadId] || EMPTY_THREAD_GOAL_STATE
    : EMPTY_THREAD_GOAL_STATE
  const selectedThreadGoal = selectedThreadGoalState.current
  const selectedCompletedGoal = selectedThreadGoalState.completed
  const selectedCompletedGoalTurnId = state.selectedThreadId
    ? threadGoalCompletionAnchorTurnId(
        completedGoalTurnAnchors[state.selectedThreadId] || null,
        selectedCompletedGoal
      )
    : null
  const sideChatThread = sideChatThreadId
    ? state.transientThreads[sideChatThreadId]
    : undefined
  const sideChatSession = sideChatThreadId ? state.sessions[sideChatThreadId] : undefined
  const selectedModel = state.models.find((model) => model.id === modelId) || state.models[0]
  const selectedThreadReady = selectedThread
    ? isThreadReadyForComposer(selectedThread, {
        loadedThreadId,
        resumedThreadId,
        hydrating,
        contextCwd: context?.cwd || null
      })
    : true
  const selectedThreadHasUnknownSteer = Boolean(
    state.selectedThreadId && pendingSteerRecoveries.current.has(state.selectedThreadId)
  )
  const selectedQueuedMessages = state.selectedThreadId
    ? queuedMessagesByThread[state.selectedThreadId] || []
    : []
  const selectedEditingQueuedMessageId =
    editingQueuedMessage?.threadId === state.selectedThreadId
      ? editingQueuedMessage.messageId
      : null
  const updateThreadQueue = (
    threadId: string,
    update: (messages: readonly QueuedMessage[]) => QueuedMessage[]
  ): QueuedMessage[] => {
    const current = queuedMessagesByThreadRef.current
    const nextMessages = update(current[threadId] || [])
    const next = { ...current }
    if (nextMessages.length > 0) next[threadId] = nextMessages
    else delete next[threadId]
    queuedMessagesByThreadRef.current = next
    setQueuedMessagesByThread(next)
    return nextMessages
  }
  const bumpThreadQueueRevision = (threadId: string): number => {
    const next = (queueServerRevisions.current.get(threadId) || 0) + 1
    queueServerRevisions.current.set(threadId, next)
    return next
  }
  const waitForThreadQueueMutations = (threadId: string): Promise<void> => {
    if ((queueActiveMutations.current.get(threadId) || 0) === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const waiters = queueMutationWaiters.current.get(threadId) || new Set<() => void>()
      waiters.add(resolve)
      queueMutationWaiters.current.set(threadId, waiters)
    })
  }
  const invokeQueueMutation = async <T,>(
    threadId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<T> => {
    // A queue list request that overlaps a mutation may contain the state from
    // either side of the write. Bump on both boundaries so refreshThreadQueue
    // retries until it observes a snapshot taken outside the mutation window.
    queueActiveMutations.current.set(
      threadId,
      (queueActiveMutations.current.get(threadId) || 0) + 1
    )
    bumpThreadQueueRevision(threadId)
    try {
      return await window.codex.invoke<T>(method, params, hostIdForThreadId(threadId))
    } finally {
      const remaining = Math.max(
        0,
        (queueActiveMutations.current.get(threadId) || 1) - 1
      )
      if (remaining > 0) queueActiveMutations.current.set(threadId, remaining)
      else queueActiveMutations.current.delete(threadId)
      bumpThreadQueueRevision(threadId)
      if (remaining === 0) {
        const waiters = queueMutationWaiters.current.get(threadId)
        queueMutationWaiters.current.delete(threadId)
        for (const resolve of waiters || []) resolve()
      }
    }
  }
  const updateServerRequestQueue = (
    update: (queue: RpcServerRequest[]) => RpcServerRequest[]
  ): void => {
    const next = update(serverRequestQueueRef.current)
    serverRequestQueueRef.current = next
    setServerRequestQueue(next)
  }
  const handleServerRequest = (request: RpcServerRequest): void => {
    const key = `${request.hostId || 'local'}:${serverRequestIdKey(request.id)}`
    if (seenServerRequestIds.current.has(key)) return
    seenServerRequestIds.current.add(key)

    const transientThreadIds = new Set(Object.keys(stateRef.current.transientThreads))
    if (sideChatThreadIdRef.current) transientThreadIds.add(sideChatThreadIdRef.current)
    const destination = serverRequestDestination(request, {
      sideChatOpen: sideChatOpenRef.current,
      sideChatThreadId: sideChatThreadIdRef.current,
      transientThreadIds,
      discardedSideChatThreadIds: discardedSideChatThreadIds.current
    })
    if (destination === 'reject-side-chat') {
      void window.codex.respondToServerRequest(
        request.id,
        rejectedSideChatRequestResponse(request),
        request.hostId
      ).catch(() => undefined)
      return
    }

    if (isInteractiveServerRequest(request.method)) {
      updateServerRequestQueue((queue) => enqueueServerRequest(queue, request))
    } else {
      void window.codex.respondToServerRequest(
        request.id,
        unsupportedServerRequestResponse(request.method),
        request.hostId
      ).catch(() => undefined)
    }
  }
  const composerDraftKey = state.selectedThreadId || draftTerminalScope
  const composerMode = composerModes[composerDraftKey] || 'default'
  const setComposerMode = (mode: ComposerMode): void => {
    const key = composerDraftKey
    setComposerModes((current) => {
      if (mode === 'default') {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      return { ...current, [key]: mode }
    })
  }
  const mainSubmissionScope = state.selectedThreadId ? terminalScopes.current.get(state.selectedThreadId) || state.selectedThreadId : draftTerminalScope
  const pendingMainSubmission = pendingDraftSubmissions[mainSubmissionScope]
  const pendingMainDraft = state.selectedThreadId ? null : pendingMainSubmission
  const composerDraft = composerDrafts[composerDraftKey] || { text: '', attachments: [] }
  const draft = composerDraft.text
  const attachments = composerDraft.attachments
  useEffect(() => {
    setComposerProjectPickerOpen(false)
  }, [composerDraftKey])
  const setDraft = (update: string | ((current: string) => string)): void => {
    const key = composerDraftKey
    setComposerDrafts((current) => {
      const entry = current[key] || { text: '', attachments: [] }
      const text = typeof update === 'function' ? update(entry.text) : update
      return { ...current, [key]: { ...entry, text } }
    })
  }
  useEffect(() => {
    const addReference = (event: Event): void => {
      const root = context?.cwd
      if (!root) return
      const reference = validatedWorkspaceComposerReference((event as CustomEvent<unknown>).detail, root)
      if (!reference) return
      const prompt = workspaceReferencePrompt(reference)
      setComposerDrafts((current) => {
        const entry = current[composerDraftKey] || { text: '', attachments: [] }
        return { ...current, [composerDraftKey]: { ...entry, text: `${entry.text}${entry.text.trim() ? '\n\n' : ''}${prompt}` } }
      })
      // Draft insertion never starts a turn. The full workspace's existing
      // return-to-chat action exposes the composer; split view keeps the file open.
      if (document.querySelector('.main-panel')?.getAttribute('data-workspace-layout') === 'full') window.dispatchEvent(new CustomEvent(CLOSE_WORKSPACE_CONTENT_EVENT))
      window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>('.main-panel .composer textarea')
        input?.focus()
        if (input) input.setSelectionRange(input.value.length, input.value.length)
      })
    }
    window.addEventListener(ADD_WORKSPACE_SELECTION_TO_COMPOSER_EVENT, addReference)
    return () => window.removeEventListener(ADD_WORKSPACE_SELECTION_TO_COMPOSER_EVENT, addReference)
  }, [context?.cwd, composerDraftKey])
  const setAttachments = (
    update:
      | ComposerAttachmentSelection[]
      | ((current: ComposerAttachmentSelection[]) => ComposerAttachmentSelection[])
  ): void => {
    const key = composerDraftKey
    setComposerDrafts((current) => {
      const entry = current[key] || { text: '', attachments: [] }
      const next = typeof update === 'function' ? update(entry.attachments) : update
      return { ...current, [key]: { ...entry, attachments: next } }
    })
  }
  const clearComposerDraft = (key: string): void => {
    setComposerDrafts((current) => ({
      ...current,
      [key]: { text: '', attachments: [] }
    }))
  }
  const restoreComposerDraft = (
    threadId: string,
    text: string,
    restoredAttachments: ComposerAttachmentSelection[]
  ): void => {
    setComposerDrafts((current) => {
      const entry = current[threadId] || { text: '', attachments: [] }
      return {
        ...current,
        [threadId]: {
          text: text.trim()
            ? entry.text.trim()
              ? `${text}\n${entry.text}`
              : text
            : entry.text,
          attachments: mergeComposerAttachments(restoredAttachments, entry.attachments)
        }
      }
    })
  }

  const restoreQueuedComments = (
    threadId: string,
    restoredComments: readonly DiffCommentAttachment[]
  ): void => {
    if (restoredComments.length === 0) return
    const current = diffCommentsStore.getSnapshot(threadId)
    const currentIds = new Set(current.map((comment) => comment.id))
    const missing = restoredComments.filter((comment) => !currentIds.has(comment.id))
    if (missing.length > 0) diffCommentsStore.set(threadId, [...current, ...missing])
  }

  const refreshThreadQueue = (threadId: string): Promise<QueuedMessage[]> => {
    const existing = queueLoads.current.get(threadId)
    if (existing) return existing
    const loading = (async (): Promise<QueuedMessage[]> => {
      for (;;) {
        await waitForThreadQueueMutations(threadId)
        const revision = queueServerRevisions.current.get(threadId) || 0
        const submissions: ServerQueuedSubmission[] = []
        const seenCursors = new Set<string>()
        let cursor: string | null = null
        do {
          const response: ThreadQueueListResponse = await window.codex.invoke<ThreadQueueListResponse>(
            'thread/queue/list',
            { threadId, cursor, limit: 100 },
            hostIdForThreadId(threadId)
          )
          submissions.push(...response.data)
          cursor = response.nextCursor || null
          if (cursor) {
            if (seenCursors.has(cursor)) throw new Error('The server repeated a queue cursor')
            seenCursors.add(cursor)
          }
        } while (cursor)

        // Never let a response that crossed a local write or queue-changed
        // notification overwrite the newer local/server state.
        if (
          (queueActiveMutations.current.get(threadId) || 0) > 0 ||
          (queueServerRevisions.current.get(threadId) || 0) !== revision
        ) continue

        let reconciled: QueuedMessage[] = []
        updateThreadQueue(threadId, (current) => {
          reconciled = reconcileQueuedSubmissions(threadId, current, submissions)
          for (const previous of current) {
            const accepted = reconciled.find(
              (message) => message.clientUserMessageId === previous.clientUserMessageId
            )
            if (accepted?.serverAccepted && !previous.serverAccepted) {
              diffCommentsStore.removeSubmitted(threadId, previous.comments)
            }
          }
          return reconciled
        })
        return reconciled
      }
    })().finally(() => {
      if (queueLoads.current.get(threadId) === loading) queueLoads.current.delete(threadId)
    })
    queueLoads.current.set(threadId, loading)
    return loading
  }

  const enqueueQueuedFollowUp = async (options: {
    threadId: string
    clientUserMessageId: string
    input: UserInput[]
    text: string
    draftText: string
    attachments: ComposerAttachmentSelection[]
    comments: readonly DiffCommentAttachment[]
  }): Promise<void> => {
    const optimistic = createOptimisticQueuedMessage(options)
    updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, optimistic))
    try {
      const response = await invokeQueueMutation<ThreadQueueAddResponse>(options.threadId, 'thread/queue/add', {
        threadId: options.threadId,
        clientUserMessageId: options.clientUserMessageId,
        input: options.input
      })
      const accepted = queuedMessageFromServer(
        options.threadId,
        response.queuedSubmission,
        optimistic
      )
      updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, accepted))
      diffCommentsStore.removeSubmitted(options.threadId, options.comments)
    } catch (error) {
      if (isUnknownMutationError(error)) {
        updateThreadQueue(options.threadId, (current) => updateQueuedMessage(
          current,
          optimistic.id,
          (message) => ({
            ...message,
            status: 'outcome-unknown',
            error: '无法确认消息是否已进入队列。重新连接后会自动核对。'
          })
        ))
        void refreshThreadQueue(options.threadId).catch(() => undefined)
        return
      }
      updateThreadQueue(options.threadId, (current) => removeQueuedMessage(current, optimistic.id))
      restoreComposerDraft(options.threadId, options.draftText, options.attachments)
      const message = displayError(error)
      setAttachmentError(
        /method not found|unknown method|not supported/i.test(message)
          ? '当前 Codex server 不支持输入排队，消息已恢复到输入框。请更新 codex server。'
          : message
      )
    }
  }

  const editQueuedFollowUp = (threadId: string, messageId: string): void => {
    const message = (queuedMessagesByThreadRef.current[threadId] || []).find(
      (candidate) => candidate.id === messageId
    )
    if (!message?.serverAccepted || message.status !== 'queued') return
    setEditingQueuedMessage({ threadId, messageId: message.id })
    setComposerDrafts((current) => ({
      ...current,
      [threadId]: {
        text: message.draftText,
        attachments: [...message.attachments]
      }
    }))
    diffCommentsStore.set(threadId, [...message.comments])
    setAttachmentError(null)
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.main-panel .composer textarea')
      input?.focus()
      if (input) input.setSelectionRange(input.value.length, input.value.length)
    })
  }

  const updateQueuedFollowUp = async (options: {
    threadId: string
    messageId: string
    input: UserInput[]
    text: string
    draftText: string
    attachments: ComposerAttachmentSelection[]
    comments: readonly DiffCommentAttachment[]
  }): Promise<void> => {
    const operation = `update:${options.threadId}:${options.messageId}`
    if (queueStarts.current.has(operation)) return
    const previous = (queuedMessagesByThreadRef.current[options.threadId] || []).find(
      (message) => message.id === options.messageId
    )
    if (!previous?.serverAccepted || previous.status !== 'queued') return
    queueStarts.current.add(operation)
    const optimistic: QueuedMessage = {
      ...previous,
      input: options.input,
      draftText: options.draftText,
      text: options.text,
      attachments: options.attachments,
      comments: options.comments,
      commentCount: options.comments.length,
      status: 'sending',
      pauseReason: null,
      error: null
    }
    updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, optimistic))
    try {
      const response = await invokeQueueMutation<ThreadQueueUpdateResponse>(
        options.threadId,
        'thread/queue/update',
        {
          threadId: options.threadId,
          queuedSubmissionId: previous.id,
          input: options.input
        }
      )
      const accepted = queuedMessageFromServer(
        options.threadId,
        response.queuedSubmission,
        { ...optimistic, status: 'queued' }
      )
      updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, accepted))
      diffCommentsStore.removeSubmitted(options.threadId, options.comments)
      setComposerDrafts((current) => ({
        ...current,
        [options.threadId]: { text: '', attachments: [] }
      }))
      setEditingQueuedMessage((current) =>
        current?.threadId === options.threadId && current.messageId === options.messageId
          ? null
          : current
      )
    } catch (error) {
      if (isUnknownMutationError(error)) {
        updateThreadQueue(options.threadId, (current) => updateQueuedMessage(
          current,
          previous.id,
          (message) => ({
            ...message,
            status: 'outcome-unknown',
            pauseReason: null,
            error: '无法确认排队消息的修改是否已保存。重新连接后会自动核对。'
          })
        ))
        try {
          const refreshed = await refreshThreadQueue(options.threadId)
          const authoritative = refreshed.find(
            (message) =>
              message.id === previous.id ||
              message.clientUserMessageId === previous.clientUserMessageId
          )
          if (
            authoritative &&
            JSON.stringify(authoritative.input) === JSON.stringify(options.input)
          ) {
            updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, {
              ...authoritative,
              draftText: options.draftText,
              text: options.text,
              attachments: options.attachments,
              comments: options.comments,
              commentCount: options.comments.length,
              status: 'queued',
              pauseReason: null,
              error: null
            }))
            diffCommentsStore.removeSubmitted(options.threadId, options.comments)
            setComposerDrafts((current) => ({
              ...current,
              [options.threadId]: { text: '', attachments: [] }
            }))
            setEditingQueuedMessage((current) =>
              current?.threadId === options.threadId && current.messageId === options.messageId
                ? null
                : current
            )
          } else if (authoritative) {
            updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, previous))
            setAttachmentError('排队消息的修改未保存，编辑内容仍保留在输入框中。')
          } else {
            setEditingQueuedMessage((current) =>
              current?.threadId === options.threadId && current.messageId === options.messageId
                ? null
                : current
            )
            setAttachmentError('该消息已不在队列中，编辑内容仍保留在输入框中。')
          }
        } catch {
          setAttachmentError('暂时无法确认排队消息是否已修改；编辑内容仍保留在输入框中。')
        }
      } else {
        updateThreadQueue(options.threadId, (current) => upsertQueuedMessage(current, previous))
        setAttachmentError(displayError(error))
      }
    } finally {
      queueStarts.current.delete(operation)
    }
  }

  const reorderQueuedFollowUps = async (
    threadId: string,
    queuedSubmissionIds: string[]
  ): Promise<void> => {
    const operation = `reorder:${threadId}`
    if (queueStarts.current.has(operation)) return
    const previous = queuedMessagesByThreadRef.current[threadId] || []
    if (
      previous.length < 2 ||
      previous.length !== queuedSubmissionIds.length ||
      new Set(queuedSubmissionIds).size !== previous.length ||
      previous.some((message) => !message.serverAccepted || message.status !== 'queued')
    ) return
    const byId = new Map(previous.map((message) => [message.id, message]))
    const reordered = queuedSubmissionIds.map((id) => byId.get(id))
    if (reordered.some((message) => !message)) return
    if (previous.every((message, index) => message.id === queuedSubmissionIds[index])) return
    queueStarts.current.add(operation)
    updateThreadQueue(threadId, () => reordered as QueuedMessage[])
    try {
      await invokeQueueMutation<Record<string, never>>(threadId, 'thread/queue/reorder', {
        threadId,
        queuedSubmissionIds
      })
    } catch (error) {
      updateThreadQueue(threadId, (current) => {
        const currentIds = new Set(current.map((message) => message.id))
        return current.length === previous.length &&
          previous.every((message) => currentIds.has(message.id))
          ? [...previous]
          : [...current]
      })
      setThreadNotice({ message: displayError(error) })
      void refreshThreadQueue(threadId).catch(() => undefined)
    } finally {
      queueStarts.current.delete(operation)
    }
  }

  const resolveQueuedMessage = async (
    threadId: string,
    messageId: string
  ): Promise<QueuedMessage | null> => {
    let message = (queuedMessagesByThreadRef.current[threadId] || []).find(
      (candidate) => candidate.id === messageId
    ) || null
    if (message?.status !== 'outcome-unknown' || message.serverAccepted) return message
    await refreshThreadQueue(threadId)
    message = (queuedMessagesByThreadRef.current[threadId] || []).find(
      (candidate) =>
        candidate.id === messageId ||
        candidate.clientUserMessageId === message?.clientUserMessageId
    ) || null
    return message
  }

  const deleteQueuedFollowUp = async (
    threadId: string,
    messageId: string,
    restoreForEdit = false
  ): Promise<boolean> => {
    const initial = (queuedMessagesByThreadRef.current[threadId] || []).find(
      (message) => message.id === messageId
    )
    if (!initial || initial.status === 'sending') return false
    try {
      const message = await resolveQueuedMessage(threadId, messageId)
      if (!message) return false
      if (message.serverAccepted) {
        const response = await invokeQueueMutation<ThreadQueueDeleteResponse>(
          threadId,
          'thread/queue/delete',
          { threadId, queuedSubmissionId: message.id }
        )
        if (!response.deleted) throw new Error('The queued message could not be deleted.')
      }
      updateThreadQueue(threadId, (current) => removeQueuedMessage(current, message.id))
      if (restoreForEdit) {
        restoreComposerDraft(threadId, message.draftText, message.attachments)
        restoreQueuedComments(threadId, message.comments)
        window.requestAnimationFrame(() => {
          const input = document.querySelector<HTMLTextAreaElement>('.main-panel .composer textarea')
          input?.focus()
          if (input) input.setSelectionRange(input.value.length, input.value.length)
        })
      }
      return true
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
      return false
    }
  }

  const openQueuedFollowUpInSideChat = async (
    threadId: string,
    messageId: string
  ): Promise<void> => {
    const operation = `transfer:${threadId}:${messageId}`
    if (queueStarts.current.has(operation)) return
    const message = await resolveQueuedMessage(threadId, messageId).catch((error) => {
      setThreadNotice({ message: displayError(error) })
      return null
    })
    if (!message || message.status === 'sending' || message.status === 'outcome-unknown') return

    queueStarts.current.add(operation)
    const transferText = queuedMessageTransferText(message).trim()
    // Populate the destination first. If durable deletion fails, keeping both
    // copies is safer than losing a prompt that the user has not sent yet.
    openSideChat()
    if (transferText) {
      setSideChatDraft((current) => current.trim()
        ? `${transferText}\n\n${current}`
        : transferText)
    }
    setSideChatAttachments((current) => mergeComposerAttachments(message.attachments, current))
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('.side-chat-pane .composer textarea')?.focus()
    })

    try {
      const deleted = await deleteQueuedFollowUp(threadId, message.id)
      if (!deleted) {
        setThreadNotice({
          message: '消息已复制到侧边聊天，但仍保留在队列中；确认后可手动删除，避免重复发送。'
        })
      }
    } finally {
      queueStarts.current.delete(operation)
    }
  }

  const startQueuedFollowUp = async (
    threadId: string,
    messageId: string
  ): Promise<void> => {
    const operation = `${threadId}:${messageId}`
    if (queueStarts.current.has(operation)) return
    const message = (queuedMessagesByThreadRef.current[threadId] || []).find(
      (candidate) => candidate.id === messageId
    )
    if (!message?.serverAccepted || message.status === 'sending') return
    queueStarts.current.add(operation)
    updateThreadQueue(threadId, (current) => updateQueuedMessage(
      current,
      messageId,
      (entry) => ({
        ...entry,
        status: 'sending',
        pauseReason: null,
        error: null
      })
    ))
    try {
      const response = await invokeQueueMutation<ThreadQueueStartResponse>(threadId, 'thread/queue/start', {
        threadId,
        queuedSubmissionId: message.id
      })
      updateThreadQueue(threadId, (current) => removeQueuedMessage(current, message.id))
      diffCommentsStore.removeSubmitted(threadId, message.comments)
      dispatch({
        type: 'notification',
        notification: {
          method: 'turn/started',
          params: { threadId, turn: response.turn }
        }
      })
    } catch (error) {
      updateThreadQueue(threadId, (current) => updateQueuedMessage(
        current,
        message.id,
        (entry) => ({
          ...entry,
          status: isUnknownMutationError(error) ? 'outcome-unknown' : 'paused',
          pauseReason: isUnknownMutationError(error) ? null : 'send-failed',
          error: displayError(error)
        })
      ))
      if (isUnknownMutationError(error)) {
        void refreshThreadQueue(threadId).catch(() => undefined)
      }
    } finally {
      queueStarts.current.delete(operation)
    }
  }

  const resumeInterruptedQueue = (threadId: string): void => {
    const first = (queuedMessagesByThreadRef.current[threadId] || [])[0]
    if (!first?.serverAccepted || first.status !== 'paused') return
    updateThreadQueue(threadId, (current) => updateQueuedMessage(
      current,
      first.id,
      (message) => ({
        ...message,
        status: 'queued',
        pauseReason: null,
        error: null
      })
    ))
    void startQueuedFollowUp(threadId, first.id)
  }

  const sendQueuedFollowUpNow = async (
    threadId: string,
    messageId: string
  ): Promise<void> => {
    const message = await resolveQueuedMessage(threadId, messageId).catch((error) => {
      setThreadNotice({ message: displayError(error) })
      return null
    })
    if (!message || message.status === 'sending') return
    const session = stateRef.current.sessions[threadId]
    const turnId = interruptibleTurnId(session?.activeTurnId)
    if (!session?.running || !turnId) {
      await startQueuedFollowUp(threadId, message.id)
      return
    }

    const operation = `${threadId}:${message.id}`
    if (queueStarts.current.has(operation)) return
    queueStarts.current.add(operation)
    updateThreadQueue(threadId, (current) => updateQueuedMessage(
      current,
      message.id,
      (entry) => ({
        ...entry,
        status: 'sending',
        pauseReason: null,
        error: null
      })
    ))
    dispatch({
      type: 'optimisticSteer',
      threadId,
      turnId,
      clientId: message.clientUserMessageId,
      text: message.text,
      input: message.input
    })
    let steerAccepted = false
    try {
      const response = await window.codex.invoke<{ turnId: string }>('turn/steer', {
        threadId,
        input: message.input,
        expectedTurnId: turnId,
        clientUserMessageId: message.clientUserMessageId
      }, hostIdForThreadId(threadId))
      if (response.turnId !== turnId) {
        throw new Error('The active turn changed before the queued message was accepted.')
      }
      steerAccepted = true
      dispatch({
        type: 'steerAccepted',
        threadId,
        turnId,
        clientId: message.clientUserMessageId
      })
      diffCommentsStore.removeSubmitted(threadId, message.comments)
      if (message.serverAccepted) {
        const deleted = await invokeQueueMutation<ThreadQueueDeleteResponse>(
          threadId,
          'thread/queue/delete',
          { threadId, queuedSubmissionId: message.id }
        )
        if (!deleted.deleted) throw new Error('The steered message remained in the queue.')
      }
      updateThreadQueue(threadId, (current) => removeQueuedMessage(current, message.id))
    } catch (error) {
      if (!steerAccepted) {
        dispatch({
          type: isUnknownMutationError(error) ? 'steerUnknown' : 'steerFailed',
          threadId,
          turnId,
          clientId: message.clientUserMessageId,
          message: displayError(error)
        })
      }
      updateThreadQueue(threadId, (current) => updateQueuedMessage(
        current,
        message.id,
        (entry) => ({
          ...entry,
          status: isUnknownMutationError(error) || steerAccepted ? 'outcome-unknown' : 'paused',
          pauseReason: isUnknownMutationError(error) || steerAccepted ? null : 'send-failed',
          error: displayError(error)
        })
      ))
      if (isUnknownMutationError(error) || steerAccepted) {
        void refreshThreadQueue(threadId).catch(() => undefined)
      }
    } finally {
      queueStarts.current.delete(operation)
    }
  }

  const resetSideChat = (open: boolean): void => {
    sideChatGeneration.current += 1
    const transientThreadId = sideChatThreadIdRef.current
    if (transientThreadId) {
      const sideRequestPartition = partitionServerRequestsForThread(
        serverRequestQueueRef.current,
        transientThreadId
      )
      if (sideRequestPartition.requests.length) {
        updateServerRequestQueue(() => sideRequestPartition.remaining)
        for (const request of sideRequestPartition.requests) {
          void window.codex.respondToServerRequest(
            request.id,
            rejectedSideChatRequestResponse(request),
            request.hostId
          ).catch(() => undefined)
        }
      }
      const pending = requestPendingInterrupt(
        pendingSideChatStart.current,
        transientThreadId
      )
      const activeTurnId = interruptibleTurnId(
        stateRef.current.sessions[transientThreadId]?.activeTurnId
      )
      if (activeTurnId && (!pending || !pending.interruptSent)) {
        if (pending) pending.interruptSent = true
        void window.codex.invoke('turn/interrupt', {
          threadId: transientThreadId,
          turnId: activeTurnId
        }, hostIdForThreadId(transientThreadId)).catch(() => undefined)
      }
    }
    sideChatThreadIdRef.current = null
    sideChatOpenRef.current = open
    if (transientThreadId) {
      discardedSideChatThreadIds.current.add(transientThreadId)
      dispatch({ type: 'transientThreadRemoved', threadId: transientThreadId })
    }
    setSideChatOpen(open)
    setSideChatThreadId(null)
    setSideChatDraft('')
    setSideChatAttachments([])
    setSideChatAttachmentError(null)
    setSideChatStarting(false)
  }

  const showRightTabContent = (id: RightWorkbenchTabId): void => {
    const value = rightWorkbenchTabValue(id)
    const kind = rightWorkbenchTabKind(id)
    if (kind === 'workspace') {
      if (!workspaceOpen) window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT))
      window.dispatchEvent(new CustomEvent(ACTIVATE_WORKSPACE_TAB_EVENT, { detail: value }))
    } else if (kind === 'subagent') {
      setActiveSubagentId(value)
    } else if (kind === 'terminal') {
      terminalController.select(value)
    }
  }
  const activateRightTab = (id: RightWorkbenchTabId): void => {
    setRightWorkbenchView((current) => activateRightWorkbenchSurface(current))
    setRightWorkbenchTabs((current) => activateRightWorkbenchTab(current, id))
    showRightTabContent(id)
  }
  const activateAdjacentAfterClose = (next: RightWorkbenchTabsState, closedId: RightWorkbenchTabId): void => {
    const wasActive = rightWorkbenchTabsRef.current.activeId === closedId
    setRightWorkbenchTabs(next)
    if (wasActive && next.activeId && !rightWorkbenchChatSelected) showRightTabContent(next.activeId)
  }
  const openSideChat = (): void => {
    if (!sideChatOpenRef.current) resetSideChat(true)
    activateRightTab('side-chat')
  }
  const closeSideChat = (): void => {
    const previous = rightWorkbenchTabsRef.current
    const next = closeRightWorkbenchTab(previous, 'side-chat')
    resetSideChat(false)
    activateAdjacentAfterClose(next, 'side-chat')
  }
  const openNewWorkbenchTab = (url?: string, ownerScope = workbenchSessions.scope): void => {
    const browserCount = Object.values(workbenchSessions.getSnapshot()).reduce((count, session) => count + session.browsers.length, 0)
    if (browserCount >= 16) { setThreadNotice({ message: '最多可打开16个浏览器标签页' }); return }
    const tab = createWorkbenchBrowserTab()
    workbenchSessions.update('browsers', (current) => [...current, tab], ownerScope)
    if (ownerScope === workbenchSessions.scope) activateRightTab(browserWorkbenchTabId(tab.id))
    else workbenchSessions.update('tabs', (current) => openRightWorkbenchTab(current, browserWorkbenchTabId(tab.id), false), ownerScope)
    if (url) {
      void window.codex.createBrowserView(tab.id)
        .then((created) => {
          workbenchSessions.updateBrowser(created)
          return window.codex.navigateBrowserView(tab.id, url)
        })
        .catch((error) => setThreadNotice({message: displayError(error)}))
    }
  }
  const closeBrowserTab = (id: string): void => {
    const workbenchId = browserWorkbenchTabId(id)
    const previous = rightWorkbenchTabsRef.current
    const next = closeRightWorkbenchTab(previous, workbenchId)
    setBrowserTabs((current) => current.filter((tab) => tab.id !== id))
    void window.codex.closeBrowserView(id).catch(() => undefined)
    activateAdjacentAfterClose(next, workbenchId)
  }
  const consumeWorkbenchLauncher = (
    tab: WorkbenchBrowserTab,
    tool: WorkbenchLauncherTool
  ): void => {
    const strategy = workbenchLauncherSelectionStrategy(
      tab,
      rightWorkbenchTabsRef.current,
      tool
    )
    if (strategy.closeBrowserTabId) closeBrowserTab(strategy.closeBrowserTabId)
  }
  const openSubagent = (threadId: string, name: string): void => {
    setOpenedSubagents((current) => current.some((entry) => entry.threadId === threadId)
      ? current.map((entry) => entry.threadId === threadId ? { ...entry, name } : entry)
      : [...current, { threadId, name }])
    setActiveSubagentId(threadId)
    activateRightTab(subagentWorkbenchTabId(threadId))
  }
  const closeSubagent = (threadId = activeSubagentId): void => {
    if (!threadId) return
    const remaining = openedSubagents.filter((entry) => entry.threadId !== threadId)
    setOpenedSubagents(remaining)
    const workbenchId = subagentWorkbenchTabId(threadId)
    const previous = rightWorkbenchTabsRef.current
    const next = closeRightWorkbenchTab(previous, workbenchId)
    if (threadId === activeSubagentId) {
      const adjacent = next.activeId && rightWorkbenchTabKind(next.activeId) === 'subagent'
        ? rightWorkbenchTabValue(next.activeId) : null
      setActiveSubagentId(adjacent)
    }
    activateAdjacentAfterClose(next, workbenchId)
  }
  const activateWorkspace = (): void => {
    const layoutMode = selectedThread
      ? workspaceLayouts[selectedThread.id] || 'split'
      : newThreadWorkspaceLayout
    if (layoutMode === 'full' || rightWorkbenchFullView) {
      setRightWorkbenchView(enterRightWorkbenchFullView())
    }
    if (!workspaceOpen) window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT))
    activateRightTab(workspaceWorkbenchTabId(workspaceChromeState.activeTabId))
  }
  const collapseRightWorkbench = (): void => {
    setRightWorkbenchView(collapseRightWorkbenchView())
    setProjectSummaryPopoverOpen(false)
    if (selectedThread && (workspaceLayouts[selectedThread.id] || 'split') === 'full') {
      setWorkspaceLayouts((layouts) => ({ ...layouts, [selectedThread.id]: 'split' }))
    } else if (!selectedThread && newThreadWorkspaceLayout === 'full') {
      setNewThreadWorkspaceLayout('split')
    }
  }
  const toggleRightWorkbenchFullView = (): void => {
    setRightWorkbenchView((current) => toggleRightWorkbenchViewFull(current))
    setProjectSummaryPopoverOpen(false)
  }
  const showRightWorkbenchChat = (): void => {
    setRightWorkbenchView((current) => selectRightWorkbenchChat(
      current.mode === 'full' ? current : enterRightWorkbenchFullView()
    ))
    setProjectSummaryPopoverOpen(false)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('.main-panel .composer textarea')?.focus()
    })
  }
  const handleWorkspaceExpandedChange = (open: boolean): void => {
    if (open === workspaceOpen) return
    workspaceOwnerScopeRef.current = open ? rightWorkbenchScope : null
    setWorkspaceOpen(open)
    if (open) {
      const layoutMode = selectedThread
        ? workspaceLayouts[selectedThread.id] || 'split'
        : newThreadWorkspaceLayout
      if (layoutMode === 'full' || rightWorkbenchFullView) {
        setRightWorkbenchView(enterRightWorkbenchFullView())
      }
      activateRightTab(workspaceWorkbenchTabId(workspaceChromeState.activeTabId))
      return
    }
    const previous = rightWorkbenchTabsRef.current
    const available = previous.order.filter((id) => rightWorkbenchTabKind(id) !== 'workspace')
    const next = reconcileRightWorkbenchTabs(previous, available)
    if (previous.activeId && rightWorkbenchTabKind(previous.activeId) === 'workspace' && next.activeId) activateRightTab(next.activeId)
    else setRightWorkbenchTabs(next)
  }
  const handleWorkspaceLayoutModeChange = (mode: WorkspaceLayoutMode): void => {
    if (selectedThread) {
      setWorkspaceLayouts((layouts) => ({...layouts, [selectedThread.id]: mode}))
    } else {
      setNewThreadWorkspaceLayout(mode)
    }
    setRightWorkbenchView(mode === 'full'
      ? enterRightWorkbenchFullView()
      : {mode: 'split'})
  }

  const handleWorkspaceChromeStateChange = (nextChrome: WorkspaceChromeState): void => {
    setWorkspaceChromeState(nextChrome)
    setRightWorkbenchTabs((current) => {
      const available = [
        ...current.order.filter((id) => rightWorkbenchTabKind(id) !== 'workspace'),
        ...nextChrome.tabs.map((tab) => workspaceWorkbenchTabId(tab.id))
      ]
      const reconciled = reconcileRightWorkbenchTabs(current, available)
      return workspaceOpen && current.activeId && rightWorkbenchTabKind(current.activeId) === 'workspace'
        ? activateRightWorkbenchTab(reconciled, workspaceWorkbenchTabId(nextChrome.activeTabId))
        : reconciled
    })
  }

  const closeRightTab = (id: RightWorkbenchTabId): void => {
    const kind = rightWorkbenchTabKind(id)
    const value = rightWorkbenchTabValue(id)
    if (kind === 'subagent') { closeSubagent(value); return }
    if (kind === 'side-chat') { closeSideChat(); return }
    if (kind === 'browser') { closeBrowserTab(value); return }
    if (kind === 'terminal') {
      const previous = rightWorkbenchTabsRef.current
      const next = closeRightWorkbenchTab(previous, id)
      void terminalController.close(value)
      activateAdjacentAfterClose(next, id)
      return
    }
    const previous = rightWorkbenchTabsRef.current
    const next = closeRightWorkbenchTab(previous, id)
    activateAdjacentAfterClose(next, id)
    window.dispatchEvent(new CustomEvent(CLOSE_WORKSPACE_TAB_EVENT, { detail: value }))
  }

  const availableRightWorkbenchTabs = useMemo<RightWorkbenchTabId[]>(() => [
    ...(workspaceOpen ? workspaceChromeState.tabs.map((tab) => workspaceWorkbenchTabId(tab.id)) : []),
    ...openedSubagents.map((tab) => subagentWorkbenchTabId(tab.threadId)),
    ...(sideChatOpen ? ['side-chat' as const] : []),
    ...browserTabs.map((tab) => browserWorkbenchTabId(tab.id)),
    ...terminalState.tabs.filter((tab) => tab.placement === 'right').map((tab) => `terminal:${tab.id}` as const)
  ], [browserTabs, openedSubagents, sideChatOpen, terminalState.tabs, workspaceChromeState.tabs, workspaceOpen])

  useEffect(() => {
    setRightWorkbenchTabs((current) => reconcileRightWorkbenchTabs(current, availableRightWorkbenchTabs))
  }, [availableRightWorkbenchTabs])

  useEffect(() => {
    if (availableRightWorkbenchTabs.length > 0) return
    setRightWorkbenchView(collapseRightWorkbenchView())
  }, [availableRightWorkbenchTabs.length])

  useEffect(() => {
    const currentScope = rightWorkbenchScope
    const layout = workspaceLayoutForRightWorkbenchView(
      rightWorkbenchView,
      workspaceOpen && workspaceOwnerScopeRef.current === currentScope
    )
    if (!layout) return
    if (selectedThread) {
      setWorkspaceLayouts((layouts) => layouts[selectedThread.id] === layout
        ? layouts
        : {...layouts, [selectedThread.id]: layout})
    } else {
      setNewThreadWorkspaceLayout((current) => current === layout ? current : layout)
    }
  }, [rightWorkbenchView, selectedThread, workspaceOpen, rightWorkbenchScope])

  useEffect(() => {
    const terminalId = terminalState.visible.right ? terminalState.active.right : null
    const next = { scope: rightWorkbenchScope, id: terminalId }
    const activate = shouldActivateWorkbenchTerminal(terminalWorkbenchSelectionRef.current, next)
    terminalWorkbenchSelectionRef.current = next
    if (activate && terminalId) activateRightTab(`terminal:${terminalId}`)
  }, [rightWorkbenchScope, terminalState.active.right, terminalState.visible.right])

  useEffect(() => window.codex.onBrowserViewEvent((event: BrowserViewEvent) => {
    if (event.type === 'open-new-tab') {
      const ownerScope = workbenchSessions.browserOwner(event.sourceId)
      if (ownerScope) openNewWorkbenchTab(event.url, ownerScope)
      return
    }
    if (event.type === 'state') workbenchSessions.updateBrowser(event.state)
  }), [])


  useEffect(() => {
    localStorage.setItem(THREAD_PREFERENCES_KEY, JSON.stringify(threadPreferences))
  }, [threadPreferences])

  useEffect(() => {
    localStorage.setItem(QUEUEING_ENABLED_KEY, String(queueingEnabled))
  }, [queueingEnabled])

  useEffect(() => {
    localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(savedProjectPaths))
  }, [savedProjectPaths])

  useEffect(() => {
    localStorage.setItem('codex-sidebar-open', String(sidebarOpen))
  }, [sidebarOpen])

  useEffect(() => {
    if (modelId) localStorage.setItem(MODEL_PREFERENCE_KEY, modelId)
  }, [modelId])

  useEffect(() => {
    const syncPreferences = (event: StorageEvent): void => {
      if (event.key === THREAD_PREFERENCES_KEY) {
        setThreadPreferences(parseThreadPreferences(event.newValue))
      } else if (event.key === SAVED_PROJECTS_KEY) {
        setSavedProjectPaths(parseSavedProjectPaths(event.newValue))
      } else if (event.key === 'codex-sidebar-open') {
        setSidebarOpen(event.newValue !== 'false')
      }
    }
    window.addEventListener('storage', syncPreferences)
    return () => window.removeEventListener('storage', syncPreferences)
  }, [])

  useEffect(() => {
    if (!threadNotice) return
    const timer = window.setTimeout(
      () => setThreadNotice(null),
      threadNotice.removedProject ? 60_000 : 8_000
    )
    return () => window.clearTimeout(timer)
  }, [threadNotice])

  useEffect(() => {
    const unsubscribeNotification = window.codex.onNotification((notification) => {
      const params =
        notification.params && typeof notification.params === 'object' && !Array.isArray(notification.params)
          ? (notification.params as Record<string, unknown>)
          : null
      const notificationThreadId =
        params && typeof params.threadId === 'string'
          ? params.threadId
          : params?.thread &&
              typeof params.thread === 'object' &&
              !Array.isArray(params.thread) &&
              typeof (params.thread as Record<string, unknown>).id === 'string'
            ? ((params.thread as Record<string, unknown>).id as string)
            : null
      if (
        notificationThreadId &&
        discardedSideChatThreadIds.current.has(notificationThreadId)
      ) {
        return
      }
      if (notificationThreadId &&
        (notification.method === 'thread/archived' || notification.method === 'thread/deleted')) {
        invalidateRemovedThreadSelection(notificationThreadId)
      }
      if (notification.method === 'thread/goal/updated') {
        const goal = threadGoalFromUnknown(params?.goal)
        if (goal) {
          acceptThreadGoal(
            goal,
            typeof params?.turnId === 'string'
              ? params.turnId
              : params && Object.prototype.hasOwnProperty.call(params, 'turnId')
                ? null
                : undefined
          )
        }
      } else if (notification.method === 'thread/goal/cleared' && notificationThreadId) {
        clearThreadGoal(notificationThreadId)
      }
      if (notification.method === 'thread/queue/changed' && notificationThreadId) {
        // Invalidates an in-flight list response and makes its loader take a
        // fresh pass instead of briefly publishing a pre-notification snapshot.
        bumpThreadQueueRevision(notificationThreadId)
        void refreshThreadQueue(notificationThreadId).catch(() => undefined)
      }
      dispatch({ type: 'notification', notification })
      const notificationItem =
        params?.item && typeof params.item === 'object' && !Array.isArray(params.item)
          ? (params.item as Record<string, unknown>)
          : null
      if (
        notification.method === 'item/started' &&
        notificationThreadId &&
        notificationItem?.type === 'contextCompaction'
      ) {
        setCompactingThreadIds((ids) =>
          ids.includes(notificationThreadId) ? ids : [...ids, notificationThreadId]
        )
      }
      if (
        notificationThreadId &&
        (notification.method === 'turn/completed' ||
          (notification.method === 'item/completed' &&
            notificationItem?.type === 'contextCompaction'))
      ) {
        setCompactingThreadIds((ids) => ids.filter((id) => id !== notificationThreadId))
      }
      if (
        notification.method === 'turn/completed' &&
        notificationThreadId &&
        notificationThreadId !== selectedThreadIdRef.current &&
        notificationThreadId !== sideChatThreadIdRef.current &&
        !stateRef.current.transientThreads[notificationThreadId]
      ) {
        setThreadPreferences((current) =>
          setThreadUnread(current, notificationThreadId, true)
        )
      }
      if (notification.method === 'thread/deleted' && notificationThreadId) {
        const scope = terminalScopes.current.get(notificationThreadId) || notificationThreadId
        for (const id of workbenchSessions.remove(scope)) void window.codex.closeBrowserView(id).catch(() => undefined)
        if (notificationThreadId === sideChatThreadIdRef.current) closeSideChat()
        pendingSteerRecoveries.current.delete(notificationThreadId)
        bumpThreadQueueRevision(notificationThreadId)
        queueLoads.current.delete(notificationThreadId)
        for (const operation of queueStarts.current) {
          if (operation.startsWith(`${notificationThreadId}:`)) queueStarts.current.delete(operation)
        }
        updateThreadQueue(notificationThreadId, () => [])
        threadGoalRevisions.current.delete(notificationThreadId)
        for (const key of automaticGoalClears.current) {
          if (key.startsWith(`${notificationThreadId}:`)) automaticGoalClears.current.delete(key)
        }
        setThreadGoals((goals) => {
          if (!(notificationThreadId in goals)) return goals
          const next = { ...goals }
          delete next[notificationThreadId]
          return next
        })
        setCompletedGoalTurnAnchors((anchors) => {
          if (!(notificationThreadId in anchors)) return anchors
          const next = { ...anchors }
          delete next[notificationThreadId]
          return next
        })
        setComposerDrafts((drafts) => {
          if (!(notificationThreadId in drafts)) return drafts
          const next = { ...drafts }
          delete next[notificationThreadId]
          return next
        })
        setArchivedThreads((threads) =>
          threads.filter((thread) => thread.id !== notificationThreadId)
        )
        setThreadPreferences((current) =>
          removeThreadPreferences(current, [notificationThreadId])
        )
      } else if (notification.method === 'thread/unarchived' && notificationThreadId) {
        removedThreadIds.current.delete(notificationThreadId)
        setArchivedThreads((threads) =>
          threads.filter((thread) => thread.id !== notificationThreadId)
        )
      } else if (
        notification.method === 'thread/name/updated' &&
        notificationThreadId &&
        typeof params?.threadName === 'string' &&
        params.threadName.trim()
      ) {
        const nextName = params.threadName.trim()
        setArchivedThreads((threads) =>
          threads.map((thread) =>
            thread.id === notificationThreadId ? { ...thread, name: nextName } : thread
          )
        )
      }
      const resolvedId = resolvedServerRequestId(notification)
      if (resolvedId !== null) {
        updateServerRequestQueue((queue) => removeServerRequest(queue, resolvedId))
        setServerRequestError(null)
      }
    })
    const unsubscribeServerRequest = window.codex.onServerRequest(handleServerRequest)
    const unsubscribeStatus = window.codex.onBackendStatus(setBackend)
    return () => {
      unsubscribeNotification()
      unsubscribeServerRequest()
      unsubscribeStatus()
    }
  }, [])

  useEffect(() => {
    const hostId = appContextHostId(context)
    let cancelled = false
    updateServerRequestQueue((queue) => queue.filter((request) => (request.hostId || 'local') === hostId))
    setServerRequestError(null)
    void window.codex.listPendingServerRequests(hostId).then((requests) => {
      if (!cancelled) requests.forEach(handleServerRequest)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [context?.hostId])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async (): Promise<void> => {
      const initialRoute = {revision: navigationActionRevision.current, scope: draftTerminalScopeRef.current}
      const ownsInitialRoute = (): boolean => !cancelled && canRestoreInitialProject(initialRoute, {
        revision: navigationActionRevision.current, scope: draftTerminalScopeRef.current,
        selectedThreadId: selectedThreadIdRef.current, activeSubmissionId: activeMainSubmission.current
      })
      try {
        const appContext = await window.codex.getAppContext()
        if (cancelled) return
        const currentSurface = currentNavigationEntry(navigationRef.current)
        const needsBackgroundDefault = !contextRef.current && !selectedThreadIdRef.current &&
          !activeMainSubmission.current && currentSurface?.view !== 'chats'
        if (ownsInitialRoute() || needsBackgroundDefault) {
          await window.codex.setActiveHost('local')
          if (cancelled) return
          if (ownsInitialRoute() || (needsBackgroundDefault && navigationActionRevision.current === initialRoute.revision)) {
            setContext(appContext)
            setNavigation((history) => {
              if (needsBackgroundDefault) return {...history, entries: history.entries.map((entry) =>
                entry.view === 'chats' && entry.threadId === null && entry.draftId === initialRoute.scope && entry.cwd === null
                  ? {...entry, cwd: appContext.cwd, ...navigationWorkspaceFields(appContext)} : entry)}
              const current = currentNavigationEntry(history)
              return current?.view === 'chats' && current.threadId === null && current.cwd === null
                ? replaceCurrentNavigationEntry(history, {
                    ...current, cwd: appContext.cwd, ...navigationWorkspaceFields(appContext)
                  }) : history
            })
          }
        }
        const [threadPage, projectPage, modelPage] = await Promise.all([
          window.codex.invoke<Page<Thread>>('thread/list', {
            limit: 50,
            sortKey: 'recency_at',
            sortDirection: 'desc'
          }),
          window.codex.invoke<Page<Project>>('project/list', {
            limit: 100,
            sortKey: 'position',
            sortDirection: 'asc'
          }).catch(() => ({ data: [] })),
          window.codex.invoke<Page<ModelOption>>('model/list', { limit: 100 })
        ])
        if (cancelled) return
        const catalog = overlayProjectPreferences(projectCatalogForSavedPaths(projectPage.data, savedProjectPaths), projectPreferences)
        const initialPath = initialProjectPath(appContext, catalog, parseSelectedProject(localStorage.getItem(SELECTED_PROJECT_KEY)))
        if (initialPath && ownsInitialRoute()) {
          try {
            const restoredContext = await window.codex.getAppContext(initialPath)
            if (ownsInitialRoute()) {
              await window.codex.setActiveHost('local')
              if (ownsInitialRoute()) {
                setContext(restoredContext)
                rememberSelectedProject(localStorage, restoredContext.cwd)
                setNavigation((history) => {
                  const current = currentNavigationEntry(history)
                  return current?.view === 'chats' && current.threadId === null && current.draftId === initialRoute.scope
                    ? replaceCurrentNavigationEntry(history, {
                        ...current, cwd: restoredContext.cwd, ...navigationWorkspaceFields(restoredContext)
                      }) : history
                })
              }
            }
          } catch { /* A missing project does not block catalog and model startup. */ }
        }
        const backendStatus = await window.codex.getBackendStatus()
        if (cancelled) return
        setBackend(backendStatus)
        dispatch({ type: 'threadsLoaded', threads: threadPage.data })
        setThreadsNextCursor(threadPage.nextCursor || null)
        seenThreadCursors.current.clear()
        if (threadPage.nextCursor) seenThreadCursors.current.add(threadPage.nextCursor)
        setProjects(projectPage.data)
        dispatch({ type: 'modelsLoaded', models: modelPage.data })
        setBootstrapReady(true)

        const initialModel = selectInitialModel(
          modelPage.data,
          localStorage.getItem(MODEL_PREFERENCE_KEY),
          threadPage.data
        )
        if (initialModel) {
          setModelId(initialModel.model.id)
          setEffort(initialModel.effort)
        }
      } catch (error) {
        if (!cancelled) {
          setBackend({ state: 'error', mode: 'direct', message: displayError(error) })
          dispatch({ type: 'threadsLoaded', threads: [] })
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.codex.onRemoteConnectionsChanged((connections) => {
      if (cancelled) return
      setRemoteConnections(connections)
      void window.codex.listRemoteProjects().then((catalog) => {
        if (!cancelled) setRemoteProjects(catalog)
      }).catch(() => undefined)
    })
    void Promise.all([
      window.codex.listRemoteConnections(),
      window.codex.listRemoteProjects()
    ]).then(([connections, remoteCatalog]) => {
      if (cancelled) return
      setRemoteConnections(connections)
      setRemoteProjects(remoteCatalog)
      for (const connection of connections) {
        void window.codex.connectRemoteConnection(connection.hostId).catch(() => undefined)
      }
    }).catch((error) => {
      if (!cancelled) setThreadNotice({message: displayError(error)})
    }).finally(() => {
      if (!cancelled) setRemoteCatalogLoaded(true)
    })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  useEffect(() => {
    const cwd = context?.cwd
    const hostId = appContextHostId(context)
    if (!bootstrapReady || backend.state !== 'ready' || !cwd) return
    let cancelled = false
    void window.codex.invoke<Page<PermissionProfile>>('permissionProfile/list', {cwd}, hostId).then((page) => {
      if (cancelled || contextRef.current?.cwd !== cwd) return
      dispatch({type: 'permissionProfilesLoaded', profiles: page.data})
      setPermission((current) => {
        if (page.data.some((profile) => profile.id === current && profile.allowed)) return current
        return page.data.find((profile) => profile.id === ':workspace' && profile.allowed)?.id ||
          page.data.find((profile) => profile.allowed)?.id || current
      })
    }).catch((error) => {
      if (!cancelled && contextRef.current?.cwd === cwd) setAttachmentError(displayError(error))
    })
    return () => { cancelled = true }
  }, [bootstrapReady, backend.state, context?.cwd, context?.hostId])

  useEffect(() => {
    if (catalogView !== 'archived' || backend.state !== 'ready') return
    let cancelled = false
    setCatalogError(null)
    setArchivedLoading(true)

    const hostId = appContextHostId(contextRef.current)
    void window.codex.invoke<Page<Thread>>('thread/list', {
      archived: true,
      limit: 50,
      sortKey: 'recency_at',
      sortDirection: 'desc'
    }, hostId).then((page) => {
      if (cancelled) return
      setArchivedThreads(page.data)
      setArchivedNextCursor(page.nextCursor || null)
      seenArchivedCursors.current.clear()
      if (page.nextCursor) seenArchivedCursors.current.add(page.nextCursor)
    }).catch((error) => {
      if (!cancelled) setCatalogError(displayError(error))
    }).finally(() => {
      if (!cancelled) setArchivedLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [backend.state, catalogView, context?.hostId])

  useEffect(() => {
    const query = search.trim()
    const sequence = ++searchSequence.current
    if (!searching || !query) {
      setSearchResults(null)
      setSearchNextCursor(null)
      setSearchLoading(false)
      seenSearchCursors.current.clear()
      return
    }

    setSearchLoading(true)
    setCatalogError(null)
    const hostId = appContextHostId(contextRef.current)
    const timer = window.setTimeout(() => {
      void window.codex.invoke<ThreadSearchPage>('thread/search', {
        searchTerm: query,
        limit: 50,
        sortKey: 'recency_at',
        sortDirection: 'desc',
        archived: catalogView === 'archived'
      }, hostId).then((page) => {
        if (sequence !== searchSequence.current) return
        setSearchResults(page.data)
        setSearchNextCursor(page.nextCursor || null)
        seenSearchCursors.current.clear()
        if (page.nextCursor) seenSearchCursors.current.add(page.nextCursor)
      }).catch((error) => {
        if (sequence === searchSequence.current) setCatalogError(displayError(error))
      }).finally(() => {
        if (sequence === searchSequence.current) setSearchLoading(false)
      })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [catalogView, search, searching, context?.hostId])

  useEffect(() => {
    if (!selectedModel) return
    const supportsEffort = selectedModel.supportedReasoningEfforts.some(
      (item) => item.reasoningEffort === effort
    )
    if (!supportsEffort) setEffort(selectedModel.defaultReasoningEffort)
  }, [effort, selectedModel])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      if (event.metaKey && key === ',') { event.preventDefault(); nativeActions.current.command('show-settings') }
      else if (event.metaKey && key === 'n') { event.preventDefault(); nativeActions.current.command('new-chat') }
      else if (event.metaKey && key === 'b') { event.preventDefault(); nativeActions.current.command('toggle-sidebar') }
      else if (event.metaKey && key === 'k') { event.preventDefault(); nativeActions.current.command('focus-search') }
      else if (event.metaKey && key === '[') { event.preventDefault(); nativeActions.current.command('navigate-back') }
      else if (event.metaKey && key === ']') { event.preventDefault(); nativeActions.current.command('navigate-forward') }
      else if (event.metaKey && key === 'j') { event.preventDefault(); nativeActions.current.command('toggle-bottom-panel') }
      else if (event.ctrlKey && event.code === 'Backquote') { event.preventDefault(); nativeActions.current.command('toggle-terminal') }
    }
    window.addEventListener('keydown', onKeyDown)
    const unsubscribe = window.codex.onAppCommand((command) => nativeActions.current.command(command))
    return () => { window.removeEventListener('keydown', onKeyDown); unsubscribe() }
  }, [])

  const settlePendingSteerFromTurns = (threadId: string, turns: Turn[]): void => {
    const recovery = pendingSteerRecoveries.current.get(threadId)
    if (!recovery) return
    if (hasAuthoritativeClientMessage(turns, recovery.clientId)) {
      pendingSteerRecoveries.current.delete(threadId)
      diffCommentsStore.removeSubmitted(threadId, recovery.comments)
      dispatch({
        type: 'steerAccepted',
        threadId,
        turnId: recovery.turnId,
        clientId: recovery.clientId
      })
      return
    }
    const target = turns.find((turn) => turn.id === recovery.turnId)
    if (!target || !isTerminalTurnStatus(target.status)) return
    pendingSteerRecoveries.current.delete(threadId)
    dispatch({
      type: 'steerFailed',
      threadId,
      turnId: recovery.turnId,
      clientId: recovery.clientId,
      message: '后续消息未被接受，已恢复到输入框。'
    })
    restoreComposerDraft(threadId, recovery.text, recovery.attachments)
  }

  const loadHostCatalog = async (hostId: string): Promise<{
    threads: Page<Thread>
    models: Page<ModelOption>
    status: BackendStatus
  }> => {
    const [threads, models, status] = await Promise.all([
      window.codex.invoke<Page<Thread>>('thread/list', {
        limit: 50,
        sortKey: 'recency_at',
        sortDirection: 'desc'
      }, hostId),
      window.codex.invoke<Page<ModelOption>>('model/list', {limit: 100}, hostId),
      window.codex.getBackendStatus(hostId)
    ])
    return {threads, models, status}
  }

  const applyHostCatalog = (
    hostId: string,
    catalog: {threads: Page<Thread>; models: Page<ModelOption>; status: BackendStatus}
  ): void => {
    const threads = hostId === 'local'
      ? catalog.threads.data
      : catalog.threads.data.map((thread) => ({...thread, hostId}))
    dispatch({type: 'threadsAppended', threads})
    dispatch({type: 'modelsLoaded', models: catalog.models.data})
    setThreadsNextCursor(catalog.threads.nextCursor || null)
    seenThreadCursors.current.clear()
    if (catalog.threads.nextCursor) seenThreadCursors.current.add(catalog.threads.nextCursor)
    setBackend(catalog.status)
  }

  const localContextForThread = async (thread: Pick<Thread, 'cwd' | 'projectId'>): Promise<AppContext> => {
    const next = await window.codex.getAppContext(thread.cwd)
    const localProjects = projectCatalogForSavedPaths(projects, savedProjectPaths)
    const projectKind = localThreadProjectKind(thread, localProjects, savedProjectPaths)
    return projectKind === 'projectless'
      ? asProjectlessContext(next)
      : {...next, projectKind: 'local', projectId: thread.projectId ?? null}
  }

  const selectThread = async (thread: Thread, record = true): Promise<boolean> => {
    const hostId = threadHostId(thread)
    const previousHostId = appContextHostId(contextRef.current)
    let remoteProject = hostId === 'local' ? undefined : remoteProjects.find((project) =>
      project.hostId === hostId && (project.id === thread.projectId || project.remotePath === thread.cwd))
    const initialProjectKind = hostId === 'local'
      ? localThreadProjectKind(
          thread,
          projectCatalogForSavedPaths(projects, savedProjectPaths),
          savedProjectPaths
        )
      : 'remote'
    removedThreadIds.current.delete(thread.id)
    if (record) markNavigationAction()
    const sequence = ++selectSequence.current
    const baselineTurns = stateRef.current.sessions[thread.id]?.turns || []
    const baselineTurnIds = baselineTurns.map((turn) => turn.id)
    const preserveTurnIds = baselineTurns
      .filter((turn) => turn.id.startsWith('local-') || turn.status === 'inProgress')
      .map((turn) => turn.id)
    setPrimaryView('chats')
    setSettingsOpen(false)
    setTerminalSheetOpen(false)
    if (record) setNavigation((history) => pushNavigationEntry(history, {
      view: 'chats', threadId: thread.id, cwd: thread.cwd || context?.cwd || null, hostId,
      projectKind: initialProjectKind,
      projectId: hostId === 'local'
        ? (initialProjectKind === 'local' ? thread.projectId ?? null : null)
        : remoteProject?.id ?? null
    }))
    closeSideChat()
    setLoadedThreadId(null)
    setResumedThreadId(null)
    setHistoryNextCursor(null)
    setHistoryLoadingEarlier(false)
    setHistoryError(null)
    seenHistoryCursors.current.clear()
    setThreadPreferences((current) => setThreadUnread(current, thread.id, false))
    selectedThreadIdRef.current = thread.id
    dispatch({ type: 'selectThread', threadId: thread.id })
    setAttachmentError(null)
    setHydrating(true)
    setModelId(thread.model || modelId)
    if (thread.reasoningEffort) setEffort(thread.reasoningEffort)

    let nextContext: AppContext
    try {
      nextContext = hostId === 'local'
        ? await localContextForThread(thread)
        : await window.codex.getRemoteAppContext(hostId, thread.cwd, remoteProject?.id)
      if (sequence !== selectSequence.current || selectedThreadIdRef.current !== thread.id) return false
      let hostCatalog: Awaited<ReturnType<typeof loadHostCatalog>> | null = null
      if (hostId !== previousHostId) {
        hostCatalog = await loadHostCatalog(hostId)
        if (sequence !== selectSequence.current || selectedThreadIdRef.current !== thread.id) return false
      }
      await window.codex.setActiveHost(hostId)
      if (sequence !== selectSequence.current || selectedThreadIdRef.current !== thread.id) return false
      if (hostCatalog) applyHostCatalog(hostId, hostCatalog)
      setContext(nextContext)
    } catch (error) {
      if (sequence === selectSequence.current) {
        setHistoryError(displayError(error))
        setHydrating(false)
      }
      return false
    }

    const goalRevisionAtStart = threadGoalRevisions.current.get(thread.id) || 0
    let writerGranted = false
    const goalHydrationState: {
      resumeCandidate: { goal: ThreadGoal; revision: number } | null
    } = { resumeCandidate: null }
    const goalHydration = window.codex
      .invoke<{ goal: ThreadGoal | null }>('thread/goal/get', { threadId: thread.id }, hostId)
      .then((response) => {
        if (sequence !== selectSequence.current || selectedThreadIdRef.current !== thread.id) return
        if ((threadGoalRevisions.current.get(thread.id) || 0) !== goalRevisionAtStart) return
        const goal = threadGoalFromUnknown(response.goal)
        if (goal) {
          acceptThreadGoal(goal)
          goalHydrationState.resumeCandidate = {
            goal,
            revision: threadGoalRevisions.current.get(thread.id) || 0
          }
          if (writerGranted) maybePromptToResumeGoal(goal)
          return
        }
        if ((threadGoalRevisions.current.get(thread.id) || 0) === goalRevisionAtStart) {
          clearThreadGoal(thread.id)
        }
      })
      .catch(() => undefined)

    try {
      const result = await hydrateThreadForSelection(
        (method, params) => window.codex.invoke(method, params, hostId),
        thread.id,
        () => sequence === selectSequence.current && selectedThreadIdRef.current === thread.id,
        thread
      )
      if (!result) return false
      const { thread: hydratedResult, turns, nextCursor } = result
      const hydrated = hostId === 'local' ? hydratedResult : {...hydratedResult, hostId}
      if (hydrated.cwd !== nextContext.cwd) {
        remoteProject = hostId === 'local' ? undefined : remoteProjects.find((project) =>
          project.hostId === hostId && (project.id === hydrated.projectId || project.remotePath === hydrated.cwd))
        nextContext = hostId === 'local'
          ? await localContextForThread(hydrated)
          : await window.codex.getRemoteAppContext(hostId, hydrated.cwd, remoteProject?.id)
        if (sequence !== selectSequence.current || selectedThreadIdRef.current !== thread.id) return false
        setContext(nextContext)
      }
      if (sequence === selectSequence.current) {
        if (result.access === 'writer') {
          if (result.resumed.model) setModelId(result.resumed.model)
          if (result.resumed.reasoningEffort) setEffort(result.resumed.reasoningEffort)
          if (result.resumed.activePermissionProfile?.id) setPermission(result.resumed.activePermissionProfile.id)
          setApprovalsReviewer(canonicalApprovalsReviewer(result.resumed.approvalsReviewer))
        } else {
          if (hydrated.model) setModelId(hydrated.model)
          if (hydrated.reasoningEffort) setEffort(hydrated.reasoningEffort)
        }
        setNavigation((history) => {
          const current = currentNavigationEntry(history)
          return current?.view === 'chats' && current.threadId === thread.id
            ? replaceCurrentNavigationEntry(history, {
                ...current, cwd: nextContext.cwd, ...navigationWorkspaceFields(nextContext)
              }) : history
        })
        dispatch({ type: 'threadHydrated', thread: { ...hydrated, turns: [] } })
        dispatch({
          type: 'threadHistoryReplaced',
          threadId: thread.id,
          turns,
          baselineTurnIds,
          preserveTurnIds
        })
        setHistoryNextCursor(acceptNextCursor(nextCursor, seenHistoryCursors.current))
        settlePendingSteerFromTurns(thread.id, turns)
        writerGranted = result.access === 'writer'
        setResumedThreadId(writerGranted ? thread.id : null)
        const resumeCandidate = goalHydrationState.resumeCandidate
        if (
          writerGranted &&
          resumeCandidate &&
          (threadGoalRevisions.current.get(thread.id) || 0) === resumeCandidate.revision
        ) {
          maybePromptToResumeGoal(resumeCandidate.goal)
        }
        setLoadedThreadId(thread.id)
        void goalHydration
        return true
      }
      return false
    } catch (error) {
      if (sequence === selectSequence.current) {
        setHistoryError(displayError(error))
      }
      return false
    } finally {
      if (sequence === selectSequence.current) setHydrating(false)
    }
  }

  const startNewThread = (
    record = true,
    cwd = contextRef.current?.cwd || null,
    restoredDraftScope?: string,
    hostId = appContextHostId(contextRef.current),
    workspaceContext: AppContext | null = contextRef.current
  ): string => {
    const nextDraftScope = record ? `draft:${crypto.randomUUID()}` : restoredDraftScope || draftTerminalScope
    const workspaceFields = navigationWorkspaceFields(workspaceContext)
    if (record) { markNavigationAction(); setNewThreadWorkspaceLayout(desktopSettings.defaultFullView ? 'full' : 'split') }
    selectSequence.current += 1
    setPrimaryView('chats')
    setSettingsOpen(false)
    setTerminalSheetOpen(false)
    setDraftTerminalScope(nextDraftScope)
    draftTerminalScopeRef.current = nextDraftScope
    if (record) setNavigation((history) => pushNavigationEntry(history, {
      view: 'chats', threadId: null, cwd, ...workspaceFields, hostId, draftId: nextDraftScope
    }))
    closeSideChat()
    setLoadedThreadId(null)
    setResumedThreadId(null)
    setHistoryNextCursor(null)
    setHistoryLoadingEarlier(false)
    setHistoryError(null)
    seenHistoryCursors.current.clear()
    setCatalogView('active')
    selectedThreadIdRef.current = null
    dispatch({ type: 'selectThread', threadId: null })
    setHydrating(false)
    setMainTurnStarting(false)
    setMainTurnThinking(false)
    setPendingUserMessage(null)
    if (record) clearComposerDraft(nextDraftScope)
    setAttachmentError(null)
    return nextDraftScope
  }

  const openPrimaryView = (view: 'chats' | 'settings' | 'scheduled' | 'projects' | 'marketplace'): void => {
    const entry = view === 'chats'
      ? { view, threadId: selectedThreadIdRef.current, cwd: contextRef.current?.cwd || null,
        ...navigationWorkspaceFields(contextRef.current),
        ...(selectedThreadIdRef.current ? {} : {draftId: draftTerminalScope}) } as const : { view }
    if (!sameNavigationEntry(currentNavigationEntry(navigationRef.current), entry)) markNavigationAction()
    setSettingsOpen(view === 'settings')
    if (view !== 'settings') setPrimaryView(view)
    setTerminalSheetOpen(false)
    setNavigation((history) => pushNavigationEntry(history, entry))
  }

  const openSettings = (section: SettingsSectionId = 'general'): void => {
    setSettingsInitialSection(section)
    openPrimaryView('settings')
  }
  const executeScheduledTaskRun = async (run: ScheduledTaskRunRequest): Promise<void> => {
    const activeContext = contextRef.current
    const hostId = run.hostId || appContextHostId(activeContext)
    const fallbackCwd = activeContext?.cwd
    if (!run.cwd && !fallbackCwd && !run.threadId) throw new Error('定时任务没有可用的工作目录。')
    const [status, models] = await Promise.all([
      window.codex.getBackendStatus(hostId),
      window.codex.invoke<Page<ModelOption>>('model/list', {limit: 100}, hostId)
    ])
    if (status.state !== 'ready') throw new Error(status.message || 'Codex 服务尚未就绪。')
    const scheduledModel = models.data.find((candidate) =>
      candidate.displayName === run.model || candidate.model === run.model || candidate.id === run.model
    ) || models.data.find((candidate) => candidate.isDefault) || models.data[0]
    if (!scheduledModel) throw new Error('没有可用于定时任务的模型。')
    const requestedEffort: ReasoningEffort = run.effort === 'Ultra'
      ? 'ultra'
      : run.effort === '极高' || run.effort === '超高'
        ? 'xhigh'
        : run.effort === '高'
          ? 'high'
          : run.effort === '轻度' || run.effort === '低'
            ? 'low'
            : 'medium'
    const scheduledEffort = scheduledModel.supportedReasoningEfforts.some(
      (candidate) => candidate.reasoningEffort === requestedEffort
    ) ? requestedEffort : scheduledModel.defaultReasoningEffort

    let threadId = run.threadId || null
    let thread: Thread | null = null
    let cwd = run.cwd || fallbackCwd || null
    if (threadId) {
      try {
        const resumed = await window.codex.invoke<ThreadResumeResponse>('thread/resume', {
          threadId,
          excludeTurns: true
        }, hostId)
        thread = resumed.thread
        cwd = cwd || resumed.cwd || resumed.thread.cwd
      } catch (error) {
        if (!/thread[^\n]*not found|unknown thread/i.test(displayError(error))) throw error
        threadId = null
      }
    }
    if (!threadId) {
      if (!cwd) throw new Error('定时任务没有可用的工作目录。')
      const started = await window.codex.invoke<ThreadStartResponse>('thread/start', {
        cwd,
        model: scheduledModel.model,
        permissions: permission || undefined,
        approvalsReviewer,
        ephemeral: false
      }, hostId)
      threadId = started.thread.id
      thread = started.thread
      cwd = started.cwd || started.thread.cwd || cwd
      await window.codex.bindScheduledTaskRunThread(run.runId, threadId)
    }
    if (!thread || !threadId || !cwd) throw new Error('无法为定时任务准备聊天。')
    const visibleThread = hostId === 'local' ? thread : {...thread, hostId}
    dispatch(createdThreadAction(visibleThread, false))
    const response = await window.codex.invoke<{ turn: Turn }>('turn/start', {
      threadId,
      clientUserMessageId: run.runId,
      input: buildTurnInput(run.prompt, []),
      cwd,
      permissions: permission || undefined,
      approvalsReviewer,
      model: scheduledModel.model,
      effort: scheduledEffort
    }, hostId)
    dispatch({
      type: 'notification',
      notification: { method: 'turn/started', params: {threadId, turn: response.turn} }
    })
    try {
      await window.codex.acknowledgeScheduledTaskRun(run.runId, threadId)
    } catch {
      window.setTimeout(() => {
        void window.codex.acknowledgeScheduledTaskRun(run.runId, threadId!).catch(() => undefined)
      }, 1_000)
    }
    if (run.origin === 'manual') {
      void selectThread(visibleThread).catch((error: unknown) => setThreadNotice({message: displayError(error)}))
    }
  }
  scheduledRunExecutorRef.current = executeScheduledTaskRun

  const queueScheduledTaskRun = (run: ScheduledTaskRunRequest): void => {
    if (scheduledRunIds.current.has(run.runId)) return
    scheduledRunIds.current.add(run.runId)
    scheduledRunTail.current = scheduledRunTail.current.catch(() => undefined).then(async () => {
      try {
        await scheduledRunExecutorRef.current(run)
      } catch (error) {
        scheduledRunIds.current.delete(run.runId)
        setThreadNotice({message: `定时任务“${run.title}”运行失败：${displayError(error)}`})
        window.setTimeout(() => {
          void window.codex.listPendingScheduledTaskRuns().then((pending) => {
            const current = pending.find((candidate) => candidate.runId === run.runId)
            if (current) queueScheduledTaskRun(current)
          }).catch(() => undefined)
        }, 15_000)
      }
    })
  }

  useEffect(() => window.codex.onScheduledTaskRun(queueScheduledTaskRun), [])

  useEffect(() => {
    if (!bootstrapReady || backend.state !== 'ready') return
    void window.codex.listPendingScheduledTaskRuns()
      .then((pending) => pending.forEach(queueScheduledTaskRun))
      .catch((error: unknown) => setThreadNotice({message: displayError(error)}))
  }, [backend.state, bootstrapReady])
  const openInteractiveTerminal = (): void => {
    if (!context || backend.state !== 'ready') return
    openPrimaryView('chats')
    try {
      const placement = desktopSettings.bottomPanelEnabled ? desktopSettings.defaultTerminalLocation : 'right'
      const id = terminalController.open(placement, context.cwd)
      if (placement === 'right') activateRightTab(`terminal:${id}`)
    }
    catch (error) { setThreadNotice({message: displayError(error)}) }
  }
  const toggleBottomPanel = (): void => {
    if (!context || backend.state !== 'ready') return
    openPrimaryView('chats')
    if (terminalState.visible.bottom) terminalController.hide('bottom')
    else {
      try { terminalController.open('bottom', context.cwd) }
      catch (error) { setThreadNotice({message: displayError(error)}) }
    }
  }
  const goNavigation = async (direction: 'back' | 'forward'): Promise<void> => {
    if (navigationInFlight.current) return
    const previous = navigationRef.current
    const next = direction === 'back' ? navigateBack(previous) : navigateForward(previous)
    if (next === previous) return
    const entry = currentNavigationEntry(next)
    if (!entry) return
    const revision = markNavigationAction()
    navigationInFlight.current = true
    setNavigationBusy(true)
    setNavigation(next)
    let selectedDestination = false
    try {
      if (entry.view === 'chats') {
        const hostId = entry.hostId || 'local'
        if (entry.threadId) {
          const thread = stateRef.current.threads.find((thread) =>
            thread.id === entry.threadId && threadHostId(thread) === hostId)
            || (await window.codex.invoke<ThreadReadResponse>(
              'thread/read', {threadId: entry.threadId, includeTurns: false}, hostId
            )).thread
          if (navigationActionRevision.current !== revision) return
          selectedDestination = true
          if (!await selectThread(thread, false)) throw new Error('Unable to load the conversation')
        } else {
          const previousHostId = appContextHostId(contextRef.current)
          const loadedContext = entry.cwd
            ? hostId === 'local'
              ? await window.codex.getAppContext(entry.cwd)
              : await window.codex.getRemoteAppContext(hostId, entry.cwd, entry.projectId || undefined)
            : contextRef.current
          const nextContext = loadedContext && hostId === 'local' && entry.projectKind === 'projectless'
            ? asProjectlessContext(loadedContext)
            : loadedContext
          if (navigationActionRevision.current !== revision) return
          const catalog = hostId !== previousHostId ? await loadHostCatalog(hostId) : null
          if (navigationActionRevision.current !== revision) return
          await window.codex.setActiveHost(hostId)
          if (navigationActionRevision.current !== revision) return
          if (nextContext) setContext(nextContext)
          if (catalog) applyHostCatalog(hostId, catalog)
          startNewThread(false, nextContext?.cwd || null, entry.draftId, hostId, nextContext)
          selectedDestination = true
        }
      } else {
        setSettingsOpen(entry.view === 'settings')
        if (entry.view !== 'settings') setPrimaryView(entry.view)
        setTerminalSheetOpen(false)
        selectedDestination = true
      }
    } catch (error) {
      if (navigationActionRevision.current === revision) {
        if (!selectedDestination) setNavigation(previous)
        setThreadNotice({message: displayError(error)})
      }
    } finally {
      if (navigationActionRevision.current === revision) { navigationInFlight.current = false; setNavigationBusy(false) }
    }
  }
  nativeActions.current = {
    command: (command) => {
      if (windowCloseRequest || threadDialog || localEnvironmentOpen || projectModalOpen || serverRequestQueue.length) return
      if (command === 'new-chat') startNewThread()
      else if (command === 'show-settings') openSettings()
      else if (command === 'toggle-terminal') openInteractiveTerminal()
      else if (command === 'toggle-bottom-panel') toggleBottomPanel()
      else if (command === 'navigate-back') void goNavigation('back')
      else if (command === 'navigate-forward') void goNavigation('forward')
      else if (command === 'toggle-sidebar') {
        if (settingsOpen || (primaryView !== 'chats' && primaryView !== 'scheduled')) { openPrimaryView('chats'); setSidebarOpen(true) }
        else setSidebarOpen((value) => !value)
      } else if (command === 'focus-search') { openPrimaryView('chats'); setSearching(true) }
    },
    close: (origin) => {
      if (windowCloseRequest) return
      if (serverRequestQueue.length) return
      if (localEnvironmentOpen) { setLocalEnvironmentOpen(false); return }
      const projectDialog = document.querySelector('.project-dialog-backdrop')
      if (projectModalOpen || projectDialog) {
        const cancel = projectDialog?.querySelector<HTMLButtonElement>('.project-dialog-secondary')
        if (cancel && !cancel.disabled) cancel.click()
        return
      }
      if (threadDialog) {
        if (!threadActionBusy) setThreadDialog(null)
        return
      }
      const focusedPanel = document.activeElement?.closest('.interactive-terminal-panel')?.getAttribute('data-placement')
      if (focusedPanel === 'bottom' || focusedPanel === 'right') void terminalController.closeActive(focusedPanel)
      else if (terminalSheetOpen) setTerminalSheetOpen(false)
      else if (rightWorkbenchOpen && !rightWorkbenchChatSelected && rightSurface === 'terminal') void terminalController.closeActive('right')
      else if (rightWorkbenchOpen && !rightWorkbenchChatSelected && rightSurface === 'subagent' && openedSubagent) closeSubagent()
      else if (rightWorkbenchOpen && !rightWorkbenchChatSelected && rightSurface === 'workspace') window.dispatchEvent(new CustomEvent(CLOSE_WORKSPACE_FILE_EVENT))
      else if (rightWorkbenchOpen && !rightWorkbenchChatSelected && rightSurface === 'sideChat' && sideChatOpen) closeSideChat()
      else if (rightWorkbenchOpen && !rightWorkbenchChatSelected && rightSurface === 'browser' && activeBrowserTabId) closeBrowserTab(activeBrowserTabId)
      else if (terminalState.visible.bottom) void terminalController.closeActive('bottom')
      else if (settingsOpen || primaryView !== 'chats') openPrimaryView('chats')
      else void window.codex.requestWindowClose(origin).catch((error) => setThreadNotice({message: displayError(error)}))
    }
  }
  const routeBlocked = useRef(false)
  routeBlocked.current = Boolean(windowCloseRequest || threadDialog || localEnvironmentOpen || projectModalOpen || serverRequestQueue.length || navigationBusy)
  useEffect(() => {
    const request = pendingOpenThreads[0]
    if (!request || routeBlocked.current || !bootstrapReady || backend.state !== 'ready' || openingThreadIds.current.has(request.id)) return
    openingThreadIds.current.add(request.id)
    const revision = navigationActionRevision.current
    let deferred = false
    void (async () => {
      try {
        const hostId = request.hostId || 'local'
        const thread = stateRef.current.threads.find((thread) =>
          thread.id === request.threadId && threadHostId(thread) === hostId)
          || (await window.codex.invoke<ThreadReadResponse>(
            'thread/read', {threadId: request.threadId, includeTurns: false}, hostId
          )).thread
        if (routeBlocked.current) { deferred = true; return }
        if (navigationActionRevision.current !== revision) return
        if (await selectThread(thread)) await window.codex.acknowledgeOpenThread(request.id)
        else if (selectedThreadIdRef.current === request.threadId) setThreadNotice({message: '无法打开对话。'})
      } catch (error) { if (navigationActionRevision.current === revision) setThreadNotice({message: displayError(error)}) }
      finally { openingThreadIds.current.delete(request.id); setPendingOpenThreads((queue) => deferred ? [...queue] : queue.filter((entry) => entry.id !== request.id)) }
    })()
  }, [pendingOpenThreads, backend.state, bootstrapReady, windowCloseRequest, threadDialog, localEnvironmentOpen, projectModalOpen, serverRequestQueue.length, navigationBusy])

  useEffect(() => {
    const previous = previousBackendState.current
    previousBackendState.current = backend.state

    if (backend.state !== 'ready') {
      if (previous === 'ready') {
        reconnectThreadId.current = selectedThreadIdRef.current
        selectSequence.current += 1
        setLoadedThreadId(null)
        setResumedThreadId(null)
        setHydrating(false)
        setHistoryLoadingEarlier(false)
        setSteering(false)
        updateServerRequestQueue(() => [])
        setServerRequestBusy(false)
      }
      return
    }

    if (previous === 'ready') return
    const threadId = reconnectThreadId.current
    reconnectThreadId.current = null
    if (!threadId || selectedThreadIdRef.current !== threadId) return
    const thread = stateRef.current.threads.find((candidate) => candidate.id === threadId)
    if (thread) void selectThread(thread)
  }, [backend.state])

  useEffect(() => {
    for (const [threadId] of pendingSteerRecoveries.current) {
      const session = state.sessions[threadId]
      if (session) settlePendingSteerFromTurns(threadId, session.turns)
    }
  }, [state.sessions])

  useEffect(() => {
    const threadId = state.selectedThreadId
    if (
      backend.state !== 'ready' ||
      !threadId ||
      !selectedThreadReady ||
      resumedThreadId !== threadId
    ) return
    void refreshThreadQueue(threadId).catch(() => undefined)
  }, [backend.state, resumedThreadId, selectedThreadReady, state.selectedThreadId])

  useEffect(() => {
    if (backend.state !== 'ready') return
    for (const [threadId, messages] of Object.entries(queuedMessagesByThread)) {
      const session = state.sessions[threadId]
      for (const message of messages) {
        if (!hasAuthoritativeClientMessage(
          session?.turns || [],
          message.clientUserMessageId
        )) continue

        diffCommentsStore.removeSubmitted(threadId, message.comments)
        if (!message.serverAccepted) {
          updateThreadQueue(threadId, (current) => removeQueuedMessage(current, message.id))
          continue
        }

        // The queue row may have been hydrated after a restart, so no local
        // mutation provenance is guaranteed. Deletion is idempotent (`false`
        // means it was already consumed) and prevents an accepted steer from
        // being dispatched again after the current turn becomes idle.
        const cleanupOperation = `cleanup:${threadId}:${message.id}`
        if (queueStarts.current.has(cleanupOperation)) continue
        queueStarts.current.add(cleanupOperation)
        void invokeQueueMutation<ThreadQueueDeleteResponse>(
          threadId,
          'thread/queue/delete',
          { threadId, queuedSubmissionId: message.id }
        ).then(() => {
          updateThreadQueue(threadId, (current) => removeQueuedMessage(current, message.id))
        }).catch(() => {
          void refreshThreadQueue(threadId).catch(() => undefined)
        }).finally(() => {
          queueStarts.current.delete(cleanupOperation)
        })
      }
      if (session?.running) continue
      const first = messages[0]
      const latestTurn = session?.turns.at(-1)
      if (
        first?.status === 'queued' &&
        latestTurn?.status === 'interrupted'
      ) {
        updateThreadQueue(threadId, (current) => updateQueuedMessage(
          current,
          first.id,
          (message) => ({
            ...message,
            status: 'paused',
            pauseReason: 'interrupted',
            error: '由于你中断了当前响应，队列已暂停。'
          })
        ))
        continue
      }
      // The app-server owns normal idle dispatch. Starting the same queue head
      // here creates a second consumer and can race the server into a
      // "queued submission not found" response. thread/queue/start remains
      // available only for explicit resume/send-now actions.
    }
  }, [backend.state, queuedMessagesByThread, state.sessions])

  const submit = async (
    confirmedGoalReplacement: ThreadGoal | null = null
  ): Promise<void> => {
    if (mainTurnStarting || (!selectedSession?.running && activeMainSubmission.current !== null)) return
    const text = materializeComposerRichDraft(draft).trim()
    const submissionMode = composerMode
    const isGoalSubmission = submissionMode === 'goal'
    if (isGoalSubmission && selectedSession?.running) {
      setAttachmentError('请先停止当前回复，再设置目标。')
      return
    }
    if (isGoalSubmission && !text) {
      setAttachmentError('请先描述要持续追求的目标。')
      return
    }
    const existingGoal = state.selectedThreadId
      ? threadGoals[state.selectedThreadId]?.current || null
      : null
    if (
      isGoalSubmission &&
      existingGoal &&
      (
        !confirmedGoalReplacement ||
        confirmedGoalReplacement.threadId !== existingGoal.threadId ||
        confirmedGoalReplacement.updatedAt !== existingGoal.updatedAt ||
        confirmedGoalReplacement.objective !== existingGoal.objective ||
        confirmedGoalReplacement.status !== existingGoal.status
      )
    ) {
      setGoalReplacementConfirmation({ goal: existingGoal, objective: text })
      return
    }
    if (isGoalSubmission) setGoalReplacementConfirmation(null)
    const submittedComments = diffCommentsStore.getSnapshot(diffCommentScope)
    const input = buildTurnInput(text, attachments, submittedComments)
    if (!input.length || backend.state !== 'ready' || !context || !selectedModel) return
    let threadId = state.selectedThreadId
    const submissionStartedWithoutThread = threadId === null
    if (pendingDraftSubmissionsRef.current.has(threadId ? terminalScopes.current.get(threadId) || threadId : draftTerminalScope)) return
    if (threadId) {
      const thread = state.threads.find((candidate) => candidate.id === threadId)
      if (
        !thread ||
        !isThreadReadyForComposer(thread, {
          loadedThreadId,
          resumedThreadId: resumedThreadIdRef.current,
          hydrating,
          contextCwd: context.cwd
        })
      ) {
        setAttachmentError(loadedThreadId === threadId && resumedThreadIdRef.current !== threadId
          ? '此聊天正由其他客户端处理。重新连接成功后即可发送消息。'
          : 'Wait for this chat and its working folder to finish loading.')
        return
      }
      if (selectedSession?.running && pendingSteerRecoveries.current.has(threadId)) {
        setAttachmentError('Wait for the previous follow-up to be reconciled before resending.')
        return
      }
    }
    const submittedAttachments = attachments
    if (
      !isGoalSubmission &&
      threadId &&
      editingQueuedMessage?.threadId === threadId
    ) {
      const editingMessage = (queuedMessagesByThreadRef.current[threadId] || []).find(
        (message) => message.id === editingQueuedMessage.messageId
      )
      if (!editingMessage) {
        setEditingQueuedMessage(null)
        setAttachmentError('要编辑的排队消息已不存在。')
        return
      }
      await updateQueuedFollowUp({
        threadId,
        messageId: editingMessage.id,
        input,
        text,
        draftText: draft,
        attachments: submittedAttachments,
        comments: submittedComments
      })
      return
    }
    if (
      !isGoalSubmission &&
      threadId &&
      !selectedSession?.running &&
      (queuedMessagesByThreadRef.current[threadId]?.length || 0) > 0
    ) {
      const clientId = crypto.randomUUID()
      setDraft('')
      setAttachments([])
      setAttachmentError(null)
      await enqueueQueuedFollowUp({
        threadId,
        clientUserMessageId: clientId,
        input,
        text,
        draftText: draft,
        attachments: submittedAttachments,
        comments: submittedComments
      })
      return
    }
    setDraft('')
    setAttachments([])
    setAttachmentError(null)

    const expectedTurnId = selectedSession?.running ? selectedSession.activeTurnId : null
    if (selectedSession?.running) {
      if (
        !threadId ||
        !expectedTurnId ||
        loadedThreadId !== threadId ||
        resumedThreadIdRef.current !== threadId ||
        hydrating ||
        steering
      ) {
        restoreComposerDraft(threadId || draftTerminalScope, text, submittedAttachments)
        return
      }

      const clientId = crypto.randomUUID()
      if (queueingEnabled) {
        await enqueueQueuedFollowUp({
          threadId,
          clientUserMessageId: clientId,
          input,
          text,
          draftText: draft,
          attachments: submittedAttachments,
          comments: submittedComments
        })
        return
      }
      dispatch({
        type: 'optimisticSteer',
        threadId,
        turnId: expectedTurnId,
        clientId,
        text,
        input
      })
      setSteering(true)
      try {
        const response = await window.codex.invoke<{ turnId: string }>('turn/steer', {
          threadId,
          input,
          expectedTurnId,
          clientUserMessageId: clientId
        }, hostIdForThreadId(threadId))
        if (response.turnId !== expectedTurnId) {
          throw new Error('The active turn changed before the follow-up was accepted.')
        }
        dispatch({ type: 'steerAccepted', threadId, turnId: response.turnId, clientId })
        diffCommentsStore.removeSubmitted(threadId, submittedComments)
      } catch (error) {
        const latestTurns = stateRef.current.sessions[threadId]?.turns || []
        if (hasAuthoritativeClientMessage(latestTurns, clientId)) {
          dispatch({ type: 'steerAccepted', threadId, turnId: expectedTurnId, clientId })
          diffCommentsStore.removeSubmitted(threadId, submittedComments)
        } else if (isUnknownMutationError(error)) {
          pendingSteerRecoveries.current.set(threadId, {
            threadId,
            turnId: expectedTurnId,
            clientId,
            text,
            attachments: submittedAttachments,
            comments: submittedComments
          })
          dispatch({
            type: 'steerUnknown',
            threadId,
            turnId: expectedTurnId,
            clientId,
            message: 'The connection was interrupted before the follow-up could be confirmed. It will be reconciled before you resend it.'
          })
        } else {
          dispatch({
            type: 'steerFailed',
            threadId,
            turnId: expectedTurnId,
            clientId,
            message: displayError(error)
          })
          restoreComposerDraft(threadId, text, submittedAttachments)
        }
      } finally {
        setSteering(false)
      }
      return
    }

    const clientId = crypto.randomUUID()
    let submissionRevision = navigationActionRevision.current
    const submissionCwd = context.cwd
    const submissionHostId = appContextHostId(context)
    const submissionTerminalScope = draftTerminalScope
    const submissionWorktreeChoice = threadId ? null : newThreadWorktreeChoice
    let submissionApprovalsReviewer = approvalsReviewer
    let runCwd = submissionCwd
    let visibleCwd = submissionCwd
    let submissionFailed = false
    let preparedContext: AppContext | null = null
    activeMainSubmission.current = clientId
    const ownsVisibleRoute = (): boolean => ownsForegroundOperation(
      {id: clientId, revision: submissionRevision, cwd: visibleCwd},
      {activeId: activeMainSubmission.current, revision: navigationActionRevision.current, cwd: contextRef.current?.cwd || null}
    )
    const optimisticItem: ThreadItem = {
      type: 'userMessage',
      id: `user-${clientId}`,
      clientId,
      content: input
    }
    setMainTurnStarting(true)
    setMainTurnThinking(false)
    if (!threadId) {
      const pending = {id: clientId, message: { item: optimisticItem, text, attachments: submittedAttachments }}
      pendingDraftSubmissionsRef.current.set(submissionTerminalScope, pending)
      setPendingDraftSubmissions((submissions) => ({...submissions, [submissionTerminalScope]: pending}))
      setPendingUserMessage(pending.message)
    }

    // Keep the recorded startup state observable even when a local app-server responds
    // within the same event-loop turn. Two paints also give assistive technology and
    // the renderer's scroll follower a stable optimistic-message frame to consume.
    await new Promise<void>((resolvePaint) => {
      let settled = false
      let firstFrame = 0
      let secondFrame = 0
      const timeout = window.setTimeout(finish, 50)

      function finish(): void {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        if (firstFrame) window.cancelAnimationFrame(firstFrame)
        if (secondFrame) window.cancelAnimationFrame(secondFrame)
        resolvePaint()
      }

      firstFrame = window.requestAnimationFrame(() => {
        firstFrame = 0
        secondFrame = window.requestAnimationFrame(() => {
          secondFrame = 0
          finish()
        })
      })
    })

    try {
      if (!threadId) {
        if (newThreadWorktreeChoice?.cwd === submissionCwd && newThreadWorktreeChoice.enabled) {
          if (ownsVisibleRoute()) setWorktreeCreating(true)
          const preparedKey = {scope: submissionTerminalScope, cwd: submissionCwd, branch: newThreadWorktreeChoice.branch}
          const prepared = await preparedWorktrees.current.prepare(preparedKey, window.codex).catch((error) => {
            runCwd = preparedWorktrees.current.peek(preparedKey)?.cwd || runCwd
            throw error
          })
          runCwd = prepared.cwd
          preparedContext = prepared.context
          if (ownsVisibleRoute()) setWorktreeCreating(false)
        }
        const response = await window.codex.invoke<ThreadStartResponse>('thread/start', {
          cwd: runCwd,
          model: selectedModel.model,
          permissions: permission || undefined,
          approvalsReviewer: submissionApprovalsReviewer,
          ephemeral: false
        }, submissionHostId)
        submissionApprovalsReviewer = canonicalApprovalsReviewer(
          response.approvalsReviewer || submissionApprovalsReviewer
        )
        if (ownsVisibleRoute()) setApprovalsReviewer(submissionApprovalsReviewer)
        threadId = response.thread.id
        diffCommentsStore.move(submissionTerminalScope, threadId)
        const visibleEntry = currentNavigationEntry(navigationRef.current)
        if (canReclaimDraftSubmission({scope: submissionTerminalScope, id: clientId}, {
          currentDraftScope: draftTerminalScopeRef.current,
          currentDraftId: visibleEntry?.view === 'chats' && visibleEntry.threadId === null ? visibleEntry.draftId || null : null,
          selectedThreadId: selectedThreadIdRef.current, activeSubmissionId: activeMainSubmission.current,
          pendingSubmissionId: pendingDraftSubmissionsRef.current.get(submissionTerminalScope)?.id || null
        })) { submissionRevision = navigationActionRevision.current; activeMainSubmission.current = clientId }
        terminalScopes.current.set(threadId, submissionTerminalScope)
        setComposerDrafts((drafts) => {
          const remaining = drafts[submissionTerminalScope]
          if (!remaining?.text && !remaining?.attachments.length) return drafts
          return {...drafts, [response.thread.id]: remaining}
        })
        setComposerModes((modes) => {
          const submittedMode = modes[submissionTerminalScope]
          if (!submittedMode) return modes
          const next = { ...modes }
          delete next[submissionTerminalScope]
          if (submittedMode !== 'goal') next[response.thread.id] = submittedMode
          return next
        })
        setNavigation((history) => resolveDraftNavigationEntries(history, submissionTerminalScope,
          {threadId: response.thread.id, cwd: response.thread.cwd, hostId: threadHostId(response.thread)}))
        setWorkspaceLayouts((layouts) => ({...layouts, [response.thread.id]: newThreadWorkspaceLayout}))
        if (ownsVisibleRoute()) {
          if (preparedContext) { visibleCwd = runCwd; setContext(preparedContext) }
          selectedThreadIdRef.current = threadId
          dispatch(createdThreadAction(response.thread, true))
          setLoadedThreadId(threadId)
          setResumedThreadId(threadId)
        } else dispatch(createdThreadAction(response.thread, false))
      }

      if (ownsVisibleRoute()) setPendingUserMessage(null)
      if (isGoalSubmission) {
        const goalThreadId = threadId
        const goalRevisionAtStart = threadGoalRevisions.current.get(goalThreadId) || 0
        const attachmentReferences = submittedAttachments.map((attachment) => attachment.path)
        const objective = attachmentReferences.length > 0
          ? `${text}\n\n${attachmentReferences.map((path) => `- ${path}`).join('\n')}`
          : text
        const response = await window.codex.invoke<{ goal: ThreadGoal }>('thread/goal/set', {
          threadId: goalThreadId,
          objective,
          status: 'active',
          origin: 'user'
        }, submissionHostId)
        const goal = threadGoalFromUnknown(response.goal)
        if (!goal || goal.threadId !== goalThreadId) {
          throw new Error('The server returned an invalid goal.')
        }
        if ((threadGoalRevisions.current.get(goalThreadId) || 0) === goalRevisionAtStart) {
          acceptThreadGoal(goal)
        }
        diffCommentsStore.removeSubmitted(goalThreadId, submittedComments)
        dispatch({
          type: 'notification',
          notification: {
            method: 'turn/completed',
            params: {
              threadId: goalThreadId,
              turn: {
                id: `goal-${clientId}`,
                status: 'completed',
                startedAt: Date.now() / 1_000,
                items: [{
                  type: 'userMessage',
                  id: `goal-user-${clientId}`,
                  clientId,
                  content: [{ type: 'text', text, text_elements: [] }]
                }]
              }
            }
          }
        })
        setComposerModes((modes) => {
          if (!(goalThreadId in modes)) return modes
          const next = { ...modes }
          delete next[goalThreadId]
          return next
        })
        if (ownsVisibleRoute()) {
          setMainTurnStarting(false)
          setLoadedThreadId(goalThreadId)
          activeMainSubmission.current = null
          setThreadNotice({ message: '目标已设置' })
        }
        return
      }

      dispatch({ type: 'optimisticUserMessage', threadId, clientId, text, input })
      const collaborationMode = collaborationModeForTurn(
        submissionMode,
        selectedModel.model,
        effort
      )
      const response = await window.codex.invoke<{ turn: Turn }>('turn/start', {
        threadId,
        clientUserMessageId: clientId,
        input,
        cwd: runCwd,
        permissions: permission || undefined,
        approvalsReviewer: submissionApprovalsReviewer,
        model: selectedModel.model,
        effort,
        ...(collaborationMode ? { collaborationMode } : {})
      }, submissionHostId)
      diffCommentsStore.removeSubmitted(threadId, submittedComments)
      dispatch({
        type: 'notification',
        notification: {
          method: 'turn/started',
          params: { threadId, turn: response.turn }
        }
      })
      if (ownsVisibleRoute()) {
        setMainTurnStarting(false)
        setMainTurnThinking(true)
        setLoadedThreadId(threadId)
        window.setTimeout(() => {
          if (ownsVisibleRoute()) { setMainTurnThinking(false); activeMainSubmission.current = null }
        }, 650)
      }
    } catch (error) {
      submissionFailed = true
      if (threadId && !removedThreadIds.current.has(threadId) && !isGoalSubmission) {
        dispatch({ type: 'turnFailed', threadId, message: displayError(error) })
        restoreComposerDraft(threadId, text, submittedAttachments)
      } else if (threadId && !removedThreadIds.current.has(threadId)) {
        const failedThreadId = threadId
        restoreComposerDraft(failedThreadId, text, submittedAttachments)
        if (isGoalSubmission && submissionStartedWithoutThread) {
          setComposerModes((modes) => ({ ...modes, [failedThreadId]: 'goal' }))
        }
        setThreadNotice({ message: displayError(error) })
      } else if (ownsVisibleRoute()) {
        restoreComposerDraft(submissionTerminalScope, text, submittedAttachments)
        setThreadNotice({message: displayError(error)})
      } else {
        const recoveryScope = `recovery:${clientId}`
        diffCommentsStore.set(recoveryScope, submittedComments)
        setFailedDraftRecoveries((recoveries) => [...recoveries, {
          id: clientId, cwd: runCwd, text, attachments: submittedAttachments, message: displayError(error),
          worktreeChoice: draftRecoveryWorktreeChoice(submissionWorktreeChoice, submissionCwd, runCwd),
          commentScope: recoveryScope
        }])
      }
      if (ownsVisibleRoute()) setMainTurnThinking(false)
    } finally {
      if (pendingDraftSubmissionsRef.current.get(submissionTerminalScope)?.id === clientId) {
        pendingDraftSubmissionsRef.current.delete(submissionTerminalScope)
        setPendingDraftSubmissions((submissions) => { const next = {...submissions}; delete next[submissionTerminalScope]; return next })
      }
      if (ownsVisibleRoute()) {
        setMainTurnStarting(false); setPendingUserMessage(null); setWorktreeCreating(false)
        if (submissionFailed) activeMainSubmission.current = null
      }
    }
  }

  const forkEphemeralSideThread = async (
    sourceThreadId: string,
    reviewer: ApprovalsReviewer
  ): Promise<ThreadResumeResponse> => {
    const baseParams = {
      threadId: sourceThreadId,
      excludeTurns: true,
      ephemeral: true,
      approvalsReviewer: reviewer
    }
    const hostId = hostIdForThreadId(sourceThreadId)
    try {
      return await window.codex.invoke<ThreadResumeResponse>('thread/fork', {
        ...baseParams,
        experimentalPredictionMode: true
      }, hostId)
    } catch (error) {
      if (!shouldRetryForkWithoutPredictionMode(error)) throw error
      return window.codex.invoke<ThreadResumeResponse>('thread/fork', baseParams, hostId)
    }
  }

  const restoreSideChatDraft = (
    text: string,
    restoredAttachments: ComposerAttachmentSelection[]
  ): void => {
    setSideChatDraft((current) =>
      text.trim() ? (current.trim() ? `${text}\n${current}` : text) : current
    )
    setSideChatAttachments((current) =>
      mergeComposerAttachments(restoredAttachments, current)
    )
  }

  const submitSideChat = async (): Promise<void> => {
    const text = materializeComposerRichDraft(sideChatDraft).trim()
    const input = buildTurnInput(text, sideChatAttachments)
    if (
      !input.length ||
      backend.state !== 'ready' ||
      !context ||
      !selectedModel ||
      sideChatStarting ||
      sideChatSession?.running
    ) {
      return
    }

    const sourceThreadId = selectedThreadIdRef.current
    if (!sourceThreadId || loadedThreadId !== sourceThreadId || hydrating) {
      setSideChatAttachmentError('Wait for the parent chat to finish loading.')
      return
    }

    const generation = sideChatGeneration.current
    const submittedAttachments = sideChatAttachments
    let threadId = sideChatThreadIdRef.current
    let turnCwd = context.cwd
    let turnApprovalsReviewer = approvalsReviewer
    let pendingStart: PendingSideChatStart | null = null
    setSideChatDraft('')
    setSideChatAttachments([])
    setSideChatAttachmentError(null)
    setSideChatStarting(true)

    try {
      if (!threadId) {
        const response = await forkEphemeralSideThread(sourceThreadId, turnApprovalsReviewer)
        threadId = response.thread.id
        if (
          generation !== sideChatGeneration.current ||
          !sideChatOpenRef.current
        ) {
          discardedSideChatThreadIds.current.add(threadId)
          dispatch({ type: 'transientThreadRemoved', threadId })
          return
        }
        discardedSideChatThreadIds.current.delete(threadId)
        sideChatThreadIdRef.current = threadId
        turnCwd = response.cwd || response.thread.cwd || context.cwd
        turnApprovalsReviewer = canonicalApprovalsReviewer(
          response.approvalsReviewer || turnApprovalsReviewer
        )
        dispatch({ type: 'transientThreadHydrated', thread: response.thread })
        setSideChatThreadId(threadId)
      } else {
        turnCwd = stateRef.current.transientThreads[threadId]?.cwd || context.cwd
      }

      if (
        generation !== sideChatGeneration.current ||
        !sideChatOpenRef.current ||
        !threadId
      ) {
        return
      }

      const clientId = crypto.randomUUID()
      dispatch({ type: 'optimisticUserMessage', threadId, clientId, text, input })
      pendingStart = {
        threadId,
        generation,
        interruptRequested: false,
        interruptSent: false
      }
      pendingSideChatStart.current = pendingStart
      const response = await window.codex.invoke<{ turn: Turn }>('turn/start', {
        threadId,
        clientUserMessageId: clientId,
        input,
        cwd: turnCwd,
        permissions: permission || undefined,
        approvalsReviewer: turnApprovalsReviewer,
        model: selectedModel.model,
        effort
      }, hostIdForThreadId(threadId))
      const pendingInterruptTurnId = claimPendingInterruptTurnId(
        pendingStart,
        response.turn.id
      )
      if (pendingInterruptTurnId) {
        interruptedTurnIds.current.add(pendingInterruptTurnId)
        try {
          await window.codex.invoke('turn/interrupt', {
            threadId,
            turnId: pendingInterruptTurnId
          }, hostIdForThreadId(threadId))
        } catch (error) {
          interruptedTurnIds.current.delete(pendingInterruptTurnId)
          if (generation === sideChatGeneration.current && sideChatOpenRef.current) {
            dispatch({ type: 'sessionError', threadId, message: displayError(error) })
          }
        }
      }
      if (
        generation !== sideChatGeneration.current ||
        !sideChatOpenRef.current ||
        discardedSideChatThreadIds.current.has(threadId)
      ) {
        return
      }
      dispatch({
        type: 'notification',
        notification: {
          method: 'turn/started',
          params: { threadId, turn: response.turn }
        }
      })
    } catch (error) {
      if (generation !== sideChatGeneration.current || !sideChatOpenRef.current) return
      const message = displayError(error)
      if (threadId) dispatch({ type: 'turnFailed', threadId, message })
      setSideChatAttachmentError(message)
      restoreSideChatDraft(text, submittedAttachments)
    } finally {
      if (pendingStart && pendingSideChatStart.current === pendingStart) {
        pendingSideChatStart.current = null
      }
      if (generation === sideChatGeneration.current && sideChatOpenRef.current) {
        setSideChatStarting(false)
      }
    }
  }

  const interruptSideChat = async (): Promise<void> => {
    const threadId = sideChatThreadIdRef.current
    const session = threadId ? stateRef.current.sessions[threadId] : undefined
    if (backend.state !== 'ready' || !threadId) return
    const pending = requestPendingInterrupt(pendingSideChatStart.current, threadId)
    const turnId = interruptibleTurnId(session?.activeTurnId)
    if (!turnId || pending?.interruptSent) return
    if (pending) pending.interruptSent = true
    interruptedTurnIds.current.add(turnId)
    try {
      await window.codex.invoke('turn/interrupt', {
        threadId,
        turnId
      }, hostIdForThreadId(threadId))
    } catch (error) {
      interruptedTurnIds.current.delete(turnId)
      dispatch({ type: 'sessionError', threadId, message: displayError(error) })
    }
  }

  const interrupt = async (): Promise<void> => {
    if (
      backend.state !== 'ready' ||
      !selectedThreadReady ||
      !state.selectedThreadId ||
      !selectedSession?.activeTurnId
    ) {
      return
    }
    const goal = threadGoals[state.selectedThreadId]?.current
    if (goal?.status === 'active') {
      try {
        await updateThreadGoal(state.selectedThreadId, { status: 'paused' })
      } catch (error) {
        setThreadNotice({ message: displayError(error) })
      }
    }
    const turnId = selectedSession.activeTurnId
    interruptedTurnIds.current.add(turnId)
    try {
      await window.codex.invoke('turn/interrupt', {
        threadId: state.selectedThreadId,
        turnId
      }, hostIdForThreadId(state.selectedThreadId))
    } catch (error) {
      interruptedTurnIds.current.delete(turnId)
      dispatch({
        type: 'sessionError',
        threadId: state.selectedThreadId,
        message: displayError(error)
      })
    }
  }

  const loadEarlierTurns = async (): Promise<void> => {
    const threadId = state.selectedThreadId
    const cursor = historyNextCursor
    if (!threadId || !cursor || historyLoadingEarlier) return
    const sequence = selectSequence.current
    setHistoryLoadingEarlier(true)
    setHistoryError(null)
    try {
      const page = await window.codex.invoke<ThreadTurnsPage>('thread/turns/list', {
        threadId,
        cursor,
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'full'
      }, hostIdForThreadId(threadId))
      if (sequence !== selectSequence.current || threadId !== selectedThreadIdRef.current) return
      const nextCursor = acceptNextCursor(page.nextCursor, seenHistoryCursors.current)
      dispatch({
        type: 'threadHistoryPrepended',
        threadId,
        turns: turnsInChronologicalOrder(page.data)
      })
      setHistoryNextCursor(nextCursor)
    } catch (error) {
      if (sequence === selectSequence.current && threadId === selectedThreadIdRef.current) {
        const message = displayError(error)
        setHistoryError(message)
        if (message.includes('repeated a turn-history cursor')) setHistoryNextCursor(null)
      }
    } finally {
      if (sequence === selectSequence.current && threadId === selectedThreadIdRef.current) {
        setHistoryLoadingEarlier(false)
      }
    }
  }

  const pickHeroProject = async (): Promise<void> => {
    const scope = draftTerminalScopeRef.current
    if (selectedThreadIdRef.current || activeMainSubmission.current || pendingDraftSubmissionsRef.current.has(scope)) return
    const revision = markNavigationAction()
    const previousHostId = appContextHostId(contextRef.current)
    try {
      const next = await window.codex.pickDirectory()
      if (!next || navigationActionRevision.current !== revision || selectedThreadIdRef.current ||
        draftTerminalScopeRef.current !== scope || activeMainSubmission.current || pendingDraftSubmissionsRef.current.has(scope)) return
      const catalog = previousHostId === 'local' ? null : await loadHostCatalog('local')
      if (navigationActionRevision.current !== revision || selectedThreadIdRef.current ||
        draftTerminalScopeRef.current !== scope || activeMainSubmission.current || pendingDraftSubmissionsRef.current.has(scope)) return
      await window.codex.setActiveHost('local')
      if (navigationActionRevision.current !== revision || selectedThreadIdRef.current ||
        draftTerminalScopeRef.current !== scope || activeMainSubmission.current || pendingDraftSubmissionsRef.current.has(scope)) return
      setContext(next)
      if (catalog) applyHostCatalog('local', catalog)
      rememberSelectedWorkspace(localStorage, {kind: 'local', path: next.cwd})
      setNavigation((history) => pushNavigationEntry(history, {
        view: 'chats', threadId: null, cwd: next.cwd,
        hostId: 'local', projectKind: 'local', projectId: null, draftId: scope
      }))
      setAttachmentError(null)
    } catch (error) {
      if (navigationActionRevision.current === revision) setThreadNotice({message: displayError(error)})
    }
  }

  const addProject = async (): Promise<void> => {
    const selected = await window.codex.pickDirectory()
    if (!selected) return
    setSavedProjectPaths((paths) => addSavedProjectPath(paths, selected.cwd))
    setProjectPreferences((current) => ({...current, hiddenPaths: current.hiddenPaths.filter((path) => path !== selected.cwd)}))
  }

  const addComposerProject = async (): Promise<void> => {
    const selected = await window.codex.pickDirectory()
    if (!selected) return
    const revision = markNavigationAction()
    const previousHostId = appContextHostId(contextRef.current)
    const catalog = previousHostId === 'local' ? null : await loadHostCatalog('local')
    if (navigationActionRevision.current !== revision) return
    await window.codex.setActiveHost('local')
    if (navigationActionRevision.current !== revision) return
    setSavedProjectPaths((paths) => addSavedProjectPath(paths, selected.cwd))
    setProjectPreferences((current) => ({
      ...current,
      hiddenPaths: current.hiddenPaths.filter((path) => path !== selected.cwd)
    }))
    setComposerProjectPickerOpen(false)
    setContext(selected)
    if (catalog) applyHostCatalog('local', catalog)
    rememberSelectedWorkspace(localStorage, {kind: 'local', path: selected.cwd})
    startNewThread(true, selected.cwd, undefined, 'local', selected)
  }

  const refreshImportedCatalog = async (result: ExternalAgentImportResult): Promise<void> => {
    const revision = ++importCatalogRevision.current
    setSavedProjectPaths((paths) => result.projectRoots.reduce((current, path) => addSavedProjectPath(current, path), paths))
    const catalogs = await Promise.allSettled([
      window.codex.invoke<Page<Thread>>('thread/list', { limit: 50, sortKey: 'recency_at', sortDirection: 'desc' }, 'local'),
      window.codex.invoke<Page<Project>>('project/list', { limit: 100, sortKey: 'position', sortDirection: 'asc' }, 'local')
    ])
    if (revision !== importCatalogRevision.current) return
    if (catalogs[0].status === 'fulfilled') dispatch({ type: 'threadsAppended', threads: catalogs[0].value.data })
    if (catalogs[1].status === 'fulfilled') setProjects(catalogs[1].value.data)
  }

  const selectProject = async (path: string): Promise<boolean> => {
    const revision = markNavigationAction()
    const previousHostId = appContextHostId(contextRef.current)
    const next = await window.codex.getAppContext(path)
    const catalog = previousHostId === 'local' ? null : await loadHostCatalog('local')
    if (navigationActionRevision.current !== revision) return false
    await window.codex.setActiveHost('local')
    if (navigationActionRevision.current !== revision) return false
    setContext(next)
    if (catalog) applyHostCatalog('local', catalog)
    rememberSelectedWorkspace(localStorage, {kind: 'local', path: next.cwd})
    startNewThread(true, next.cwd, undefined, 'local', next)
    return true
  }

  const selectRemoteProject = async (project: RemoteProject): Promise<boolean> => {
    const revision = markNavigationAction()
    const next = await window.codex.getRemoteAppContext(project.hostId, project.remotePath, project.id)
    const [catalog, connections] = await Promise.all([
      loadHostCatalog(project.hostId),
      window.codex.listRemoteConnections()
    ])
    if (navigationActionRevision.current !== revision) return false
    await window.codex.setActiveHost(project.hostId)
    if (navigationActionRevision.current !== revision) return false
    applyHostCatalog(project.hostId, catalog)
    setRemoteConnections(connections)
    setContext(next)
    rememberSelectedWorkspace(localStorage, {
      kind: 'remote', hostId: project.hostId, projectId: project.id, path: next.cwd
    })
    startNewThread(true, next.cwd, undefined, project.hostId, next)
    return true
  }

  const selectProjectless = async (): Promise<boolean> => {
    const revision = markNavigationAction()
    const previousHostId = appContextHostId(contextRef.current)
    const next = desktopSettings.projectlessDirectory
      ? await window.codex.getAppContext(desktopSettings.projectlessDirectory)
      : await window.codex.getAppContext()
    const catalog = previousHostId === 'local' ? null : await loadHostCatalog('local')
    if (navigationActionRevision.current !== revision) return false
    await window.codex.setActiveHost('local')
    if (navigationActionRevision.current !== revision) return false
    const projectlessContext = asProjectlessContext(next)
    setContext(projectlessContext)
    if (catalog) applyHostCatalog('local', catalog)
    rememberSelectedWorkspace(localStorage, {kind: 'projectless', path: projectlessContext.cwd})
    startNewThread(true, projectlessContext.cwd, undefined, 'local', projectlessContext)
    return true
  }

  const refreshRemoteDiscovery = async (): Promise<void> => {
    setRemoteDiscoveryRefreshing(true)
    setRemoteDiscoveryError(null)
    try {
      setRemoteDiscoveredAliases(await window.codex.discoverSshConnections())
    } catch (error) {
      setRemoteDiscoveryError(displayError(error))
    } finally {
      setRemoteDiscoveryRefreshing(false)
    }
  }

  const openRemoteConnectionDialog = (): void => {
    setRemoteSelectedAliases([])
    setRemoteDiscoveryError(null)
    setRemoteDiscoveryOpen(true)
    void refreshRemoteDiscovery()
  }

  const openManualRemoteConnectionDialog = (): void => {
    setRemoteDiscoveryOpen(false)
    setRemoteConnectionError(null)
    setRemoteConnectionDialogOpen(true)
  }

  const saveDiscoveredRemoteConnections = async (): Promise<void> => {
    const selected = new Set(remoteSelectedAliases)
    const aliases = remoteDiscoveredAliases.filter((candidate) => selected.has(candidate.sshAlias))
    if (aliases.length === 0) return
    setRemoteDiscoverySaving(true)
    setRemoteDiscoveryError(null)
    try {
      const saved: RemoteConnection[] = []
      for (const alias of aliases) {
        saved.push(await window.codex.saveRemoteConnection({
          displayName: alias.displayName || alias.sshAlias,
          sshAlias: alias.sshAlias,
          host: alias.host
        }))
      }
      const results = await Promise.allSettled(
        saved.map((connection) => window.codex.connectRemoteConnection(connection.hostId))
      )
      const connections = await window.codex.listRemoteConnections()
      setRemoteConnections(connections)
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        setRemoteDiscoveryError(displayError(failure.reason))
        return
      }
      setRemoteDiscoveryOpen(false)
      setRemoteSelectedAliases([])
    } catch (error) {
      setRemoteDiscoveryError(displayError(error))
      setRemoteConnections(await window.codex.listRemoteConnections().catch(() => remoteConnections))
    } finally {
      setRemoteDiscoverySaving(false)
    }
  }

  const remoteDiscoveryAliases = useMemo(() => {
    const configuredAliases = new Set(remoteConnections.flatMap((connection) =>
      connection.sshAlias ? [connection.sshAlias.toLocaleLowerCase()] : []))
    const configuredNames = new Set(remoteConnections.map((connection) =>
      connection.displayName.toLocaleLowerCase()))
    return remoteDiscoveredAliases.map((alias) => ({
      ...alias,
      configured: configuredAliases.has(alias.sshAlias.toLocaleLowerCase()) ||
        configuredNames.has(alias.displayName.toLocaleLowerCase())
    }))
  }, [remoteConnections, remoteDiscoveredAliases])

  const saveRemoteConnection = async (options: Parameters<typeof window.codex.saveRemoteConnection>[0]): Promise<void> => {
    setRemoteConnectionBusy(true)
    setRemoteConnectionError(null)
    try {
      const saved = await window.codex.saveRemoteConnection(options)
      await window.codex.connectRemoteConnection(saved.hostId)
      const connections = await window.codex.listRemoteConnections()
      setRemoteConnections(connections)
      setRemoteConnectionDialogOpen(false)
      setRemoteProjectDialogOpen(true)
    } catch (error) {
      setRemoteConnectionError(displayError(error))
      setRemoteConnections(await window.codex.listRemoteConnections().catch(() => remoteConnections))
    } finally {
      setRemoteConnectionBusy(false)
    }
  }

  useEffect(() => {
    if (!bootstrapReady || !remoteCatalogLoaded || initialWorkspaceRestoreStarted.current) return
    const preference = parseSelectedProject(localStorage.getItem(SELECTED_PROJECT_KEY))
    const target = preference.stored ? preference.target : undefined
    if (!target || target.kind === 'local') {
      initialWorkspaceRestoreStarted.current = true
      return
    }
    if (navigationActionRevision.current !== 0 || selectedThreadIdRef.current || activeMainSubmission.current) {
      initialWorkspaceRestoreStarted.current = true
      return
    }
    initialWorkspaceRestoreStarted.current = true
    if (target.kind === 'projectless') {
      void selectProjectless().catch((error) => setThreadNotice({message: displayError(error)}))
      return
    }
    const project = remoteProjects.find((candidate) => candidate.id === target.projectId &&
      candidate.hostId === target.hostId)
    if (!project) return
    void selectRemoteProject(project).catch((error) => setThreadNotice({message: displayError(error)}))
  }, [bootstrapReady, remoteCatalogLoaded, remoteProjects])

  useEffect(() => window.codex.onActiveHostInvalidated((event) => {
    if (appContextHostId(contextRef.current) !== event.hostId) return
    void selectProjectless().then((selected) => {
      if (selected) {
        setThreadNotice({
          message: event.reason === 'deleted'
            ? '远程连接已删除，已切换到新聊天。'
            : '远程连接已断开，已切换到新聊天。'
        })
      }
    }).catch((error) => setThreadNotice({message: displayError(error)}))
  }), [desktopSettings.projectlessDirectory])

  const editProject = async (oldPath: string, update: ProjectEdit): Promise<void> => {
    const newPath = normalizeProjectPath(update.path)
    if (!newPath) throw new Error('Invalid project directory')
    // The edit dialog grants a changed root through the native directory picker.
    await window.codex.getAppContext(newPath)
    setSavedProjectPaths((paths) => addSavedProjectPath(paths.filter((path) => path !== oldPath), newPath))
    setProjectPreferences((preferences) => editProjectPreference(preferences, oldPath, newPath, update.name))
    const selectedProject = parseSelectedProject(localStorage.getItem(SELECTED_PROJECT_KEY))
    if (selectedProject.stored && selectedProject.path === oldPath) rememberSelectedProject(localStorage, newPath)
    const aliases = projects.filter((project) => project.roots.some((root) => normalizeProjectPath(root.path) === oldPath)).map((project) => project.id)
    const nextPins = migrateProjectPinnedPaths(parseSidebarStringList(localStorage.getItem(PROJECT_PINNED_KEY)), oldPath, newPath, aliases)
    localStorage.setItem(PROJECT_PINNED_KEY, JSON.stringify(nextPins))
    window.dispatchEvent(new CustomEvent(PROJECT_PINNED_EVENT))
  }
  const removeProject = (path: string): void => {
    const removal = removeSavedProjectPath(savedProjectPaths, path)
    const selectedProject = parseSelectedProject(localStorage.getItem(SELECTED_PROJECT_KEY))
    if (selectedProject.stored && selectedProject.path === path) rememberSelectedProject(localStorage, null)
    setSavedProjectPaths(removal.paths)
    setProjectPreferences((preferences) => ({ ...preferences, hiddenPaths: [...new Set([...preferences.hiddenPaths, path])] }))
    const aliases = new Set([path, `saved-path:${encodeURIComponent(path)}`, ...projects.filter((project) => project.roots.some((root) => normalizeProjectPath(root.path) === path)).map((project) => project.id)])
    const pins = parseSidebarStringList(localStorage.getItem(PROJECT_PINNED_KEY))
    const wasPinned = pins.some((entry) => aliases.has(entry) || normalizeProjectPath(entry) === path)
    const retained = pins.filter((entry) => !aliases.has(entry) && normalizeProjectPath(entry) !== path)
    localStorage.setItem(PROJECT_PINNED_KEY, JSON.stringify(retained))
    window.dispatchEvent(new CustomEvent(PROJECT_PINNED_EVENT))
    const projectName = projectPreferences.names[path] || projects.find((project) =>
      project.roots.some((root) => normalizeProjectPath(root.path) === path))?.name ||
      path.split('/').filter(Boolean).at(-1) || path
    setThreadNotice({
      message: `已移除项目“${projectName}”`,
      removedProject: {
        path,
        name: projectName,
        index: removal.index < 0 ? savedProjectPaths.length : removal.index,
        wasPinned
      }
    })
  }

  const pickComposerAttachments = async (): Promise<void> => {
    setAttachmentError(null)
    if (appContextHostId(context) !== 'local') {
      setAttachmentError('远程聊天暂不支持附加本机文件；请在提示中引用远端路径。')
      return
    }
    try {
      const selected = await window.codex.pickComposerAttachments()
      setAttachments((current) => mergeComposerAttachments(current, selected))
    } catch (error) {
      setAttachmentError(displayError(error))
    }
  }

  const handleComposerAddAction = (entry: ComposerAddMenuEntry): void => {
    if (entry.action === 'goal' || entry.action === 'plan') {
      if (selectedSession?.running || mainTurnStarting) {
        setAttachmentError('请先等待当前回复结束，再切换创作模式。')
        return
      }
      setAttachmentError(null)
      setComposerProjectPickerOpen(false)
      setComposerMode(entry.action)
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>('.main-panel .composer textarea')?.focus()
      })
      return
    }
    if (entry.action === 'work-project') {
      setComposerProjectPickerOpen(true)
      return
    }
    if (entry.action === 'plugin' && entry.pluginId) {
      setDraft((current) => insertPluginInvocation(current, entry.pluginId!))
      return
    }
    if (entry.action === 'drawing') {
      setDraft((current) => insertPluginInvocation(current, 'visualize'))
      return
    }
    if (entry.action === 'attach-electron') {
      setDraft((current) => `${current}${current && !/\s$/u.test(current) ? ' ' : ''}@Electron `)
    }
  }

  const pickSideChatAttachments = async (): Promise<void> => {
    setSideChatAttachmentError(null)
    if (appContextHostId(context) !== 'local') {
      setSideChatAttachmentError('远程聊天暂不支持附加本机文件。')
      return
    }
    try {
      const selected = await window.codex.pickComposerAttachments()
      setSideChatAttachments((current) => mergeComposerAttachments(current, selected))
    } catch (error) {
      setSideChatAttachmentError(displayError(error))
    }
  }

  const applyModelAndEffort = (id: string, nextEffort: ReasoningEffort): void => {
    setModelId(id)
    setEffort(nextEffort)
  }

  const changePermissionMode = (
    nextPermission: string,
    nextApprovalsReviewer: ApprovalsReviewer
  ): void => {
    if (isFullAccessPermission(nextPermission) && !isFullAccessPermission(permission)) {
      setPendingFullAccessSelection({
        permission: nextPermission,
        approvalsReviewer: canonicalApprovalsReviewer(nextApprovalsReviewer)
      })
      return
    }
    setPermission(nextPermission)
    setApprovalsReviewer(canonicalApprovalsReviewer(nextApprovalsReviewer))
  }

  const selectModelAndEffort = (id: string, nextEffort: ReasoningEffort): boolean => {
    if (needsUltraFullAccessConfirmation(permission, effort, nextEffort)) {
      setPendingUltraSelection({
        modelId: id,
        effort: nextEffort,
        fallbackPermission: restrictedPermissionFallback(state.permissionProfiles)
      })
      return true
    }
    applyModelAndEffort(id, nextEffort)
    return false
  }

  const changeModel = (id: string): void => {
    const model = state.models.find((candidate) => candidate.id === id)
    if (!model) {
      setModelId(id)
      return
    }
    selectModelAndEffort(id, model.defaultReasoningEffort)
  }

  const changeEffort = (nextEffort: ReasoningEffort): boolean =>
    selectModelAndEffort(modelId, nextEffort)

  const loadMoreThreads = async (): Promise<void> => {
    if (catalogLoadingMore) return
    const searchingServer = searchResults !== null
    const cursor = searchingServer
      ? searchNextCursor
      : catalogView === 'archived'
        ? archivedNextCursor
        : threadsNextCursor
    if (!cursor) return

    setCatalogLoadingMore(true)
    setCatalogError(null)
    try {
      if (searchingServer) {
        const page = await window.codex.invoke<ThreadSearchPage>('thread/search', {
          searchTerm: search.trim(),
          cursor,
          limit: 50,
          sortKey: 'recency_at',
          sortDirection: 'desc',
          archived: catalogView === 'archived'
        }, appContextHostId(contextRef.current))
        if (page.nextCursor && seenSearchCursors.current.has(page.nextCursor)) {
          throw new Error('The server repeated a search cursor')
        }
        if (page.nextCursor) seenSearchCursors.current.add(page.nextCursor)
        setSearchResults((entries) => {
          const merged = new Map((entries || []).map((entry) => [entry.thread.id, entry]))
          for (const entry of page.data) merged.set(entry.thread.id, entry)
          return [...merged.values()]
        })
        setSearchNextCursor(page.nextCursor || null)
      } else {
        const archived = catalogView === 'archived'
        const page = await window.codex.invoke<Page<Thread>>('thread/list', {
          archived,
          cursor,
          limit: 50,
          sortKey: 'recency_at',
          sortDirection: 'desc'
        }, appContextHostId(contextRef.current))
        const seen = archived ? seenArchivedCursors.current : seenThreadCursors.current
        if (page.nextCursor && seen.has(page.nextCursor)) {
          throw new Error('The server repeated a thread-list cursor')
        }
        if (page.nextCursor) seen.add(page.nextCursor)
        if (archived) {
          setArchivedThreads((threads) => {
            const merged = new Map(threads.map((thread) => [thread.id, thread]))
            for (const thread of page.data) merged.set(thread.id, thread)
            return [...merged.values()]
          })
          setArchivedNextCursor(page.nextCursor || null)
        } else {
          dispatch({ type: 'threadsAppended', threads: page.data })
          setThreadsNextCursor(page.nextCursor || null)
        }
      }
    } catch (error) {
      setCatalogError(displayError(error))
    } finally {
      setCatalogLoadingMore(false)
    }
  }

  const toggleThreadPinned = (thread: Thread): void => {
    const pinned = threadPreferences.pinned.includes(thread.id)
    setThreadPreferences((current) => setThreadPinned(current, thread.id, !pinned))
  }

  const toggleThreadUnread = (thread: Thread): void => {
    const unread = threadPreferences.unread.includes(thread.id)
    setThreadPreferences((current) => setThreadUnread(current, thread.id, !unread))
  }

  const openThreadDialog = (
    mode: ThreadDialogMode,
    thread: Thread,
    turnId?: string
  ): void => {
    setThreadActionError(null)
    setThreadDialog({ mode, thread, turnId })
  }

  const submitThreadDialog = async (name?: string): Promise<void> => {
    if (!threadDialog || threadActionBusy) return
    const { mode, thread } = threadDialog
    setThreadActionBusy(true)
    setThreadActionError(null)
    try {
      if (mode === 'rename') {
        const hostId = threadHostId(thread)
        const nextName = name?.trim()
        if (!nextName) return
        const previousName = thread.name || null
        dispatch({ type: 'threadRenamed', threadId: thread.id, name: nextName })
        setArchivedThreads((threads) =>
          threads.map((candidate) =>
            candidate.id === thread.id ? { ...candidate, name: nextName } : candidate
          )
        )
        try {
          await window.codex.invoke('thread/name/set', { threadId: thread.id, name: nextName }, hostId)
        } catch (error) {
          dispatch({ type: 'threadRenamed', threadId: thread.id, name: previousName })
          setArchivedThreads((threads) =>
            threads.map((candidate) =>
              candidate.id === thread.id ? { ...candidate, name: previousName } : candidate
            )
          )
          throw error
        }
      } else if (mode === 'delete') {
        await window.codex.invoke('thread/delete', { threadId: thread.id }, threadHostId(thread))
        invalidateRemovedThreadSelection(thread.id)
        pendingSteerRecoveries.current.delete(thread.id)
        setComposerDrafts((drafts) => {
          if (!(thread.id in drafts)) return drafts
          const next = { ...drafts }
          delete next[thread.id]
          return next
        })
        dispatch({ type: 'threadRemoved', threadIds: [thread.id] })
        setArchivedThreads((threads) => threads.filter((candidate) => candidate.id !== thread.id))
        setThreadPreferences((current) => removeThreadPreferences(current, [thread.id]))
      } else {
        const target = latestUserTurnTarget(state.sessions[thread.id]?.turns || [])
        const disabledReason = revertDisabledReason(thread, {
          loaded: loadedThreadId === thread.id && !hydrating,
          writable: resumedThreadIdRef.current === thread.id,
          running: Boolean(state.sessions[thread.id]?.running)
        })
        if (disabledReason) throw new Error(disabledReason)
        if (!threadDialog.turnId || target?.turnId !== threadDialog.turnId) {
          throw new Error('最新的用户轮次已更改，请检查聊天后再恢复。')
        }
        const response = await window.codex.invoke<ThreadRevertResponse>('thread/revert', {
          threadId: thread.id,
          beforeTurnId: threadDialog.turnId
        }, threadHostId(thread))
        dispatch({
          type: 'threadReverted',
          threadId: thread.id,
          beforeTurnId: threadDialog.turnId
        })
        const refreshed = await selectThread({ ...thread, ...response.thread, turns: [] })
        setThreadNotice({
          message: refreshed
            ? '聊天记录已恢复。工作目录中的文件未恢复。'
            : '聊天记录已恢复，但无法加载刷新的对话内容。工作目录中的文件未恢复。'
        })
      }
      setThreadDialog(null)
    } catch (error) {
      if (mode === 'revert') {
        const refreshed = await selectThread(thread)
        setThreadDialog(null)
        setThreadNotice({
          message: refreshed
            ? `无法确认恢复结果，已刷新聊天记录：${displayError(error)}`
            : `无法确认恢复结果，也无法刷新聊天记录：${displayError(error)}`
        })
      } else {
        setThreadActionError(displayError(error))
      }
    } finally {
      setThreadActionBusy(false)
    }
  }

  const projectThreadClientForHost = (hostId: string): ProjectThreadOperationsClient => ({
    list: (params) => window.codex.invoke<Page<Thread>>('thread/list', params, hostId),
    read: async (threadId) => (await window.codex.invoke<{thread: Thread}>('thread/read', {threadId, includeTurns: true}, hostId)).thread,
    interrupt: async (threadId, turnId) => { await window.codex.invoke('turn/interrupt', {threadId, turnId}, hostId) },
    archive: async (threadId) => { await window.codex.invoke('thread/archive', {threadId}, hostId) }
  })
  const projectThreadClient = projectThreadClientForHost('local')
  const rememberArchivedThread = (thread: Thread): void => {
    invalidateRemovedThreadSelection(thread.id)
    dispatch({ type: 'threadRemoved', threadIds: [thread.id] })
    setArchivedThreads((threads) => [thread, ...threads.filter((candidate) => candidate.id !== thread.id)])
  }

  const openSidebarProjectDialog = (
    mode: SidebarProjectDialogMode,
    project: SidebarProjectCollection
  ): void => {
    setSidebarProjectActionError(null)
    setSidebarProjectDialog({ mode, project: { name: project.name, path: project.path } })
  }

  const submitSidebarProjectDialog = async (update?: ProjectEdit): Promise<void> => {
    if (!sidebarProjectDialog || sidebarProjectActionBusy) return
    setSidebarProjectActionBusy(true)
    setSidebarProjectActionError(null)
    try {
      if (sidebarProjectDialog.mode === 'remove') removeProject(sidebarProjectDialog.project.path)
      else if (update) await editProject(sidebarProjectDialog.project.path, update)
      setSidebarProjectDialog(null)
    } catch (error) {
      setSidebarProjectActionError(displayError(error))
    } finally {
      setSidebarProjectActionBusy(false)
    }
  }

  const submitSidebarProjectArchive = async (): Promise<void> => {
    if (!sidebarProjectArchive || sidebarProjectActionBusy) return
    const { project } = sidebarProjectArchive
    setSidebarProjectActionBusy(true)
    setSidebarProjectActionError(null)
    try {
      const result = await archiveAllProjectThreads(
        project.path,
        projectThreadClientForHost(project.hostId || 'local'),
        rememberArchivedThread
      )
      if (result.failures.length) {
        setSidebarProjectActionError(`已归档 ${result.archivedThreadIds.length} 个聊天，${result.failures.length} 个失败。`)
        return
      }
      setSidebarProjectArchive(null)
      setThreadNotice({ message: `已归档“${project.name}”中的 ${result.archivedThreadIds.length} 个聊天` })
    } catch (error) {
      setSidebarProjectActionError(displayError(error))
    } finally {
      setSidebarProjectActionBusy(false)
    }
  }

  const archiveThread = async (thread: Thread): Promise<boolean> => {
    setThreadNotice(null)
    try {
      await stopAndArchiveProjectThread(thread.id, projectThreadClientForHost(threadHostId(thread)))
      rememberArchivedThread(thread)
      setThreadNotice({ message: '聊天已归档', archivedThread: thread })
      return true
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
      return false
    }
  }

  const unarchiveThread = async (thread: Thread): Promise<void> => {
    setThreadNotice(null)
    try {
      const response = await window.codex.invoke<{ thread: Thread }>('thread/unarchive', {
        threadId: thread.id
      }, threadHostId(thread))
      setArchivedThreads((threads) =>
        threads.filter((candidate) => candidate.id !== thread.id)
      )
      dispatch({ type: 'threadUpserted', thread: response.thread })
      setThreadNotice({ message: '聊天已恢复' })
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
    }
  }

  const forkThread = async (thread: Thread, lastTurnId?: string): Promise<void> => {
    if (state.sessions[thread.id]?.running) {
      setThreadNotice({ message: '请先停止当前轮次，再创建聊天分叉。' })
      return
    }
    setThreadNotice(null)
    try {
      const response = await window.codex.invoke<ThreadResumeResponse>('thread/fork', {
        threadId: thread.id,
        excludeTurns: false,
        ...(lastTurnId ? { lastTurnId } : {})
      }, threadHostId(thread))
      setCatalogView('active')
      dispatch({ type: 'threadUpserted', thread: response.thread })
      const loaded = await selectThread(response.thread)
      setThreadNotice({ message: loaded
        ? '已创建新的聊天分叉'
        : '已创建聊天分叉，但无法加载历史记录；请重试打开该聊天。' })
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
    }
  }

  const forkThreadInNewWorktree = async (thread: Thread): Promise<void> => {
    if (threadHostId(thread) !== 'local') {
      setThreadNotice({message: '远程聊天无法分叉到本地工作树。'})
      return
    }
    if (state.sessions[thread.id]?.running) {
      setThreadNotice({ message: '请先停止当前轮次，再创建聊天分叉。' })
      return
    }
    setThreadNotice(null)
    setWorktreeCreating(true)
    try {
      const response = await window.codex.forkThreadInNewWorktree<Thread>({
        threadId: thread.id,
        cwd: thread.cwd
      })
      setCatalogView('active')
      dispatch({ type: 'threadUpserted', thread: response.thread })
      const loaded = await selectThread(response.thread)
      setThreadNotice({
        message: loaded
          ? '已分叉到新的工作树'
          : '聊天已分叉到新的工作树，请重试打开以加载历史记录。'
      })
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
    } finally {
      setWorktreeCreating(false)
    }
  }

  const compactThread = async (thread: Thread): Promise<void> => {
    if (compactingThreadIds.includes(thread.id)) return
    setCompactingThreadIds((ids) => [...ids, thread.id])
    setThreadNotice(null)
    try {
      await window.codex.invoke('thread/compact/start', { threadId: thread.id }, threadHostId(thread))
      setThreadNotice({ message: '已开始压缩聊天' })
    } catch (error) {
      setCompactingThreadIds((ids) => ids.filter((id) => id !== thread.id))
      setThreadNotice({ message: displayError(error) })
    }
  }

  const copyConversationValue = async (value: string, message: string): Promise<void> => {
    try {
      await copyTextToClipboard(value)
      setThreadNotice({ message })
    } catch (error) {
      setThreadNotice({ message: displayError(error) })
    }
  }

  const runConversationMenuAction = (action: ConversationMenuAction): void => {
    if (!selectedThread) return
    if (action === 'rename') openThreadDialog('rename', selectedThread)
    if (action === 'toggle-pin') toggleThreadPinned(selectedThread)
    if (action === 'open-side-chat') {
      openSideChat()
    }
    if (action === 'fork-same-worktree') void forkThread(selectedThread)
    if (action === 'fork-new-worktree') {
      void forkThreadInNewWorktree(selectedThread)
    }
    if (action === 'copy-deeplink') {
      void copyConversationValue(
        `codex://threads/${encodeURIComponent(selectedThread.id)}`,
        '已复制聊天链接'
      )
    }
    if (action === 'copy-markdown') {
      void copyConversationValue(
        conversationMarkdown(selectedThread, selectedSession),
        '已将聊天复制为 Markdown'
      )
    }
    if (action === 'copy-working-directory') {
      void copyConversationValue(selectedThread.cwd, '已复制工作目录')
    }
    if (action === 'open-new-window') {
      void window.codex.openThreadInNewWindow(selectedThread.id, threadHostId(selectedThread)).catch((error) => {
        setThreadNotice({ message: displayError(error) })
      })
    }
    if (action === 'open-finder' || action === 'open-terminal') {
      void window.codex
        .openWorkingDirectory(
          selectedThread.cwd,
          action === 'open-finder' ? 'finder' : 'terminal'
        )
        .catch((error) => setThreadNotice({ message: displayError(error) }))
    }
    if (action === 'archive') void archiveThread(selectedThread)
  }

  useEffect(() => {
    const onConversationShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!selectedThread || settingsOpen || event.defaultPrevented) return
      const key = event.key.toLowerCase()
      let action: ConversationMenuAction | null = null
      if (event.metaKey && event.altKey && !event.shiftKey && key === 'r') action = 'rename'
      if (event.metaKey && event.altKey && !event.shiftKey && key === 'p') action = 'toggle-pin'
      if (event.metaKey && event.altKey && !event.shiftKey && key === 's') action = 'open-side-chat'
      if (event.metaKey && event.shiftKey && !event.altKey && key === 'a') action = 'archive'
      if (!action) return
      event.preventDefault()
      runConversationMenuAction(action)
    }
    window.addEventListener('keydown', onConversationShortcut)
    return () => window.removeEventListener('keydown', onConversationShortcut)
  })

  const undoArchive = async (): Promise<void> => {
    const thread = threadNotice?.archivedThread
    if (!thread) return
    setThreadNotice(null)
    await unarchiveThread(thread)
  }

  const undoProjectRemoval = (): void => {
    const removed = threadNotice?.removedProject
    if (!removed) return
    setSavedProjectPaths((paths) => restoreSavedProjectPath(paths, removed.path, removed.index))
    setProjectPreferences((preferences) => ({
      ...preferences,
      hiddenPaths: preferences.hiddenPaths.filter((path) => path !== removed.path)
    }))
    if (removed.wasPinned) {
      const pins = parseSidebarStringList(localStorage.getItem(PROJECT_PINNED_KEY))
      if (!pins.some((entry) => normalizeProjectPath(entry) === removed.path)) {
        localStorage.setItem(PROJECT_PINNED_KEY, JSON.stringify([...pins, removed.path]))
        window.dispatchEvent(new CustomEvent(PROJECT_PINNED_EVENT))
      }
    }
    setThreadNotice(null)
  }

  const restartBackend = async (): Promise<void> => {
    setBackend({ state: 'starting', mode: 'direct' })
    try {
      await window.codex.restartBackend(appContextHostId(contextRef.current))
    } catch (error) {
      setBackend({ state: 'error', mode: 'direct', message: displayError(error) })
    }
  }

  const respondToServerRequest = async (
    request: RpcServerRequest,
    response: RpcServerResponse
  ): Promise<void> => {
    setServerRequestBusy(true)
    setServerRequestError(null)
    try {
      await window.codex.respondToServerRequest(request.id, response, request.hostId)
      updateServerRequestQueue((queue) => removeServerRequest(queue, request.id))
    } catch (error) {
      try {
        const pending = await window.codex.listPendingServerRequests(request.hostId)
        const requestIsPending = pending.some(
          (candidate) => serverRequestIdKey(candidate.id) === serverRequestIdKey(request.id)
        )
        if (requestIsPending) {
          setServerRequestError(displayError(error))
        } else {
          updateServerRequestQueue((queue) => removeServerRequest(queue, request.id))
          setServerRequestError(null)
        }
      } catch {
        setServerRequestError(displayError(error))
      }
    } finally {
      setServerRequestBusy(false)
    }
  }

  const searchedThreads = searchResults?.map((entry) => entry.thread) || null
  const catalogThreads = searchedThreads
    ? searchedThreads
    : catalogView === 'archived'
      ? archivedThreads
      : orderThreadsWithPins(state.threads, threadPreferences.pinned)
  const searchSnippets = new Map(
    (searchResults || []).map((entry) => [entry.thread.id, entry.snippet])
  )
  const catalogHasMore = Boolean(
    searchResults !== null
      ? searchNextCursor
      : catalogView === 'archived'
        ? archivedNextCursor
        : threadsNextCursor
  )
  const sidebarProjects = useMemo(
    () => overlayProjectPreferences(projectCatalogForSavedPaths(projects, savedProjectPaths), projectPreferences),
    [projects, savedProjectPaths, projectPreferences]
  )
  const projectPaths = useMemo(
    () => deriveProjectPaths(sidebarProjects, []),
    [sidebarProjects]
  )
  const runningThreadIds = useMemo(
    () =>
      Object.entries(state.sessions)
        .filter(([, session]) => session.running || Boolean(session.activeTurnId))
        .map(([threadId]) => threadId),
    [state.sessions]
  )
  const projectSummarySnapshot = useMemo(
    () => collectWorkspacePaneSnapshot(selectedSession, context?.cwd),
    [context?.cwd, selectedSession]
  )
  const projectSummaryModel = useMemo(
    () => collectWorkspaceSummaryPanelsModel(selectedSession, projectSummarySnapshot),
    [projectSummarySnapshot, selectedSession]
  )
  const workbenchBrowserRecents = useMemo(
    () => collectWorkbenchBrowserRecents(selectedSession),
    [selectedSession]
  )
  const orderedRightWorkbenchTabs = reconcileRightWorkbenchTabs(
    rightWorkbenchTabs,
    availableRightWorkbenchTabs
  )
  const activeRightTabId = orderedRightWorkbenchTabs.activeId
  const activeRightKind = activeRightTabId ? rightWorkbenchTabKind(activeRightTabId) : null
  const rightSurface: RightWorkbenchSurface | null = activeRightKind === 'side-chat'
    ? 'sideChat'
    : activeRightKind
  const activeBrowserTabId = activeRightKind === 'browser' && activeRightTabId
    ? rightWorkbenchTabValue(activeRightTabId) : null
  const rightWorkbenchOpen = rightWorkbenchVisible && orderedRightWorkbenchTabs.order.length > 0
  const visibleRightSurface = rightWorkbenchOpen && rightWorkbenchSurfaceVisible ? rightSurface : null
  const projectSummaryMode = projectSummaryDisplayMode(rightWorkbenchResize.workspaceWidth)
  const projectSummary = projectSummaryPresentation({
    displayMode: projectSummaryMode,
    pinned: projectSummaryPinned,
    popoverOpen: projectSummaryPopoverOpen
  })
  const projectSummaryButtonPressed = projectSummary.visibleSurface !== null
  const projectSummaryInlineVisible = Boolean(
    selectedThread &&
    projectSummary.visibleSurface === 'inline' &&
    !workspaceOpen &&
    !rightWorkbenchOpen
  )
  const projectSummaryPopoverVisible = Boolean(
    selectedThread &&
    projectSummary.visibleSurface === 'popover' &&
    !workspaceOpen &&
    !rightWorkbenchOpen
  )
  useEffect(() => {
    if (
      projectSummaryMode !== 'overlay' ||
      workspaceOpen ||
      rightWorkbenchOpen ||
      !selectedThread
    ) {
      setProjectSummaryPopoverOpen(false)
    }
  }, [projectSummaryMode, rightWorkbenchOpen, selectedThread?.id, workspaceOpen])
  const toggleProjectSummary = (): void => {
    if (projectSummaryMode === 'overlay') {
      setProjectSummaryPopoverOpen((open) => !open)
      return
    }
    setProjectSummaryPopoverOpen(false)
    setProjectSummaryPinned((pinned) => !pinned)
  }
  const nativeBrowserVisible = visibleRightSurface === 'browser' && Boolean(activeBrowserTabId) &&
    !rendererOverlayOpen && !windowCloseRequest && !threadDialog && !localEnvironmentOpen && !projectModalOpen && serverRequestQueue.length === 0
  const finishRightWorkbenchResize = (rawWidth: number): void => {
    if (rawWidth < 160) {
      rightWorkbenchResize.cancel()
      collapseRightWorkbench()
      return
    }
    if (rightWorkbenchResize.workspaceWidth - rawWidth < 160) {
      rightWorkbenchResize.cancel()
      setProjectSummaryPopoverOpen(false)
      if (visibleRightSurface === 'workspace') handleWorkspaceLayoutModeChange('full')
      else setRightWorkbenchView(enterRightWorkbenchFullView())
      return
    }
    rightWorkbenchResize.commit(rawWidth)
  }
  const renderRightWorkbenchResizeHandle = (insideWorkspace = false): ReactNode => rightWorkbenchOpen &&
    rightWorkbenchSurfaceVisible &&
    !rightWorkbenchFullView
    ? <RightWorkbenchResizeHandle
        width={rightWorkbenchResize.width}
        minimumWidth={rightWorkbenchResize.minimumWidth}
        maximumWidth={rightWorkbenchResize.maximumWidth}
        defaultWidth={rightWorkbenchResize.defaultWidth}
        onResize={rightWorkbenchResize.resize}
        onResizeEnd={finishRightWorkbenchResize}
        onReset={rightWorkbenchResize.reset}
        uiZoom={windowZoom}
        style={insideWorkspace ? {
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: -8,
          marginInline: 0,
          alignSelf: 'auto',
          flex: 'none'
        } : undefined}
      />
    : null
  const rightWorkbenchTitleTabs = orderedRightWorkbenchTabs.order.flatMap<RightWorkbenchTitleTab>((id) => {
    const value = rightWorkbenchTabValue(id)
    const kind = rightWorkbenchTabKind(id)
    if (kind === 'workspace') {
      const tab = workspaceChromeState.tabs.find((entry) => entry.id === value)
      return tab ? [{id, label: tab.label, title: tab.path || tab.label, kind: tab.kind, dirty: tab.dirty}] : []
    }
    if (kind === 'subagent') {
      const tab = openedSubagents.find((entry) => entry.threadId === value)
      return tab ? [{id, label: tab.name, title: tab.name, kind: 'subagent'}] : []
    }
    if (kind === 'side-chat') return [{id, label: '侧边聊天', title: '侧边聊天', kind: 'side-chat'}]
    if (kind === 'browser') {
      const tab = browserTabs.find((entry) => entry.id === value)
      if (!tab) return []
      const label = browserTabLabel(tab)
      return [{id, label, title: tab.state?.url || label, kind: 'browser'}]
    }
    const tab = terminalState.tabs.find((entry) => entry.id === value)
    return tab ? [{id, label: terminalTabTitle(tab, terminalState.tabs), title: tab.cwd, kind: 'terminal'}] : []
  })

  return (
    <SubagentActivityContext.Provider value={{ parentModel: selectedThread?.model || modelId, names: subagentNames(selectedSession?.turns.flatMap((turn) => turn.items) || []), onOpen: (threadId, name) => {
      if (threadId === selectedThread?.id) return
      openSubagent(threadId, name)
    } }}>
    <div
      className="app-shell"
      data-backend-state={backend.state}
      data-backend-mode={backend.mode}
      style={{...sidebarWidth.style, ...rightWorkbenchResize.style}}
    >
      <WindowTitlebar
        backend={backend}
        context={context}
        thread={selectedThread}
        threadPinned={Boolean(
          selectedThread && threadPreferences.pinned.includes(selectedThread.id)
        )}
        sidebarOpen={sidebarOpen}
        rightWorkbenchTabs={rightWorkbenchTitleTabs}
        activeRightTabId={rightWorkbenchChatSelected ? null : activeRightTabId}
        rightWorkbenchOpen={rightWorkbenchOpen}
        rightWorkbenchFullView={rightWorkbenchFullView}
        rightWorkbenchChatSelected={rightWorkbenchChatSelected}
        retainedRightTabCount={rightWorkbenchTitleTabs.length}
        projectSummaryOpen={projectSummaryButtonPressed}
        projectSummaryAnchorRef={projectSummaryAnchorRef}
        settingsMode={settingsOpen || primaryView !== 'chats'}
        showSidebarToggle={primaryView === 'scheduled'}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onConversationAction={runConversationMenuAction}
        onToggleProjectSummary={toggleProjectSummary}
        onActivateRightTab={activateRightTab}
        onCloseRightTab={closeRightTab}
        onMoveRightTab={(id, beforeId) => setRightWorkbenchTabs((current) => moveRightWorkbenchTab(current, id, beforeId))}
        onToggleRightWorkbenchFullView={toggleRightWorkbenchFullView}
        onCollapseRightWorkbench={collapseRightWorkbench}
        onRevealRightWorkbench={() => setRightWorkbenchView((current) => revealRightWorkbenchView(current))}
        onShowChat={showRightWorkbenchChat}
        onOpenNewWorkbenchTab={openNewWorkbenchTab}
        canGoBack={!navigationBusy && canNavigateBack(navigation)}
        canGoForward={!navigationBusy && canNavigateForward(navigation)}
        onGoBack={() => void goNavigation('back')}
        onGoForward={() => void goNavigation('forward')}
        onRestart={() => void restartBackend()}
      />
      <ProjectSummaryPopover
        projectName={context?.folderName || (selectedThread ? compactPath(selectedThread.cwd) : '项目')}
        changesCount={projectSummarySnapshot.changes.length}
        subagents={projectSummaryModel.subagents}
        sources={projectSummaryModel.sources}
        open={projectSummaryPopoverVisible}
        anchorRef={projectSummaryAnchorRef}
        onClose={() => setProjectSummaryPopoverOpen(false)}
        onOpenChanges={() => {
          activateWorkspace()
          window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT, { detail: { tab: 'changes' } }))
        }}
        onOpenSubagents={() => {
          activateWorkspace()
          window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT, { detail: { tab: 'subagents' } }))
        }}
        onOpenSource={(source?: ProjectSummarySource) => {
          if (source?.url) {
            openNewWorkbenchTab(source.url)
            return
          }
          if (source?.path) {
            activateWorkspace()
            if (source.kind === 'image') dispatchWorkspaceSourceImage(source.path)
            else dispatchWorkspaceFileLink({ path: source.path, line: null })
            return
          }
          activateWorkspace()
          window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT, { detail: { tab: 'sources' } }))
        }}
        onAddSource={() => document.querySelector<HTMLButtonElement>('.composer-add-menu-trigger')?.click()}
        onOpenProjectMenu={() => document.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()}
      />
      <div className="workspace-frame">
        <ActivityRail
          activeView={primaryView}
          hasUnread={threadPreferences.unread.length > 0}
          onOpenChats={() => openPrimaryView('chats')}
          onOpenScheduled={() => openPrimaryView('scheduled')}
          onOpenMarketplace={() => openPrimaryView('marketplace')}
          onOpenProjects={() => openPrimaryView('projects')}
          settingsOpen={settingsOpen}
          onOpenSettings={() => openSettings()}
          onOpenKeyboardShortcuts={() => openSettings('shortcuts')}
        />
        {settingsOpen ? (
          <SettingsPage
            backend={backend}
            context={context}
            theme={theme}
            initialSection={settingsInitialSection}
            onToggleTheme={toggleTheme}
            themePreference={themePreference}
            onThemePreferenceChange={setThemePreference}
            onThreadRestored={(thread) => {
              dispatch({ type: 'threadUpserted', thread })
              setArchivedThreads((threads) => threads.filter((entry) => entry.id !== thread.id))
            }}
            onOpenThread={(thread) => {
              setSettingsOpen(false)
              setCatalogView('active')
              void selectThread(thread)
            }}
            projectPaths={projectPaths}
            onImportCompleted={(result) => { void refreshImportedCatalog(result) }}
            onAddProject={addProject}
            onNewThreadInProject={(path) => { void selectProject(path).catch((error) => setThreadNotice({message: displayError(error)})) }}
          />
        ) : primaryView === 'scheduled' ? (
          <ScheduledTasksPage
            sidebarOpen={sidebarOpen}
            cwd={context?.cwd}
            hostId={appContextHostId(context)}
          />
        ) : primaryView === 'marketplace' ? (
          <MarketplacePage
            backend={backend}
            cwd={context?.cwd || null}
            onOpenSettings={() => openSettings()}
          />
        ) : primaryView === 'projects' ? (
          <ProjectsPanel
            paths={projectPaths}
            currentPath={context?.cwd || null}
            threads={state.threads}
            onAddProject={addProject}
            onBackToChats={() => openPrimaryView('chats')}
            projectNames={projectPreferences.names}
            hiddenPaths={projectPreferences.hiddenPaths}
            pinnedPaths={projectPaths.filter((path) => projectPins.includes(path) || sidebarProjects.some((project) => projectPins.includes(project.id) && project.roots.some((root) => root.path === path)))}
            onSelectProject={selectProject}
            runningThreadIds={runningThreadIds}
            pinnedThreadIds={threadPreferences.pinned}
            onToggleThreadPinned={toggleThreadPinned}
            onRenameThread={(thread) => openThreadDialog('rename', thread)}
            onArchiveThread={archiveThread}
            onLoadProjectThreads={(path) => loadAllProjectThreads(path, projectThreadClient)}
            onArchiveProjectThreads={(path) => archiveAllProjectThreads(path, projectThreadClient, rememberArchivedThread)}
            onOpenThread={async (threadId) => {
              const revision = markNavigationAction()
              const response = await window.codex.invoke<{thread: Thread}>('thread/read', {threadId, includeTurns: true}, 'local')
              if (navigationActionRevision.current !== revision) return false
              return selectThread(response.thread)
            }}
            onEditProject={editProject}
            onRenameProject={(path, name) => editProject(path, {name, path})}
            onRemoveProject={removeProject}
            onToggleProjectPinned={(path, pinned) => {
              const aliases = sidebarProjects.filter((project) => project.roots.some((root) => root.path === path)).map((project) => project.id)
              if (projectPins.some((entry) => entry === path || aliases.includes(entry)) !== pinned) toggleProjectPin(path, aliases)
            }}
          />
        ) : (
          <>
            {sidebarOpen && (
              <Sidebar
            threads={catalogThreads}
            projects={sidebarProjects}
            remoteProjects={remoteProjects}
            remoteConnections={remoteConnections}
            selectedThreadId={state.selectedThreadId}
            selectedProjectId={context?.projectId || null}
            selectedProjectPath={context?.cwd || null}
            selectedHostId={appContextHostId(context)}
            loading={searchLoading || (catalogView === 'archived' ? archivedLoading : state.loadingThreads)}
            searching={searching}
            search={search}
            searchSnippets={searchSnippets}
            catalogView={catalogView}
            catalogError={catalogError}
            hasMore={catalogHasMore}
            loadingMore={catalogLoadingMore}
            pinnedThreadIds={threadPreferences.pinned}
            unreadThreadIds={threadPreferences.unread}
            compactingThreadIds={compactingThreadIds}
            runningThreadIds={runningThreadIds}
            onSearch={setSearch}
            onToggleSearch={() => {
              setSearching((value) => !value)
              if (searching) setSearch('')
            }}
            onCatalogViewChange={(view) => {
              setCatalogView(view)
              setSearch('')
              setSearchResults(null)
            }}
            onNewThread={() => startNewThread()}
            onAddProject={addProject}
            onNewThreadInProject={(path) => { void selectProject(path).catch((error) => setThreadNotice({message: displayError(error)})) }}
            onNewThreadInRemoteProject={(hostId, projectId) => {
              const project = remoteProjects.find((candidate) =>
                candidate.hostId === hostId && candidate.id === projectId)
              if (!project) {
                setThreadNotice({message: '远程项目不可用，请刷新连接后重试。'})
                return
              }
              void selectRemoteProject(project).catch((error) => {
                setThreadNotice({message: displayError(error)})
              })
            }}
            onEditSidebarProject={(project) => openSidebarProjectDialog('edit', project)}
            onRevealSidebarProject={(project) => {
              void window.codex.openWorkingDirectory(project.path, 'finder').catch((error) => {
                setThreadNotice({message: displayError(error)})
              })
            }}
            onMarkSidebarProjectRead={(project) => {
              const threadIds = new Set(project.threads.map((thread) => thread.id))
              setThreadPreferences((current) => ({
                ...current,
                unread: current.unread.filter((threadId) => !threadIds.has(threadId))
              }))
            }}
            onArchiveSidebarProject={(project) => {
              setSidebarProjectActionError(null)
              setSidebarProjectArchive({project})
            }}
            onRemoveSidebarProject={(project) => openSidebarProjectDialog('remove', project)}
            onSelectThread={(thread) => {
              if (catalogView === 'active') void selectThread(thread)
            }}
            onLoadMore={() => void loadMoreThreads()}
            onRename={(thread) => openThreadDialog('rename', thread)}
            onTogglePin={toggleThreadPinned}
            onToggleUnread={toggleThreadUnread}
            onArchive={(thread) => void archiveThread(thread)}
            onUnarchive={(thread) => void unarchiveThread(thread)}
            onDelete={(thread) => openThreadDialog('delete', thread)}
            onFork={(thread) => void forkThread(thread)}
            onCompact={(thread) => void compactThread(thread)}
              />
            )}
            {sidebarOpen && (
              <SidebarResizeHandle
                width={sidebarWidth.width}
                onWidthChange={sidebarWidth.setWidth}
                uiZoom={windowZoom}
              />
            )}
            <div className={`chat-workspace${rightWorkbenchOpen ? ' has-right-workbench' : ''}${visibleRightSurface === 'sideChat' || visibleRightSurface === 'subagent' || visibleRightSurface === 'browser' || visibleRightSurface === 'terminal' ? ' has-side-chat' : ''}${visibleRightSurface === 'subagent' ? ' has-subagent-panel' : ''}${rightWorkbenchOpen && rightWorkbenchSurfaceVisible && rightWorkbenchFullView && visibleRightSurface !== 'workspace' ? ' right-workbench-full-view' : ''}${terminalSheetOpen ? ' has-background-terminal' : ''}`}>
              <div className={`chat-terminal-column${terminalState.fullView.bottom && terminalState.visible.bottom ? ' terminal-full-view' : ''}`}>
              <div ref={rightWorkbenchContainerRef} className="chat-conversation-row">
              <main className="main-panel" data-workspace-layout={selectedThread ? workspaceLayouts[selectedThread.id] || 'split' : newThreadWorkspaceLayout}>
                {selectedThread && loadedThreadId === selectedThread.id && appContextHostId(context) === 'local' && (
                  <WorkspacePane
                    key={`${rightWorkbenchScope}:${context?.cwd || ''}`}
                    initialExpanded={workspaceOpen}
                    layoutMode={workspaceLayouts[selectedThread.id] || 'split'}
                    onLayoutModeChange={handleWorkspaceLayoutModeChange}
                    onExpandedChange={handleWorkspaceExpandedChange}
                    onChromeStateChange={handleWorkspaceChromeStateChange}
                    workbenchVisible={workspaceOpen
                      ? rightWorkbenchOpen && !rightWorkbenchChatSelected && visibleRightSurface === 'workspace'
                      : projectSummaryInlineVisible}
                    integratedChrome
                    resizeHandle={visibleRightSurface === 'workspace' ? renderRightWorkbenchResizeHandle(true) : null}
                    session={selectedSession}
                    cwd={context?.cwd}
                    loading={hydrating}
                    comments={diffComments}
                    commentScopeKey={diffCommentScope}
                    onCommentsChange={selectedThreadReady ? (comments) => diffCommentsStore.set(diffCommentScope, comments) : undefined}
                    onOpenSubagent={openSubagent}
                  />
                )}
                <Conversation
            thread={selectedThread}
            session={selectedSession}
            interruptedTurnIds={interruptedTurnIds.current}
            completedGoal={selectedCompletedGoal}
            completedGoalTurnId={selectedCompletedGoalTurnId}
            starting={mainTurnStarting || Boolean(pendingMainSubmission)}
            thinking={mainTurnThinking}
            pendingUserMessage={pendingUserMessage?.item || pendingMainDraft?.message.item || null}
            workspaceName={context?.folderName || '项目'}
            workspaceCwd={context?.projectKind === 'projectless' ? null : context?.cwd || null}
            onPickWorkspace={() => void pickHeroProject()}
            hydrating={hydrating}
            historyError={historyError}
            hasEarlier={Boolean(historyNextCursor)}
            loadingEarlier={historyLoadingEarlier}
            loaded={Boolean(selectedThread && loadedThreadId === selectedThread.id)}
            writerReady={selectedThreadReady}
            onLoadEarlier={() => void loadEarlierTurns()}
            onRevert={(turnId) => {
              if (selectedThread) openThreadDialog('revert', selectedThread, turnId)
            }}
            onFork={(turnId) => {
              if (selectedThread) void forkThread(selectedThread, turnId)
            }}
              />
              <div className="conversation-bottom-fade" aria-hidden="true" />
              {worktreeCreating && <div className="worktree-creation-status" role="status"><LoaderCircle className="spin" />Creating worktree…</div>}
              <Composer
            draft={draft}
            onDraftChange={setDraft}
            attachments={attachments}
            comments={diffComments}
            onRemoveComment={(id) => diffCommentsStore.remove(diffCommentScope, id)}
            attachmentError={attachmentError}
            mode={composerMode}
            onModeChange={setComposerMode}
            onAddAction={handleComposerAddAction}
            projects={sidebarProjects}
            remoteProjects={remoteProjects}
            remoteConnections={remoteConnections}
            selectedLocalPath={context?.projectKind === 'remote' || context?.projectKind === 'projectless'
              ? null
              : context?.cwd || null}
            selectedRemoteProjectId={context?.projectKind === 'remote' ? context.projectId || null : null}
            projectlessSelected={context?.projectKind === 'projectless'}
            projectPickerOpen={composerProjectPickerOpen}
            onCloseProjectPicker={() => setComposerProjectPickerOpen(false)}
            onSelectProject={(path) => {
              setComposerProjectPickerOpen(false)
              void selectProject(path).catch((error) => {
                setThreadNotice({ message: displayError(error) })
              })
            }}
            onSelectRemoteProject={(project) => {
              setComposerProjectPickerOpen(false)
              void selectRemoteProject(project).catch((error) => {
                setThreadNotice({message: displayError(error)})
              })
            }}
            onAddProject={() => void addComposerProject()}
            onAddRemoteProject={() => {
              setComposerProjectPickerOpen(false)
              setRemoteProjectDialogOpen(true)
            }}
            onSelectProjectless={() => {
              setComposerProjectPickerOpen(false)
              void selectProjectless().catch((error) => {
                setThreadNotice({message: displayError(error)})
              })
            }}
            threadGoal={selectedThreadGoal}
            threadGoalDisabled={
              backend.state !== 'ready' ||
              !selectedThreadReady ||
              hydrating ||
              mainTurnStarting
            }
            onClearThreadGoal={() => {
              if (!selectedThread) return
              return removeThreadGoal(selectedThread.id)
            }}
            onChangeThreadGoalStatus={(status) => {
              if (!selectedThread) return
              return updateThreadGoal(selectedThread.id, { status }).then(() => undefined)
            }}
            onSaveThreadGoalObjective={(objective) => {
              if (!selectedThread) return
              return updateThreadGoal(selectedThread.id, { objective }).then(() => undefined)
            }}
            onThreadGoalError={(error) => setThreadNotice({ message: displayError(error) })}
            resumeBlocked={Boolean(selectedThread && loadedThreadId === selectedThread.id && resumedThreadId !== selectedThread.id)}
            onRetryResume={() => { if (selectedThread) void selectThread(selectedThread, false) }}
            onForkResume={() => { if (selectedThread) void forkThread(selectedThread) }}
            onPickAttachments={() => void pickComposerAttachments()}
            onRemoveAttachment={(path) =>
              setAttachments((current) =>
                current.filter((attachment) => attachment.path !== path)
              )
            }
            onSubmit={() => void submit()}
            onInterrupt={() => void interrupt()}
            queuedMessages={selectedQueuedMessages}
            editingQueuedMessageId={selectedEditingQueuedMessageId}
            queueingEnabled={queueingEnabled}
            onSendQueuedMessage={(messageId) => {
              if (selectedThread) void sendQueuedFollowUpNow(selectedThread.id, messageId)
            }}
            onDeleteQueuedMessage={(messageId) => {
              if (selectedThread) void deleteQueuedFollowUp(selectedThread.id, messageId)
            }}
            onEditQueuedMessage={(messageId) => {
              if (selectedThread) editQueuedFollowUp(selectedThread.id, messageId)
            }}
            onOpenQueuedMessageInSideChat={(messageId) => {
              if (selectedThread) {
                void openQueuedFollowUpInSideChat(selectedThread.id, messageId)
              }
            }}
            onReorderQueuedMessages={(messageIds) => {
              if (selectedThread) void reorderQueuedFollowUps(selectedThread.id, messageIds)
            }}
            onResumeInterruptedQueue={() => {
              if (selectedThread) resumeInterruptedQueue(selectedThread.id)
            }}
            onQueueingChange={setQueueingEnabled}
            running={Boolean(selectedSession?.running)}
            starting={mainTurnStarting || Boolean(pendingMainSubmission)}
            canSteer={Boolean(
              selectedThread &&
                selectedSession?.activeTurnId &&
                selectedThreadReady &&
                !selectedThreadHasUnknownSteer
            )}
            steering={steering}
            disabled={
              backend.state !== 'ready' || !context || !selectedModel || !selectedThreadReady
            }
            emptyThread={!selectedThread && !mainTurnStarting && !pendingMainDraft}
            context={context}
            onPickDirectory={() => setComposerProjectPickerOpen((open) => !open)}
            onConfigureEnvironment={appContextHostId(context) === 'local' && context?.projectKind !== 'projectless'
              ? () => setLocalEnvironmentOpen(true)
              : undefined}
            worktreeSelected={Boolean(newThreadWorktreeChoice?.enabled && newThreadWorktreeChoice.cwd === context?.cwd)}
            startingBranch={newThreadWorktreeChoice?.cwd === context?.cwd ? newThreadWorktreeChoice?.branch || null : undefined}
            models={state.models}
            modelId={modelId}
            onModelChange={changeModel}
            effort={effort}
            onEffortChange={changeEffort}
            permissionProfiles={state.permissionProfiles}
            permission={permission}
            approvalsReviewer={approvalsReviewer}
            onPermissionChange={changePermissionMode}
                />
              </main>
              {visibleRightSurface && visibleRightSurface !== 'workspace' && renderRightWorkbenchResizeHandle()}
              {(openedSubagents.length > 0 || (sideChatOpen && selectedThread) || browserTabs.length > 0 || terminalState.tabs.some((tab) => tab.placement === 'right')) && (
                <div role="tabpanel" data-app-shell-tab-panel-controller="right" className={`right-workbench-column${visibleRightSurface === 'subagent' || visibleRightSurface === 'sideChat' || visibleRightSurface === 'browser' || visibleRightSurface === 'terminal' ? '' : ' is-inactive'}`}>
                  {openedSubagents.map((subagent) => <div key={subagent.threadId} className={`right-workbench-surface${visibleRightSurface === 'subagent' && activeSubagentId === subagent.threadId ? ' is-active' : ''}`} aria-hidden={visibleRightSurface !== 'subagent' || activeSubagentId !== subagent.threadId}>
                    <SubagentThreadPanel threadId={subagent.threadId} displayName={subagent.name}
                      loadThread={(id) => readSubagentThread(
                        (method, params) => window.codex.invoke(method, params, appContextHostId(context)), id
                      )}
                      liveThread={subagent.thread && state.sessions[subagent.threadId] ? { ...subagent.thread, turns: state.sessions[subagent.threadId].turns } : null}
                      onThreadLoaded={(thread) => {
                        dispatch({type: 'threadHistoryReplaced', threadId: thread.id, turns: thread.turns})
                        setOpenedSubagents((current) => current.map((entry) => entry.threadId === thread.id ? {...entry, thread} : entry))
                      }}
                      onClose={() => closeSubagent(subagent.threadId)} onOpenMain={(thread) => { closeSubagent(subagent.threadId); void selectThread(thread) }}
                      renderThread={(thread) => <SubagentActivityContext.Provider value={{parentModel: thread.model, names: subagentNames(thread.turns.flatMap((turn) => turn.items)), onOpen: openSubagent}}><Conversation thread={thread} session={state.sessions[thread.id]} starting={false} thinking={false} pendingUserMessage={null}
                        interruptedTurnIds={interruptedTurnIds.current}
                        workspaceName={context?.folderName || '项目'} hydrating={false} historyError={null} hasEarlier={false} loadingEarlier={false} loaded
                        onLoadEarlier={() => undefined} onRevert={() => openThreadDialog('revert', thread)} onFork={(turnId) => void forkThread(thread, turnId)} /></SubagentActivityContext.Provider>}
                    />
                  </div>)}
                  {sideChatOpen && selectedThread && <div className={`right-workbench-surface${visibleRightSurface === 'sideChat' ? ' is-active' : ''}`} aria-hidden={visibleRightSurface !== 'sideChat'}>
                    <SideChatPane
                      thread={sideChatThread}
                      session={sideChatSession}
                      interruptedTurnIds={interruptedTurnIds.current}
                      draft={sideChatDraft}
                      onDraftChange={setSideChatDraft}
                      attachments={sideChatAttachments}
                      attachmentError={sideChatAttachmentError}
                      onPickAttachments={() => void pickSideChatAttachments()}
                      onPickDirectory={() =>
                        setSideChatAttachmentError('侧边聊天沿用主聊天的工作文件夹。')
                      }
                      onRemoveAttachment={(path) =>
                        setSideChatAttachments((current) =>
                          current.filter((attachment) => attachment.path !== path)
                        )
                      }
                      onSubmit={() => void submitSideChat()}
                      onInterrupt={() => void interruptSideChat()}
                      onFork={(turnId) => {
                        if (sideChatThread) void forkThread(sideChatThread, turnId)
                      }}
                      starting={sideChatStarting}
                      disabled={
                        backend.state !== 'ready' ||
                        !context ||
                        !selectedModel ||
                        loadedThreadId !== selectedThread.id ||
                        hydrating
                      }
                      context={context}
                      models={state.models}
                      modelId={modelId}
                      onModelChange={changeModel}
                      effort={effort}
                      onEffortChange={changeEffort}
                      permissionProfiles={state.permissionProfiles}
                      permission={permission}
                      approvalsReviewer={approvalsReviewer}
                      onPermissionChange={changePermissionMode}
                    />
                  </div>}
                  {allBrowserTabs.map((tab) => <div key={tab.id} className={`right-workbench-surface${tab.ownerScope === rightWorkbenchScope && visibleRightSurface === 'browser' && activeBrowserTabId === tab.id ? ' is-active' : ''}`} aria-hidden={tab.ownerScope !== rightWorkbenchScope || visibleRightSurface !== 'browser' || activeBrowserTabId !== tab.id}>
                    <WorkbenchBrowser
                      tabId={tab.id}
                      active={tab.ownerScope === rightWorkbenchScope && nativeBrowserVisible && activeBrowserTabId === tab.id}
                      state={tab.state}
                      onStateChange={workbenchSessions.updateBrowser}
                      onCloseTab={() => closeBrowserTab(tab.id)}
                      onOpenNewTab={openNewWorkbenchTab}
                      onOpenChanges={() => {
                        if (!selectedThread) return
                        consumeWorkbenchLauncher(tab, 'changes')
                        activateWorkspace()
                        window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT, { detail: { tab: 'changes' } }))
                      }}
                      onOpenFiles={() => {
                        if (!selectedThread) return
                        consumeWorkbenchLauncher(tab, 'files')
                        activateWorkspace()
                        window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_CONTENT_EVENT, { detail: { tab: 'files' } }))
                      }}
                      onOpenSideChat={() => {
                        if (!selectedThread) return
                        consumeWorkbenchLauncher(tab, 'side-chat')
                        openSideChat()
                      }}
                      onOpenTerminal={() => {
                        if (!context) return
                        consumeWorkbenchLauncher(tab, 'terminal')
                        try {
                          const id = terminalController.open('right', context.cwd)
                          activateRightTab(`terminal:${id}`)
                        }
                        catch (error) { setThreadNotice({message: displayError(error)}) }
                      }}
                      onToggleBottomTerminal={toggleBottomPanel}
                      recentItems={workbenchBrowserRecents}
                      onOpenRecent={(item) => {
                        activateWorkspace()
                        if (item.kind === 'image') dispatchWorkspaceSourceImage(item.target)
                        else dispatchWorkspaceFileLink({ path: item.target, line: null })
                      }}
                    />
                  </div>)}
                  {context && terminalState.tabs.some((tab) => tab.placement === 'right') && <div className={`right-workbench-surface${visibleRightSurface === 'terminal' ? ' is-active' : ''}`} aria-hidden={visibleRightSurface !== 'terminal'}>
                    <InteractiveTerminalPanel controller={terminalController} placement="right" cwd={context.cwd} uiZoom={windowZoom} integratedChrome active={visibleRightSurface === 'terminal'} />
                  </div>}
                </div>
              )}
              </div>
              {context && <InteractiveTerminalPanel controller={terminalController} placement="bottom" cwd={context.cwd} uiZoom={windowZoom} />}
              </div>
      {terminalSheetOpen &&
        selectedThread &&
        selectedSession &&
        loadedThreadId === selectedThread.id &&
        !hydrating && (
          <TerminalSheet
            threadId={selectedThread.id}
            threadTitle={titleForThread(selectedThread)}
            presentation="docked" placement="right" size={backgroundTerminalSize} uiZoom={windowZoom}
            onSizeChange={setBackgroundTerminalSize}
            onClose={() => setTerminalSheetOpen(false)}
          />
        )}
            </div>
          </>
        )}
      </div>
      {windowCloseRequest && (
        <WindowCloseDialog key={windowCloseRequest.id} request={windowCloseRequest} zoomFactor={windowZoom}
          onRespond={async (response) => {
            await window.codex.respondToWindowCloseRequest(windowCloseRequest.id, response)
            setWindowCloseRequest(null)
          }} />
      )}
      {pendingFullAccessSelection && (
        <FullAccessConfirmDialog
          onCancel={() => setPendingFullAccessSelection(null)}
          onConfirm={() => {
            setPermission(pendingFullAccessSelection.permission)
            setApprovalsReviewer(pendingFullAccessSelection.approvalsReviewer)
            setPendingFullAccessSelection(null)
          }}
        />
      )}
      {pendingUltraSelection && (
        <UltraFullAccessDialog
          canContinue={pendingUltraSelection.fallbackPermission !== null}
          onClose={() => setPendingUltraSelection(null)}
          onContinueWithFullAccess={() => applyModelAndEffort(
            pendingUltraSelection.modelId,
            pendingUltraSelection.effort
          )}
          onContinueWithFallback={() => {
            if (!pendingUltraSelection.fallbackPermission) return
            setPermission(pendingUltraSelection.fallbackPermission)
            applyModelAndEffort(pendingUltraSelection.modelId, pendingUltraSelection.effort)
          }}
        />
      )}
      <ThreadGoalResumeDialog
        goal={
          goalResumeConfirmation?.threadId === state.selectedThreadId
            ? goalResumeConfirmation
            : null
        }
        busy={goalResumeBusy}
        onDismiss={dismissGoalResumeConfirmation}
        onResume={resumeConfirmedGoal}
      />
      <ThreadGoalReplaceDialog
        objective={
          goalReplacementConfirmation?.goal.threadId === state.selectedThreadId
            ? goalReplacementConfirmation.objective
            : null
        }
        onDismiss={() => setGoalReplacementConfirmation(null)}
        onReplace={async () => {
          const confirmation = goalReplacementConfirmation
          if (!confirmation || confirmation.goal.threadId !== state.selectedThreadId) {
            setGoalReplacementConfirmation(null)
            return
          }
          await submit(confirmation.goal)
        }}
      />
      {localEnvironmentOpen && context && <LocalEnvironmentDialog cwd={context.cwd} choice={newThreadWorktreeChoice}
        onClose={() => setLocalEnvironmentOpen(false)} onSave={setNewThreadWorktreeChoice} />}
      {remoteProjectDialogOpen && (
        <RemoteProjectDialog
          connections={remoteConnections}
          initialHostId={appContextHostId(context) === 'local' ? null : appContextHostId(context)}
          onAddRemote={openRemoteConnectionDialog}
          onListDirectory={(hostId, path) => window.codex.listRemoteDirectory(hostId, path)}
          onValidatePath={(hostId, path) => window.codex.validateRemotePath(hostId, path)}
          onCreateDirectory={(hostId, path) => window.codex.createRemoteDirectory(hostId, path)}
          onCreate={async (options) => {
            const project = await window.codex.createRemoteProject(options)
            const catalog = await window.codex.listRemoteProjects()
            setRemoteProjects(catalog)
            await selectRemoteProject(project)
            return project
          }}
          onClose={() => setRemoteProjectDialogOpen(false)}
        />
      )}
      <SshConnectionDiscoveryDialog
        aliases={remoteDiscoveryAliases}
        open={remoteDiscoveryOpen}
        refreshing={remoteDiscoveryRefreshing}
        saving={remoteDiscoverySaving}
        selectedAliases={remoteSelectedAliases}
        error={remoteDiscoveryError}
        onToggleAlias={(alias) => setRemoteSelectedAliases((current) => current.includes(alias)
          ? current.filter((candidate) => candidate !== alias)
          : [...current, alias])}
        onRefresh={refreshRemoteDiscovery}
        onAddManually={openManualRemoteConnectionDialog}
        onSave={saveDiscoveredRemoteConnections}
        onClose={() => { if (!remoteDiscoverySaving) setRemoteDiscoveryOpen(false) }}
      />
      {remoteConnectionDialogOpen && (
        <RemoteConnectionDialog
          connections={remoteConnections}
          busy={remoteConnectionBusy}
          error={remoteConnectionError}
          onCancel={() => {
            if (!remoteConnectionBusy) setRemoteConnectionDialogOpen(false)
          }}
          onSubmit={saveRemoteConnection}
        />
      )}
      {threadDialog && (
        <ThreadActionDialog
          mode={threadDialog.mode}
          thread={threadDialog.thread}
          busy={threadActionBusy}
          error={threadActionError}
          onCancel={() => {
            if (!threadActionBusy) setThreadDialog(null)
          }}
          onSubmit={(name) => void submitThreadDialog(name)}
        />
      )}
      {sidebarProjectDialog && (
        <ProjectActionDialog
          mode={sidebarProjectDialog.mode}
          project={sidebarProjectDialog.project}
          busy={sidebarProjectActionBusy}
          error={sidebarProjectActionError}
          onCancel={() => {
            if (!sidebarProjectActionBusy) {
              setSidebarProjectDialog(null)
              setSidebarProjectActionError(null)
            }
          }}
          onSubmit={(update) => void submitSidebarProjectDialog(update)}
        />
      )}
      {sidebarProjectArchive && (
        <ProjectArchiveDialog
          projectName={sidebarProjectArchive.project.name}
          count={sidebarProjectArchive.project.threads.length}
          running={sidebarProjectArchive.project.threads.some((thread) =>
            runningThreadIds.includes(thread.id) || threadHasActiveSidebarTurn(thread)
          )}
          loading={false}
          busy={sidebarProjectActionBusy}
          error={sidebarProjectActionError}
          onCancel={() => {
            if (!sidebarProjectActionBusy) {
              setSidebarProjectArchive(null)
              setSidebarProjectActionError(null)
            }
          }}
          onSubmit={() => void submitSidebarProjectArchive()}
        />
      )}
      {(threadNotice || failedDraftRecoveries.length > 0) && (
        <div className="thread-notice" role="status">
          <span>{threadNotice?.message || failedDraftRecoveries[0]?.message}</span>
          {!threadNotice && failedDraftRecoveries[0] && (
            <button type="button" onClick={() => {
              const recovery = failedDraftRecoveries[0]
              const revision = markNavigationAction()
              void window.codex.getAppContext(recovery.cwd).then(async (next) => {
                if (navigationActionRevision.current !== revision) return
                await window.codex.setActiveHost('local')
                if (navigationActionRevision.current !== revision) return
                setContext(next)
                const restoredScope = startNewThread(true, next.cwd, undefined, 'local', next)
                if (recovery.worktreeChoice) setDraftWorktreeChoices((choices) => ({...choices,
                  [restoredScope]: {...recovery.worktreeChoice!, cwd: next.cwd}}))
                restoreComposerDraft(restoredScope, recovery.text, recovery.attachments)
                if (recovery.commentScope) diffCommentsStore.move(recovery.commentScope, restoredScope)
                setFailedDraftRecoveries((recoveries) => recoveries.filter((entry) => entry.id !== recovery.id))
                setThreadNotice(null)
              }).catch((error) => setFailedDraftRecoveries((recoveries) => recoveries.map((entry) =>
                entry.id === recovery.id ? {...entry, message: displayError(error)} : entry)))
            }}>恢复草稿</button>
          )}
          {threadNotice?.archivedThread && (
            <button type="button" onClick={() => void undoArchive()}>撤销</button>
          )}
          {threadNotice?.removedProject && (
            <button type="button" onClick={undoProjectRemoval}>撤销</button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => {
            if (threadNotice) setThreadNotice(null)
            else {
              const recovery = failedDraftRecoveries[0]
              if (recovery?.commentScope) diffCommentsStore.clear(recovery.commentScope)
              setFailedDraftRecoveries((recoveries) => recoveries.slice(1))
            }
          }}>×</button>
        </div>
      )}
      {serverRequestQueue[0] && (
        <ServerRequestDialog
          key={`${typeof serverRequestQueue[0].id}:${serverRequestQueue[0].id}`}
          request={serverRequestQueue[0]}
          busy={serverRequestBusy}
          error={serverRequestError}
          onRespond={(response) =>
            void respondToServerRequest(serverRequestQueue[0], response)
          }
        />
      )}
    </div>
    </SubagentActivityContext.Provider>
  )
}

function WorkspaceChromeIcon({ kind }: { kind: WorkspaceChromeState['kind'] }): ReactNode {
  if (kind === 'file') return <FileCode2 />
  if (kind === 'changes') return <GitCompareArrows />
  if (kind === 'output') return <TerminalSquare />
  if (kind === 'sources') return <Link2 />
  if (kind === 'subagents') return <Bot />
  return <Folder />
}

function RightWorkbenchTabIcon({
  kind,
  title
}: Pick<RightWorkbenchTitleTab, 'kind' | 'title'>): ReactNode {
  if (kind === 'subagent') return <Bot />
  if (kind === 'side-chat') return <CirclePlus />
  if (kind === 'browser') return <Globe2 />
  if (kind === 'terminal') return <TerminalSquare />
  if (kind === 'file' && /\.(?:json|jsonl)$/i.test(title)) {
    return <Braces className="right-workbench-json-icon" />
  }
  return <WorkspaceChromeIcon kind={kind} />
}

function WindowTitlebar({
  backend,
  context,
  thread,
  threadPinned,
  sidebarOpen,
  rightWorkbenchTabs,
  activeRightTabId,
  rightWorkbenchOpen,
  rightWorkbenchFullView,
  rightWorkbenchChatSelected,
  retainedRightTabCount,
  projectSummaryOpen,
  projectSummaryAnchorRef,
  settingsMode,
  showSidebarToggle,
  onToggleSidebar,
  onConversationAction,
  onToggleProjectSummary,
  onActivateRightTab,
  onCloseRightTab,
  onMoveRightTab,
  onToggleRightWorkbenchFullView,
  onCollapseRightWorkbench,
  onRevealRightWorkbench,
  onShowChat,
  onOpenNewWorkbenchTab,
  onRestart,
  canGoBack, canGoForward, onGoBack, onGoForward
}: {
  backend: BackendStatus
  context: AppContext | null
  thread: Thread | undefined
  threadPinned: boolean
  sidebarOpen: boolean
  rightWorkbenchTabs: RightWorkbenchTitleTab[]
  activeRightTabId: RightWorkbenchTabId | null
  rightWorkbenchOpen: boolean
  rightWorkbenchFullView: boolean
  rightWorkbenchChatSelected: boolean
  retainedRightTabCount: number
  projectSummaryOpen: boolean
  projectSummaryAnchorRef: RefObject<HTMLButtonElement | null>
  settingsMode: boolean
  showSidebarToggle?: boolean
  onToggleSidebar(): void
  onConversationAction(action: ConversationMenuAction): void
  onToggleProjectSummary(): void
  onActivateRightTab(id: RightWorkbenchTabId): void
  onCloseRightTab(id: RightWorkbenchTabId): void
  onMoveRightTab(id: RightWorkbenchTabId, beforeId: RightWorkbenchTabId | null): void
  onToggleRightWorkbenchFullView(): void
  onCollapseRightWorkbench(): void
  onRevealRightWorkbench(): void
  onShowChat(): void
  onOpenNewWorkbenchTab(): void
  onRestart(): void
  canGoBack: boolean
  canGoForward: boolean
  onGoBack(): void
  onGoForward(): void
}): ReactNode {
  const message =
    backend.state === 'ready'
      ? `Connected via ${backend.mode}`
      : backend.message || capitalize(backend.state)
  const chatTabId = '__right-workbench-chat__' as const
  const rightTabOrder: string[] = [
    ...(rightWorkbenchFullView && thread ? [chatTabId] : []),
    ...rightWorkbenchTabs.map((tab) => tab.id)
  ]
  const selectedRightTabId = rightWorkbenchChatSelected ? chatTabId : activeRightTabId
  const activateTitlebarTab = (id: string): void => {
    if (id === chatTabId) onShowChat()
    else onActivateRightTab(id as RightWorkbenchTabId)
  }
  const focusTitlebarTab = (id: string, origin: HTMLElement): void => {
    window.requestAnimationFrame(() => {
      const tabList = origin.closest<HTMLElement>('[data-app-shell-tab-strip-controller="right"]')
      const target = Array.from(
        tabList?.querySelectorAll<HTMLButtonElement>('[data-right-workbench-tab-id]') || []
      ).find((button) => button.dataset.rightWorkbenchTabId === id)
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
  const onRightTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    id: string,
    closable: boolean
  ): void => {
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr'
    const action = resolveRightWorkbenchTabKeyboardAction({
      order: rightTabOrder,
      focusedId: id,
      key: event.key,
      direction,
      closable
    })
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    if (action.type === 'activate') {
      activateTitlebarTab(action.id)
      focusTitlebarTab(action.id, event.currentTarget)
      return
    }
    onCloseRightTab(action.id as RightWorkbenchTabId)
    if (action.nextActiveId) {
      activateTitlebarTab(action.nextActiveId)
      focusTitlebarTab(action.nextActiveId, event.currentTarget)
    }
  }
  return (
    <header className={`window-titlebar${sidebarOpen ? '' : ' sidebar-closed'}${settingsMode ? ' settings-mode' : ''}${rightWorkbenchOpen ? ' has-right-workbench' : ''}${rightWorkbenchOpen && rightWorkbenchFullView ? ' right-workbench-full-view' : ''}`}>
      <div className="titlebar-navigation">
        <button type="button" className="titlebar-icon" aria-label="Back" disabled={!canGoBack} onClick={onGoBack}>
          <TitlebarBackIcon />
        </button>
        <button type="button" className="titlebar-icon" aria-label="Forward" disabled={!canGoForward} onClick={onGoForward}>
          <TitlebarBackIcon forward />
        </button>
        {(!settingsMode || showSidebarToggle) && (
          <button
            type="button"
            className="titlebar-icon"
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            onClick={onToggleSidebar}
          >
            <SidebarLayoutIcon />
          </button>
        )}
      </div>
      {!settingsMode && <div className="titlebar-thread">
        {thread && (
          <div className="titlebar-thread-primary" title={thread.cwd || context?.cwd}>
            <Folder />
            <span>{titleForThread(thread)}</span>
          </div>
        )}
      </div>}
      {!settingsMode && <div className={`titlebar-actions${thread ? '' : ' is-empty'}`}>
        {backend.state === 'error' && (
          <button
            type="button"
            className="titlebar-backend-error"
            title={`${message}. Click to reconnect.`}
            onClick={onRestart}
          >
            <CircleAlert />
          </button>
        )}
        {thread && !(rightWorkbenchOpen && rightWorkbenchFullView) && (
          <>
            <TitlebarConversationMenu
              available
              pinned={threadPinned}
              onAction={onConversationAction}
            />
            <button
              ref={projectSummaryAnchorRef}
              type="button"
              className={`titlebar-icon titlebar-project-summary${projectSummaryOpen ? ' active' : ''}`}
              aria-label="切换摘要面板固定状态"
              aria-pressed={projectSummaryOpen}
              title="切换摘要面板固定状态"
              onClick={onToggleProjectSummary}
            ><ListFilter /></button>
          </>
        )}
        {!rightWorkbenchOpen && <span className="titlebar-actions-divider" aria-hidden="true" />}
        {!rightWorkbenchOpen && retainedRightTabCount > 0 && (
          <>
            <button type="button" className="titlebar-icon" aria-label="进入完整视图" title="进入完整视图" onClick={() => { onRevealRightWorkbench(); onToggleRightWorkbenchFullView() }}><Maximize2 /></button>
            <button type="button" className="titlebar-icon titlebar-retained-tabs" aria-label={`显示标签页，${retainedRightTabCount} 个已打开`} title="显示标签页" onClick={onRevealRightWorkbench}><PanelRight /><span>{retainedRightTabCount}</span></button>
          </>
        )}
        {!rightWorkbenchOpen && retainedRightTabCount === 0 && (
          <button type="button" className="titlebar-icon" aria-label="新建标签页" title="新建标签页" onClick={() => onOpenNewWorkbenchTab()}><TitlebarNewTabIcon /></button>
        )}
      </div>}
      {!settingsMode && <div className="workspace-titlebar-host">
        {rightWorkbenchOpen && <div className="right-workbench-titlebar" role="tablist" aria-label="右侧工作台" data-app-shell-tab-strip-controller="right">
          <div className="right-workbench-title-tabs" onDragOver={(event) => {
            if (event.dataTransfer.types.includes(RIGHT_WORKBENCH_TAB_DRAG_TYPE)) event.preventDefault()
          }} onDrop={(event) => {
            const id = event.dataTransfer.getData(RIGHT_WORKBENCH_TAB_DRAG_TYPE) as RightWorkbenchTabId
            if (rightWorkbenchTabs.some((tab) => tab.id === id)) onMoveRightTab(id, null)
          }}>
          {rightWorkbenchFullView && thread && <div className={`right-workbench-title-tab is-chat-tab${rightWorkbenchChatSelected ? ' is-active' : ''}`}>
            <button type="button" role="tab" aria-selected={rightWorkbenchChatSelected} tabIndex={rightWorkbenchRovingTabIndex(rightTabOrder, selectedRightTabId, chatTabId)} aria-keyshortcuts="ArrowLeft ArrowRight Home End" data-right-workbench-tab-id={chatTabId} title={titleForThread(thread)} onKeyDown={(event) => onRightTabKeyDown(event, chatTabId, false)} onClick={onShowChat}><MessageSquare /><span>{titleForThread(thread)}</span></button>
            <TitlebarConversationMenu available pinned={threadPinned} onAction={onConversationAction} />
          </div>}
          {rightWorkbenchTabs.map((tab) => {
            const active = tab.id === activeRightTabId
            return <div key={tab.id} className={`right-workbench-title-tab${active ? ' is-active' : ''}`} draggable
              onDragStart={(event) => { event.dataTransfer.setData(RIGHT_WORKBENCH_TAB_DRAG_TYPE, tab.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(RIGHT_WORKBENCH_TAB_DRAG_TYPE)) return
                event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault(); event.stopPropagation()
                const id = event.dataTransfer.getData(RIGHT_WORKBENCH_TAB_DRAG_TYPE) as RightWorkbenchTabId
                if (rightWorkbenchTabs.some((entry) => entry.id === id)) onMoveRightTab(id, tab.id)
              }}>
              <button type="button" role="tab" aria-selected={active} tabIndex={rightWorkbenchRovingTabIndex(rightTabOrder, selectedRightTabId, tab.id)} aria-keyshortcuts="ArrowLeft ArrowRight Home End Delete" data-right-workbench-tab-id={tab.id} title={tab.title} onKeyDown={(event) => onRightTabKeyDown(event, tab.id, true)} onClick={() => onActivateRightTab(tab.id)}><RightWorkbenchTabIcon kind={tab.kind} title={tab.title} /><span>{tab.label}</span></button>
              <button type="button" className="right-workbench-title-close" aria-label={`关闭 ${tab.label}`} onClick={() => onCloseRightTab(tab.id)}>{tab.dirty ? <span className="right-workbench-unsaved-dot" /> : <X />}</button>
            </div>
          })}
          </div>
          <button type="button" className="right-workbench-title-add" aria-label="新标签页" title="新标签页" onClick={() => onOpenNewWorkbenchTab()}><Plus /></button>
          {rightWorkbenchFullView && thread && <button
            ref={projectSummaryAnchorRef}
            type="button"
            className={`titlebar-icon right-workbench-project-summary${projectSummaryOpen ? ' active' : ''}`}
            aria-label="切换摘要面板固定状态"
            aria-pressed={projectSummaryOpen}
            title="切换摘要面板固定状态"
            onClick={onToggleProjectSummary}
          ><ListFilter /></button>}
          <div className="right-workbench-titlebar-controls">
            <button type="button" aria-label={rightWorkbenchFullView ? '退出完整视图' : '进入完整视图'} aria-pressed={rightWorkbenchFullView} title={rightWorkbenchFullView ? '退出完整视图' : '进入完整视图'} onClick={onToggleRightWorkbenchFullView}>{rightWorkbenchFullView ? <PanelsTopLeft /> : <Maximize2 />}</button>
            <button type="button" aria-label={rightWorkbenchFullView ? '进入分屏视图' : '隐藏标签页'} aria-pressed={rightWorkbenchFullView ? false : true} title={rightWorkbenchFullView ? '进入分屏视图' : '隐藏标签页'} onClick={rightWorkbenchFullView ? onToggleRightWorkbenchFullView : onCollapseRightWorkbench}><PanelRight /></button>
          </div>
        </div>}
      </div>}
    </header>
  )
}

function ActivityRail({
  activeView,
  hasUnread,
  onOpenChats,
  onOpenScheduled,
  onOpenMarketplace,
  onOpenProjects,
  settingsOpen,
  onOpenSettings,
  onOpenKeyboardShortcuts
}: {
  activeView: PrimaryView
  hasUnread: boolean
  onOpenChats(): void
  onOpenScheduled(): void
  onOpenMarketplace(): void
  onOpenProjects(): void
  settingsOpen: boolean
  onOpenSettings(): void
  onOpenKeyboardShortcuts(): void
}): ReactNode {
  const [exploreOpen, setExploreOpen] = useState(false)
  const [explorePresent, setExplorePresent] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [projectsPinned, setProjectsPinned] = useState(() =>
    localStorage.getItem('codex-rail-projects-pinned-v1') === 'true'
  )
  const exploreRef = useRef<HTMLDivElement>(null)
  const exploreTriggerRef = useRef<HTMLButtonElement>(null)
  const profileTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    localStorage.setItem('codex-rail-projects-pinned-v1', String(projectsPinned))
  }, [projectsPinned])

  useEffect(() => {
    if (exploreOpen) {
      setExplorePresent(true)
      return
    }
    if (!explorePresent) return
    const timer = window.setTimeout(() => setExplorePresent(false), 110)
    return () => window.clearTimeout(timer)
  }, [exploreOpen, explorePresent])

  useEffect(() => {
    if (!exploreOpen) return
    const dismiss = (event: PointerEvent): void => {
      if (!exploreRef.current?.contains(event.target as Node)) setExploreOpen(false)
    }
    const keyboard = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setExploreOpen(false)
      exploreTriggerRef.current?.focus({preventScroll: true})
    }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', keyboard, true)
    }
  }, [exploreOpen])

  return (
    <nav className="activity-rail" aria-label="应用导航" data-app-navigation-rail="true">
      <div className="rail-primary">
        <RailButton label="首页" active={!settingsOpen && activeView === 'chats'} badge={hasUnread} onClick={onOpenChats}>
          <RailHomeIcon active={!settingsOpen && activeView === 'chats'} />
        </RailButton>
        <RailButton label="定时任务" active={!settingsOpen && activeView === 'scheduled'} onClick={onOpenScheduled}>
          <RailScheduledIcon active={!settingsOpen && activeView === 'scheduled'} />
        </RailButton>
        <RailButton
          label="插件"
          active={!settingsOpen && activeView === 'marketplace'}
          onClick={() => {
            setExploreOpen(false)
            onOpenMarketplace()
          }}
        >
          <RailPluginsIcon />
        </RailButton>
        {projectsPinned && <RailButton label="项目" active={!settingsOpen && activeView === 'projects'} onClick={() => {
          setExploreOpen(false)
          onOpenProjects()
        }}><Folder /></RailButton>}
        <div className="rail-explore-anchor" ref={exploreRef}>
          <RailButton
            label="探索"
            active={exploreOpen || (!settingsOpen && activeView === 'projects' && !projectsPinned)}
            tooltip={false}
            buttonRef={exploreTriggerRef}
            ariaHaspopup="dialog"
            ariaExpanded={exploreOpen}
            onClick={() => {
              setProfileOpen(false)
              if (exploreOpen) setExploreOpen(false)
              else {
                setExplorePresent(true)
                setExploreOpen(true)
              }
            }}
          >
            <RailExploreIcon />
          </RailButton>
          {explorePresent && (
            <div className="rail-explore-menu" role="dialog" aria-label="探索" data-state={exploreOpen ? 'open' : 'closed'}>
              <button
                type="button"
                className="rail-explore-main-action"
                onClick={() => {
                  setExploreOpen(false)
                  onOpenProjects()
                }}
              >
                <Folder />
                <span>项目</span>
              </button>
              <SidebarTooltip content={projectsPinned ? '取消固定到侧边栏' : '固定到侧边栏'}>
                <button
                  type="button"
                  className="rail-explore-pin-action"
                  aria-label={projectsPinned ? '取消固定到侧边栏' : '固定到侧边栏'}
                  aria-pressed={projectsPinned}
                  onClick={() => setProjectsPinned((pinned) => !pinned)}
                >
                  {projectsPinned ? <PinOff /> : <Pin />}
                </button>
              </SidebarTooltip>
            </div>
          )}
        </div>
      </div>
      <div className="rail-secondary">
        <RailButton
          label="打开个人资料菜单"
          active={settingsOpen || profileOpen}
          tooltip={!profileOpen}
          buttonRef={profileTriggerRef}
          ariaHaspopup="menu"
          ariaExpanded={profileOpen}
          onClick={() => {
            setExploreOpen(false)
            setProfileOpen((open) => !open)
          }}
        >
          <RailSettingsIcon />
        </RailButton>
      </div>
      <ProfileMenu
        open={profileOpen}
        anchorRef={profileTriggerRef}
        onOpenChange={setProfileOpen}
        onOpenSettings={onOpenSettings}
        onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
      />
    </nav>
  )
}

function TitlebarBackIcon({ forward = false }: { forward?: boolean }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform={forward ? 'translate(16 0) scale(-1 1)' : undefined}>
        <path
          d="M6.96231 2.96214C7.16727 2.7574 7.49953 2.75742 7.7045 2.96214C7.90913 3.16712 7.9092 3.49939 7.7045 3.70433L3.93301 7.47483H13.3334C13.6232 7.47501 13.8578 7.71038 13.8578 8.00022C13.8577 8.28999 13.6232 8.52544 13.3334 8.52562H3.93301L7.7045 12.2951C7.90924 12.5001 7.90909 12.8323 7.7045 13.0373C7.49953 13.2423 7.16735 13.2422 6.96231 13.0373L2.53067 8.60667L2.47208 8.54124C2.21571 8.22666 2.21566 7.77279 2.47208 7.45823L2.53067 7.3928L6.96231 2.96214Z"
          fill="currentColor"
        />
      </g>
    </svg>
  )
}

function TitlebarNewTabIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.00037 4.64087C8.29007 4.64107 8.52562 4.87654 8.52576 5.16626V7.47485H10.8334C11.1232 7.47503 11.3578 7.7104 11.3578 8.00024C11.3577 8.28997 11.1231 8.52546 10.8334 8.52563H8.52576V10.8333C8.52558 11.1229 8.29004 11.3575 8.00037 11.3577C7.71053 11.3577 7.47515 11.1231 7.47498 10.8333V8.52563H5.16638C4.87668 8.52544 4.64112 8.28996 4.64099 8.00024C4.64099 7.71042 4.8766 7.47505 5.16638 7.47485H7.47498V5.16626C7.47511 4.87642 7.7105 4.64087 8.00037 4.64087Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M11.683 1.80786C13.0683 1.80786 14.1918 2.93134 14.1918 4.31665V11.6829C14.1918 13.0682 13.0683 14.1917 11.683 14.1917H4.31677C2.93146 14.1917 1.80798 13.0682 1.80798 11.6829V4.31665C1.80798 2.93134 2.93146 1.80786 4.31677 1.80786H11.683ZM4.31677 2.85864C3.51136 2.85864 2.85876 3.51124 2.85876 4.31665V11.6829C2.85876 12.4883 3.51136 13.1418 4.31677 13.1418H11.683C12.4884 13.1418 13.142 12.4883 13.142 11.6829V4.31665C13.142 3.51124 12.4884 2.85864 11.683 2.85864H4.31677Z" fill="currentColor" />
    </svg>
  )
}

function RailHomeIcon({active}: {active: boolean}): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={active
          ? 'M9.16359 2.63179C9.7105 2.48208 10.2885 2.48214 10.8355 2.63179L11.0855 2.7148C11.212 2.76439 11.3333 2.82555 11.4546 2.89351C11.5671 2.95641 11.6803 3.02484 11.7935 3.10152C12.1006 3.30956 12.4552 3.5894 12.8902 3.93257L17.0786 7.23823L17.3316 7.43843V7.44038L18.3277 8.22749C18.6159 8.45506 18.6655 8.87284 18.438 9.16109C18.2104 9.44919 17.7916 9.49799 17.5034 9.27046L17.3316 9.13472V14C17.3316 14.4554 17.3325 14.8372 17.3071 15.1484C17.2811 15.4674 17.2242 15.771 17.0777 16.0585C16.8542 16.497 16.4975 16.8535 16.0591 17.0771C15.7716 17.2236 15.4679 17.2805 15.1489 17.3066C14.8378 17.332 14.4559 17.332 14.0005 17.332H12.0435V14.1669C12.0435 13.0387 11.1287 12.1234 10.0005 12.123C8.87201 12.123 7.95656 13.0384 7.95656 14.1669V17.332H6.00051C5.54496 17.332 5.1623 17.332 4.85109 17.3066C4.53232 17.2805 4.22932 17.2234 3.94191 17.0771C3.50329 16.8536 3.14594 16.4971 2.92238 16.0585C2.7759 15.771 2.71994 15.4673 2.69387 15.1484C2.66847 14.8372 2.66848 14.4554 2.66848 14V9.13277L2.49465 9.27046C2.20648 9.49779 1.78862 9.44906 1.56105 9.16109C1.33363 8.87297 1.38258 8.45514 1.67043 8.22749L2.66848 7.43941L2.92141 7.23823L7.10891 3.93355C7.54367 3.59031 7.89757 3.31064 8.20461 3.10249C8.23921 3.07904 8.27472 3.05734 8.3091 3.03511C8.38762 2.98434 8.46593 2.93742 8.54445 2.89351C8.74385 2.78197 8.94502 2.69167 9.16359 2.63179Z'
          : 'M9.16491 2.63173C9.71169 2.48215 10.289 2.48212 10.8358 2.63173C11.1778 2.72543 11.48 2.8889 11.7938 3.10145C12.1009 3.3095 12.4556 3.58934 12.8905 3.93251L17.079 7.23817L17.3319 7.43837V7.44032L18.329 8.22841C18.6169 8.45595 18.6666 8.87383 18.4393 9.162C18.2118 9.4502 17.793 9.49877 17.5048 9.27138L17.3319 9.13466V13.9999C17.3319 14.4554 17.3329 14.8371 17.3075 15.1483C17.2814 15.4673 17.2245 15.7709 17.078 16.0585C16.8546 16.4969 16.4978 16.8535 16.0594 17.077C15.772 17.2235 15.4682 17.2804 15.1493 17.3065C14.8382 17.3319 14.4562 17.3319 14.0008 17.3319H11.4188V13.9579C11.4186 13.175 10.7837 12.5404 10.0008 12.5399C9.21764 12.5399 8.58209 13.1747 8.5819 13.9579V17.3319H6.00084C5.54535 17.3319 5.16262 17.3319 4.85143 17.3065C4.53266 17.2805 4.22966 17.2234 3.94225 17.077C3.5036 16.8535 3.14627 16.4971 2.92272 16.0585C2.77621 15.7709 2.72027 15.4673 2.6942 15.1483C2.6688 14.8371 2.66881 14.4554 2.66881 13.9999V9.13466L2.49596 9.27138C2.20783 9.49885 1.79002 9.44991 1.56237 9.162C1.33486 8.87382 1.3837 8.45603 1.67174 8.22841L2.66881 7.44032V7.43837L2.92174 7.23817L7.1112 3.93251C7.54597 3.58945 7.89989 3.30942 8.2069 3.10145C8.52085 2.88883 8.82275 2.7254 9.16491 2.63173ZM9.99596 3.8495C9.91933 3.84967 9.84263 3.85439 9.76647 3.86415C9.68232 3.87496 9.59887 3.89241 9.51647 3.91493C9.42142 3.94095 9.31925 3.98378 9.19127 4.05556C9.12054 4.09534 9.04147 4.14337 8.95202 4.20399C8.69423 4.37873 8.38416 4.62336 7.93444 4.97841L3.99889 8.08485V13.9999C3.99889 14.4775 3.99942 14.7964 4.0194 15.0409C4.03875 15.2773 4.07319 15.3861 4.10827 15.455C4.20432 15.6432 4.35748 15.7965 4.54577 15.8925C4.61466 15.9275 4.72363 15.962 4.95983 15.9813C5.20432 16.0013 5.52348 16.0018 6.00084 16.0018H7.25182V13.9579C7.25201 12.4402 8.4831 11.2099 10.0008 11.2099C11.5182 11.2103 12.7487 12.4405 12.7489 13.9579V16.0018H14.0008C14.478 16.0018 14.7965 16.0013 15.0409 15.9813C15.277 15.962 15.3861 15.9275 15.4549 15.8925C15.6432 15.7964 15.7975 15.6433 15.8934 15.455C15.9285 15.3861 15.962 15.2772 15.9813 15.0409C16.0013 14.7964 16.0018 14.4775 16.0018 13.9999V8.08388L12.0673 4.97841C11.6172 4.6231 11.3066 4.37881 11.0487 4.20399C10.7979 4.034 10.6327 3.95536 10.4852 3.91493C10.3662 3.88233 10.2442 3.86252 10.1219 3.85438C10.08 3.8516 10.038 3.8494 9.99596 3.8495Z'}
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
      />
    </svg>
  )
}

function RailScheduledIcon({active}: {active: boolean}): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {active ? (
        <path fillRule="evenodd" clipRule="evenodd" d="M10.001 1.83496C14.5104 1.83498 18.166 5.49062 18.166 10C18.166 14.5094 14.5104 18.165 10.001 18.165C5.49157 18.165 1.83594 14.5094 1.83594 10C1.83595 5.49061 5.49158 1.83496 10.001 1.83496ZM10 5.16797C9.633 5.16814 9.33516 5.46602 9.33496 5.83301V9.72363L7.44629 11.6123C7.18665 11.8719 7.18677 12.294 7.44629 12.5537C7.70599 12.8134 8.128 12.8134 8.3877 12.5537L10.3486 10.5918C10.5513 10.389 10.665 10.1139 10.665 9.82715V5.83301C10.6648 5.46591 10.3671 5.16797 10 5.16797Z" fill="currentColor" />
      ) : (
        <>
          <path d="M10 5.16895C10.3673 5.16895 10.665 5.46672 10.665 5.83398V9.82812C10.6649 10.1147 10.5513 10.3901 10.3486 10.5928L8.3877 12.5547C8.12804 12.814 7.70591 12.8141 7.44629 12.5547C7.18668 12.2951 7.18687 11.873 7.44629 11.6133L9.33496 9.72461V5.83398C9.33496 5.46685 9.63291 5.16916 10 5.16895Z" fill="currentColor" />
          <path fillRule="evenodd" clipRule="evenodd" d="M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496ZM10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 13.7749 6.22513 16.835 10 16.835C13.7749 16.835 16.835 13.7749 16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504Z" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

function RailPluginsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M10.5208 1.88086C15.7221 1.88086 18.3078 5.71869 18.3079 9.1875C18.3079 10.6634 17.6928 12.1653 16.6019 13.0332C16.0469 13.4746 15.3655 13.7517 14.598 13.7559C13.9313 13.7594 13.2416 13.5557 12.5511 13.1377C11.9219 13.6395 11.2034 13.9685 10.4534 14.0312C9.535 14.108 8.63654 13.7825 7.91047 13.0283L7.87238 12.9883C7.85039 12.965 7.8186 12.9309 7.77863 12.8887C7.69832 12.8039 7.58559 12.6849 7.45637 12.5488C7.19751 12.2762 6.87183 11.9348 6.60578 11.6572L6.54719 11.5889C6.27521 11.2405 6.30519 10.736 6.6302 10.4229L6.84504 10.2158L6.10383 9.44629C5.84919 9.18175 5.857 8.76058 6.12141 8.50586C6.38599 8.25118 6.80713 8.2589 7.06184 8.52344L7.80305 9.29297L9.59406 7.56836L8.85383 6.7998C8.59913 6.5352 8.60778 6.11407 8.87238 5.85938C9.13699 5.60473 9.55813 5.61237 9.81281 5.87695L10.553 6.64648L10.7747 6.43359C11.1235 6.098 11.6792 6.10952 12.013 6.45996L13.3167 7.8291C14.0599 8.59431 14.3531 9.50484 14.2337 10.4219C14.1535 11.0377 13.8891 11.6205 13.5052 12.1455C13.9126 12.3481 14.2758 12.4274 14.5911 12.4258C15.0278 12.4233 15.4257 12.269 15.7737 11.9922C16.4894 11.4229 16.9779 10.3387 16.9779 9.1875C16.9777 6.36405 14.9015 3.21094 10.5208 3.21094C6.8614 3.21118 3.69922 6.00766 3.45344 9.52734C3.17857 13.4658 5.9647 16.7887 10.2064 16.7891C11.8181 16.7891 13.4105 16.3859 14.5159 15.5303C14.8063 15.3055 15.2247 15.3591 15.4495 15.6494C15.6741 15.9398 15.6207 16.3573 15.3304 16.582C13.9169 17.6762 12.0013 18.1191 10.2064 18.1191C5.1481 18.1188 1.80089 14.096 2.12629 9.43457C2.42465 5.16205 6.22034 1.8811 10.5208 1.88086ZM7.8802 11.0654C8.06588 11.2601 8.25662 11.4605 8.42023 11.6328C8.54982 11.7693 8.66289 11.8886 8.74348 11.9736C8.78365 12.016 8.81607 12.0508 8.8382 12.0742L8.87238 12.1094C9.33016 12.583 9.83897 12.7472 10.3431 12.7051C10.8683 12.661 11.4519 12.3855 11.9945 11.8633C12.543 11.3352 12.848 10.7668 12.9154 10.25C12.9794 9.75778 12.8385 9.24516 12.3587 8.75293L12.3538 8.74707L11.3665 7.70996L7.8802 11.0654Z" fill="currentColor" />
    </svg>
  )
}

function RailExploreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.16638 8.50146C4.99378 8.50146 5.66523 9.17215 5.66541 9.99951C5.66541 10.827 4.99389 11.4985 4.16638 11.4985C3.33902 11.4984 2.66833 10.8269 2.66833 9.99951C2.66851 9.17226 3.33913 8.50164 4.16638 8.50146Z" fill="currentColor" />
      <path d="M9.99939 8.50146C10.8268 8.50146 11.4982 9.17215 11.4984 9.99951C11.4984 10.827 10.8269 11.4985 9.99939 11.4985C9.17214 11.4982 8.50134 10.8268 8.50134 9.99951C8.50152 9.17234 9.17225 8.50177 9.99939 8.50146Z" fill="currentColor" />
      <path d="M15.8334 8.50146C16.6606 8.50166 17.3322 9.17228 17.3324 9.99951C17.3324 10.8269 16.6607 11.4983 15.8334 11.4985C15.006 11.4984 14.3353 10.8269 14.3353 9.99951C14.3355 9.17226 15.0061 8.50164 15.8334 8.50146Z" fill="currentColor" />
    </svg>
  )
}

function RailSettingsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M9.99994 6.58692C11.8866 6.58692 13.4167 8.11635 13.4169 10.0029C13.4169 11.8897 11.8867 13.4199 9.99994 13.4199C8.11346 13.4196 6.58392 11.8895 6.58392 10.0029C6.58415 8.11657 8.1136 6.58727 9.99994 6.58692ZM9.99994 7.917C8.84814 7.91735 7.91423 8.85111 7.914 10.0029C7.914 11.155 8.84799 12.0895 9.99994 12.0899C11.1522 12.0899 12.0869 11.1552 12.0869 10.0029C12.0866 8.85089 11.152 7.917 9.99994 7.917Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M10.746 1.48926C11.3535 1.4893 11.9164 1.81309 12.2197 2.34083C12.487 2.80625 12.8848 3.50078 13.206 4.0586C13.2711 4.17173 13.3924 4.24212 13.5244 4.24219H15.5068C16.1135 4.24219 16.6751 4.56542 16.9785 5.09083L17.7148 6.36719C18.0159 6.88895 18.0182 7.53187 17.7206 8.05567L16.6161 10L17.7206 11.9443C18.018 12.468 18.0158 13.1102 17.7148 13.6318L16.9785 14.9082C16.6751 15.4337 16.1135 15.7578 15.5068 15.7578H13.5244C13.3924 15.7579 13.2712 15.8273 13.206 15.9404C12.8848 16.4983 12.486 17.1927 12.2187 17.6582C11.9154 18.1859 11.3534 18.5098 10.746 18.5098C10.2189 18.5098 9.79593 18.5098 9.25287 18.5098C8.64561 18.5095 8.0843 18.185 7.78119 17.6572C7.51383 17.1918 7.11402 16.4982 6.79291 15.9404C6.72766 15.8275 6.60731 15.7578 6.47552 15.7578H4.4931C3.88642 15.7578 3.32478 15.4336 3.02142 14.9082L2.28509 13.6328C1.9839 13.1111 1.98183 12.4682 2.27923 11.9443L3.3847 10L2.27923 8.05567C1.98165 7.53183 1.98392 6.88897 2.28509 6.36719L3.0224 5.09083C3.32583 4.56562 3.88651 4.24122 4.4931 4.24122L6.47552 4.24219C6.60747 4.24216 6.72872 4.17176 6.79388 4.0586C7.11509 3.50071 7.51385 2.80626 7.78119 2.34083C8.08449 1.81317 8.64649 1.48927 9.25384 1.48926C9.79678 1.48926 10.219 1.48926 10.746 1.48926ZM9.25384 2.81934C9.12132 2.81943 8.9989 2.8901 8.93353 3.00391C8.66615 3.46942 8.2677 4.16431 7.94623 4.72266C7.64294 5.24905 7.08168 5.57225 6.47552 5.57227H4.4931C4.3616 5.57227 4.23959 5.64204 4.17376 5.75587L3.43744 7.03223C3.3722 7.14531 3.37108 7.2849 3.43548 7.39844L4.7265 9.66895C4.76927 9.74425 4.7964 9.82777 4.80755 9.91309L4.81341 10C4.81335 10.1155 4.78355 10.2297 4.7265 10.3301L3.43548 12.6016C3.3712 12.7151 3.37219 12.8548 3.43744 12.9678L4.17376 14.2432C4.23959 14.357 4.3616 14.4277 4.4931 14.4277H6.47552C7.0818 14.4278 7.643 14.7508 7.94623 15.2774C8.26778 15.8358 8.66715 16.5306 8.93451 16.9961C8.99997 17.1096 9.12148 17.1806 9.25384 17.1807C9.79674 17.1807 10.219 17.1807 10.746 17.1807C10.8785 17.1807 11.0009 17.1099 11.0663 16.9961C11.3337 16.5306 11.7321 15.8358 12.0536 15.2774C12.3569 14.7507 12.918 14.4278 13.5244 14.4277H15.5068C15.6381 14.4277 15.7603 14.3568 15.8261 14.2432L16.5624 12.9678C16.6278 12.8546 16.6289 12.7142 16.5644 12.6006L15.2734 10.3301C15.2163 10.2296 15.1865 10.1155 15.1865 10C15.1865 9.88449 15.2164 9.7704 15.2734 9.66993L16.5644 7.39844C16.6288 7.28497 16.6285 7.14528 16.5634 7.03223L15.8261 5.75587C15.7603 5.64209 15.6382 5.5723 15.5068 5.57227H13.5244C12.9182 5.57225 12.3569 5.24911 12.0536 4.72266C11.7322 4.16428 11.3337 3.46943 11.0663 3.00391C11.001 2.8902 10.8794 2.81957 10.747 2.81934C10.2199 2.81933 9.7968 2.81933 9.25384 2.81934Z" fill="currentColor" />
    </svg>
  )
}

function RailButton({
  children,
  label,
  active = false,
  badge = false,
  tooltip = true,
  buttonRef,
  ariaHaspopup,
  ariaExpanded,
  onClick
}: {
  children: ReactNode
  label: string
  active?: boolean
  badge?: boolean
  tooltip?: boolean
  buttonRef?: RefObject<HTMLButtonElement | null>
  ariaHaspopup?: 'dialog' | 'menu'
  ariaExpanded?: boolean
  onClick?: () => void
}): ReactNode {
  const button = <button
      ref={buttonRef}
      type="button"
      className={`rail-button${active ? ' active' : ''}`}
      aria-label={label}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      data-state={ariaExpanded === undefined ? undefined : ariaExpanded ? 'open' : 'closed'}
      onClick={onClick}
    >
      {children}
      {badge && <span className="rail-notification-dot" />}
    </button>
  return tooltip ? <SidebarTooltip content={label} placement="right">{button}</SidebarTooltip> : button
}

type SidebarSectionId = 'pinned' | 'projects' | 'recent'

const SIDEBAR_COLLAPSED_SECTIONS_KEY = 'codex-sidebar-collapsed-sections-v1'
const SIDEBAR_COLLAPSED_PROJECTS_KEY = 'codex-sidebar-collapsed-projects-v1'
const SIDEBAR_EXPANDED_PROJECTS_KEY = 'codex-sidebar-expanded-projects-v1'
const SIDEBAR_PINNED_PROJECTS_KEY = 'codex-sidebar-pinned-projects-v1'
const SIDEBAR_PINNED_SORT_KEY = 'codex-sidebar-pinned-sort-v1'
const SIDEBAR_CHAT_SORT_KEY = 'codex-sidebar-chat-sort-v1'
const SIDEBAR_GROUPING_KEY = 'codex-sidebar-grouping-v1'
const SIDEBAR_RECENT_PROJECTS_KEY = 'codex-sidebar-recent-projects-v1'
const SIDEBAR_RECENT_INITIAL_LIMIT = 20
const SIDEBAR_RECENT_PAGE_SIZE = 10

function parseSidebarStringList(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))]
  } catch {
    return []
  }
}

function usePersistedSidebarList(
  key: string
): [string[], (value: string, aliases?: readonly string[]) => void] {
  const [values, setValues] = useState<string[]>(() => parseSidebarStringList(localStorage.getItem(key)))
  useEffect(() => {
    const changed = (): void => setValues(parseSidebarStringList(localStorage.getItem(key)))
    const storage = (event: StorageEvent): void => { if (event.key === key || event.key === null) changed() }
    window.addEventListener(PROJECT_PINNED_EVENT, changed)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(PROJECT_PINNED_EVENT, changed); window.removeEventListener('storage', storage) }
  }, [key])
  const toggle = (value: string, aliases: readonly string[] = []): void => {
    const current = parseSidebarStringList(localStorage.getItem(key))
    const equivalent = new Set([value, ...aliases])
    const enabled = current.some((entry) => equivalent.has(entry))
    const withoutAliases = current.filter((entry) => !equivalent.has(entry))
    const next = enabled ? withoutAliases : [...withoutAliases, value]
    localStorage.setItem(key, JSON.stringify(next))
    setValues(next)
    window.dispatchEvent(new CustomEvent(PROJECT_PINNED_EVENT))
  }
  return [values, toggle]
}

function usePersistedSidebarOption<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key)
    return options.includes(stored as T) ? (stored as T) : fallback
  })

  useEffect(() => {
    localStorage.setItem(key, value)
  }, [key, value])

  return [value, setValue]
}

function usePersistedSidebarBoolean(
  key: string,
  fallback: boolean
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored !== 'false'
  })

  useEffect(() => {
    localStorage.setItem(key, String(value))
  }, [key, value])

  return [value, setValue]
}

function SidebarDisclosureIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 20 21" fill="none" aria-hidden="true">
      <path
        d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.6"
      />
    </svg>
  )
}

function CodexWordmark(): ReactNode {
  return (
    <svg className="sidebar-wordmark" width="53.225983" height="18" viewBox="0 0 53.225983 18" fill="none" aria-hidden="true">
      <path d="M6.82200 15.16200Q5.00400 15.16200 3.64500 14.33400Q2.28600 13.50600 1.55700 12.03900Q0.82800 10.57200 0.82800 8.70000Q0.82800 6.82800 1.56600 5.36100Q2.30400 3.89400 3.66300 3.05700Q5.02200 2.22000 6.82200 2.22000Q8.31600 2.22000 9.49500 2.77800Q10.67400 3.33600 11.38500 4.33500Q12.09600 5.33400 12.24000 6.64800L10.04400 6.64800Q9.82800 5.49600 8.99100 4.83000Q8.15400 4.16400 6.91200 4.16400L6.75000 4.16400Q5.63400 4.16400 4.78800 4.74000Q3.94200 5.31600 3.48300 6.35100Q3.02400 7.38600 3.02400 8.70000Q3.02400 10.01400 3.48300 11.04000Q3.94200 12.06600 4.78800 12.64200Q5.63400 13.21800 6.75000 13.21800L6.91200 13.21800Q8.15400 13.21800 8.99100 12.55200Q9.82800 11.88600 10.04400 10.73400L12.24000 10.73400Q12.09600 12.03000 11.38500 13.02900Q10.67400 14.02800 9.49500 14.59500Q8.31600 15.16200 6.82200 15.16200ZM18.21600 15.19800Q16.93800 15.19800 15.90300 14.58600Q14.86800 13.97400 14.28300 12.89400Q13.69800 11.81400 13.69800 10.48200Q13.69800 9.16800 14.28300 8.09700Q14.86800 7.02600 15.90300 6.41400Q16.93800 5.80200 18.21600 5.80200Q19.49400 5.80200 20.52000 6.41400Q21.54600 7.02600 22.13100 8.08800Q22.71600 9.15000 22.71600 10.48200Q22.71600 11.81400 22.13100 12.89400Q21.54600 13.97400 20.52000 14.58600Q19.49400 15.19800 18.21600 15.19800ZM18.25200 13.45200Q19.31400 13.45200 19.97100 12.64200Q20.62800 11.83200 20.62800 10.48200Q20.62800 9.15000 19.97100 8.34900Q19.31400 7.54800 18.25200 7.54800L18.14400 7.54800Q17.10000 7.54800 16.44300 8.35800Q15.78600 9.16800 15.78600 10.48200Q15.78600 11.81400 16.44300 12.63300Q17.10000 13.45200 18.14400 13.45200L18.25200 13.45200ZM28.22399 15.18000Q27.07199 15.18000 26.14499 14.59500Q25.21799 14.01000 24.68699 12.94800Q24.15599 11.88600 24.15599 10.50000Q24.15599 9.11400 24.69599 8.04300Q25.23599 6.97200 26.18099 6.38700Q27.12599 5.80200 28.29599 5.80200Q29.21399 5.80200 29.94299 6.18000Q30.67199 6.55800 31.03199 7.11600L31.03199 2.40000L33.10199 2.40000L33.10199 15.00000L31.03199 15.00000L31.03199 13.81200Q30.68999 14.40600 29.93399 14.79300Q29.17799 15.18000 28.22399 15.18000ZM28.67399 13.45200Q29.71799 13.45200 30.38399 12.63300Q31.04999 11.81400 31.04999 10.48200Q31.04999 9.16800 30.38399 8.34900Q29.71799 7.53000 28.67399 7.53000L28.58399 7.53000Q27.53999 7.53000 26.89199 8.34900Q26.24399 9.16800 26.24399 10.48200Q26.24399 11.81400 26.89199 12.63300Q27.53999 13.45200 28.58399 13.45200L28.67399 13.45200ZM39.41999 15.19800Q38.21399 15.19800 37.23299 14.61300Q36.25199 14.02800 35.68499 12.96600Q35.11799 11.90400 35.11799 10.50000Q35.11799 9.11400 35.68499 8.04300Q36.25199 6.97200 37.22399 6.38700Q38.19599 5.80200 39.40199 5.80200Q41.07599 5.80200 42.20999 6.82800Q43.34399 7.85400 43.52399 9.63600Q43.57799 10.30200 43.55999 11.05800L37.15199 11.05800Q37.20599 12.15600 37.85399 12.82200Q38.50199 13.48800 39.40199 13.48800L39.50999 13.48800Q40.21199 13.48800 40.70699 13.13700Q41.20199 12.78600 41.36399 12.21000L43.43399 12.21000Q43.10999 13.54200 42.04799 14.37000Q40.98599 15.19800 39.41999 15.19800ZM41.48999 9.45600Q41.41799 8.55600 40.85999 8.03400Q40.30199 7.51200 39.45599 7.51200L39.34799 7.51200Q38.53799 7.51200 37.95299 8.00700Q37.36799 8.50200 37.20599 9.45600L41.48999 9.45600ZM47.41198 10.46400L44.20798 6.00000L46.54798 6.00000L48.58198 8.82600L50.65198 6.00000L52.91998 6.00000L49.71598 10.41000L53.00998 15.00000L50.66998 15.00000L48.54598 12.03000L46.38598 15.00000L44.11798 15.00000Z" fill="currentColor" />
    </svg>
  )
}

function SidebarModeChevronIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.6289 6.29537C11.8339 6.09035 12.166 6.09035 12.3711 6.29537C12.5761 6.5004 12.5761 6.83253 12.3711 7.03756L8.60641 10.8022C8.27129 11.1369 7.72863 11.1369 7.39352 10.8022L3.62887 7.03756C3.42384 6.83253 3.42384 6.5004 3.62887 6.29537C3.83389 6.09035 4.16603 6.09035 4.37105 6.29537L7.99996 9.92428L11.6289 6.29537Z" fill="currentColor" />
    </svg>
  )
}

function SidebarActivityIcon({ attention }: { attention: boolean }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M7.99971 1.30786C8.28964 1.30789 8.5251 1.54332 8.5251 1.83325C8.5251 2.12319 8.28964 2.35862 7.99971 2.35864C6.80343 2.35871 5.88747 2.76384 5.25752 3.39478C4.62378 4.02965 4.24524 4.92715 4.19307 5.96509L4.07002 8.40552C4.05666 8.66978 3.98717 8.92819 3.86592 9.16333L3.0417 10.7629C2.98961 10.8642 3.00756 10.9299 3.01241 10.9397C3.01241 10.9397 3.01313 10.9439 3.02315 10.9495C3.03621 10.9566 3.07892 10.9748 3.17061 10.9749H12.8298C12.9219 10.9748 12.9645 10.9565 12.9773 10.9495C12.9873 10.9439 12.988 10.9397 12.988 10.9397C12.9929 10.9294 13.0118 10.8629 12.9597 10.762L11.8376 8.62231C11.7032 8.3655 11.8025 8.04784 12.0593 7.91333C12.3161 7.779 12.6338 7.87828 12.7683 8.13501L13.8903 10.2786L13.8923 10.2815C14.0625 10.6116 14.1129 11.0345 13.9294 11.4055C13.7296 11.8089 13.3181 12.0245 12.8298 12.0247H11.1481C10.8979 13.5375 9.58441 14.6914 8.00069 14.6917C6.41674 14.6917 5.10269 13.5376 4.85225 12.0247H3.17061C2.68215 12.0246 2.27081 11.809 2.071 11.4055C1.88737 11.0344 1.93783 10.6117 2.10811 10.2815L2.93233 8.68188C2.985 8.57975 3.01534 8.46763 3.0212 8.35278L3.14522 5.91333C3.20852 4.65152 3.67278 3.49557 4.51436 2.65259C5.35991 1.8057 6.55221 1.30793 7.99971 1.30786ZM5.92549 12.0247C6.15962 12.9536 6.99905 13.6418 8.00069 13.6418C9.00204 13.6416 9.84069 12.9534 10.0749 12.0247H5.92549Z" fill="currentColor" />
      {attention && <circle cx="12.6667" cy="3.33335" r="2.525" fill="#3566f0" />}
    </svg>
  )
}

function SidebarSearchIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M7.32843 1.91016C10.2876 1.91016 12.6867 4.30938 12.6868 7.26855C12.6868 8.57363 12.2191 9.7688 11.4437 10.6982L14.0433 13.2979C14.2481 13.5028 14.2481 13.8351 14.0433 14.04C13.8383 14.245 13.5061 14.2449 13.3011 14.04L10.6956 11.4346C9.7753 12.1793 8.60456 12.627 7.32843 12.627C4.36925 12.6268 1.97003 10.2278 1.97003 7.26855C1.97021 4.30949 4.36936 1.91033 7.32843 1.91016ZM7.32843 2.96094C4.94926 2.96111 3.02099 4.88939 3.02081 7.26855C3.02081 9.64787 4.94915 11.577 7.32843 11.5771C9.70786 11.5771 11.637 9.64798 11.637 7.26855C11.6368 4.88928 9.70775 2.96094 7.32843 2.96094Z" fill="currentColor" />
    </svg>
  )
}

function SidebarFolderIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        d="M5.55957 2.14136C6.06503 2.14136 6.55801 2.30207 6.9668 2.59937L7.81836 3.21851C8.04765 3.38523 8.32392 3.47534 8.60742 3.47534H11.9668C13.2877 3.47534 14.3584 4.54606 14.3584 5.86694V11.4666C14.3584 12.7874 13.2877 13.8582 11.9668 13.8582H4.0332C2.71253 13.8579 1.6416 12.7873 1.6416 11.4666V4.53296C1.64185 3.21244 2.71268 2.1416 4.0332 2.14136H5.55957ZM2.69238 7.85913V11.4666C2.69238 12.2074 3.29243 12.8081 4.0332 12.8083H11.9668C12.7078 12.8083 13.3086 12.2075 13.3086 11.4666V7.85913H2.69238ZM4.0332 3.19214C3.29258 3.19238 2.69263 3.79234 2.69238 4.53296V6.80835H13.3086V5.86694C13.3086 5.12596 12.7078 4.52515 11.9668 4.52515H8.60742C8.10196 4.52515 7.60898 4.36541 7.2002 4.06812L6.34863 3.448C6.11941 3.28145 5.84292 3.19214 5.55957 3.19214H4.0332Z"
      />
    </svg>
  )
}

function SidebarRemoteFolderIcon({ globeColor }: { globeColor: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M11.3341 8.99774C13.0412 8.99817 14.4259 10.3823 14.4259 12.0895C14.4257 13.7967 13.0403 15.1802 11.3331 15.1804C9.62649 15.1796 8.24255 13.7963 8.24231 12.0895C8.24231 10.3821 9.62663 8.99774 11.3341 8.99774ZM10.88 12.53C10.9107 13.0499 10.9942 13.5041 11.1066 13.8405C11.1789 14.0567 11.2559 14.2013 11.3204 14.2829C11.3244 14.2878 11.3296 14.2914 11.3331 14.2956C11.3368 14.2913 11.3427 14.2881 11.3468 14.2829C11.4113 14.2012 11.4884 14.0568 11.5607 13.8405C11.6731 13.5041 11.7556 13.0499 11.7863 12.53H10.88ZM9.13489 12.53C9.2686 13.2 9.70172 13.7611 10.2882 14.071C10.1507 13.6447 10.0609 13.1116 10.0304 12.53H9.13489ZM12.6368 12.53C12.6061 13.1117 12.5146 13.6446 12.3771 14.071C12.964 13.7613 13.3976 13.2005 13.5314 12.53H12.6368ZM10.2882 10.1061C9.69233 10.421 9.25628 10.9962 9.13 11.6804H10.0284C10.0573 11.0859 10.1481 10.5404 10.2882 10.1061ZM11.3204 9.8952C11.2559 9.97691 11.1789 10.1221 11.1066 10.3386C10.9919 10.6818 10.9081 11.1473 10.879 11.6804H11.7872C11.7581 11.1474 11.6753 10.6818 11.5607 10.3386C11.4884 10.1223 11.4113 9.97695 11.3468 9.8952C11.3425 9.88982 11.3369 9.88594 11.3331 9.88153C11.3294 9.88589 11.3246 9.88996 11.3204 9.8952ZM12.3771 10.1052C12.5175 10.5396 12.6087 11.0853 12.6378 11.6804H13.5363C13.4099 10.9956 12.9736 10.4198 12.3771 10.1052Z" fill={globeColor} />
      <path fillRule="evenodd" clipRule="evenodd" d="M5.36926 2.1413C5.9238 2.14134 6.36032 2.23675 6.73254 2.38934C7.09763 2.53904 7.38165 2.73785 7.61829 2.90399C8.07618 3.22547 8.42082 3.47434 9.16614 3.4743H11.9474C13.3337 3.47453 14.4454 4.61186 14.4454 5.99969V7.06512C14.4453 7.48137 14.1213 7.85614 13.6564 7.85614H2.60559V11.3307C2.60559 12.1518 3.26039 12.8051 4.05383 12.8054H6.16907C6.45883 12.8056 6.69348 13.0409 6.69348 13.3307C6.69348 13.6206 6.45883 13.8559 6.16907 13.8561H4.05383C2.66749 13.8559 1.55579 12.7186 1.55579 11.3307V7.35028C1.55557 7.34411 1.55383 7.33795 1.55383 7.33173C1.55383 7.32523 1.55555 7.31864 1.55579 7.31219V4.66669C1.55579 3.27887 2.66749 2.14155 4.05383 2.1413H5.36926ZM4.05383 3.19208C3.26039 3.19233 2.60559 3.84568 2.60559 4.66669V6.80634H13.3956V5.99969C13.3956 5.17867 12.7408 4.52531 11.9474 4.52509H9.16711C8.07977 4.52528 7.5071 4.10834 7.01575 3.76337C6.77774 3.59627 6.57866 3.46129 6.33411 3.36102C6.09669 3.26369 5.79658 3.19212 5.36926 3.19208H4.05383Z" fill="currentColor" />
    </svg>
  )
}

function SidebarRemoteGlobeIcon({ color }: { color: string }): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{color}}>
      <path d="M10 2.125C14.3492 2.125 17.875 5.65076 17.875 10C17.875 14.3492 14.3492 17.875 10 17.875C5.65076 17.875 2.125 14.3492 2.125 10C2.125 5.65076 5.65076 2.125 10 2.125ZM7.88672 10.625C7.94334 12.3161 8.22547 13.8134 8.63965 14.9053C8.87263 15.5194 9.1351 15.9733 9.39453 16.2627C9.65437 16.5524 9.86039 16.625 10 16.625C10.1396 16.625 10.3456 16.5524 10.6055 16.2627C10.8649 15.9733 11.1274 15.5194 11.3604 14.9053C11.7745 13.8134 12.0567 12.3161 12.1133 10.625H7.88672ZM3.40527 10.625C3.65313 13.2734 5.45957 15.4667 7.89844 16.2822C7.7409 15.997 7.5977 15.6834 7.4707 15.3486C6.99415 14.0923 6.69362 12.439 6.63672 10.625H3.40527ZM13.3633 10.625C13.3064 12.439 13.0059 14.0923 12.5293 15.3486C12.4022 15.6836 12.2582 15.9969 12.1006 16.2822C14.5399 15.467 16.3468 13.2737 16.5947 10.625H13.3633ZM12.1006 3.7168C12.2584 4.00235 12.4021 4.31613 12.5293 4.65137C13.0059 5.90775 13.3064 7.56102 13.3633 9.375H16.5947C16.3468 6.72615 14.54 4.53199 12.1006 3.7168ZM10 3.375C9.86039 3.375 9.65437 3.44756 9.39453 3.7373C9.1351 4.02672 8.87263 4.48057 8.63965 5.09473C8.22547 6.18664 7.94334 7.68388 7.88672 9.375H12.1133C12.0567 7.68388 11.7745 6.18664 11.3604 5.09473C11.1274 4.48057 10.8649 4.02672 10.6055 3.7373C10.3456 3.44756 10.1396 3.375 10 3.375ZM7.89844 3.7168C5.45942 4.53222 3.65314 6.72647 3.40527 9.375H6.63672C6.69362 7.56102 6.99415 5.90775 7.4707 4.65137C7.59781 4.31629 7.74073 4.00224 7.89844 3.7168Z" />
    </svg>
  )
}

function remoteConnectionStateLabel(state: NonNullable<SidebarProjectCollection['hostState']>): string {
  if (state === 'connected') return '已连接'
  if (state === 'connecting') return '正在连接'
  if (state === 'error') return '连接错误'
  return '未连接'
}

function SidebarMoreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.33362 6.80811C3.99161 6.80828 4.52502 7.34246 4.52502 8.00049C4.52485 8.65837 3.9915 9.19172 3.33362 9.19189C2.67559 9.19189 2.14141 8.65848 2.14124 8.00049C2.14124 7.34235 2.67548 6.80811 3.33362 6.80811Z" />
      <path d="M8.00061 6.80811C8.65849 6.80841 9.19202 7.34254 9.19202 8.00049C9.19184 8.65829 8.65838 9.19159 8.00061 9.19189C7.34258 9.19189 6.8084 8.65848 6.80823 8.00049C6.80823 7.34235 7.34247 6.80811 8.00061 6.80811Z" />
      <path d="M12.6666 6.80811C13.3246 6.80828 13.858 7.34246 13.858 8.00049C13.8579 8.65837 13.3245 9.19172 12.6666 9.19189C12.0088 9.1917 11.4744 8.65836 11.4742 8.00049C11.4742 7.34247 12.0087 6.8083 12.6666 6.80811Z" />
    </svg>
  )
}

function SidebarCheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path
        d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SidebarLayoutIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.5 2.30762C13.1707 2.30762 14.5254 3.66235 14.5254 5.33301V10.666C14.5254 12.3367 13.1707 13.6914 11.5 13.6914H4.5C2.82934 13.6914 1.47461 12.3367 1.47461 10.666V5.33301C1.47461 3.66235 2.82934 2.30762 4.5 2.30762H11.5ZM6.52539 12.6416H11.5C12.5908 12.6416 13.4746 11.7568 13.4746 10.666V5.33301C13.4746 4.24225 12.5908 3.3584 11.5 3.3584H6.52539V12.6416ZM4.5 3.3584C3.40924 3.3584 2.52539 4.24225 2.52539 5.33301V10.666C2.52539 11.7568 3.40924 12.6416 4.5 12.6416H5.47461V3.3584H4.5Z"
      />
    </svg>
  )
}

function SidebarSortIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4.66722 3.14218C4.95711 3.14225 5.19261 3.37767 5.19261 3.66757V11.6295L6.95824 9.82578C7.16093 9.61896 7.49327 9.61573 7.70043 9.81796C7.90753 10.0208 7.91092 10.353 7.70824 10.5602L5.27953 13.0406L5.2141 13.1012C4.89729 13.3642 4.43507 13.3645 4.1184 13.1012L4.05297 13.0406L1.62523 10.5602C1.4228 10.353 1.42608 10.0207 1.63304 9.81796C1.8401 9.61558 2.17245 9.61912 2.37523 9.82578L4.14183 11.6295V3.66757C4.14183 3.37762 4.37727 3.14218 4.66722 3.14218Z" />
      <path d="M10.7854 2.98203C11.1021 2.71876 11.5643 2.719 11.8811 2.98203L11.9465 3.04257L14.3752 5.52304C14.5779 5.73021 14.5745 6.06242 14.3674 6.26523C14.1603 6.46786 13.828 6.46437 13.6252 6.25742L11.8586 4.45175V12.3336C11.8584 12.6233 11.623 12.859 11.3332 12.859C11.0436 12.8588 10.8081 12.6232 10.8078 12.3336V4.45371L9.04222 6.25742C8.83948 6.46447 8.50723 6.46775 8.30004 6.26523C8.093 6.06236 8.08941 5.73017 8.29222 5.52304L10.72 3.04257L10.7854 2.98203Z" />
    </svg>
  )
}

function SidebarPlusIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 2.47461C8.28995 2.47461 8.52539 2.71005 8.52539 3V7.47461H13C13.2899 7.47461 13.5254 7.71005 13.5254 8C13.5254 8.28995 13.2899 8.52539 13 8.52539H8.52539V13C8.52539 13.2899 8.28995 13.5254 8 13.5254C7.71005 13.5254 7.47461 13.2899 7.47461 13V8.52539H3C2.71005 8.52539 2.47461 8.28995 2.47461 8C2.47461 7.71005 2.71005 7.47461 3 7.47461H7.47461V3C7.47461 2.71005 7.71005 2.47461 8 2.47461Z" />
    </svg>
  )
}

function SidebarProjectNewIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.33325 1.80763C6.62314 1.80763 6.85855 2.04315 6.85864 2.33302C6.85864 2.62297 6.6232 2.85841 6.33325 2.85841H4.66626C3.66786 2.85859 2.85891 3.66765 2.85864 4.66603V11.333C2.85864 12.3316 3.66769 13.1414 4.66626 13.1416H11.3333C12.332 13.1416 13.1418 12.3317 13.1418 11.333V9.66603C13.1421 9.37642 13.3766 9.14179 13.6663 9.14161C13.956 9.14161 14.1914 9.37631 14.1917 9.66603V11.333C14.1917 12.9116 12.9119 14.1914 11.3333 14.1914H4.66626C3.0878 14.1912 1.80786 12.9115 1.80786 11.333V4.66603C1.80813 3.08775 3.08796 1.80781 4.66626 1.80763H6.33325Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.842 2.32228C11.6259 1.55049 12.8863 1.55435 13.6643 2.33204C14.4442 3.11205 14.4469 4.37706 13.6702 5.16017L9.41626 9.4463C9.05652 9.80879 8.59956 10.0601 8.10083 10.1699L6.19263 10.5899C5.7111 10.6958 5.28165 10.2666 5.38794 9.78517L5.80884 7.88185C5.9196 7.38036 6.17342 6.92096 6.53931 6.56056L10.842 2.32228ZM12.9221 3.07521C12.552 2.7051 11.9524 2.70322 11.5793 3.07033L7.27563 7.30861C7.05429 7.52663 6.90125 7.80504 6.83423 8.10841L6.54028 9.43849L7.87524 9.14454C8.17687 9.07807 8.45355 8.92625 8.67114 8.70704L12.9241 4.41993C13.2934 4.04741 13.2928 3.44631 12.9221 3.07521Z"
      />
    </svg>
  )
}

function SidebarComposeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M8.16675 2.50127C8.53391 2.50127 8.83161 2.7992 8.83179 3.16631C8.83179 3.53358 8.53402 3.83135 8.16675 3.83135H5.83374C4.72836 3.83135 3.83197 4.72797 3.83179 5.8333V14.1663C3.83179 15.2718 4.72825 16.1683 5.83374 16.1683H14.1667C15.2722 16.1683 16.1687 15.2718 16.1687 14.1663V11.8333C16.1689 11.4662 16.4666 11.1683 16.8337 11.1683C17.2007 11.1684 17.4986 11.4663 17.4988 11.8333V14.1663C17.4988 16.0063 16.0068 17.4983 14.1667 17.4983H5.83374C3.99371 17.4983 2.50171 16.0063 2.50171 14.1663V5.8333C2.50189 3.99343 3.99382 2.50127 5.83374 2.50127H8.16675Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.4265 3.10381C14.3857 2.15908 15.9276 2.16466 16.8796 3.11651C17.8339 4.07106 17.8372 5.61827 16.8865 6.57647L11.7244 11.7786C11.3005 12.2058 10.7622 12.5027 10.1746 12.6321L7.78784 13.1565C7.20661 13.2842 6.6889 12.766 6.81714 12.1849L7.34253 9.80498C7.47294 9.21426 7.77197 8.67391 8.20288 8.24932L13.4265 3.10381ZM15.9392 4.05694C15.5038 3.62172 14.7988 3.61907 14.3601 4.05108L9.13647 9.19659C8.88861 9.44077 8.71644 9.75138 8.64136 10.0911L8.28979 11.6849L9.88843 11.3333C10.2265 11.2588 10.5362 11.0878 10.78 10.8421L15.9421 5.63897C16.3769 5.20075 16.3756 4.49352 15.9392 4.05694Z"
      />
    </svg>
  )
}

function SidebarChatIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.4746 8.00037C13.4746 5.18857 11.0524 2.85876 8 2.85876C4.94756 2.85876 2.52539 5.18857 2.52539 8.00037C2.52548 9.13377 2.98018 9.8833 3.55176 11.015C3.62017 11.1505 3.63938 11.306 3.60645 11.4545L3.34277 12.641L4.62598 12.309L4.74023 12.2894C4.81669 12.2835 4.89333 12.2915 4.9668 12.3119L5.0752 12.3519L5.44238 12.5219C6.29248 12.8996 7.09158 13.142 8 13.142C11.0523 13.142 13.4744 10.812 13.4746 8.00037ZM14.5254 8.00037C14.5252 11.4476 11.5749 14.1918 8 14.1918C6.78477 14.1918 5.75932 13.8293 4.75488 13.3597L2.9873 13.8187C2.5113 13.942 2.07317 13.5185 2.17969 13.0385L2.5498 11.3636C2.03641 10.3601 1.4747 9.38207 1.47461 8.00037C1.47461 4.55293 4.42502 1.80798 8 1.80798C11.575 1.80798 14.5254 4.55293 14.5254 8.00037Z" />
    </svg>
  )
}

function SidebarLoadingIndicator(): ReactNode {
  return (
    <span className="thread-row-status" role="status" aria-label="处理中">
      <span className="thread-row-spinner">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            opacity="0.3"
            d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"
            fill="currentColor"
          />
          <path
            d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </span>
  )
}

function SidebarPinIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.69891 2.27357C9.31186 1.3608 10.5517 1.22764 11.3727 1.86732L11.5309 2.00599L11.5339 2.00794L13.9772 4.42298L13.9792 4.42494C14.4059 4.8517 14.5371 5.42193 14.4782 5.9308C14.42 6.43249 14.171 6.93184 13.7595 7.24915L13.7526 7.25501L13.7448 7.26087L11.3298 8.98548C11.1639 9.10413 11.0484 9.28174 11.0075 9.48158L10.4782 12.0724L10.4753 12.089L10.4714 12.1046C10.2782 12.8194 9.76642 13.4028 9.10614 13.63C8.42298 13.8649 7.65884 13.691 7.05731 13.0451L5.36395 11.3771L2.37079 14.3712C2.16573 14.5759 1.8335 14.5761 1.6286 14.3712C1.42386 14.1663 1.424 13.834 1.6286 13.629L4.61591 10.6408L3.0202 9.06947C2.43193 8.49821 2.23267 7.72098 2.42841 7.02747C2.62488 6.33222 3.20203 5.77719 4.03485 5.61439L6.51532 5.04212C6.71041 4.99699 6.88227 4.88121 6.99677 4.71693L8.69891 2.27357ZM10.7253 2.69447C10.3542 2.4054 9.817 2.48584 9.56708 2.86341L9.56024 2.87415L7.85809 5.31654C7.59479 5.69446 7.20041 5.96185 6.75165 6.06556L4.27118 6.63783L4.26044 6.63978L4.2497 6.64271C3.7797 6.73015 3.52398 7.01265 3.43915 7.31263C3.36345 7.5807 3.41094 7.90777 3.64227 8.19642L3.7536 8.31751L3.75653 8.32142L7.79462 12.297L7.80438 12.3068L7.81415 12.3175C8.1577 12.6942 8.50017 12.7281 8.76532 12.6369C9.05794 12.5359 9.33935 12.2518 9.4538 11.841L9.97919 9.27064C10.0732 8.81103 10.3377 8.40376 10.7194 8.13099L13.1218 6.41419C13.2772 6.2924 13.4052 6.06827 13.4352 5.8097C13.4645 5.55713 13.396 5.32744 13.239 5.16908L10.7975 2.75697L10.7253 2.69447Z"
      />
    </svg>
  )
}

function SidebarUnpinIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8.69824 2.2735C9.31106 1.36065 10.551 1.2278 11.3721 1.86725L11.5303 2.00592L11.5332 2.00788L13.9766 4.42292L13.9785 4.42487C14.4053 4.85165 14.5365 5.42185 14.4775 5.93073C14.4193 6.43251 14.1705 6.93178 13.7588 7.24909L13.752 7.25495L13.7441 7.26081L11.3291 8.98542C11.1632 9.10408 11.0477 9.28168 11.0068 9.48151L10.4775 12.0723L10.4746 12.0889L10.4707 12.1046C10.2775 12.8194 9.76585 13.4028 9.10547 13.6299C8.42237 13.8647 7.6581 13.6908 7.05664 13.045L5.36328 11.378L2.37109 14.3712L1.62891 13.629L4.61523 10.6417L3.01953 9.0694C2.43146 8.49816 2.23202 7.72081 2.42773 7.02741C2.62416 6.33218 3.20146 5.7772 4.03418 5.61432L6.51465 5.04206C6.70981 4.99696 6.88156 4.8812 6.99609 4.71686L8.69824 2.2735Z" />
    </svg>
  )
}

function SidebarArchiveIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.33423 8.14124C9.6238 8.14167 9.85864 8.37695 9.85864 8.66663C9.85864 8.9563 9.6238 9.19158 9.33423 9.19202H6.66724C6.37729 9.19202 6.14185 8.95658 6.14185 8.66663C6.14185 8.37668 6.37729 8.14124 6.66724 8.14124H9.33423Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.3333 2.14124C13.3595 2.14124 14.1915 2.97346 14.1917 3.99963V4.66663C14.1917 5.11035 14.0352 5.51699 13.7756 5.83655V11.3336C13.7755 12.7279 12.6445 13.8589 11.2502 13.859H4.75024C3.35584 13.859 2.22504 12.728 2.22485 11.3336V5.83752C1.96478 5.51781 1.80786 5.11082 1.80786 4.66663V3.99963C1.80804 2.97356 2.64019 2.14141 3.66626 2.14124H12.3333ZM12.7249 6.48206C12.5985 6.50918 12.4677 6.52502 12.3333 6.52502H3.66626C3.53214 6.525 3.4017 6.50907 3.27563 6.48206V11.3336C3.27582 12.1481 3.93574 12.8082 4.75024 12.8082H11.2502C12.0646 12.8081 12.7247 12.148 12.7249 11.3336V6.48206ZM3.66626 3.19202C3.22009 3.19219 2.85882 3.55346 2.85864 3.99963V4.66663C2.85864 4.94388 2.99856 5.18793 3.21118 5.33362H3.27563V5.37366C3.39145 5.43793 3.5244 5.47516 3.66626 5.47522H12.3333C12.4754 5.47522 12.6088 5.43811 12.7249 5.37366V5.33362H12.7903C13.0026 5.18786 13.1418 4.94346 13.1418 4.66663V3.99963C13.1417 3.55335 12.7796 3.19202 12.3333 3.19202H3.66626Z"
      />
    </svg>
  )
}

function SidebarMenuChoice({
  label,
  checked,
  role,
  onSelect
}: {
  label: string
  checked: boolean
  role: 'menuitemradio' | 'menuitemcheckbox'
  onSelect(): void
}): ReactNode {
  return (
    <button
      type="button"
      className="sidebar-menu-item sidebar-menu-choice"
      role={role}
      aria-checked={checked}
      data-state={role === 'menuitemcheckbox' ? (checked ? 'checked' : 'unchecked') : undefined}
      tabIndex={-1}
      onClick={onSelect}
    >
      <span>{label}</span>
      {checked && <SidebarCheckIcon />}
    </button>
  )
}

function SidebarSubmenuTrigger({
  id,
  label,
  icon,
  open,
  onOpen,
  children
}: {
  id: string
  label: string
  icon: ReactNode
  open: boolean
  onOpen(): void
  children: ReactNode
}): ReactNode {
  const menuId = `${id}-menu`
  return (
    <div
      className={`sidebar-menu-item sidebar-submenu-trigger${open ? ' is-open' : ''}`}
      role="menuitem"
      id={id}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      data-state={open ? 'open' : 'closed'}
      data-highlighted={open ? '' : undefined}
      tabIndex={open ? 0 : -1}
      onPointerEnter={onOpen}
      onFocus={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="sidebar-menu-leading-icon">{icon}</span>
      <span>{label}</span>
      <ChevronRight className="sidebar-menu-chevron" aria-hidden="true" />
      {open && (
        <div
          className="sidebar-section-menu sidebar-section-submenu"
          id={menuId}
          role="menu"
          aria-labelledby={id}
          aria-orientation="vertical"
          data-side="right"
          data-align="start"
          data-state="open"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function SidebarSectionActions({
  sectionId,
  pinnedSortMode,
  chatSortMode,
  groupingMode,
  showProjectsInRecent,
  onPinnedSortModeChange,
  onChatSortModeChange,
  onGroupingModeChange,
  onShowProjectsInRecentChange,
  onAddProject,
  onNewThread
}: {
  sectionId: SidebarSectionId
  pinnedSortMode: SidebarSortMode
  chatSortMode: SidebarSortMode
  groupingMode: SidebarGroupingMode
  showProjectsInRecent: boolean
  onPinnedSortModeChange(value: SidebarSortMode): void
  onChatSortModeChange(value: SidebarSortMode): void
  onGroupingModeChange(value: SidebarGroupingMode): void
  onShowProjectsInRecentChange(value: boolean): void
  onAddProject(): void
  onNewThread(): void
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const [submenu, setSubmenu] = useState<'grouping' | 'sorting' | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const uiZoom = useWindowZoom()
  const actionsRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerId = `sidebar-${sectionId}-options-trigger`
  const menuId = `sidebar-${sectionId}-options-menu`
  const optionLabel =
    sectionId === 'pinned'
      ? '置顶选项'
      : sectionId === 'projects'
        ? '项目侧边栏选项'
        : '聊天侧边栏选项'

  const updateMenuPosition = (): void => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = toLogicalRect(trigger.getBoundingClientRect(), readWindowZoom())
    setMenuPosition({
      left: sectionId === 'pinned' ? rect.right - 222 : rect.left,
      top: rect.bottom + 1
    })
  }

  const closeMenu = (): void => {
    setMenuOpen(false)
    setSubmenu(null)
  }

  useLayoutEffect(() => {
    if (!menuOpen) return
    updateMenuPosition()
    const reposition = (): void => updateMenuPosition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [menuOpen, sectionId, uiZoom])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (actionsRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      closeMenu()
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const choosePinnedSort = (value: SidebarSortMode): void => {
    onPinnedSortModeChange(value)
    closeMenu()
  }
  const chooseChatSort = (value: SidebarSortMode): void => {
    onChatSortModeChange(value)
    closeMenu()
  }
  const chooseGrouping = (value: SidebarGroupingMode): void => {
    onGroupingModeChange(value)
    closeMenu()
  }

  const menu = menuOpen ? (
    <div
      ref={menuRef}
      className={`sidebar-section-menu sidebar-section-main-menu is-${sectionId}`}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      aria-orientation="vertical"
      data-side="bottom"
      data-align={sectionId === 'pinned' ? 'end' : 'start'}
      data-state="open"
      style={menuPosition}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {sectionId === 'pinned' ? (
        <>
          <SidebarMenuChoice
            label="最近更新"
            role="menuitemradio"
            checked={pinnedSortMode === 'recent'}
            onSelect={() => choosePinnedSort('recent')}
          />
          <SidebarMenuChoice
            label="手动排序"
            role="menuitemradio"
            checked={pinnedSortMode === 'manual'}
            onSelect={() => choosePinnedSort('manual')}
          />
        </>
      ) : (
        <>
          <SidebarSubmenuTrigger
            id={`${menuId}-grouping-trigger`}
            label="整理侧边栏"
            icon={<SidebarLayoutIcon />}
            open={submenu === 'grouping'}
            onOpen={() => setSubmenu('grouping')}
          >
            <SidebarMenuChoice
              label="分项目显示"
              role="menuitemradio"
              checked={groupingMode === 'project'}
              onSelect={() => chooseGrouping('project')}
            />
            <SidebarMenuChoice
              label="按远程主机"
              role="menuitemradio"
              checked={groupingMode === 'host'}
              onSelect={() => chooseGrouping('host')}
            />
            <SidebarMenuChoice
              label="合并显示"
              role="menuitemradio"
              checked={groupingMode === 'combined'}
              onSelect={() => chooseGrouping('combined')}
            />
          </SidebarSubmenuTrigger>
          <SidebarSubmenuTrigger
            id={`${menuId}-sorting-trigger`}
            label="聊天排序方式"
            icon={<SidebarSortIcon />}
            open={submenu === 'sorting'}
            onOpen={() => setSubmenu('sorting')}
          >
            <SidebarMenuChoice
              label="最近更新"
              role="menuitemradio"
              checked={chatSortMode === 'recent'}
              onSelect={() => chooseChatSort('recent')}
            />
            <SidebarMenuChoice
              label="手动排序"
              role="menuitemradio"
              checked={chatSortMode === 'manual'}
              onSelect={() => chooseChatSort('manual')}
            />
          </SidebarSubmenuTrigger>
          {sectionId === 'recent' && (
            <>
              <div className="sidebar-menu-separator" aria-hidden="true"><span /></div>
              <div className="sidebar-menu-group-label">显示</div>
              <SidebarMenuChoice
                label="项目"
                role="menuitemcheckbox"
                checked={showProjectsInRecent}
                onSelect={() => onShowProjectsInRecentChange(!showProjectsInRecent)}
              />
            </>
          )}
        </>
      )}
    </div>
  ) : null

  return (
    <div
      ref={actionsRef}
      className={`section-title-actions${menuOpen ? ' menu-open' : ''}`}
    >
      <div className="section-title-actions-inner">
        <button
          ref={triggerRef}
          type="button"
          className="section-title-action"
          id={triggerId}
          aria-label={optionLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          data-state={menuOpen ? 'open' : 'closed'}
          onClick={(event) => {
            event.stopPropagation()
            if (menuOpen) closeMenu()
            else {
              updateMenuPosition()
              setMenuOpen(true)
            }
          }}
        >
          <SidebarMoreIcon />
        </button>
        {sectionId === 'projects' && (
          <button
            type="button"
            className="section-title-action"
            aria-label="添加新项目"
            data-app-action-sidebar-project-create
            onClick={(event) => {
              event.stopPropagation()
              closeMenu()
              onAddProject()
            }}
          >
            <SidebarPlusIcon />
          </button>
        )}
        {sectionId === 'recent' && (
          <button
            type="button"
            className="section-title-action section-title-new-chat"
            aria-label="新聊天"
            onClick={(event) => {
              event.stopPropagation()
              closeMenu()
              onNewThread()
            }}
          >
            <SidebarComposeIcon />
          </button>
        )}
      </div>
      {menu && createPortal(menu, document.body)}
    </div>
  )
}

function Sidebar({
  threads,
  projects,
  remoteProjects,
  remoteConnections,
  selectedThreadId,
  selectedProjectId,
  selectedProjectPath,
  selectedHostId,
  loading,
  searching,
  search,
  searchSnippets,
  catalogView,
  catalogError,
  hasMore,
  loadingMore,
  pinnedThreadIds,
  unreadThreadIds,
  compactingThreadIds,
  runningThreadIds,
  onSearch,
  onToggleSearch,
  onCatalogViewChange,
  onNewThread,
  onAddProject,
  onNewThreadInProject,
  onNewThreadInRemoteProject,
  onEditSidebarProject,
  onRevealSidebarProject,
  onMarkSidebarProjectRead,
  onArchiveSidebarProject,
  onRemoveSidebarProject,
  onSelectThread,
  onLoadMore,
  onRename,
  onTogglePin,
  onToggleUnread,
  onArchive,
  onUnarchive,
  onDelete,
  onFork,
  onCompact
}: {
  threads: Thread[]
  projects: Project[]
  remoteProjects: RemoteProject[]
  remoteConnections: RemoteConnection[]
  selectedThreadId: string | null
  selectedProjectId: string | null
  selectedProjectPath: string | null
  selectedHostId: string
  loading: boolean
  searching: boolean
  search: string
  searchSnippets: Map<string, string>
  catalogView: CatalogView
  catalogError: string | null
  hasMore: boolean
  loadingMore: boolean
  pinnedThreadIds: string[]
  unreadThreadIds: string[]
  compactingThreadIds: string[]
  runningThreadIds: string[]
  onSearch(value: string): void
  onToggleSearch(): void
  onCatalogViewChange(view: CatalogView): void
  onNewThread(): void
  onAddProject(): void
  onNewThreadInProject(path: string): void
  onNewThreadInRemoteProject(hostId: string, projectId: string): void
  onEditSidebarProject(project: SidebarProjectCollection): void
  onRevealSidebarProject(project: SidebarProjectCollection): void
  onMarkSidebarProjectRead(project: SidebarProjectCollection): void
  onArchiveSidebarProject(project: SidebarProjectCollection): void
  onRemoveSidebarProject(project: SidebarProjectCollection): void
  onSelectThread(thread: Thread): void
  onLoadMore(): void
  onRename(thread: Thread): void
  onTogglePin(thread: Thread): void
  onToggleUnread(thread: Thread): void
  onArchive(thread: Thread): void
  onUnarchive(thread: Thread): void
  onDelete(thread: Thread): void
  onFork(thread: Thread): void
  onCompact(thread: Thread): void
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const recentLoadSentinelRef = useRef<HTMLDivElement | null>(null)
  const [recentRenderLimit, setRecentRenderLimit] = useState(SIDEBAR_RECENT_INITIAL_LIMIT)
  const collections = useMemo(
    () => buildSidebarCollections(
      threads,
      pinnedThreadIds,
      projects,
      remoteProjects,
      remoteConnections
    ),
    [pinnedThreadIds, projects, remoteConnections, remoteProjects, threads]
  )
  const threadProjectInfo = useMemo(() => {
    const info = new Map<string, { projectName: string; hostLabel?: string; hostColor?: string }>()
    for (const project of collections.projects) {
      for (const thread of project.threads) {
        if (!info.has(thread.id)) info.set(thread.id, {
          projectName: project.name,
          hostLabel: project.kind === 'remote' ? project.hostLabel : undefined,
          hostColor: project.kind === 'remote' ? project.hostColor : undefined
        })
      }
    }
    return info
  }, [collections.projects])
  const [collapsedSections, toggleCollapsedSection] = usePersistedSidebarList(
    SIDEBAR_COLLAPSED_SECTIONS_KEY
  )
  const [collapsedProjects, toggleCollapsedProject] = usePersistedSidebarList(
    SIDEBAR_COLLAPSED_PROJECTS_KEY
  )
  const [expandedProjects, toggleExpandedProject] = usePersistedSidebarList(
    SIDEBAR_EXPANDED_PROJECTS_KEY
  )
  const [pinnedProjects, togglePinnedProject] = usePersistedSidebarList(
    SIDEBAR_PINNED_PROJECTS_KEY
  )
  const [pinnedSortMode, setPinnedSortMode] = usePersistedSidebarOption<SidebarSortMode>(
    SIDEBAR_PINNED_SORT_KEY,
    ['recent', 'manual'],
    'manual'
  )
  const [chatSortMode, setChatSortMode] = usePersistedSidebarOption<SidebarSortMode>(
    SIDEBAR_CHAT_SORT_KEY,
    ['recent', 'manual'],
    'recent'
  )
  const [groupingMode, setGroupingMode] = usePersistedSidebarOption<SidebarGroupingMode>(
    SIDEBAR_GROUPING_KEY,
    ['project', 'host', 'combined'],
    'project'
  )
  const [showProjectsInRecent, setShowProjectsInRecent] = usePersistedSidebarBoolean(
    SIDEBAR_RECENT_PROJECTS_KEY,
    true
  )
  const [activityView, setActivityView] = useState(false)

  const projectGroups = useMemo(
    () =>
      sidebarProjectGroupsForMode(collections.projects, groupingMode).map((project) => ({
        ...project,
        threads: sortSidebarThreads(project.threads, chatSortMode)
      })),
    [chatSortMode, collections.projects, groupingMode]
  )

  const projectPreferenceMatches = (
    values: readonly string[],
    project: SidebarDisplayGroup
  ): boolean => values.includes(project.id) ||
    project.memberProjectIds?.some((projectId) => values.includes(projectId)) === true ||
    (project.kind !== 'remote' && values.includes(project.path))

  const pinnedProjectGroups = projectGroups.filter((project) =>
    projectPreferenceMatches(pinnedProjects, project)
  )
  const regularProjectGroups = projectGroups.filter(
    (project) => !projectPreferenceMatches(pinnedProjects, project)
  )
  const showStructuredCatalog = catalogView === 'active' && !search.trim() && !activityView
  const pinnedThreads = sortSidebarThreads(collections.pinned, pinnedSortMode)
  const attentionThreadIds = useMemo(
    () => new Set([...unreadThreadIds, ...runningThreadIds]),
    [runningThreadIds, unreadThreadIds]
  )
  const attentionThreads = useMemo(
    () => sortSidebarThreads(
      threads.filter((thread) => attentionThreadIds.has(thread.id)),
      'recent'
    ),
    [attentionThreadIds, threads]
  )
  const recentThreads = activityView
    ? attentionThreads
    : showStructuredCatalog
      ? sortSidebarThreads(
          recentThreadsForSidebar(
            collections.recent,
            collections.projectlessRecent,
            groupingMode === 'combined' || showProjectsInRecent
          ),
          chatSortMode
        )
      : threads
  const visibleRecentThreads = recentThreads.slice(0, recentRenderLimit)
  const canRevealMoreRecentThreads = recentRenderLimit < recentThreads.length
  const sectionIsCollapsed = (sectionId: SidebarSectionId): boolean =>
    collapsedSections.includes(sectionId)
  const normalizedSelectedProjectPath = normalizeProjectPath(selectedProjectPath)
  const hasAttentionThreads = attentionThreadIds.size > 0

  useEffect(() => {
    setRecentRenderLimit(SIDEBAR_RECENT_INITIAL_LIMIT)
  }, [catalogView, search])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = recentLoadSentinelRef.current
    if (
      !root ||
      !sentinel ||
      sectionIsCollapsed('recent') ||
      typeof IntersectionObserver === 'undefined'
    ) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (canRevealMoreRecentThreads) {
          setRecentRenderLimit((limit) =>
            Math.min(limit + SIDEBAR_RECENT_PAGE_SIZE, recentThreads.length)
          )
          return
        }
        if (hasMore && !loadingMore) onLoadMore()
      },
      { root, threshold: 0.01 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [
    canRevealMoreRecentThreads,
    hasMore,
    loadingMore,
    onLoadMore,
    recentThreads.length,
    recentRenderLimit,
    sectionIsCollapsed('recent')
  ])

  const renderThreadRow = (
    thread: Thread,
    prefix: string,
    leadingIcon = false
  ): ReactNode => {
    const projectInfo = threadProjectInfo.get(thread.id)
    return <ThreadRow
      key={`${prefix}-${thread.id}-${thread.updatedAt}`}
      thread={thread}
      leadingIcon={leadingIcon}
      active={thread.id === selectedThreadId}
      archived={catalogView === 'archived'}
      pinned={pinnedThreadIds.includes(thread.id)}
      unread={unreadThreadIds.includes(thread.id)}
      compacting={compactingThreadIds.includes(thread.id)}
      running={runningThreadIds.includes(thread.id)}
      snippet={searchSnippets.get(thread.id)}
      projectName={projectInfo?.projectName}
      hostLabel={projectInfo?.hostLabel}
      hostColor={projectInfo?.hostColor}
      onClick={() => onSelectThread(thread)}
      onRename={() => onRename(thread)}
      onTogglePin={() => onTogglePin(thread)}
      onToggleUnread={() => onToggleUnread(thread)}
      onArchive={() => onArchive(thread)}
      onUnarchive={() => onUnarchive(thread)}
      onDelete={() => onDelete(thread)}
      onFork={() => onFork(thread)}
      onCompact={() => onCompact(thread)}
    />
  }

  const renderProjectGroup = (
    project: SidebarDisplayGroup,
    sectionId: SidebarSectionId
  ): ReactNode => {
    const preferenceAliases = [
      ...(project.memberProjectIds || []),
      ...(project.kind === 'remote' ? [] : [project.path])
    ]
    const selectedProjectMatches = Boolean(
      selectedProjectId && (
        selectedProjectId === project.projectId ||
        selectedProjectId === project.id ||
        project.memberProjectIds?.includes(selectedProjectId)
      )
    )
    return <SidebarProjectGroup
      key={`${sectionId}-${project.id}`}
      project={project}
      active={
        project.kind === 'remote'
          ? selectedHostId === project.hostId && (
              selectedProjectMatches ||
              Boolean(
                normalizedSelectedProjectPath &&
                project.roots.some((root) => normalizeProjectPath(root) === normalizedSelectedProjectPath)
              )
            )
          : selectedHostId === 'local' && (
              selectedProjectMatches ||
              Boolean(
                normalizedSelectedProjectPath &&
                project.roots.some((root) => normalizeProjectPath(root) === normalizedSelectedProjectPath)
              )
            )
      }
      collapsed={
        projectPreferenceMatches(collapsedProjects, project)
      }
      expanded={
        projectPreferenceMatches(expandedProjects, project)
      }
      pinned={projectPreferenceMatches(pinnedProjects, project)}
      hasUnread={project.threads.some((thread) => unreadThreadIds.includes(thread.id))}
      onToggleCollapsed={() => toggleCollapsedProject(project.id, preferenceAliases)}
      onToggleExpanded={() => toggleExpandedProject(project.id, preferenceAliases)}
      onTogglePinned={() => togglePinnedProject(project.id, preferenceAliases)}
      onEditProject={project.kind === 'remote' ? undefined : () => onEditSidebarProject(project)}
      onRevealProject={project.kind === 'remote' ? undefined : () => onRevealSidebarProject(project)}
      onMarkAllRead={() => onMarkSidebarProjectRead(project)}
      onArchiveThreads={() => onArchiveSidebarProject(project)}
      onRemoveProject={project.kind === 'remote' ? undefined : () => onRemoveSidebarProject(project)}
      onNewThread={() => {
        if (project.groupingKind === 'connection') {
          onNewThread()
          return
        }
        if (project.kind === 'remote' && project.hostId && project.projectId) {
          onNewThreadInRemoteProject(project.hostId, project.projectId)
        } else {
          onNewThreadInProject(project.path)
        }
      }}
      renderThread={(thread) => renderThreadRow(thread, `${sectionId}-${project.id}`)}
    />
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-heading-row">
          <button
            type="button"
            className="sidebar-workspace-menu"
            aria-label={catalogView === 'archived' ? '切换模式，当前模式：已归档' : '切换模式，当前模式：Codex'}
            onClick={() => {
              setActivityView(false)
              onCatalogViewChange(catalogView === 'active' ? 'archived' : 'active')
            }}
          >
            {catalogView === 'archived' ? <span>已归档</span> : <CodexWordmark />}
            <SidebarModeChevronIcon />
          </button>
          <div className="sidebar-heading-actions">
            <button
              className={`quiet-icon-button notification-button${activityView ? ' active' : ''}`}
              aria-label={
                activityView
                  ? '关闭活动视图'
                  : hasAttentionThreads
                    ? '查看活动，有聊天需要关注'
                    : '查看活动'
              }
              aria-pressed={activityView}
              onClick={() => {
                if (catalogView === 'archived') onCatalogViewChange('active')
                if (searching) {
                  onSearch('')
                  onToggleSearch()
                }
                setActivityView((active) => !active)
              }}
            >
              <SidebarActivityIcon attention={hasAttentionThreads} />
            </button>
            <button
              className="quiet-icon-button"
              onClick={() => {
                setActivityView(false)
                onToggleSearch()
              }}
              aria-label="搜索"
            >
              <SidebarSearchIcon />
            </button>
          </div>
        </div>
        <button className="new-thread-button" onClick={onNewThread}>
          <SidebarComposeIcon />
          <span>新聊天</span>
        </button>
        {searching && (
          <div className="sidebar-search">
            <SidebarSearchIcon />
            <input
              autoFocus
              value={search}
              placeholder="搜索聊天"
              onChange={(event) => onSearch(event.target.value)}
              aria-label="搜索聊天"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onSearch('')
                  onToggleSearch()
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const rows = scrollRef.current?.querySelectorAll<HTMLButtonElement>('.thread-row')
                  if (!rows?.length) return
                  event.preventDefault()
                  rows[event.key === 'ArrowDown' ? 0 : rows.length - 1].focus()
                }
              }}
            />
          </div>
        )}
      </div>

      <div
        className="sidebar-scroll"
        ref={scrollRef}
        data-app-action-sidebar-scroll
        data-app-action-sidebar-grouping={groupingMode}
      >
        {showStructuredCatalog &&
          (collections.pinned.length > 0 || pinnedProjectGroups.length > 0) && (
            <SidebarSection
              sectionId="pinned"
              title="置顶"
              collapsed={sectionIsCollapsed('pinned')}
              onCollapsedChange={() => toggleCollapsedSection('pinned')}
              actions={
                <SidebarSectionActions
                  sectionId="pinned"
                  pinnedSortMode={pinnedSortMode}
                  chatSortMode={chatSortMode}
                  groupingMode={groupingMode}
                  showProjectsInRecent={showProjectsInRecent}
                  onPinnedSortModeChange={setPinnedSortMode}
                  onChatSortModeChange={setChatSortMode}
                  onGroupingModeChange={setGroupingMode}
                  onShowProjectsInRecentChange={setShowProjectsInRecent}
                  onAddProject={onAddProject}
                  onNewThread={onNewThread}
                />
              }
            >
              {pinnedThreads.map((thread) => renderThreadRow(thread, 'pinned', true))}
              {pinnedProjectGroups.map((project) => renderProjectGroup(project, 'pinned'))}
            </SidebarSection>
          )}

        {showStructuredCatalog && projectGroups.length > 0 && (
          <SidebarSection
            sectionId="projects"
            title="项目"
            collapsed={sectionIsCollapsed('projects')}
            onCollapsedChange={() => toggleCollapsedSection('projects')}
            actions={
              <SidebarSectionActions
                sectionId="projects"
                pinnedSortMode={pinnedSortMode}
                chatSortMode={chatSortMode}
                groupingMode={groupingMode}
                showProjectsInRecent={showProjectsInRecent}
                onPinnedSortModeChange={setPinnedSortMode}
                onChatSortModeChange={setChatSortMode}
                onGroupingModeChange={setGroupingMode}
                onShowProjectsInRecentChange={setShowProjectsInRecent}
                onAddProject={onAddProject}
                onNewThread={onNewThread}
              />
            }
          >
            {regularProjectGroups.map((project) => renderProjectGroup(project, 'projects'))}
          </SidebarSection>
        )}

        <SidebarSection
          sectionId="recent"
          title={activityView ? '活动' : catalogView === 'archived' ? '已归档' : '最近'}
          collapsed={sectionIsCollapsed('recent')}
          onCollapsedChange={() => toggleCollapsedSection('recent')}
          actions={
            catalogView === 'active' && !activityView ? (
              <SidebarSectionActions
                sectionId="recent"
                pinnedSortMode={pinnedSortMode}
                chatSortMode={chatSortMode}
                groupingMode={groupingMode}
                showProjectsInRecent={showProjectsInRecent}
                onPinnedSortModeChange={setPinnedSortMode}
                onChatSortModeChange={setChatSortMode}
                onGroupingModeChange={setGroupingMode}
                onShowProjectsInRecentChange={setShowProjectsInRecent}
                onAddProject={onAddProject}
                onNewThread={onNewThread}
              />
            ) : null
          }
        >
          {loading ? <SidebarSkeleton /> : recentThreads.length ? (
            visibleRecentThreads.map((thread) => renderThreadRow(thread, 'recent'))
          ) : showStructuredCatalog ? null : (
            <div className="sidebar-empty">
              {activityView
                ? hasAttentionThreads
                  ? '部分未读聊天尚不可用'
                  : '暂无需要关注的聊天'
                : '没有匹配的聊天'}
            </div>
          )}
          {catalogError && <div className="sidebar-catalog-error" role="alert">{catalogError}</div>}
          {!activityView && (canRevealMoreRecentThreads || hasMore) && (
            <div
              ref={recentLoadSentinelRef}
              className="sidebar-load-sentinel"
              aria-hidden="true"
              data-app-action-sidebar-load-sentinel
            />
          )}
        </SidebarSection>
      </div>
    </aside>
  )
}

function SidebarSection({
  sectionId,
  title,
  actions = null,
  collapsed,
  onCollapsedChange,
  children
}: {
  sectionId: SidebarSectionId
  title: string
  actions?: ReactNode | null
  collapsed: boolean
  onCollapsedChange(): void
  children: ReactNode
}): ReactNode {
  return (
    <section
      className="sidebar-section"
      data-app-action-sidebar-section
      data-app-action-sidebar-section-heading={
        sectionId === 'pinned' ? 'Pinned' : sectionId === 'projects' ? 'Projects' : 'Recents'
      }
      data-app-action-sidebar-section-collapsed={String(collapsed)}
    >
      <div className="section-title">
        <button
          type="button"
          className="section-title-toggle"
          data-app-action-sidebar-section-toggle
          aria-expanded={!collapsed}
          onClick={onCollapsedChange}
        >
          <span>{title}</span>
          <SidebarDisclosureIcon className={collapsed ? '' : 'is-expanded'} />
        </button>
        {actions}
      </div>
      {!collapsed && <div className="sidebar-section-content">{children}</div>}
    </section>
  )
}

function SidebarPortalMenu({
  triggerRef,
  id,
  ariaLabelledBy,
  className,
  onClose,
  children
}: {
  triggerRef: RefObject<HTMLButtonElement | null>
  id?: string
  ariaLabelledBy?: string
  className: string
  onClose(): void
  children: ReactNode
}): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({visibility: 'hidden'})

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const anchor = trigger.getBoundingClientRect()
    const box = menu.getBoundingClientRect()
    const gutter = 8
    const below = window.innerHeight - anchor.bottom - gutter
    setStyle({
      position: 'fixed',
      top: below >= box.height ? anchor.bottom + 5 : Math.max(gutter, anchor.top - box.height - 5),
      left: Math.max(gutter, Math.min(anchor.left + 1, window.innerWidth - box.width - gutter)),
      right: 'auto',
      visibility: 'visible'
    })
  }, [triggerRef])

  useLayoutEffect(() => {
    if (style.visibility === 'hidden') return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll: true})
  }, [style.visibility])

  useEffect(() => {
    const close = (): void => onClose()
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      className={`thread-row-menu ${className}`}
      role="menu"
      aria-labelledby={ariaLabelledBy}
      data-state="open"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
        if (!items.length) return
        event.preventDefault()
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus({preventScroll: true})
      }}
    >
      {children}
    </div>,
    document.body
  )
}

function SidebarProjectGroup({
  project,
  active,
  collapsed,
  expanded,
  pinned,
  hasUnread,
  onToggleCollapsed,
  onToggleExpanded,
  onTogglePinned,
  onNewThread,
  onEditProject,
  onRevealProject,
  onMarkAllRead,
  onArchiveThreads,
  onRemoveProject,
  renderThread
}: {
  project: SidebarProjectCollection
  active: boolean
  collapsed: boolean
  expanded: boolean
  pinned: boolean
  hasUnread: boolean
  onToggleCollapsed(): void
  onToggleExpanded(): void
  onTogglePinned(): void
  onNewThread(): void
  onEditProject?(): void
  onRevealProject?(): void
  onMarkAllRead?(): void
  onArchiveThreads?(): void
  onRemoveProject?(): void
  renderThread(thread: Thread): ReactNode
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const menuTriggerId = `${menuId}-trigger`
  const label = project.name
  const visibleThreads = projectThreadsForDisplay(project.threads, expanded)
  const projectSummary = project.kind === 'remote' && project.hostLabel
    ? `${project.hostLabel} · ${project.threads.length} 次聊天`
    : `${project.threads.length} 次聊天`

  useEffect(() => {
    if (!menuOpen) return
    const close = (): void => setMenuOpen(false)
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
      requestAnimationFrame(() => menuTriggerRef.current?.focus({preventScroll: true}))
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const run = (action?: () => void): void => {
    setMenuOpen(false)
    action?.()
  }

  return (
    <div
      className={`sidebar-project-group${menuOpen ? ' menu-open' : ''}`}
      data-app-action-sidebar-project-list-id={project.projectId || project.id}
      data-app-action-sidebar-project-root={project.path}
      data-app-action-sidebar-project-kind={project.kind || 'local'}
      data-app-action-sidebar-project-host={project.hostId}
    >
      <SidebarHoverCard
        className="sidebar-project-row-wrap"
        disabled={menuOpen}
        cardClassName="sidebar-project-hover-card"
        content={<div className="sidebar-project-hover-card-copy">
          <div className="sidebar-project-hover-card-main">
            <div className="sidebar-project-hover-card-row is-title">
              <span className="sidebar-hover-card-leading">
                {project.kind === 'remote'
                  ? <SidebarRemoteFolderIcon globeColor={project.hostColor || '#12bde8'} />
                  : <SidebarFolderIcon />}
              </span>
              <span className="sidebar-project-hover-card-title">
                <button type="button" onClick={onToggleCollapsed}>{label}</button>
              </span>
              <button
                type="button"
                className="sidebar-project-hover-card-pin"
                aria-label={pinned ? '取消置顶项目' : '置顶项目'}
                onClick={onTogglePinned}
              >
                {pinned ? <SidebarUnpinIcon /> : <SidebarPinIcon />}
              </button>
            </div>
            <div className="sidebar-project-hover-card-row">
              <span className="sidebar-hover-card-leading">
                {project.kind === 'remote'
                  ? <SidebarRemoteGlobeIcon color={project.hostColor || '#12bde8'} />
                  : <SidebarChatIcon />}
              </span>
              <span className="sidebar-project-hover-card-stat">{projectSummary}</span>
            </div>
          </div>
          <div className="sidebar-project-hover-card-section">
            <button
              type="button"
              className="sidebar-project-hover-card-row is-path"
              disabled={!onRevealProject}
              aria-label={`打开 ${abbreviatedSidebarPath(project.path)}`}
              onClick={onRevealProject}
            >
              <span className="sidebar-hover-card-leading"><SidebarFolderIcon /></span>
              <span className="sidebar-project-hover-card-path">{abbreviatedSidebarPath(project.path)}</span>
              {onRevealProject && <span className="sidebar-project-hover-card-external"><ExternalLink /></span>}
            </button>
          </div>
          {onEditProject && <div className="sidebar-project-hover-card-section">
            <button type="button" className="sidebar-project-hover-card-row is-action" onClick={onEditProject}>
              <span className="sidebar-hover-card-leading"><Settings /></span>
              <span>编辑项目</span>
            </button>
          </div>}
        </div>}
      >
        <button
          type="button"
          className={`sidebar-project-heading${active ? ' active' : ''}`}
          aria-current={active ? 'page' : undefined}
          aria-expanded={!collapsed}
          data-app-action-sidebar-project-row
          data-app-action-sidebar-project-collapsed={String(collapsed)}
          data-app-action-sidebar-project-id={project.projectId || project.id}
          data-app-action-sidebar-project-label={label}
          onClick={onToggleCollapsed}
        >
          {project.kind === 'remote'
            ? <SidebarRemoteFolderIcon globeColor={project.hostColor || '#12bde8'} />
            : <SidebarFolderIcon />}
          <span className="sidebar-project-label"><SidebarMarqueeText>{label}</SidebarMarqueeText></span>
          {project.kind === 'remote' && (
            <span className="sidebar-project-host-meta">
              <span className="sidebar-project-host-label">{project.hostLabel}</span>
              <span
                className="sidebar-project-host-status"
                data-state={project.hostState || 'disconnected'}
                role="img"
                aria-label={remoteConnectionStateLabel(project.hostState || 'disconnected')}
              />
            </span>
          )}
        </button>
        <div className="sidebar-project-hover-actions">
          <button
              ref={menuTriggerRef}
              id={menuTriggerId}
              type="button"
              aria-label={`${label} 的项目操作`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              data-state={menuOpen ? 'open' : 'closed'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen((open) => !open)
              }}
            >
              <SidebarMoreIcon />
            </button>
          <button
              type="button"
              aria-label={`在 ${label} 中开始新聊天`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onNewThread()
              }}
            >
              <SidebarProjectNewIcon />
            </button>
        </div>
        {menuOpen && (
          <SidebarPortalMenu
            triggerRef={menuTriggerRef}
            id={menuId}
            ariaLabelledBy={menuTriggerId}
            className="sidebar-project-menu"
            onClose={() => setMenuOpen(false)}
          >
            <button type="button" role="menuitem" onClick={() => run(onTogglePinned)}>{pinned ? <PinOff /> : <Pin />}{pinned ? '取消置顶' : '置顶'}</button>
            {onEditProject && <button type="button" role="menuitem" onClick={() => run(onEditProject)}><Pencil />编辑</button>}
            {onRevealProject && <><div className="thread-row-menu-separator" /><button type="button" role="menuitem" onClick={() => run(onRevealProject)}><Folder />在 Finder 中显示</button></>}
            {(onMarkAllRead || onArchiveThreads) && <div className="thread-row-menu-separator" />}
            {onMarkAllRead && <button type="button" role="menuitem" disabled={!hasUnread} onClick={() => run(onMarkAllRead)}><Check />全部标为已读</button>}
            {onArchiveThreads && <button type="button" role="menuitem" disabled={!project.threads.length} onClick={() => run(onArchiveThreads)}><Archive />归档聊天</button>}
            {onRemoveProject && <><div className="thread-row-menu-separator" /><button type="button" role="menuitem" onClick={() => run(onRemoveProject)}><Trash2 />移除项目</button></>}
          </SidebarPortalMenu>
        )}
      </SidebarHoverCard>
      {!collapsed && project.threads.length > 0 && (
        <div className="sidebar-project-threads">
          {visibleThreads.map(renderThread)}
          {project.threads.length > SIDEBAR_PROJECT_PREVIEW_LIMIT && (
            <button type="button" className="sidebar-expand" onClick={onToggleExpanded}>
              {expanded ? '收起显示' : '展开显示'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ThreadRow({
  thread,
  leadingIcon,
  active,
  archived,
  pinned,
  unread,
  compacting,
  running,
  snippet,
  projectName,
  hostLabel,
  hostColor,
  onClick,
  onRename,
  onTogglePin,
  onToggleUnread,
  onArchive,
  onUnarchive,
  onDelete,
  onFork,
  onCompact
}: {
  thread: Thread
  leadingIcon: boolean
  active: boolean
  archived: boolean
  pinned: boolean
  unread: boolean
  compacting: boolean
  running: boolean
  snippet?: string
  projectName?: string
  hostLabel?: string
  hostColor?: string
  onClick(): void
  onRename(): void
  onTogglePin(): void
  onToggleUnread(): void
  onArchive(): void
  onUnarchive(): void
  onDelete(): void
  onFork(): void
  onCompact(): void
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const pinActionLabel = pinned ? '取消置顶聊天' : '置顶聊天'
  const loading = running || threadHasActiveSidebarTurn(thread)
  const title = titleForThread(thread)

  useEffect(() => {
    if (!menuOpen) return
    const close = (): void => setMenuOpen(false)
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const run = (action: () => void): void => {
    setMenuOpen(false)
    action()
  }

  return (
    <SidebarHoverCard
      className={`thread-row-wrap${menuOpen ? ' menu-open' : ''}${snippet ? ' has-snippet' : ''}`}
      disabled={menuOpen}
      content={<div className="sidebar-thread-hover-card-copy">
        <div className="sidebar-thread-hover-card-header">
          <div className="sidebar-thread-hover-card-title-wrap">
            <button type="button" className="sidebar-thread-hover-card-title" onClick={onClick}>{title}</button>
            <span className="sidebar-thread-hover-card-host-icon" aria-hidden="true">
              {hostLabel
                ? <SidebarRemoteGlobeIcon color={hostColor || '#12bde8'} />
                : <TerminalSquare />}
            </span>
          </div>
          <time>{sidebarRelativeTimeLabel(thread.recencyAt || thread.updatedAt)}</time>
        </div>
        <div className="sidebar-thread-hover-card-detail">
          <span className="sidebar-hover-card-leading">
            {hostLabel
              ? <SidebarRemoteFolderIcon globeColor={hostColor || '#12bde8'} />
              : <SidebarFolderIcon />}
          </span>
          <span>{projectName || compactPath(thread.cwd)}</span>
        </div>
        {hostLabel && <div className="sidebar-thread-hover-card-detail">
          <span className="sidebar-hover-card-leading">
            <SidebarRemoteGlobeIcon color={hostColor || '#12bde8'} />
          </span>
          <span>{hostLabel}</span>
        </div>}
      </div>}
      onContextMenu={(event) => {
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(true)
      }}
    >
      <button
        className={`thread-row${active ? ' active' : ''}${leadingIcon ? ' has-leading-icon' : ''}`}
        data-app-action-sidebar-thread-row
        data-app-action-sidebar-thread-active={String(loading)}
        data-app-action-sidebar-thread-pinned={String(pinned)}
        data-app-action-sidebar-thread-selected={String(active)}
        aria-label={title}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const rows = [...(event.currentTarget.closest('.sidebar-scroll')
            ?.querySelectorAll<HTMLButtonElement>('.thread-row') || [])]
          const index = rows.indexOf(event.currentTarget)
          if (index < 0 || !rows.length) return
          event.preventDefault()
          rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus()
        }}
      >
        {leadingIcon && (
          <div className="thread-row-icon">
            <SidebarChatIcon />
          </div>
        )}
        {unread && <span className="thread-unread-dot" aria-label="Unread" />}
        <div className="thread-row-copy">
          <SidebarMarqueeText>{title}</SidebarMarqueeText>
          <small>{snippet || compactPath(thread.cwd)}</small>
        </div>
        {pinned && <Pin className="thread-row-pin" aria-label="Pinned" />}
        {loading && <SidebarLoadingIndicator />}
        <time>{timeLabel(thread.recencyAt || thread.updatedAt)}</time>
      </button>
      {!archived && (
        <div className="thread-row-hover-actions">
          <SidebarTooltip content={pinActionLabel}><button
              type="button"
              aria-label={pinActionLabel}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onTogglePin()
              }}
            >
              {pinned ? <SidebarUnpinIcon /> : <SidebarPinIcon />}
            </button></SidebarTooltip>
          <SidebarTooltip content="归档聊天"><button
              type="button"
              aria-label="归档聊天"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onArchive()
              }}
            >
              <SidebarArchiveIcon />
            </button></SidebarTooltip>
        </div>
      )}
      {menuOpen && (
        <div className="thread-row-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
          {!archived && (
            <button type="button" role="menuitem" onClick={() => run(onTogglePin)}>
              {pinned ? <PinOff /> : <Pin />}{pinned ? '取消置顶' : '置顶'}
            </button>
          )}
          {!archived && (
            <button type="button" role="menuitem" onClick={() => run(onToggleUnread)}>
              <MessageSquare />{unread ? '标为已读' : '标为未读'}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => run(onRename)}>
            <SquarePen />重命名
          </button>
          {!archived && (
            <button type="button" role="menuitem" onClick={() => run(onFork)}>
              <GitFork />派生聊天
            </button>
          )}
          {!archived && (
            <button type="button" role="menuitem" disabled={compacting} onClick={() => run(onCompact)}>
              <Sparkles />{compacting ? '正在压缩…' : '压缩对话'}
            </button>
          )}
          {archived ? (
            <button type="button" role="menuitem" onClick={() => run(onUnarchive)}>
              <Archive />恢复聊天
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={() => run(onArchive)}>
              <Archive />归档聊天
            </button>
          )}
          <div className="thread-row-menu-separator" />
          <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>
            <Trash2 />删除…
          </button>
        </div>
      )}
    </SidebarHoverCard>
  )
}

function SidebarSkeleton(): ReactNode {
  return (
    <div className="sidebar-skeleton" aria-label="Loading chats">
      {[0, 1, 2, 3].map((item) => (
        <span key={item} />
      ))}
    </div>
  )
}

function Conversation({
  thread,
  session,
  interruptedTurnIds,
  completedGoal = null,
  completedGoalTurnId = null,
  starting,
  thinking,
  pendingUserMessage,
  workspaceName,
  workspaceCwd = null,
  onPickWorkspace,
  hydrating,
  historyError,
  hasEarlier,
  loadingEarlier,
  loaded,
  writerReady = false,
  onLoadEarlier,
  onRevert,
  onFork
}: {
  thread: Thread | undefined
  session: ThreadSession | undefined
  interruptedTurnIds?: ReadonlySet<string>
  completedGoal?: ThreadGoal | null
  completedGoalTurnId?: string | null
  starting: boolean
  thinking: boolean
  pendingUserMessage: ThreadItem | null
  workspaceName: string
  workspaceCwd?: string | null
  onPickWorkspace?(): void
  hydrating: boolean
  historyError: string | null
  hasEarlier: boolean
  loadingEarlier: boolean
  loaded: boolean
  writerReady?: boolean
  onLoadEarlier(): void
  onRevert(turnId: string): void
  onFork?(turnId: string): void
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followLatestRef = useRef(true)
  const [scrolledFromBottom, setScrolledFromBottom] = useState(false)
  const earlierMetricsRef = useRef<{
    firstTurnId: string | null
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const turns = session?.turns || []
  const latestUser = latestUserTurnTarget(turns)
  const revertReason = thread
    ? revertDisabledReason(thread, { loaded, writable: writerReady, running: Boolean(session?.running) })
    : null

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const metrics = earlierMetricsRef.current
    if (!scroll) return
    if (metrics) {
      const firstTurnId = turns[0]?.id || null
      if (firstTurnId !== metrics.firstTurnId) {
        scroll.scrollTop = metrics.scrollTop + (scroll.scrollHeight - metrics.scrollHeight)
        earlierMetricsRef.current = null
        followLatestRef.current = conversationIsAtBottom(scroll)
        setScrolledFromBottom(!followLatestRef.current)
      } else if (!loadingEarlier) {
        earlierMetricsRef.current = null
      }
      return
    }
    if (followLatestRef.current) {
      scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
      setScrolledFromBottom(false)
    }
  }, [loadingEarlier, turns])

  useEffect(() => {
    earlierMetricsRef.current = null
    followLatestRef.current = true
    setScrolledFromBottom(false)
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current
      if (scroll) scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    })
    return () => cancelAnimationFrame(frame)
  }, [thread?.id])

  const updateScrollPosition = (): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    const atBottom = conversationIsAtBottom(scroll)
    followLatestRef.current = atBottom
    setScrolledFromBottom(!atBottom)
  }

  useEffect(() => {
    const scroll = scrollRef.current
    const content = scroll?.firstElementChild
    if (!scroll || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const atBottom = conversationIsAtBottom(scroll)
      followLatestRef.current = atBottom
      setScrolledFromBottom(!atBottom)
    })
    observer.observe(scroll)
    observer.observe(content)
    return () => observer.disconnect()
  }, [thread?.id, hydrating])

  const scrollToLatest = (): void => {
    followLatestRef.current = true
    const scroll = scrollRef.current
    if (scroll) scroll.scrollTo({ top: Math.max(0, scroll.scrollHeight - scroll.clientHeight), behavior: 'smooth' })
  }

  const loadEarlier = (): void => {
    const scroll = scrollRef.current
    if (scroll) {
      earlierMetricsRef.current = {
        firstTurnId: turns[0]?.id || null,
        scrollHeight: scroll.scrollHeight,
        scrollTop: scroll.scrollTop
      }
    }
    onLoadEarlier()
  }

  if (!thread && pendingUserMessage) {
    return (
      <div className="conversation-scroll thread-scroll-container" ref={scrollRef} role="region" aria-label="对话">
        <div className="conversation-content conversation-pending-start">
          <TimelineItem item={pendingUserMessage} />
          <div className="turn-start-status" data-phase="starting" role="status">
            <CadencedShimmer>正在开启聊天</CadencedShimmer>
          </div>
        </div>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="conversation-scroll thread-scroll-container" ref={scrollRef} role="region" aria-label="对话">
        <div className="conversation-content is-empty">
          <div className="empty-conversation">
            <CodexWelcomeMark />
            <EmptyConversationProjectHero cwd={workspaceCwd} workspaceName={workspaceName} onPickProject={onPickWorkspace} />
          </div>
        </div>
      </div>
    )
  }

  if (hydrating && !session) {
    return (
      <div className="conversation-scroll thread-scroll-container" ref={scrollRef} role="region" aria-label="对话">
        <div className="conversation-content is-loading">
          <div className="conversation-loading">
            <LoaderCircle className="spin" />
            <span>正在打开聊天…</span>
          </div>
        </div>
      </div>
    )
  }

  const resolvedCompletedGoalTurnId = completedGoalTurnId || (
    completedGoal
      ? turns.findLast((turn) => threadGoalMatchesCompletedAt(completedGoal, turn.completedAt))?.id || null
      : null
  )
  const conversationNowMs = Date.now()

  return (
    <>
      <div
        className="conversation-scroll thread-scroll-container"
        ref={scrollRef}
        role="region"
        aria-label="对话"
        onScroll={updateScrollPosition}
      >
        <div className="conversation-content">
        {hasEarlier && (
          <button
            type="button"
            className="history-load-earlier"
            disabled={loadingEarlier}
            onClick={loadEarlier}
          >
            {loadingEarlier ? <LoaderCircle className="spin" /> : null}
            {loadingEarlier ? '正在加载较早内容…' : '加载较早内容'}
          </button>
        )}
        {historyError && (
          <div className="history-error" role="status">
            <CircleAlert />
            <span>{historyError}</span>
          </div>
        )}
        {turns.map((turn, index) => (
          <TurnBlock
            key={turn.id}
            turn={turn}
            timestampSeparatorAtMs={conversationTimestampSeparatorAt(
              turn,
              index > 0 ? turns[index - 1] : null,
              conversationNowMs,
              index === 0 && !hasEarlier
            )}
            active={Boolean(
              session?.activeTurnId === turn.id ||
                (!session?.activeTurnId && turn.status === 'inProgress')
            )}
            interruptedByThisClient={interruptedTurnIds?.has(turn.id) === true}
            latestUserItemId={latestUser?.turnId === turn.id ? latestUser.itemId : null}
            revertReason={revertReason}
            starting={starting && index === turns.length - 1}
            thinking={thinking && index === turns.length - 1}
            completedGoal={
              completedGoal &&
              (resolvedCompletedGoalTurnId
                ? turn.id === resolvedCompletedGoalTurnId
                : index === turns.length - 1)
                ? completedGoal
                : null
            }
            onRevert={() => onRevert(turn.id)}
            onFork={onFork}
          />
        ))}
        {session?.error && (
          <div className="turn-error">
            <CircleAlert />
            <span>{session.error}</span>
          </div>
        )}
        </div>
      </div>
      <button
        type="button"
        className={`scroll-to-latest${session?.running ? ' is-working' : ''}`}
        aria-label="Scroll to bottom"
        title="Scroll to bottom"
        hidden={!scrolledFromBottom}
        onClick={scrollToLatest}
      >
        <ArrowDown />
      </button>
    </>
  )
}

function CodexWelcomeMark(): ReactNode {
  return (
    <div className="welcome-mark" aria-hidden="true">
      <svg viewBox="149 149 418 418" fill="none" xmlns="http://www.w3.org/2000/svg">
        <mask id="codex-welcome-mark-inside" maskUnits="userSpaceOnUse" x="149" y="149" width="418" height="418">
          <path
            fill="#fff"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M247.429 247.43C257.73 208.911 292.871 180.543 334.638 180.543C359.555 180.543 382.115 190.64 398.449 206.964C405.906 204.97 413.743 203.905 421.829 203.905C471.681 203.906 512.096 244.32 512.096 294.173C512.096 302.259 511.031 310.096 509.037 317.553C525.361 333.887 535.458 356.446 535.458 381.364C535.458 423.131 507.09 458.271 468.571 468.572C458.271 507.091 423.131 535.459 381.364 535.459C356.446 535.459 333.886 525.362 317.552 509.037C310.095 511.031 302.258 512.097 294.172 512.097C244.319 512.097 203.906 471.682 203.906 421.829C203.906 413.743 204.969 405.905 206.963 398.448C190.639 382.115 180.543 359.555 180.543 334.638C180.543 292.871 208.91 257.73 247.429 247.43Z"
          />
        </mask>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M247.429 247.43C257.73 208.911 292.871 180.543 334.638 180.543C359.555 180.543 382.115 190.64 398.449 206.964C405.906 204.97 413.743 203.905 421.829 203.905C471.681 203.906 512.096 244.32 512.096 294.173C512.096 302.259 511.031 310.096 509.037 317.553C525.361 333.887 535.458 356.446 535.458 381.364C535.458 423.131 507.09 458.271 468.571 468.572C458.271 507.091 423.131 535.459 381.364 535.459C356.446 535.459 333.886 525.362 317.552 509.037C310.095 511.031 302.258 512.097 294.172 512.097C244.319 512.097 203.906 471.682 203.906 421.829C203.906 413.743 204.969 405.905 206.963 398.448C190.639 382.115 180.543 359.555 180.543 334.638C180.543 292.871 208.91 257.73 247.429 247.43Z"
          stroke="currentColor"
          strokeWidth="41.162"
          strokeLinejoin="round"
          mask="url(#codex-welcome-mark-inside)"
        />
        <path
          d="M436.706 408.738H370.021"
          stroke="currentColor"
          strokeWidth="24"
          strokeLinecap="round"
        />
        <path
          d="M276.533 309.154L303.468 357.831C304.433 359.575 304.412 361.698 303.414 363.423L276.533 409.854"
          stroke="currentColor"
          strokeWidth="24"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

const CONVERSATION_TIMESTAMP_GAP_MS = 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000

export function conversationTimestampMilliseconds(timestamp: number | null | undefined): number | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null
  if (timestamp > 10_000_000_000) return timestamp
  if (timestamp > 1_000_000_000) return timestamp * 1_000
  return null
}

function localCalendarDayDifference(laterAtMs: number, earlierAtMs: number): number {
  const later = new Date(laterAtMs)
  const earlier = new Date(earlierAtMs)
  return (
    Date.UTC(later.getFullYear(), later.getMonth(), later.getDate()) -
    Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate())
  ) / DAY_MS
}

function conversationTimestampSeparatorParts(
  sentAtMs: number,
  nowMs: number,
  locale: string
): { date: string; time: string } {
  const sentAt = new Date(sentAtMs)
  const daysAgo = Math.max(0, localCalendarDayDifference(nowMs, sentAtMs))
  let date: string
  if (daysAgo <= 1) {
    date = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-daysAgo, 'day')
    if (locale.startsWith('en')) date = date.charAt(0).toUpperCase() + date.slice(1)
  } else if (daysAgo <= 7) {
    date = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(sentAt)
  } else if (daysAgo <= 365) {
    date = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    }).format(sentAt)
  } else {
    date = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(sentAt)
  }
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(sentAt)
  return { date, time }
}

export function formatConversationTimestampSeparator(
  sentAtMs: number,
  nowMs = Date.now(),
  locale = 'zh-CN'
): string {
  const { date, time } = conversationTimestampSeparatorParts(sentAtMs, nowMs, locale)
  return `${date} ${time}`
}

export function formatUserMessageSentAt(
  sentAtMs: number,
  nowMs = Date.now(),
  locale = 'zh-CN'
): string {
  const sentAt = new Date(sentAtMs)
  const dayDifference = localCalendarDayDifference(sentAtMs, nowMs)
  const base: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit'
  }
  if (dayDifference === 0) {
    return new Intl.DateTimeFormat(locale, base).format(sentAt)
  }
  if (dayDifference < 0 && dayDifference > -7) {
    return new Intl.DateTimeFormat(locale, { ...base, weekday: 'long' }).format(sentAt)
  }
  return new Intl.DateTimeFormat(locale, {
    ...base,
    month: 'short',
    day: 'numeric'
  }).format(sentAt)
}

export function conversationTimestampSeparatorAt(
  turn: Turn,
  previousTurn: Turn | null,
  nowMs = Date.now(),
  isFirstUserTurn = previousTurn === null
): number | null {
  if (!turn.items.some((item) => item.type === 'userMessage')) return null
  const sentAtMs = conversationTimestampMilliseconds(turn.startedAt)
  if (sentAtMs === null) return null
  if (isFirstUserTurn) {
    return nowMs - sentAtMs > CONVERSATION_TIMESTAMP_GAP_MS ? sentAtMs : null
  }
  if (previousTurn === null) return null
  if (!previousTurn.items.some((item) => item.type === 'agentMessage')) return null
  const previousAtMs = conversationTimestampMilliseconds(
    previousTurn.completedAt ?? previousTurn.startedAt
  )
  return previousAtMs !== null && sentAtMs - previousAtMs > CONVERSATION_TIMESTAMP_GAP_MS
    ? sentAtMs
    : null
}

function ConversationTimestampSeparator({ sentAtMs }: { sentAtMs: number }): ReactNode {
  const { date, time } = conversationTimestampSeparatorParts(sentAtMs, Date.now(), 'zh-CN')
  const label = `${date} ${time}`
  return (
    <div
      aria-label={label}
      className="conversation-timestamp-separator"
      role="separator"
      data-markdown-copy="exclude"
    >
      <time dateTime={new Date(sentAtMs).toISOString()}>
        <span>{date}</span>{' '}{time}
      </time>
    </div>
  )
}

function useTurnDuration(turn: Turn, active: boolean): number {
  const mountedAt = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())
  const working = active && !hasVisibleFinalAnswer(turn)
  useEffect(() => {
    if (!working) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [working])
  return turnWorkDuration(turn, active, now, mountedAt.current)
}

function ActivityItems({
  items,
  live = false,
  completedHeader = false
}: {
  items: ThreadItem[]
  live?: boolean
  completedHeader?: boolean
}): ReactNode {
  const names = subagentNames(items)
  return (
    <ConversationActivityItems items={items} live={live} completedHeader={completedHeader} renderItem={(item, grouped) => (
      <TimelineItem key={item.id} item={item} compactActivity={item.type === 'reasoning' ? live : !grouped} subagentNames={names} />
    )} />
  )
}

function ActivityDivider(): ReactNode {
  return <div className="activity-heading-divider" aria-hidden="true" />
}

function ActivitySectionHeading({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="activity-section-heading">
      {children}
      <ActivityDivider />
    </div>
  )
}

export interface TurnActivityPartition {
  collapsibleUnits: ThreadItem[]
  expandedUnits: ThreadItem[]
  persistentUnits: ThreadItem[]
  preToggleUnits: ThreadItem[]
  workedForItem: ThreadItem | null
}

interface TurnActivityPartitionOptions {
  afterFinalAnswer?: boolean
  hasFollowingFinalAnswer?: boolean
  isTurnInProgress?: boolean
}

function activityRuntimeType(item: ThreadItem): string {
  return String(item.type)
}

function activityRuntimeValue(item: ThreadItem, key: string): unknown {
  return (item as unknown as Record<string, unknown>)[key]
}

function workedForStatusLabel(
  item: ThreadItem | null,
  durationMs: number,
  status: Turn['status']
): string {
  return workedForActivityStatusLabel(
    item as unknown as WorkedForActivityItem | null,
    durationMs,
    status,
    Date.now(),
    'zh-CN'
  )
}

function isDeniedMcpApproval(item: ThreadItem): boolean {
  if (item.type !== 'mcpToolCall') return false
  const result = item.result
  return result?.type === 'error' &&
    result.error === 'MCP tool call requires approval, but approval policy is never'
}

function isPersistentMcpApp(item: ThreadItem): boolean {
  if (item.type !== 'mcpToolCall') return false
  const resourceUri = activityRuntimeValue(item, 'mcpAppResourceUri')
  return typeof resourceUri === 'string' && resourceUri.trim().length > 0
}

function isPersistentTurnActivityItem(
  item: ThreadItem,
  hasFollowingFinalAnswer: boolean
): boolean {
  const type = activityRuntimeType(item)
  if (type === 'userInputResponse' || type === 'user-input-response') {
    return activityRuntimeValue(item, 'completed') !== true
  }
  if (item.type === 'mcpToolCall') {
    return isDeniedMcpApproval(item) || isPersistentMcpApp(item)
  }
  if (item.type === 'dynamicToolCall') {
    const namespace = activityRuntimeValue(item, 'namespace')
    return activityRuntimeValue(item, 'persistentInCollapsedConversation') === true ||
      (item.tool === 'finalize_environment' && (namespace == null || namespace === 'codex_app'))
  }
  if (item.type === 'userMessage') {
    return activityRuntimeValue(item, 'steeringStatus') === 'pending' ||
      activityRuntimeValue(item, 'deliveryStatus') === 'not-sent' ||
      activityRuntimeValue(item, 'hookFeedback') === true ||
      !hasFollowingFinalAnswer
  }
  return false
}

/**
 * Mirrors the shipped turn partition (`collapsibleUnits`, `persistentUnits`,
 * and `preToggleUnits`) after invisible conversation items have been removed.
 * The current protocol exposes camelCase item names, while imported history can
 * still carry the renderer's kebab-case names, so both spellings are accepted.
 */
export function partitionTurnActivity(
  items: ThreadItem[],
  {
    afterFinalAnswer = false,
    hasFollowingFinalAnswer = true,
    isTurnInProgress = false
  }: TurnActivityPartitionOptions = {}
): TurnActivityPartition {
  const collapsibleUnits: ThreadItem[] = []
  const expandedUnits: ThreadItem[] = []
  const persistentUnits: ThreadItem[] = []
  const preToggleUnits: ThreadItem[] = []
  let workedForItem: ThreadItem | null = null

  for (const item of conversationActivityItems(items)) {
    const type = activityRuntimeType(item)
    if (type === 'workedFor' || type === 'worked-for') {
      workedForItem = item
      continue
    }
    if (type === 'realtimeTranscript' || type === 'realtime-transcript') {
      if (expandedUnits.length === 0) {
        preToggleUnits.push(item)
        continue
      }
      expandedUnits.push(item)
      persistentUnits.push(item)
      continue
    }

    expandedUnits.push(item)
    if (
      (isTurnInProgress && afterFinalAnswer) ||
      isPersistentTurnActivityItem(item, hasFollowingFinalAnswer)
    ) {
      persistentUnits.push(item)
    } else {
      collapsibleUnits.push(item)
    }
  }

  return {
    collapsibleUnits,
    expandedUnits,
    persistentUnits,
    preToggleUnits,
    workedForItem
  }
}

function ExpandedTerminalActivity({
  durationMs,
  interruptedByThisClient,
  items,
  status
}: {
  durationMs: number
  interruptedByThisClient: boolean
  items: ThreadItem[]
  status: Turn['status']
}): ReactNode {
  const partition = partitionTurnActivity(items)
  const workedForStatus = partition.workedForItem
    ? activityRuntimeValue(partition.workedForItem, 'status')
    : null
  const locallyStopped =
    interruptedByThisClient &&
    status === 'interrupted' &&
    (partition.workedForItem === null || workedForStatus === 'unknown')
  const heading = locallyStopped
    ? completedActivityStatusLabel(durationMs, status, 'zh-CN')
    : partition.workedForItem
      ? workedForStatusLabel(partition.workedForItem, durationMs, status)
      : '活动'
  const visibleItems = [
    ...partition.preToggleUnits,
    ...partition.expandedUnits
  ]

  return (
    <div className="turn-activity is-open is-terminal" data-activity-group="turn">
      <ActivitySectionHeading>
        <span>{heading}</span>
      </ActivitySectionHeading>
      <div className="turn-activity-items">
        <ActivityItems items={visibleItems} completedHeader />
      </div>
    </div>
  )
}

function CompletedActivity({
  afterFinalAnswer,
  durationMs,
  hasFollowingFinalAnswer,
  items,
  isTurnInProgress,
  status
}: {
  afterFinalAnswer?: boolean
  durationMs: number
  hasFollowingFinalAnswer?: boolean
  items: ThreadItem[]
  isTurnInProgress?: boolean
  status: Turn['status']
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [contentMounted, setContentMounted] = useState(false)
  const animationFrame = useRef<number | null>(null)
  const collapseTimer = useRef<number | null>(null)
  const partition = partitionTurnActivity(items, {
    afterFinalAnswer,
    hasFollowingFinalAnswer,
    isTurnInProgress
  })
  const contextCompactionOnly =
    partition.collapsibleUnits.length === 1 &&
    ['contextCompaction', 'context-compaction'].includes(
      activityRuntimeType(partition.collapsibleUnits[0]!)
    )
  const canToggle = partition.collapsibleUnits.length > 0 && !contextCompactionOnly
  const statusLabel = workedForStatusLabel(partition.workedForItem, durationMs, status)

  useEffect(
    () => () => {
      if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current)
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
    },
    []
  )

  const toggleExpanded = (): void => {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current)
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
    if (expanded) {
      setExpanded(false)
      collapseTimer.current = window.setTimeout(() => {
        setContentMounted(false)
        collapseTimer.current = null
      }, 150)
      return
    }
    setContentMounted(true)
    animationFrame.current = window.requestAnimationFrame(() => {
      setExpanded(true)
      animationFrame.current = null
    })
  }

  const renderRegion = (
    regionItems: ThreadItem[],
    region: 'expanded' | 'persistent' | 'pre-toggle'
  ): ReactNode => regionItems.length > 0 ? (
    <div
      className="turn-activity-items"
      data-turn-activity-region={region}
      style={region === 'persistent'
        ? { paddingTop: 16 }
        : region === 'pre-toggle' && canToggle
          ? { marginBottom: 16 }
          : undefined}
    >
      <ActivityItems items={regionItems} />
    </div>
  ) : null

  if (
    partition.expandedUnits.length === 0 &&
    partition.preToggleUnits.length === 0
  ) return null

  if (!canToggle) {
    return (
      <div
        className="turn-activity is-complete"
        data-activity-group="turn"
        data-activity-toggle="none"
      >
        {renderRegion(partition.preToggleUnits, 'pre-toggle')}
        {renderRegion(partition.expandedUnits, 'expanded')}
      </div>
    )
  }

  return (
    <div className="turn-activity is-complete" data-activity-group="turn">
      {renderRegion(partition.preToggleUnits, 'pre-toggle')}
      <div className="completed-activity-disclosure">
        <div className="activity-disclosure">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={toggleExpanded}
          >
            <span>{statusLabel}</span>
            <ChevronRight />
          </button>
        </div>
        <ActivityDivider />
      </div>
      {!contentMounted && renderRegion(partition.persistentUnits, 'persistent')}
      {contentMounted && (
        <div
          className={`activity-collapse${expanded ? ' is-expanded' : ''}`}
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div className="turn-activity-items">
            <ActivityItems items={partition.expandedUnits} />
          </div>
        </div>
      )}
    </div>
  )
}

export function TurnBlock({
  turn,
  active,
  interruptedByThisClient = false,
  timestampSeparatorAtMs = null,
  completedGoal,
  latestUserItemId,
  revertReason,
  starting,
  thinking,
  onRevert,
  onFork
}: {
  turn: Turn
  active: boolean
  interruptedByThisClient?: boolean
  timestampSeparatorAtMs?: number | null
  completedGoal?: ThreadGoal | null
  latestUserItemId: string | null
  revertReason: string | null
  starting: boolean
  thinking: boolean
  onRevert(): void
  onFork?(turnId: string): void
}): ReactNode {
  const durationMs = useTurnDuration(turn, active)
  const agentMessages = turn.items.filter((item) => item.type === 'agentMessage')
  const explicitFinalIds = new Set(
    agentMessages
      .filter((item) => item.phase === 'final_answer' && item.text?.trim())
      .map((item) => item.id)
  )
  if (isTerminalTurnStatus(turn.status) && explicitFinalIds.size === 0 && agentMessages.length > 0) {
    const legacyFinal = agentMessages.findLast(
      (item) => item.phase == null && Boolean(item.text?.trim())
    )
    if (legacyFinal) explicitFinalIds.add(legacyFinal.id)
  }
  const lastFinalAnswerId = [...explicitFinalIds].at(-1) || null

  const segments: Array<
    | { kind: 'item'; item: ThreadItem }
    | { kind: 'activity'; items: ThreadItem[]; hasFollowingFinalAnswer: boolean }
  > = []
  let activityItems: ThreadItem[] = []
  let remainingFinalAnswers = explicitFinalIds.size
  const flushActivity = (): void => {
    if (activityItems.length === 0) return
    segments.push({
      kind: 'activity',
      items: activityItems,
      hasFollowingFinalAnswer: remainingFinalAnswers > 0
    })
    activityItems = []
  }

  const leadingUserItemId = turn.items.find((item) => item.type === 'userMessage')?.id ?? null

  for (const item of turn.items) {
    const isDirectItem =
      (item.type === 'userMessage' && item.id === leadingUserItemId) ||
      item.type === 'imageGeneration' ||
      (item.type === 'agentMessage' && explicitFinalIds.has(item.id))
    if (isDirectItem) {
      flushActivity()
      segments.push({ kind: 'item', item })
      if (item.type === 'agentMessage' && explicitFinalIds.has(item.id)) {
        remainingFinalAnswers = Math.max(0, remainingFinalAnswers - 1)
      }
    } else {
      activityItems.push(item)
    }
  }
  flushActivity()

  const finalAnswerStarted = explicitFinalIds.size > 0
  const liveActivity = active && !finalAnswerStarted
  const hasVisibleActivity = segments.some(
    (segment) =>
      segment.kind === 'activity' && hasConversationActivity(segment.items, liveActivity)
  )
  const activityPhase = conversationTurnActivityPhase({
    active,
    finalAnswerStarted,
    hasVisibleActivity,
    interrupted: turn.status === 'interrupted',
    starting,
    thinking
  })
  const waitingForActivity = activityPhase === 'starting' || activityPhase === 'thinking'
  const turnForkAction = forkTurnAction(turn.id, turn.status, onFork)

  return (
    <section className={`turn-block${active ? ' is-active' : ''}`}>
      {timestampSeparatorAtMs !== null && (
        <ConversationTimestampSeparator sentAtMs={timestampSeparatorAtMs} />
      )}
      {segments.map((segment, index) => {
        if (segment.kind === 'activity') {
          if (active && waitingForActivity) return null
          if (!hasConversationActivity(segment.items, liveActivity)) return null
          return activityPhase === 'live' ? (
            <div className="turn-activity is-open is-live" data-activity-group="turn" key={`activity-${index}`}>
              <ActivitySectionHeading>
                <span>{liveActivityStatusLabel(durationMs, 'zh-CN')}</span>
              </ActivitySectionHeading>
              <ActivityItems items={segment.items} live />
            </div>
          ) : activityPhase === 'complete' ? (
            <CompletedActivity
              afterFinalAnswer={finalAnswerStarted && !segment.hasFollowingFinalAnswer}
              durationMs={durationMs}
              hasFollowingFinalAnswer={segment.hasFollowingFinalAnswer}
              items={segment.items}
              isTurnInProgress={active}
              status={turn.status}
              key={`activity-${index}`}
            />
          ) : (
            <ExpandedTerminalActivity
              durationMs={durationMs}
              interruptedByThisClient={interruptedByThisClient}
              items={segment.items}
              status={turn.status}
              key={`activity-${index}`}
            />
          )
        }

        const item = segment.item
        return (
          <TimelineItem
            key={item.id}
            item={item}
            alwaysShowUserActions={
              item.type === 'userMessage' &&
              latestUserItemId === item.id &&
              !active
            }
            userSentAtMs={
              item.type === 'userMessage' &&
              item.id === leadingUserItemId &&
              timestampSeparatorAtMs === null
                ? conversationTimestampMilliseconds(turn.startedAt)
                : null
            }
            streaming={active && item.type === 'agentMessage' && explicitFinalIds.has(item.id)}
            agentActions={
              item.type === 'agentMessage' &&
              explicitFinalIds.has(item.id) &&
              isTerminalTurnStatus(turn.status)
            }
            agentActionExtra={
              item.type === 'agentMessage' && item.id === lastFinalAnswerId
                ? <ThreadGoalCompletion goal={completedGoal} locale="zh-CN" />
                : null
            }
            forkAction={
              item.type === 'agentMessage' && explicitFinalIds.has(item.id)
                ? turnForkAction
                : undefined
            }
            revert={
              item.type === 'userMessage' && latestUserItemId === item.id
                ? { disabledReason: revertReason, onClick: onRevert }
                : undefined
            }
          />
        )
      })}
      {waitingForActivity && (
        <div className="turn-start-status" data-phase={activityPhase} role="status">
          <CadencedShimmer>
            {activityPhase === 'starting' ? '正在开启聊天' : '正在思考'}
          </CadencedShimmer>
        </div>
      )}
    </section>
  )
}

interface RealtimeTranscriptEntry {
  role: string
  text: string
}

function realtimeTranscriptEntries(item: ThreadItem): RealtimeTranscriptEntry[] {
  const entries = activityRuntimeValue(item, 'entries')
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = entry as Record<string, unknown>
    if (typeof value.text !== 'string') return []
    return [{ role: typeof value.role === 'string' ? value.role : 'assistant', text: value.text }]
  })
}

function RealtimeTranscriptActivity({ item }: { item: ThreadItem }): ReactNode {
  const entries = realtimeTranscriptEntries(item)
  const handoffId = activityRuntimeValue(item, 'handoffId')
  if (entries.length === 0) return null
  return (
    <div
      className="realtime-transcript"
      data-realtime-handoff-id={typeof handoffId === 'string' ? handoffId : undefined}
    >
      {entries.map((entry, index) => entry.role === 'user' ? (
        <div className="realtime-transcript-entry is-user" key={`${entry.role}-${index}`}>
          <div className="user-message">{entry.text}</div>
        </div>
      ) : (
        <article className="realtime-transcript-entry is-assistant markdown-body" key={`${entry.role}-${index}`}>
          <MarkdownContent text={entry.text} />
        </article>
      ))}
    </div>
  )
}

interface UserInputQuestionAnswer {
  id: string
  question: string
  answers: string[]
}

function userInputQuestionsAndAnswers(item: ThreadItem): UserInputQuestionAnswer[] {
  const questions = activityRuntimeValue(item, 'questionsAndAnswers')
  if (!Array.isArray(questions)) return []
  return questions.flatMap((question, index) => {
    if (question === null || typeof question !== 'object' || Array.isArray(question)) return []
    const value = question as Record<string, unknown>
    if (typeof value.question !== 'string') return []
    const answers = Array.isArray(value.answers)
      ? value.answers.filter((answer): answer is string => typeof answer === 'string')
      : []
    return [{
      id: typeof value.id === 'string' ? value.id : `question-${index}`,
      question: value.question,
      answers
    }]
  })
}

function UserInputResponseActivity({ item }: { item: ThreadItem }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const questions = userInputQuestionsAndAnswers(item)
  const completed = activityRuntimeValue(item, 'completed') === true
  if (!completed) {
    return (
      <div className="user-input-response is-pending" role="status">
        <CadencedShimmer>正在询问问题</CadencedShimmer>
      </div>
    )
  }
  return (
    <div className="user-input-response is-complete">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span><span className="user-input-response-label">已询问</span> {questions.length} 个问题</span>
        <ChevronRight className={expanded ? 'is-expanded' : ''} />
      </button>
      {expanded && (
        <div className="user-input-response-answers">
          {questions.map((question) => (
            <div className="user-input-response-answer" key={question.id}>
              <strong>{question.question}</strong>
              <span>{question.answers.length > 0 ? question.answers.join(', ') : '未提供答案'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkedForActivity({ item }: { item: ThreadItem }): ReactNode {
  const itemStatus = activityRuntimeValue(item, 'status')
  const label = workedForActivityStatusLabel(
    item as unknown as WorkedForActivityItem,
    0,
    itemStatus === 'stopped' ? 'interrupted' : 'completed'
  )
  return (
    <div className="worked-for-activity" data-worked-for-status={typeof itemStatus === 'string' ? itemStatus : undefined}>
      <span>{label}</span>
      <ActivityDivider />
    </div>
  )
}

function TimelineItem({
  item,
  alwaysShowUserActions = false,
  revert,
  userSentAtMs = null,
  compactActivity = false,
  agentActions = false,
  agentActionExtra,
  forkAction,
  streaming = false,
  subagentNames: agentNames
}: {
  item: ThreadItem
  alwaysShowUserActions?: boolean
  revert?: { disabledReason: string | null; onClick(): void }
  userSentAtMs?: number | null
  compactActivity?: boolean
  agentActions?: boolean
  agentActionExtra?: ReactNode
  forkAction?: () => void
  streaming?: boolean
  subagentNames?: Map<string, string>
}): ReactNode {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [reasoningExpanded, setReasoningExpanded] = useState(false)

  useEffect(() => {
    if (!agentMenuOpen) return
    const close = (): void => setAgentMenuOpen(false)
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [agentMenuOpen])

  const runtimeType = activityRuntimeType(item)
  if (runtimeType === 'realtimeTranscript' || runtimeType === 'realtime-transcript') {
    return <RealtimeTranscriptActivity item={item} />
  }
  if (runtimeType === 'userInputResponse' || runtimeType === 'user-input-response') {
    return <UserInputResponseActivity item={item} />
  }
  if (runtimeType === 'workedFor' || runtimeType === 'worked-for') {
    return <WorkedForActivity item={item} />
  }

  if (item.type === 'userMessage') {
    const text = item.content
      .filter((part): part is { type: 'text'; text: string; text_elements: unknown[] } =>
        part.type === 'text' && typeof part.text === 'string'
      )
      .map((part) => part.text)
      .join('\n')
    const attachments = item.content.flatMap<{
      kind: 'image' | 'file' | 'folder'
      name: string
      path: string
    }>((part) => {
      const value = part as Record<string, unknown>
      if (value.type === 'localImage' && typeof value.path === 'string') {
        return [{ kind: 'image' as const, name: compactPath(value.path), path: value.path }]
      }
      if (
        value.type === 'mention' &&
        typeof value.path === 'string'
      ) {
        return [
          {
            kind: isDirectoryAttachmentPath(value.path) ? 'folder' as const : 'file' as const,
            name: typeof value.name === 'string' ? value.name : compactPath(value.path),
            path: value.path
          }
        ]
      }
      return []
    })
    const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image')
    const linkedAttachments = attachments.filter((attachment) => attachment.kind !== 'image')
    return (
      <div className="user-message-group">
        <UserMessageImages images={imageAttachments} />
        {(text || linkedAttachments.length > 0) && (
          <div className={`user-message${linkedAttachments.length ? ' has-attachments' : ''}`}>
            {text && <CollapsibleUserMessage text={text} />}
            {linkedAttachments.length > 0 && (
              <div className="message-attachments">
                {linkedAttachments.map((attachment, index) => (
                  <span className="message-attachment" key={`${attachment.kind}-${index}`}>
                    {attachment.kind === 'folder'
                      ? <Folder />
                      : <FileText />}
                    <span>{attachment.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {(userSentAtMs !== null || text || revert) && (
          <div className={`message-actions${alwaysShowUserActions ? ' is-persistent' : ''}`}>
            {userSentAtMs !== null && (
              <time
                className="user-message-sent-at"
                dateTime={new Date(userSentAtMs).toISOString()}
              >
                {formatUserMessageSentAt(userSentAtMs)}
              </time>
            )}
            {(text || revert) && (
              <div className="message-action-controls">
                {text && (
                  <button
                    type="button"
                    aria-label="Copy message"
                    title="复制"
                    onClick={() => void navigator.clipboard?.writeText(text)}
                  >
                    <Copy />
                  </button>
                )}
                {revert && (
                  <button
                    type="button"
                    className="message-revert"
                    disabled={Boolean(revert.disabledReason)}
                    title={revert.disabledReason || '编辑并重试'}
                    onClick={revert.onClick}
                  >
                    <Pencil />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'agentMessage') {
    if (compactActivity) {
      return (
        <article className="agent-message activity-commentary markdown-body">
          <MarkdownContent text={item.text || ' '} streaming={streaming} />
        </article>
      )
    }
    return (
      <div className="agent-message-group">
        <article className="agent-message markdown-body">
          <MarkdownContent text={item.text || ' '} streaming={streaming} />
        </article>
        {agentActions && (
          <div className="agent-message-actions" aria-label="回复操作">
            <button
              type="button"
              className="agent-message-copy"
              aria-label="复制"
              title="复制"
              onClick={() => void navigator.clipboard?.writeText(item.text || '')}
            >
              <Copy />
            </button>
            {forkAction && (
              <button
                type="button"
                className="agent-message-more"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={agentMenuOpen}
                data-state={agentMenuOpen ? 'open' : 'closed'}
                title="更多操作"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setAgentMenuOpen((open) => !open)}
              >
                <MoreHorizontal />
              </button>
            )}
            {agentMenuOpen && forkAction && (
              <div
                className="agent-message-menu"
                role="menu"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-label="从这里创建聊天分支"
                  onClick={() => {
                    setAgentMenuOpen(false)
                    forkAction?.()
                  }}
                >
                  <GitFork />
                  <span>分支到新聊天</span>
                </button>
              </div>
            )}
            {agentActionExtra}
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'reasoning') {
    const text = reasoningSummaryMarkdown(item)
    const body = reasoningBody(text)
    if (!text.trim()) return null
    if (compactActivity) return <div className="live-reasoning-line"><CadencedShimmer>{reasoningActivityHeading(item) || '正在思考'}</CadencedShimmer></div>
    return (
      <div className="conversation-reasoning">
        <button type="button" className="conversation-reasoning-heading" aria-expanded={reasoningExpanded}
          disabled={!body} onClick={() => setReasoningExpanded((value) => !value)}>
          <span>已完成思考</span>{body && <ChevronRight className={reasoningExpanded ? 'is-expanded' : ''} />}
        </button>
        {reasoningExpanded && <div className="conversation-reasoning-body markdown-body"><MarkdownContent text={body} /></div>}
      </div>
    )
  }

  if (item.type === 'plan') {
    return (
      <div className="plan-block">
        <div className="tool-card-title">
          <Check /> Plan
        </div>
        <div className="markdown-body">
          <MarkdownContent text={item.text} />
        </div>
      </div>
    )
  }

  if (item.type === 'commandExecution') {
    return <CommandActivity item={item} compact={compactActivity} />
  }

  if (item.type === 'fileChange') {
    if (compactActivity) {
      return <div className="activity-item static live-summary-row"><Pencil /><span>{item.status === 'inProgress' ? '正在编辑文件' : '编辑了文件'}</span></div>
    }
    return <FileChangeReview item={item} />
  }

  if (item.type === 'subAgentActivity') {
    return <SubagentActivity item={item} names={agentNames} />
  }

  if (item.type === 'collabAgentToolCall') {
    return <CollaborationActivity items={[item]} names={agentNames} />
  }

  if (item.type === 'imageView') {
    return (
      <ThreadImagePreview
        path={item.path}
        label="已查看 1 张图像"
      />
    )
  }

  if (item.type === 'imageGeneration') {
    const inlineSource = item.result?.startsWith('data:image/') ? item.result : null
    const imagePath = item.savedPath || (item.result?.startsWith('/') ? item.result : null)
    return (
      <ThreadImagePreview
        path={imagePath}
        inlineSource={inlineSource}
        label={item.status === 'inProgress' ? '正在生成图像' : '已生成 1 张图像'}
        defaultExpanded
      />
    )
  }

  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall' || item.type === 'webSearch' || item.type === 'contextCompaction' || item.type === 'error') {
    return <ToolActivity item={item} compact={compactActivity} live={item.status === 'inProgress'} />
  }

  const toolName =
    typeof item.tool === 'string'
      ? item.server
        ? `${String(item.server)} · ${item.tool}`
        : item.tool
      : item.type.replace(/([a-z])([A-Z])/g, '$1 $2')
  return (
    <div className="activity-item static">
      <Wrench />
      <span className="activity-item-copy">
        <span>已使用 {capitalize(toolName)}</span>
      </span>
    </div>
  )
}

function SideChatPane({
  thread,
  session,
  interruptedTurnIds,
  draft,
  onDraftChange,
  attachments,
  attachmentError,
  onPickAttachments,
  onPickDirectory,
  onRemoveAttachment,
  onSubmit,
  onInterrupt,
  onFork,
  starting,
  disabled,
  context,
  models,
  modelId,
  onModelChange,
  effort,
  onEffortChange,
  permissionProfiles,
  permission,
  approvalsReviewer,
  onPermissionChange
}: {
  thread: Thread | undefined
  session: ThreadSession | undefined
  interruptedTurnIds?: ReadonlySet<string>
  draft: string
  onDraftChange(value: string): void
  attachments: ComposerAttachmentSelection[]
  attachmentError: string | null
  onPickAttachments(): void
  onPickDirectory(): void
  onRemoveAttachment(path: string): void
  onSubmit(): void
  onInterrupt(): void
  onFork(turnId: string): void
  starting: boolean
  disabled: boolean
  context: AppContext | null
  models: ModelOption[]
  modelId: string
  onModelChange(value: string): void
  effort: ReasoningEffort
  onEffortChange(value: ReasoningEffort): boolean
  permissionProfiles: PermissionProfile[]
  permission: string
  approvalsReviewer: ApprovalsReviewer
  onPermissionChange(value: string, approvalsReviewer: ApprovalsReviewer): void
}): ReactNode {
  return (
    <aside className="side-chat-pane" aria-label="侧边聊天">
      {thread ? (
        <Conversation
          thread={thread}
          session={session}
          interruptedTurnIds={interruptedTurnIds}
          starting={starting}
          thinking={false}
          pendingUserMessage={null}
          workspaceName={context?.folderName || '项目'}
          hydrating={false}
          historyError={null}
          hasEarlier={false}
          loadingEarlier={false}
          loaded
          onLoadEarlier={() => undefined}
          onRevert={() => undefined}
          onFork={onFork}
        />
      ) : (
        <div className="side-chat-empty" aria-busy={starting}>
          {starting ? <LoaderCircle className="spin" /> : <CirclePlus />}
          <strong>侧边聊天</strong>
          <span>侧边聊天是临时聊天，关闭应用后会消失。</span>
        </div>
      )}
      <Composer
        draft={draft}
        onDraftChange={onDraftChange}
        attachments={attachments}
        attachmentError={attachmentError}
        onPickAttachments={onPickAttachments}
        addMenuVisibleActions={['attachments', 'attach-electron', 'drawing', 'plugin']}
        onAddAction={(entry) => {
          if (entry.action === 'plugin' && entry.pluginId) {
            onDraftChange(insertPluginInvocation(draft, entry.pluginId))
          } else if (entry.action === 'drawing') {
            onDraftChange(insertPluginInvocation(draft, 'visualize'))
          } else if (entry.action === 'attach-electron') {
            onDraftChange(`${draft}${draft && !/\s$/u.test(draft) ? ' ' : ''}@Electron `)
          }
        }}
        onRemoveAttachment={onRemoveAttachment}
        onSubmit={onSubmit}
        onInterrupt={onInterrupt}
        running={Boolean(session?.running) || starting}
        starting={starting}
        canSteer={false}
        steering={false}
        disabled={disabled}
        emptyThread={false}
        context={context}
        onPickDirectory={onPickDirectory}
        models={models}
        modelId={modelId}
        onModelChange={onModelChange}
        effort={effort}
        onEffortChange={onEffortChange}
        permissionProfiles={permissionProfiles}
        permission={permission}
        approvalsReviewer={approvalsReviewer}
        onPermissionChange={onPermissionChange}
        autoFocus={false}
        placeholder="随心输入"
      />
    </aside>
  )
}

function Composer({
  draft,
  onDraftChange,
  attachments,
  comments = [],
  onRemoveComment,
  attachmentError,
  mode = 'default',
  onModeChange,
  onAddAction,
  addMenuVisibleActions,
  projects = [],
  remoteProjects = [],
  remoteConnections = [],
  selectedLocalPath = null,
  selectedRemoteProjectId = null,
  projectlessSelected = false,
  projectPickerOpen = false,
  onCloseProjectPicker,
  onSelectProject,
  onSelectRemoteProject,
  onAddProject,
  onAddRemoteProject,
  onSelectProjectless,
  threadGoal = null,
  threadGoalDisabled = false,
  onClearThreadGoal,
  onChangeThreadGoalStatus,
  onSaveThreadGoalObjective,
  onThreadGoalError,
  resumeBlocked = false,
  onRetryResume,
  onForkResume,
  onPickAttachments,
  onRemoveAttachment,
  onSubmit,
  onInterrupt,
  queuedMessages = [],
  editingQueuedMessageId = null,
  queueingEnabled = true,
  onSendQueuedMessage,
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  onOpenQueuedMessageInSideChat,
  onReorderQueuedMessages,
  onResumeInterruptedQueue,
  onQueueingChange,
  running,
  starting,
  canSteer,
  steering,
  disabled,
  emptyThread,
  context,
  onPickDirectory,
  onConfigureEnvironment,
  worktreeSelected,
  startingBranch,
  models,
  modelId,
  onModelChange,
  effort,
  onEffortChange,
  permissionProfiles,
  permission,
  approvalsReviewer,
  onPermissionChange,
  autoFocus = true,
  placeholder
}: {
  draft: string
  onDraftChange(value: string): void
  attachments: ComposerAttachmentSelection[]
  comments?: readonly DiffCommentAttachment[]
  onRemoveComment?(id: string): void
  attachmentError: string | null
  mode?: ComposerMode
  onModeChange?(mode: ComposerMode): void
  onAddAction?(entry: ComposerAddMenuEntry): void
  addMenuVisibleActions?: readonly ComposerAddMenuAction[]
  projects?: readonly Project[]
  remoteProjects?: readonly RemoteProject[]
  remoteConnections?: readonly RemoteConnection[]
  selectedLocalPath?: string | null
  selectedRemoteProjectId?: string | null
  projectlessSelected?: boolean
  projectPickerOpen?: boolean
  onCloseProjectPicker?(): void
  onSelectProject?(path: string): void
  onSelectRemoteProject?(project: RemoteProject): void
  onAddProject?(): void
  onAddRemoteProject?(): void
  onSelectProjectless?(): void
  threadGoal?: ThreadGoal | null
  threadGoalDisabled?: boolean
  onClearThreadGoal?(): void | Promise<void>
  onChangeThreadGoalStatus?(status: ThreadGoalStatus): void | Promise<void>
  onSaveThreadGoalObjective?(objective: string): void | Promise<void>
  onThreadGoalError?(error: unknown): void
  resumeBlocked?: boolean
  onRetryResume?(): void
  onForkResume?(): void
  onPickAttachments(): void
  onRemoveAttachment(path: string): void
  onSubmit(): void
  onInterrupt(): void
  queuedMessages?: readonly QueuedMessage[]
  editingQueuedMessageId?: string | null
  queueingEnabled?: boolean
  onSendQueuedMessage?(messageId: string): void
  onDeleteQueuedMessage?(messageId: string): void
  onEditQueuedMessage?(messageId: string): void
  onOpenQueuedMessageInSideChat?(messageId: string): void
  onReorderQueuedMessages?(messageIds: string[]): void
  onResumeInterruptedQueue?(): void
  onQueueingChange?(enabled: boolean): void
  running: boolean
  starting: boolean
  canSteer: boolean
  steering: boolean
  disabled: boolean
  emptyThread: boolean
  context: AppContext | null
  onPickDirectory(): void
  onConfigureEnvironment?(): void
  worktreeSelected?: boolean
  startingBranch?: string | null
  models: ModelOption[]
  modelId: string
  onModelChange(value: string): void
  effort: ReasoningEffort
  onEffortChange(value: ReasoningEffort): boolean
  permissionProfiles: PermissionProfile[]
  permission: string
  approvalsReviewer: ApprovalsReviewer
  onPermissionChange(value: string, approvalsReviewer: ApprovalsReviewer): void
  autoFocus?: boolean
  placeholder?: string
}): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const modeIndicator = composerModeIndicator(mode)
  const richDraft = useMemo(() => parseComposerRichDraft(draft), [draft])
  const hasDocumentsMention = richDraft.pluginMentions.some(({ id }) => id === 'documents')
  const previousDocumentsMention = useRef(hasDocumentsMention)
  const [documentTemplatesOpen, setDocumentTemplatesOpen] = useState(hasDocumentsMention)

  useEffect(() => {
    if (hasDocumentsMention && !previousDocumentsMention.current) setDocumentTemplatesOpen(true)
    if (!hasDocumentsMention) setDocumentTemplatesOpen(false)
    previousDocumentsMention.current = hasDocumentsMention
  }, [hasDocumentsMention])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(
      window.innerHeight * 0.25,
      Math.max(44, textarea.scrollHeight)
    )}px`
  }, [richDraft.text, richDraft.pluginMentions.length, richDraft.templates.length])

  useLayoutEffect(() => {
    const dock = dockRef.current
    const panel = dock?.parentElement
    if (!dock || !panel) return
    const measure = (): void => {
      const bottom = Number.parseFloat(getComputedStyle(dock).bottom) || 0
      const height = `${dock.getBoundingClientRect().height + bottom}px`
      if (panel.style.getPropertyValue('--conversation-footer-height') === height) return
      const scroll = panel.querySelector<HTMLElement>(':scope > .conversation-scroll')
      const wasAtBottom = scroll ? conversationIsAtBottom(scroll, 24) : false
      panel.style.setProperty('--conversation-footer-height', height)
      if (scroll && wasAtBottom) scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(dock, { box: 'border-box' })
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      panel.style.removeProperty('--conversation-footer-height')
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key === 'Backspace' &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0 &&
      richDraft.text.length === 0 &&
      (richDraft.templates.length > 0 || richDraft.pluginMentions.length > 0)
    ) {
      event.preventDefault()
      if (richDraft.templates.length > 0) {
        onDraftChange(serializeComposerRichDraft({
          ...richDraft,
          templates: richDraft.templates.slice(0, -1)
        }))
      } else {
        onDraftChange(serializeComposerRichDraft({
          ...richDraft,
          pluginMentions: richDraft.pluginMentions.slice(0, -1)
        }))
      }
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit()
    }
  }

  const onFormSubmit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <div ref={dockRef} className={`composer-dock${emptyThread ? ' empty' : ''}${documentTemplatesOpen && hasDocumentsMention ? ' has-template-tray' : ''}`}>
      {threadGoal && onClearThreadGoal && onChangeThreadGoalStatus && onSaveThreadGoalObjective && (
        <ThreadGoalBar
          goal={threadGoal}
          disabled={threadGoalDisabled}
          locale="zh-CN"
          onClear={onClearThreadGoal}
          onStatusChange={onChangeThreadGoalStatus}
          onSaveObjective={onSaveThreadGoalObjective}
          onError={(error) => onThreadGoalError?.(error)}
        />
      )}
      {resumeBlocked && onRetryResume && onForkResume && (
        <ThreadResumeNotice busy={starting} onRetry={onRetryResume} onFork={onForkResume} />
      )}
      {projectPickerOpen && onCloseProjectPicker && onSelectProject && onAddProject && (
        <ComposerProjectPicker
          projects={projects}
          remoteProjects={remoteProjects}
          remoteConnections={remoteConnections}
          selectedLocalPath={selectedLocalPath}
          selectedRemoteProjectId={selectedRemoteProjectId}
          projectlessSelected={projectlessSelected}
          onClose={onCloseProjectPicker}
          onSelect={onSelectProject}
          onSelectRemote={onSelectRemoteProject}
          onAdd={onAddProject}
          onAddRemote={onAddRemoteProject}
          onSelectProjectless={onSelectProjectless}
        />
      )}
      {emptyThread && (
        <ComposerContextStrip context={context} onPickDirectory={onPickDirectory} onConfigureEnvironment={onConfigureEnvironment} worktreeSelected={worktreeSelected} startingBranch={startingBranch} />
      )}
      {documentTemplatesOpen && hasDocumentsMention && (
        <ComposerTemplateTray
          onClose={() => setDocumentTemplatesOpen(false)}
          onUse={(template) => {
            onDraftChange(addComposerDocumentTemplate(draft, template.id))
            setDocumentTemplatesOpen(false)
            window.requestAnimationFrame(() => textareaRef.current?.focus())
          }}
          onCreateTemplate={() => {
            onDraftChange(insertPluginInvocation(draft, 'template-creator'))
            setDocumentTemplatesOpen(false)
          }}
          onViewAll={() => {
            onDraftChange(insertPluginInvocation(draft, 'template-creator'))
            setDocumentTemplatesOpen(false)
          }}
        />
      )}
      {queuedMessages.length > 0 && onSendQueuedMessage && onDeleteQueuedMessage && onEditQueuedMessage && onQueueingChange && (
        <QueuedMessageList
          messages={queuedMessages}
          editingMessageId={editingQueuedMessageId}
          queueingEnabled={queueingEnabled}
          responseInProgress={running}
          onSendNow={onSendQueuedMessage}
          onDelete={onDeleteQueuedMessage}
          onEdit={onEditQueuedMessage}
          onOpenInSideChat={onOpenQueuedMessageInSideChat}
          onReorder={onReorderQueuedMessages}
          onResumeInterruptedQueue={onResumeInterruptedQueue}
          onQueueingChange={onQueueingChange}
        />
      )}
      <form className={`composer${starting ? ' is-starting' : ''}`} onSubmit={onFormSubmit}>
        {comments.length > 0 && <div className="composer-attachments" aria-label="Review comments">
          {comments.map((comment) => {
            const name = comment.position.path.split('/').at(-1) || comment.position.path
            return <div className="attachment-chip" key={comment.id} title={diffCommentText(comment)}>
              <MessageSquare />
              <button type="button" className="comment-attachment-link" onClick={() => {
                if (comment.localDiffHunk) dispatchWorkspaceDiffLink({itemId: `comment-${comment.id}`,
                  change: {path: comment.position.path, kind: {type: 'update', move_path: null}, diff: comment.localDiffHunk}})
              }} disabled={!comment.localDiffHunk}>{name}:{formatDiffCommentLines(comment)}</button>
              {onRemoveComment && <button type="button" aria-label={`Remove comment on ${name}`} onClick={() => onRemoveComment(comment.id)}><X /></button>}
            </div>
          })}
        </div>}
        {attachments.length > 0 && (
          <div className="composer-attachments" aria-label="Attached files">
            {attachments.map((attachment) => (
              <div className="attachment-chip" key={attachment.path}>
                {attachment.kind === 'image'
                  ? <ImageIcon />
                  : isDirectoryAttachmentPath(attachment.path)
                    ? <Folder />
                    : <FileText />}
                <span>{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.path)}
                  aria-label={`Remove ${attachment.name}`}
                  title={`Remove ${attachment.name}`}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        )}
        {richDraft.templates.length > 0 && (
          <div className="composer-rich-attachments" aria-label="Selected templates">
            {richDraft.templates.map((template) => (
              <div className="composer-template-attachment" key={template.id}>
                <FileText />
                <span className="composer-template-attachment-copy">
                  <strong>{template.fileName}</strong>
                  <small>{template.name} · Word</small>
                </span>
                <button
                  type="button"
                  aria-label={`移除“${template.fileName}”`}
                  title={`移除“${template.fileName}”`}
                  onClick={() => onDraftChange(serializeComposerRichDraft({
                    ...richDraft,
                    templates: richDraft.templates.filter(({ id }) => id !== template.id)
                  }))}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && (
          <div className="composer-attachment-error" role="status">
            {attachmentError}
          </div>
        )}
        <div className="composer-editor-shell">
          {richDraft.pluginMentions.length > 0 && (
            <div className="composer-plugin-mentions" aria-label="Selected plugins">
              {richDraft.pluginMentions.map((mention) => (
                <ComposerPluginMentionChip
                  key={mention.id}
                  mention={mention}
                  onRemove={() => onDraftChange(serializeComposerRichDraft({
                    ...richDraft,
                    pluginMentions: richDraft.pluginMentions.filter(({ id }) => id !== mention.id)
                  }))}
                />
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={richDraft.text}
            onChange={(event) => onDraftChange(serializeComposerRichDraft({
              ...richDraft,
              text: event.target.value
            }))}
            onKeyDown={onKeyDown}
            placeholder={
              starting
                ? '正在开启聊天…'
                : composerModePlaceholder(mode) || placeholder || (emptyThread ? '随心输入' : '和 Codex 一起工作')
            }
            disabled={starting || (running && !canSteer)}
            aria-busy={starting}
            rows={1}
            autoFocus={autoFocus}
          />
        </div>
        <div className="composer-toolbar">
          <div className="composer-context-controls">
            <ComposerAddMenu
              onPickAttachments={onPickAttachments}
              onAction={onAddAction}
              visibleActions={addMenuVisibleActions}
            />
            {modeIndicator && onModeChange && (
              <button
                type="button"
                className={`composer-mode-indicator is-${mode}`}
                aria-label={modeIndicator.ariaLabel}
                title={modeIndicator.ariaLabel}
                onClick={() => onModeChange('default')}
              >
                <span>{modeIndicator.label}</span>
                <X />
              </button>
            )}
            <ComposerPermissionMenu
              profiles={permissionProfiles}
              value={permission}
              approvalsReviewer={approvalsReviewer}
              onChange={onPermissionChange}
            />
          </div>
          <div className="composer-run-controls">
            <ComposerModelMenus
              models={models}
              modelId={modelId}
              onModelChange={onModelChange}
              effort={effort}
              onEffortChange={onEffortChange}
            />
            {starting ? (
              <button
                type="button"
                className="send-button starting"
                title="正在开启聊天"
                aria-label="正在开启聊天"
                disabled
              >
                <LoaderCircle className="spin" />
              </button>
            ) : running ? (
              <button
                type="button"
                className="send-button stop"
                onClick={onInterrupt}
                title="停止"
                aria-label="停止"
                disabled={disabled || steering}
              >
                <StopGlyph />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button send"
                disabled={
                  disabled ||
                  steering ||
                  (!draft.trim() && attachments.length === 0 && comments.length === 0)
                }
                title="发送"
                aria-label="发送"
              >
                {steering ? <LoaderCircle className="spin" /> : <SendGlyph />}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

function SendGlyph(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z"
        fill="currentColor"
      />
    </svg>
  )
}

function StopGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" />
    </svg>
  )
}

export default App

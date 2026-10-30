import { copyTextToClipboard } from './clipboard'
import {
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  File,
  FileCode2,
  FileImage,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Globe2,
  Link2,
  ListTree,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Search,
  SquarePlus,
  TerminalSquare,
  X
} from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import type {
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryResult,
  WorkspaceFileResult,
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId
} from '../../shared/api'
import type { ThreadSession } from './state/sessionReducer'
import {
  collectWorkspacePaneSnapshot,
  type WorkspaceChangeEntry,
  type WorkspaceCommandEntry,
  type WorkspacePaneSnapshot,
  type WorkspacePaneSurface,
  type WorkspaceSummaryItem,
  workspacePaneCloseAction,
  workspacePaneSummaryItems,
  workspaceChangesMatch
} from './workspacePaneModel'
import {
  WORKSPACE_NAVIGATOR_DEFAULT_WIDTH,
  WORKSPACE_NAVIGATOR_MIN_WIDTH,
  buildWorkspaceNavigatorChangedTree,
  clampWorkspaceNavigatorWidth,
  collectWorkspaceNavigatorSearchPaths,
  isWorkspaceNavigatorRecursiveSearchExcluded,
  persistWorkspaceNavigatorSections,
  persistWorkspaceNavigatorWidth,
  readWorkspaceNavigatorSections,
  readWorkspaceNavigatorWidth,
  workspaceNavigatorMaximumWidth,
  type WorkspaceNavigatorChangedNode,
  type WorkspaceNavigatorSections
} from './workspaceNavigatorModel'
import {
  languageForWorkspaceFile,
  tokenizeWorkspaceCodeLine,
  workspaceErrorMessage,
  workspacePathName,
  workspaceRelativePath
} from './workspaceFileModel'
import {
  OPEN_WORKSPACE_FILE_EVENT,
  OPEN_WORKSPACE_SOURCE_IMAGE_EVENT,
  resolveWorkspaceFileLink,
  type WorkspaceFileLink
} from './workspaceFileLinks'
import {
  CLOSE_WORKSPACE_CONTENT_EVENT,
  OPEN_WORKSPACE_CONTENT_EVENT,
  workspaceSurfaceLayout,
  type WorkspaceLayoutMode
} from './workspaceLayout'
export { CLOSE_WORKSPACE_CONTENT_EVENT, OPEN_WORKSPACE_CONTENT_EVENT } from './workspaceLayout'
export const CLOSE_WORKSPACE_FILE_EVENT = 'codex:close-workspace-file'
export const ACTIVATE_WORKSPACE_TAB_EVENT = 'codex:activate-workspace-tab'
export const CLOSE_WORKSPACE_TAB_EVENT = 'codex:close-workspace-tab'
import './WorkspacePane.css'
import { WorkspaceDiffViewer, type WorkspaceDiffCommentProps } from './WorkspaceDiffViewer'
import { OPEN_WORKSPACE_DIFF_EVENT, resolveWorkspaceDiffLink } from './workspaceDiffLinks'
import { WorkspaceTextEditor } from './WorkspaceTextEditor'
import { WorkspaceFileContextMenu, type WorkspaceFileMenu } from './WorkspaceFileContextMenu'
import { dispatchWorkspaceReference } from './workspaceEditorSelection'
import { subscribeWorkspaceChanges } from './workspaceWatchSubscription'
import { WorkspaceTitlebar } from './WorkspaceTitlebar'
import { workspaceDocumentsForScope, documentIsDirty } from './workspaceDocuments'
import { SourcesSidePanel } from './SourcesSidePanel'
import { SubagentsSidePanel } from './SubagentsSidePanel'
import { RightWorkbenchResizeHandle } from './rightWorkbenchResize'
import {
  collectWorkspaceSummaryPanelsModel
} from './workspaceSummaryPanelsModel'
import { readDesktopSettings } from './desktopSettings'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { WorkspaceFileToolbar } from './WorkspaceFileToolbar'
import { WorkspaceToolbarControls } from './WorkspaceToolbarControls'

export interface WorkspacePaneProps extends WorkspaceDiffCommentProps {
  chromeTarget?: HTMLElement | null
  session: ThreadSession | undefined
  cwd?: string | null
  loading?: boolean
  layoutMode?: WorkspaceLayoutMode
  onLayoutModeChange?(mode: WorkspaceLayoutMode): void
  onOpenSubagent?(threadId: string, name: string): void
  onExpandedChange?(expanded: boolean): void
  onChromeStateChange?(state: WorkspaceChromeState): void
  workbenchVisible?: boolean
  integratedChrome?: boolean
  initialExpanded?: boolean
  resizeHandle?: ReactNode
}

export interface WorkspaceChromeState {
  label: string
  kind: 'workspace' | 'file' | 'changes' | 'output' | 'sources' | 'subagents'
  tabs: WorkspaceChromeTab[]
  activeTabId: string
}

export interface WorkspaceChromeTab {
  id: string
  label: string
  kind: WorkspaceChromeState['kind']
  path?: string
  dirty?: boolean
}

type WorkspaceToolTab = WorkspacePaneSurface
const WORKSPACE_CHANGE_SOURCES = ['上一轮', '未提交', '未暂存', '已暂存', '已提交', '分支'] as const
type WorkspaceChangeSource = (typeof WORKSPACE_CHANGE_SOURCES)[number]

export interface DirectoryLoadState {
  status: 'loading' | 'ready' | 'error'
  entries: WorkspaceDirectoryEntry[]
  truncated: boolean
  error?: string
}

export interface WorkspaceTreeItem {
  path: string
  parentPath: string | null
  isDirectory: boolean
  expanded: boolean
  level: number
}

export type WorkspaceTreeKeyboardAction =
  | { type: 'focus'; path: string }
  | { type: 'expand'; path: string }
  | { type: 'collapse'; path: string }
  | { type: 'activate'; path: string }

function visibleDirectoryEntries(
  state: DirectoryLoadState | undefined,
  filter: string,
  searchPaths?: ReadonlySet<string>
): WorkspaceDirectoryEntry[] {
  if (!state || state.status !== 'ready') return []
  const normalizedFilter = filter.trim().toLocaleLowerCase()
  if (!normalizedFilter) return state.entries
  if (searchPaths) return state.entries.filter((entry) => searchPaths.has(entry.path))
  return state.entries.filter((entry) => entry.fileName.toLocaleLowerCase().includes(normalizedFilter))
}

function workspaceSearchDirectoryExpanded(
  path: string,
  directories: Record<string, DirectoryLoadState>,
  searchPaths: ReadonlySet<string> | undefined
): boolean {
  if (!searchPaths) return false
  const state = directories[path]
  return Boolean(
    state?.status === 'ready' && state.entries.some((entry) => searchPaths.has(entry.path))
  )
}

export function collectVisibleWorkspaceTreeItems(
  cwd: string,
  directories: Record<string, DirectoryLoadState>,
  expandedDirectories: ReadonlySet<string>,
  filter: string,
  searchPaths?: ReadonlySet<string>
): WorkspaceTreeItem[] {
  const searching = filter.trim().length > 0
  const items: WorkspaceTreeItem[] = [{
    path: cwd,
    parentPath: null,
    isDirectory: true,
    expanded: searching || expandedDirectories.has(cwd),
    level: 1
  }]

  const appendDirectory = (directory: string, level: number): void => {
    for (const entry of visibleDirectoryEntries(directories[directory], filter, searchPaths)) {
      const expanded = entry.isDirectory && (
        searching
          ? workspaceSearchDirectoryExpanded(entry.path, directories, searchPaths)
          : expandedDirectories.has(entry.path)
      )
      items.push({
        path: entry.path,
        parentPath: directory,
        isDirectory: entry.isDirectory,
        expanded,
        level
      })
      if (expanded) appendDirectory(entry.path, level + 1)
    }
  }

  if (searching || expandedDirectories.has(cwd)) appendDirectory(cwd, 2)
  return items
}

export function workspaceTreeKeyboardAction(
  items: readonly WorkspaceTreeItem[],
  currentPath: string,
  key: string
): WorkspaceTreeKeyboardAction | null {
  const index = items.findIndex((item) => item.path === currentPath)
  if (index < 0) return null
  const current = items[index]

  if (key === 'ArrowDown' && index < items.length - 1) {
    return { type: 'focus', path: items[index + 1].path }
  }
  if (key === 'ArrowUp' && index > 0) {
    return { type: 'focus', path: items[index - 1].path }
  }
  if (key === 'Home' && index > 0) return { type: 'focus', path: items[0].path }
  if (key === 'End' && index < items.length - 1) {
    return { type: 'focus', path: items[items.length - 1].path }
  }
  if (key === 'ArrowRight' && current.isDirectory) {
    if (!current.expanded) return { type: 'expand', path: current.path }
    const firstChild = items.find((item) => item.parentPath === current.path)
    return firstChild ? { type: 'focus', path: firstChild.path } : null
  }
  if (key === 'ArrowLeft') {
    if (current.isDirectory && current.expanded) {
      return { type: 'collapse', path: current.path }
    }
    return current.parentPath ? { type: 'focus', path: current.parentPath } : null
  }
  if (key === 'Enter' || key === ' ') {
    if (current.isDirectory) {
      return { type: current.expanded ? 'collapse' : 'expand', path: current.path }
    }
    return { type: 'activate', path: current.path }
  }
  return null
}

interface FileLoadState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: WorkspaceFileResult
  error?: string
}

const CHANGE_PRESENTATION = {
  added: { badge: 'A', label: 'Added' },
  deleted: { badge: 'D', label: 'Deleted' },
  modified: { badge: 'M', label: 'Modified' },
  moved: { badge: 'R', label: 'Moved' }
} as const

const MAX_RENDERED_CODE_LINES = 4_000
function workspaceNavigatorStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function WorkspaceEntryIcon({
  path,
  isDirectory = false,
  expanded = false
}: {
  path: string
  isDirectory?: boolean
  expanded?: boolean
}): ReactNode {
  if (isDirectory) return expanded ? <FolderOpen /> : <Folder />
  const name = workspacePathName(path)
  if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(name)) {
    return <FileImage className="workspace-file-kind is-image" />
  }
  if (/\.git(?:ignore|attributes|modules)$/i.test(name)) {
    return <GitBranch className="workspace-file-kind is-git" />
  }
  if (/\.(?:json|jsonl)$/i.test(name) || /^(?:tsconfig|jsconfig)(?:\..+)?\.json$/i.test(name)) {
    return <Braces className="workspace-file-kind is-json" />
  }
  if (/\.tsx?$/i.test(name)) {
    return <span className="workspace-file-kind-badge is-typescript" aria-hidden="true">TS</span>
  }
  if (/\.[cm]?jsx?$/i.test(name)) {
    return <span className="workspace-file-kind-badge is-javascript" aria-hidden="true">JS</span>
  }
  if (/\.(?:md|mdx)$/i.test(name)) {
    return <span className="workspace-file-kind-badge is-markdown" aria-hidden="true">M</span>
  }
  if (/\.(?:[cm]?[jt]sx?|css|scss|html?|py|go|rs|swift|java|kt|sh|ya?ml|toml)$/i.test(path)) {
    return <FileCode2 className="workspace-file-kind is-code" />
  }
  return <File className="workspace-file-kind" />
}

function WorkspaceOpenTargetIcon({ target }: { target: WorkspaceOpenTargetId }): ReactNode {
  if (target === 'terminal') return <span className="workspace-open-target-icon is-terminal" aria-hidden="true"><TerminalSquare /></span>
  if (target === 'finder') return <span className="workspace-open-target-icon is-finder" aria-hidden="true"><Folder /></span>
  if (target === 'vscode') return <span className="workspace-open-target-icon is-vscode" aria-hidden="true">⌁</span>
  if (target === 'cursor') return <span className="workspace-open-target-icon is-cursor" aria-hidden="true">C</span>
  if (target === 'zed') return <span className="workspace-open-target-icon is-zed" aria-hidden="true">Z</span>
  return <span className="workspace-open-target-icon is-windsurf" aria-hidden="true">W</span>
}

function WorkspaceSummaryIcon({ kind }: { kind: WorkspaceSummaryItem['kind'] }): ReactNode {
  if (kind === 'changes') return <GitCompareArrows />
  if (kind === 'collaboration') return <Bot />
  if (kind === 'sources') return <Globe2 />
  return <TerminalSquare />
}

function summaryTab(kind: WorkspaceSummaryItem['kind']): WorkspaceToolTab {
  if (kind === 'changes') return 'changes'
  if (kind === 'sources') return 'sources'
  if (kind === 'collaboration') return 'subagents'
  return 'output'
}

function WorkspaceSourceIcon({ kind }: { kind: WorkspacePaneSnapshot['sources'][number]['kind'] }): ReactNode {
  return kind === 'web' ? <Globe2 /> : <File />
}

function splitPath(path: string): { name: string; parent: string } {
  const normalized = path.replaceAll('\\', '/').replace(/\/$/, '')
  const separator = normalized.lastIndexOf('/')
  if (separator < 0) return { name: normalized, parent: '' }
  return {
    name: normalized.slice(separator + 1) || normalized,
    parent: normalized.slice(0, separator)
  }
}

function resolvedChangePath(cwd: string | null | undefined, path: string): string | null {
  if (!cwd) return null
  if (path.startsWith('/')) return path
  const relativePath = path.replace(/^\.\//, '')
  return `${cwd === '/' ? '' : cwd}/${relativePath}`
}

function ActivityStatus({
  status,
  subject
}: {
  status?: string
  subject: 'change' | 'command'
}): ReactNode {
  if (status === 'inProgress') {
    return (
      <LoaderCircle
        className="workspace-pane-status workspace-pane-spin"
        aria-label={`${subject} in progress`}
      />
    )
  }
  if (status === 'failed' || status === 'declined') {
    return (
      <CircleAlert
        className="workspace-pane-status is-failed"
        aria-label={`${subject} failed`}
      />
    )
  }
  return (
    <CheckCircle2
      className="workspace-pane-status is-complete"
      aria-label={`${subject} completed`}
    />
  )
}

function ChangesView({
  changes,
  selectedChange,
  cwd,
  onSelect
}: {
  changes: WorkspaceChangeEntry[]
  selectedChange: WorkspaceChangeEntry | null
  cwd: string | null | undefined
  onSelect(change: WorkspaceChangeEntry): void
}): ReactNode {
  if (changes.length === 0) {
    return (
      <div className="workspace-pane-empty">
        <GitCompareArrows />
        <strong>暂无文件变更</strong>
        <span>Codex 编辑的文件会显示在这里。</span>
      </div>
    )
  }

  return (
    <ul className="workspace-change-list">
      {changes.map((change) => {
        const path = splitPath(change.path)
        const presentation = CHANGE_PRESENTATION[change.kind]
        return (
          <li key={change.id}>
            <button
              type="button"
              className={`workspace-change-row${selectedChange && workspaceChangesMatch(cwd, selectedChange, change) ? ' is-selected' : ''}`}
              title={change.path}
              onClick={() => onSelect(change)}
            >
              <span
                className={`workspace-change-badge is-${change.kind}`}
                aria-label={presentation.label}
              >
                {presentation.badge}
              </span>
              <span className="workspace-change-copy">
                <strong>{path.name}</strong>
                <small>
                  {change.kind === 'moved' && change.sourcePath !== change.path
                    ? `${change.sourcePath} → ${change.path}`
                    : path.parent || change.path}
                </small>
              </span>
              <span className="workspace-change-stats" aria-label="Diff statistics">
                <span>+{change.additions}</span>
                <span>−{change.deletions}</span>
              </span>
              <ActivityStatus status={change.status} subject="change" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function commandStatusLabel(command: WorkspaceCommandEntry): string {
  if (command.status === 'inProgress') return '正在运行'
  if (command.status === 'failed') return '失败'
  if (command.status === 'declined') return '已拒绝'
  if (command.exitCode !== undefined && command.exitCode !== null) {
    return `退出码 ${command.exitCode}`
  }
  return '已完成'
}

function OutputView({ commands }: { commands: WorkspaceCommandEntry[] }): ReactNode {
  if (commands.length === 0) {
    return (
      <div className="workspace-pane-empty">
        <TerminalSquare />
        <strong>暂无命令输出</strong>
        <span>终端命令和输出会显示在这里。</span>
      </div>
    )
  }

  return (
    <div className="workspace-command-list">
      {commands.map((command) => (
        <article key={command.id} className="workspace-command-card">
          <header>
            <TerminalSquare />
            <code title={command.command}>{command.command || 'Command'}</code>
            <ActivityStatus status={command.status} subject="command" />
          </header>
          <div className="workspace-command-meta">
            <span>{commandStatusLabel(command)}</span>
            {command.cwd && <span title={command.cwd}>{command.cwd}</span>}
          </div>
          <pre>
            {command.output ||
              (command.status === 'inProgress' ? '等待命令输出…' : '命令未产生输出。')}
          </pre>
        </article>
      ))}
    </div>
  )
}

interface FileTreeBranchProps {
  cwd: string
  directory: string
  depth: number
  directories: Record<string, DirectoryLoadState>
  expandedDirectories: Set<string>
  selectedFile: string | null
  activePath: string
  filter: string
  searchPaths?: ReadonlySet<string>
  onToggleDirectory(path: string): void
  onSelectFile(path: string): void
  onRetryDirectory(path: string): void
  onContextMenu(entry: { path: string; isDirectory: boolean }, x: number, y: number): void
  onItemFocus(path: string): void
  onItemKeyDown(event: ReactKeyboardEvent<HTMLElement>, path: string): void
  registerItem(path: string, node: HTMLElement | null): void
}

function FileTreeBranch({
  cwd,
  directory,
  depth,
  directories,
  expandedDirectories,
  selectedFile,
  activePath,
  filter,
  searchPaths,
  onToggleDirectory,
  onSelectFile,
  onRetryDirectory,
  onContextMenu,
  onItemFocus,
  onItemKeyDown,
  registerItem
}: FileTreeBranchProps): ReactNode {
  const state = directories[directory]
  if (!state || state.status === 'loading') {
    return (
      <div className="workspace-tree-state" style={{ paddingLeft: Math.max(8, 12 + depth * 14) }}>
        <LoaderCircle className="workspace-pane-spin" />
        <span>载入中…</span>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <button
        type="button"
        className="workspace-tree-state is-error"
        style={{ paddingLeft: Math.max(8, 12 + depth * 14) }}
        onClick={() => onRetryDirectory(directory)}
      >
        <CircleAlert />
        <span>{state.error || '无法读取目录'}</span>
        <RefreshCw />
      </button>
    )
  }

  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const visibleEntries = visibleDirectoryEntries(state, filter, searchPaths)

  return (
    <>
      {visibleEntries.map((entry, index) => {
        const isExpanded = entry.isDirectory && (
          normalizedFilter
            ? workspaceSearchDirectoryExpanded(entry.path, directories, searchPaths)
            : expandedDirectories.has(entry.path)
        )
        const row = (
          <button
            type="button"
            role="treeitem"
            className={`workspace-tree-row${selectedFile === entry.path ? ' is-selected' : ''}`}
            aria-expanded={entry.isDirectory ? isExpanded : undefined}
            aria-selected={selectedFile === entry.path}
            aria-level={depth + 2}
            aria-posinset={index + 1}
            aria-setsize={visibleEntries.length}
            tabIndex={activePath === entry.path ? 0 : -1}
            data-workspace-tree-path={entry.path}
            ref={(node) => registerItem(entry.path, node)}
            style={{ paddingLeft: Math.max(5, 9 + depth * 14) }}
            title={workspaceRelativePath(cwd, entry.path)}
            onContextMenu={(event) => { event.preventDefault(); onContextMenu(entry, event.clientX, event.clientY) }}
            onDoubleClick={() => !entry.isDirectory && window.dispatchEvent(new CustomEvent('codex:pin-workspace-file', { detail: entry.path }))}
            onFocus={() => onItemFocus(entry.path)}
            onKeyDown={(event) => onItemKeyDown(event, entry.path)}
            onClick={() =>
              entry.isDirectory ? onToggleDirectory(entry.path) : onSelectFile(entry.path)
            }
          >
            <span className="workspace-tree-disclosure">
              {entry.isDirectory ? isExpanded ? <ChevronDown /> : <ChevronRight /> : null}
            </span>
            <WorkspaceEntryIcon path={entry.path} isDirectory={entry.isDirectory} expanded={isExpanded} />
            <span>{entry.fileName}</span>
          </button>
        )
        return (
          <div role="none" key={entry.path}>
            {row}
            {entry.isDirectory && isExpanded && (
              <div role="group">
                <FileTreeBranch
                  cwd={cwd}
                  directory={entry.path}
                  depth={depth + 1}
                  directories={directories}
                  expandedDirectories={expandedDirectories}
                  selectedFile={selectedFile}
                  activePath={activePath}
                  filter={filter}
                  searchPaths={searchPaths}
                  onToggleDirectory={onToggleDirectory}
                  onSelectFile={onSelectFile}
                  onRetryDirectory={onRetryDirectory}
                  onContextMenu={onContextMenu}
                  onItemFocus={onItemFocus}
                  onItemKeyDown={onItemKeyDown}
                  registerItem={registerItem}
                />
              </div>
            )}
          </div>
        )
      })}
      {visibleEntries.length === 0 && (
        <div className="workspace-tree-empty">
          {normalizedFilter ? '没有匹配的文件' : '此目录为空'}
        </div>
      )}
      {state.truncated && (
        <div className="workspace-tree-limit">仅显示前 {state.entries.length} 个项目</div>
      )}
    </>
  )
}

export function FileTreeView({
  cwd,
  directories,
  expandedDirectories,
  selectedFile,
  filter,
  searchPaths,
  onToggleDirectory,
  onSelectFile,
  onRetryDirectory,
  onContextMenu,
  hideRoot = false
}: Omit<
  FileTreeBranchProps,
  'directory' | 'depth' | 'activePath' | 'onItemFocus' | 'onItemKeyDown' | 'registerItem'
> & { hideRoot?: boolean }): ReactNode {
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const visibleItems = useMemo(() => {
    const items = collectVisibleWorkspaceTreeItems(
      cwd,
      directories,
      expandedDirectories,
      filter,
      searchPaths
    )
    if (!hideRoot) return items
    return items.slice(1).map((item) => ({
      ...item,
      parentPath: item.parentPath === cwd ? null : item.parentPath,
      level: Math.max(1, item.level - 1)
    }))
  }, [cwd, directories, expandedDirectories, filter, hideRoot, searchPaths])
  const visiblePaths = useMemo(
    () => new Set(visibleItems.map((item) => item.path)),
    [visibleItems]
  )
  const activePath = focusedPath && visiblePaths.has(focusedPath)
    ? focusedPath
    : selectedFile && visiblePaths.has(selectedFile)
      ? selectedFile
      : hideRoot
        ? visibleItems[0]?.path || cwd
        : cwd
  const rootExpanded = filter.trim().length > 0 || expandedDirectories.has(cwd)

  const registerItem = useCallback((path: string, node: HTMLElement | null): void => {
    if (node) itemRefs.current.set(path, node)
    else itemRefs.current.delete(path)
  }, [])

  const focusItem = useCallback((path: string): void => {
    setFocusedPath(path)
    window.requestAnimationFrame(() => itemRefs.current.get(path)?.focus())
  }, [])

  const handleItemKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLElement>,
    path: string
  ): void => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const action = workspaceTreeKeyboardAction(visibleItems, path, event.key)
    if (!action) return
    if (action.type === 'focus') {
      focusItem(action.path)
      return
    }
    if (action.type === 'activate') {
      onSelectFile(action.path)
      return
    }
    onToggleDirectory(action.path)
  }, [focusItem, onSelectFile, onToggleDirectory, visibleItems])

  return (
    <div className={`workspace-file-tree${hideRoot ? ' is-rootless' : ''}`} role="tree" aria-label="Workspace files">
      <div role="none">
        {!hideRoot && <button
          type="button"
          role="treeitem"
          className="workspace-tree-root"
          aria-expanded={rootExpanded}
          aria-selected={false}
          aria-level={1}
          aria-posinset={1}
          aria-setsize={1}
          tabIndex={activePath === cwd ? 0 : -1}
          data-workspace-tree-path={cwd}
          ref={(node) => registerItem(cwd, node)}
          style={{ width: '100%', background: 'transparent', textAlign: 'left' }}
          title={cwd}
          onContextMenu={(event) => { event.preventDefault(); onContextMenu({ path: cwd, isDirectory: true }, event.clientX, event.clientY) }}
          onFocus={() => setFocusedPath(cwd)}
          onKeyDown={(event) => handleItemKeyDown(event, cwd)}
          onClick={() => onToggleDirectory(cwd)}
        >
          <span className="workspace-tree-disclosure">
            {rootExpanded ? <ChevronDown /> : <ChevronRight />}
          </span>
          {rootExpanded ? <FolderOpen /> : <Folder />}
          <strong>{workspacePathName(cwd)}</strong>
        </button>}
        {rootExpanded && (
          <div role="group">
            <FileTreeBranch
              cwd={cwd}
              directory={cwd}
              depth={hideRoot ? -1 : 0}
              directories={directories}
              expandedDirectories={expandedDirectories}
              selectedFile={selectedFile}
              activePath={activePath}
              filter={filter}
              searchPaths={searchPaths}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
              onRetryDirectory={onRetryDirectory}
              onContextMenu={onContextMenu}
              onItemFocus={setFocusedPath}
              onItemKeyDown={handleItemKeyDown}
              registerItem={registerItem}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function WorkspaceChangedFiles({
  changes,
  selectedChange,
  cwd,
  filter,
  collapsedPaths,
  onSelect,
  onToggleDirectory
}: {
  changes: WorkspaceChangeEntry[]
  selectedChange: WorkspaceChangeEntry | null
  cwd: string | null | undefined
  filter: string
  collapsedPaths: ReadonlySet<string>
  onSelect(change: WorkspaceChangeEntry): void
  onToggleDirectory(path: string): void
}): ReactNode {
  const query = filter.trim().toLocaleLowerCase()
  const nodes = useMemo(
    () => buildWorkspaceNavigatorChangedTree(cwd || '', changes, filter),
    [changes, cwd, filter]
  )
  if (nodes.length === 0) {
    return <div className="workspace-navigator-empty">{query ? '没有匹配的已更改文件' : '暂无已更改文件'}</div>
  }

  const renderNodes = (
    entries: readonly WorkspaceNavigatorChangedNode<WorkspaceChangeEntry>[],
    depth: number
  ): ReactNode => entries.map((entry) => {
    const paddingLeft = 7 + depth * 14
    if (entry.kind === 'directory') {
      const expanded = query.length > 0 || !collapsedPaths.has(entry.path)
      return (
        <div role="none" key={entry.id}>
          <button
            type="button"
            role="treeitem"
            className="workspace-change-nav-row is-directory"
            aria-expanded={expanded}
            style={{ paddingLeft }}
            title={entry.path}
            onClick={() => onToggleDirectory(entry.path)}
          >
            <span className="workspace-tree-disclosure">
              {expanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            <WorkspaceEntryIcon path={entry.path} isDirectory expanded={expanded} />
            <span className="workspace-change-nav-name">{entry.name}</span>
          </button>
          {expanded && <div role="group">{renderNodes(entry.children, depth + 1)}</div>}
        </div>
      )
    }

    const { change } = entry
    const selected = Boolean(selectedChange && workspaceChangesMatch(cwd, selectedChange, change))
    const presentation = CHANGE_PRESENTATION[change.kind]
    return (
      <button
        type="button"
        role="treeitem"
        className={`workspace-change-nav-row is-file${selected ? ' is-selected' : ''}`}
        key={entry.id}
        style={{ paddingLeft }}
        title={change.path}
        aria-selected={selected}
        onClick={() => onSelect(change)}
      >
        <span className="workspace-tree-disclosure" />
        <WorkspaceEntryIcon path={change.path} />
        <span className="workspace-change-nav-name">{entry.name}</span>
        <span className="workspace-change-nav-stats" aria-label={`${change.additions} 行新增，${change.deletions} 行删除`}>
          {change.additions > 0 && <span className="is-added">+{change.additions}</span>}
          {change.deletions > 0 && <span className="is-deleted">−{change.deletions}</span>}
        </span>
        <span
          className={`workspace-change-nav-kind is-${change.kind}`}
          aria-label={presentation.label}
        >
          {presentation.badge}
        </span>
      </button>
    )
  })

  return (
    <div className="workspace-changed-files" role="tree" aria-label="已更改的文件">
      {renderNodes(nodes, 0)}
    </div>
  )
}

export function CodeViewer({
  cwd,
  path,
  file,
  targetLine,
  onRetry,
  onSelectFile,
  toolbarTarget,
  toolbarActions
}: {
  cwd: string | null | undefined
  path: string | null
  file: FileLoadState
  targetLine: number | null
  onRetry(): void
  onSelectFile?(path: string): void
  toolbarTarget?: HTMLElement | null
  toolbarActions?: ReactNode
}): ReactNode {
  const targetLineRef = useRef<HTMLSpanElement>(null)
  const textResult = file.result?.kind === 'text' ? file.result : null
  const language = path ? languageForWorkspaceFile(path, textResult?.mimeType) : null
  const allLines = textResult ? textResult.text.split('\n') : []
  const requestedLineIndex = targetLine === null ? -1 : targetLine - 1
  const targetIsInFile = requestedLineIndex >= 0 && requestedLineIndex < allLines.length
  const firstRenderedLineIndex = targetIsInFile
    ? Math.max(
        0,
        Math.min(
          requestedLineIndex - Math.floor(MAX_RENDERED_CODE_LINES / 2),
          Math.max(0, allLines.length - MAX_RENDERED_CODE_LINES)
        )
      )
    : 0
  const lines = allLines.slice(
    firstRenderedLineIndex,
    firstRenderedLineIndex + MAX_RENDERED_CODE_LINES
  )
  const truncated = allLines.length > lines.length

  useEffect(() => {
    if (file.status !== 'ready' || !textResult || targetLine === null) return
    const frame = window.requestAnimationFrame(() => {
      targetLineRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [file.status, path, targetLine, textResult])

  return (
    <section className="workspace-code-viewer" aria-label="Code preview">
      <WorkspaceFileToolbar target={toolbarTarget}>
        <WorkspaceBreadcrumbs root={cwd} path={path} onSelectFile={onSelectFile} />
        {toolbarActions || (language && <span className="workspace-code-language">{language}</span>)}
      </WorkspaceFileToolbar>
      <div className="workspace-code-content">
        {!path && (
          <div className="workspace-code-empty">
            <Braces />
            <strong>选择一个文件进行预览</strong>
            <span>从右侧文件树中打开项目里的文本文件。</span>
          </div>
        )}
        {path && file.status === 'loading' && (
          <div className="workspace-code-state" role="status">
            <LoaderCircle className="workspace-pane-spin" />
            <span>正在打开 {workspacePathName(path)}…</span>
          </div>
        )}
        {path && file.status === 'error' && (
          <div className="workspace-code-state is-error" role="alert">
            <CircleAlert />
            <strong>无法打开文件</strong>
            <span>{file.error}</span>
            <button type="button" onClick={onRetry}>
              <RefreshCw />
              重试
            </button>
          </div>
        )}
        {path && file.status === 'ready' && file.result?.kind === 'image' && (
          <div className="workspace-image-preview">
            <img src={`data:${file.result.mimeType};base64,${file.result.dataBase64}`} alt={workspacePathName(path)} />
            <small className="workspace-image-meta">
              {file.result.mimeType} · {Math.max(1, Math.round(file.result.sizeBytes / 1024))} KB
            </small>
          </div>
        )}
        {path && file.status === 'ready' && textResult && (
          <div className="workspace-source-wrap">
            <pre className="workspace-source-code" tabIndex={0}>
              {lines.map((line, lineIndex) => {
                const lineNumber = firstRenderedLineIndex + lineIndex + 1
                const isTargetLine = lineNumber === targetLine
                return (
                  <span
                    className={`workspace-source-line${isTargetLine ? ' is-target-line' : ''}`}
                    data-line={lineNumber}
                    data-target-line={isTargetLine ? 'true' : undefined}
                    ref={isTargetLine ? targetLineRef : undefined}
                    key={lineNumber}
                  >
                    <span className="workspace-source-number">{lineNumber}</span>
                    <code>
                      {tokenizeWorkspaceCodeLine(line).map((token, tokenIndex) => (
                        <span
                          key={`${lineNumber}:${tokenIndex}`}
                          className={`workspace-token is-${token.kind}`}
                        >
                          {token.text}
                        </span>
                      ))}
                    </code>
                  </span>
                )
              })}
            </pre>
            {truncated && (
              <div className="workspace-code-limit">
                文件共有 {allLines.length.toLocaleString()} 行，当前显示第{' '}
                {(firstRenderedLineIndex + 1).toLocaleString()}–
                {(firstRenderedLineIndex + lines.length).toLocaleString()} 行。
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

interface WorkspacePresentation {
  activeTab: WorkspaceToolTab
  filter: string
  expandedDirectories: Set<string>
  selectedChange: WorkspaceChangeEntry | null
  changeView: 'overview' | 'selection'
  showSelectedDiff: boolean
  changeSource: WorkspaceChangeSource
  toolsVisible: boolean
  openedToolTabs: WorkspaceToolTab[]
}
const workspacePresentations = new Map<string, WorkspacePresentation>()

export function WorkspacePane({
  chromeTarget,
  session,
  cwd = null,
  loading = false,
  layoutMode,
  onLayoutModeChange,
  onOpenSubagent,
  onExpandedChange,
  onChromeStateChange,
  workbenchVisible = true,
  integratedChrome = false,
  initialExpanded = false,
  resizeHandle = null,
  comments,
  onCommentsChange,
  commentScopeKey
}: WorkspacePaneProps): ReactNode {
  const presentationKey = `${commentScopeKey || 'workspace'}:${cwd || '/'}`
  const restoredPresentation = workspacePresentations.get(presentationKey)
  const presentationKeyRef = useRef(presentationKey)
  const [expanded, setExpanded] = useState(initialExpanded)
  const paneRef = useRef<HTMLElement>(null)
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
  const expandedChangeCallback = useRef(onExpandedChange)
  expandedChangeCallback.current = onExpandedChange
  const chromeStateCallback = useRef(onChromeStateChange)
  chromeStateCallback.current = onChromeStateChange
  const [toolsVisible, setToolsVisible] = useState(restoredPresentation?.toolsVisible ?? true)
  const [localLayoutMode, setLocalLayoutMode] = useState<WorkspaceLayoutMode>('split')
  const effectiveLayoutMode = layoutMode ?? localLayoutMode
  const unifiedChrome = Boolean(chromeTarget) || integratedChrome
  const surfaceLayout = workspaceSurfaceLayout(effectiveLayoutMode, expanded)
  const [activeTab, setActiveTab] = useState<WorkspaceToolTab>(restoredPresentation?.activeTab ?? 'changes')
  const [openedToolTabs, setOpenedToolTabs] = useState<WorkspaceToolTab[]>(restoredPresentation?.openedToolTabs ?? [])
  const [filter, setFilter] = useState(restoredPresentation?.filter ?? '')
  const [directories, setDirectories] = useState<Record<string, DirectoryLoadState>>({})
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(restoredPresentation?.expandedDirectories ?? new Set(cwd ? [cwd] : []))
  const documentsStore = useMemo(() => workspaceDocumentsForScope(commentScopeKey || 'workspace', cwd || '/', {
    readWorkspaceFile: (root, path) => window.codex.readWorkspaceFile(root, path),
    saveWorkspaceFile: (root, path, text, expectedText) => window.codex.saveWorkspaceFile(root, path, text, expectedText)
  }), [cwd, commentScopeKey])
  const documentState = useSyncExternalStore(documentsStore.subscribe, documentsStore.getSnapshot, documentsStore.getSnapshot)
  const selectedFile = documentState.activePath
  const activeDocument = selectedFile ? documentsStore.find(selectedFile) : undefined
  const [selectedChange, setSelectedChange] = useState<WorkspaceChangeEntry | null>(restoredPresentation?.selectedChange ?? null)
  const [changeView, setChangeView] = useState<'overview' | 'selection'>(restoredPresentation?.changeView ?? 'overview')
  const [showSelectedDiff, setShowSelectedDiff] = useState(restoredPresentation?.showSelectedDiff ?? true)
  const [changeSource, setChangeSource] = useState<WorkspaceChangeSource>(restoredPresentation?.changeSource ?? '上一轮')
  const [changeSourceMenu, setChangeSourceMenu] = useState(false)
  const changeSourceMenuRef = useRef<HTMLDivElement>(null)
  const changeSourceButtonRef = useRef<HTMLButtonElement>(null)
  const file: FileLoadState = activeDocument ? {status: activeDocument.status, result: activeDocument.result, error: activeDocument.error} : {status: 'idle'}
  const targetLine = activeDocument?.line ?? null
  const [closeFailure, setCloseFailure] = useState<string | null>(null)
  const [tabMenu, setTabMenu] = useState<{path: string; x: number; y: number} | null>(null)
  const tabMenuRef = useRef<HTMLDivElement>(null)
  const [fileMenu, setFileMenu] = useState<WorkspaceFileMenu | null>(null)
  const [openTargets, setOpenTargets] = useState<WorkspaceOpenTarget[] | null>(null)
  const [toolbarOpenMenu, setToolbarOpenMenu] = useState(false)
  const resetToolbarOpenMenu = useCallback(() => setToolbarOpenMenu(false), [])
  const toolbarOpenMenuRef = useRef<HTMLDivElement>(null)
  const toolbarOpenMenuButtonRef = useRef<HTMLButtonElement>(null)
  const [navigatorWidthState, setNavigatorWidthState] = useState(
    () => readWorkspaceNavigatorWidth(workspaceNavigatorStorage(), 0)
  )
  const [navigatorHostWidth, setNavigatorHostWidth] = useState(0)
  const [navigatorSections, setNavigatorSections] = useState<WorkspaceNavigatorSections>(
    () => readWorkspaceNavigatorSections(workspaceNavigatorStorage(), cwd)
  )
  const [searchingFiles, setSearchingFiles] = useState(false)
  const [fileActionError, setFileActionError] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)
  const [watchRetry, setWatchRetry] = useState(0)
  const [sourceImage, setSourceImage] = useState<{
    path: string
    file: FileLoadState
  } | null>(null)
  const sourceImageRequest = useRef(0)
  const directoriesRef = useRef(directories)
  const workspaceGenerationRef = useRef(0)
  const directoryLoads = useRef(new Map<string, number>())
  const workspaceSearchRequest = useRef(0)
  const snapshot = useMemo(() => collectWorkspacePaneSnapshot(session, cwd), [session, cwd])
  const panelModel = useMemo(
    () => collectWorkspaceSummaryPanelsModel(session, snapshot),
    [session, snapshot]
  )
  const summaryItems = useMemo(() => workspacePaneSummaryItems(snapshot), [snapshot])
  const isUpdating = loading || snapshot.updating
  const navigatorMaximumWidth = workspaceNavigatorMaximumWidth(navigatorHostWidth)
  const navigatorWidth = clampWorkspaceNavigatorWidth(
    navigatorWidthState,
    navigatorHostWidth
  )
  const changedFilesExpanded = navigatorSections.changedFilesExpanded
  const allFilesExpanded = navigatorSections.allFilesExpanded
  const collapsedChangedPaths = useMemo(
    () => new Set(navigatorSections.collapsedChangedPaths),
    [navigatorSections.collapsedChangedPaths]
  )
  const searchPaths = useMemo(
    () => collectWorkspaceNavigatorSearchPaths(cwd || '', directories, filter),
    [cwd, directories, filter]
  )

  useLayoutEffect(() => {
    workspacePresentations.delete(presentationKey)
    workspacePresentations.set(presentationKey, { activeTab, filter, expandedDirectories, selectedChange, changeView, showSelectedDiff, changeSource, toolsVisible, openedToolTabs })
    if (workspacePresentations.size > 32) workspacePresentations.delete(workspacePresentations.keys().next().value!)
  }, [presentationKey, activeTab, filter, expandedDirectories, selectedChange, changeView, showSelectedDiff, changeSource, toolsVisible, openedToolTabs])

  useEffect(() => {
    if (expanded && activeTab !== 'files' && !(activeTab === 'changes' && changeView === 'selection')) setOpenedToolTabs((current) => current.includes(activeTab) ? current : [...current, activeTab])
  }, [activeTab, expanded, changeView])

  const closeToolTab = (id: WorkspaceToolTab): void => {
    const remaining = openedToolTabs.filter((tab) => tab !== id)
    setOpenedToolTabs(remaining)
    if (activeTab !== id || (id === 'changes' && changeView === 'selection' && selectedChange)) return
    setActiveTab(selectedFile || sourceImage ? 'files' : remaining.at(-1) ?? 'files')
    if (!selectedFile && !sourceImage && remaining.length === 0 && !selectedChange) setExpanded(false)
  }

  useEffect(() => {
    expandedChangeCallback.current?.(expanded)
  }, [expanded])

  useEffect(() => {
    let current = true
    void window.codex.listWorkspaceOpenTargets().then((targets) => {
      if (current) setOpenTargets(targets)
    }).catch((error) => {
      if (!current) return
      setOpenTargets([])
      setFileActionError(workspaceErrorMessage(error))
    })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!toolbarOpenMenu) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (toolbarOpenMenuRef.current?.contains(target)) return
      if (toolbarOpenMenuButtonRef.current?.contains(target)) return
      setToolbarOpenMenu(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setToolbarOpenMenu(false)
        toolbarOpenMenuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const buttons = Array.from(
        toolbarOpenMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []
      )
      if (buttons.length === 0) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
    const frame = window.requestAnimationFrame(() => {
      toolbarOpenMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key, true)
    }
  }, [toolbarOpenMenu])

  useEffect(() => {
    if (!changeSourceMenu) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (changeSourceMenuRef.current?.contains(target)) return
      if (changeSourceButtonRef.current?.contains(target)) return
      setChangeSourceMenu(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setChangeSourceMenu(false)
        changeSourceButtonRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const buttons = Array.from(
        changeSourceMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []
      )
      if (buttons.length === 0) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
    const frame = window.requestAnimationFrame(() => {
      changeSourceMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [changeSourceMenu])

  useEffect(() => {
    if (!expanded) return
    const pane = paneRef.current
    if (!pane) return
    const measure = (): void => setNavigatorHostWidth(pane.getBoundingClientRect().width)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(pane)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [expanded])

  useEffect(() => {
    if (navigatorWidthState === navigatorWidth) return
    setNavigatorWidthState(navigatorWidth)
  }, [navigatorWidth, navigatorWidthState])

  const updateNavigatorSections = useCallback((
    update: (current: WorkspaceNavigatorSections) => WorkspaceNavigatorSections
  ): void => {
    setNavigatorSections((current) => persistWorkspaceNavigatorSections(
      workspaceNavigatorStorage(),
      update(current),
      cwd
    ))
  }, [cwd])

  const updateDirectory = useCallback((path: string, state: DirectoryLoadState): void => {
    setDirectories((current) => {
      const next = { ...current, [path]: state }
      directoriesRef.current = next
      return next
    })
  }, [])

  const loadDirectory = useCallback(
    async (path: string, force = false): Promise<void> => {
      if (!cwd) return
      const existing = directoriesRef.current[path]
      if (!force && (existing?.status === 'loading' || existing?.status === 'ready')) return
      const generation = workspaceGenerationRef.current
      const load = (directoryLoads.current.get(path) || 0) + 1
      directoryLoads.current.set(path, load)
      updateDirectory(path, {
        status: 'loading',
        entries: existing?.entries || [],
        truncated: existing?.truncated || false
      })
      try {
        const result: WorkspaceDirectoryResult = await window.codex.readWorkspaceDirectory(cwd, path)
        if (workspaceGenerationRef.current !== generation || directoryLoads.current.get(path) !== load) return
        updateDirectory(path, {
          status: 'ready',
          entries: result.entries,
          truncated: result.truncated
        })
      } catch (error) {
        if (workspaceGenerationRef.current !== generation || directoryLoads.current.get(path) !== load) return
        updateDirectory(path, {
          status: 'error',
          entries: existing?.entries || [],
          truncated: false,
          error: workspaceErrorMessage(error)
        })
      }
    },
    [cwd, updateDirectory]
  )

  const openFile = useCallback(
    async (path: string, line: number | null = null): Promise<void> => {
      if (!cwd) return
      sourceImageRequest.current += 1
      setSourceImage(null)
      await documentsStore.open(path, line)
    },
    [cwd, documentsStore]
  )

  const openBreadcrumbFile = useCallback((path: string): void => {
    setActiveTab('files')
    void openFile(path)
  }, [openFile])

  const openSourceImage = useCallback(async (path: string): Promise<void> => {
    const workspacePath = cwd ? resolveWorkspaceFileLink(cwd, path) : null
    if (workspacePath) {
      setActiveTab('files')
      await openFile(workspacePath)
      return
    }

    const request = sourceImageRequest.current + 1
    sourceImageRequest.current = request
    setActiveTab('files')
    setSourceImage({ path, file: { status: 'loading' } })
    try {
      const result = await window.codex.readThreadImage(path)
      if (sourceImageRequest.current !== request) return
      setSourceImage({
        path,
        file: {
          status: 'ready',
          result: {
            path: result.path || path,
            kind: 'image',
            mimeType: result.mimeType,
            dataBase64: result.dataBase64,
            sizeBytes: result.sizeBytes
          }
        }
      })
    } catch (error) {
      if (sourceImageRequest.current !== request) return
      setSourceImage({
        path,
        file: { status: 'error', error: workspaceErrorMessage(error) }
      })
    }
  }, [cwd, openFile])

  useEffect(() => {
    workspaceGenerationRef.current += 1
    workspaceSearchRequest.current += 1
    directoriesRef.current = {}
    directoryLoads.current.clear()
    setDirectories({})
    if (presentationKeyRef.current === presentationKey) return
    presentationKeyRef.current = presentationKey
    setExpandedDirectories(cwd ? new Set([cwd]) : new Set())
    setOpenedToolTabs([])
    setActiveTab('files')
    setNavigatorSections(readWorkspaceNavigatorSections(workspaceNavigatorStorage(), cwd))
    setSearchingFiles(false)
    setSelectedChange(null)
    setChangeView('overview')
    setShowSelectedDiff(true)
    setChangeSource('上一轮')
    setChangeSourceMenu(false)
    setFilter('')
    setFileMenu(null)
    setFileActionError(null)
    setWatchError(null)
    sourceImageRequest.current += 1
    setSourceImage(null)
  }, [cwd, presentationKey])

  useEffect(() => {
    const query = filter.trim()
    const request = workspaceSearchRequest.current + 1
    workspaceSearchRequest.current = request
    if (!expanded || !toolsVisible || !cwd || query.length === 0) {
      setSearchingFiles(false)
      return
    }

    const timer = window.setTimeout(() => {
      const search = async (): Promise<void> => {
        setSearchingFiles(true)
        const pending: Array<{ path: string; depth: number }> = [{ path: cwd, depth: 0 }]
        const visited = new Set<string>()
        const maximumDirectories = 240
        const maximumDepth = 12

        while (
          pending.length > 0 &&
          visited.size < maximumDirectories &&
          workspaceSearchRequest.current === request
        ) {
          const batch: Array<{ path: string; depth: number }> = []
          while (batch.length < 6 && pending.length > 0 && visited.size < maximumDirectories) {
            const next = pending.shift()
            if (!next || visited.has(next.path)) continue
            visited.add(next.path)
            batch.push(next)
          }
          if (batch.length === 0) break

          await Promise.all(batch.map(async ({ path, depth }) => {
            await loadDirectory(path)
            if (workspaceSearchRequest.current !== request || depth >= maximumDepth) return
            const state = directoriesRef.current[path]
            if (!state || state.status !== 'ready') return
            for (const entry of state.entries) {
              if (
                entry.isDirectory &&
                !visited.has(entry.path) &&
                !isWorkspaceNavigatorRecursiveSearchExcluded(entry)
              ) {
                pending.push({ path: entry.path, depth: depth + 1 })
              }
            }
          }))
        }
      }

      void search().finally(() => {
        if (workspaceSearchRequest.current === request) setSearchingFiles(false)
      })
    }, 120)

    return () => {
      window.clearTimeout(timer)
      if (workspaceSearchRequest.current === request) workspaceSearchRequest.current += 1
    }
  }, [cwd, expanded, filter, loadDirectory, toolsVisible])

  const watchedPaths = JSON.stringify({
    files: documentState.documents.map((doc) => doc.path).slice(0, 64).sort(),
    directories: expanded ? [...expandedDirectories].slice(0, 64).sort() : []
  })
  useEffect(() => {
    if (!cwd || typeof window.codex.watchWorkspacePaths !== 'function') return
    const paths = JSON.parse(watchedPaths) as { files: string[]; directories: string[] }
    if (!paths.files.length && !paths.directories.length) return
    setWatchError(null)
    const close = subscribeWorkspaceChanges(window.codex, { root: cwd, ...paths }, (change) => {
      for (const path of change.directories) if (directoriesRef.current[path]) void loadDirectory(path, true)
      for (const path of change.files) void documentsStore.reload(path)
    }, (error) => setWatchError(workspaceErrorMessage(error)), () => {
      // The native watches must be installed before this baseline read. It
      // covers changes while the retained chat had no owner or was subscribing.
      for (const path of paths.files) void documentsStore.reload(path)
      for (const path of paths.directories) if (directoriesRef.current[path]) void loadDirectory(path, true)
    })
    return close
  }, [cwd, expanded, watchedPaths, watchRetry, loadDirectory, documentsStore])

  useEffect(() => {
    const showDiff = (event: Event): void => {
      if (!cwd) return
      const change = resolveWorkspaceDiffLink(cwd, (event as CustomEvent<unknown>).detail)
      if (!change) return
      setSelectedChange(change)
      setChangeView('selection')
      setShowSelectedDiff(true)
      setChangeSource('上一轮')
      setActiveTab('changes')
      setExpanded(true)
    }
    window.addEventListener(OPEN_WORKSPACE_DIFF_EVENT, showDiff)
    return () => window.removeEventListener(OPEN_WORKSPACE_DIFF_EVENT, showDiff)
  }, [cwd])

  useEffect(() => {
    const pin = (event: Event): void => { if (typeof (event as CustomEvent).detail === 'string') documentsStore.pin((event as CustomEvent<string>).detail) }
    const focus = (): void => { const path = documentsStore.getSnapshot().activePath; if (path && expanded) void documentsStore.reload(path) }
    window.addEventListener('codex:pin-workspace-file', pin)
    window.addEventListener('focus', focus)
    return () => { window.removeEventListener('codex:pin-workspace-file', pin); window.removeEventListener('focus', focus) }
  }, [documentsStore, expanded])

  useEffect(() => {
    if (!tabMenu) return
    const close = (): void => setTabMenu(null)
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const buttons = Array.from(
        tabMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []
      )
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
    const focusFrame = window.requestAnimationFrame(() => {
      tabMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [tabMenu])

  useEffect(() => {
    if (expanded && cwd) for (const path of expandedDirectories) void loadDirectory(path)
  }, [cwd, expanded, expandedDirectories, loadDirectory])

  useEffect(() => {
    const handleWorkspaceFileLink = (event: Event): void => {
      if (!cwd) return
      const detail = (event as CustomEvent<WorkspaceFileLink>).detail
      if (!detail || typeof detail.path !== 'string') return
      const resolvedPath = resolveWorkspaceFileLink(cwd, detail.path)
      if (!resolvedPath) return
      const line =
        Number.isSafeInteger(detail.line) && (detail.line ?? 0) > 0 ? detail.line : null
      setActiveTab('files')
      setExpanded(true)
      void openFile(resolvedPath, line)
    }
    window.addEventListener(OPEN_WORKSPACE_FILE_EVENT, handleWorkspaceFileLink)
    return () => window.removeEventListener(OPEN_WORKSPACE_FILE_EVENT, handleWorkspaceFileLink)
  }, [cwd, openFile])

  useEffect(() => {
    const handleSourceImage = (event: Event): void => {
      const path = (event as CustomEvent<unknown>).detail
      if (typeof path !== 'string' || !path.trim()) return
      setExpanded(true)
      void openSourceImage(path)
    }
    window.addEventListener(OPEN_WORKSPACE_SOURCE_IMAGE_EVENT, handleSourceImage)
    return () => window.removeEventListener(OPEN_WORKSPACE_SOURCE_IMAGE_EVENT, handleSourceImage)
  }, [openSourceImage])

  useEffect(() => {
    const showContent = (event: Event): void => {
      const requested = (event as CustomEvent<{ tab?: WorkspaceToolTab }>).detail?.tab
      if (requested === 'changes') setChangeView('overview')
      setActiveTab(
        requested === 'changes'
        || requested === 'output'
        || requested === 'sources'
        || requested === 'subagents'
          ? requested
          : 'files'
      )
      setExpanded(true)
    }
    const closeContent = (): void => setExpanded(false)
    const closeActiveContent = (): void => {
      const path = documentsStore.getSnapshot().activePath
      const action = workspacePaneCloseAction({
        activeTab,
        hasDisplayedChange: Boolean(activeTab === 'changes' && changeView === 'selection' && selectedChange),
        hasSourceImage: Boolean(sourceImage),
        hasActiveDocument: Boolean(path)
      })
      if (action === 'close-summary') {
        closeToolTab(activeTab)
        return
      }
      if (action === 'close-change') {
        setSelectedChange(null)
        setChangeView('overview')
        setShowSelectedDiff(true)
        setActiveTab('files')
        return
      }
      if (action === 'close-source-image') {
        sourceImageRequest.current += 1
        setSourceImage(null)
        return
      }
      if (action === 'close-document' && path) {
        void documentsStore.close(path).then((closed) => {
          if (!closed) setCloseFailure(path)
          else if (!documentsStore.getSnapshot().documents.length) setExpanded(false)
        })
        return
      }
      setExpanded(false)
    }
    window.addEventListener(OPEN_WORKSPACE_CONTENT_EVENT, showContent)
    window.addEventListener(CLOSE_WORKSPACE_CONTENT_EVENT, closeContent)
    window.addEventListener(CLOSE_WORKSPACE_FILE_EVENT, closeActiveContent)
    return () => {
      window.removeEventListener(OPEN_WORKSPACE_CONTENT_EVENT, showContent)
      window.removeEventListener(CLOSE_WORKSPACE_CONTENT_EVENT, closeContent)
      window.removeEventListener(CLOSE_WORKSPACE_FILE_EVENT, closeActiveContent)
    }
  }, [activeTab, changeView, documentsStore, selectedChange, sourceImage, openedToolTabs])

  const toggleLayout = (): void => {
    const next = effectiveLayoutMode === 'full' ? 'split' : 'full'
    setLocalLayoutMode(next)
    onLayoutModeChange?.(next)
  }

  const openSummary = (kind: WorkspaceSummaryItem['kind']): void => {
    if (kind === 'changes') setChangeView('overview')
    setActiveTab(summaryTab(kind))
    setExpanded(true)
  }

  const toggleDirectory = (path: string): void => {
    const willExpand = !expandedDirectories.has(path)
    setExpandedDirectories((current) => {
      const next = new Set(current)
      if (willExpand) next.add(path)
      else next.delete(path)
      return next
    })
    if (willExpand) void loadDirectory(path)
  }

  const selectChange = (change: WorkspaceChangeEntry): void => {
    setSelectedChange(change)
    setChangeView('selection')
    setShowSelectedDiff(true)
    setChangeSource('上一轮')
    setActiveTab('changes')
  }
  const retainedChange = selectedChange
    ? snapshot.changes.find((change) => workspaceChangesMatch(cwd, selectedChange, change)) || selectedChange
    : null
  const selectedChangeViewActive = activeTab === 'changes' && changeView === 'selection' && Boolean(retainedChange)
  const displayedChange = selectedChangeViewActive && showSelectedDiff ? retainedChange : null
  const previewingSelectedChange = selectedChangeViewActive && !showSelectedDiff
  useEffect(() => {
    if (!displayedChange) setChangeSourceMenu(false)
  }, [displayedChange])
  const chromeState = useMemo<WorkspaceChromeState>(() => {
    const fileTabs: WorkspaceChromeTab[] = documentState.documents.map((doc) => ({
      id: `file:${doc.id}`,
      label: workspacePathName(doc.path),
      kind: 'file',
      path: doc.path,
      dirty: documentIsDirty(doc)
    }))
    const changesTab: WorkspaceChromeTab = { id: 'changes', label: '变更', kind: 'changes' }
    const retainedChangeTab: WorkspaceChromeTab | null = retainedChange
      ? { id: `change:${retainedChange.id}`, label: workspacePathName(retainedChange.path), kind: 'changes', path: retainedChange.path }
      : null
    const visibleFileTabs = previewingSelectedChange && retainedChange
      ? fileTabs.filter((tab) => tab.path !== retainedChange.path)
      : fileTabs
    const retainedTabs: WorkspaceChromeTab[] = [
      ...openedToolTabs.map((id): WorkspaceChromeTab => id === 'changes' ? changesTab : { id, label: id === 'sources' ? '来源' : id === 'subagents' ? '子智能体' : '输出', kind: id as WorkspaceChromeState['kind'] }),
      ...(retainedChangeTab ? [retainedChangeTab] : []),
      ...visibleFileTabs
    ]
    let active: WorkspaceChromeTab
    if (activeTab === 'sources') active = { id: 'sources', label: '来源', kind: 'sources' }
    else if (activeTab === 'subagents') active = { id: 'subagents', label: '子智能体', kind: 'subagents' }
    else if (activeTab === 'changes') active = changeView === 'selection' && retainedChangeTab ? retainedChangeTab : changesTab
    else if (activeTab === 'output') active = { id: 'output', label: '输出', kind: 'output' }
    else if (sourceImage) active = { id: `source-image:${sourceImage.path}`, label: workspacePathName(sourceImage.path), kind: 'file', path: sourceImage.path }
    else if (activeDocument) active = fileTabs.find((tab) => tab.path === activeDocument.path) || { id: `file:${activeDocument.id}`, label: workspacePathName(activeDocument.path), kind: 'file', path: activeDocument.path }
    else active = { id: 'workspace', label: cwd ? workspacePathName(cwd) : 'Workspace', kind: 'workspace' }
    return {
      label: active.label,
      kind: active.kind,
      tabs: retainedTabs.some((tab) => tab.id === active.id) ? retainedTabs : [...retainedTabs, active],
      activeTabId: active.id
    }
  }, [activeDocument, activeTab, changeView, cwd, documentState.documents, previewingSelectedChange, retainedChange, openedToolTabs, sourceImage])
  useEffect(() => {
    chromeStateCallback.current?.(chromeState)
  }, [chromeState, expanded])
  useEffect(() => {
    const activateTab = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const tab = chromeState.tabs.find((entry) => entry.id === id)
      if (!tab) return
      setExpanded(true)
      if (tab.path && id.startsWith('file:')) {
        sourceImageRequest.current += 1
        setSourceImage(null)
        setActiveTab('files')
        documentsStore.activate(tab.path)
        return
      }
      if (id === 'sources') setActiveTab('sources')
      else if (id === 'subagents') setActiveTab('subagents')
      else if (id === 'output') setActiveTab('output')
      else if (id === 'changes') {
        setChangeView('overview')
        setShowSelectedDiff(true)
        setActiveTab('changes')
      } else if (id.startsWith('change:')) {
        setChangeView('selection')
        setShowSelectedDiff(true)
        setActiveTab('changes')
      }
      else setActiveTab('files')
    }
    const closeTab = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const tab = chromeState.tabs.find((entry) => entry.id === id)
      if (!tab) return
      if (['changes', 'sources', 'subagents', 'output'].includes(id)) { closeToolTab(id as WorkspaceToolTab); return }
      if (id === chromeState.activeTabId) {
        window.dispatchEvent(new CustomEvent(CLOSE_WORKSPACE_FILE_EVENT))
        return
      }
      if (id.startsWith('change:')) {
        setSelectedChange(null)
        setChangeView('overview')
        setShowSelectedDiff(true)
        if (activeTab === 'changes' && changeView === 'selection') setActiveTab('files')
        return
      }
      if (tab.path && id.startsWith('file:')) void closeFile(tab.path)
    }
    window.addEventListener(ACTIVATE_WORKSPACE_TAB_EVENT, activateTab)
    window.addEventListener(CLOSE_WORKSPACE_TAB_EVENT, closeTab)
    return () => {
      window.removeEventListener(ACTIVATE_WORKSPACE_TAB_EVENT, activateTab)
      window.removeEventListener(CLOSE_WORKSPACE_TAB_EVENT, closeTab)
    }
  }, [chromeState, documentsStore, openedToolTabs, activeTab, selectedFile, sourceImage, selectedChange, changeView])
  const closeFile = async (path: string, discard = false): Promise<void> => {
    if (!await documentsStore.close(path, discard)) setCloseFailure(path)
    else setCloseFailure(null)
  }
  const closeSummaryPanel = (): void => {
    setActiveTab(sourceImage || selectedFile ? 'files' : selectedChange ? 'changes' : 'files')
  }
  const resizeNavigator = (rawWidth: number): void => {
    setNavigatorWidthState(clampWorkspaceNavigatorWidth(rawWidth, navigatorHostWidth))
  }
  const commitNavigatorWidth = (rawWidth: number): void => {
    setNavigatorWidthState(persistWorkspaceNavigatorWidth(
      workspaceNavigatorStorage(),
      rawWidth,
      navigatorHostWidth
    ))
  }
  const toggleChangedDirectory = (path: string): void => {
    updateNavigatorSections((current) => {
      const collapsed = new Set(current.collapsedChangedPaths)
      if (collapsed.has(path)) collapsed.delete(path)
      else collapsed.add(path)
      return { ...current, collapsedChangedPaths: [...collapsed] }
    })
  }
  const toggleChangedFiles = (): void => {
    updateNavigatorSections((current) => ({
      ...current,
      changedFilesExpanded: !current.changedFilesExpanded
    }))
  }
  const toggleAllFiles = (): void => {
    updateNavigatorSections((current) => ({
      ...current,
      allFilesExpanded: !current.allFilesExpanded
    }))
  }
  const resetNavigatorWidth = (): void => commitNavigatorWidth(WORKSPACE_NAVIGATOR_DEFAULT_WIDTH)
  const showSelectedChangeFile = (): void => {
    if (!retainedChange) return
    const path = resolvedChangePath(cwd, retainedChange.path)
    if (!path) return
    setShowSelectedDiff(false)
    void openFile(path)
  }
  const refreshSelectedChange = (): void => {
    setWatchRetry((value) => value + 1)
    if (cwd) void loadDirectory(cwd, true)
    const path = retainedChange ? resolvedChangePath(cwd, retainedChange.path) : null
    if (path && documentsStore.find(path)) void documentsStore.reload(path)
  }

  const documentTabs = <div className="workspace-document-tabs" role="tablist" aria-label="打开的文件">
    {documentState.documents.map((doc) => <div key={doc.id} className={`workspace-document-tab${!displayedChange && selectedFile === doc.path ? ' is-active' : ''}${doc.preview ? ' is-preview' : ''}`} onContextMenu={(event) => { event.preventDefault(); setTabMenu({path: doc.path, x: Math.min(event.clientX, window.innerWidth - 210), y: Math.min(event.clientY, window.innerHeight - 190)}) }}>
      <button type="button" role="tab" aria-selected={!displayedChange && selectedFile === doc.path} title={doc.path} onClick={() => { setActiveTab('files'); documentsStore.activate(doc.path) }} onDoubleClick={() => documentsStore.pin(doc.path)}>
        <WorkspaceEntryIcon path={doc.path} /><span>{workspacePathName(doc.path)}</span>
      </button>
      <button type="button" className="workspace-document-close" aria-label={`关闭 ${workspacePathName(doc.path)}`} title={documentIsDirty(doc) ? '保存并关闭' : '关闭'} onClick={() => void closeFile(doc.path)}>{doc.saving ? <LoaderCircle className="spin" /> : documentIsDirty(doc) ? <span className="workspace-unsaved-dot" /> : <X />}</button>
    </div>)}
    {selectedChangeViewActive && retainedChange && <div className="workspace-document-tab is-active"><button type="button" role="tab" aria-selected="true" title={retainedChange.path}><GitCompareArrows /><span>{workspacePathName(retainedChange.path)}</span></button><button type="button" className="workspace-document-close" aria-label="关闭变更" onClick={() => { setSelectedChange(null); setChangeView('overview'); setShowSelectedDiff(true) }}><X /></button></div>}
    {activeTab === 'sources' && <div className="workspace-document-tab is-active is-summary-panel"><button type="button" role="tab" aria-selected="true" title="来源"><Link2 /><span>来源</span></button><button type="button" className="workspace-document-close" aria-label="关闭来源" onClick={closeSummaryPanel}><X /></button></div>}
    {activeTab === 'subagents' && <div className="workspace-document-tab is-active is-summary-panel"><button type="button" role="tab" aria-selected="true" title="子智能体"><Bot /><span>子智能体</span></button><button type="button" className="workspace-document-close" aria-label="关闭子智能体" onClick={closeSummaryPanel}><X /></button></div>}
  </div>
  const toolbarOpenPath = sourceImage
    ? null
    : (selectedChangeViewActive && retainedChange ? resolvedChangePath(cwd, retainedChange.path) : null)
    || selectedFile
    || cwd
    || null
  const preferredOpenTarget = readDesktopSettings().defaultFileTarget
  const primaryOpenTarget = openTargets?.find((target) => target.id === preferredOpenTarget)
    || openTargets?.[0]
    || null
  const openToolbarPath = (target: WorkspaceOpenTargetId): void => {
    if (!cwd || !toolbarOpenPath) return
    setToolbarOpenMenu(false)
    void window.codex.openWorkspacePath(cwd, toolbarOpenPath, target).catch((error) => {
      setFileActionError(workspaceErrorMessage(error))
    })
  }
  const renderToolbarActions = (editorTools?: ReactNode, leadingActions?: ReactNode): ReactNode => (
    <div className={`workspace-pane-header-actions workspace-file-actions${leadingActions ? ' is-diff' : ''}`}>
      <button
        ref={displayedChange ? changeSourceButtonRef : undefined}
        type="button"
        className={`workspace-change-switcher${displayedChange ? ' is-history' : ''}${activeTab === 'changes' ? ' is-active' : ''}`}
        aria-label={displayedChange ? changeSource : '显示更改'}
        aria-haspopup={displayedChange ? 'menu' : undefined}
        aria-expanded={displayedChange ? changeSourceMenu : undefined}
        onClick={() => {
          if (displayedChange) {
            setChangeSourceMenu((open) => !open)
            return
          }
          setActiveTab('changes')
          if (retainedChange) {
            setChangeView('selection')
            setShowSelectedDiff(true)
          } else {
            setChangeView('overview')
          }
        }}
      >
        <GitCompareArrows /><span>{displayedChange ? changeSource : '显示更改'}</span>
        {displayedChange && <ChevronDown />}
      </button>
      {displayedChange && changeSourceMenu && <div ref={changeSourceMenuRef} className="workspace-change-source-menu" role="menu" aria-label="变更来源">
        {WORKSPACE_CHANGE_SOURCES.map((source) => <button type="button" role="menuitemradio" aria-checked={source === changeSource} key={source}
          onClick={() => { setChangeSource(source); setChangeSourceMenu(false) }}>
          <span>{source}</span>{source === changeSource && <Check />}
        </button>)}
      </div>}
      <WorkspaceToolbarControls onPresentationChange={resetToolbarOpenMenu}>{leadingActions ? <div className="workspace-diff-native-controls">
        {leadingActions}
        {editorTools}
        <button
          type="button"
          className={toolsVisible ? 'is-active' : ''}
          aria-label={toolsVisible ? '隐藏文件' : '显示文件'}
          aria-pressed={toolsVisible}
          title={toolsVisible ? '隐藏文件' : '显示文件'}
          onClick={() => setToolsVisible((visible) => !visible)}
        ><Folder /></button>
      </div> : <div className="workspace-open-controls">
        {editorTools || <button
          type="button"
          aria-label="筛选文件"
          title="筛选文件"
          onClick={() => {
            setToolsVisible(true)
            window.requestAnimationFrame(() => {
              paneRef.current?.querySelector<HTMLInputElement>('.workspace-file-filter input')?.focus()
            })
          }}
        ><Search /></button>}
        <button
          type="button"
          className={toolsVisible ? 'is-active' : ''}
          aria-label="切换文件树"
          aria-pressed={toolsVisible}
          title="显示文件"
          onClick={() => setToolsVisible((visible) => !visible)}
        ><Folder /></button>
        <div className="workspace-open-native">
          <button
            type="button"
            className="workspace-open-primary"
            aria-label={primaryOpenTarget ? `在 ${primaryOpenTarget.label} 中打开` : '打开'}
            title={primaryOpenTarget ? `在 ${primaryOpenTarget.label} 中打开` : '没有可用的打开方式'}
            disabled={!cwd || !toolbarOpenPath || !primaryOpenTarget}
            onClick={() => primaryOpenTarget && openToolbarPath(primaryOpenTarget.id)}
          >{primaryOpenTarget && <WorkspaceOpenTargetIcon target={primaryOpenTarget.id} />}<span>打开</span></button>
          <button
            ref={toolbarOpenMenuButtonRef}
            type="button"
            className="workspace-open-dropdown"
            aria-label="选择打开方式"
            aria-haspopup="menu"
            aria-expanded={toolbarOpenMenu}
            disabled={!cwd || !toolbarOpenPath}
            onClick={() => setToolbarOpenMenu((open) => !open)}
          ><ChevronDown /></button>
        </div>
        {toolbarOpenMenu && <div ref={toolbarOpenMenuRef} className="workspace-open-target-menu" role="menu" aria-label="打开方式">
          {openTargets === null ? <button type="button" role="menuitem" disabled><LoaderCircle className="workspace-pane-spin" />正在加载…</button>
            : openTargets.length === 0 ? <div className="workspace-open-target-empty">没有可用的打开方式</div>
              : openTargets.map((target) => <button type="button" role="menuitem" key={target.id} onClick={() => openToolbarPath(target.id)}>
                <WorkspaceOpenTargetIcon target={target.id} /><span>在 {target.label} 中打开</span>
              </button>)}
        </div>}
      </div>}</WorkspaceToolbarControls>
    </div>
  )
  const changeSummary = summaryItems.find((item) => item.kind === 'changes') || {
    kind: 'changes' as const,
    label: '变更',
    detail: snapshot.updating || loading ? '正在更新' : '查看工作区变更'
  }
  const collapsedSummaryItems = [
    changeSummary,
    ...summaryItems.filter((item) => item.kind === 'collaboration' || item.kind === 'sources')
  ]
  const compactSummary = collapsedSummaryItems.length === 1
  const collapsedSummaryLabel = collapsedSummaryItems
    .map((item) => `${item.label} ${item.detail}`)
    .join(' · ')
  const sourcePreview = snapshot.sources.slice(0, 3)
  const previewPath = sourceImage?.path || selectedFile
  const previewFile = sourceImage?.file || file
  const previewTargetLine = sourceImage ? null : targetLine

  if (!expanded) {
    return (
      <aside
        className={`workspace-pane workspace-pane-collapsed output-panel${compactSummary ? ' is-compact' : ' is-detailed'}${workbenchVisible ? '' : ' is-workbench-inactive'}`}
        aria-label="Workspace summary"
        data-summary-panel-variant="summary"
        data-summary-panel-density={compactSummary ? 'compact' : 'detailed'}
        data-workspace-layout={effectiveLayoutMode}
        data-workspace-primary={surfaceLayout.primarySurface}
      >
        <div className="workspace-pane-summary-header">
          <button type="button" className="workspace-pane-section-title" aria-expanded="false" onClick={() => { setActiveTab('files'); setExpanded(true) }}>
            <span>{cwd ? workspacePathName(cwd) : 'Workspace'}</span>
          </button>
          <button type="button" className="workspace-pane-summary-menu" aria-label="操作" title="操作" onClick={() => { setActiveTab('files'); setExpanded(true) }}>
            <MoreHorizontal />
          </button>
        </div>
        <div className="workspace-pane-summary-sections" role="group" aria-label={collapsedSummaryLabel}>
          {collapsedSummaryItems.map((item) => {
            const tab = summaryTab(item.kind)
            if (item.kind === 'collaboration') {
              const visibleAgents = Math.min(3, Math.max(1, snapshot.collaboration.activeAgents))
              const primary = snapshot.collaboration.activeAgents > 0
                ? `${snapshot.collaboration.activeAgents} 个运行中`
                : snapshot.collaboration.completedAgents > 0
                  ? '全部完成'
                  : item.detail
              return (
                <div className="workspace-pane-summary-section is-collaboration" data-summary-kind={item.kind} key={item.kind}>
                  <button
                    type="button"
                    className="workspace-pane-summary-section-trigger"
                    data-summary-tab={tab}
                    data-slot="thread-summary-panel-item-trigger"
                    aria-label={`${item.label}，${primary}${snapshot.collaboration.completedAgents > 0 ? `，${snapshot.collaboration.completedAgents} 完成` : ''}`}
                    onClick={() => openSummary(item.kind)}
                  >
                    <span className="workspace-pane-summary-section-heading">{item.label}</span>
                    <span className="workspace-pane-agent-summary">
                      <span className="workspace-pane-agent-stack" aria-hidden="true">
                        {Array.from({ length: visibleAgents }, (_, index) => <span key={index}><Bot /></span>)}
                      </span>
                      <strong>{primary}</strong>
                      {snapshot.collaboration.completedAgents > 0 && <small>{snapshot.collaboration.completedAgents} 完成</small>}
                    </span>
                  </button>
                </div>
              )
            }

            if (item.kind === 'sources') {
              return (
                <div className="workspace-pane-summary-section is-sources" data-summary-kind={item.kind} key={item.kind}>
                  <button
                    type="button"
                    className="workspace-pane-summary-section-trigger"
                    data-summary-tab={tab}
                    data-slot="thread-summary-panel-item-trigger"
                    aria-label={`${item.label}，${item.detail}`}
                    onClick={() => openSummary(item.kind)}
                  >
                    <span className="workspace-pane-summary-section-heading">
                      <span>{item.label}</span>
                      <Plus aria-hidden="true" />
                    </span>
                    <span className="workspace-pane-source-preview">
                      {sourcePreview.map((source) => (
                        <span className={`workspace-pane-source-preview-row is-${source.kind}`} key={source.id}>
                          <span className="workspace-pane-source-preview-icon"><WorkspaceSourceIcon kind={source.kind} /></span>
                          <span>{source.label}</span>
                        </span>
                      ))}
                    </span>
                    <span className="workspace-pane-summary-view-all"><Link2 />查看全部</span>
                  </button>
                </div>
              )
            }

            return (
              <div className={`workspace-pane-summary-section is-${item.kind}`} data-summary-kind={item.kind} key={item.kind}>
                <button
                  type="button"
                  className="workspace-pane-summary-section-trigger"
                  data-summary-tab={tab}
                  data-slot="thread-summary-panel-item-trigger"
                  aria-label={`${item.label}，${item.detail}`}
                  onClick={() => openSummary(item.kind)}
                >
                  <SquarePlus />
                  <span>{item.label}</span>
                </button>
              </div>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside
      ref={paneRef}
      className={`workspace-pane workspace-pane-expanded${unifiedChrome ? ' workspace-pane-unified' : ''}${workbenchVisible ? '' : ' is-workbench-inactive'}`}
      role={unifiedChrome ? 'tabpanel' : undefined}
      aria-label="Workspace"
      data-app-shell-tab-panel-controller={unifiedChrome ? 'right' : undefined}
      data-workspace-layout={effectiveLayoutMode}
      data-workspace-primary={surfaceLayout.primarySurface}
      style={{ '--workspace-navigator-width': `${navigatorWidth}px` } as CSSProperties}
    >
      {effectiveLayoutMode === 'split' && resizeHandle}
      {chromeTarget ? <WorkspaceTitlebar target={chromeTarget} pane={paneRef} layoutMode={effectiveLayoutMode}>
        {documentState.documents.length || displayedChange || activeTab === 'sources' || activeTab === 'subagents'
          ? documentTabs
          : <div className="workspace-pane-file-tab"><Folder /><span>{cwd ? workspacePathName(cwd) : 'Workspace'}</span></div>}
        <button type="button" className="workspace-titlebar-add" aria-label="Open workspace file" title="打开文件" onClick={() => { setActiveTab('files'); setToolsVisible(true); window.requestAnimationFrame(() => paneRef.current?.querySelector<HTMLInputElement>('.workspace-file-filter input')?.focus()) }}><SquarePlus /></button>
        <div className="workspace-titlebar-controls">
          {surfaceLayout.contentFullWidth && <button type="button" aria-label="Back to chat" title="返回聊天" onClick={() => setExpanded(false)}><MessageSquare /></button>}
          <button type="button" aria-label="Toggle workspace full view" aria-pressed={effectiveLayoutMode === 'full'} title={effectiveLayoutMode === 'full' ? '拆分视图' : '全屏视图'} onClick={toggleLayout}>{effectiveLayoutMode === 'full' ? <PanelsTopLeft /> : <Maximize2 />}</button>
          <button type="button" aria-label="Close workspace" title="关闭工作区" onClick={() => setExpanded(false)}><X /></button>
        </div>
      </WorkspaceTitlebar> : !integratedChrome ? <header className="workspace-pane-header">
        <div className="workspace-pane-file-tab" title={displayedChange?.path || selectedFile || cwd || 'Workspace'}>
          <FileCode2 />
          <span>{displayedChange ? workspacePathName(displayedChange.path) : selectedFile ? workspacePathName(selectedFile) : 'Workspace'}</span>
        </div>
        <div className="workspace-pane-header-actions">
          {surfaceLayout.contentFullWidth && (
            <button type="button" aria-label="Back to chat" title="Back to chat" onClick={() => setExpanded(false)}>
              <MessageSquare /><span>Chat</span>
            </button>
          )}
          <button
            type="button"
            className={activeTab === 'changes' ? 'is-active' : ''}
            aria-label="Show changes"
            onClick={() => setActiveTab('changes')}
          >
            <GitCompareArrows />
            <span>Show changes</span>
          </button>
          <button
            type="button"
            className={activeTab === 'files' ? 'is-active' : ''}
            aria-label="Show workspace files"
            onClick={() => setActiveTab('files')}
          >
            <Folder />
          </button>
          <button
            type="button"
            aria-label="Toggle workspace full view"
            aria-pressed={effectiveLayoutMode === 'full'}
            title={effectiveLayoutMode === 'full' ? 'Split view' : 'Full view'}
            onClick={toggleLayout}
          >
            {effectiveLayoutMode === 'full' ? <PanelsTopLeft /> : <Maximize2 />}
          </button>
          <button type="button" aria-label="Close workspace" onClick={() => setExpanded(false)}>
            <X />
          </button>
        </div>
      </header> : null}

      {!chromeTarget && !integratedChrome && documentState.documents.length > 0 && documentTabs}
      {fileMenu && cwd && <WorkspaceFileContextMenu menu={fileMenu} onClose={() => setFileMenu(null)}
        onOpen={(target) => window.codex.openWorkspacePath(cwd, fileMenu.path, target)}
        onSaveAs={async () => { const doc = documentsStore.find(fileMenu.path); await window.codex.saveWorkspaceFileCopy(cwd, fileMenu.path, doc?.result?.kind === 'text' ? doc.text : undefined) }}
        onAdd={() => dispatchWorkspaceReference({ kind: 'file', root: cwd, path: fileMenu.path })}
        onError={(error) => setFileActionError(workspaceErrorMessage(error))} />}
      {fileActionError && <div className="workspace-editor-conflict" role="alert"><CircleAlert /><span>{fileActionError}</span><button onClick={() => setFileActionError(null)}>关闭</button></div>}
      {watchError && <div className="workspace-editor-conflict" role="status"><CircleAlert /><span>无法监听文件变更：{watchError}</span><button onClick={() => setWatchRetry((value) => value + 1)}>重试</button></div>}
      {tabMenu && <div ref={tabMenuRef} className="workspace-tab-context-menu" role="menu" aria-label="标签页操作" style={{left: tabMenu.x, top: tabMenu.y}} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { documentsStore.pin(tabMenu.path); setTabMenu(null) }}>保留标签页</button>
        <button type="button" role="menuitem" onClick={() => { void closeFile(tabMenu.path); setTabMenu(null) }}>关闭</button>
        <button type="button" role="menuitem" onClick={() => { void (async () => { for (const doc of documentState.documents) if (doc.path !== tabMenu.path && !await documentsStore.close(doc.path)) { setCloseFailure(doc.path); break } })(); setTabMenu(null) }}>关闭其他标签页</button>
        <button type="button" role="menuitem" onClick={() => { void (async () => { const index = documentState.documents.findIndex((doc) => doc.path === tabMenu.path); for (const doc of documentState.documents.slice(index + 1)) if (!await documentsStore.close(doc.path)) { setCloseFailure(doc.path); break } })(); setTabMenu(null) }}>关闭右侧标签页</button>
        <button type="button" role="menuitem" onClick={() => {
          const path = tabMenu.path
          setTabMenu(null)
          void Promise.resolve().then(() => copyTextToClipboard(path)).catch((error) => {
            setFileActionError(workspaceErrorMessage(error))
          })
        }}>复制路径</button>
      </div>}
      {closeFailure && <div className="workspace-editor-conflict" role="alert"><CircleAlert /><span>无法保存 {workspacePathName(closeFailure)}。更改已保留。</span><button onClick={() => void closeFile(closeFailure)}>重试</button><button onClick={() => void closeFile(closeFailure, true)}>放弃更改并关闭</button><button onClick={() => setCloseFailure(null)}>取消</button></div>}

      {summaryItems.length > 0 && !activeDocument && !displayedChange && activeTab !== 'sources' && activeTab !== 'subagents' && (
        <nav className="workspace-pane-overview" aria-label="Workspace activity summary">
          {summaryItems.map((item) => {
            const tab = summaryTab(item.kind)
            return (
              <button
                type="button"
                className={activeTab === tab ? 'is-active' : ''}
                key={item.kind}
                onClick={() => setActiveTab(tab)}
              >
                <WorkspaceSummaryIcon kind={item.kind} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <ChevronRight />
              </button>
            )
          })}
        </nav>
      )}

      <div className="workspace-pane-body" ref={setToolbarHost}>
        {activeTab === 'sources' ? (
          <SourcesSidePanel
            snapshot={snapshot}
            sources={panelModel.sources}
            onOpenFile={(path) => {
              setActiveTab('files')
              void openFile(path)
            }}
            onOpenImage={(path) => void openSourceImage(path)}
            onOpenWeb={(url) => {
              void window.codex.openExternal(url).catch((error) => {
                setFileActionError(workspaceErrorMessage(error))
              })
            }}
            onClose={closeSummaryPanel}
          />
        ) : activeTab === 'subagents' ? (
          <SubagentsSidePanel
            snapshot={snapshot}
            subagents={panelModel.subagents}
            onSelectAgent={(threadId, name) => {
              if (sourceImage || selectedFile || selectedChange) closeSummaryPanel()
              else setExpanded(false)
              onOpenSubagent?.(threadId, name)
            }}
            onClose={closeSummaryPanel}
          />
        ) : <>
          {activeTab === 'output' ? <section className="workspace-code-viewer workspace-tool-view" aria-label="命令输出">
            <header className="workspace-code-toolbar">
              <div className="workspace-breadcrumbs"><TerminalSquare /><span>命令输出</span></div>
              {unifiedChrome ? renderToolbarActions() : null}
            </header>
            <div className="workspace-tool-view-content">
              <OutputView commands={snapshot.commands} />
            </div>
          </section> : activeTab === 'changes' && !displayedChange && !previewingSelectedChange ? <section className="workspace-code-viewer workspace-tool-view" aria-label="所有更改">
            <header className="workspace-code-toolbar">
              <div className="workspace-breadcrumbs"><GitCompareArrows /><span>所有更改</span></div>
              {unifiedChrome ? renderToolbarActions() : null}
            </header>
            <div className="workspace-tool-view-content">
              {isUpdating && (
                <div className="workspace-pane-loading" role="status">
                  <LoaderCircle className="workspace-pane-spin" />
                  <span>{loading ? '正在载入工作区…' : '工作区正在更新…'}</span>
                </div>
              )}
              <ChangesView changes={snapshot.changes} selectedChange={null} cwd={cwd} onSelect={selectChange} />
            </div>
          </section> : displayedChange ? <WorkspaceDiffViewer key={displayedChange.id} change={displayedChange} cwd={cwd}
            toolbarActions={unifiedChrome ? (leadingControls, fileControls) => renderToolbarActions(fileControls, leadingControls) : undefined}
            comments={comments} onCommentsChange={onCommentsChange} commentScopeKey={commentScopeKey}
            onRefresh={refreshSelectedChange}
            toolbarTarget={unifiedChrome ? toolbarHost : undefined}
            onOpenFile={showSelectedChangeFile} onSelectFile={openBreadcrumbFile} /> : activeDocument?.status === 'ready' && activeDocument.result?.kind === 'text' && !sourceImage ? <div className="workspace-editor-stack">
              {documentState.documents.filter((doc) => doc.status === 'ready' && doc.result?.kind === 'text').map((doc) => <WorkspaceTextEditor key={doc.id} document={doc} store={documentsStore} active={doc.path === selectedFile} onSelectFile={openBreadcrumbFile} toolbarTarget={unifiedChrome ? toolbarHost : undefined} toolbarActions={unifiedChrome ? renderToolbarActions : undefined} />)}
            </div> : <CodeViewer
            cwd={cwd}
            path={previewPath}
            file={previewFile}
            targetLine={previewTargetLine}
            onSelectFile={sourceImage ? undefined : openBreadcrumbFile}
            toolbarTarget={unifiedChrome ? toolbarHost : undefined}
            onRetry={() => sourceImage ? void openSourceImage(sourceImage.path) : selectedFile && void documentsStore.reload(selectedFile)}
            toolbarActions={unifiedChrome ? renderToolbarActions() : undefined}
          />}

          {toolsVisible && <>
            <RightWorkbenchResizeHandle
              className="workspace-navigator-resize-handle"
              ariaLabel="调整文件导航宽度"
              width={navigatorWidth}
              minimumWidth={WORKSPACE_NAVIGATOR_MIN_WIDTH}
              maximumWidth={Number.isFinite(navigatorMaximumWidth) ? navigatorMaximumWidth : 1_000}
              defaultWidth={WORKSPACE_NAVIGATOR_DEFAULT_WIDTH}
              onResize={resizeNavigator}
              onResizeEnd={commitNavigatorWidth}
              onReset={resetNavigatorWidth}
              style={{ flex: '0 0 16px', marginInline: -8 }}
            />
            <section
              className="workspace-navigator"
              aria-label="文件导航"
            >
              <div className="workspace-file-filter">
                <Search />
                <input
                  value={filter}
                  placeholder="筛选文件…"
                  aria-label="筛选工作区文件"
                  onChange={(event) => setFilter(event.target.value)}
                />
                {filter && <button
                  type="button"
                  aria-label="清除文件筛选"
                  title="清除文件筛选"
                  onClick={() => {
                    setFilter('')
                    window.requestAnimationFrame(() => {
                      paneRef.current?.querySelector<HTMLInputElement>('.workspace-file-filter input')?.focus()
                    })
                  }}
                ><X /></button>}
              </div>
              <button
                type="button"
                className={`workspace-navigator-all-changes${activeTab === 'changes' && changeView === 'overview' ? ' is-active' : ''}`}
                aria-current={activeTab === 'changes' && changeView === 'overview' ? 'page' : undefined}
                onClick={() => { setChangeView('overview'); setActiveTab('changes') }}
              >
                <ListTree />
                <span>所有更改</span>
              </button>
              <div className="workspace-navigator-scroll">
                <section className={`workspace-navigator-section${changedFilesExpanded ? ' is-expanded' : ''}`}>
                  <button
                    type="button"
                    className="workspace-navigator-section-heading"
                    aria-expanded={changedFilesExpanded}
                    onClick={toggleChangedFiles}
                  >
                    {changedFilesExpanded ? <ChevronDown /> : <ChevronRight />}
                    <span>已更改的文件</span>
                    {snapshot.changes.length > 0 && <span className="workspace-navigator-change-dot" aria-label={`${snapshot.changes.length} 个已更改文件`} />}
                  </button>
                  {changedFilesExpanded && <WorkspaceChangedFiles
                    changes={snapshot.changes}
                    selectedChange={selectedChangeViewActive ? retainedChange : null}
                    cwd={cwd}
                    filter={filter}
                    collapsedPaths={collapsedChangedPaths}
                    onSelect={selectChange}
                    onToggleDirectory={toggleChangedDirectory}
                  />}
                </section>
                <section className={`workspace-navigator-section${allFilesExpanded ? ' is-expanded' : ''}`}>
                  <button
                    type="button"
                    className="workspace-navigator-section-heading"
                    aria-expanded={allFilesExpanded}
                    onClick={toggleAllFiles}
                  >
                    {allFilesExpanded ? <ChevronDown /> : <ChevronRight />}
                    <span>所有文件</span>
                    {searchingFiles && <LoaderCircle className="workspace-navigator-search-spinner workspace-pane-spin" aria-label="正在搜索文件" />}
                  </button>
                  {allFilesExpanded && (cwd ? (
                    <FileTreeView
                      cwd={cwd}
                      directories={directories}
                      expandedDirectories={expandedDirectories}
                      selectedFile={selectedFile}
                      filter={filter}
                      searchPaths={filter.trim() ? searchPaths : undefined}
                      hideRoot
                      onToggleDirectory={toggleDirectory}
                      onSelectFile={(path) => { setActiveTab('files'); void openFile(path) }}
                      onRetryDirectory={(path) => void loadDirectory(path, true)}
                      onContextMenu={(entry, x, y) => { setTabMenu(null); setFileActionError(null); setFileMenu({ ...entry, x, y }) }}
                    />
                  ) : (
                    <div className="workspace-navigator-empty">未选择工作目录</div>
                  ))}
                </section>
              </div>
            </section>
          </>}
        </>}
      </div>
    </aside>
  )
}

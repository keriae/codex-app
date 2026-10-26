import {
  ArrowDown,
  ArrowUp,
  FolderGit2,
  LoaderCircle,
  Plus,
  Search,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { buildProjectList, formatProjectUpdatedAt } from './discoveryPages'
import { ProjectActionDialog, type ProjectDialogMode } from './ProjectActionDialog'
import { ProjectArchiveDialog } from './ProjectArchiveDialog'
import { ProjectIcon } from './ProjectIcons'
import { ProjectMenu, type ProjectMenuItem } from './ProjectMenu'
import { ProjectThreadCatalog } from './projectThreadCatalog'
import { matchingProjectThreads, projectArchiveMessage, projectRowClickToggles, projectThreadsForPath, projectThreadTimestamp, projectThreadTitle, visibleProjectThreads, PROJECT_RECENT_CHAT_PAGE_SIZE, type ProjectArchiveResult } from './projectThreadsState'
import { threadHasActiveSidebarTurn } from './sidebarModel'
import {
  orderProjectPanelEntries,
  parseProjectPanelSort,
  PROJECTS_PANEL_SORT_KEY,
  visibleProjectPanelPaths,
  type ProjectEdit,
  type ProjectPanelSort
} from './projectPanelState'
import type { Thread } from './protocol'
import './DiscoveryPages.css'
import './ProjectsPanel.css'

export type { ProjectArchiveResult } from './projectThreadsState'

export interface ProjectsPanelProps {
  paths: string[]
  currentPath: string | null
  threads?: Thread[]
  projectNames?: Readonly<Record<string, string>>
  hiddenPaths?: readonly string[]
  pinnedPaths?: readonly string[]
  runningThreadIds?: readonly string[]
  pinnedThreadIds?: readonly string[]
  onAddProject(): void | Promise<void>
  onBackToChats(): void
  onSelectProject?(path: string): void | boolean | Promise<void | boolean>
  onRenameProject?(path: string, name: string): void | Promise<void>
  onEditProject?(path: string, update: ProjectEdit): void | Promise<void>
  onRemoveProject?(path: string): void | Promise<void>
  onToggleProjectPinned?(path: string, pinned: boolean): void | Promise<void>
  onOpenThread?(threadId: string, cwd: string): void | boolean | Promise<void | boolean>
  onLoadProjectThreads?(path: string): Promise<readonly Thread[]>
  onArchiveProjectThreads?(path: string): Promise<ProjectArchiveResult>
  onToggleThreadPinned?(thread: Thread): void | Promise<void>
  onArchiveThread?(thread: Thread): void | boolean | Promise<void | boolean>
  onRenameThread?(thread: Thread): void
}

type OpenProjectMenu =
  | { kind: 'sort'; trigger: HTMLButtonElement }
  | { kind: 'project'; path: string; trigger: HTMLButtonElement }
  | { kind: 'thread'; path: string; threadId: string; trigger: HTMLButtonElement }

interface OpenProjectDialog {
  mode: ProjectDialogMode
  project: ProjectEdit
}

interface OpenArchiveDialog {
  project: ProjectEdit
  frozen?: { count: number; running: boolean }
}

const EMPTY_PATHS: readonly string[] = []
const EMPTY_THREADS: Thread[] = []

export function ProjectsPanel({
  paths,
  currentPath,
  threads = EMPTY_THREADS,
  projectNames,
  hiddenPaths = EMPTY_PATHS,
  pinnedPaths = EMPTY_PATHS,
  runningThreadIds = EMPTY_PATHS,
  pinnedThreadIds = EMPTY_PATHS,
  onAddProject,
  onBackToChats,
  onSelectProject,
  onRenameProject,
  onEditProject,
  onRemoveProject,
  onToggleProjectPinned,
  onOpenThread,
  onLoadProjectThreads,
  onArchiveProjectThreads,
  onToggleThreadPinned,
  onArchiveThread,
  onRenameThread
}: ProjectsPanelProps): ReactNode {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectPanelSort>(() => {
    if (typeof window === 'undefined') return parseProjectPanelSort(null)
    try { return parseProjectPanelSort(window.localStorage.getItem(PROJECTS_PANEL_SORT_KEY)) } catch { return parseProjectPanelSort(null) }
  })
  const [menu, setMenu] = useState<OpenProjectMenu | null>(null)
  const [dialog, setDialog] = useState<OpenProjectDialog | null>(null)
  const [archiveDialog, setArchiveDialog] = useState<OpenArchiveDialog | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busyPaths, setBusyPaths] = useState<ReadonlySet<string>>(new Set())
  const busyPathsRef = useRef(new Set<string>())
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set())
  const [recentLimits, setRecentLimits] = useState<ReadonlyMap<string, number>>(new Map())
  const [catalog] = useState(() => new ProjectThreadCatalog())
  const catalogSnapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot)
  const loaderRef = useRef(onLoadProjectThreads)
  loaderRef.current = onLoadProjectThreads
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeDialog = useCallback(() => { setDialog(null); setDialogError(null) }, [])
  const closeArchiveDialog = useCallback(() => { setArchiveDialog(null); setArchiveError(null) }, [])
  const visiblePaths = useMemo(() => visibleProjectPanelPaths(paths, hiddenPaths), [paths, hiddenPaths])
  const hasCatalogLoader = Boolean(onLoadProjectThreads)

  useEffect(() => {
    catalog.setPaths(visiblePaths)
    if (loaderRef.current) {
      for (const path of visiblePaths) void catalog.load(path, loaderRef.current).catch(() => { /* Per-project load failures remain visible and retryable. */ })
    }
    setExpandedPaths((current) => new Set([...current].filter((path) => visiblePaths.includes(path))))
    setRecentLimits((current) => new Map([...current].filter(([path]) => visiblePaths.includes(path))))
  }, [catalog, visiblePaths, hasCatalogLoader])

  const projectThreads = useMemo(() => new Map(visiblePaths.map((path) => {
    const entry = catalogSnapshot.entries.get(path)
    // A complete active catalog owns membership; global summaries only hydrate its entries.
    return [path, projectThreadsForPath(path, entry?.threads ?? [], threads, catalogSnapshot.archivedThreadIds, Boolean(entry?.loaded))]
  })), [catalogSnapshot, threads, visiblePaths])

  useEffect(() => {
    try { window.localStorage.setItem(PROJECTS_PANEL_SORT_KEY, JSON.stringify(sort)) } catch { /* Keep sorting usable when local storage is unavailable. */ }
  }, [sort])

  useEffect(() => {
    const changed = (event: StorageEvent): void => {
      if (event.key === PROJECTS_PANEL_SORT_KEY || event.key === null) setSort(parseProjectPanelSort(event.newValue))
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  const projects = useMemo(
    () => orderProjectPanelEntries(buildProjectList(visiblePaths, [...projectThreads.values()].flat(), currentPath), sort, projectNames),
    [currentPath, projectNames, sort, projectThreads, visiblePaths]
  )
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return projects
    return projects.filter((project) =>
      `${project.name} ${project.path}`.toLocaleLowerCase().includes(normalizedQuery) || matchingProjectThreads(projectThreads.get(project.path) ?? [], query).length > 0
    )
  }, [projects, projectThreads, query])

  const setBusy = (path: string, busy: boolean): void => {
    if (busy) busyPathsRef.current.add(path)
    else busyPathsRef.current.delete(path)
    setBusyPaths((current) => {
      const next = new Set(current)
      if (busy) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const run = async (path: string, action: () => void | boolean | Promise<void | boolean>): Promise<boolean> => {
    if (busyPathsRef.current.has(path)) return false
    setError(null)
    setStatus(null)
    setBusy(path, true)
    try { return await action() !== false } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return false } finally { setBusy(path, false) }
  }

  const selectProject = (path: string): void => {
    if (!onSelectProject) return
    void run(path, async () => { if (await onSelectProject(path) !== false) onBackToChats() })
  }

  const openThread = (thread: Thread): void => {
    if (!onOpenThread) return
    void run(`thread:${thread.id}`, async () => { if (await onOpenThread(thread.id, thread.cwd) !== false) onBackToChats() })
  }

  const toggleProject = (path: string): void => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    const loader = loaderRef.current
    if (loader) void catalog.load(path, loader).catch(() => { /* The expanded row exposes the retry action. */ })
  }

  const openArchive = (project: ProjectEdit): void => {
    setArchiveError(null)
    setArchiveDialog({ project })
    const loader = loaderRef.current
    if (loader) void catalog.load(project.path, loader).catch(() => { /* The confirmation reads the shared catalog error. */ })
  }

  const archiveThreads = archiveDialog ? projectThreads.get(archiveDialog.project.path) ?? [] : []
  const archiveEntry = archiveDialog ? catalogSnapshot.entries.get(archiveDialog.project.path) : undefined
  const archiveLoading = hasCatalogLoader && (!archiveEntry?.loaded || archiveEntry.loading) && !archiveEntry?.error
  const archiveCount = archiveDialog?.frozen?.count ?? (archiveLoading ? null : archiveThreads.length)
  const archiveRunning = archiveDialog?.frozen?.running ?? archiveThreads.some((thread) => runningThreadIds.includes(thread.id) || threadHasActiveSidebarTurn(thread))

  const submitArchive = async (): Promise<void> => {
    if (!archiveDialog || !onArchiveProjectThreads || !archiveCount || archiveLoading || busyPathsRef.current.has(archiveDialog.project.path)) return
    const project = archiveDialog.project
    setBusy(project.path, true)
    setArchiveError(null)
    setStatus(null)
    setError(null)
    setArchiveDialog({ project, frozen: { count: archiveCount, running: archiveRunning } })
    try {
      const result = await onArchiveProjectThreads(project.path)
      catalog.removeArchived(result.archivedThreadIds, project.path)
      const outcome = projectArchiveMessage(project.name, result)
      if (outcome.failed) setError(outcome.message)
      else setStatus(outcome.message)
      closeArchiveDialog()
    } catch (failure) {
      setArchiveError(failure instanceof Error ? failure.message : String(failure))
      setArchiveDialog((current) => current?.project.path === project.path ? { project } : current)
    } finally { setBusy(project.path, false) }
  }

  const archiveThread = (thread: Thread): void => {
    if (!onArchiveThread) return
    void run(`thread:${thread.id}`, async () => {
      if (await onArchiveThread(thread) !== false) catalog.removeArchived([thread.id], thread.cwd)
    })
  }

  const openDialog = (mode: ProjectDialogMode, project: ProjectEdit): void => {
    setDialogError(null)
    setDialog({ mode, project })
  }

  const submitDialog = async (update?: ProjectEdit): Promise<void> => {
    if (!dialog || busyPathsRef.current.has(dialog.project.path)) return
    const { mode, project } = dialog
    const action = mode === 'remove' ? onRemoveProject && (() => onRemoveProject(project.path))
      : mode === 'rename' ? update && onRenameProject && (() => onRenameProject(project.path, update.name))
        : update && onEditProject && (() => onEditProject(project.path, update))
    if (!action) return
    setBusy(project.path, true)
    setDialogError(null)
    try {
      await action()
      closeDialog()
    } catch (failure) {
      setDialogError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(project.path, false)
    }
  }

  const menuProject = menu?.kind === 'project' ? projects.find((project) => project.path === menu.path) : null
  const menuThread = menu?.kind === 'thread' ? projectThreads.get(menu.path)?.find((thread) => thread.id === menu.threadId) : null
  useEffect(() => {
    if (menu?.kind === 'project' && !menuProject) closeMenu()
    if (menu?.kind === 'thread' && !menuThread) closeMenu()
  }, [closeMenu, menu, menuProject, menuThread])
  useEffect(() => {
    if (dialog && !visiblePaths.includes(dialog.project.path) && !busyPaths.has(dialog.project.path)) closeDialog()
    if (archiveDialog && !visiblePaths.includes(archiveDialog.project.path) && !busyPaths.has(archiveDialog.project.path)) closeArchiveDialog()
  }, [archiveDialog, busyPaths, closeArchiveDialog, closeDialog, dialog, visiblePaths])
  const menuItems: ProjectMenuItem[] = menu?.kind === 'sort'
    ? [
      { id: 'modified-descending', label: '最近更新', checked: sort.key === 'modified' && sort.direction === 'descending', onSelect: () => setSort({ key: 'modified', direction: 'descending' }) },
      { id: 'modified-ascending', label: '最早更新', checked: sort.key === 'modified' && sort.direction === 'ascending', onSelect: () => setSort({ key: 'modified', direction: 'ascending' }) },
      { id: 'name-ascending', label: '名称：A → Z', separatorBefore: true, checked: sort.key === 'name' && sort.direction === 'ascending', onSelect: () => setSort({ key: 'name', direction: 'ascending' }) },
      { id: 'name-descending', label: '名称：Z → A', checked: sort.key === 'name' && sort.direction === 'descending', onSelect: () => setSort({ key: 'name', direction: 'descending' }) }
    ]
    : menuProject ? [
      { id: 'edit', label: '编辑项目', icon: <ProjectIcon name="edit" />, disabled: !onEditProject || busyPaths.has(menuProject.path), onSelect: () => openDialog('edit', menuProject) },
      { id: 'archive-project-threads', label: '归档聊天', icon: <ProjectIcon name="archive" />, disabled: !onArchiveProjectThreads || busyPaths.has(menuProject.path) || !(projectThreads.get(menuProject.path)?.length), onSelect: () => openArchive(menuProject) },
      { id: 'remove', label: '移除项目', disabled: !onRemoveProject || busyPaths.has(menuProject.path), onSelect: () => openDialog('remove', menuProject) }
    ] : menuThread ? [
      ...(onRenameThread ? [{ id: 'rename-thread', label: '重命名', icon: <ProjectIcon name="thread-rename" />, disabled: busyPaths.has(`thread:${menuThread.id}`), onSelect: () => onRenameThread(menuThread) }] : []),
      ...(onToggleThreadPinned ? [{ id: 'pin-thread', label: pinnedThreadIds.includes(menuThread.id) ? '取消固定' : '固定', icon: <ProjectIcon name={pinnedThreadIds.includes(menuThread.id) ? 'thread-unpin' : 'thread-pin'} />, disabled: busyPaths.has(`thread:${menuThread.id}`), onSelect: () => { void run(`thread:${menuThread.id}`, () => onToggleThreadPinned(menuThread)) } }] : []),
      ...(onArchiveThread ? [{ id: 'archive-thread', label: '归档', icon: <ProjectIcon name="thread-archive" />, separatorBefore: true, disabled: busyPaths.has(`thread:${menuThread.id}`), onSelect: () => archiveThread(menuThread) }] : [])
    ] : []

  return (
    <main className="projects-page" aria-label="项目">
      <div className="projects-page-scroll">
        <section className="projects-page-content">
          <header className="projects-page-header">
            <h1>项目</h1>
            <div className="projects-page-actions">
              <label className="discovery-search projects-page-search">
                <Search />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索项目"
                  aria-label="搜索项目"
                />
              </label>
              <button type="button" className="discovery-primary-button" disabled={busyPaths.has('add-project')} onClick={() => void run('add-project', onAddProject)}>
                <Plus />
                <span>创建</span>
              </button>
            </div>
          </header>

          {error && <div className="projects-page-error" role="alert">{error}</div>}
          {status && <div className="projects-page-status" role="status">{status}</div>}
          <div className="projects-page-table" role="table" aria-label="项目">
            <div className="projects-page-table-head" role="row">
              <div role="columnheader" aria-sort={sort.key === 'name' ? sort.direction : 'none'}><button type="button" className="projects-page-sort" title="按名称排序" aria-label="按名称排序" onClick={() => setSort((current) => ({ key: 'name', direction: current.key === 'name' && current.direction === 'ascending' ? 'descending' : 'ascending' }))}>名称{sort.key === 'name' && (sort.direction === 'ascending' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />)}</button></div>
              <div role="columnheader" aria-sort={sort.key === 'modified' ? sort.direction : 'none'}><button type="button" className="projects-page-sort" title="项目排序" aria-label="项目排序" aria-haspopup="menu" aria-expanded={menu?.kind === 'sort'} onClick={(event) => {
                const trigger = event.currentTarget
                setMenu((current) => current?.kind === 'sort' ? null : { kind: 'sort', trigger })
              }} onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMenu({ kind: 'sort', trigger: event.currentTarget }) }
              }}>已更新{sort.key === 'modified' && (sort.direction === 'ascending' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />)}</button></div>
              <span role="columnheader" aria-label="项目操作" />
            </div>

            {filteredProjects.length > 0 ? (
              <div role="rowgroup">
                {filteredProjects.map((project) => {
                  const pinned = pinnedPaths.includes(project.path)
                  const busy = busyPaths.has(project.path)
                  const recentThreads = projectThreads.get(project.path) ?? []
                  const matchingThreads = matchingProjectThreads(recentThreads, query)
                  const searchExpanded = matchingThreads.length > 0
                  const expanded = searchExpanded || expandedPaths.has(project.path)
                  const displayThreads = searchExpanded ? matchingThreads : recentThreads
                  const visibleThreads = visibleProjectThreads(displayThreads, recentLimits.get(project.path) ?? PROJECT_RECENT_CHAT_PAGE_SIZE)
                  const entry = catalogSnapshot.entries.get(project.path)
                  return (
                    <div className="projects-page-row-wrapper" key={project.path} data-project-row-wrapper>
                    <div className="projects-page-row" role="row" data-project-row data-project-path={project.path} data-current={project.current || undefined} data-expanded={expanded || undefined} aria-busy={busy} onClick={(event) => { if (!searchExpanded && projectRowClickToggles(event)) toggleProject(project.path) }} onDoubleClick={(event) => { if (!event.defaultPrevented && !(event.target instanceof Element && event.target.closest('button,a,input,textarea,select,[role="button"]'))) selectProject(project.path) }}>
                      <div role="cell" className="projects-page-name-cell">
                      <div
                        className="projects-page-name"
                        title={project.path}
                      >
                        <span className="projects-page-folder-icon">
                          <span className="projects-page-project-folder"><ProjectIcon name={expanded ? 'folder-open' : 'folder'} /></span>
                        </span>
                        <div className="projects-page-project-name-trailing"><span>{project.name}</span>{!searchExpanded && <button type="button" className="projects-page-project-toggle" aria-label={`展开/收起项目 ${project.name}`} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); toggleProject(project.path) }}><ProjectIcon name="chevron-down" /></button>}</div>
                      </div>
                      </div>
                      <time
                        role="cell"
                        dateTime={project.updatedAt
                          ? new Date(project.updatedAt * 1000).toISOString()
                          : undefined}
                      >
                        {formatProjectUpdatedAt(project.updatedAt)}
                      </time>
                      <div className="projects-page-row-actions" role="cell">
                        <button type="button" aria-label={`更多 ${project.name}`} title="更多" aria-haspopup="menu" aria-expanded={menu?.kind === 'project' && menu.path === project.path} onClick={(event) => {
                          const trigger = event.currentTarget
                          setMenu((current) => current?.kind === 'project' && current.path === project.path ? null : { kind: 'project', path: project.path, trigger })
                        }} onKeyDown={(event) => {
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMenu({ kind: 'project', path: project.path, trigger: event.currentTarget }) }
                        }}>
                          <ProjectIcon name="more" />
                        </button>
                        <button
                          type="button"
                          aria-label={`${pinned ? '取消固定' : '固定'} ${project.name}`}
                          title={pinned ? '取消固定' : '固定'}
                          aria-pressed={pinned}
                          disabled={!onToggleProjectPinned || busy}
                          onClick={() => { if (onToggleProjectPinned) void run(project.path, () => onToggleProjectPinned(project.path, !pinned)) }}
                        >
                          <ProjectIcon name={pinned ? 'pinned' : 'pin'} />
                        </button>
                        <button type="button" aria-label={`在项目 ${project.name} 中新建聊天`} title="新建聊天" disabled={!onSelectProject || busy} onClick={() => selectProject(project.path)}>
                          <ProjectIcon name="new-chat" />
                        </button>
                      </div>
                    </div>
                    {expanded && <div className="projects-page-recent" role="rowgroup" aria-label={`${project.name} 中的最近聊天`}>
                      {visibleThreads.map((thread) => {
                        const title = projectThreadTitle(thread)
                        const running = runningThreadIds.includes(thread.id) || threadHasActiveSidebarTurn(thread)
                        const threadBusy = busy || busyPaths.has(`thread:${thread.id}`)
                        const threadPinned = pinnedThreadIds.includes(thread.id)
                        const timestamp = projectThreadTimestamp(thread)
                        return <div className="projects-page-thread-row" role="row" key={thread.id} data-thread-id={thread.id} aria-busy={threadBusy} onClick={(event) => { if (projectRowClickToggles(event)) openThread(thread) }}>
                          <div className="projects-page-thread-name" role="cell">
                            <span className="projects-page-thread-icon">{running ? <LoaderCircle className="projects-page-running" aria-label="正在运行" /> : thread.status?.type === 'systemError' ? <span className="projects-page-thread-error" aria-label="错误">!</span> : null}</span>
                            <button type="button" className="projects-page-thread-title" title={title} disabled={!onOpenThread || threadBusy} onClick={() => openThread(thread)}>{title}</button>
                          </div>
                          <time role="cell" dateTime={timestamp ? new Date(timestamp * 1000).toISOString() : undefined}>{formatProjectUpdatedAt(timestamp || null)}</time>
                          <div className="projects-page-row-actions projects-page-thread-actions" role="cell">
                            {(onToggleThreadPinned || onRenameThread || onArchiveThread) && <button type="button" data-thread-menu-trigger aria-label={`聊天 ${title} 的操作`} title="聊天操作" aria-haspopup="menu" aria-expanded={menu?.kind === 'thread' && menu.threadId === thread.id} disabled={threadBusy} onClick={(event) => { const trigger = event.currentTarget; setMenu((current) => current?.kind === 'thread' && current.threadId === thread.id ? null : { kind: 'thread', path: project.path, threadId: thread.id, trigger }) }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMenu({ kind: 'thread', path: project.path, threadId: thread.id, trigger: event.currentTarget }) } }}><ProjectIcon name="more" /></button>}
                            {onToggleThreadPinned && <button type="button" aria-label={`${threadPinned ? '取消固定' : '固定'}聊天 ${title}`} title={threadPinned ? '取消固定' : '固定'} aria-pressed={threadPinned} disabled={threadBusy} onClick={() => void run(`thread:${thread.id}`, () => onToggleThreadPinned(thread))}><ProjectIcon name={threadPinned ? 'pinned' : 'pin'} /></button>}
                            {onOpenThread && <button type="button" aria-label={`打开聊天 ${title}`} title="打开聊天" disabled={threadBusy} onClick={() => openThread(thread)}><ProjectIcon name="open-chat" /></button>}
                          </div>
                        </div>
                      })}
                      {!visibleThreads.length && <div className="projects-page-recent-empty">{entry?.loading ? '正在加载聊天…' : '没有聊天'}</div>}
                      {entry?.error && <div className="projects-page-recent-error" role="alert">{entry.error}{onLoadProjectThreads && <button type="button" onClick={() => void catalog.load(project.path, onLoadProjectThreads, true).catch(() => {})}>重试</button>}</div>}
                      {visibleThreads.length < displayThreads.length && <div className="projects-page-recent-pagination"><button type="button" onClick={() => setRecentLimits((current) => new Map(current).set(project.path, (current.get(project.path) ?? PROJECT_RECENT_CHAT_PAGE_SIZE) + PROJECT_RECENT_CHAT_PAGE_SIZE))}>显示更多</button></div>}
                    </div>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="projects-page-empty">
                <FolderGit2 />
                <strong>{query ? '没有匹配的项目' : '还没有项目'}</strong>
                <span>{query ? '试试其他搜索词。' : '添加文件夹以开始使用 Codex。'}</span>
              </div>
            )}
          </div>
        </section>
      </div>
      {menu && menuItems.length > 0 && <ProjectMenu key={menu.kind === 'sort' ? 'sort' : menu.kind === 'thread' ? menu.threadId : menu.path} label={menu.kind === 'sort' ? '项目排序' : menu.kind === 'thread' ? '聊天操作' : `${menuProject?.name || ''} 项目操作`} trigger={menu.trigger} items={menuItems} onClose={closeMenu} />}
      {dialog && <ProjectActionDialog mode={dialog.mode} project={dialog.project} busy={busyPaths.has(dialog.project.path)} error={dialogError} onCancel={closeDialog} onSubmit={(update) => void submitDialog(update)} />}
      {archiveDialog && <ProjectArchiveDialog projectName={archiveDialog.project.name} count={archiveCount} running={archiveRunning} loading={archiveLoading} busy={busyPaths.has(archiveDialog.project.path)} error={archiveError || archiveEntry?.error || null} onCancel={closeArchiveDialog} onSubmit={() => void submitArchive()} />}
    </main>
  )
}

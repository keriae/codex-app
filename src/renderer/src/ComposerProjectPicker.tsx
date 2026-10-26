import { Check, Folder, Globe2, Monitor, Plus, Search, X } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import type { RemoteConnection, RemoteProject } from '../../shared/api'
import type { Project } from './protocol'

export interface ComposerProjectChoice {
  id: string
  label: string
  path: string
  projectKind: 'local' | 'remote'
  projectId: string
  hostId?: string
  hostDisplayName?: string
  connected?: boolean
}

export interface ComposerProjectPickerProps {
  projects: readonly Project[]
  remoteProjects?: readonly RemoteProject[]
  remoteConnections?: readonly RemoteConnection[]
  selectedLocalPath?: string | null
  selectedRemoteProjectId?: string | null
  projectlessSelected?: boolean
  onSelect(path: string): void
  onSelectRemote?(project: RemoteProject): void
  onAdd(): void
  onAddRemote?(): void
  onSelectProjectless?(): void
  onClose(): void
}

export function composerProjectChoices(
  projects: readonly Project[],
  remoteProjects: readonly RemoteProject[] = [],
  remoteConnections: readonly RemoteConnection[] = []
): ComposerProjectChoice[] {
  const choices: ComposerProjectChoice[] = []
  const paths = new Set<string>()
  for (const project of projects) {
    for (const root of project.roots) {
      if (!root.path || paths.has(root.path)) continue
      paths.add(root.path)
      choices.push({
        id: `local:${project.id}:${root.path}`,
        label: project.name || root.path.split('/').filter(Boolean).at(-1) || root.path,
        path: root.path,
        projectKind: 'local',
        projectId: project.id
      })
    }
  }

  const connections = new Map(remoteConnections.map((connection) => [connection.hostId, connection]))
  const remoteIds = new Set<string>()
  for (const project of remoteProjects) {
    if (!project.id || !project.remotePath || remoteIds.has(project.id)) continue
    remoteIds.add(project.id)
    const connection = connections.get(project.hostId)
    choices.push({
      id: `remote:${project.id}`,
      label: project.label || project.remotePath.split('/').filter(Boolean).at(-1) || project.remotePath,
      path: project.remotePath,
      projectKind: 'remote',
      projectId: project.id,
      hostId: project.hostId,
      hostDisplayName: connection?.displayName || project.hostId,
      connected: connection?.state === 'connected'
    })
  }
  return choices
}

export function filterComposerProjectChoices(
  choices: readonly ComposerProjectChoice[],
  query: string
): ComposerProjectChoice[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...choices]
  return choices.filter((choice) => [choice.label, choice.path, choice.hostDisplayName, choice.hostId]
    .some((value) => value?.toLocaleLowerCase().includes(needle)))
}

function ProjectChoiceIcon({ choice }: { choice: ComposerProjectChoice }): ReactNode {
  if (choice.projectKind === 'local') return <Folder aria-hidden="true" />
  return (
    <span className="composer-project-picker-remote-icon" aria-hidden="true">
      <Folder />
      <span data-state={choice.connected ? 'connected' : 'disconnected'}><Monitor /></span>
    </span>
  )
}

export function ComposerProjectPicker({
  projects,
  remoteProjects = [],
  remoteConnections = [],
  selectedLocalPath = null,
  selectedRemoteProjectId = null,
  projectlessSelected = false,
  onSelect,
  onSelectRemote,
  onAdd,
  onAddRemote,
  onSelectProjectless,
  onClose
}: ComposerProjectPickerProps): ReactNode {
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const choices = useMemo(
    () => composerProjectChoices(projects, remoteProjects, remoteConnections),
    [projects, remoteProjects, remoteConnections]
  )
  const filtered = useMemo(() => filterComposerProjectChoices(choices, query), [choices, query])
  const labels = useMemo(() => {
    const counts = new Map<string, number>()
    for (const choice of choices) counts.set(choice.label, (counts.get(choice.label) || 0) + 1)
    return counts
  }, [choices])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    searchRef.current?.focus({ preventScroll: true })
    const onPointerDown = (event: PointerEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (!(event.target instanceof Node) || panelRef.current?.contains(event.target)) return
      if ((event.target as Element).closest?.('[data-composer-project-trigger]')) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [onClose])

  const choose = (choice: ComposerProjectChoice): void => {
    onClose()
    if (choice.projectKind === 'remote') {
      const project = remoteProjects.find((candidate) => candidate.id === choice.projectId)
      if (project) onSelectRemote?.(project)
      return
    }
    onSelect(choice.path)
  }
  const action = (callback?: () => void): void => {
    onClose()
    callback?.()
  }
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && event.target === searchRef.current && filtered.length === 0 && query.trim()) {
      event.preventDefault()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if ((event.key === 'Home' || event.key === 'End') && event.target === searchRef.current) return
    const options = [...panelRef.current?.querySelectorAll<HTMLButtonElement>(
      '.composer-project-picker-list > button:not([disabled]), .composer-project-picker-footer > button:not([disabled])'
    ) || []]
    if (options.length === 0) return
    event.preventDefault()
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % options.length
          : current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length
    options[next].focus({ preventScroll: true })
    options[next].scrollIntoView({ block: 'nearest' })
  }

  return (
    <section ref={panelRef} className="composer-project-picker" role="dialog" aria-label="选择项目" onKeyDown={onMenuKeyDown}>
      <label className="composer-project-picker-search">
        <Search aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          autoFocus
          aria-label="搜索项目"
          placeholder="搜索项目"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="composer-project-picker-separator" />
      <div className="composer-project-picker-list" role="listbox" aria-label="项目">
        {filtered.map((choice) => {
          const selected = choice.projectKind === 'remote'
            ? choice.projectId === selectedRemoteProjectId
            : choice.path === selectedLocalPath
          const duplicateLabel = (labels.get(choice.label) || 0) > 1
          return (
            <button
              key={choice.id}
              type="button"
              role="option"
              aria-selected={selected}
              aria-disabled={choice.projectKind === 'remote' && !choice.connected}
              disabled={choice.projectKind === 'remote' && !choice.connected}
              title={choice.projectKind === 'remote' || duplicateLabel ? choice.path : choice.label}
              onClick={() => choose(choice)}
            >
              <span className={`composer-project-picker-icon is-${choice.projectKind}`}>
                <ProjectChoiceIcon choice={choice} />
              </span>
              <span className="composer-project-picker-copy">
                <strong>{choice.label}</strong>
                {choice.projectKind === 'remote' && (
                  <span className="composer-project-picker-detail">
                    <span className="composer-project-picker-host" data-state={choice.connected ? 'connected' : 'disconnected'}>
                      {choice.hostDisplayName}
                    </span>
                    <span>{choice.path}</span>
                  </span>
                )}
                {choice.projectKind === 'local' && duplicateLabel && (
                  <span className="composer-project-picker-detail"><span>{choice.path}</span></span>
                )}
              </span>
              {selected && <Check className="composer-project-picker-check" aria-hidden="true" />}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="composer-project-picker-empty">
            未找到项目
          </div>
        )}
      </div>
      <div className="composer-project-picker-footer">
        {onAddRemote && (
          <button type="button" onClick={() => action(onAddRemote)}>
            <Globe2 aria-hidden="true" />
            <span>新建远程项目</span>
          </button>
        )}
        <button type="button" onClick={() => action(onAdd)}>
          <Plus aria-hidden="true" />
          <span>新建项目</span>
        </button>
        {onSelectProjectless && (
          <button type="button" aria-pressed={projectlessSelected} onClick={() => action(onSelectProjectless)}>
            <X aria-hidden="true" />
            <span>不在项目中工作</span>
            {projectlessSelected && <Check className="composer-project-picker-check" aria-hidden="true" />}
          </button>
        )}
      </div>
    </section>
  )
}

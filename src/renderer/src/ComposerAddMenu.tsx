import {
  AppWindow,
  BookOpen,
  BriefcaseBusiness,
  FileOutput,
  FileSpreadsheet,
  FileText,
  Globe,
  GitBranch,
  LayoutTemplate,
  Lightbulb,
  Laptop,
  Monitor,
  Paperclip,
  PenTool,
  Presentation,
  Sigma,
  Sparkles,
  Target
} from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { useWindowZoom } from './windowZoom'
import type { AppContext } from '../../shared/api'
import { LocalEnvironmentIcon } from './LocalEnvironmentIcons'
import {
  computeComposerPopoverPosition,
  type ComposerPopoverPosition
} from './ComposerMenus'

export type ComposerAddMenuGroup = 'add' | 'plugins'
export type ComposerAddMenuAction =
  | 'attachments'
  | 'attach-electron'
  | 'work-project'
  | 'goal'
  | 'plan'
  | 'drawing'
  | 'plugin'

export interface ComposerAddMenuEntry {
  id: string
  group: ComposerAddMenuGroup
  label: string
  description?: string
  disabled: boolean
  action: ComposerAddMenuAction
  pluginId?: string
}

function ComposerAddIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.00049 1.9165C8.41448 1.91677 8.75049 2.25245 8.75049 2.6665V7.25049H13.3335C13.7476 7.25066 14.0835 7.58638 14.0835 8.00049C14.0832 8.41437 13.7474 8.75031 13.3335 8.75049H8.75049V13.3335C8.75031 13.7474 8.41437 14.0832 8.00049 14.0835C7.58638 14.0835 7.25066 13.7476 7.25049 13.3335V8.75049H2.6665C2.25245 8.75049 1.91677 8.41448 1.9165 8.00049C1.9165 7.58627 2.25229 7.25049 2.6665 7.25049H7.25049V2.6665C7.25049 2.25229 7.58627 1.9165 8.00049 1.9165Z" fill="currentColor" />
    </svg>
  )
}

const COMPOSER_ADD_MENU_ENTRIES: readonly ComposerAddMenuEntry[] = [
  {
    id: 'attachments',
    group: 'add',
    label: '文件和文件夹',
    disabled: false,
    action: 'attachments'
  },
  {
    id: 'attach-codex',
    group: 'add',
    label: '附加 Electron',
    disabled: false,
    action: 'attach-electron'
  },
  {
    id: 'work-project',
    group: 'add',
    label: '在项目中使用 Work',
    description: '为新聊天选择项目',
    disabled: false,
    action: 'work-project'
  },
  {
    id: 'goal',
    group: 'add',
    label: '目标',
    description: '设置要持续追求的目标',
    disabled: false,
    action: 'goal'
  },
  {
    id: 'plan',
    group: 'add',
    label: '计划模式',
    description: '开启计划模式',
    disabled: false,
    action: 'plan'
  },
  {
    id: 'drawing',
    group: 'add',
    label: '绘图',
    description: '绘制草图',
    disabled: false,
    action: 'drawing'
  },
  {
    id: 'documents',
    group: 'plugins',
    label: 'Documents',
    description: 'Create and edit documents',
    disabled: false,
    action: 'plugin',
    pluginId: 'documents'
  },
  {
    id: 'pdf',
    group: 'plugins',
    label: 'PDF',
    description: 'Read, create, and verify PDFs',
    disabled: false,
    action: 'plugin',
    pluginId: 'pdf'
  },
  {
    id: 'spreadsheets',
    group: 'plugins',
    label: 'Spreadsheets',
    description: 'Create and edit spreadsheets',
    disabled: false,
    action: 'plugin',
    pluginId: 'spreadsheets'
  },
  {
    id: 'presentations',
    group: 'plugins',
    label: 'Presentations',
    description: 'Create and edit presentations',
    disabled: false,
    action: 'plugin',
    pluginId: 'presentations'
  },
  {
    id: 'template-creator',
    group: 'plugins',
    label: 'Template Creator',
    description: 'Create or update reusable templates from reference content',
    disabled: false,
    action: 'plugin',
    pluginId: 'template-creator'
  },
  {
    id: 'browser',
    group: 'plugins',
    label: '浏览器',
    description: 'Control the in-app browser',
    disabled: false,
    action: 'plugin',
    pluginId: 'browser'
  },
  {
    id: 'computer',
    group: 'plugins',
    label: '电脑',
    description: 'Control Mac apps from ChatGPT',
    disabled: false,
    action: 'plugin',
    pluginId: 'computer'
  },
  {
    id: 'latex',
    group: 'plugins',
    label: 'LaTeX',
    description: 'Compile LaTeX with TeX tools',
    disabled: false,
    action: 'plugin',
    pluginId: 'latex'
  },
  {
    id: 'visualize',
    group: 'plugins',
    label: 'Visualize',
    description: 'Create interactive visuals',
    disabled: false,
    action: 'plugin',
    pluginId: 'visualize'
  },
  {
    id: 'zotero',
    group: 'plugins',
    label: 'Zotero',
    description: 'Find papers and add citations from Zotero',
    disabled: false,
    action: 'plugin',
    pluginId: 'zotero'
  }
]

export function composerAddMenuEntries(
  visibleActions?: readonly ComposerAddMenuAction[]
): ComposerAddMenuEntry[] {
  const visibleActionSet = visibleActions ? new Set(visibleActions) : null
  return COMPOSER_ADD_MENU_ENTRIES
    .filter((entry) => !visibleActionSet || visibleActionSet.has(entry.action))
    .map((entry) => ({ ...entry }))
}

const composerAddMenuIcons: Record<string, ReactNode> = {
  attachments: <Paperclip />,
  'attach-codex': <AppWindow />,
  'work-project': <BriefcaseBusiness />,
  goal: <Target />,
  plan: <Lightbulb />,
  drawing: <PenTool />,
  documents: <FileText />,
  pdf: <FileOutput />,
  spreadsheets: <FileSpreadsheet />,
  presentations: <Presentation />,
  'template-creator': <LayoutTemplate />,
  browser: <Globe />,
  computer: <Monitor />,
  latex: <Sigma />,
  visualize: <Sparkles />,
  zotero: <BookOpen />
}

export interface ComposerContextSegment {
  id: 'project' | 'local' | 'branch'
  label: string
  title?: string
}

function ComposerProjectFolderIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.55957 2.14136C6.06503 2.14136 6.55801 2.30207 6.9668 2.59937L7.81836 3.21851C8.04761 3.38513 8.32401 3.47534 8.60742 3.47534H12.1338C13.4545 3.47559 14.5254 4.54621 14.5254 5.86694V11.4666C14.5254 12.7873 13.4545 13.8579 12.1338 13.8582H3.86621C2.54554 13.8579 1.47461 12.7873 1.47461 11.4666V4.53296C1.47486 3.21244 2.54569 2.1416 3.86621 2.14136H5.55957ZM2.52539 7.85718V11.4666C2.52539 12.2074 3.12544 12.8081 3.86621 12.8083H12.1338C12.8746 12.8081 13.4746 12.2074 13.4746 11.4666V7.85718H2.52539ZM3.86621 3.19214C3.12559 3.19238 2.52564 3.79234 2.52539 4.53296V6.8064H13.4746V5.86694C13.4746 5.12611 12.8746 4.52539 12.1338 4.52515H8.60742C8.10203 4.52515 7.60895 4.36534 7.2002 4.06812L6.34863 3.448C6.11937 3.28135 5.84301 3.19214 5.55957 3.19214H3.86621Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function composerContextSegments(
  context: AppContext | null
): ComposerContextSegment[] {
  const remote = context?.projectKind === 'remote' || Boolean(context?.hostId && context.hostId !== 'local')
  const segments: ComposerContextSegment[] = [
    {
      id: 'project',
      label: context?.projectKind === 'projectless'
        ? '选择项目'
        : context?.folderName || '选择文件夹',
      title: context?.projectKind === 'projectless' ? undefined : context?.cwd
    },
    {
      id: 'local',
      label: remote ? context?.hostDisplayName || '远程' : '本地',
      title: remote ? context?.hostDisplayName : undefined
    }
  ]

  if (context?.branch) segments.push({ id: 'branch', label: context.branch })
  return segments
}

export function nextEnabledComposerAddMenuIndex(
  currentIndex: number,
  disabled: boolean[],
  direction: -1 | 1
): number {
  if (disabled.length === 0 || disabled.every(Boolean)) return -1

  let index = currentIndex
  for (let step = 0; step < disabled.length; step += 1) {
    if (index < 0) {
      index = direction === 1 ? 0 : disabled.length - 1
    } else {
      index = (index + direction + disabled.length) % disabled.length
    }
    if (!disabled[index]) return index
  }
  return -1
}

export function ComposerContextStrip({
  context,
  worktreeSelected,
  startingBranch,
  onPickDirectory
}: {
  context: AppContext | null
  worktreeSelected?: boolean
  startingBranch?: string | null
  onConfigureEnvironment?(): void
  onPickDirectory(): void
}): ReactNode {
  const segments = composerContextSegments(context)
  const project = segments[0]
  const projectless = context?.projectKind === 'projectless'
  const branch = worktreeSelected ? startingBranch || 'Default branch' : context?.branch

  return (
    <div className="composer-context-strip" aria-label="当前工作上下文">
      <button
        type="button"
        data-composer-project-trigger
        className="composer-context-segment composer-context-project"
        aria-label="选择项目"
        title={project.title}
        onClick={onPickDirectory}
      >
        <ComposerProjectFolderIcon />
        <span>{project.label}</span>
      </button>
      {!projectless && (
        <span className="composer-context-segment">
          {worktreeSelected
            ? <LocalEnvironmentIcon name="worktree" />
            : context?.projectKind === 'remote' || (context?.hostId && context.hostId !== 'local')
              ? <Globe />
              : <Laptop />}
          <span>{worktreeSelected ? 'Worktree' : segments[1].label}</span>
        </span>
      )}
      {branch && (
        <span className="composer-context-segment composer-context-branch" title={branch}>
          <GitBranch />
          <span>{branch}</span>
        </span>
      )}
    </div>
  )
}

export function ComposerAddMenu({
  onPickAttachments,
  onAction,
  visibleActions
}: {
  onPickAttachments(): void
  onAction?(entry: ComposerAddMenuEntry): void
  visibleActions?: readonly ComposerAddMenuAction[]
}): ReactNode {
  const menuId = useId()
  const zoom = useWindowZoom()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const initialFocusIndex = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<ComposerPopoverPosition | null>(null)

  const items = composerAddMenuEntries(visibleActions)
  const disabledItems = items.map((item) => item.disabled)
  const groupedItems = (['add', 'plugins'] as const)
    .map((group) => ({
      id: group,
      label: group === 'add' ? '添加' : '插件',
      items: items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.group === group)
    }))
    .filter((group) => group.items.length > 0)

  const focusItem = (index: number): void => {
    if (index < 0) return
    setActiveIndex(index)
    const item = itemRefs.current[index]
    item?.focus()
    item?.scrollIntoView({ block: 'nearest' })
  }

  const openMenu = (direction: -1 | 1 = 1): void => {
    initialFocusIndex.current = nextEnabledComposerAddMenuIndex(-1, disabledItems, direction)
    setOpen(true)
  }

  const closeMenu = (restoreFocus: boolean): void => {
    setOpen(false)
    setPosition(null)
    setActiveIndex(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return

    const updatePosition = (): void => {
      const triggerRect = trigger.getBoundingClientRect()
      const composerRect = trigger.closest<HTMLElement>('.composer')?.getBoundingClientRect()
      const anchor = composerRect || triggerRect
      setPosition(
        computeComposerPopoverPosition(
          anchor,
          popover.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          'start',
          6,
          8,
          zoom
        )
      )
    }

    updatePosition()
    focusItem(
      initialFocusIndex.current ?? nextEnabledComposerAddMenuIndex(-1, disabledItems, 1)
    )
    initialFocusIndex.current = null
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, zoom])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      closeMenu(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const chooseItem = (index: number): void => {
    const item = items[index]
    if (!item || item.disabled) return
    closeMenu(true)
    if (item.action === 'attachments') onPickAttachments()
    else onAction?.(item)
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(
        nextEnabledComposerAddMenuIndex(
          activeIndex,
          disabledItems,
          event.key === 'ArrowDown' ? 1 : -1
        )
      )
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusItem(
        nextEnabledComposerAddMenuIndex(-1, disabledItems, event.key === 'Home' ? 1 : -1)
      )
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      chooseItem(activeIndex)
      return
    }
    if (event.key === 'Tab') closeMenu(false)
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openMenu(event.key === 'ArrowDown' ? 1 : -1)
  }

  const popoverStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        top: position.top,
        maxHeight: Math.min(position.maxHeight, 320)
      }
    : undefined

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-control attachment-picker composer-add-menu-trigger${open ? ' is-open' : ''}`}
        title="添加文件等内容"
        aria-label="添加文件等内容"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <ComposerAddIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={menuId}
            className="composer-menu-popover composer-add-menu-popover"
            role="menu"
            aria-label="添加到聊天"
            data-placement={position?.placement}
            data-positioned={Boolean(position)}
            style={popoverStyle}
            onKeyDown={onMenuKeyDown}
          >
            <div className="composer-add-menu-scroll">
              {groupedItems.map((group) => (
                <div
                  key={group.id}
                  className="composer-add-menu-group"
                  role="group"
                  aria-labelledby={`${menuId}-${group.id}`}
                >
                  <div
                    id={`${menuId}-${group.id}`}
                    className="composer-add-menu-heading"
                    role="presentation"
                  >
                    {group.label}
                  </div>
                  <div className="composer-add-menu-options">
                    {group.items.map(({ item, index }) => (
                      <button
                        ref={(node) => {
                          itemRefs.current[index] = node
                        }}
                        key={item.id}
                        type="button"
                        className={`composer-add-menu-option composer-add-menu-option-${item.id}`}
                        role="menuitem"
                        disabled={item.disabled}
                        title={item.disabled ? '此功能尚未接入当前复刻版本' : undefined}
                        tabIndex={index === activeIndex ? 0 : -1}
                        onClick={() => chooseItem(index)}
                        onFocus={() => {
                          if (!item.disabled) setActiveIndex(index)
                        }}
                        onPointerMove={() => {
                          if (!item.disabled) setActiveIndex(index)
                        }}
                      >
                        <span
                          className={`composer-add-menu-icon composer-add-menu-icon-${item.id}`}
                          aria-hidden="true"
                        >
                          {composerAddMenuIcons[item.id]}
                        </span>
                        <span className="composer-add-menu-copy">
                          <span className="composer-add-menu-label">{item.label}</span>
                          {item.description && (
                            <span className="composer-add-menu-description">
                              {item.description}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

import {
  Archive,
  ChevronRight,
  CirclePlus,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  GitFork,
  Link2,
  MoreHorizontal,
  PanelsTopLeft,
  Pin,
  PinOff,
  Settings2,
  SlidersHorizontal,
  SquarePen,
  TerminalSquare
} from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { computeComposerPopoverPosition } from './ComposerMenus'
import { useWindowZoom } from './windowZoom'

export type ConversationMenuAction =
  | 'rename'
  | 'toggle-pin'
  | 'open-side-chat'
  | 'fork-same-worktree'
  | 'fork-new-worktree'
  | 'copy-deeplink'
  | 'copy-markdown'
  | 'copy-working-directory'
  | 'open-new-window'
  | 'open-finder'
  | 'open-terminal'
  | 'archive'

export type ConversationControlsAction = 'terminal' | 'settings'

export interface TitlebarMenuItem<Action extends string> {
  id: string
  label: string
  action?: Action
  shortcut?: string
  disabled?: boolean
  separatorBefore?: boolean
  children?: Array<TitlebarMenuItem<Action>>
}

export function buildConversationMenuItems({
  pinned
}: {
  pinned: boolean
}): Array<TitlebarMenuItem<ConversationMenuAction>> {
  return [
    { id: 'rename', action: 'rename', label: '重命名', shortcut: '⌥⌘R' },
    {
      id: 'toggle-pin',
      action: 'toggle-pin',
      label: pinned ? '取消置顶' : '置顶',
      shortcut: '⌥⌘P'
    },
    {
      id: 'open-side-chat',
      action: 'open-side-chat',
      label: '新建侧边聊天',
      shortcut: '⌥⌘S',
      separatorBefore: true
    },
    {
      id: 'fork',
      label: '分叉',
      children: [
        {
          id: 'fork-same-worktree',
          action: 'fork-same-worktree',
          label: '在同一 worktree 中分叉'
        },
        {
          id: 'fork-new-worktree',
          action: 'fork-new-worktree',
          label: '在新 worktree 中分叉'
        }
      ]
    },
    { id: 'schedule', label: '添加计划任务…', disabled: true },
    {
      id: 'copy',
      label: '复制',
      separatorBefore: true,
      children: [
        { id: 'copy-deeplink', action: 'copy-deeplink', label: '复制深层链接' },
        { id: 'copy-markdown', action: 'copy-markdown', label: '复制为 Markdown' },
        {
          id: 'copy-working-directory',
          action: 'copy-working-directory',
          label: '复制工作目录'
        }
      ]
    },
    {
      id: 'open-new-window',
      action: 'open-new-window',
      label: '在新窗口中打开',
      separatorBefore: true
    },
    {
      id: 'open-with',
      label: '打开方式',
      children: [
        { id: 'open-finder', action: 'open-finder', label: '访达' },
        { id: 'open-terminal', action: 'open-terminal', label: '终端' }
      ]
    },
    {
      id: 'archive',
      action: 'archive',
      label: '归档',
      shortcut: '⇧⌘A',
      separatorBefore: true
    }
  ]
}

export function buildConversationControlsItems(
  terminalAvailable: boolean
): Array<TitlebarMenuItem<ConversationControlsAction>> {
  return [
    {
      id: 'terminal',
      action: 'terminal',
      label: '后台终端',
      disabled: !terminalAvailable
    },
    { id: 'settings', action: 'settings', label: '设置…', separatorBefore: true }
  ]
}

export function nextEnabledTitlebarMenuIndex<Action extends string>(
  items: Array<TitlebarMenuItem<Action>>,
  currentIndex: number,
  direction: -1 | 1
): number {
  if (items.length === 0 || items.every((item) => item.disabled)) return -1
  let index = currentIndex
  for (let visited = 0; visited < items.length; visited += 1) {
    index = (index + direction + items.length) % items.length
    if (!items[index].disabled) return index
  }
  return -1
}

function menuItemIcon(
  item: TitlebarMenuItem<ConversationMenuAction | ConversationControlsAction>
): ReactNode {
  if (item.id === 'rename') return <SquarePen />
  if (item.id === 'toggle-pin') return item.label === '取消置顶' ? <PinOff /> : <Pin />
  if (item.id === 'open-side-chat') return <CirclePlus />
  if (item.id === 'fork' || item.id.startsWith('fork-')) return <GitFork />
  if (item.id === 'schedule') return <Clock3 />
  if (item.id === 'copy') return <Copy />
  if (item.id === 'copy-deeplink') return <Link2 />
  if (item.id === 'copy-markdown') return <FileText />
  if (item.id === 'copy-working-directory' || item.id === 'open-finder') return <FolderOpen />
  if (item.id === 'open-new-window') return <PanelsTopLeft />
  if (item.id === 'open-with') return <ExternalLink />
  if (item.id === 'archive') return <Archive />
  if (item.id === 'terminal' || item.id === 'open-terminal') return <TerminalSquare />
  return <Settings2 />
}

function focusElement(ref: RefObject<HTMLButtonElement | null>): void {
  window.requestAnimationFrame(() => ref.current?.focus())
}

function TitlebarMenu<Action extends string>({
  ariaLabel,
  triggerIcon,
  disabled = false,
  items,
  onAction
}: {
  ariaLabel: string
  triggerIcon: ReactNode
  disabled?: boolean
  items: Array<TitlebarMenuItem<Action>>
  onAction(action: Action): void
}): ReactNode {
  const menuId = useId()
  const zoom = useWindowZoom()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const submenuItemRefs = useRef<Array<Array<HTMLButtonElement | null>>>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState(-1)
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState(-1)
  const [position, setPosition] = useState<CSSProperties | null>(null)

  const focusItem = (index: number, closeSubmenu = true): void => {
    if (index < 0) return
    setActiveIndex(index)
    if (closeSubmenu) {
      setOpenSubmenuIndex(-1)
      setActiveSubmenuIndex(-1)
    }
    window.requestAnimationFrame(() => itemRefs.current[index]?.focus())
  }

  const focusSubmenuItem = (parentIndex: number, index: number): void => {
    if (index < 0) return
    setActiveSubmenuIndex(index)
    window.requestAnimationFrame(() => submenuItemRefs.current[parentIndex]?.[index]?.focus())
  }

  const showSubmenu = (index: number, focusFirst = false): void => {
    const children = items[index]?.children
    if (!children?.length || items[index].disabled) return
    const initialIndex = nextEnabledTitlebarMenuIndex(children, -1, 1)
    setActiveIndex(index)
    setOpenSubmenuIndex(index)
    setActiveSubmenuIndex(initialIndex)
    if (focusFirst) focusSubmenuItem(index, initialIndex)
  }

  const openMenu = (fromEnd = false): void => {
    if (disabled) return
    const initialIndex = fromEnd
      ? nextEnabledTitlebarMenuIndex(items, 0, -1)
      : nextEnabledTitlebarMenuIndex(items, -1, 1)
    setActiveIndex(initialIndex)
    setOpenSubmenuIndex(-1)
    setActiveSubmenuIndex(-1)
    setOpen(true)
  }

  const closeMenu = (restoreFocus: boolean): void => {
    setOpen(false)
    setOpenSubmenuIndex(-1)
    setActiveSubmenuIndex(-1)
    setPosition(null)
    if (restoreFocus) focusElement(triggerRef)
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const updatePosition = (): void => {
      const positioned = computeComposerPopoverPosition(
        trigger.getBoundingClientRect(),
        menu.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        'end',
        6,
        8,
        zoom
      )
      setPosition({
        left: positioned.left,
        top: positioned.top,
        maxHeight: positioned.maxHeight
      })
    }

    updatePosition()
    focusItem(activeIndex, false)
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
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
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

  const chooseItem = (item: TitlebarMenuItem<Action> | undefined): void => {
    if (!item || item.disabled || !item.action) return
    closeMenu(true)
    onAction(item.action)
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('.titlebar-submenu')) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(
        nextEnabledTitlebarMenuIndex(
          items,
          activeIndex,
          event.key === 'ArrowDown' ? 1 : -1
        )
      )
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusItem(
        nextEnabledTitlebarMenuIndex(
          items,
          event.key === 'Home' ? -1 : 0,
          event.key === 'Home' ? 1 : -1
        )
      )
      return
    }
    if (event.key === 'ArrowRight' && items[activeIndex]?.children?.length) {
      event.preventDefault()
      showSubmenu(activeIndex, true)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (items[activeIndex]?.children?.length) showSubmenu(activeIndex, true)
      else chooseItem(items[activeIndex])
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const onSubmenuKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    parentIndex: number
  ): void => {
    event.stopPropagation()
    const children = items[parentIndex]?.children || []
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusSubmenuItem(
        parentIndex,
        nextEnabledTitlebarMenuIndex(
          children,
          activeSubmenuIndex,
          event.key === 'ArrowDown' ? 1 : -1
        )
      )
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusSubmenuItem(
        parentIndex,
        nextEnabledTitlebarMenuIndex(
          children,
          event.key === 'Home' ? -1 : 0,
          event.key === 'Home' ? 1 : -1
        )
      )
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setOpenSubmenuIndex(-1)
      setActiveSubmenuIndex(-1)
      focusItem(parentIndex, false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      chooseItem(children[activeSubmenuIndex])
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openMenu(event.key === 'ArrowUp')
  }

  const submenuOpensLeft =
    position !== null && Number(position.left) + 208 + 230 + 12 > window.innerWidth / zoom

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`titlebar-icon${open ? ' active' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {triggerIcon}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="titlebar-menu-popover"
            role="menu"
            aria-label={ariaLabel}
            data-positioned={Boolean(position)}
            data-submenu-side={submenuOpensLeft ? 'left' : 'right'}
            style={position || undefined}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item, index) => (
              <div className="titlebar-menu-entry" key={item.id}>
                {item.separatorBefore && <div className="titlebar-menu-separator" role="separator" />}
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  type="button"
                  className="titlebar-menu-item"
                  data-menu-item-id={item.id}
                  role="menuitem"
                  aria-haspopup={item.children?.length ? 'menu' : undefined}
                  aria-expanded={item.children?.length ? openSubmenuIndex === index : undefined}
                  disabled={item.disabled}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => {
                    if (item.children?.length) showSubmenu(index, true)
                    else chooseItem(item)
                  }}
                  onPointerMove={() => {
                    if (item.disabled) return
                    setActiveIndex(index)
                    if (item.children?.length) showSubmenu(index)
                    else {
                      setOpenSubmenuIndex(-1)
                      setActiveSubmenuIndex(-1)
                    }
                  }}
                >
                  {menuItemIcon(
                    item as TitlebarMenuItem<ConversationMenuAction | ConversationControlsAction>
                  )}
                  <span className="titlebar-menu-label">{item.label}</span>
                  {item.shortcut && <kbd className="titlebar-menu-shortcut">{item.shortcut}</kbd>}
                  {item.children?.length ? <ChevronRight className="titlebar-menu-chevron" /> : null}
                </button>
                {openSubmenuIndex === index && item.children?.length ? (
                  <div
                    className="titlebar-menu-popover titlebar-submenu"
                    role="menu"
                    aria-label={item.label}
                    data-positioned="true"
                    onKeyDown={(event) => onSubmenuKeyDown(event, index)}
                  >
                    {item.children.map((child, childIndex) => (
                      <div className="titlebar-menu-entry" key={child.id}>
                        {child.separatorBefore && (
                          <div className="titlebar-menu-separator" role="separator" />
                        )}
                        <button
                          ref={(node) => {
                            const refs = submenuItemRefs.current[index] || []
                            refs[childIndex] = node
                            submenuItemRefs.current[index] = refs
                          }}
                          type="button"
                          className="titlebar-menu-item"
                          data-menu-item-id={child.id}
                          role="menuitem"
                          disabled={child.disabled}
                          tabIndex={childIndex === activeSubmenuIndex ? 0 : -1}
                          onClick={() => chooseItem(child)}
                          onPointerMove={() => {
                            if (!child.disabled) setActiveSubmenuIndex(childIndex)
                          }}
                        >
                          {menuItemIcon(
                            child as TitlebarMenuItem<ConversationMenuAction | ConversationControlsAction>
                          )}
                          <span className="titlebar-menu-label">{child.label}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

export function TitlebarConversationMenu({
  available,
  pinned,
  onAction
}: {
  available: boolean
  pinned: boolean
  onAction(action: ConversationMenuAction): void
}): ReactNode {
  return (
    <TitlebarMenu
      ariaLabel="会话操作"
      triggerIcon={<MoreHorizontal />}
      disabled={!available}
      items={buildConversationMenuItems({ pinned })}
      onAction={onAction}
    />
  )
}

export function TitlebarConversationControls({
  terminalAvailable,
  onAction
}: {
  terminalAvailable: boolean
  onAction(action: ConversationControlsAction): void
}): ReactNode {
  return (
    <TitlebarMenu
      ariaLabel="会话控制"
      triggerIcon={<SlidersHorizontal />}
      items={buildConversationControlsItems(terminalAvailable)}
      onAction={onAction}
    />
  )
}

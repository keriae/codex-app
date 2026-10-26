import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  Gift,
  Globe2,
  Keyboard,
  PanelTopClose,
  Settings,
  ShieldCheck
} from 'lucide-react'
import {
  createPortal
} from 'react-dom'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import './profileMenu.css'

const PROFILE_MENU_WIDTH = 228
const HELP_MENU_WIDTH = 220
const VIEWPORT_GUTTER = 8

interface MenuPosition {
  left: number
  top: number
  visibility?: 'hidden'
}

export interface ProfileMenuProps {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  accountLabel?: string
  onOpenChange(open: boolean): void
  onOpenSettings(): void
  onHideMini?(): void
  onOpenKeyboardShortcuts?(): void
  onOpenExternal?(url: string): void
}

function actionableItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')]
    .filter((item) => item.getClientRects().length > 0)
}

function moveMenuFocus(event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false
  const items = actionableItems(event.currentTarget)
  if (!items.length) return true
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLElement)
  let next = current
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
  items[next]?.focus({preventScroll: true})
  return true
}

function ProfileMenuSeparator(): ReactNode {
  return <div className="profile-menu-separator" role="separator"><span /></div>
}

/** Recovered bottom-rail account menu, kept independent from the settings page. */
export function ProfileMenu({
  open,
  anchorRef,
  accountLabel = 'OpenAI using LLM proxy',
  onOpenChange,
  onOpenSettings,
  onHideMini,
  onOpenKeyboardShortcuts,
  onOpenExternal
}: ProfileMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const helpMenuRef = useRef<HTMLDivElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition>({left: 0, top: 0, visibility: 'hidden'})
  const [helpPosition, setHelpPosition] = useState<MenuPosition>({left: 0, top: 0, visibility: 'hidden'})

  const close = useCallback((restoreFocus = false): void => {
    setHelpOpen(false)
    onOpenChange(false)
    if (restoreFocus) requestAnimationFrame(() => anchorRef.current?.focus())
  }, [anchorRef, onOpenChange])

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!anchor || !menu) return
    setPosition({
      left: Math.max(VIEWPORT_GUTTER, Math.min(anchor.right + 5, window.innerWidth - PROFILE_MENU_WIDTH - VIEWPORT_GUTTER)),
      top: Math.max(VIEWPORT_GUTTER, Math.min(anchor.bottom - menu.height + 1, window.innerHeight - menu.height - VIEWPORT_GUTTER))
    })
  }, [anchorRef, open])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current
      if (!menu) return
      actionableItems(menu)[0]?.focus({preventScroll: true})
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  useLayoutEffect(() => {
    if (!helpOpen) return
    const menu = menuRef.current?.getBoundingClientRect()
    const submenu = helpMenuRef.current?.getBoundingClientRect()
    if (!menu || !submenu) return
    setHelpPosition({
      left: Math.max(VIEWPORT_GUTTER, Math.min(menu.right + 5, window.innerWidth - HELP_MENU_WIDTH - VIEWPORT_GUTTER)),
      top: Math.max(VIEWPORT_GUTTER, Math.min(menu.bottom - submenu.height - 1, window.innerHeight - submenu.height - VIEWPORT_GUTTER))
    })
  }, [helpOpen, position])

  useEffect(() => {
    if (!open) {
      setHelpOpen(false)
      return
    }
    const dismiss = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target) || helpMenuRef.current?.contains(target)) return
      close()
    }
    const dismissForWindowChange = (): void => close()
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('scroll', dismissForWindowChange, true)
    window.addEventListener('resize', dismissForWindowChange)
    window.addEventListener('blur', dismissForWindowChange)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('scroll', dismissForWindowChange, true)
      window.removeEventListener('resize', dismissForWindowChange)
      window.removeEventListener('blur', dismissForWindowChange)
    }
  }, [anchorRef, close, open])

  const openExternal = (url: string): void => {
    close()
    if (onOpenExternal) onOpenExternal(url)
    else void window.codex.openExternal(url)
  }

  if (!open) return null

  const menu = <div
    ref={menuRef}
    className="profile-menu"
    role="menu"
    aria-label="个人资料菜单"
    tabIndex={-1}
    style={position}
    onKeyDown={(event) => {
      if (moveMenuFocus(event)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      } else if (event.key === 'ArrowRight' && document.activeElement === helpRef.current) {
        event.preventDefault()
        setHelpOpen(true)
        requestAnimationFrame(() => actionableItems(helpMenuRef.current!)[0]?.focus({preventScroll: true}))
      }
    }}
  >
    <div
      className="profile-menu-account"
      role="menuitem"
      aria-disabled="true"
      onPointerEnter={() => setHelpOpen(false)}
    >{accountLabel}</div>
    <ProfileMenuSeparator />
    <button
      type="button"
      role="menuitem"
      className="profile-menu-item"
      onPointerEnter={() => setHelpOpen(false)}
      onFocus={() => setHelpOpen(false)}
      onClick={() => { onHideMini?.(); close() }}
    >
      <PanelTopClose /><span>隐藏 Mini</span>
    </button>
    <button
      type="button"
      role="menuitem"
      className="profile-menu-item"
      onPointerEnter={() => setHelpOpen(false)}
      onFocus={() => setHelpOpen(false)}
      onClick={() => { close(); onOpenSettings() }}
    >
      <Settings /><span>设置</span><kbd>⌘,</kbd>
    </button>
    <ProfileMenuSeparator />
    <button
      ref={helpRef}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={helpOpen}
      className="profile-menu-item"
      onPointerEnter={() => setHelpOpen(true)}
      onFocus={() => setHelpOpen(true)}
      onClick={() => setHelpOpen((visible) => !visible)}
    >
      <CircleHelp /><span>帮助</span><ChevronRight />
    </button>
  </div>

  const helpMenu = helpOpen ? <div
    ref={helpMenuRef}
    className="profile-menu profile-help-menu"
    role="menu"
    aria-label="帮助"
    tabIndex={-1}
    style={helpPosition}
    onKeyDown={(event) => {
      if (moveMenuFocus(event)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
      else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setHelpOpen(false)
        requestAnimationFrame(() => helpRef.current?.focus())
      }
    }}
  >
    <button type="button" role="menuitem" className="profile-menu-item" onClick={() => openExternal('https://help.openai.com/en/articles/6825453-chatgpt-release-notes')}>
      <Gift /><span>新功能</span>
    </button>
    <ProfileMenuSeparator />
    <button type="button" role="menuitem" className="profile-menu-item" onClick={() => openExternal('https://chromewebstore.google.com/category/extensions')}>
      <Globe2 /><span>Chrome 扩展程序</span>
    </button>
    <button type="button" role="menuitem" className="profile-menu-item" onClick={() => { close(); onOpenKeyboardShortcuts?.() }}>
      <Keyboard /><span>键盘快捷键</span><kbd>⌘/</kbd>
    </button>
    <button type="button" role="menuitem" className="profile-menu-item" onClick={() => openExternal('https://learn.chatgpt.com/docs/codex/overview')}>
      <BookOpen /><span>用户指南</span>
    </button>
    <button type="button" role="menuitem" className="profile-menu-item" onClick={() => openExternal('https://privacy.openai.com/')}>
      <ShieldCheck /><span>隐私中心</span>
    </button>
  </div> : null

  return <>{createPortal(menu, document.body)}{helpMenu && createPortal(helpMenu, document.body)}</>
}

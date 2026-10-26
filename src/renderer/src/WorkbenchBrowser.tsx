import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cookie,
  EllipsisVertical,
  FileText,
  Folder,
  Globe2,
  History,
  Image as ImageIcon,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  TerminalSquare,
  X
} from 'lucide-react'
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState
} from 'react'
import type { BrowserTopSite, BrowserViewBounds, BrowserViewState } from '../../shared/api'
import {
  hasWorkbenchBrowserPage,
  normalizeWorkbenchBrowserAddress,
  sameWorkbenchBrowserBounds,
  WORKBENCH_BROWSER_WEB_STORE_URL,
  workbenchBrowserAddress,
  workbenchBrowserBounds
} from './workbenchBrowserModel'
import {
  formatWorkbenchBrowserRecentTime,
  type WorkbenchBrowserRecentItem
} from './workbenchBrowserRecents'
import './WorkbenchBrowser.css'

export interface WorkbenchBrowserProps {
  tabId: string
  active: boolean
  state: BrowserViewState | null
  onStateChange(state: BrowserViewState): void
  onOpenNewTab(url?: string): void
  onOpenChanges(): void
  onOpenFiles(): void
  onOpenSideChat(): void
  onOpenTerminal(): void
  onToggleBottomTerminal(): void
  recentItems: WorkbenchBrowserRecentItem[]
  onOpenRecent(item: WorkbenchBrowserRecentItem): void
}

type BrowserToolbarMenu = 'extensions' | 'options' | 'terminal'

function TextBubbleLight20Icon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M9.99958 10.5852C10.3668 10.5852 10.6646 10.883 10.6646 11.2502C10.6645 11.6174 10.3668 11.9153 9.99958 11.9153H7.49958C7.13256 11.9151 6.83467 11.6173 6.83454 11.2502C6.83454 10.8831 7.13248 10.5854 7.49958 10.5852H9.99958Z" fill="currentColor" />
      <path d="M12.4996 7.25122C12.8668 7.25122 13.1645 7.5491 13.1646 7.91626C13.1646 8.28353 12.8669 8.5813 12.4996 8.5813H7.49958C7.13248 8.5811 6.83454 8.28341 6.83454 7.91626C6.83467 7.54922 7.13256 7.25142 7.49958 7.25122H12.4996Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M13.1363 2.66821C13.816 2.66821 14.3664 2.66802 14.8111 2.70435C15.2634 2.74132 15.6655 2.81992 16.0386 3.01001C16.6277 3.31026 17.1066 3.78909 17.4068 4.37817C17.597 4.75137 17.6755 5.15327 17.7125 5.60571C17.7488 6.0503 17.7486 6.59998 17.7486 7.27954V11.9915C17.7486 12.833 17.7555 13.407 17.6031 13.8909C17.2959 14.8659 16.5323 15.6296 15.5572 15.9368C15.0734 16.0891 14.4992 16.0813 13.6578 16.0813C13.4377 16.0813 13.3813 16.083 13.3306 16.0891C13.2046 16.1044 13.0817 16.1435 12.9703 16.2043C12.9255 16.2288 12.879 16.2609 12.6998 16.3889L11.316 17.3772C11.0273 17.5834 10.7418 17.8007 10.4088 17.885C10.1405 17.9529 9.8596 17.9529 9.59138 17.885C9.25821 17.8006 8.97203 17.5835 8.68317 17.3772L7.30036 16.3889C7.12057 16.2605 7.07379 16.2289 7.02888 16.2043C6.91744 16.1435 6.79554 16.1044 6.6695 16.0891C6.61871 16.083 6.56227 16.0813 6.34138 16.0813C5.49997 16.0813 4.9258 16.0892 4.44196 15.9368C3.46705 15.6295 2.70318 14.8658 2.39607 13.8909C2.24365 13.407 2.25153 12.833 2.25153 11.9915V7.27954C2.25153 6.59997 2.25134 6.05031 2.28767 5.60571C2.32463 5.15328 2.40319 4.75136 2.59333 4.37817C2.89354 3.78907 3.37239 3.31023 3.9615 3.01001C4.33467 2.81987 4.73662 2.74131 5.18903 2.70435C5.63362 2.66802 6.18332 2.66821 6.86286 2.66821H13.1363ZM6.86286 3.99829C6.16149 3.99829 5.67529 3.99868 5.29743 4.02954C4.92728 4.05979 4.71945 4.11589 4.56501 4.19458C4.2262 4.36728 3.95059 4.64287 3.7779 4.98169C3.69921 5.13614 3.64311 5.34394 3.61286 5.71411C3.582 6.09198 3.58161 6.57814 3.58161 7.27954V11.9915C3.58161 12.9334 3.58914 13.2518 3.66462 13.4915C3.84136 14.0524 4.28144 14.4915 4.84235 14.6682C5.08195 14.7436 5.40005 14.7512 6.34138 14.7512C6.53109 14.7512 6.68088 14.7508 6.82966 14.7688C7.12301 14.8044 7.4072 14.8948 7.66657 15.0364C7.79808 15.1082 7.9185 15.1966 8.07282 15.3069L9.45661 16.2942C9.83653 16.5656 9.88578 16.5879 9.91755 16.5959C9.97152 16.6096 10.0286 16.6096 10.0826 16.5959C10.1144 16.5878 10.1646 16.5648 10.5435 16.2942L11.9263 15.3069C12.0807 15.1966 12.202 15.1082 12.3336 15.0364C12.593 14.8948 12.8771 14.8043 13.1705 14.7688C13.3191 14.7508 13.4683 14.7512 13.6578 14.7512C14.5997 14.7512 14.9181 14.7437 15.1578 14.6682C15.7187 14.4915 16.1578 14.0523 16.3345 13.4915C16.41 13.2518 16.4185 12.9334 16.4185 11.9915V7.27954C16.4185 6.57815 16.4181 6.09198 16.3873 5.71411C16.357 5.34392 16.3009 5.13614 16.2222 4.98169C16.0495 4.64273 15.7731 4.36729 15.4342 4.19458C15.2798 4.11599 15.0725 4.05977 14.7027 4.02954C14.3248 3.99867 13.838 3.99829 13.1363 3.99829H6.86286Z" fill="currentColor" />
    </svg>
  )
}

function PlusMinusSquareLight16Icon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M9.6665 10.1421C9.95628 10.1423 10.1919 10.3777 10.1919 10.6675C10.1916 10.9571 9.95612 11.1927 9.6665 11.1929H6.3335C6.04371 11.1929 5.80837 10.9572 5.80811 10.6675C5.80811 10.3775 6.04355 10.1421 6.3335 10.1421H9.6665Z" fill="currentColor" />
      <path d="M7.99951 4.4751C8.28946 4.4751 8.5249 4.71054 8.5249 5.00049V6.14209H9.6665C9.95628 6.14229 10.1919 6.37765 10.1919 6.66748C10.1916 6.95708 9.95612 7.19267 9.6665 7.19287H8.5249V8.3335C8.52464 8.62322 8.2893 8.85889 7.99951 8.85889C7.70989 8.85869 7.47438 8.6231 7.47412 8.3335V7.19287H6.3335C6.04371 7.19287 5.80837 6.95721 5.80811 6.66748C5.80811 6.37753 6.04355 6.14209 6.3335 6.14209H7.47412V5.00049C7.47412 4.71066 7.70973 4.4753 7.99951 4.4751Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M11.4663 2.14111C12.787 2.14111 13.8577 3.21204 13.8579 4.53271V11.4663C13.8579 12.7872 12.7872 13.8579 11.4663 13.8579H4.53271C3.21204 13.8577 2.14111 12.787 2.14111 11.4663V4.53271C2.14136 3.2122 3.2122 2.14136 4.53271 2.14111H11.4663ZM4.53271 3.19189C3.79209 3.19214 3.19214 3.79209 3.19189 4.53271V11.4663C3.19189 12.2071 3.79194 12.8079 4.53271 12.8081H11.4663C12.2073 12.8081 12.8081 12.2073 12.8081 11.4663V4.53271C12.8079 3.79194 12.2071 3.19189 11.4663 3.19189H4.53271Z" fill="currentColor" />
    </svg>
  )
}

function PlusChatBubbleRightLight16Icon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 5.29883C8.28995 5.29883 8.52539 5.53427 8.52539 5.82422V7.47461H10.1758C10.4655 7.47487 10.7012 7.71021 10.7012 8C10.7012 8.28979 10.4655 8.52513 10.1758 8.52539H8.52539V10.1748C8.52539 10.4648 8.28995 10.7002 8 10.7002C7.71005 10.7002 7.47461 10.4648 7.47461 10.1748V8.52539H5.8252C5.53525 8.52539 5.2998 8.28995 5.2998 8C5.2998 7.71005 5.53525 7.47461 5.8252 7.47461H7.47461V5.82422C7.47461 5.53427 7.71005 5.29883 8 5.29883Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M8 1.80762C11.575 1.80762 14.5254 4.55257 14.5254 8C14.5253 9.3817 13.9636 10.3597 13.4502 11.3633L13.8203 13.0381C13.9268 13.5182 13.4887 13.9417 13.0127 13.8184L11.2451 13.3594C10.2407 13.829 9.21523 14.1914 8 14.1914C4.42513 14.1914 1.4748 11.4473 1.47461 8C1.47461 4.55257 4.42502 1.80762 8 1.80762ZM8 2.8584C4.94756 2.8584 2.52539 5.18821 2.52539 8C2.52558 10.8116 4.94768 13.1416 8 13.1416C8.90842 13.1416 9.70752 12.8992 10.5576 12.5215L10.9248 12.3516L11.0332 12.3115C11.1067 12.2912 11.1833 12.2832 11.2598 12.2891L11.374 12.3086L12.6572 12.6406L12.3936 11.4541C12.3606 11.3057 12.3798 11.1502 12.4482 11.0146C13.0198 9.88293 13.4745 9.1334 13.4746 8C13.4746 5.18821 11.0524 2.8584 8 2.8584Z" fill="currentColor" />
    </svg>
  )
}

export function WorkbenchBrowser({
  tabId,
  active,
  state,
  onStateChange,
  onOpenNewTab,
  onOpenChanges,
  onOpenFiles,
  onOpenSideChat,
  onOpenTerminal,
  onToggleBottomTerminal,
  recentItems,
  onOpenRecent
}: WorkbenchBrowserProps): ReactNode {
  const viewportRef = useRef<HTMLDivElement>(null)
  const creationRef = useRef<Promise<BrowserViewState> | null>(null)
  const lastBoundsRef = useRef<BrowserViewBounds | null>(null)
  const editingAddressRef = useRef(false)
  const commandSequenceRef = useRef(0)
  const extensionsButtonRef = useRef<HTMLButtonElement>(null)
  const optionsButtonRef = useRef<HTMLButtonElement>(null)
  const terminalOptionsButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const importTitleId = useId()
  const importDescriptionId = useId()
  const importDialogTitleId = useId()
  const importDialogDescriptionId = useId()
  const importUnavailableId = useId()
  const [viewCreated, setViewCreated] = useState(Boolean(state))
  const [requestedUrl, setRequestedUrl] = useState<string | null>(
    hasWorkbenchBrowserPage(state) ? state!.url : null
  )
  const [address, setAddress] = useState(workbenchBrowserAddress(state))
  const [commandError, setCommandError] = useState<string | null>(null)
  const [showImportBanner, setShowImportBanner] = useState(true)
  const [toolbarMenu, setToolbarMenu] = useState<BrowserToolbarMenu | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [topSites, setTopSites] = useState<BrowserTopSite[]>([])
  const [dismissedTopSite, setDismissedTopSite] = useState<BrowserTopSite | null>(null)
  const navigated = hasWorkbenchBrowserPage(state) || requestedUrl !== null
  const visibleError = commandError || state?.error || null
  const browserOverlayOpen = toolbarMenu !== null || showImportDialog

  useEffect(() => {
    commandSequenceRef.current += 1
    creationRef.current = null
    lastBoundsRef.current = null
    setViewCreated(Boolean(state))
    setRequestedUrl(hasWorkbenchBrowserPage(state) ? state!.url : null)
    setAddress(workbenchBrowserAddress(state))
    setCommandError(null)
    setShowImportBanner(true)
    setToolbarMenu(null)
    setShowImportDialog(false)
    setDismissedTopSite(null)
    return () => { commandSequenceRef.current += 1 }
  }, [tabId])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.codex.onBrowserTopSitesChanged((sites) => {
      if (!cancelled) setTopSites(sites)
    })
    void window.codex.listBrowserTopSites().then((sites) => {
      if (!cancelled) setTopSites(sites)
    }).catch(() => {
      if (!cancelled) setTopSites([])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [tabId])

  useEffect(() => {
    if (!state) return
    setViewCreated(true)
    if (hasWorkbenchBrowserPage(state)) setRequestedUrl(state.url)
    if (!editingAddressRef.current) setAddress(workbenchBrowserAddress(state))
  }, [state])

  const closeToolbarMenu = useCallback((restoreFocus = false): void => {
    const previous = toolbarMenu
    setToolbarMenu(null)
    if (!restoreFocus) return
    window.requestAnimationFrame(() => {
      if (previous === 'extensions') extensionsButtonRef.current?.focus()
      if (previous === 'options') optionsButtonRef.current?.focus()
      if (previous === 'terminal') terminalOptionsButtonRef.current?.focus()
    })
  }, [toolbarMenu])

  const dismissRecommendation = useCallback(async (site: BrowserTopSite): Promise<void> => {
    setDismissedTopSite(site)
    setTopSites((current) => current.filter((entry) => entry.url !== site.url))
    try {
      setTopSites(await window.codex.dismissBrowserTopSite(site.url))
    } catch (error) {
      setDismissedTopSite(null)
      setTopSites((current) => current.some((entry) => entry.url === site.url)
        ? current
        : [...current, site].sort((left, right) => right.visitCount - left.visitCount || right.lastVisitTime - left.lastVisitTime))
      setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const restoreRecommendation = useCallback(async (): Promise<void> => {
    const site = dismissedTopSite
    if (!site) return
    setDismissedTopSite(null)
    try {
      setTopSites(await window.codex.restoreBrowserTopSite(site.url))
    } catch (error) {
      setDismissedTopSite(site)
      setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [dismissedTopSite])

  useEffect(() => {
    if (!toolbarMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target)) return
      if (extensionsButtonRef.current?.contains(target)) return
      if (optionsButtonRef.current?.contains(target)) return
      if (terminalOptionsButtonRef.current?.contains(target)) return
      closeToolbarMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeToolbarMenu(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeToolbarMenu, toolbarMenu])

  const runCommand = useCallback((
    command: () => Promise<void>,
    onFailure?: () => void
  ): void => {
    const sequence = commandSequenceRef.current + 1
    commandSequenceRef.current = sequence
    setCommandError(null)
    void command().catch((error: unknown) => {
      if (commandSequenceRef.current !== sequence) return
      onFailure?.()
      setCommandError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const ensureView = useCallback(async (): Promise<BrowserViewState> => {
    if (state) return state
    if (!creationRef.current) {
      creationRef.current = window.codex.createBrowserView(tabId).then((created) => {
        setViewCreated(true)
        onStateChange(created)
        return created
      }).catch((error: unknown) => {
        creationRef.current = null
        throw error
      })
    }
    return creationRef.current
  }, [onStateChange, state, tabId])

  const navigate = useCallback((rawAddress: string): void => {
    const url = normalizeWorkbenchBrowserAddress(rawAddress)
    if (!url) return
    setAddress(url)
    setRequestedUrl(url)
    runCommand(async () => {
      await ensureView()
      await window.codex.navigateBrowserView(tabId, url)
    }, () => setRequestedUrl((current) => current === url ? null : current))
  }, [ensureView, runCommand, tabId])

  const submitAddress = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    editingAddressRef.current = false
    navigate(address)
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !viewCreated || !navigated || !active) return
    let frame = 0
    const measure = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const bounds = workbenchBrowserBounds(viewport.getBoundingClientRect())
        if (bounds.width < 1 || bounds.height < 1 || sameWorkbenchBrowserBounds(lastBoundsRef.current, bounds)) return
        lastBoundsRef.current = bounds
        void window.codex.setBrowserViewBounds(tabId, bounds).catch(() => undefined)
      })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(viewport)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, navigated, tabId, viewCreated])

  useEffect(() => {
    if (!viewCreated || !navigated) return
    const browserActive = active && !browserOverlayOpen
    void window.codex.setBrowserViewActive(tabId, browserActive).catch(() => undefined)
  }, [active, browserOverlayOpen, navigated, tabId, viewCreated])

  const toggleToolbarMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    menu: BrowserToolbarMenu
  ): void => {
    event.stopPropagation()
    setToolbarMenu((current) => current === menu ? null : menu)
  }

  return (
    <section
      className={`workbench-browser${active ? ' is-active' : ''}`}
      aria-label={state?.title || '新标签页'}
      aria-hidden={!active}
    >
      <header className="workbench-browser-chrome">
        <div className="workbench-browser-navigation-slot">
          <div className="workbench-browser-navigation" role="toolbar" aria-label="导航">
            <button
              type="button"
              aria-label="返回"
              disabled={!state?.canGoBack}
              onClick={() => runCommand(() => window.codex.goBackBrowserView(tabId))}
            ><ArrowLeft /></button>
            <button
              type="button"
              aria-label="前进"
              disabled={!state?.canGoForward}
              onClick={() => runCommand(() => window.codex.goForwardBrowserView(tabId))}
            ><ArrowRight /></button>
            <button
              type="button"
              className="workbench-browser-reload"
              aria-label={state?.loading ? '停止加载' : '重新加载页面'}
              onClick={() => {
                if (!viewCreated || !navigated) {
                  setShowImportBanner(true)
                  return
                }
                runCommand(() => state?.loading
                  ? window.codex.stopBrowserView(tabId)
                  : window.codex.reloadBrowserView(tabId))
              }}
            >{state?.loading ? <X /> : <RefreshCw />}</button>
          </div>
        </div>
        <form className="workbench-browser-address" onSubmit={submitAddress}>
          <input
            value={address}
            autoFocus={!navigated && active}
            onChange={(event) => setAddress(event.currentTarget.value)}
            onFocus={(event) => {
              editingAddressRef.current = true
              event.currentTarget.select()
            }}
            onBlur={() => {
              editingAddressRef.current = false
              if (!address.trim()) setAddress(requestedUrl || workbenchBrowserAddress(state))
            }}
            placeholder="搜索或输入网址"
            aria-label="搜索或输入网址"
            spellCheck={false}
          />
        </form>
        <div className="workbench-browser-actions" role="toolbar" aria-label="浏览器操作">
          <button
            ref={extensionsButtonRef}
            type="button"
            aria-label="扩展程序"
            title="扩展程序"
            aria-haspopup="menu"
            aria-expanded={toolbarMenu === 'extensions'}
            aria-controls={toolbarMenu === 'extensions' ? `${tabId}-extensions-menu` : undefined}
            onClick={(event) => toggleToolbarMenu(event, 'extensions')}
          >
            <TextBubbleLight20Icon />
          </button>
          <button
            ref={optionsButtonRef}
            type="button"
            aria-label="浏览器选项"
            title="浏览器选项"
            aria-haspopup="menu"
            aria-expanded={toolbarMenu === 'options'}
            aria-controls={toolbarMenu === 'options' ? `${tabId}-options-menu` : undefined}
            onClick={(event) => toggleToolbarMenu(event, 'options')}
          >
            <EllipsisVertical />
          </button>
        </div>
        {toolbarMenu === 'extensions' && (
          <div
            ref={menuRef}
            id={`${tabId}-extensions-menu`}
            className="workbench-browser-menu workbench-browser-extensions-menu"
            role="menu"
            aria-label="扩展程序"
          >
            <div className="workbench-browser-menu-heading">扩展程序（0）</div>
            <p className="workbench-browser-menu-empty">未安装扩展程序</p>
            <div className="workbench-browser-menu-separator" role="separator" />
            <button type="button" role="menuitem" disabled title="当前构建未提供扩展程序管理器">
              <span>管理扩展程序</span><ChevronRight />
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeToolbarMenu()
                onOpenNewTab(WORKBENCH_BROWSER_WEB_STORE_URL)
              }}
            >
              <span>访问网上应用商店</span><ChevronRight />
            </button>
          </div>
        )}
        {toolbarMenu === 'options' && (
          <div
            ref={menuRef}
            id={`${tabId}-options-menu`}
            className="workbench-browser-menu workbench-browser-options-menu"
            role="menu"
            aria-label="浏览器选项"
          >
            <button type="button" role="menuitem" disabled title="当前构建尚未连接页内查找服务">在页面中查找</button>
            <div className="workbench-browser-menu-separator" role="separator" />
            <div className="workbench-browser-zoom-row" role="group" aria-label="缩放">
              <span>缩放</span>
              <span className="workbench-browser-zoom-controls">
                <button type="button" aria-label="缩小" disabled>−</button>
                <output aria-label="当前缩放比例">100%</output>
                <button type="button" aria-label="放大" disabled>+</button>
              </span>
              <button type="button" aria-label="重置缩放" disabled>↺</button>
            </div>
            <div className="workbench-browser-menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeToolbarMenu()
                setShowImportDialog(true)
              }}
            >导入 Cookie 和密码…</button>
          </div>
        )}
        {state?.loading && (
          <div className="workbench-browser-loading-bar" aria-hidden="true"><span /></div>
        )}
      </header>
      {visibleError && <div className="workbench-browser-error" role="status">{visibleError}</div>}
      {!navigated && showImportBanner && (
        <aside
          className="workbench-browser-import-banner"
          role="status"
          aria-labelledby={importTitleId}
          aria-describedby={importDescriptionId}
        >
          <span className="workbench-browser-chrome-icon" aria-hidden="true"><Globe2 /></span>
          <span className="workbench-browser-import-copy">
            <strong id={importTitleId}>从 Chrome 导入数据</strong>
            <small id={importDescriptionId}>将你的密码和 Cookie 导入内置浏览器</small>
          </span>
          <div className="workbench-browser-import-actions">
            <button
              type="button"
              className="workbench-browser-import-action"
              onClick={() => setShowImportDialog(true)}
            >导入</button>
            <button
              type="button"
              className="workbench-browser-import-dismiss"
              aria-label="关闭浏览器数据导入横幅"
              onClick={() => setShowImportBanner(false)}
            ><X /></button>
          </div>
        </aside>
      )}
      {showImportDialog && (
        <div className="workbench-browser-import-overlay">
          <button
            type="button"
            className="workbench-browser-import-backdrop"
            aria-label="关闭从浏览器导入数据对话框"
            onClick={() => {
              setShowImportDialog(false)
              setShowImportBanner(false)
            }}
          />
          <section
            className="workbench-browser-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={importDialogTitleId}
            aria-describedby={`${importDialogDescriptionId} ${importUnavailableId}`}
          >
            <div className="workbench-browser-import-dialog-brands" aria-hidden="true">
              <span className="workbench-browser-chrome-icon"><Globe2 /></span><ChevronRight /><Globe2 />
            </div>
            <h2 id={importDialogTitleId}>从其他浏览器导入数据</h2>
            <p id={importDialogDescriptionId}>从 Chrome 导入你的浏览数据，继续上次的浏览进度</p>
            <div className="workbench-browser-import-benefits">
              <div><KeyRound /><span><strong>已保存的密码</strong><small>安全导入已保存的登录凭据</small></span></div>
              <div><Cookie /><span><strong>Cookie</strong><small>在常用网站保持登录状态</small></span></div>
              <div><History /><span><strong>浏览记录</strong><small>更快找到熟悉的网站</small></span></div>
            </div>
            <p id={importUnavailableId} className="workbench-browser-import-unavailable">
              当前构建未连接浏览器资料导入服务。
            </p>
            <div className="workbench-browser-import-dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setShowImportDialog(false)
                  setShowImportBanner(false)
                }}
              >以后再说</button>
              <button type="button" className="is-primary" disabled>继续</button>
            </div>
          </section>
        </div>
      )}
      {!navigated && (
        <div className="workbench-browser-home">
          <div className="workbench-browser-home-inner">
            <section className="workbench-browser-tools-section">
              <h3>工具</h3>
              <div className="workbench-browser-tools">
                <div className="workbench-browser-tool">
                  <button type="button" className="workbench-browser-tool-main" onClick={onOpenChanges}>
                    <PlusMinusSquareLight16Icon /><span>变更</span><kbd>⌃⇧G</kbd>
                  </button>
                </div>
                <div className="workbench-browser-tool workbench-browser-terminal-tool">
                  <button type="button" className="workbench-browser-tool-main" onClick={onOpenTerminal}>
                    <TerminalSquare /><span>终端</span><kbd>⌃`</kbd>
                  </button>
                  <div className="workbench-browser-terminal-options">
                    <button
                      ref={terminalOptionsButtonRef}
                      type="button"
                      className="workbench-browser-terminal-options-trigger"
                      aria-label="终端选项"
                      title="终端选项"
                      aria-haspopup="menu"
                      aria-expanded={toolbarMenu === 'terminal'}
                      aria-controls={toolbarMenu === 'terminal' ? `${tabId}-terminal-menu` : undefined}
                      onClick={(event) => toggleToolbarMenu(event, 'terminal')}
                    >
                      <MoreHorizontal />
                    </button>
                    {toolbarMenu === 'terminal' && (
                      <div
                        ref={menuRef}
                        id={`${tabId}-terminal-menu`}
                        className="workbench-browser-menu workbench-browser-terminal-menu"
                        role="menu"
                        aria-label="终端选项"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeToolbarMenu()
                            onToggleBottomTerminal()
                          }}
                        >
                          <TerminalSquare /><span>打开底部终端</span><kbd>⌘J</kbd>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="workbench-browser-tool">
                  <button type="button" className="workbench-browser-tool-main" onClick={onOpenSideChat}>
                    <PlusChatBubbleRightLight16Icon /><span>侧边聊天</span><kbd>⌥⌘S</kbd>
                  </button>
                </div>
                <div className="workbench-browser-tool">
                  <button type="button" className="workbench-browser-tool-main" onClick={onOpenFiles}>
                    <Folder /><span>文件</span><kbd>⌘P</kbd>
                  </button>
                </div>
              </div>
            </section>
            {topSites.length > 0 && (
              <section className="workbench-browser-recommendations-section">
                <h3>推荐</h3>
                <ul className="workbench-browser-recommendations" aria-label="推荐网站">
                  {topSites.map((entry) => (
                    <li key={entry.url}>
                      <button
                        type="button"
                        className="workbench-browser-recommendation"
                        aria-label={entry.title}
                        onClick={() => navigate(entry.url)}
                      >
                        <span className="workbench-browser-recommendation-icon"><Globe2 /></span>
                        <span>{entry.title}</span>
                      </button>
                      <button
                        type="button"
                        className="workbench-browser-recommendation-dismiss"
                        aria-label={`移除 ${entry.title}`}
                        onClick={() => void dismissRecommendation(entry)}
                      ><X /></button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {dismissedTopSite && (
              <div className="workbench-browser-recommendation-undo" role="status">
                <span>已移除“{dismissedTopSite.title}”</span>
                <button type="button" onClick={() => void restoreRecommendation()}>撤销</button>
              </div>
            )}
            {recentItems.length > 0 && (
              <section className="workbench-browser-recents-section">
                <div className="workbench-browser-section-heading">
                  <h3>最近</h3>
                  <span className="workbench-browser-recent-controls">
                    <button type="button" aria-label="向上滚动最近项目" disabled><ChevronUp /></button>
                    <button type="button" aria-label="向下滚动最近项目" disabled><ChevronDown /></button>
                  </span>
                </div>
                <ul className="workbench-browser-recents" aria-label="最近工作" data-at-bottom="true">
                  {recentItems.map((item) => {
                    const producedAt = formatWorkbenchBrowserRecentTime(item.producedAtMs)
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="workbench-browser-recent"
                          aria-label={item.title}
                          onClick={() => item.kind === 'website' ? navigate(item.target) : onOpenRecent(item)}
                        >
                          <span className="workbench-browser-recent-icon">
                            {item.kind === 'website' ? <Globe2 /> : item.kind === 'image' ? <ImageIcon /> : <FileText />}
                          </span>
                          <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                          {producedAt && <time dateTime={producedAt.dateTime}>{producedAt.label}</time>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
      <div
        ref={viewportRef}
        className={`workbench-browser-viewport${navigated ? ' is-navigated' : ''}`}
        aria-label="浏览器内容"
      />
    </section>
  )
}

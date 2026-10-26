import { Check, ChevronDown, ChevronRight, Lock, RotateCcw, ShieldCheck } from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import type {
  ApprovalsReviewer,
  ModelOption,
  PermissionProfile,
  ReasoningEffort
} from './protocol'
import { useDesktopSettings } from './desktopSettings'
import { normalizeWindowZoom, toLogicalRect, toLogicalViewport, useWindowZoom } from './windowZoom'

interface RectLike {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface ComposerPopoverPosition {
  left: number
  top: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

export function computeComposerPopoverPosition(
  anchor: RectLike,
  popover: Pick<RectLike, 'width' | 'height'>,
  viewport: { width: number; height: number },
  align: 'start' | 'end' = 'start',
  gap = 8,
  padding = 8,
  zoom = 1
): ComposerPopoverPosition {
  const factor = normalizeWindowZoom(zoom)
  anchor = toLogicalRect(anchor, factor)
  popover = { width: popover.width / factor, height: popover.height / factor }
  viewport = toLogicalViewport(viewport, factor)
  const availableAbove = Math.max(0, anchor.top - gap - padding)
  const availableBelow = Math.max(0, viewport.height - anchor.bottom - gap - padding)
  const placement =
    availableAbove >= Math.min(popover.height, 240) || availableAbove >= availableBelow
      ? 'top'
      : 'bottom'
  const maxHeight = Math.min(
    Math.max(0, viewport.height - padding * 2),
    Math.max(80, placement === 'top' ? availableAbove : availableBelow)
  )
  const visibleHeight = Math.min(popover.height, maxHeight)
  const desiredTop =
    placement === 'top' ? anchor.top - gap - visibleHeight : anchor.bottom + gap
  const desiredLeft = align === 'end' ? anchor.right - popover.width : anchor.left
  const maximumLeft = Math.max(padding, viewport.width - popover.width - padding)

  return {
    left: Math.min(Math.max(desiredLeft, padding), maximumLeft),
    top: Math.min(Math.max(desiredTop, padding), viewport.height - visibleHeight - padding),
    maxHeight,
    placement
  }
}

export function nextComposerMenuIndex(
  currentIndex: number,
  optionCount: number,
  direction: -1 | 1
): number {
  if (optionCount <= 0) return -1
  if (currentIndex < 0) return direction === 1 ? 0 : optionCount - 1
  return (currentIndex + direction + optionCount) % optionCount
}

export function nextReasoningEffortIndex(
  currentIndex: number,
  effortCount: number,
  direction: -1 | 1
): number {
  if (effortCount <= 0) return -1
  return Math.min(effortCount - 1, Math.max(0, currentIndex + direction))
}

export function reasoningEffortPercent(index: number, effortCount: number): number {
  if (effortCount <= 1) return 0
  return (Math.min(effortCount - 1, Math.max(0, index)) / (effortCount - 1)) * 100
}

interface ComposerMenuOption {
  id: string
  label: string
  description?: string | null
  icon?: ReactNode
  tone?: 'neutral' | 'warning'
}

interface ComposerOptionMenuProps {
  ariaLabel: string
  className: string
  kind: 'permission' | 'model' | 'effort'
  align?: 'start' | 'end'
  icon?: ReactNode
  value: string
  triggerLabel: string
  triggerTitle?: string
  options: ComposerMenuOption[]
  onChange(value: string): void
}

function focusElement(ref: RefObject<HTMLButtonElement | null>): void {
  ref.current?.focus()
}

function ComposerOptionMenu({
  ariaLabel,
  className,
  kind,
  align = 'start',
  icon,
  value,
  triggerLabel,
  triggerTitle,
  options,
  onChange
}: ComposerOptionMenuProps): ReactNode {
  const zoom = useWindowZoom()
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const initialFocusIndex = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<ComposerPopoverPosition | null>(null)

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  )

  const focusOption = (index: number): void => {
    setActiveIndex(index)
    optionRefs.current[index]?.focus()
  }

  const openMenu = (focusIndex = selectedIndex): void => {
    if (options.length === 0) return
    initialFocusIndex.current = Math.min(Math.max(focusIndex, 0), options.length - 1)
    setOpen(true)
  }

  const closeMenu = (restoreFocus: boolean): void => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) focusElement(triggerRef)
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return

    const updatePosition = (): void => {
      const anchorRect = trigger.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      setPosition(
        computeComposerPopoverPosition(
          anchorRect,
          popoverRect,
          { width: window.innerWidth, height: window.innerHeight },
          align,
          8,
          8,
          zoom
        )
      )
    }

    updatePosition()
    const focusIndex = initialFocusIndex.current ?? selectedIndex
    initialFocusIndex.current = null
    focusOption(focusIndex)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [align, open, selectedIndex, zoom])

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

  const chooseOption = (index: number): void => {
    const option = options[index]
    if (!option) return
    onChange(option.id)
    closeMenu(true)
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(
        nextComposerMenuIndex(activeIndex, options.length, event.key === 'ArrowDown' ? 1 : -1)
      )
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusOption(event.key === 'Home' ? 0 : options.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      chooseOption(activeIndex)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(event.key === 'ArrowDown' ? selectedIndex : options.length - 1)
    }
  }

  const popoverStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight
      }
    : undefined

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-menu-trigger ${className}${open ? ' is-open' : ''}`}
        title={triggerTitle}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={options.length === 0}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {icon}
        <span className="composer-menu-trigger-label">{triggerLabel}</span>
        <ChevronDown className="composer-menu-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={menuId}
            className={`composer-menu-popover composer-menu-popover-${kind}`}
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={
              activeIndex >= 0 ? `${menuId}-option-${activeIndex}` : undefined
            }
            data-placement={position?.placement}
            data-positioned={Boolean(position)}
            style={popoverStyle}
            onKeyDown={onMenuKeyDown}
          >
            {kind === 'permission' && (
              <div className="permission-menu-heading" role="presentation">
                <span>应如何批准 ChatGPT 操作？</span>
                <button
                  type="button"
                  onClick={() => {
                    void window.codex
                      .openExternal('https://developers.openai.com/codex/concepts/sandboxing')
                      .catch(() => undefined)
                  }}
                >
                  了解更多
                </button>
              </div>
            )}
            {options.map((option, index) => {
              const selected = option.id === value
              return (
                <button
                  ref={(node) => {
                    optionRefs.current[index] = node
                  }}
                  id={`${menuId}-option-${index}`}
                  key={option.id}
                  type="button"
                  className={`composer-menu-option${selected ? ' is-selected' : ''}${option.tone === 'warning' ? ' is-warning' : ''}`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => chooseOption(index)}
                  onPointerMove={() => setActiveIndex(index)}
                >
                  <span className="composer-menu-option-icon" aria-hidden="true">
                    {option.icon}
                  </span>
                  <span className="composer-menu-option-copy">
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  <span className="composer-menu-check" aria-hidden="true">
                    {selected && <Check />}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}

export type PermissionProfileKind = 'read-only' | 'workspace' | 'full-access' | 'custom'

export interface PermissionProfilePresentation {
  kind: PermissionProfileKind
  label: string
  description: string
  tone: 'neutral' | 'warning'
  icon: 'hand' | 'lock' | 'shield-alert' | 'shield-check' | 'shield-code'
}

function normalizedPermissionId(id: string): string {
  return id.replace(/^:/, '').toLowerCase()
}

export function permissionProfilePresentation(
  id: string,
  description?: string | null
): PermissionProfilePresentation {
  const normalized = normalizedPermissionId(id)
  if (normalized === 'read-only') {
    return {
      kind: 'read-only',
      label: '只读',
      description: description || 'Codex 可以读取当前工作区中的文件。编辑文件或访问互联网时需要批准。',
      tone: 'neutral',
      icon: 'hand'
    }
  }
  if (normalized === 'workspace' || normalized === 'workspace-write') {
    return {
      kind: 'workspace',
      label: '请求批准',
      description: '编辑外部文件和使用互联网时始终询问',
      tone: 'neutral',
      icon: 'hand'
    }
  }
  if (
    normalized === 'danger-full-access' ||
    normalized === 'danger-no-sandbox' ||
    normalized === 'full-access'
  ) {
    return {
      kind: 'full-access',
      label: '完全访问',
      description: '可不受限制地访问互联网和你电脑上的任何文件',
      tone: 'neutral',
      icon: 'shield-alert'
    }
  }
  return {
    kind: 'custom',
    label: id.replace(/^:/, '').replaceAll('-', ' '),
    description: description || '使用此配置中定义的权限',
    tone: 'neutral',
    icon: normalized === 'server-default' ? 'lock' : 'shield-check'
  }
}

export function approvalModePresentation(
  id: string,
  approvalsReviewer: ApprovalsReviewer
): PermissionProfilePresentation {
  const presentation = permissionProfilePresentation(id)
  if (
    presentation.kind === 'workspace' &&
    (approvalsReviewer === 'auto_review' || approvalsReviewer === 'guardian_subagent')
  ) {
    return {
      kind: 'workspace',
      label: '帮我批准',
      description: '仅对检测到的风险操作请求批准',
      tone: 'neutral',
      icon: 'shield-code'
    }
  }
  return presentation
}

export interface ComposerPermissionChoice {
  id: 'request-approval' | 'auto-review' | 'full-access'
  permission: string
  approvalsReviewer: ApprovalsReviewer
  presentation: PermissionProfilePresentation
}

export function composerPermissionChoices(
  profiles: readonly PermissionProfile[],
  showFullAccess = true
): ComposerPermissionChoice[] {
  const workspaceProfile = profiles.find((profile) =>
    profile.allowed && permissionProfilePresentation(profile.id).kind === 'workspace'
  )
  const fullAccessProfile = profiles.find((profile) =>
    profile.allowed && permissionProfilePresentation(profile.id).kind === 'full-access'
  )
  const options: ComposerPermissionChoice[] = []
  if (workspaceProfile) {
    options.push({
      id: 'request-approval',
      permission: workspaceProfile.id,
      approvalsReviewer: 'user',
      presentation: approvalModePresentation(workspaceProfile.id, 'user')
    })
    options.push({
      id: 'auto-review',
      permission: workspaceProfile.id,
      approvalsReviewer: 'auto_review',
      presentation: approvalModePresentation(workspaceProfile.id, 'auto_review')
    })
  }
  if (fullAccessProfile && showFullAccess) {
    options.push({
      id: 'full-access',
      permission: fullAccessProfile.id,
      approvalsReviewer: 'user',
      presentation: approvalModePresentation(fullAccessProfile.id, 'user')
    })
  }
  return options
}

export function permissionProfileLabel(id: string): string {
  return permissionProfilePresentation(id).label
}

function PermissionHandIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M7.8005 0.880859C8.32769 0.880859 8.79554 1.13313 9.09249 1.52246C9.35133 1.34803 9.66425 1.24717 9.99972 1.24707C10.8963 1.24733 11.6245 1.97451 11.6247 2.87109V3.18457C11.803 3.11725 11.9961 3.07912 12.198 3.0791C13.0948 3.07925 13.822 3.80625 13.822 4.70312V9.46582C13.8219 10.9878 13.3508 12.4062 12.3845 13.4492C11.4121 14.4987 9.98238 15.1201 8.16769 15.1201C6.9599 15.1201 6.03521 14.8289 5.22042 14.251C4.4286 13.6892 3.76872 12.8742 3.05343 11.8984C3.04565 11.8878 3.03793 11.8764 3.03097 11.8652C2.7533 11.4193 2.28506 10.6888 1.88449 10.0674C1.68464 9.75734 1.5023 9.47506 1.36984 9.27051C1.30375 9.16845 1.24976 9.0856 1.21261 9.02832L1.1589 8.94531C1.15771 8.94347 1.15597 8.94043 1.15597 8.94043L1.15499 8.93945C1.15007 8.93188 1.14487 8.92384 1.14035 8.91602C0.860932 8.43206 0.779684 7.94125 0.896205 7.49805C1.0117 7.05895 1.30611 6.72586 1.66281 6.53223C2.36534 6.15103 3.36266 6.28676 3.89621 7.1709L3.97921 7.29199V3.60352C3.97947 2.70681 4.70649 1.97957 5.60324 1.97949C5.82476 1.97953 6.03584 2.02411 6.22824 2.10449C6.40689 1.40171 7.04233 0.881187 7.8005 0.880859ZM7.8005 1.93164C7.48392 1.93203 7.22751 2.18827 7.22726 2.50488V6.83594C7.22713 7.12578 6.99174 7.36035 6.70187 7.36035C6.41211 7.36022 6.1766 7.1257 6.17648 6.83594V3.59375C6.17101 3.28151 5.91675 3.03042 5.60324 3.03027C5.28639 3.03035 5.02927 3.28671 5.02902 3.60352V8.9873C5.029 9.21737 4.87862 9.42114 4.6589 9.48926C4.43916 9.5572 4.20103 9.47389 4.07101 9.28418L3.02999 7.76367C3.02246 7.75266 3.01519 7.74105 3.00851 7.72949C2.79191 7.35432 2.42399 7.314 2.16378 7.45508C2.03476 7.52512 1.94621 7.63439 1.91183 7.76465C1.8789 7.88987 1.88126 8.0946 2.04562 8.38281C2.04708 8.38507 2.04874 8.38791 2.0505 8.39062C2.06034 8.40578 2.07495 8.42847 2.09347 8.45703C2.13074 8.5145 2.18447 8.59792 2.2507 8.7002C2.38344 8.90518 2.56697 9.18823 2.7673 9.49902C3.16061 10.1092 3.6239 10.8317 3.90792 11.2871C4.61837 12.2557 5.18994 12.942 5.82785 13.3945C6.44481 13.8321 7.15127 14.0693 8.16769 14.0693C9.73097 14.0693 10.8665 13.5421 11.614 12.7354C12.3674 11.9221 12.7721 10.7762 12.7722 9.46582V4.70312C12.7722 4.38615 12.5149 4.12906 12.198 4.12891C11.8842 4.12898 11.6299 4.38085 11.6247 4.69336V7.26758C11.6247 7.55735 11.389 7.79269 11.0993 7.79297C10.8094 7.79297 10.5739 7.55753 10.5739 7.26758V2.87109C10.5737 2.5544 10.3164 2.29811 9.99972 2.29785C9.68303 2.29811 9.42673 2.5544 9.42648 2.87109V6.16895C9.42648 6.17188 9.42555 6.17481 9.4255 6.17773V6.83594C9.42538 7.12577 9.18997 7.36033 8.90011 7.36035C8.61035 7.36022 8.37485 7.1257 8.37472 6.83594V2.50488C8.37447 2.18803 8.11741 1.93164 7.8005 1.93164Z"
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
      />
    </svg>
  )
}

function ComposerModelChevronIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.2954 6.54537C10.5003 6.3404 10.8325 6.34051 11.0376 6.54537C11.2426 6.7504 11.2426 7.08253 11.0376 7.28756L8.60689 9.71822C8.27169 10.0534 7.72823 10.0534 7.39303 9.71822L4.96236 7.28756C4.75734 7.08253 4.75734 6.7504 4.96236 6.54537C5.16739 6.34035 5.49952 6.34035 5.70455 6.54537L7.99947 8.84029L10.2954 6.54537Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PermissionShieldCodeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.06543 1.95123C9.66107 1.69076 10.3389 1.69071 10.9346 1.95123L15.9346 4.13873C16.7832 4.51008 17.3311 5.34917 17.3311 6.27545V10.5528C17.3309 14.6017 14.0489 17.8847 10 17.8848C5.95108 17.8846 2.66813 14.6017 2.66797 10.5528V6.27545C2.66797 5.34924 3.21695 4.51012 4.06543 4.13873L9.06543 1.95123ZM10.4014 3.16998C10.1456 3.05814 9.85444 3.05819 9.59863 3.16998L4.59863 5.35748C4.23427 5.51708 3.99805 5.87764 3.99805 6.27545V10.5528C3.99821 13.8671 6.68563 16.5546 10 16.5547C13.3144 16.5546 16.0008 13.8671 16.001 10.5528V6.27545C16.001 5.87756 15.7658 5.51703 15.4014 5.35748L10.4014 3.16998Z"
        fill="currentColor"
      />
      <path
        d="M13.4678 11.4318L13.333 11.4182H10.833C10.466 11.4183 10.1682 11.7162 10.168 12.0832C10.168 12.4504 10.4659 12.7481 10.833 12.7482H13.333L13.4678 12.7346C13.7706 12.6724 13.9981 12.4044 13.9981 12.0832C13.9979 11.7621 13.7706 11.494 13.4678 11.4318Z"
        fill="currentColor"
      />
      <path
        d="M7.65336 12.426C7.46431 12.7406 7.05607 12.8424 6.74125 12.6535C6.42646 12.4646 6.32395 12.0563 6.51274 11.7414L7.55668 10.0002L6.51274 8.25899C6.32395 7.94412 6.42646 7.53583 6.74125 7.34688C7.05607 7.15799 7.46431 7.25975 7.65336 7.57442L8.90336 9.6584C9.0296 9.86893 9.0296 10.1315 8.90336 10.342L7.65336 12.426Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PermissionShieldAlertIcon(): ReactNode {
  return (
    <svg className="permission-warning-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.06543 1.95123C9.66107 1.69076 10.3389 1.69071 10.9346 1.95123L15.9346 4.13873C16.7832 4.51008 17.3311 5.34917 17.3311 6.27545V10.5528C17.3309 14.6017 14.0489 17.8847 10 17.8848C5.95108 17.8846 2.66813 14.6017 2.66797 10.5528V6.27545C2.66797 5.34924 3.21695 4.51012 4.06543 4.13873L9.06543 1.95123ZM10.4014 3.16998C10.1456 3.05814 9.85444 3.05819 9.59863 3.16998L4.59863 5.35748C4.23427 5.51708 3.99805 5.87764 3.99805 6.27545V10.5528C3.99821 13.8671 6.68563 16.5546 10 16.5547C13.3144 16.5546 16.0008 13.8671 16.001 10.5528V6.27545C16.001 5.87756 15.7658 5.51703 15.4014 5.35748L10.4014 3.16998Z"
        fill="currentColor"
      />
      <path
        d="M10.8883 13.1116C10.8883 13.6025 10.4903 14.0005 9.99936 14.0005C9.50844 14.0005 9.11047 13.6025 9.11047 13.1116C9.11047 12.6207 9.50844 12.2227 9.99936 12.2227C10.4903 12.2227 10.8883 12.6207 10.8883 13.1116Z"
        fill="currentColor"
      />
      <path
        d="M10.5169 10.8949L11.1135 7.31519C11.2283 6.62672 10.6974 6 9.99941 6C9.30145 6 8.77053 6.62672 8.88528 7.31519L9.4819 10.8949C9.52406 11.1479 9.74294 11.3333 9.99941 11.3333C10.2559 11.3333 10.4748 11.1479 10.5169 10.8949Z"
        fill="currentColor"
      />
    </svg>
  )
}

function permissionProfileIcon(kind: PermissionProfilePresentation['icon']): ReactNode {
  if (kind === 'hand') return <PermissionHandIcon />
  if (kind === 'lock') return <Lock />
  if (kind === 'shield-alert') return <PermissionShieldAlertIcon />
  if (kind === 'shield-code') return <PermissionShieldCodeIcon />
  return <ShieldCheck />
}

export function shortComposerModelLabel(label: string): string {
  return label
    .replace(/^GPT-/i, '')
    .replaceAll('-', ' ')
    .replace(/\b(sol|codex)\b/gi, (value) => {
      const lowered = value.toLowerCase()
      return `${lowered[0].toUpperCase()}${lowered.slice(1)}`
    })
}

export function composerEffortLabel(effort: ReasoningEffort): string {
  const labels: Partial<Record<ReasoningEffort, string>> = {
    none: '无',
    minimal: '极低',
    low: '轻度',
    medium: '中',
    high: '高',
    xhigh: '极高',
    max: 'Max',
    ultra: 'Ultra'
  }
  return labels[effort] || effort
}

const effortDescriptions: Partial<Record<ReasoningEffort, string>> = {
  none: '最快响应，不进行额外推理。',
  minimal: '用最少推理快速处理简单任务。',
  low: '较快完成直接、明确的任务。',
  medium: '在速度和推理深度之间取得平衡。',
  high: '为复杂任务投入更多推理时间。',
  xhigh: '为高难度任务进行更深入的推理。',
  max: '使用该模型支持的最大推理深度。',
  ultra: '使用最高强度处理最具挑战性的任务。'
}

export function ComposerPermissionMenu({
  profiles,
  value,
  approvalsReviewer,
  onChange
}: {
  profiles: PermissionProfile[]
  value: string
  approvalsReviewer: ApprovalsReviewer
  onChange(value: string, approvalsReviewer: ApprovalsReviewer): void
}): ReactNode {
  const settings = useDesktopSettings()
  const fullAccessProfile = profiles.find((profile) =>
    profile.allowed && permissionProfilePresentation(profile.id).kind === 'full-access'
  )
  const selectedPresentation = approvalModePresentation(value, approvalsReviewer)
  const selectedMode = selectedPresentation.kind === 'full-access'
    ? 'full-access'
    : selectedPresentation.kind === 'workspace' &&
        (approvalsReviewer === 'auto_review' || approvalsReviewer === 'guardian_subagent')
      ? 'auto-review'
      : selectedPresentation.kind === 'workspace'
        ? 'request-approval'
        : `profile:${value}`
  const permissionOptions = composerPermissionChoices(
    profiles,
    settings.fullAccessVisible || fullAccessProfile?.id === value
  )
  return (
    <ComposerOptionMenu
      ariaLabel="更改权限"
      className={`composer-control permission-control permission-menu-trigger permission-tone-${selectedPresentation.tone}`}
      kind="permission"
      icon={permissionProfileIcon(selectedPresentation.icon)}
      value={selectedMode}
      triggerLabel={selectedPresentation.label}
      triggerTitle={selectedPresentation.description}
      options={permissionOptions.map((option) => {
        const { presentation } = option
        return {
          id: option.id,
          label: presentation.label,
          description: presentation.description,
          icon: permissionProfileIcon(presentation.icon),
          tone: presentation.tone
        }
      })}
      onChange={(optionId) => {
        const option = permissionOptions.find((candidate) => candidate.id === optionId)
        if (option) onChange(option.permission, option.approvalsReviewer)
      }}
    />
  )
}

export function ComposerModelMenus({
  models,
  modelId,
  onModelChange,
  effort,
  onEffortChange
}: {
  models: ModelOption[]
  modelId: string
  onModelChange(value: string): void
  effort: ReasoningEffort
  onEffortChange(value: ReasoningEffort): boolean
}): ReactNode {
  const zoom = useWindowZoom()
  const model = models.find((candidate) => candidate.id === modelId) || models[0]
  const efforts = model?.supportedReasoningEfforts || []
  const selectedEffort = efforts.find((option) => option.reasoningEffort === effort)
  const menuId = useId()
  const effortStatusId = useId()
  const effortHelpId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const simpleItemRefs = useRef<Array<HTMLButtonElement | HTMLDivElement | null>>([])
  const modelItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'simple' | 'models'>('simple')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<ComposerPopoverPosition | null>(null)
  const selectedEffortIndex = Math.max(
    0,
    efforts.findIndex((option) => option.reasoningEffort === effort)
  )
  const selectedModelIndex = Math.max(
    0,
    models.findIndex((candidate) => candidate.id === model?.id)
  )

  const focusItem = (index: number): void => {
    setActiveIndex(index)
    const item = view === 'simple' ? simpleItemRefs.current[index] : modelItemRefs.current[index]
    item?.focus()
  }

  const closeMenu = (restoreFocus: boolean): void => {
    setOpen(false)
    setView('simple')
    setPosition(null)
    if (restoreFocus) focusElement(triggerRef)
  }

  const openMenu = (): void => {
    if (!model || efforts.length === 0) return
    setView('simple')
    setActiveIndex(0)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return

    const updatePosition = (): void => {
      setPosition(
        computeComposerPopoverPosition(
          trigger.getBoundingClientRect(),
          popover.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          'end',
          8,
          8,
          zoom
        )
      )
    }

    updatePosition()
    const item = view === 'simple' ? simpleItemRefs.current[activeIndex] : modelItemRefs.current[activeIndex]
    item?.focus()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [activeIndex, open, view, zoom])

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

  const chooseEffort = (index: number): void => {
    const option = efforts[index]
    if (option && onEffortChange(option.reasoningEffort)) closeMenu(true)
  }

  const chooseEffortFromPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rail = event.currentTarget.querySelector<HTMLElement>('.reasoning-slider-rail')
    if (!rail) return
    const bounds = rail.getBoundingClientRect()
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    chooseEffort(Math.round(progress * Math.max(0, efforts.length - 1)))
  }

  const onSliderPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    chooseEffortFromPointer(event)
  }

  const onSliderPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    chooseEffortFromPointer(event)
  }

  const onSimpleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    if (index === 2 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      chooseEffort(
        nextReasoningEffortIndex(
          selectedEffortIndex,
          efforts.length,
          event.key === 'ArrowRight' ? 1 : -1
        )
      )
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(nextComposerMenuIndex(index, 3, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusItem(event.key === 'Home' ? 0 : 2)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const onModelKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(nextComposerMenuIndex(index, models.length, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusItem(event.key === 'Home' ? 0 : models.length - 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setView('simple')
      setActiveIndex(0)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const showModels = (): void => {
    setView('models')
    setActiveIndex(selectedModelIndex)
  }

  const resetToDefault = (): void => {
    const defaultModel = models.find((candidate) => candidate.isDefault) || model
    if (!defaultModel) return
    if (defaultModel.id !== model?.id) onModelChange(defaultModel.id)
    else if (onEffortChange(defaultModel.defaultReasoningEffort)) closeMenu(true)
  }

  const selectedPercent = reasoningEffortPercent(selectedEffortIndex, efforts.length)
  const popoverStyle: CSSProperties | undefined = position
    ? { left: position.left, top: position.top, maxHeight: position.maxHeight }
    : undefined
  const triggerTitle = [
    model?.description,
    selectedEffort?.description || effortDescriptions[effort]
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="model-effort-select model-effort-menus">
      <button
        ref={triggerRef}
        type="button"
        className={`composer-menu-trigger text-select model-effort-menu-trigger${open ? ' is-open' : ''}`}
        aria-label="模型和推理强度"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-selected-model={model?.id || modelId}
        data-selected-reasoning-effort={effort}
        disabled={!model || efforts.length === 0}
        title={triggerTitle}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          openMenu()
        }}
      >
        <span className="model-effort-trigger-model">
          {shortComposerModelLabel(model?.displayName || modelId)}
        </span>
        <span className="model-effort-trigger-effort" data-effort={effort}>
          {composerEffortLabel(effort)}
        </span>
        <ComposerModelChevronIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={menuId}
            role="menu"
            aria-label="模型和推理强度"
            className={`composer-menu-popover model-effort-popover model-effort-view-${view}`}
            data-placement={position?.placement}
            data-positioned={Boolean(position)}
            data-effort={effort}
            style={popoverStyle}
          >
            {view === 'simple' ? (
              <div className="model-effort-simple-view">
                <div className="model-effort-top-row">
                  <button
                    ref={(node) => {
                      simpleItemRefs.current[0] = node
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={activeIndex === 0 ? 0 : -1}
                    className="model-effort-current"
                    aria-label="选择模型"
                    onClick={showModels}
                    onKeyDown={(event) => onSimpleKeyDown(event, 0)}
                    onPointerMove={() => setActiveIndex(0)}
                  >
                    <strong className="model-effort-current-title">
                      {composerEffortLabel(effort)}
                    </strong>
                    <span className="model-effort-current-model">
                      {shortComposerModelLabel(model?.displayName || modelId)}
                      <ChevronRight />
                    </span>
                  </button>
                  <button
                    ref={(node) => {
                      simpleItemRefs.current[1] = node
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={activeIndex === 1 ? 0 : -1}
                    className="model-effort-reset"
                    aria-label="重置为默认"
                    title="重置为默认"
                    onClick={resetToDefault}
                    onKeyDown={(event) => onSimpleKeyDown(event, 1)}
                    onPointerMove={() => setActiveIndex(1)}
                  >
                    <RotateCcw />
                  </button>
                </div>
                <span id={effortStatusId} role="status" aria-live="polite" className="sr-only">
                  {`${shortComposerModelLabel(model?.displayName || modelId)} 深度，第 ${selectedEffortIndex + 1} 项，共 ${efforts.length} 项。`}
                </span>
                <span id={effortHelpId} className="sr-only">
                  使用左右方向键调整强度
                </span>
                <div
                  ref={(node) => {
                    simpleItemRefs.current[2] = node
                  }}
                  role="menuitem"
                  aria-label="强度"
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  aria-describedby={`${effortStatusId} ${effortHelpId}`}
                  tabIndex={activeIndex === 2 ? 0 : -1}
                  className="reasoning-slider-control"
                  data-reasoning-slider="true"
                  onKeyDown={(event) => onSimpleKeyDown(event, 2)}
                  onPointerDown={onSliderPointerDown}
                  onPointerMove={onSliderPointerMove}
                >
                  <div className="reasoning-slider-rail">
                    <span
                      className="reasoning-slider-range"
                      style={{
                        width: `calc(13px + (100% - 26px) * ${selectedPercent / 100})`
                      }}
                    />
                    <span className="reasoning-slider-ticks" aria-hidden="true">
                      {efforts.map((option, index) => (
                        <i
                          key={option.reasoningEffort}
                          data-effort={option.reasoningEffort}
                          className={index <= selectedEffortIndex ? 'is-selected' : undefined}
                        />
                      ))}
                    </span>
                    <span
                      className="reasoning-slider-thumb"
                      style={{
                        left: `calc(13px + (100% - 26px) * ${selectedPercent / 100})`
                      }}
                      aria-hidden="true"
                    />
                    <span
                      role="slider"
                      aria-label="推理强度"
                      aria-valuemin={0}
                      aria-valuemax={Math.max(0, efforts.length - 1)}
                      aria-valuenow={selectedEffortIndex}
                      aria-valuetext={composerEffortLabel(effort)}
                      aria-orientation="horizontal"
                      className="reasoning-slider-a11y"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="model-effort-model-view">
                <div className="model-effort-model-heading">选择模型</div>
                <div className="model-effort-model-list">
                  {models.map((candidate, index) => {
                    const selected = candidate.id === model?.id
                    return (
                      <button
                        ref={(node) => {
                          modelItemRefs.current[index] = node
                        }}
                        key={candidate.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        tabIndex={activeIndex === index ? 0 : -1}
                        className={`model-effort-model-option${selected ? ' is-selected' : ''}`}
                        title={candidate.description || undefined}
                        onClick={() => {
                          onModelChange(candidate.id)
                          closeMenu(true)
                        }}
                        onKeyDown={(event) => onModelKeyDown(event, index)}
                        onPointerMove={() => setActiveIndex(index)}
                      >
                        <span>{shortComposerModelLabel(candidate.displayName)}</span>
                        {selected && <Check aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

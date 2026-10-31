import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Search, RotateCw } from 'lucide-react'
import { computeComposerPopoverPosition, type ComposerPopoverPosition } from './ComposerMenus'
import { ProjectIcon } from './ProjectIcons'
import { LocalEnvironmentIcon } from './LocalEnvironmentIcons'
import { useWindowZoom } from './windowZoom'
import {
  LocalEnvironmentBranchCatalog, localBranchSections, localEnvironmentChoice, selectLocalBranch,
  type NewThreadWorktreeChoice
} from './localEnvironmentState'
import './LocalEnvironmentDialog.css'

export type { NewThreadWorktreeChoice } from './localEnvironmentState'
type Picker = 'branch' | 'environment' | null

export function LocalEnvironmentDialog({ cwd, choice, onSave, onClose }: {
  cwd: string; choice: NewThreadWorktreeChoice | null
  onSave(choice: NewThreadWorktreeChoice): void
  onClose(): void
}): ReactNode {
  const [selection, setSelection] = useState(() => localEnvironmentChoice(cwd, choice))
  const [picker, setPicker] = useState<Picker>(null)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<ComposerPopoverPosition | null>(null)
  const catalog = useMemo(() => new LocalEnvironmentBranchCatalog((path) => window.codex.listGitBranches(path)), [])
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot)
  const zoom = useWindowZoom()
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const switchRef = useRef<HTMLButtonElement>(null)
  const branchRef = useRef<HTMLButtonElement>(null)
  const environmentRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setSelection(localEnvironmentChoice(cwd, choice)) }, [cwd, choice])
  useEffect(() => {
    setPicker(null)
    setQuery('')
    void catalog.load(cwd)
    return () => catalog.invalidate()
  }, [catalog, cwd])

  const save = (next: NewThreadWorktreeChoice): void => { setSelection(next); onSave(next) }
  const back = (): void => {
    const trigger = picker === 'branch' ? branchRef.current : environmentRef.current
    setPicker(null)
    setQuery('')
    requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
  }
  const openPicker = (next: Exclude<Picker, null>): void => { setQuery(''); setPicker(next) }

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const trigger = previous?.closest<HTMLElement>('[data-local-environment-trigger]') ||
      [...document.querySelectorAll<HTMLElement>('[data-local-environment-trigger]')].find((node) => node.getBoundingClientRect().width > 0) || null
    anchor.current = trigger
    trigger?.setAttribute('aria-expanded', 'true')
    trigger?.setAttribute('aria-controls', id)
    ;(switchRef.current?.disabled ? branchRef.current : switchRef.current)?.focus({ preventScroll: true })
    return () => {
      trigger?.setAttribute('aria-expanded', 'false')
      trigger?.removeAttribute('aria-controls')
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [id])

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const target = anchor.current || document.querySelector<HTMLElement>('.composer')
      if (!target || !panel.current) return
      setPosition(computeComposerPopoverPosition(
        target.getBoundingClientRect(), panel.current.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight }, 'end', 4, 8, zoom
      ))
    }
    updatePosition()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePosition) : null
    if (panel.current) observer?.observe(panel.current)
    if (anchor.current) observer?.observe(anchor.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [picker, zoom])
  useLayoutEffect(() => { if (picker) searchRef.current?.focus({ preventScroll: true }) }, [picker])

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (!(event.target instanceof Node) || panel.current?.contains(event.target) || anchor.current?.contains(event.target)) return
      onClose()
    }
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (document.body.dataset.windowCloseActive === 'true') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (picker) back()
        else onClose()
      }
      if (event.key === 'Tab') {
        const nodes = [...panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])') || []]
          .filter((node) => !node.closest('[hidden]'))
        const first = nodes[0], last = nodes.at(-1)
        if (!panel.current?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus()
        }
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey, true) }
  }, [picker, onClose])

  const branches = snapshot.cwd === cwd ? snapshot.branches : null
  const sections = branches ? localBranchSections(branches, query) : []
  const selectedBranch = selection.branch || branches?.defaultBranch || null
  const unavailable = Boolean(selection.branch && branches && ![...branches.localBranches, ...branches.remoteBranches].includes(selection.branch))
  const branchLabel = unavailable ? '所选分支不可用' : selection.branch || branches?.defaultBranch || '默认分支'
  const canEnable = !selection.branch || Boolean(branches && !unavailable)
  const chooseBranch = (branch: string): void => {
    const next = selectLocalBranch(cwd, selection, snapshot, branch)
    if (!next) return
    save(next)
    back()
  }
  const onPickerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if ((event.key === 'Home' || event.key === 'End') && event.target instanceof HTMLInputElement) return
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])')]
    if (options.length === 0) return
    event.preventDefault()
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
      event.key === 'ArrowDown' ? (current + 1) % options.length : current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length
    options[next].focus()
    options[next].scrollIntoView({ block: 'nearest' })
  }

  const style: CSSProperties = { position: 'fixed', left: position?.left ?? 0, top: position?.top ?? 0,
    maxHeight: position?.maxHeight, visibility: position || typeof document === 'undefined' ? 'visible' : 'hidden' }
  const content = <div className="local-environment-popover" ref={panel} style={style} id={id}
    role="dialog" aria-label="配置本地环境" data-placement={position?.placement ?? 'top'}>
    <div className="local-environment-settings" hidden={picker !== null}>
      <div className="local-environment-title">配置本地环境</div>
      <div className="local-environment-setting-row">
        <LocalEnvironmentIcon name="worktree" />
        <label htmlFor={`${id}-worktree`}>新建工作树</label>
        <button type="button" id={`${id}-worktree`} ref={switchRef} role="switch" aria-label="新建工作树"
          aria-checked={selection.enabled} className="local-environment-switch" data-state={selection.enabled ? 'checked' : 'unchecked'}
          disabled={!selection.enabled && !canEnable} title={!canEnable ? '请选择可用分支' : undefined}
          onClick={() => save({ ...selection, enabled: !selection.enabled })}><span /></button>
      </div>
      <button type="button" ref={branchRef} className="local-environment-setting-row local-environment-picker-trigger"
        aria-label="此聊天应从哪个分支开始？" onClick={() => openPicker('branch')}>
        <LocalEnvironmentIcon name="branch" /><span>分支</span><span className="local-environment-setting-value" title={selection.branch || branchLabel}>{branchLabel}</span><ProjectIcon name="open-chat" />
      </button>
      <button type="button" ref={environmentRef} className="local-environment-setting-row local-environment-picker-trigger"
        disabled={!selection.enabled} title={!selection.enabled ? '启用工作树后才能选择环境' : undefined}
        aria-label="环境" onClick={() => openPicker('environment')}>
        <LocalEnvironmentIcon name="environment" /><span>环境</span><span className="local-environment-setting-value">无环境</span><ProjectIcon name="open-chat" />
      </button>
    </div>
    <div hidden={picker === null}>
      {picker && <div className="local-environment-picker" role="group" onKeyDown={onPickerKeyDown}>
        <button type="button" className="local-environment-back" aria-label="返回聊天设置" onClick={back}>
          <LocalEnvironmentIcon name="back" /><span>{picker === 'branch' ? '分支' : '环境'}</span>
        </button>
        <label className="local-environment-search"><Search /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)}
          aria-label={picker === 'branch' ? '搜索分支…' : '搜索环境…'}
          placeholder={picker === 'branch' ? '搜索分支…' : '搜索环境…'} /></label>
        <div className="local-environment-separator" />
        {picker === 'branch' ? <div className="local-environment-picker-results" role="listbox" aria-label="分支">
          {(snapshot.cwd !== cwd || snapshot.status === 'idle' || snapshot.status === 'loading') &&
            <div className="local-environment-message" role="status">正在加载分支…</div>}
          {snapshot.cwd === cwd && snapshot.status === 'error' && <div className="local-environment-message local-environment-error" role="alert">
            <span title={snapshot.error ?? undefined}>加载分支失败</span>
            <button type="button" className="local-environment-retry" aria-label="重新加载分支" title="重新加载分支" onClick={() => { void catalog.load(cwd, true) }}><RotateCw /></button>
          </div>}
          {sections.map((section) => <div className="local-environment-branch-section" key={section.label}>
            <div className="local-environment-section-label">{section.label === 'Local branches' ? '本地分支' : '远程分支'}</div>
            {section.branches.map((branch) => <button type="button" key={branch} className="local-environment-picker-option" role="option"
              aria-selected={branch === selectedBranch} title={branch} onClick={() => chooseBranch(branch)}>
              <LocalEnvironmentIcon name="branch-list" /><span>{branch}</span>{branch === selectedBranch && <LocalEnvironmentIcon name="branch-check" />}
            </button>)}
          </div>)}
          {snapshot.status === 'ready' && sections.length === 0 && <div className="local-environment-message">{query.trim() ? '没有匹配的分支' : '没有可用分支'}</div>}
        </div> : <>
          <div className="local-environment-picker-results" role="listbox" aria-label="环境">
            {'不使用环境'.includes(query.trim()) &&
              <button type="button" className="local-environment-picker-option" role="option" aria-selected="true" onClick={() => { save(selection); back() }}>
                <span>不使用环境</span><LocalEnvironmentIcon name="check" />
              </button>}
          </div>
          <div className="local-environment-separator" />
          <button type="button" className="local-environment-picker-option" disabled title="暂不支持环境设置">
            <LocalEnvironmentIcon name="open-settings" /><span>设置项目</span>
          </button>
        </>}
      </div>}
    </div>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

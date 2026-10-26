import { Maximize2, Minimize2, PanelBottom, PanelRight, Plus, X } from 'lucide-react'
import { type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { InteractiveTerminal } from './InteractiveTerminal'
import { InteractiveTerminalRuntime } from './interactiveTerminalRuntime'
import { terminalTabTitle, type TerminalTabsController } from './terminalTabs'
import type { TerminalPanelPlacement } from './terminalPanelLayout'
import { TerminalGlyph } from './terminalGlyph'
import { useTerminalPanelDock } from './useTerminalPanelDock'
import { useTerminalTabsSnapshot } from './useTerminalTabsController'
import './InteractiveTerminalPanel.css'
export { useTerminalTabsController, useTerminalTabsSnapshot } from './useTerminalTabsController'
export { TerminalTabsController } from './terminalTabs'
const TERMINAL_TAB_DRAG_TYPE = 'application/x-codex-terminal-tab'

export interface InteractiveTerminalPanelProps {
  controller: TerminalTabsController
  placement: TerminalPanelPlacement
  cwd: string
  fontSize?: number
  fontFamily?: string
  uiZoom?: number
  integratedChrome?: boolean
  active?: boolean
}

export function InteractiveTerminalPanel({ controller, placement, cwd, fontSize, fontFamily, uiZoom = 1, integratedChrome = false, active = true }: InteractiveTerminalPanelProps): ReactNode {
  const snapshot = useTerminalTabsSnapshot(controller)
  const panelRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const [menuTab, setMenuTab] = useState<{ id: string; x: number; y: number } | null>(null)
  const [dropTab, setDropTab] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const tabs = snapshot.tabs.filter((tab) => tab.placement === placement)
  const activeId = snapshot.active[placement]
  const visible = snapshot.visible[placement]
  const effectiveVisible = integratedChrome ? active && tabs.length > 0 : visible
  const target = placement === 'bottom' ? 'right' : 'bottom'
  const dock = useTerminalPanelDock(panelRef, {
    placement, size: snapshot.sizes[placement], fullView: snapshot.fullView[placement], uiZoom, enabled: !integratedChrome && tabs.length > 0,
    onSizeChange: (size) => controller.setSize(placement, size), onClose: () => controller.hide(placement)
  })
  useEffect(() => { setMenuTab(null) }, [controller])
  useEffect(() => {
    if (!menuTab) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuTab(null)
    }
    const close = (): void => setMenuTab(null)
    document.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menuTab])
  const showMenu = (tabId: string, clientX: number, clientY: number): void => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
    setMenuTab({ id: tabId, x: Math.max(4, Math.min((clientX - rect.left) / zoom, rect.width / zoom - 208)), y: Math.max(4, Math.min((clientY - rect.top) / zoom, rect.height / zoom - 144)) })
  }
  const acceptsTab = (event: DragEvent): boolean => event.dataTransfer.types.includes(TERMINAL_TAB_DRAG_TYPE)
  const drop = (event: DragEvent, beforeId: string | null): void => {
    if (!acceptsTab(event)) return
    event.preventDefault(); event.stopPropagation(); setDropTab(null)
    const dragged = event.dataTransfer.getData(TERMINAL_TAB_DRAG_TYPE)
    if (controller.getSnapshot().tabs.some((tab) => tab.id === dragged)) controller.reorder(dragged, beforeId, placement)
  }
  const keyboardSelect = (event: KeyboardEvent, selected: string): void => {
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      event.preventDefault(); event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      showMenu(selected, rect.left, rect.bottom)
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault(); event.stopPropagation()
      void controller.close(selected).then(() => {
        const active = controller.getSnapshot().active[placement]
        if (active) panelRef.current?.querySelector<HTMLElement>(`[data-terminal-tab-id="${active}"]`)?.focus()
      })
      return
    }
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const index = tabs.findIndex((tab) => tab.id === selected)
    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null
    if (!next) return
    event.preventDefault(); event.stopPropagation(); controller.select(next.id)
    panelRef.current?.querySelector<HTMLElement>(`[data-terminal-tab-id="${next.id}"]`)?.focus()
  }
  if (!tabs.length) return null
  return (
    <section id={id} ref={panelRef} hidden={!effectiveVisible} className={`interactive-terminal interactive-terminal-panel terminal-placement-${placement}${integratedChrome ? ' terminal-workbench-embedded' : ''}${!integratedChrome && dock.fullView ? ' terminal-panel-full-view' : ''}${!integratedChrome && dock.resizing ? ' terminal-panel-resizing' : ''}`}
      style={integratedChrome ? undefined : dock.style} role="region" aria-label={`${placement === 'bottom' ? 'Bottom' : 'Right'} terminal panel`} data-placement={placement} data-terminal-panel-visible={effectiveVisible}
      onDragOver={(event) => { if (acceptsTab(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={(event) => drop(event, null)}>
      {!integratedChrome && !dock.fullView && <div className="terminal-panel-resize-handle" role="separator" tabIndex={0} aria-label={`Resize ${placement} terminal panel`} aria-controls={id}
        aria-orientation={placement === 'bottom' ? 'horizontal' : 'vertical'} aria-valuemin={dock.limits.minimum} aria-valuemax={Number.isFinite(dock.limits.maximum) ? dock.limits.maximum : undefined}
        aria-valuenow={Math.round(dock.size)} {...dock.resizeHandlers} />}
      {!integratedChrome && <header className="interactive-terminal-header interactive-terminal-tab-header">
        <div className="interactive-terminal-tab-list" role="tablist" aria-label="Terminal tabs">
          {tabs.map((tab) => {
            const title = terminalTabTitle(tab, snapshot.tabs)
            return <div className={`interactive-terminal-tab${tab.id === activeId ? ' is-selected' : ''}${dropTab?.id === tab.id ? ` is-drop-${dropTab.edge}` : ''}`} key={tab.id} draggable
              onContextMenu={(event) => { event.preventDefault(); showMenu(tab.id, event.clientX, event.clientY) }}
              onDragStart={(event) => { setMenuTab(null); event.dataTransfer.setData(TERMINAL_TAB_DRAG_TYPE, tab.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => setDropTab(null)}
              onDragOver={(event) => {
                if (!acceptsTab(event)) return
                event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                setDropTab({ id: tab.id, edge: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' })
              }}
              onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTab(null) }}
              onDrop={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const before = event.clientX < rect.left + rect.width / 2 ? tab.id : tabs[tabs.findIndex((item) => item.id === tab.id) + 1]?.id ?? null
                drop(event, before)
              }}>
              <button type="button" role="tab" id={`${id}-${tab.id}`} data-terminal-tab-id={tab.id} aria-selected={tab.id === activeId} aria-controls={`${id}-surface-${tab.id}`} tabIndex={tab.id === activeId ? 0 : -1}
                aria-haspopup="menu" aria-keyshortcuts="Delete" aria-expanded={menuTab?.id === tab.id ? true : undefined}
                title={title} onClick={() => { setMenuTab(null); controller.select(tab.id) }} onKeyDown={(event) => keyboardSelect(event, tab.id)}
                onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); void controller.close(tab.id) } }}><TerminalGlyph /><span>{title}</span></button>
              <button type="button" className="interactive-terminal-tab-close" aria-label={`Close ${title} tab`} title={`Close ${title} tab`} onClick={() => { void controller.close(tab.id) }}><X /></button>
            </div>
          })}
        </div>
        <div className="interactive-terminal-actions">
          <button type="button" className="quiet-icon-button" aria-label="New terminal" title="New terminal" disabled={!snapshot.canCreate} onClick={() => controller.create(placement, cwd)}><Plus /></button>
          <button type="button" className="quiet-icon-button" aria-label={`Move terminal to ${target} panel`} title={`Move to ${target} panel`} disabled={!activeId} onClick={() => { if (activeId) controller.move(activeId, target) }}>{target === 'right' ? <PanelRight /> : <PanelBottom />}</button>
          <button type="button" className="quiet-icon-button" aria-label={dock.fullView ? 'Exit terminal full view' : 'Show terminal in full view'} title={dock.fullView ? 'Exit full view' : 'Full view'} aria-pressed={dock.fullView} onClick={() => controller.toggleFullView(placement)}>{dock.fullView ? <Minimize2 /> : <Maximize2 />}</button>
          <button type="button" className="quiet-icon-button" aria-label={`Hide ${placement} panel`} title={`Hide ${placement} panel`} onClick={() => controller.hide(placement)}><X /></button>
        </div>
      </header>}
      <div className="interactive-terminal-tab-surfaces">
        {tabs.map((tab) => <div className="interactive-terminal-tab-surface" key={tab.id} hidden={tab.id !== activeId}>
          <InteractiveTerminal cwd={tab.cwd} placement={placement} title={terminalTabTitle(tab, snapshot.tabs)} fontSize={fontSize} fontFamily={fontFamily} uiZoom={uiZoom}
            active={effectiveVisible && tab.id === activeId} presentation="tab" panelId={`${id}-surface-${tab.id}`} labelledBy={`${id}-${tab.id}`} runtime={controller.acquireRuntime(tab.id, (item) => new InteractiveTerminalRuntime({ cwd: item.cwd, onTitleChange: (title) => controller.setShellTitle(item.id, title) }))} onClose={() => { void controller.close(tab.id) }} />
        </div>)}
      </div>
      {menuTab && tabs.some((tab) => tab.id === menuTab.id) && <div ref={menuRef} className="interactive-terminal-tab-menu" role="menu" aria-label="Terminal tab actions" style={{ left: menuTab.x, top: menuTab.y }} onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') { event.preventDefault(); panelRef.current?.querySelector<HTMLElement>(`[data-terminal-tab-id="${menuTab.id}"]`)?.focus() }
          event.stopPropagation(); setMenuTab(null); return
        }
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'ArrowDown' ? items[(index + 1) % items.length] : event.key === 'ArrowUp' ? items[(index - 1 + items.length) % items.length] : event.key === 'Home' ? items[0] : event.key === 'End' ? items.at(-1) : null
        if (next) { event.preventDefault(); event.stopPropagation(); next.focus() }
      }}>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { controller.move(menuTab.id, target); setMenuTab(null) }}>{target === 'right' ? <PanelRight /> : <PanelBottom />}Move to {target} panel</button>
        <div className="interactive-terminal-tab-menu-separator" role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { void controller.close(menuTab.id); setMenuTab(null) }}><X />Close</button>
        <button type="button" role="menuitem" tabIndex={-1} disabled={tabs.length < 2} onClick={() => { void controller.closeOthers(menuTab.id); setMenuTab(null) }}><X />Close other tabs</button>
        <button type="button" role="menuitem" tabIndex={-1} disabled={tabs.at(-1)?.id === menuTab.id} onClick={() => { void controller.closeToRight(menuTab.id); setMenuTab(null) }}><X />Close tabs to the right</button>
      </div>}
    </section>
  )
}

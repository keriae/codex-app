import { AlertCircle, Check, ChevronDown, ChevronRight, Download, Folder, LoaderCircle, MessageSquare, PlugZap, RefreshCw, Settings2, Sparkles, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { BackendStatus, ExternalAgentImportApi, ExternalAgentImportHistory, ExternalAgentImportPreferences, ExternalAgentImportResult, ExternalAgentMigrationItem, ExternalAgentMigrationItemType, ExternalAgentProviderId } from '../../shared/api'
import type { Thread } from './protocol'
import { ImportController, importError, isImportRunning, type ImportOperation, type ImportState } from './importController'
import { createImportReview, IMPORT_CATEGORIES, IMPORT_PROVIDERS, IMPORT_PROVIDER_LABELS, importCategoryLabel, importItemDetailNames, importMessage as m, importProjectItemKey, importResultCounts, importResultOutcome, initialImportSelection, loadImportedAppLinks, selectedImportItems, type ImportedAppLink, type ImportSelection } from './importModels'
import { listAllMcpServers } from './IntegrationsSettings'
import { ImportProviderIcon } from './ImportProviderIcon'
import type { McpServerSummary } from './integrationModels'
import './ImportSettings.css'

export type ImportSettingsDestination = 'plugins' | 'hooks'
export type ImportIntegrationTab = 'plugins' | 'mcp' | 'skills'
export interface ImportSettingsProps {
  backend: BackendStatus
  workspaceRoots?: string[]
  api?: ExternalAgentImportApi
  onNavigateSettings?(section: ImportSettingsDestination, tab?: ImportIntegrationTab): void
  onOpenThread?(thread: Thread): void
  onImportCompleted?(result: ExternalAgentImportResult): void
}

function ImportGroup({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }): ReactNode {
  return <section className="settings-page-group"><h3>{title}</h3>{subtitle && <p className="import-group-description">{subtitle}</p>}<div className="settings-page-card">{children}</div></section>
}
function ImportRow({ title, description, children, icon }: { title: ReactNode; description?: ReactNode; children?: ReactNode; icon?: ReactNode }): ReactNode {
  return <div className="settings-page-row import-row">{icon && <span className="import-row-icon">{icon}</span>}<div className="settings-page-row-copy"><strong>{title}</strong>{description && <span>{description}</span>}</div><div className="settings-page-row-control">{children}</div></div>
}
function ImportButton({ children, disabled, onClick, primary = false }: { children: ReactNode; disabled?: boolean; onClick?(): void; primary?: boolean }): ReactNode {
  return <button type="button" className={`settings-page-pill${primary ? ' import-primary-button' : ''}`} disabled={disabled} onClick={onClick}>{children}</button>
}
function ImportToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }): ReactNode {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`settings-page-toggle${checked ? ' checked' : ''}`} onClick={() => onChange(!checked)}><span /></button>
}
function relativeImportTime(date: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000))
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时` : `${Math.floor(minutes / 1440)} 天`
}

function ImportModal({ title, busy = false, onClose, children }: { title: string; busy?: boolean; onClose(): void; children: ReactNode }): ReactNode {
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); const pending = useRef(busy)
  close.current = onClose; pending.current = busy
  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) close.current(); return }
      if (event.key !== 'Tab') return
      const controls = [...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select:not(:disabled)') ?? []].filter((entry) => entry.getClientRects().length)
      if (!controls.length) { event.preventDefault(); dialog.current?.focus(); return }
      const first = controls[0]; const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); requestAnimationFrame(() => { if (restore?.isConnected) restore.focus() }) }
  }, [])
  return <div className="import-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><div ref={dialog} tabIndex={-1} className="import-modal" role="dialog" aria-modal="true" aria-label={title}><button type="button" className="import-modal-close settings-page-icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X /></button>{children}</div></div>
}

function operationTitle(operation: ImportOperation): string {
  if (operation.error) return m('settings.agent.importSettings.progress.errorTitle')
  if (!operation.result && operation.progress.phase === 'completed') {
    if (!operation.progress.itemTypeResults) return '导入已完成'
    const counts = importResultCounts({ itemTypeResults: operation.progress.itemTypeResults })
    return counts.failed ? counts.imported ? '部分项目已导入' : m('settings.agent.importSettings.progress.errorTitle') : counts.imported ? m('settings.agent.importSettings.progress.successTitle') : m('settings.import.history.noResults')
  }
  if (!operation.result && operation.progress.phase === 'failed') return m('settings.agent.importSettings.progress.errorTitle')
  if (!operation.result) return operation.progress.phase === 'stopping' ? '正在停止导入' : m('settings.agent.importSettings.progress.runningTitle')
  const outcome = importResultOutcome(operation.result)
  return outcome === 'success' ? m('settings.agent.importSettings.progress.successTitle') : outcome === 'partial' ? '部分项目已导入' : outcome === 'stopped' ? '导入已停止' : outcome === 'empty' ? m('settings.import.history.noResults') : m('settings.agent.importSettings.progress.errorTitle')
}

export function ImportReviewDialog({ items, providers, operation, onImport, onClose, onViewImported }: { items: ExternalAgentMigrationItem[]; providers: ExternalAgentProviderId[]; operation: ImportOperation | null; onImport(items: ExternalAgentMigrationItem[]): void; onClose(): void; onViewImported(): void }): ReactNode {
  const model = useMemo(() => createImportReview(items, providers), [items, providers])
  const [selection, setSelection] = useState<ImportSelection>(() => initialImportSelection(model))
  const [setupExpanded, setSetupExpanded] = useState(false)
  const [projectsExpanded, setProjectsExpanded] = useState(false)
  const [chatsExpanded, setChatsExpanded] = useState(false)
  const running = isImportRunning(operation)
  const selected = selectedImportItems(model, selection)
  const completed = Boolean(operation?.result && importResultOutcome(operation.result) !== 'failed')
  const retrying = Boolean(operation?.error || operation?.result && importResultOutcome(operation.result) === 'failed')
  const change = (key: string, value: boolean): void => setSelection((current) => ({ ...current, [key]: value }))
  const setup = model.choices.filter((choice) => choice.kind === 'setup')
  const groups = model.choices.filter((choice) => choice.kind !== 'setup')
  const projectSelected = (cwd: string): boolean => model.projectItems.filter((item) => item.cwd === cwd).every((item) => selection[importProjectItemKey(item)] ?? true)
  const chooseProject = (cwd: string, checked: boolean): void => setSelection((current) => ({ ...current, ...Object.fromEntries(model.projectItems.map((item) => [importProjectItemKey(item), item.cwd === cwd ? checked : current[importProjectItemKey(item)] ?? true])) }))
  return <ImportModal title={m('electron.onboarding.welcomeV2.externalAgentImport.items.title')} busy={running} onClose={onClose}>
    <header className="import-modal-heading"><span className="import-modal-emblem"><Download /></span><h2>{completed && operation ? operationTitle(operation) : m('electron.onboarding.welcomeV2.externalAgentImport.items.title')}</h2><p>{providers.map((provider) => IMPORT_PROVIDER_LABELS[provider]).join('、')}</p></header>
    <div className="import-modal-body">
      <p className="import-review-subtitle">{m('electron.onboarding.welcomeV2.externalAgentImport.items.subtitle')}</p>
      {setup.length > 0 && <div className="import-choice-group"><button type="button" className="import-choice-heading" aria-expanded={setupExpanded} disabled={running || completed} onClick={() => setSetupExpanded(!setupExpanded)}><Settings2 /><div><strong>{m('electron.onboarding.welcomeV2.externalAgentImport.toolsAndSetup.title')}</strong><span>{m('electron.onboarding.welcomeV2.externalAgentImport.toolsAndSetup.description')}</span></div><ChevronDown /></button>{setupExpanded && setup.map((choice) => <div className="import-choice" key={choice.key}><label><input type="checkbox" checked={selection[choice.key] ?? false} disabled={running || completed} onChange={(event) => change(choice.key, event.currentTarget.checked)} /><div><strong>{choice.label}</strong><span>{choice.description}</span></div></label><details><summary>{m('electron.onboarding.welcomeV2.externalAgentImport.toolsAndSetup.details')}</summary><ul>{choice.items.flatMap(importItemDetailNames).map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}</ul><span>{IMPORT_PROVIDER_LABELS[choice.providerId!]}</span></details></div>)}</div>}
      {groups.map((choice) => <div key={choice.key} className="import-choice-group"><div className="import-choice"><label><input type="checkbox" checked={selection[choice.key] ?? false} disabled={running || completed} onChange={(event) => change(choice.key, event.currentTarget.checked)} />{choice.kind === 'projects' ? <Folder /> : <MessageSquare />}<div><strong>{choice.label}</strong><span>{choice.description}</span></div></label><button type="button" className="settings-page-icon-button" aria-label={choice.kind === 'projects' ? m('electron.onboarding.welcomeV2.externalAgentImport.projects.info') : m('electron.onboarding.welcomeV2.externalAgentImport.recentChats.info')} aria-expanded={choice.kind === 'projects' ? projectsExpanded : chatsExpanded} onClick={() => choice.kind === 'projects' ? setProjectsExpanded(!projectsExpanded) : setChatsExpanded(!chatsExpanded)}><ChevronDown /></button></div>
        {choice.kind === 'projects' && projectsExpanded && <div className="import-project-choices">{model.projectRoots.map((cwd) => <label key={cwd}><input type="checkbox" checked={projectSelected(cwd)} disabled={running || completed || !selection.projects || !model.projectItems.some((item) => item.cwd === cwd)} onChange={(event) => chooseProject(cwd, event.currentTarget.checked)} /><div><strong>{cwd.split('/').filter(Boolean).at(-1) || cwd}</strong><span>{cwd}</span></div></label>)}</div>}
        {choice.kind === 'chats' && chatsExpanded && <ul className="import-session-list">{model.sessionItems.flatMap((item) => item.details?.sessions ?? []).map((session) => <li key={session.path}><MessageSquare /><div><strong>{session.title || m('settings.import.history.details.untitledChat')}</strong><span>{session.workspaceKind === 'projectless' ? '项目外聊天' : session.cwd}</span></div></li>)}</ul>}
      </div>)}
      {operation && <div className="import-operation-status" role={operation.error || operation.result && importResultOutcome(operation.result) === 'failed' ? 'alert' : 'status'}>{running ? <LoaderCircle className="spin" /> : operation.result && importResultOutcome(operation.result) === 'success' ? <Check /> : <AlertCircle />}<div><strong>{operationTitle(operation)}</strong><span>{operation.error || (operation.result ? `${importResultCounts(operation.result).imported} 项已导入 · ${importResultCounts(operation.result).failed} 项未导入` : operation.progress.message || (running ? m('settings.agent.importSettings.progress.runningSubtitle') : ''))}</span></div></div>}
      {operation?.result?.itemTypeResults.some((group) => group.failures.length) && <ul className="import-failure-list">{operation.result.itemTypeResults.flatMap((group) => group.failures).map((failure, index) => <li key={index}><strong>{importCategoryLabel(failure.itemType)}</strong> {failure.message}</li>)}</ul>}
    </div>
    <footer className="import-modal-footer"><ImportButton onClick={onClose}>{running ? m('electron.onboarding.welcomeV2.externalAgentImport.continueInBackground') : '关闭'}</ImportButton><ImportButton primary disabled={running || !selected.length && !completed} onClick={() => completed ? onViewImported() : onImport(selected)}>{running ? <><LoaderCircle className="spin" />{m('electron.onboarding.welcomeV2.externalAgentImport.importingButton')}</> : completed ? m('externalAgentImport.review.viewImported') : retrying ? m('electron.onboarding.welcomeV2.externalAgentImport.retry') : m('externalAgentImport.review.import', { appName: 'ChatGPT' })}</ImportButton></footer>
  </ImportModal>
}

function ImportSyncDialog({ preferences, categories, saving, error, onSave, onClose }: { preferences: ExternalAgentImportPreferences; categories: ExternalAgentMigrationItemType[]; saving: boolean; error?: string; onSave(value: ExternalAgentImportPreferences['syncItemTypes']): Promise<boolean>; onClose(): void }): ReactNode {
  const [all, setAll] = useState(preferences.syncItemTypes === 'all')
  const [showAll, setShowAll] = useState(false)
  const [selection, setSelection] = useState<Partial<Record<ExternalAgentMigrationItemType, boolean | 'original'>>>(() => typeof preferences.syncItemTypes === 'object' && preferences.syncItemTypes ? { ...preferences.syncItemTypes } : Object.fromEntries(categories.map((category) => [category, true])))
  const choices = showAll ? IMPORT_CATEGORIES : IMPORT_CATEGORIES.filter((category) => categories.includes(category))
  const hasSelected = all || Object.values(selection).some(Boolean)
  return <ImportModal title={m('settings.import.autosync.customize')} busy={saving} onClose={onClose}><header className="import-modal-heading"><h2>{m('settings.import.autosync.customize')}</h2><p>{m('settings.import.autosync.customizeDescription')}</p></header><div className="import-modal-body"><ImportRow title={m('settings.import.autosync.allCategories')} description={m('settings.import.autosync.allCategoriesDescription')}><ImportToggle label={m('settings.import.autosync.allCategories')} checked={all} disabled={saving} onChange={setAll} /></ImportRow>{choices.map((category) => <ImportRow key={category} title={importCategoryLabel(category)} description={category === 'COMMANDS' ? m('settings.import.autosync.commandsDescription') : category === 'PLUGINS' ? m('settings.import.autosync.pluginsDescription') : category === 'CONFIG' ? m('settings.import.autosync.settingsDescription') : undefined}><ImportToggle label={`同步${importCategoryLabel(category)}`} checked={all || Boolean(selection[category])} disabled={all || saving} onChange={(checked) => setSelection((current) => ({ ...current, [category]: checked }))} /></ImportRow>)}{categories.length < IMPORT_CATEGORIES.length && <ImportRow title={m('settings.import.autosync.showAllCategories')} description={m('settings.import.autosync.showAllCategoriesDescription')}><ImportToggle label={m('settings.import.autosync.showAllCategories')} checked={showAll} disabled={saving} onChange={setShowAll} /></ImportRow>}<p className="import-review-subtitle">{m('settings.import.autosync.futureSyncs.v2', { appName: 'ChatGPT' })}</p>{!hasSelected && <p className="settings-page-error" role="alert">{m('settings.import.autosync.noCategories')}</p>}{error && <p className="settings-page-error" role="alert">{m('settings.import.autosync.saveError')} {error}</p>}</div><footer className="import-modal-footer"><ImportButton disabled={saving} onClick={onClose}>{m('settings.import.autosync.cancel')}</ImportButton><ImportButton primary disabled={saving || !hasSelected} onClick={() => { void onSave(all ? 'all' : selection).then((saved) => { if (saved) onClose() }) }}>{saving ? <LoaderCircle className="spin" /> : m('settings.import.autosync.save')}</ImportButton></footer></ImportModal>
}

function historyItemAction(category: ExternalAgentMigrationItemType): { section: ImportSettingsDestination; tab?: ImportIntegrationTab; label: string } | null {
  if (category === 'HOOKS') return { section: 'hooks', label: m('settings.import.history.details.openHooks') }
  if (category === 'MCP_SERVER_CONFIG') return { section: 'plugins', tab: 'mcp', label: m('settings.import.history.details.openMcpSettings') }
  if (category === 'PLUGINS') return { section: 'plugins', tab: 'plugins', label: m('settings.import.history.details.openPlugin') }
  if (['SKILLS', 'COMMANDS'].includes(category)) return { section: 'plugins', tab: 'skills', label: m('settings.import.history.details.openInSkills') }
  return null
}
function ImportHistoryEntry({ history, onNavigateSettings, onOpenThread }: { history: ExternalAgentImportHistory; onNavigateSettings?: ImportSettingsProps['onNavigateSettings']; onOpenThread?: ImportSettingsProps['onOpenThread'] }): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const categories = IMPORT_CATEGORIES.filter((category) => [...history.successes, ...history.failures].some((item) => item.itemType === category))
  const counts = importResultCounts(history)
  const openChat = async (target: string): Promise<void> => {
    if (!onOpenThread || busy) return
    setBusy(target); setError(null)
    try { const response = await window.codex.invoke<{ thread: Thread }>('thread/read', { threadId: target, includeTurns: false }); onOpenThread(response.thread) }
    catch (error) { setError(importError(error)) } finally { setBusy(null) }
  }
  return <details className="import-history-entry"><summary><span className="import-row-icon"><Download /></span><div><strong>{history.providerId && history.providerId in IMPORT_PROVIDER_LABELS ? m('settings.import.history.entryTitle.fromProvider', { provider: IMPORT_PROVIDER_LABELS[history.providerId as ExternalAgentProviderId] }) : m('settings.import.history.entryTitle')}</strong><span>{new Date(history.completedAtMs).toLocaleString()} · {counts.failed ? m('settings.import.history.summaryWithFailures', { importedCount: counts.imported, failedCount: counts.failed }) : m('settings.import.history.summary', { importedCount: counts.imported })}</span></div><ChevronRight /></summary><div className="import-history-details">{categories.map((category) => { const successes = history.successes.filter((item) => item.itemType === category); const failures = history.failures.filter((item) => item.itemType === category); const action = historyItemAction(category); return <details key={category}><summary><strong>{importCategoryLabel(category)}</strong><span>{failures.length ? m('settings.import.history.categorySummaryWithFailures', { importedCount: successes.length, failedCount: failures.length }) : m('settings.import.history.categorySummary', { importedCount: successes.length })}</span></summary><ul>{successes.map((success, index) => <li key={index}><Check /><div><strong>{success.title || success.target || m('settings.import.history.details.unknownItem')}</strong>{success.cwd && <span>{success.cwd}</span>}</div>{category === 'SESSIONS' && success.target && onOpenThread ? <ImportButton disabled={busy !== null} onClick={() => void openChat(success.target!)}>{busy === success.target ? <LoaderCircle className="spin" /> : m('settings.import.history.details.openChat')}</ImportButton> : action && onNavigateSettings ? <ImportButton onClick={() => onNavigateSettings(action.section, action.tab)}>{action.label}</ImportButton> : success.target?.startsWith('/') ? <ImportButton onClick={() => void window.codex.openWorkingDirectory(success.target!.slice(0, success.target!.lastIndexOf('/')) || '/', 'finder').catch((error) => setError(importError(error)))}>在 Finder 中显示</ImportButton> : null}</li>)}{failures.map((failure, index) => <li key={`failure:${index}`} className="import-history-failure"><AlertCircle /><div><strong>{failure.message}</strong><span>{failure.source || failure.cwd} · {failure.failureStage}</span></div></li>)}</ul></details> })}{!categories.length && <p>{m('settings.import.history.noResults')}</p>}{error && <p className="settings-page-error" role="alert">{error}</p>}</div></details>
}

function ImportNeedsAttention({ state, api, onNavigateSettings }: { state: ImportState; api: ExternalAgentImportApi; onNavigateSettings?: ImportSettingsProps['onNavigateSettings'] }): ReactNode {
  const [servers, setServers] = useState<McpServerSummary[] | null>(null)
  const [apps, setApps] = useState<ImportedAppLink[] | null>(null)
  const [appError, setAppError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<'apps' | 'mcp' | 'plugins' | 'hooks'>('apps')
  const successes = state.history?.data.flatMap((history) => history.successes) ?? []
  const hasMcp = successes.some((item) => item.itemType === 'MCP_SERVER_CONFIG')
  const hasHooks = successes.some((item) => item.itemType === 'HOOKS')
  const hasPlugins = successes.some((item) => item.itemType === 'PLUGINS')
  const connectors = state.connectors ?? state.history?.connectors ?? []
  const connectorsKey = JSON.stringify(connectors.map((connector) => [connector.name, connector.codexAppId]))
  const refreshApps = async (): Promise<void> => { setAppError(null); try { setApps(await loadImportedAppLinks(connectors, (method, params) => window.codex.invoke(method, params))) } catch (error) { setAppError(importError(error)) } }
  useEffect(() => { let active = true; if (!connectors.length) return; void loadImportedAppLinks(connectors, (method, params) => window.codex.invoke(method, params)).then((value) => { if (active) setApps(value) }).catch((error) => { if (active) setAppError(importError(error)) }); return () => { active = false } }, [connectorsKey])
  const refreshMcp = async (): Promise<void> => { setError(null); try { setServers(await listAllMcpServers()) } catch (error) { setError(importError(error)) } }
  useEffect(() => { let active = true; if (!hasMcp) return; void listAllMcpServers().then((value) => { if (active) setServers(value) }).catch((error) => { if (active) setError(importError(error)) }); return () => { active = false } }, [hasMcp])
  const importedServers = (servers ?? []).filter((server) => successes.some((item) => item.itemType === 'MCP_SERVER_CONFIG' && [item.title, item.target].includes(server.name)))
  const authenticate = async (server: McpServerSummary): Promise<void> => { setBusy(server.name); setError(null); try { await api.authenticateMcp(server.name) } catch (error) { setError(importError(error)) } finally { setBusy(null) } }
  const connect = async (app: ImportedAppLink): Promise<void> => { if (!app.connectionUrl) return; setBusy(app.id); setAppError(null); try { await window.codex.openExternal(app.connectionUrl) } catch (error) { setAppError(importError(error)) } finally { setBusy(null) } }
  const availableTabs = (['apps', 'mcp', 'plugins', 'hooks'] as const).filter((entry) => entry === 'apps' ? connectors.length : entry === 'mcp' ? hasMcp : entry === 'plugins' ? hasPlugins : hasHooks)
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0]
  if (!connectors.length && !hasMcp && !hasHooks && !hasPlugins) return null
  return <ImportGroup title={m('settings.import.attention.title')} subtitle={m('settings.import.attention.subtitle')}><div className="import-attention-tabs" role="tablist" aria-label="导入后设置">{availableTabs.map((entry) => <button type="button" key={entry} role="tab" aria-selected={activeTab === entry} onClick={() => setTab(entry)}>{entry === 'apps' ? '应用' : entry === 'mcp' ? 'MCP' : entry === 'plugins' ? '插件' : '钩子'}</button>)}</div>{activeTab === 'apps' ? <>{!apps && !appError ? <div className="settings-page-loading" role="status"><LoaderCircle className="spin" />正在检查导入的应用…</div> : apps?.length ? apps.map((app) => <ImportRow key={app.id} title={app.name} description={app.connected ? '已连接' : '完成此应用的连接以使用已导入的设置'} icon={<Sparkles />}><ImportButton disabled={app.connected || !app.connectionUrl || busy !== null} onClick={() => void connect(app)}>{busy === app.id ? <LoaderCircle className="spin" /> : app.connected ? '已连接' : '连接'}</ImportButton></ImportRow>) : connectors.map((connector, index) => <ImportRow key={`${connector.name}:${index}`} title={connector.name} description="未在可用应用中找到此连接" icon={<Sparkles />}><ImportButton onClick={() => onNavigateSettings?.('plugins')}>打开插件设置</ImportButton></ImportRow>)}<ImportRow title="检查应用连接"><ImportButton disabled={busy !== null} onClick={() => void refreshApps()}><RefreshCw />{m('settings.import.empty.checkAgain')}</ImportButton></ImportRow>{appError && <p className="settings-page-error" role="alert">{appError}</p>}</> : activeTab === 'hooks' ? <ImportRow title={m('settings.import.history.details.reviewHooks')} description={m('settings.import.history.manageHooks')}><ImportButton onClick={() => onNavigateSettings?.('hooks')}>{m('settings.import.history.details.openHooks')}</ImportButton></ImportRow> : activeTab === 'plugins' ? <ImportRow title="检查已导入的插件"><ImportButton onClick={() => onNavigateSettings?.('plugins', 'plugins')}>{m('settings.import.history.details.openPlugin')}</ImportButton></ImportRow> : <>{!servers && !error ? <div className="settings-page-loading" role="status"><LoaderCircle className="spin" />正在检查导入的 MCP 服务器…</div> : importedServers.filter((server) => server.authStatus === 'notLoggedIn' || server.runtimeStatus === 'authenticationRequired').map((server) => <ImportRow key={server.name} title={server.displayName} description="需要身份验证" icon={<PlugZap />}><ImportButton disabled={busy !== null} onClick={() => void authenticate(server)}>{busy === server.name ? <LoaderCircle className="spin" /> : '登录'}</ImportButton></ImportRow>)}<ImportRow title="MCP 服务器"><ImportButton onClick={() => onNavigateSettings?.('plugins', 'mcp')}>{m('settings.import.history.details.openMcpSettings')}</ImportButton><ImportButton disabled={busy !== null} onClick={() => void refreshMcp()}><RefreshCw />{m('settings.import.empty.checkAgain')}</ImportButton></ImportRow></>}{error && <p className="settings-page-error" role="alert">{m('settings.import.attention.mcps.error')} {error}</p>}</ImportGroup>
}

export function ImportSettingsView({ state, connected, api, onRefresh, onImport, onCancel, onSetSync, onNavigateSettings, onOpenThread }: { state: ImportState; connected: boolean; api: ExternalAgentImportApi; onRefresh(): void; onImport(items: ExternalAgentMigrationItem[]): void; onCancel(): void; onSetSync(enabled: boolean, categories?: ExternalAgentImportPreferences['syncItemTypes']): Promise<boolean>; onNavigateSettings?: ImportSettingsProps['onNavigateSettings']; onOpenThread?: ImportSettingsProps['onOpenThread'] }): ReactNode {
  const [review, setReview] = useState<{ items: ExternalAgentMigrationItem[]; providers: ExternalAgentProviderId[] } | null>(null)
  const [syncDialog, setSyncDialog] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [reviewAttempt, setReviewAttempt] = useState<string | null>(null)
  const running = isImportRunning(state.operation)
  const checking = state.loading.detection || state.loading.preferences || state.loading.status
  const detection = state.detection
  const providers = IMPORT_PROVIDERS.filter((provider) => detection?.items.some((item) => item.providerId === provider))
  const latest = state.history?.data.filter((history) => history.successes.length).reduce<number | null>((date, history) => Math.max(date ?? 0, history.completedAtMs), null)
  const histories = [...state.history?.data ?? []].sort((a, b) => b.completedAtMs - a.completedAtMs)
  const categories = IMPORT_CATEGORIES.filter((category) => histories.some((history) => history.successes.some((item) => item.itemType === category)))
  const selectedCategories = state.preferences?.syncItemTypes === 'all' ? IMPORT_CATEGORIES : Object.entries(state.preferences?.syncItemTypes ?? {}).filter(([, value]) => value).map(([key]) => key)
  const syncSummary = state.preferences?.syncItemTypes === 'all' ? m('settings.import.autosync.allCategoriesSummary') : !selectedCategories.length ? m('settings.import.autosync.noneSelected') : selectedCategories.length === 1 && selectedCategories[0] === 'SESSIONS' ? m('settings.import.autosync.chatsOnly') : selectedCategories.length > 3 ? m('settings.import.autosync.selectedCount', { count: selectedCategories.length }) : selectedCategories.map((category) => importCategoryLabel(category as ExternalAgentMigrationItemType)).join('、')
  const openReview = (provider: ExternalAgentProviderId): void => { setReviewAttempt(null); setReview({ items: detection!.items, providers: [provider] }) }
  useEffect(() => { if (review && reviewAttempt === 'starting' && state.operation) setReviewAttempt(state.operation.importAttemptId) }, [review, reviewAttempt, state.operation])
  const reviewOperation = state.operation && reviewAttempt === state.operation.importAttemptId ? state.operation : null
  return <><header className="settings-page-heading"><h2>导入</h2><p>{m('settings.import.subtitle.v2', { appName: 'ChatGPT' })}</p></header>
    <ImportGroup title={m('settings.import.autosync.title')}><ImportRow title={m('settings.import.autosync.label')} description={state.preferences?.syncEnabled ? m('settings.import.autosync.description') : m('settings.import.autosync.paused')}><ImportToggle label={m('settings.import.autosync.label')} checked={state.preferences?.syncEnabled ?? false} disabled={!connected || !state.preferences || state.savingSync} onChange={(checked) => { void onSetSync(checked) }} /></ImportRow><ImportRow title={m('settings.import.autosync.content')} description={state.preferences?.providers.length ? syncSummary : m('settings.import.autosync.afterImport')}><ImportButton disabled={!state.preferences?.providers.length || state.savingSync} onClick={() => setSyncDialog(true)}>{m('settings.import.autosync.customize')}</ImportButton></ImportRow>{state.errors.sync && <p role="alert" className="settings-page-error">{m('settings.import.autosync.toggleError')} {state.errors.sync}</p>}{state.preferences?.lastSyncError && <p role="alert" className="settings-page-error">{state.preferences.lastSyncError}</p>}</ImportGroup>
    <ImportGroup title={m('settings.agent.importSettings.sectionTitle.v2')} subtitle={providers.length ? m('settings.agent.importSettings.sectionDescription', { appName: 'ChatGPT' }) : undefined}>
      {!connected ? <ImportRow title="Codex Server 尚未连接" description="连接后检查兼容的设置、项目和最近聊天" /> : running ? <ImportRow title={m('settings.agent.importSettings.importingLabel')} description={state.operation?.progress.message || m('settings.agent.importSettings.progress.runningSubtitle')}><LoaderCircle className="spin" /><ImportButton onClick={() => { setReviewAttempt(state.operation!.importAttemptId); setReview({ items: state.operation!.items, providers: [...new Set(state.operation!.items.map((item) => item.providerId))] }) }}>查看进度</ImportButton><ImportButton disabled={state.operation?.progress.phase === 'stopping'} onClick={onCancel}>{state.operation?.progress.phase === 'stopping' ? '正在停止…' : '停止导入'}</ImportButton></ImportRow> : checking ? <ImportRow title={m('settings.agent.importSettings.loadingLabel.v2')} description={m('settings.agent.importSettings.detectingDescription.v2')}><LoaderCircle className="spin" /></ImportRow> : state.errors.detection ? <ImportRow title={m('settings.import.error.label')} description={<>{m('settings.import.error.description')}<span>{state.errors.detection}</span></>}><ImportButton onClick={onRefresh}>{m('settings.import.error.retry')}</ImportButton></ImportRow> : !providers.length ? <ImportRow title={latest ? m('settings.import.empty.noNewItems') : m('settings.import.empty.label')} description={latest ? m('settings.import.empty.lastImported', { relativeTime: relativeImportTime(latest) }) : m('settings.import.empty.description')}><ImportButton disabled={!latest} onClick={onRefresh}>{latest ? m('settings.import.empty.checkAgain') : m('settings.import.empty.button')}</ImportButton></ImportRow> : providers.map((provider) => <ImportRow key={provider} title={IMPORT_PROVIDER_LABELS[provider]} icon={<span className={`import-provider-icon ${provider}`}><ImportProviderIcon provider={provider} /></span>}><ImportButton onClick={() => openReview(provider)}>{m('settings.agent.importSettings.importProvider')}</ImportButton></ImportRow>)}
      {!checking && detection?.unsupportedProjects.length ? <ImportRow title={m('settings.import.unsupportedProjects.label', { count: detection.unsupportedProjects.length })} description={detection.unsupportedProjects.map((project) => `${project.name}：${project.reason}`).join('；')} icon={<AlertCircle />} /> : null}
      {!checking && detection?.providers.filter((provider) => provider.status !== 'available').map((provider) => <ImportRow key={provider.providerId} title={IMPORT_PROVIDER_LABELS[provider.providerId]} description={provider.message || (provider.status === 'error' ? '无法检查此应用' : '此应用的导入不可用')} icon={<AlertCircle />}>{provider.status === 'error' && <ImportButton onClick={onRefresh}>{m('settings.import.error.retry')}</ImportButton>}</ImportRow>)}
      {!checking && detection?.providers.filter((provider) => provider.warnings?.length).map((provider) => <ImportRow key={`${provider.providerId}:warnings`} title={`${IMPORT_PROVIDER_LABELS[provider.providerId]} · 需审核`} description={provider.warnings!.join('\n')} icon={<AlertCircle />} />)}
      {state.errors.preferences && <p className="settings-page-error" role="alert">无法读取同步偏好设置。{state.errors.preferences}<ImportButton onClick={onRefresh}>重试</ImportButton></p>}{state.errors.cancel && <p className="settings-page-error" role="alert">{state.errors.cancel}</p>}
    </ImportGroup>
    {state.operation && !running && <div className="import-operation-status" role={state.operation.error ? 'alert' : 'status'}><AlertCircle /><div><strong>{operationTitle(state.operation)}</strong><span>{state.operation.error || state.operation.result && `${importResultCounts(state.operation.result).imported} 项已导入 · ${importResultCounts(state.operation.result).failed} 项未导入`}</span></div></div>}
    {state.errors.connectors && <ImportRow title="无法读取已导入的应用连接" description={state.errors.connectors}><ImportButton onClick={onRefresh}>{m('settings.import.error.retry')}</ImportButton></ImportRow>}
    <ImportNeedsAttention state={state} api={api} onNavigateSettings={onNavigateSettings} />
    {(histories.length || state.loading.history || state.errors.history) && <ImportGroup title={m('settings.import.history.latestTitle')}>{state.loading.history && !histories.length ? <div className="settings-page-loading" role="status"><LoaderCircle className="spin" />{m('settings.import.history.loading')}</div> : (historyExpanded ? histories : histories.slice(0, 3)).map((history) => <ImportHistoryEntry key={history.importId} history={history} onNavigateSettings={onNavigateSettings} onOpenThread={onOpenThread} />)}{histories.length > 3 && !historyExpanded && <div className="import-history-more"><ImportButton onClick={() => setHistoryExpanded(true)}>{m('settings.import.history.viewMore')}</ImportButton></div>}{state.errors.history && <ImportRow title={m('settings.import.history.error')} description={state.errors.history}><ImportButton onClick={onRefresh}>{m('settings.import.history.retry')}</ImportButton></ImportRow>}</ImportGroup>}
    {review && <ImportReviewDialog key={review.providers.join(',')} items={review.items} providers={review.providers} operation={reviewOperation} onClose={() => setReview(null)} onViewImported={() => { setReview(null); setHistoryExpanded(true) }} onImport={(items) => { setReviewAttempt('starting'); onImport(items) }} />}
    {syncDialog && state.preferences && <ImportSyncDialog preferences={state.preferences} categories={categories} saving={state.savingSync} error={state.errors.sync} onClose={() => setSyncDialog(false)} onSave={(value) => onSetSync(state.preferences!.syncEnabled, value)} />}
  </>
}

export function ImportSettings({ backend, workspaceRoots = [], api: providedApi, onNavigateSettings, onOpenThread, onImportCompleted }: ImportSettingsProps): ReactNode {
  const api = providedApi ?? window.codex.externalAgentImport
  const rootsKey = workspaceRoots.join('\0')
  const completed = useRef(onImportCompleted); completed.current = onImportCompleted
  const controller = useMemo(() => new ImportController(api, rootsKey.split('\0').filter(Boolean), (result) => completed.current?.(result)), [api, rootsKey])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { controller.attach(); if (backend.state === 'ready') void controller.refresh(); return () => controller.dispose() }, [controller, backend.state])
  return <ImportSettingsView state={state} connected={backend.state === 'ready'} api={api} onRefresh={() => void controller.refresh()} onImport={(items) => void controller.start(items)} onCancel={() => void controller.cancel()} onSetSync={(enabled, categories) => controller.setSync(enabled, categories)} onNavigateSettings={onNavigateSettings} onOpenThread={onOpenThread} />
}

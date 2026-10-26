import { ArrowLeft, AtSign, ChevronDown, CircleAlert, Laptop, LoaderCircle, MoreHorizontal, Plus, RefreshCw, Search, Settings, Sparkles, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackendStatus } from '../../shared/api'
import type { MarketplaceCatalogItem } from './discoveryPages'
import { normalizeSkillsListResponse, sanitizeIntegrationDiagnostic, type SkillInventory } from './integrationModels'
import { skillOperationPaths } from './SettingsIntegrations'
import { filterMarketplaceItems, marketplaceAddParams, normalizeMarketplaceSnapshot, normalizePluginDetail, offlineMarketplaceItems, performMarketplaceOperation, pluginEnabledWriteParams, pluginInstallBlockedReason, pluginUninstallBlockedReason, type MarketplacePlugin, type MarketplaceSnapshot, type PluginDetailSnapshot } from './marketplaceModels'
import './DiscoveryPages.css'

type MarketplaceSection = 'plugins' | 'skills'
type MarketplaceTab = 'public' | 'personal'

function errorLabel(error: unknown): string {
  return sanitizeIntegrationDiagnostic(error instanceof Error ? error.message : String(error))
}

export function MarketplacePage({ backend, cwd, onOpenSettings }: { backend: BackendStatus; cwd: string | null; onOpenSettings(): void }): ReactNode {
  const [section, setSection] = useState<MarketplaceSection>('plugins')
  const [tab, setTab] = useState<MarketplaceTab>('public')
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<MarketplaceSnapshot | null>(null)
  const [skills, setSkills] = useState<SkillInventory | null>(null)
  const [skillPaths, setSkillPaths] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [hostMenuOpen, setHostMenuOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)
  const route = useRef({ cwd, backend: backend.state, active: true })
  route.current.cwd = cwd
  route.current.backend = backend.state

  const refresh = useCallback(async (forceRefetch: boolean): Promise<boolean> => {
    const current = ++sequence.current
    if (backend.state !== 'ready' || !cwd) {
      setError(backend.message || 'Codex Server 尚未连接。')
      setSnapshot(null)
      setSkills(null)
      setSkillPaths(new Map())
      setLoading(false)
      return false
    }
    setLoading(true)
    setError(null)
    setSkillError(null)
    const [pluginResult, skillResult] = await Promise.allSettled([
      window.codex.invoke<unknown>('plugin/list', { cwds: [cwd], forceRefetch }).then(normalizeMarketplaceSnapshot),
      window.codex.invoke<unknown>('skills/list', { cwds: [cwd], forceReload: forceRefetch }).then((raw) => ({ inventory: normalizeSkillsListResponse(raw), paths: skillOperationPaths(raw) }))
    ])
    if (sequence.current !== current) return false
    if (pluginResult.status === 'fulfilled') setSnapshot(pluginResult.value)
    else { setSnapshot(null); setError(errorLabel(pluginResult.reason)) }
    if (skillResult.status === 'fulfilled') { setSkills(skillResult.value.inventory); setSkillPaths(skillResult.value.paths) }
    else { setSkills(null); setSkillPaths(new Map()); setSkillError(errorLabel(skillResult.reason)) }
    setLoading(false)
    return pluginResult.status === 'fulfilled'
  }, [backend.message, backend.state, cwd])

  useEffect(() => { route.current.active = true; void refresh(false); return () => { route.current.active = false; sequence.current += 1 } }, [refresh])
  useEffect(() => {
    setSelectedId(null)
    setNotice(null)
    setAddDialogOpen(false)
  }, [cwd])

  const items = useMemo(() => snapshot?.items || offlineMarketplaceItems(), [snapshot])
  const selected = items.find((item) => item.id === selectedId) || null
  const installedItems = items.filter((item) => item.plugin?.installed)
  const groups = useMemo(() => {
    const grouped = new Map<string, MarketplacePlugin[]>()
    for (const item of filterMarketplaceItems(items, query, tab === 'personal')) {
      const group = grouped.get(item.category) || []
      group.push(item)
      grouped.set(item.category, group)
    }
    return [...grouped].map(([category, entries]) => ({ category, items: entries }))
  }, [items, query, tab])
  const visibleSkills = (skills?.skills || []).filter((skill) => !query.trim() || skill.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  const operatePlugin = async (item: MarketplacePlugin, operation: 'install' | 'uninstall' | 'enable'): Promise<PluginDetailSnapshot['apps']> => {
    if (busy || backend.state !== 'ready' || !item.plugin) return []
    setBusy(item.id)
    setError(null)
    setNotice(null)
    const currentCwd = cwd
    const operationSequence = sequence.current
    try {
      const authApps = await performMarketplaceOperation(item, operation, (method, params) => window.codex.invoke(method, params))
      if (sequence.current !== operationSequence || !route.current.active || route.current.cwd !== currentCwd || route.current.backend !== 'ready') return authApps
      const reloaded = await refresh(true)
      if (route.current.cwd === currentCwd) setNotice(reloaded ? operation === 'install' ? `${item.name} 已安装${authApps.length ? '，请连接所需应用' : ''}` : operation === 'uninstall' ? `${item.name} 已卸载` : `${item.name} 已${item.plugin.enabled ? '停用' : '启用'}` : '操作已完成，但无法刷新插件列表。请重试刷新。')
      return authApps
    } catch (failure) {
      if (route.current.active && route.current.cwd === currentCwd && sequence.current === operationSequence) setError(errorLabel(failure))
      throw failure
    } finally { setBusy(null) }
  }

  const toggleSkill = async (id: string, enabled: boolean): Promise<void> => {
    const path = skillPaths.get(id)
    if (!path || busy) return
    setBusy(id)
    setSkillError(null)
    try { await window.codex.invoke('skills/config/write', { path, enabled: !enabled }); await refresh(true) }
    catch (failure) { setSkillError(errorLabel(failure)) }
    finally { setBusy(null) }
  }

  return (
    <div className="marketplace-page">
      <aside className="marketplace-sidebar">
        <header className="marketplace-sidebar-header"><h1>自定义</h1><button type="button" aria-label="搜索自定义内容" title="搜索" onClick={() => { setSelectedId(null); requestAnimationFrame(() => searchRef.current?.focus()) }}><Search /></button></header>
        <nav className="marketplace-sidebar-nav" aria-label="自定义">
          <button type="button" className={section === 'plugins' && !selected ? 'active' : undefined} onClick={() => { setSection('plugins'); setSelectedId(null); setQuery('') }}><AtSign /><span>插件</span></button>
          <button type="button" className={section === 'skills' ? 'active' : undefined} onClick={() => { setSection('skills'); setSelectedId(null); setQuery('') }}><Sparkles /><span>技能</span></button>
          <h2>已安装</h2>
          {installedItems.length ? installedItems.map((item) => <button type="button" className={`marketplace-installed-item${selected?.id === item.id ? ' active' : ''}`} key={item.id} onClick={() => { setSection('plugins'); setSelectedId(item.id) }}><MarketplaceLogo item={item} small /><span>{item.name}</span></button>) : <span className="marketplace-sidebar-empty">暂无已安装插件</span>}
        </nav>
      </aside>
      <main className="marketplace-main"><div className="marketplace-scroll"><section className="marketplace-content">
        {selected ? <>
          <button type="button" className="marketplace-back" onClick={() => setSelectedId(null)}><ArrowLeft />插件</button>
          {error && <MarketplaceStatus error message={error} />}
          {notice && <MarketplaceStatus message={notice} />}
          <MarketplacePluginDetails item={selected} backendReady={backend.state === 'ready'} busy={busy !== null || loading} onOperation={(operation) => operatePlugin(selected, operation)} />
        </> : <>
          <header className="marketplace-header">
            <div className="marketplace-title-copy"><h1>{section === 'plugins' ? '插件' : '技能'}</h1><p>{section === 'plugins' ? '连接插件，让 Codex 在你的各类工具中协同工作' : '使用可复用的工作流扩展 Codex 的能力'}</p></div>
            <div className="marketplace-toolbar">
              <label className="discovery-search marketplace-search"><Search /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={section === 'plugins' ? '搜索插件' : '搜索技能'} aria-label={section === 'plugins' ? '搜索插件' : '搜索技能'} /></label>
              <div className="marketplace-menu-anchor"><button type="button" className="marketplace-host-button" aria-expanded={hostMenuOpen} onClick={() => setHostMenuOpen((open) => !open)}><Laptop /><span>本地</span><ChevronDown /></button>{hostMenuOpen && <div className="marketplace-toolbar-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHostMenuOpen(false) }}><button type="button" onClick={() => setHostMenuOpen(false)}><Laptop /> 本地</button></div>}</div>
              <button type="button" className="marketplace-icon-button" aria-label="刷新" title="刷新" disabled={loading || busy !== null} onClick={() => void refresh(true)}><RefreshCw className={loading ? 'spin' : undefined} /></button>
              <button type="button" className="marketplace-icon-button" aria-label="插件设置" title="设置" onClick={onOpenSettings}><Settings /></button>
              <button type="button" className="discovery-primary-button marketplace-add-button" disabled={backend.state !== 'ready' || busy !== null} onClick={() => setAddDialogOpen(true)}><span>添加</span><ChevronDown /></button>
            </div>
          </header>
          {section === 'plugins' ? <>
            <div className="marketplace-tabs" role="tablist" aria-label="插件来源">{(['public', 'personal'] as const).map((value) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : undefined} key={value} onClick={() => setTab(value)}>{value === 'public' ? '公开' : '个人'}</button>)}</div>
            {error && <MarketplaceStatus error message={error} />}
            {notice && <MarketplaceStatus message={notice} />}
            {snapshot?.inventory.loadErrorCount ? <MarketplaceStatus error message={`${snapshot.inventory.loadErrorCount} 个插件市场无法加载。刷新以重试。`} /> : null}
            {loading && !snapshot ? <MarketplaceStatus loading message="正在加载插件…" /> : null}
            {groups.length ? <div className="marketplace-groups">{groups.map((group) => <section className="marketplace-group" key={group.category}><h2>{group.category}</h2><div className="marketplace-grid">{group.items.map((item) => <MarketplaceRow key={item.id} item={item} busy={busy !== null || loading} onOpen={() => setSelectedId(item.id)} onInstall={() => { setSelectedId(item.id); void operatePlugin(item, 'install').catch(() => undefined) }} />)}</div></section>)}</div> : !loading && <div className="marketplace-empty">{tab === 'personal' && !query ? '暂无已安装插件' : '没有匹配的插件'}</div>}
          </> : <>
            {skillError && <MarketplaceStatus error message={skillError} />}
            {skills?.errors.map((failure, index) => <MarketplaceStatus error key={index} message={failure.message} />)}
            <div className="marketplace-skills">{visibleSkills.length ? visibleSkills.map((skill) => <article key={skill.id}><span className="marketplace-skill-icon"><Sparkles /></span><div><strong>{skill.name}</strong><small>{skill.scope === 'repo' ? '项目' : skill.scope === 'user' ? '个人' : skill.scope === 'system' ? '系统' : '管理员'}</small></div><button type="button" role="switch" className={`settings-page-toggle${skill.enabled ? ' checked' : ''}`} aria-label={`${skill.name} 技能`} aria-checked={skill.enabled} disabled={!skillPaths.has(skill.id) || busy !== null || loading} onClick={() => void toggleSkill(skill.id, skill.enabled)}><span /></button></article>) : <div className="marketplace-empty">{loading ? '正在加载技能…' : '没有匹配的技能'}</div>}</div>
          </>}
        </>}
      </section></div></main>
      {addDialogOpen && <AddMarketplaceDialog onClose={() => setAddDialogOpen(false)} onAdded={async (params) => {
        const response = await window.codex.invoke<{ alreadyAdded: boolean; marketplaceName: string }>('marketplace/add', params)
        const reloaded = await refresh(true)
        setNotice(reloaded ? `${response.marketplaceName || '插件市场'} ${response.alreadyAdded ? '已存在' : '已添加'}` : '插件市场已添加，但无法刷新插件列表。请重试刷新。')
      }} />}
    </div>
  )
}

function MarketplaceStatus({ message, error = false, loading = false }: { message: string; error?: boolean; loading?: boolean }): ReactNode {
  return <div className={`marketplace-status${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <CircleAlert /> : loading ? <LoaderCircle className="spin" /> : <AtSign />}<span>{message}</span></div>
}

function MarketplaceRow({ item, busy, onOpen, onInstall }: { item: MarketplacePlugin; busy: boolean; onOpen(): void; onInstall(): void }): ReactNode {
  const installed = item.plugin?.installed === true
  const blocked = pluginInstallBlockedReason(item)
  return <article className="marketplace-row"><MarketplaceLogo item={item} /><button type="button" className="marketplace-row-copy" onClick={onOpen}><strong><span>{item.name}</span><i aria-hidden="true" /></strong><p>{item.description}</p></button><button type="button" aria-label={installed ? `管理 ${item.name}` : `添加 ${item.name}`} title={installed ? '管理' : blocked || '添加'} disabled={busy || (!installed && Boolean(blocked))} onClick={installed ? onOpen : onInstall}>{installed ? <MoreHorizontal /> : <Plus />}</button></article>
}

export function MarketplacePluginDetails({ item, backendReady, busy, onOperation }: { item: MarketplacePlugin; backendReady: boolean; busy: boolean; onOperation(operation: 'install' | 'uninstall' | 'enable'): Promise<PluginDetailSnapshot['apps']> }): ReactNode {
  const [detail, setDetail] = useState<PluginDetailSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authApps, setAuthApps] = useState<PluginDetailSnapshot['apps']>([])
  const [tab, setTab] = useState<'overview' | 'apps' | 'skills' | 'mcp' | 'hooks'>('overview')
  const selectorSource = item.selector ? 'marketplacePath' in item.selector ? item.selector.marketplacePath : item.selector.remoteMarketplaceName : null
  useEffect(() => { setAuthApps([]); setTab('overview') }, [item.id])
  useEffect(() => {
    let active = true
    setDetail(null); setError(null); setLoading(false)
    if (!item.selector || !backendReady) return
    setLoading(true)
    void window.codex.invoke('plugin/read', item.selector).then(normalizePluginDetail).then((value) => { if (active) setDetail(value) }).catch((failure) => { if (active) setError(errorLabel(failure)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [item.id, item.selector?.pluginName, selectorSource, item.plugin?.installed, item.plugin?.enabled, backendReady])
  const operate = async (operation: 'install' | 'uninstall' | 'enable'): Promise<void> => {
    setError(null)
    try { const apps = await onOperation(operation); setAuthApps(apps); if (apps.length) setTab('apps') }
    catch { /* The owning page displays the mutation error beside the detail header. */ }
  }
  const blocked = pluginInstallBlockedReason(item)
  const uninstallBlocked = pluginUninstallBlockedReason(item)
  const website = detail?.websiteUrl || item.websiteUrl
  const apps = authApps.length ? authApps : detail?.apps || []
  let toggleBlocked = false
  try { if (item.plugin) pluginEnabledWriteParams(item.plugin.id, true) } catch { toggleBlocked = true }
  return <div className="marketplace-detail">
    <header className="marketplace-detail-header"><MarketplaceLogo item={item} /><div><h1>{item.name}</h1><p>{item.plugin?.developer || item.marketplaceName || item.category}</p></div><div className="marketplace-detail-actions">{item.plugin?.installed ? <><button type="button" className="settings-page-pill" disabled={busy || !backendReady || toggleBlocked || item.plugin.availability === 'DISABLED_BY_ADMIN'} onClick={() => void operate('enable')}>{item.plugin.enabled ? '停用' : '启用'}</button><button type="button" className="settings-page-pill" disabled={busy || !backendReady || Boolean(uninstallBlocked)} title={uninstallBlocked || undefined} onClick={() => void operate('uninstall')}>卸载</button></> : <button type="button" className="discovery-primary-button" disabled={busy || !backendReady || Boolean(blocked)} title={blocked || undefined} onClick={() => void operate('install')}>{busy ? <LoaderCircle className="spin" /> : <Plus />}{busy ? '正在安装…' : '安装'}</button>}</div></header>
    {error && <MarketplaceStatus error message={error} />}
    {!item.plugin?.installed && blocked && <MarketplaceStatus message={blocked} />}
    <div className="marketplace-detail-tabs" role="tablist" aria-label="插件详情">{([['overview', '概览'], ['apps', `应用${apps.length ? ` ${apps.length}` : ''}`], ['skills', `技能${detail?.skills.length ? ` ${detail.skills.length}` : ''}`], ['mcp', 'MCP'], ['hooks', '钩子']] as const).map(([value, label]) => <button type="button" key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : undefined} onClick={() => setTab(value)}>{label}</button>)}</div>
    {loading ? <MarketplaceStatus loading message="正在加载插件详情…" /> : <section className="marketplace-detail-body" role="tabpanel">
      {tab === 'overview' ? <><p className="marketplace-detail-description">{detail?.description || item.description || '此插件没有描述。'}</p><dl><dt>来源</dt><dd>{item.marketplaceName || '当前机器不可用'}</dd>{item.plugin?.version && <><dt>版本</dt><dd>{item.plugin.localVersion || item.plugin.version}</dd></>}{item.plugin?.installed && <><dt>状态</dt><dd>{item.plugin.enabled ? '已启用' : '已停用'}</dd></>}</dl><div className="marketplace-detail-links">{[[website, '网站'], [detail?.privacyPolicyUrl, '隐私政策'], [detail?.termsOfServiceUrl, '服务条款']].map(([url, label]) => url && <button key={label} type="button" onClick={() => void window.codex.openExternal(url).catch((failure) => setError(errorLabel(failure)))}>{label} ↗</button>)}</div></> : tab === 'apps' ? <>{authApps.length > 0 && <p>连接以下应用以完成插件设置。</p>}{apps.length ? apps.map((app) => <article className="marketplace-detail-entry" key={app.id}><AtSign /><div><strong>{app.name}</strong><p>{app.description}</p></div>{app.installUrl && <button type="button" className="settings-page-pill" onClick={() => void window.codex.openExternal(app.installUrl!).catch((failure) => setError(errorLabel(failure)))}>连接 ↗</button>}</article>) : <div className="marketplace-empty">此插件不包含应用</div>}</> : tab === 'skills' ? detail?.skills.length ? detail.skills.map((skill) => <article className="marketplace-detail-entry" key={skill.name}><Sparkles /><div><strong>{skill.name}</strong><p>{skill.description}</p></div><small>{skill.enabled ? '已启用' : '已停用'}</small></article>) : <div className="marketplace-empty">此插件不包含技能</div> : tab === 'mcp' ? detail?.mcpServers.length ? detail.mcpServers.map((name) => <article className="marketplace-detail-entry" key={name}><AtSign /><strong>{name}</strong></article>) : <div className="marketplace-empty">此插件不包含 MCP 服务器</div> : detail?.hooks.length ? detail.hooks.map((hook) => <article className="marketplace-detail-entry" key={hook.key}><AtSign /><div><strong>{hook.eventName}</strong><p>{hook.key}</p></div></article>) : <div className="marketplace-empty">此插件不包含钩子</div>}
    </section>}
  </div>
}

function AddMarketplaceDialog({ onClose, onAdded }: { onClose(): void; onAdded(params: ReturnType<typeof marketplaceAddParams>): Promise<void> }): ReactNode {
  const [source, setSource] = useState('')
  const [refName, setRefName] = useState('')
  const [sparsePaths, setSparsePaths] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy && !picking) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const controls = [...dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') || []]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [busy, picking, onClose])
  const submit = async (): Promise<void> => {
    setError(null)
    let params: ReturnType<typeof marketplaceAddParams>
    try { params = marketplaceAddParams(source, refName, sparsePaths) } catch (failure) { setError(errorLabel(failure)); return }
    setBusy(true)
    try { await onAdded(params); onClose() } catch (failure) { setError(errorLabel(failure)); setBusy(false) }
  }
  return <div className="marketplace-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !picking) onClose() }}><div ref={dialogRef} className="marketplace-modal" role="dialog" aria-modal="true" aria-labelledby="marketplace-add-title"><header><div><h2 id="marketplace-add-title">添加插件市场</h2><p>从 GitHub 仓库、Git URL 或本地文件夹添加。</p></div><button type="button" disabled={busy || picking} aria-label="关闭" onClick={onClose}><X /></button></header><form onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <label htmlFor="marketplace-source">来源<div className="marketplace-source-field"><input id="marketplace-source" aria-invalid={Boolean(error)} disabled={busy || picking} value={source} onChange={(event) => setSource(event.currentTarget.value)} placeholder="openai/plugins 或 git@github.com:org/repo.git" /><button type="button" disabled={busy || picking} className="settings-page-pill" onClick={async () => { setPicking(true); try { const directory = await window.codex.pickDirectory(); if (directory) setSource(directory.cwd) } catch (failure) { setError(errorLabel(failure)) } finally { setPicking(false) } }}>选择文件夹</button></div></label>
    <label htmlFor="marketplace-ref">Git 引用<span>可选</span><input id="marketplace-ref" disabled={busy} value={refName} onChange={(event) => setRefName(event.currentTarget.value)} placeholder="分支、标签或提交" /></label>
    <label htmlFor="marketplace-sparse">稀疏路径<span>可选</span><textarea id="marketplace-sparse" disabled={busy} rows={3} value={sparsePaths} onChange={(event) => setSparsePaths(event.currentTarget.value)} placeholder="每行一个路径，或用逗号分隔" /></label>
    {error && <MarketplaceStatus error message={error} />}
    <footer><button type="button" className="settings-page-pill" disabled={busy || picking} onClick={onClose}>取消</button><button type="submit" className="discovery-primary-button" disabled={busy || picking}>{busy && <LoaderCircle className="spin" />}{busy ? '正在添加…' : '添加'}</button></footer>
  </form></div></div>
}

function MarketplaceLogo({ item, small = false }: { item: Pick<MarketplaceCatalogItem, 'icon' | 'name'>; small?: boolean }): ReactNode {
  const initial = item.name.slice(0, 1).toUpperCase()
  return <span className={`marketplace-logo is-${item.icon}${small ? ' is-small' : ''}`} aria-hidden="true">{item.icon === 'slack' ? <span className="marketplace-logo-slack"><i /><i /><i /><i /></span> : item.icon === 'figma' ? <span className="marketplace-logo-figma"><i /><i /><i /><i /><i /></span> : item.icon === 'hyperframes' ? <span className="marketplace-logo-hyper"><i /><i /></span> : item.icon === 'terminal' ? <span className="marketplace-logo-terminal">›_</span> : item.icon === 'latex' ? <span className="marketplace-logo-latex">LᴬTᴇX</span> : item.icon === 'zotero' ? <span className="marketplace-logo-zotero">Z</span> : item.icon === 'flask' ? <span className="marketplace-logo-flask">♟</span> : <span className="marketplace-logo-initial">{initial}</span>}</span>
}

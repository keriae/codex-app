import { AtSign, ChevronRight, LoaderCircle, PlugZap, RefreshCw, Search, Sparkles } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackendStatus } from '../../shared/api'
import { listAllMcpServers } from './IntegrationsSettings'
import { settleIntegrationRead } from './integrationRefresh'
import { normalizeMarketplaceSnapshot, normalizePluginDetail, performMarketplaceOperation, pluginEnabledWriteParams, pluginUninstallBlockedReason, type MarketplacePlugin, type PluginDetailSnapshot } from './marketplaceModels'
import {
  normalizeSkillsListResponse,
  sanitizeIntegrationDiagnostic,
  type McpServerSummary,
  type PluginInventory,
  type SkillInventory,
  type SkillSummary
} from './integrationModels'

type IntegrationTab = 'plugins' | 'mcp' | 'skills'
const idleLoading: Record<IntegrationTab, boolean> = { plugins: false, mcp: false, skills: false }

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Retain operation selectors separately from the diagnostic-only inventory. */
export function skillOperationPaths(value: unknown): Map<string, string> {
  const paths = new Map<string, string>()
  if (!record(value) || !Array.isArray(value.data)) return paths
  const duplicates = new Map<string, number>()
  for (const group of value.data) {
    if (!record(group) || !Array.isArray(group.skills)) continue
    for (const skill of group.skills) {
      if (!record(skill) || typeof skill.enabled !== 'boolean' || !['user', 'repo', 'system', 'admin'].includes(String(skill.scope)) || typeof skill.name !== 'string' || !skill.name.trim()) continue
      const name = skill.name.trim()
      const key = `${skill.scope}\u0000${name}`
      const index = duplicates.get(key) || 0
      duplicates.set(key, index + 1)
      if (typeof skill.path === 'string' && skill.path.startsWith('/') && !skill.path.includes('\0')) paths.set(`${skill.scope}:${name}:${index}`, skill.path)
    }
  }
  return paths
}

function errorText(error: unknown): string {
  return sanitizeIntegrationDiagnostic(error instanceof Error ? error.message : String(error))
}

export function SettingsIntegrations({ backend, cwd, initialTab = 'plugins' }: { backend: BackendStatus; cwd: string | null; initialTab?: IntegrationTab }): ReactNode {
  const [tab, setTab] = useState<IntegrationTab>(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<PluginInventory | null>(null)
  const [pluginItems, setPluginItems] = useState<MarketplacePlugin[]>([])
  const [pluginDetails, setPluginDetails] = useState<PluginDetailSnapshot | null>(null)
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [skills, setSkills] = useState<SkillInventory | null>(null)
  const [mcp, setMcp] = useState<McpServerSummary[] | null>(null)
  const [paths, setPaths] = useState<Map<string, string>>(new Map())
  const [errors, setErrors] = useState<Partial<Record<IntegrationTab, string>>>({})
  const [loading, setLoading] = useState(idleLoading)
  const [busySkill, setBusySkill] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const sequence = useRef(0)

  const refresh = useCallback(async (force = false, waitFor?: IntegrationTab): Promise<void> => {
    const current = ++sequence.current
    if (backend.state !== 'ready' || !cwd) {
      setPlugins(null); setPluginItems([]); setSkills(null); setPaths(new Map()); setMcp(null); setLoading(idleLoading)
      setErrors({ plugins: 'Codex Server 尚未连接。', skills: 'Codex Server 尚未连接。', mcp: 'Codex Server 尚未连接。' })
      return
    }
    setLoading({ plugins: true, mcp: true, skills: true })
    setErrors({})
    const callbacks = (section: IntegrationTab) => ({
      isCurrent: () => sequence.current === current,
      onError: (error: unknown) => setErrors((value) => ({ ...value, [section]: errorText(error) })),
      onFinished: () => setLoading((value) => ({ ...value, [section]: false }))
    })
    const reads = {
      plugins: settleIntegrationRead(
        () => window.codex.invoke<unknown>('plugin/list', { cwds: [cwd], forceRefetch: force }).then(normalizeMarketplaceSnapshot),
        {
          ...callbacks('plugins'),
          onValue: (value) => { setPlugins(value.inventory); setPluginItems(value.items) },
          onError: (error) => { setPlugins(null); setPluginItems([]); callbacks('plugins').onError(error) }
        }
      ),
      skills: settleIntegrationRead(
        () => window.codex.invoke<unknown>('skills/list', { cwds: [cwd], forceReload: force }).then((raw) => ({ inventory: normalizeSkillsListResponse(raw), paths: skillOperationPaths(raw) })),
        {
          ...callbacks('skills'),
          onValue: (value) => { setSkills(value.inventory); setPaths(value.paths) },
          onError: (error) => { setSkills(null); setPaths(new Map()); callbacks('skills').onError(error) }
        }
      ),
      mcp: settleIntegrationRead(listAllMcpServers, {
        ...callbacks('mcp'),
        onValue: setMcp,
        onError: (error) => { setMcp(null); callbacks('mcp').onError(error) }
      })
    }
    if (waitFor) await reads[waitFor]
    else await Promise.all(Object.values(reads))
  }, [backend.state, cwd])

  useEffect(() => {
    void refresh()
    return () => { sequence.current += 1 }
  }, [refresh])

  const toggleSkill = async (skill: SkillSummary): Promise<void> => {
    const path = paths.get(skill.id)
    if (!path || busySkill || busyPlugin || loading.skills) return
    const current = sequence.current
    setBusySkill(skill.id)
    setErrors((current) => ({ ...current, skills: undefined }))
    try {
      await window.codex.invoke('skills/config/write', { path, enabled: !skill.enabled })
      if (current === sequence.current) await refresh(true, 'skills')
    } catch (error) {
      if (current === sequence.current) setErrors((value) => ({ ...value, skills: errorText(error) }))
    } finally {
      setBusySkill(null)
    }
  }

  useEffect(() => {
    let active = true
    setPluginDetails(null); setDetailLoading(false)
    const item = pluginItems.find((entry) => entry.id === expanded)
    if (tab !== 'plugins' || !item?.selector || backend.state !== 'ready') return
    setDetailLoading(true)
    void window.codex.invoke('plugin/read', item.selector).then(normalizePluginDetail).then((value) => { if (active) setPluginDetails(value) }).catch((error) => { if (active) setErrors((current) => ({ ...current, plugins: errorText(error) })) }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [expanded, tab, pluginItems, backend.state])

  const mutatePlugin = async (item: MarketplacePlugin, operation: 'enabled' | 'uninstall'): Promise<void> => {
    if (busyPlugin || busySkill || loading.plugins || !item.plugin) return
    const current = sequence.current
    setBusyPlugin(item.id)
    setErrors((value) => ({ ...value, plugins: undefined }))
    try {
      await performMarketplaceOperation(item, operation === 'enabled' ? 'enable' : 'uninstall', (method, params) => window.codex.invoke(method, params))
      if (current === sequence.current) await refresh(true, 'plugins')
    } catch (error) {
      if (current === sequence.current) setErrors((value) => ({ ...value, plugins: errorText(error) }))
    } finally { setBusyPlugin(null) }
  }

  const toggleMcp = async (server: McpServerSummary): Promise<void> => {
    if (busyPlugin || busySkill || loading.mcp || !/^[a-zA-Z0-9_-]+$/.test(server.name)) return
    const current = sequence.current
    setBusyPlugin(server.name)
    setErrors((value) => ({ ...value, mcp: undefined }))
    try {
      await window.codex.invoke('config/value/write', { keyPath: `mcp_servers.${server.name}.enabled`, value: server.runtimeStatus === 'disabled', mergeStrategy: 'upsert' })
      await window.codex.invoke('config/mcpServer/reload')
      if (current === sequence.current) await refresh(true, 'mcp')
    } catch (error) {
      if (current === sequence.current) setErrors((value) => ({ ...value, mcp: errorText(error) }))
    } finally { setBusyPlugin(null) }
  }

  const reloadMcp = async (): Promise<void> => {
    if (busyPlugin || busySkill || loading.mcp) return
    const current = sequence.current
    setBusyPlugin('__mcp_reload__')
    setErrors((value) => ({ ...value, mcp: undefined }))
    try {
      await window.codex.invoke('config/mcpServer/reload')
      if (current === sequence.current) await refresh(true, 'mcp')
    } catch (error) {
      if (current === sequence.current) setErrors((value) => ({ ...value, mcp: errorText(error) }))
    } finally { setBusyPlugin(null) }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const installedPlugins = useMemo(() => (plugins?.plugins || []).filter((plugin) => plugin.installed && (!normalizedQuery || `${plugin.name} ${plugin.category || ''} ${plugin.developer || ''}`.toLocaleLowerCase().includes(normalizedQuery))), [plugins, normalizedQuery])
  const visibleSkills = useMemo(() => (skills?.skills || []).filter((skill) => !normalizedQuery || skill.name.toLocaleLowerCase().includes(normalizedQuery)), [skills, normalizedQuery])
  const visibleMcp = useMemo(() => (mcp || []).filter((server) => !normalizedQuery || `${server.name} ${server.displayName}`.toLocaleLowerCase().includes(normalizedQuery)), [mcp, normalizedQuery])
  const count = tab === 'plugins' ? installedPlugins.length : tab === 'skills' ? visibleSkills.length : visibleMcp.length
  const label = tab === 'plugins' ? '插件' : tab === 'skills' ? '技能' : 'MCP'
  const anyLoading = Object.values(loading).some(Boolean)

  return (
    <>
      <section className="settings-page-heading-row"><header className="settings-page-heading"><h2>插件</h2><p>管理插件、技能和 MCP</p></header><button type="button" className="settings-page-icon-button" aria-label="刷新插件、技能和 MCP" title="刷新" disabled={anyLoading || busySkill !== null || busyPlugin !== null || backend.state !== 'ready' || !cwd} onClick={() => void refresh(true)}><RefreshCw className={anyLoading ? 'spin' : undefined} /></button></section>
      <div className="settings-page-tabs" role="tablist" aria-label="集成类型">
        {(['plugins', 'mcp', 'skills'] as const).map((section) => <button key={section} id={`settings-${section}-tab`} type="button" role="tab" aria-selected={tab === section} aria-controls="settings-integration-list" className={tab === section ? 'active' : undefined} onClick={() => { setTab(section); setQuery(''); setExpanded(null) }}>{section === 'plugins' ? `插件${plugins ? ` ${plugins.plugins.filter((plugin) => plugin.installed).length}` : ''}` : section === 'skills' ? `技能${skills ? ` ${skills.skills.length}` : ''}` : `MCP${mcp ? ` ${mcp.length}` : ''}`}</button>)}
        <label><Search /><input aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      </div>
      {errors[tab] && <div className="settings-page-error" role="alert">{errors[tab]}</div>}
      <section id="settings-integration-list" className="settings-page-group" role="tabpanel" aria-labelledby={`settings-${tab}-tab`} aria-busy={loading[tab]}><div className="settings-page-card">
        {loading[tab] && !count ? <div className="settings-page-loading" role="status"><LoaderCircle className="spin" />正在载入{label}…</div> : count ? (
          tab === 'plugins' ? installedPlugins.map((plugin) => (
            <div key={plugin.id}>
              <div className="settings-page-plugin-row"><span className="settings-page-plugin-icon"><AtSign /></span><div><strong>{plugin.name}</strong><span>{plugin.developer || plugin.category || plugin.source}{plugin.localVersion || plugin.version ? ` · ${plugin.localVersion || plugin.version}` : ''}</span></div><span className="settings-page-status">{plugin.enabled ? '已启用' : '已停用'}</span><button type="button" className="settings-page-icon-button" aria-expanded={expanded === plugin.id} aria-label={`查看 ${plugin.name}`} onClick={() => setExpanded((current) => current === plugin.id ? null : plugin.id)}><ChevronRight /></button></div>
              {expanded === plugin.id && (() => {
                const item = pluginItems.find((entry) => entry.id === plugin.id)
                if (!item) return null
                let enableBlocked = false
                try { pluginEnabledWriteParams(plugin.id, true) } catch { enableBlocked = true }
                const uninstallBlocked = pluginUninstallBlockedReason(item)
                return <div className="settings-page-plugin-detail">
                  {detailLoading ? <div className="settings-page-loading"><LoaderCircle className="spin" />正在加载插件详情…</div> : <>
                    {pluginDetails?.description && <p>{pluginDetails.description}</p>}
                    <div className="settings-page-plugin-detail-meta"><span>{pluginDetails?.skills.length || 0} 个技能</span><span>{pluginDetails?.apps.length || 0} 个应用</span><span>{pluginDetails?.mcpServers.length || 0} 个 MCP 服务器</span><span>{pluginDetails?.hooks.length || 0} 个钩子</span></div>
                  </>}
                  <div className="settings-page-plugin-detail-actions"><button type="button" className="settings-page-pill" disabled={loading.plugins || busySkill !== null || busyPlugin !== null || enableBlocked || plugin.availability === 'DISABLED_BY_ADMIN'} onClick={() => void mutatePlugin(item, 'enabled')}>{busyPlugin === item.id ? '正在更新…' : plugin.enabled ? '停用' : '启用'}</button><button type="button" className="settings-page-pill" disabled={loading.plugins || busySkill !== null || busyPlugin !== null || Boolean(uninstallBlocked)} title={uninstallBlocked || undefined} onClick={() => void mutatePlugin(item, 'uninstall')}>卸载</button></div>
                  {uninstallBlocked && <p className="settings-page-detail-muted">{uninstallBlocked}</p>}
                </div>
              })()}
            </div>
          )) : tab === 'skills' ? visibleSkills.map((skill) => (
            <div key={skill.id} className="settings-page-plugin-row"><span className="settings-page-plugin-icon"><Sparkles /></span><div><strong>{skill.name}</strong><span>{skill.scope === 'repo' ? '项目' : skill.scope === 'user' ? '个人' : skill.scope === 'system' ? '系统' : '管理员'}{skill.dependencies.length ? ` · ${skill.dependencies.length} 个依赖项` : ''}</span></div><button type="button" role="switch" className={`settings-page-toggle${skill.enabled ? ' checked' : ''}`} aria-label={`${skill.name} 技能`} aria-checked={skill.enabled} disabled={!paths.has(skill.id) || busySkill !== null || busyPlugin !== null || loading.skills} onClick={() => void toggleSkill(skill)}><span /></button></div>
          )) : visibleMcp.map((server) => (
            <div key={server.name}>
              <div className="settings-page-plugin-row"><span className="settings-page-plugin-icon"><PlugZap /></span><div><strong>{server.displayName}</strong><span>{server.toolNames.length} 个工具 · {server.resourceNames.length} 个资源</span></div><span className="settings-page-status">{server.runtimeStatus === 'connected' ? '已连接' : server.runtimeStatus === 'failed' ? '连接失败' : server.runtimeStatus === 'authenticationRequired' ? '需要登录' : server.runtimeStatus === 'disabled' ? '已停用' : server.runtimeStatus === 'starting' ? '正在连接' : '未连接'}</span><button type="button" className="settings-page-icon-button" aria-label={`查看 ${server.displayName}`} aria-expanded={expanded === server.name} onClick={() => setExpanded((current) => current === server.name ? null : server.name)}><ChevronRight /></button></div>
              {expanded === server.name && <div className="settings-page-row"><div className="settings-page-row-copy"><strong>{server.name}</strong><span>{server.toolsError || server.toolNames.join(' · ') || '没有可用工具'}</span></div><button type="button" className="settings-page-pill" disabled={loading.mcp || busySkill !== null || busyPlugin !== null || !/^[a-zA-Z0-9_-]+$/.test(server.name)} onClick={() => void toggleMcp(server)}>{server.runtimeStatus === 'disabled' ? '启用' : '停用'}</button><button type="button" className="settings-page-pill" disabled={loading.mcp || busySkill !== null || busyPlugin !== null} onClick={() => void reloadMcp()}>重新加载</button></div>}
            </div>
          ))
        ) : <div className="settings-page-empty">{tab === 'skills' ? <Sparkles /> : tab === 'mcp' ? <PlugZap /> : <AtSign />}<strong>{backend.state !== 'ready' ? 'Codex Server 尚未连接' : query ? '没有匹配项' : `没有已安装的${label}`}</strong></div>}
      </div></section>
    </>
  )
}

import {
  AppWindow,
  Blocks,
  CircleAlert,
  LoaderCircle,
  Package,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Sparkles
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { BackendStatus } from '../../shared/api'
import {
  APP_CATALOG_PAGE_LIMIT,
  collectAppCatalog,
  mergeAppsWithInstalledState,
  mergeMcpServerPages,
  normalizeAppsInstalledResponse,
  normalizeMcpServerStatusResponse,
  normalizePluginListResponse,
  normalizeSkillsListResponse,
  sanitizeIntegrationDiagnostic,
  type AppSummary,
  type McpAuthStatus,
  type McpRuntimeStatus,
  type McpServerSummary,
  type PluginInventory,
  type PluginSummary,
  type PluginSourceKind,
  type SkillInventory,
  type SkillScope
} from './integrationModels'

interface IntegrationsSettingsProps {
  backend: BackendStatus
  cwd: string | null
}

const MCP_PAGE_LIMIT = 100
const MAX_MCP_PAGES = 25

function displayError(error: unknown): string {
  return sanitizeIntegrationDiagnostic(error instanceof Error ? error.message : String(error))
}

export async function listAllMcpServers(): Promise<McpServerSummary[]> {
  const pages: McpServerSummary[][] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  for (let pageIndex = 0; pageIndex < MAX_MCP_PAGES; pageIndex += 1) {
    const response = await window.codex.invoke<unknown>('mcpServerStatus/list', {
      cursor,
      detail: 'full',
      limit: MCP_PAGE_LIMIT
    })
    const page = normalizeMcpServerStatusResponse(response)
    pages.push(page.servers)
    if (!page.nextCursor) return mergeMcpServerPages(pages)
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('The app-server repeated an MCP pagination cursor.')
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new Error('The MCP server list exceeded the safe pagination limit.')
}

async function listAllApps(forceRefetch: boolean): Promise<AppSummary[]> {
  const catalogResult = await Promise.allSettled([
    collectAppCatalog((cursor) =>
      window.codex.invoke<unknown>('app/list', {
        cursor,
        forceRefetch,
        limit: APP_CATALOG_PAGE_LIMIT,
        threadId: null
      })
    ),
    window.codex
      .invoke<unknown>('app/installed', {
        forceRefresh: forceRefetch,
        threadId: null
      })
      .then(normalizeAppsInstalledResponse)
  ])

  const [catalog, installed] = catalogResult
  if (catalog.status === 'rejected') throw catalog.reason
  return mergeAppsWithInstalledState(
    catalog.value,
    installed.status === 'fulfilled' ? installed.value : null
  )
}

async function listPlugins(cwd: string, forceRefetch: boolean): Promise<PluginInventory> {
  const response = await window.codex.invoke<unknown>('plugin/list', {
    cwds: [cwd],
    forceRefetch
  })
  return normalizePluginListResponse(response)
}

export function IntegrationsSettings({ backend, cwd }: IntegrationsSettingsProps): ReactNode {
  const [skills, setSkills] = useState<SkillInventory | null>(null)
  const [apps, setApps] = useState<AppSummary[] | null>(null)
  const [plugins, setPlugins] = useState<PluginInventory | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServerSummary[] | null>(null)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [pluginsError, setPluginsError] = useState<string | null>(null)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadingMcp, setReloadingMcp] = useState(false)
  const requestSequence = useRef(0)

  const refresh = useCallback(async (forceSkills: boolean): Promise<void> => {
    const sequence = ++requestSequence.current
    setReloadingMcp(false)
    if (backend.state !== 'ready' || !cwd) {
      setSkills(null)
      setApps(null)
      setPlugins(null)
      setMcpServers(null)
      setSkillsError(
        backend.message
          ? sanitizeIntegrationDiagnostic(backend.message)
          : 'Connect to the local app-server to inspect integrations.'
      )
      setAppsError(null)
      setPluginsError(null)
      setMcpError(null)
      setRefreshing(false)
      return
    }

    setRefreshing(true)
    setSkillsError(null)
    setAppsError(null)
    setPluginsError(null)
    setMcpError(null)
    const [skillsResult, appsResult, pluginsResult, mcpResult] = await Promise.allSettled([
      window.codex
        .invoke<unknown>('skills/list', { cwds: [cwd], forceReload: forceSkills })
        .then(normalizeSkillsListResponse),
      listAllApps(forceSkills),
      listPlugins(cwd, forceSkills),
      listAllMcpServers()
    ])
    if (sequence !== requestSequence.current) return

    if (skillsResult.status === 'fulfilled') {
      setSkills(skillsResult.value)
    } else {
      setSkills(null)
      setSkillsError(displayError(skillsResult.reason))
    }
    if (appsResult.status === 'fulfilled') {
      setApps(appsResult.value)
    } else {
      setApps(null)
      setAppsError(displayError(appsResult.reason))
    }
    if (pluginsResult.status === 'fulfilled') {
      setPlugins(pluginsResult.value)
    } else {
      setPlugins(null)
      setPluginsError(displayError(pluginsResult.reason))
    }
    if (mcpResult.status === 'fulfilled') {
      setMcpServers(mcpResult.value)
    } else {
      setMcpServers(null)
      setMcpError(displayError(mcpResult.reason))
    }
    setRefreshing(false)
  }, [backend.message, backend.state, cwd])

  useEffect(() => {
    void refresh(false)
    return () => {
      requestSequence.current += 1
    }
  }, [refresh])

  const reloadMcp = async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setReloadingMcp(true)
    setMcpError(null)
    try {
      await window.codex.invoke('config/mcpServer/reload')
      const nextServers = await listAllMcpServers()
      if (sequence !== requestSequence.current) return
      setMcpServers(nextServers)
    } catch (error) {
      if (sequence !== requestSequence.current) return
      setMcpError(displayError(error))
    } finally {
      if (sequence === requestSequence.current) setReloadingMcp(false)
    }
  }

  const disabled = backend.state !== 'ready' || !cwd || refreshing || reloadingMcp

  return (
    <section
      id="settings-integrations-panel"
      role="tabpanel"
      aria-labelledby="settings-integrations-tab"
      className="settings-panel"
      tabIndex={0}
    >
      <div className="settings-panel-heading integrations-heading">
        <div>
          <h3>Integrations</h3>
          <p>Inspect apps, plugins, skills, and MCP servers available to this workspace.</p>
        </div>
        <div className="integrations-heading-actions">
          <button
            type="button"
            className="settings-icon-button"
            aria-label="Refresh integrations"
            title="Refresh integrations"
            disabled={disabled}
            onClick={() => void refresh(true)}
          >
            <RefreshCw className={refreshing ? 'spin' : undefined} />
          </button>
          <button
            type="button"
            className="settings-secondary-button integrations-reload-button"
            disabled={disabled}
            onClick={() => void reloadMcp()}
          >
            {reloadingMcp ? <LoaderCircle className="spin" /> : <RotateCcw />}
            {reloadingMcp ? 'Reloading…' : 'Reload MCP'}
          </button>
        </div>
      </div>

      <IntegrationGroup
        title="Skills"
        count={skills ? `${skills.skills.length} found` : null}
      >
        {skillsError && <IntegrationError message={skillsError} />}
        {refreshing && !skills ? (
          <IntegrationLoading label="Scanning workspace skills…" />
        ) : skills ? (
          <>
            {skills.errors.length > 0 && (
              <div className="integration-diagnostics" role="status">
                <div>
                  <CircleAlert />
                  <strong>{skills.errors.length} discovery {skills.errors.length === 1 ? 'error' : 'errors'}</strong>
                </div>
                <ul>
                  {skills.errors.map((error, index) => (
                    <li key={`${error.message}-${index}`}>{error.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {skills.skills.length ? (
              <div className="integration-list">
                {skills.skills.map((skill) => (
                  <article className="integration-row" key={skill.id}>
                    <span className="integration-row-icon"><Sparkles /></span>
                    <div className="integration-row-body">
                      <div className="integration-row-title">
                        <strong>{skill.name}</strong>
                        <span className={`integration-status-badge is-${skill.enabled ? 'connected' : 'disabled'}`}>
                          {skill.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="integration-meta">
                        <span>{skillScopeLabel(skill.scope)}</span>
                        <span>{dependencyLabel(skill.dependencies.length)}</span>
                      </div>
                      {skill.dependencies.length > 0 && (
                        <div className="integration-name-list" aria-label={`${skill.name} dependencies`}>
                          {skill.dependencies.map((dependency) => (
                            <span key={`${dependency.type}:${dependency.value}`}>
                              {dependency.type} · {dependency.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <IntegrationEmpty icon={<Blocks />} message="No skills were discovered for this workspace." />
            )}
          </>
        ) : !skillsError ? (
          <IntegrationEmpty icon={<Blocks />} message="Skill inventory is unavailable." />
        ) : null}
      </IntegrationGroup>

      <IntegrationGroup
        title="Apps"
        count={apps ? `${apps.length} available` : null}
      >
        {appsError && <IntegrationError message={appsError} />}
        {refreshing && !apps ? (
          <IntegrationLoading label="Loading app catalog…" />
        ) : apps?.length ? (
          <div className="integration-list">
            {apps.map((app) => <AppRow key={app.id} app={app} />)}
          </div>
        ) : apps ? (
          <IntegrationEmpty icon={<AppWindow />} message="No apps are available for this account." />
        ) : !appsError ? (
          <IntegrationEmpty icon={<AppWindow />} message="App catalog is unavailable." />
        ) : null}
      </IntegrationGroup>

      <IntegrationGroup
        title="Plugins"
        count={plugins ? `${plugins.plugins.length} found` : null}
      >
        {pluginsError && <IntegrationError message={pluginsError} />}
        {refreshing && !plugins ? (
          <IntegrationLoading label="Loading plugin catalog…" />
        ) : plugins ? (
          <>
            {plugins.loadErrorCount > 0 && (
              <div className="integration-diagnostics" role="status">
                <div>
                  <CircleAlert />
                  <strong>
                    {plugins.loadErrorCount} marketplace {plugins.loadErrorCount === 1 ? 'error' : 'errors'}
                  </strong>
                </div>
              </div>
            )}
            {plugins.plugins.length ? (
              <div className="integration-list">
                {plugins.plugins.map((plugin) => (
                  <PluginRow key={plugin.id} plugin={plugin} />
                ))}
              </div>
            ) : (
              <IntegrationEmpty icon={<Package />} message="No plugins were found." />
            )}
          </>
        ) : !pluginsError ? (
          <IntegrationEmpty icon={<Package />} message="Plugin catalog is unavailable." />
        ) : null}
      </IntegrationGroup>

      <IntegrationGroup
        title="MCP servers"
        count={mcpServers ? `${mcpServers.length} configured` : null}
      >
        {mcpError && <IntegrationError message={mcpError} />}
        {(refreshing || reloadingMcp) && !mcpServers ? (
          <IntegrationLoading label="Loading MCP server status…" />
        ) : mcpServers?.length ? (
          <div className="integration-list">
            {mcpServers.map((server) => <McpServerRow key={server.name} server={server} />)}
          </div>
        ) : mcpServers ? (
          <IntegrationEmpty icon={<PlugZap />} message="No MCP servers are configured." />
        ) : !mcpError ? (
          <IntegrationEmpty icon={<PlugZap />} message="MCP server status is unavailable." />
        ) : null}
      </IntegrationGroup>

      <p className="integrations-readonly-note">
        This view is read-only. Catalog refresh does not install or remove apps or plugins. Reload re-reads existing MCP configuration; it does not change configuration or manage OAuth credentials.
      </p>
    </section>
  )
}

function IntegrationGroup({
  title,
  count,
  children
}: {
  title: string
  count: string | null
  children: ReactNode
}): ReactNode {
  return (
    <section className="settings-group integrations-group">
      <div className="integrations-group-title">
        <h4>{title}</h4>
        {count && <span>{count}</span>}
      </div>
      <div className="settings-group-card">{children}</div>
    </section>
  )
}

function IntegrationLoading({ label }: { label: string }): ReactNode {
  return (
    <div className="integration-message" role="status">
      <LoaderCircle className="spin" />
      <span>{label}</span>
    </div>
  )
}

function IntegrationError({ message }: { message: string }): ReactNode {
  return (
    <div className="integration-error" role="alert">
      <CircleAlert />
      <span>{message}</span>
    </div>
  )
}

function IntegrationEmpty({ icon, message }: { icon: ReactNode; message: string }): ReactNode {
  return (
    <div className="integration-message is-empty">
      {icon}
      <span>{message}</span>
    </div>
  )
}

function skillScopeLabel(scope: SkillScope): string {
  const labels: Record<SkillScope, string> = {
    repo: 'Repository scope',
    user: 'User scope',
    system: 'System scope',
    admin: 'Admin scope'
  }
  return labels[scope]
}

function dependencyLabel(count: number): string {
  if (count === 0) return 'No declared tool dependencies'
  return `${count} tool ${count === 1 ? 'dependency' : 'dependencies'}`
}

type IntegrationTone = 'connected' | 'warning' | 'disabled'

function appStatus(app: AppSummary): { label: string; tone: IntegrationTone } {
  if (app.callable) return { label: 'Callable', tone: 'connected' }
  if (app.installed) {
    return app.runtimeEnabled
      ? { label: 'Installed', tone: 'warning' }
      : { label: 'Disabled', tone: 'disabled' }
  }
  if (!app.configEnabled) return { label: 'Disabled', tone: 'disabled' }
  if (!app.accessible) return { label: 'Unavailable', tone: 'disabled' }
  return { label: 'Available', tone: 'connected' }
}

function AppRow({ app }: { app: AppSummary }): ReactNode {
  const status = appStatus(app)
  return (
    <article className="integration-row">
      <span className="integration-row-icon"><AppWindow /></span>
      <div className="integration-row-body">
        <div className="integration-row-title">
          <strong>{app.name}</strong>
          <span className={`integration-status-badge is-${status.tone}`}>{status.label}</span>
        </div>
        <div className="integration-meta">
          {app.developer && <span>{app.developer}</span>}
          {app.version && <span>v{app.version}</span>}
          {app.source && <span>{app.source}</span>}
          {app.category && <span>{app.category}</span>}
          {app.installed === null && <span>Install status unavailable</span>}
        </div>
      </div>
    </article>
  )
}

const pluginSourceLabels: Record<PluginSourceKind, string> = {
  local: 'Local source',
  git: 'Git source',
  npm: 'npm source',
  remote: 'Remote catalog',
  unknown: 'Source unavailable'
}

const pluginDisabledReasonLabels: Record<string, string> = {
  disabled_by_admin: 'Disabled by admin',
  plan_not_eligible: 'Plan not eligible',
  required_app_unavailable: 'Required app unavailable',
  unknown: 'Unavailable'
}

function pluginStatus(plugin: PluginSummary): { label: string; tone: IntegrationTone } {
  if (plugin.availability === 'DISABLED_BY_ADMIN' || plugin.disabledReason) {
    return {
      label: pluginDisabledReasonLabels[plugin.disabledReason || 'disabled_by_admin'] || 'Unavailable',
      tone: 'disabled'
    }
  }
  if (plugin.installed && plugin.enabled) return { label: 'Enabled', tone: 'connected' }
  if (plugin.installed) return { label: 'Disabled', tone: 'disabled' }
  if (plugin.installPolicy === 'NOT_AVAILABLE') return { label: 'Unavailable', tone: 'disabled' }
  if (plugin.availability === 'AVAILABLE') return { label: 'Available', tone: 'warning' }
  return { label: 'Status unavailable', tone: 'disabled' }
}

function PluginRow({ plugin }: { plugin: PluginSummary }): ReactNode {
  const status = pluginStatus(plugin)
  return (
    <article className="integration-row">
      <span className="integration-row-icon"><Package /></span>
      <div className="integration-row-body">
        <div className="integration-row-title">
          <strong>{plugin.name}</strong>
          <span className={`integration-status-badge is-${status.tone}`}>{status.label}</span>
        </div>
        <div className="integration-meta">
          {plugin.developer && <span>{plugin.developer}</span>}
          {plugin.localVersion && <span>Installed v{plugin.localVersion}</span>}
          {plugin.version && plugin.version !== plugin.localVersion && <span>Catalog v{plugin.version}</span>}
          <span>{pluginSourceLabels[plugin.source]}</span>
          {plugin.category && <span>{plugin.category}</span>}
          {plugin.featured && <span>Featured</span>}
        </div>
      </div>
    </article>
  )
}

const authLabels: Record<McpAuthStatus, string> = {
  unknown: 'Auth unknown',
  unsupported: 'No auth',
  notLoggedIn: 'Sign-in required',
  bearerToken: 'Bearer token',
  oAuth: 'OAuth'
}

const runtimeLabels: Record<McpRuntimeStatus, string> = {
  notStarted: 'Not started',
  starting: 'Starting',
  connected: 'Connected',
  authenticationRequired: 'Authentication required',
  failed: 'Failed',
  cancelled: 'Cancelled',
  disabled: 'Disabled',
  unavailable: 'Status unavailable'
}

function runtimeTone(status: McpRuntimeStatus): IntegrationTone {
  if (status === 'connected') return 'connected'
  if (status === 'starting' || status === 'authenticationRequired' || status === 'failed') return 'warning'
  return 'disabled'
}

function summarizedNames(names: string[]): string {
  const visible = names.slice(0, 8)
  const remainder = names.length - visible.length
  return remainder > 0 ? `${visible.join(', ')} · +${remainder} more` : visible.join(', ')
}

function McpServerRow({ server }: { server: McpServerSummary }): ReactNode {
  const resourceCount = server.resourceNames.length + server.resourceTemplateNames.length
  return (
    <article className="integration-row is-mcp">
      <span className="integration-row-icon"><PlugZap /></span>
      <div className="integration-row-body">
        <div className="integration-row-title">
          <strong>{server.displayName}</strong>
          <span className={`integration-status-badge is-${runtimeTone(server.runtimeStatus)}`}>
            {runtimeLabels[server.runtimeStatus]}
          </span>
        </div>
        <div className="integration-meta">
          {server.displayName !== server.name && <span>{server.name}</span>}
          {server.version && <span>v{server.version}</span>}
          <span>{authLabels[server.authStatus]}</span>
          <span>{server.toolNames.length} {server.toolNames.length === 1 ? 'tool' : 'tools'}</span>
          <span>{resourceCount} {resourceCount === 1 ? 'resource' : 'resources'}</span>
        </div>
        {server.toolNames.length > 0 && (
          <div className="integration-inventory-line">
            <span>Tools</span>
            <p>{summarizedNames(server.toolNames)}</p>
          </div>
        )}
        {resourceCount > 0 && (
          <div className="integration-inventory-line">
            <span>Resources</span>
            <p>{summarizedNames([...server.resourceNames, ...server.resourceTemplateNames])}</p>
          </div>
        )}
        {server.toolsError && (
          <div className="integration-inline-warning">
            <CircleAlert />
            <span>{server.toolsError}</span>
          </div>
        )}
      </div>
    </article>
  )
}

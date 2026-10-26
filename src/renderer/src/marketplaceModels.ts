import { normalizePluginListResponse, type PluginInventory, type PluginSummary } from './integrationModels'
import { MARKETPLACE_CATALOG, type MarketplaceCatalogItem } from './discoveryPages'

export type PluginSelector = { pluginName: string; marketplacePath: string } | { pluginName: string; remoteMarketplaceName: string }

export interface MarketplacePlugin extends MarketplaceCatalogItem {
  plugin: PluginSummary | null
  selector: PluginSelector | null
  marketplaceName: string | null
  requestPluginId: string | null
  websiteUrl: string | null
}

export interface MarketplaceSnapshot {
  inventory: PluginInventory
  items: MarketplacePlugin[]
}

export interface PluginDetailSnapshot {
  description: string
  skills: Array<{ name: string; description: string; enabled: boolean }>
  apps: Array<{ id: string; name: string; description: string; installUrl: string | null }>
  mcpServers: string[]
  hooks: Array<{ key: string; eventName: string }>
  websiteUrl: string | null
  privacyPolicyUrl: string | null
  termsOfServiceUrl: string | null
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, limit = 4096): string | null {
  return typeof value === 'string' && value.trim() && value.length <= limit && !value.includes('\0') ? value.trim() : null
}

function absolutePath(value: unknown): string | null {
  const path = text(value)
  if (!path?.startsWith('/') || path.includes('//') || path.split('/').some((part) => part === '.' || part === '..')) return null
  return path
}

export function marketplaceExternalUrl(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function catalogMatch(name: string, displayName: string): MarketplaceCatalogItem | undefined {
  const names = new Set([name, displayName].map((value) => value.toLocaleLowerCase()))
  return MARKETPLACE_CATALOG.find((item) => names.has(item.name.toLocaleLowerCase()) || names.has(item.id.toLocaleLowerCase()))
}

/** The RPC selector uses the raw plugin name and marketplace, never its display label. */
export function normalizeMarketplaceSnapshot(raw: unknown): MarketplaceSnapshot {
  const inventory = normalizePluginListResponse(raw)
  const items = new Map<string, MarketplacePlugin>()
  const summaries = new Map(inventory.plugins.map((plugin) => [plugin.id, plugin]))
  if (!record(raw) || !Array.isArray(raw.marketplaces)) return { inventory, items: [] }
  for (const marketplace of raw.marketplaces) {
    if (!record(marketplace) || !Array.isArray(marketplace.plugins)) continue
    const marketplaceName = text(marketplace.name, 512)
    const marketplacePath = absolutePath(marketplace.path)
    for (const value of marketplace.plugins) {
      if (!record(value)) continue
      const id = text(value.id, 1024)
      const summary = id ? summaries.get(id) : null
      const rawName = text(value.name, 512)
      if (!summary || !rawName || !id) continue
      const existing = items.get(id)
      if (existing && (!summary.installed || value.installed !== true)) continue
      const source = record(value.source) ? value.source : null
      const remoteName = text(value.remotePluginId, 1024)
      const selector: PluginSelector | null = marketplacePath
        ? { marketplacePath, pluginName: rawName }
        : marketplaceName && remoteName && source?.type === 'remote'
          ? { remoteMarketplaceName: marketplaceName, pluginName: remoteName }
          : null
      const display = record(value.interface) ? value.interface : null
      const baseline = catalogMatch(rawName, summary.name)
      items.set(id, {
        id,
        name: summary.name,
        description: text(display?.shortDescription) || baseline?.description || '',
        category: summary.category || baseline?.category || '其他',
        icon: baseline?.icon || 'plugin',
        plugin: summary,
        selector,
        marketplaceName,
        requestPluginId: marketplacePath ? id : remoteName,
        websiteUrl: marketplaceExternalUrl(display?.websiteUrl)
      })
    }
  }
  return { inventory, items: inventory.plugins.map((plugin) => items.get(plugin.id)).filter((item): item is MarketplacePlugin => Boolean(item)) }
}

export function offlineMarketplaceItems(): MarketplacePlugin[] {
  return MARKETPLACE_CATALOG.map((item) => ({ ...item, plugin: null, selector: null, marketplaceName: null, requestPluginId: null, websiteUrl: null }))
}

export function filterMarketplaceItems(items: MarketplacePlugin[], query: string, personal: boolean): MarketplacePlugin[] {
  const needle = query.trim().toLocaleLowerCase()
  return items.filter((item) => (!personal || item.plugin?.installed) && (!needle || `${item.name} ${item.description} ${item.category} ${item.plugin?.developer || ''}`.toLocaleLowerCase().includes(needle)))
}

export function pluginInstallBlockedReason(item: MarketplacePlugin): string | null {
  if (!item.plugin || !item.selector) return '此插件未在当前机器的插件市场中提供。'
  if (item.plugin.availability === 'DISABLED_BY_ADMIN') return '管理员已停用此插件。'
  if (item.plugin.installPolicy === 'NOT_AVAILABLE') return '此插件目前无法安装。'
  if (item.plugin.disabledReason === 'plan_not_eligible') return '当前套餐无法使用此插件。'
  if (item.plugin.disabledReason === 'required_app_unavailable') return '此插件依赖的应用当前不可用。'
  return null
}

export function pluginUninstallBlockedReason(item: MarketplacePlugin): string | null {
  if (item.plugin?.id === 'code-review@openai-bundled') return 'Code Review 由 Codex 管理，无法卸载。'
  if (item.plugin?.installPolicy === 'INSTALLED_BY_DEFAULT' && item.plugin.source === 'remote') return '此插件由管理员默认安装。'
  return null
}

export function pluginEnabledWriteParams(id: string, enabled: boolean): { keyPath: string; value: boolean; mergeStrategy: 'upsert' } {
  if (!/^[a-zA-Z0-9_@/-][a-zA-Z0-9_@/.-]{0,1023}$/.test(id) || id.includes('..') || id.includes('.')) throw new Error('插件标识无法用于配置写入。')
  return { keyPath: `plugins.${id}.enabled`, value: enabled, mergeStrategy: 'upsert' }
}

export function marketplaceAddParams(source: string, refName: string, sparsePaths: string): { source: string; refName: string | null; sparsePaths: string[] | null } {
  const normalizedSource = text(source)
  if (!normalizedSource) throw new Error('请输入插件市场来源。')
  const ref = refName.trim()
  if (ref.length > 512 || ref.includes('\0')) throw new Error('Git 引用过长或无效。')
  const paths = sparsePaths.split(/[\n,]+/).map((path) => path.trim()).filter(Boolean)
  if (paths.length > 100 || paths.some((path) => path.length > 4096 || path.includes('\0'))) throw new Error('稀疏路径过多或无效。')
  return { source: normalizedSource, refName: ref || null, sparsePaths: paths.length ? paths : null }
}

export function normalizePluginDetail(raw: unknown): PluginDetailSnapshot {
  if (!record(raw) || !record(raw.plugin) || !record(raw.plugin.summary)) throw new Error('Codex Server 返回了无效的插件详情。')
  const plugin = raw.plugin
  const display = record(plugin.summary) && record(plugin.summary.interface) ? plugin.summary.interface : null
  const boundedList = (value: unknown, limit: number): unknown[] => {
    if (!Array.isArray(value)) return []
    if (value.length > limit) throw new Error('插件详情包含过多条目。')
    return value
  }
  const skills = boundedList(plugin.skills, 1000).flatMap((value) => {
    if (!record(value)) return []
    const name = text(value.name, 512)
    return name ? [{ name, description: text(value.shortDescription) || text(value.description, 16_384) || '', enabled: value.enabled === true }] : []
  })
  const apps = normalizePluginAuthApps({ appsNeedingAuth: boundedList(plugin.apps, 100) })
  const mcpServers = boundedList(plugin.mcpServers, 100).map((value) => text(value, 512)).filter((value): value is string => Boolean(value))
  const hooks = boundedList(plugin.hooks, 1000).flatMap((value) => {
    if (!record(value)) return []
    const key = text(value.key, 1024)
    const eventName = text(value.eventName, 512)
    return key && eventName ? [{ key, eventName }] : []
  })
  return { description: text(display?.longDescription, 65_536) || text(plugin.description, 65_536) || '', skills, apps, mcpServers, hooks, websiteUrl: marketplaceExternalUrl(display?.websiteUrl), privacyPolicyUrl: marketplaceExternalUrl(display?.privacyPolicyUrl), termsOfServiceUrl: marketplaceExternalUrl(display?.termsOfServiceUrl) }
}

export function normalizePluginAuthApps(raw: unknown): PluginDetailSnapshot['apps'] {
  if (!record(raw) || !Array.isArray(raw.appsNeedingAuth)) return []
  if (raw.appsNeedingAuth.length > 100) throw new Error('插件需要连接的应用过多。')
  return raw.appsNeedingAuth.flatMap((value) => {
    if (!record(value)) return []
    const id = text(value.id, 1024)
    const name = text(value.name, 512)
    return id && name ? [{ id, name, description: text(value.description) || '', installUrl: marketplaceExternalUrl(value.installUrl) }] : []
  })
}

export type MarketplaceOperation = 'install' | 'uninstall' | 'enable'

export async function performMarketplaceOperation(
  item: MarketplacePlugin,
  operation: MarketplaceOperation,
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  newAttemptId: () => string = () => crypto.randomUUID()
): Promise<PluginDetailSnapshot['apps']> {
  if (!item.plugin) throw new Error('此插件未在当前机器的插件市场中提供。')
  if (operation === 'install') {
    const reason = pluginInstallBlockedReason(item)
    if (reason || !item.selector) throw new Error(reason || '插件来源不可用。')
    return normalizePluginAuthApps(await invoke('plugin/install', { ...item.selector, installAttemptId: newAttemptId() }))
  }
  if (operation === 'uninstall') {
    const reason = pluginUninstallBlockedReason(item)
    if (reason) throw new Error(reason)
    await invoke('plugin/uninstall', { pluginId: item.requestPluginId || item.plugin.id })
  } else {
    await invoke('config/value/write', pluginEnabledWriteParams(item.plugin.id, !item.plugin.enabled))
  }
  return []
}

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MarketplacePluginDetails } from './MarketplacePage'
import { filterMarketplaceItems, marketplaceAddParams, marketplaceExternalUrl, normalizeMarketplaceSnapshot, normalizePluginAuthApps, normalizePluginDetail, offlineMarketplaceItems, performMarketplaceOperation, pluginEnabledWriteParams, pluginInstallBlockedReason, pluginUninstallBlockedReason } from './marketplaceModels'

function plugin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'writer@local-market', name: 'writer', installed: false, enabled: true, source: { type: 'local', path: '/plugins/writer' }, installPolicy: 'AVAILABLE', authPolicy: 'ON_INSTALL', interface: { displayName: 'Writer Studio', shortDescription: 'Write documents', category: 'Productivity' }, ...overrides }
}

function localItem(overrides: Record<string, unknown> = {}) {
  return normalizeMarketplaceSnapshot({ marketplaces: [{ name: 'local-market', path: '/plugins/marketplace.json', plugins: [plugin(overrides)] }] }).items[0]
}

function remoteItem() {
  return normalizeMarketplaceSnapshot({ marketplaces: [{ name: 'remote-catalog', path: null, plugins: [plugin({ id: 'pretty-id', name: 'pretty-name', remotePluginId: 'service-plugin-12', source: { type: 'remote' }, installed: true })] }] }).items[0]
}

describe('marketplace request selectors', () => {
  it('preserves raw local plugin name separately from display name and source path', () => {
    const item = localItem()
    expect(item.name).toBe('Writer Studio')
    expect(item.description).toBe('Write documents')
    expect(item.selector).toEqual({ pluginName: 'writer', marketplacePath: '/plugins/marketplace.json' })
    expect(item.requestPluginId).toBe('writer@local-market')
  })

  it('uses service plugin ID for remote read/install and uninstall', async () => {
    const item = remoteItem()
    expect(item.selector).toEqual({ pluginName: 'service-plugin-12', remoteMarketplaceName: 'remote-catalog' })
    const invoke = vi.fn().mockResolvedValue({})
    await performMarketplaceOperation(item, 'uninstall', invoke)
    expect(invoke).toHaveBeenCalledWith('plugin/uninstall', { pluginId: 'service-plugin-12' })
  })

  it('does not invent a remote selector from its display name when service ID is absent', () => {
    const item = normalizeMarketplaceSnapshot({ marketplaces: [{ name: 'remote', plugins: [plugin({ source: { type: 'remote' } })] }] }).items[0]
    expect(item.selector).toBeNull()
    expect(pluginInstallBlockedReason(item)).toContain('未在当前机器')
  })

  it('does not pass relative or non-normalized marketplace paths to the bridge', () => {
    for (const path of ['plugins/marketplace.json', '/plugins/../marketplace.json', '/plugins//marketplace.json', '/plugins/./marketplace.json']) {
      const item = normalizeMarketplaceSnapshot({ marketplaces: [{ name: 'market', path, plugins: [plugin()] }] }).items[0]
      expect(item.selector).toBeNull()
    }
  })

  it('prefers the installed source when a plugin appears in multiple marketplaces', () => {
    const snapshot = normalizeMarketplaceSnapshot({ marketplaces: [
      { name: 'catalog', path: '/catalog/marketplace.json', plugins: [plugin()] },
      { name: 'installed', path: '/installed/marketplace.json', plugins: [plugin({ installed: true, enabled: false })] }
    ] })
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0].plugin?.installed).toBe(true)
    expect(snapshot.items[0].plugin?.enabled).toBe(false)
    expect(snapshot.items[0].selector).toEqual({ pluginName: 'writer', marketplacePath: '/installed/marketplace.json' })
  })
})

describe('marketplace mutations', () => {
  it('sends an installation attempt with the exact source and returns apps that need connection', async () => {
    const invoke = vi.fn().mockResolvedValue({ authPolicy: 'ON_INSTALL', appsNeedingAuth: [{ id: 'app-1', name: 'Documents', installUrl: 'https://example.com/connect' }] })
    const apps = await performMarketplaceOperation(localItem(), 'install', invoke, () => 'attempt-1')
    expect(invoke).toHaveBeenCalledWith('plugin/install', { pluginName: 'writer', marketplacePath: '/plugins/marketplace.json', installAttemptId: 'attempt-1' })
    expect(apps[0]).toEqual({ id: 'app-1', name: 'Documents', description: '', installUrl: 'https://example.com/connect' })
  })

  it('writes actual plugin enabled configuration and propagates backend errors', async () => {
    const invoke = vi.fn().mockResolvedValue({})
    await performMarketplaceOperation(localItem({ installed: true }), 'enable', invoke)
    expect(invoke).toHaveBeenCalledWith('config/value/write', { keyPath: 'plugins.writer@local-market.enabled', value: false, mergeStrategy: 'upsert' })
    invoke.mockRejectedValueOnce(new Error('plugin unavailable'))
    await expect(performMarketplaceOperation(localItem(), 'install', invoke)).rejects.toThrow('plugin unavailable')
  })

  it('prevents unavailable and protected plugins from generating mutation requests', async () => {
    const invoke = vi.fn()
    await expect(performMarketplaceOperation(localItem({ installPolicy: 'NOT_AVAILABLE' }), 'install', invoke)).rejects.toThrow('无法安装')
    await expect(performMarketplaceOperation(localItem({ id: 'code-review@openai-bundled' }), 'uninstall', invoke)).rejects.toThrow('无法卸载')
    expect(invoke).not.toHaveBeenCalled()
    expect(pluginUninstallBlockedReason(localItem({ source: { type: 'remote' }, installPolicy: 'INSTALLED_BY_DEFAULT' }))).toContain('管理员')
  })

  it('does not expose an installation action for offline catalog previews', async () => {
    const item = offlineMarketplaceItems()[0]
    const invoke = vi.fn()
    await expect(performMarketplaceOperation(item, 'install', invoke)).rejects.toThrow('未在当前机器')
    expect(invoke).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(createElement(MarketplacePluginDetails, { item, backendReady: true, busy: false, onOperation: async () => [] }))
    expect(html).toContain('disabled=""')
    expect(html).toContain('未在当前机器')
  })

  it('rejects config-key separators instead of writing a different TOML key', () => {
    expect(pluginEnabledWriteParams('writer@market', true).keyPath).toBe('plugins.writer@market.enabled')
    for (const id of ['writer.bad@market', 'writer..bad', 'writer\0', 'writer[key]']) expect(() => pluginEnabledWriteParams(id, true)).toThrow()
  })
})

describe('marketplace content and source form', () => {
  it('filters live metadata and limits personal tab to installed plugins', () => {
    const items = [localItem(), localItem({ id: 'installed@market', installed: true, interface: { displayName: 'LaTeX', category: 'Education' } })]
    expect(filterMarketplaceItems(items, 'education', false).map((item) => item.id)).toEqual(['installed@market'])
    expect(filterMarketplaceItems(items, '', true).map((item) => item.id)).toEqual(['installed@market'])
    expect(filterMarketplaceItems(offlineMarketplaceItems(), '', true)).toEqual([])
  })

  it('matches the shipped source/ref/sparse path normalization', () => {
    expect(marketplaceAddParams('  org/plugins  ', '  stable  ', 'plugins/writer,\n plugins/latex\n')).toEqual({ source: 'org/plugins', refName: 'stable', sparsePaths: ['plugins/writer', 'plugins/latex'] })
    expect(marketplaceAddParams('/local/plugins', '', '')).toEqual({ source: '/local/plugins', refName: null, sparsePaths: null })
    expect(() => marketplaceAddParams('  ', '', '')).toThrow('请输入')
    expect(() => marketplaceAddParams('org/repo', '', Array(102).fill('path').join(','))).toThrow('过多')
  })

  it('normalizes actual skill/app/MCP/hook details and only actionable web links', () => {
    const detail = normalizePluginDetail({ plugin: { summary: plugin({ interface: { longDescription: 'Detailed overview', websiteUrl: 'https://example.com', privacyPolicyUrl: 'javascript:alert(1)' } }), description: 'Fallback', skills: [{ name: 'writer:edit', description: 'Edit text', enabled: true }], apps: [{ id: 'app', name: 'Documents', installUrl: 'file:///private/token' }], mcpServers: ['writer-mcp'], hooks: [{ key: 'on-start', eventName: 'SessionStart' }] } })
    expect(detail.description).toBe('Detailed overview')
    expect(detail.skills[0].name).toBe('writer:edit')
    expect(detail.apps[0].installUrl).toBeNull()
    expect(detail.mcpServers).toEqual(['writer-mcp'])
    expect(detail.hooks).toEqual([{ key: 'on-start', eventName: 'SessionStart' }])
    expect(detail.websiteUrl).toBe('https://example.com/')
    expect(detail.privacyPolicyUrl).toBeNull()
    expect(marketplaceExternalUrl('https://name:password@example.com')).toBeNull()
    expect(() => normalizePluginDetail({ plugin: { summary: plugin(), mcpServers: Array(101).fill('server') } })).toThrow('过多')
    expect(() => normalizePluginAuthApps({ appsNeedingAuth: Array(101).fill({}) })).toThrow('过多')
  })
})

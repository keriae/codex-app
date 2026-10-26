import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IntegrationsSettings } from './IntegrationsSettings'
import {
  collectAppCatalog,
  mergeAppsWithInstalledState,
  mergeMcpServerPages,
  normalizeAppsInstalledResponse,
  normalizeAppsListResponse,
  normalizeMcpServerStatusResponse,
  normalizePluginListResponse,
  normalizeSkillsListResponse,
  sanitizeIntegrationDiagnostic
} from './integrationModels'

describe('integration settings response normalization', () => {
  it('keeps only synthetic skill presentation metadata and redacts paths', () => {
    const inventory = normalizeSkillsListResponse({
      data: [
        {
          cwd: '/synthetic/workspace',
          errors: [
            {
              message: 'Unable to parse /synthetic/workspace/.agents/skills/broken/SKILL.md',
              path: '/synthetic/workspace/.agents/skills/broken/SKILL.md'
            }
          ],
          skills: [
            {
              name: 'synthetic-review',
              description: 'synthetic description that must not enter the view model',
              enabled: true,
              path: '/synthetic/workspace/.agents/skills/review/SKILL.md',
              scope: 'repo',
              dependencies: {
                tools: [
                  { type: 'mcp', value: 'synthetic-server', command: 'synthetic-private-command' },
                  { type: 'mcp', value: 'synthetic-server' }
                ]
              }
            }
          ]
        }
      ]
    })

    expect(inventory).toEqual({
      skills: [
        {
          id: 'repo:synthetic-review:0',
          name: 'synthetic-review',
          scope: 'repo',
          enabled: true,
          dependencies: [{ type: 'mcp', value: 'synthetic-server' }]
        }
      ],
      errors: [{ message: 'Unable to parse <path>' }]
    })
    const serialized = JSON.stringify(inventory)
    expect(serialized).not.toContain('/synthetic/')
    expect(serialized).not.toContain('synthetic description')
    expect(serialized).not.toContain('synthetic-private-command')
  })

  it('summarizes MCP names and counts without carrying schemas, descriptions, origins, or URIs', () => {
    const page = normalizeMcpServerStatusResponse({
      data: [
        {
          name: 'synthetic-mcp',
          authStatus: 'oAuth',
          runtimeStatus: 'connected',
          httpOrigin: 'https://private.invalid',
          serverInfo: {
            name: 'synthetic-mcp',
            title: 'Synthetic MCP',
            version: '1.2.3',
            description: 'synthetic server description'
          },
          tools: {
            inspect: {
              name: 'inspect',
              description: 'synthetic tool description',
              inputSchema: { privateFixture: true }
            }
          },
          resources: [
            { name: 'Synthetic resource', uri: 'synthetic://private-resource' }
          ],
          resourceTemplates: [
            { name: 'Synthetic template', uriTemplate: 'synthetic://private/{id}' }
          ],
          toolsError: null
        }
      ],
      nextCursor: 'synthetic-cursor'
    })

    expect(page).toEqual({
      servers: [
        {
          name: 'synthetic-mcp',
          displayName: 'Synthetic MCP',
          version: '1.2.3',
          authStatus: 'oAuth',
          runtimeStatus: 'connected',
          toolNames: ['inspect'],
          resourceNames: ['Synthetic resource'],
          resourceTemplateNames: ['Synthetic template'],
          toolsError: null
        }
      ],
      nextCursor: 'synthetic-cursor'
    })
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('privateFixture')
    expect(serialized).not.toContain('private.invalid')
    expect(serialized).not.toContain('synthetic://')
    expect(serialized).not.toContain('synthetic tool description')
  })

  it('deduplicates MCP pages by server name and rejects malformed envelopes', () => {
    const first = normalizeMcpServerStatusResponse({
      data: [{ name: 'server-a', authStatus: 'unknown', tools: {}, resources: [], resourceTemplates: [] }]
    })
    const second = normalizeMcpServerStatusResponse({
      data: [{ name: 'server-a', authStatus: 'unsupported', tools: {}, resources: [], resourceTemplates: [] }]
    })

    expect(mergeMcpServerPages([first.servers, second.servers])[0].authStatus).toBe('unsupported')
    expect(() => normalizeSkillsListResponse({ data: null })).toThrow('skills/list')
    expect(() => normalizeMcpServerStatusResponse({ data: [], nextCursor: '' })).toThrow('cursor')
  })

  it('bounds skills collections, nested dependencies, and retained text', () => {
    expect(() => normalizeSkillsListResponse({
      data: Array.from({ length: 65 }, () => ({}))
    })).toThrow('too many skills/list groups')

    expect(() => normalizeSkillsListResponse({
      data: [{ skills: Array.from({ length: 1_001 }, () => null) }]
    })).toThrow('too many skills in one group')

    expect(() => normalizeSkillsListResponse({
      data: [{ errors: Array.from({ length: 257 }, () => null) }]
    })).toThrow('too many skill discovery errors')

    expect(() => normalizeSkillsListResponse({
      data: [{
        skills: [{
          name: 'bounded-skill',
          enabled: true,
          scope: 'repo',
          dependencies: {
            tools: Array.from({ length: 129 }, (_, index) => ({
              type: 'mcp',
              value: `server-${index}`
            }))
          }
        }]
      }]
    })).toThrow('too many dependencies for one skill')

    expect(() => normalizeSkillsListResponse({
      data: [{ skills: [{ name: 'x'.repeat(257), enabled: true, scope: 'repo' }] }]
    })).toThrow('overlong skill name')

    const inventory = normalizeSkillsListResponse({
      data: [{
        skills: [{
          name: 'bounded-skill',
          enabled: true,
          scope: 'repo',
          dependencies: { tools: [{ type: 'mcp', value: 'x'.repeat(2_000) }] }
        }]
      }]
    })
    expect(inventory.skills[0].dependencies[0].value).toHaveLength(1_024)
    expect(inventory.skills[0].dependencies[0].value.endsWith('…')).toBe(true)
  })

  it('bounds MCP pages, nested inventory collections, cursors, and retained text', () => {
    expect(() => normalizeMcpServerStatusResponse({
      data: Array.from({ length: 101 }, (_, index) => ({ name: `server-${index}` }))
    })).toThrow('page limit')

    expect(() => normalizeMcpServerStatusResponse({
      data: [{
        name: 'too-many-tools',
        tools: Object.fromEntries(
          Array.from({ length: 513 }, (_, index) => [`tool-${index}`, {}])
        )
      }]
    })).toThrow('too many MCP inventory items for one server')

    expect(() => normalizeMcpServerStatusResponse({
      data: [{
        name: 'too-many-resources',
        resources: Array.from({ length: 513 }, () => ({}))
      }]
    })).toThrow('too many MCP inventory items for one server')

    expect(() => normalizeMcpServerStatusResponse({
      data: [],
      nextCursor: 'x'.repeat(8_193)
    })).toThrow('overlong MCP pagination cursor')

    const page = normalizeMcpServerStatusResponse({
      data: [{
        name: 'bounded-server',
        serverInfo: { title: 'x'.repeat(1_000) },
        tools: { synthetic: { title: 'y'.repeat(1_000) } },
        resources: [{ title: 'z'.repeat(1_000) }]
      }]
    })
    expect(page.servers[0].displayName).toHaveLength(256)
    expect(page.servers[0].displayName.endsWith('…')).toBe(true)
    expect(page.servers[0].toolNames[0]).toHaveLength(256)
    expect(page.servers[0].resourceNames[0]).toHaveLength(256)
  })

  it('redacts structured and file URL paths from bounded diagnostics', () => {
    expect(
      sanitizeIntegrationDiagnostic(
        'Could not read file:///synthetic/private/skill.json at /synthetic/other/location'
      )
    ).toBe('Could not read <path> at <path>')
  })

  it('keeps only safe app catalog status and joins the installed runtime snapshot', () => {
    const catalogPage = normalizeAppsListResponse({
      data: [
        {
          id: 'synthetic-app',
          name: 'Synthetic App',
          description: 'private app description',
          distributionChannel: 'Curated',
          iconAssets: { large: 'https://private.invalid/icon.png' },
          installUrl: 'https://private.invalid/install?token=secret-token',
          labels: { private: 'secret-token' },
          logoUrl: 'https://private.invalid/logo.png',
          isAccessible: true,
          isEnabled: true,
          appMetadata: {
            developer: 'Synthetic Developer',
            version: '1.2.3',
            categories: ['Productivity'],
            seoDescription: 'private SEO copy',
            screenshots: [
              { url: 'https://private.invalid/screenshot.png', userPrompt: 'private user prompt' }
            ]
          },
          branding: {
            isDiscoverableApp: true,
            website: 'https://private.invalid',
            privacyPolicy: 'https://private.invalid/privacy'
          }
        }
      ],
      nextCursor: null
    })
    const installed = normalizeAppsInstalledResponse({
      apps: [
        {
          id: 'synthetic-app',
          runtimeName: 'Synthetic Runtime',
          enabled: true,
          callable: true,
          tools: [{ inputSchema: { secretToken: true } }]
        }
      ]
    })

    expect(mergeAppsWithInstalledState(catalogPage.apps, installed)).toEqual([
      {
        id: 'synthetic-app',
        name: 'Synthetic App',
        developer: 'Synthetic Developer',
        version: '1.2.3',
        category: 'Productivity',
        source: 'Curated',
        accessible: true,
        configEnabled: true,
        installed: true,
        runtimeEnabled: true,
        callable: true
      }
    ])
    const serialized = JSON.stringify({ catalogPage, installed })
    expect(serialized).not.toContain('private.invalid')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('private user prompt')
    expect(serialized).not.toContain('inputSchema')
  })

  it('paginates app/list safely and rejects cursor loops', async () => {
    const cursors: Array<string | null> = []
    const apps = await collectAppCatalog(async (cursor) => {
      cursors.push(cursor)
      return cursor === null
        ? {
            data: [{ id: 'app-a', name: 'App A', isAccessible: true, isEnabled: true }],
            nextCursor: 'cursor-a'
          }
        : {
            data: [{ id: 'app-b', name: 'App B', isAccessible: false, isEnabled: true }],
            nextCursor: null
          }
    })
    expect(cursors).toEqual([null, 'cursor-a'])
    expect(apps.map((app) => app.id)).toEqual(['app-a', 'app-b'])

    await expect(
      collectAppCatalog(async (cursor) => ({
        data: [],
        nextCursor: cursor === null ? 'repeated-cursor' : 'repeated-cursor'
      }))
    ).rejects.toThrow('repeated')
    expect(() => normalizeAppsListResponse({ data: [], nextCursor: '' })).toThrow('cursor')
    expect(() =>
      normalizeAppsListResponse({
        data: Array.from({ length: 101 }, (_, index) => ({ id: `app-${index}`, name: `App ${index}` }))
      })
    ).toThrow('page limit')
  })

  it('summarizes plugins without retaining descriptions, paths, URIs, schemas, or share data', () => {
    const inventory = normalizePluginListResponse({
      featuredPluginIds: ['synthetic-plugin'],
      marketplaceLoadErrors: [
        {
          marketplacePath: '/synthetic/private/marketplace.json',
          message: 'Could not load /synthetic/private/marketplace.json'
        }
      ],
      marketplaces: [
        {
          name: 'private-marketplace-name',
          path: '/synthetic/private/marketplace.json',
          interface: { displayName: 'Private Marketplace' },
          plugins: [
            {
              id: 'synthetic-plugin',
              name: 'synthetic-plugin',
              installed: true,
              enabled: true,
              availability: 'AVAILABLE',
              disabledReason: null,
              installPolicy: 'AVAILABLE',
              authPolicy: 'ON_USE',
              version: '2.0.0',
              localVersion: '1.9.0',
              source: {
                type: 'git',
                url: 'https://private.invalid/repository.git',
                path: '/synthetic/private/checkout',
                refName: 'secret-ref',
                sha: 'secret-sha'
              },
              interface: {
                displayName: 'Synthetic Plugin',
                developerName: 'Synthetic Developer',
                category: 'Developer tools',
                longDescription: 'private plugin description',
                defaultPrompt: ['private user prompt'],
                logo: '/synthetic/private/logo.png',
                logoUrl: 'https://private.invalid/logo.png',
                screenshotUrls: ['https://private.invalid/screenshot.png'],
                screenshots: ['/synthetic/private/screenshot.png'],
                capabilities: ['private-capability']
              },
              shareContext: {
                shareUrl: 'https://private.invalid/share?token=secret-token',
                creatorAccountUserId: 'private-user-id'
              },
              toolSchema: { secretToken: true }
            }
          ]
        }
      ]
    })

    expect(inventory).toEqual({
      plugins: [
        {
          id: 'synthetic-plugin',
          name: 'Synthetic Plugin',
          developer: 'Synthetic Developer',
          category: 'Developer tools',
          version: '2.0.0',
          localVersion: '1.9.0',
          source: 'git',
          installed: true,
          enabled: true,
          featured: true,
          availability: 'AVAILABLE',
          disabledReason: null,
          installPolicy: 'AVAILABLE'
        }
      ],
      marketplaceCount: 1,
      loadErrorCount: 1
    })
    const serialized = JSON.stringify(inventory)
    expect(serialized).not.toContain('/synthetic/')
    expect(serialized).not.toContain('private.invalid')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('private user prompt')
    expect(serialized).not.toContain('toolSchema')
    expect(serialized).not.toContain('private-marketplace-name')
  })
})

describe('IntegrationsSettings', () => {
  it('renders an explicit read-only integrations surface', () => {
    const html = renderToStaticMarkup(
      createElement(IntegrationsSettings, {
        backend: { state: 'ready', mode: 'direct' },
        cwd: '/synthetic/workspace'
      })
    )

    expect(html).toContain('Integrations')
    expect(html).toContain('Apps')
    expect(html).toContain('Plugins')
    expect(html).toContain('Reload MCP')
    expect(html).toContain('This view is read-only')
    expect(html).not.toContain('Install')
    expect(html).not.toContain('Authorize')
  })
})

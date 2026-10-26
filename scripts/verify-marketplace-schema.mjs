import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const binary = process.env.CODEX_MARKETPLACE_SCHEMA_BINARY || 'codex'
const { stdout: version } = await execFileAsync(binary, ['--version'])
const temporary = await mkdtemp(join(tmpdir(), 'codex-marketplace-schema-'))
try {
  await execFileAsync(binary, ['app-server', 'generate-json-schema', '--experimental', '--out', temporary])
  const readSchema = async (name) => JSON.parse(await readFile(join(temporary, 'v2', `${name}.json`), 'utf8'))
  const [read, install, uninstall, add, installed, detail] = await Promise.all([
    readSchema('PluginReadParams'), readSchema('PluginInstallParams'), readSchema('PluginUninstallParams'),
    readSchema('MarketplaceAddParams'), readSchema('PluginInstallResponse'), readSchema('PluginReadResponse')
  ])
  for (const schema of [read, install]) {
    assert.deepEqual(schema.required, ['pluginName'])
    assert.equal(schema.properties.pluginName.type, 'string')
    assert.ok(schema.properties.marketplacePath)
    assert.deepEqual(schema.properties.remoteMarketplaceName.type, ['string', 'null'])
  }
  assert.deepEqual(install.properties.installAttemptId.type, ['string', 'null'])
  assert.deepEqual(uninstall.required, ['pluginId'])
  assert.equal(uninstall.properties.pluginId.type, 'string')
  assert.deepEqual(add.required, ['source'])
  assert.equal(add.properties.source.type, 'string')
  assert.deepEqual(add.properties.refName.type, ['string', 'null'])
  assert.deepEqual(add.properties.sparsePaths.type, ['array', 'null'])
  assert.equal(add.properties.sparsePaths.items.type, 'string')
  assert.ok(installed.required.includes('appsNeedingAuth'))
  assert.equal(installed.properties.appsNeedingAuth.type, 'array')
  const pluginDetail = detail.definitions.PluginDetail
  for (const key of ['summary', 'skills', 'apps', 'mcpServers', 'hooks']) assert.ok(pluginDetail.required.includes(key))
  assert.equal(detail.definitions.PluginSummary.properties.remotePluginId.type[0], 'string')
  assert.ok(detail.definitions.PluginMarketplaceEntry === undefined || detail.definitions.PluginMarketplaceEntry.properties.path)
  process.stdout.write(`${JSON.stringify({ success: true, binaryVersion: version.trim(), methods: ['plugin/read', 'plugin/install', 'plugin/uninstall', 'marketplace/add'], checkedResponses: ['PluginInstallResponse', 'PluginReadResponse'], note: 'Schema generation only; no plugin installation, removal, or configuration mutation.' }, null, 2)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

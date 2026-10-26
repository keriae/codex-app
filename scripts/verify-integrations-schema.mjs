import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const codexBinary = process.env.CODEX_INTEGRATIONS_SCHEMA_BINARY || 'codex'
const expectedVersion = process.env.CODEX_INTEGRATIONS_SCHEMA_VERSION || 'codex-cli 0.164.0'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function requestForMethod(protocol, method) {
  return protocol.definitions.ClientRequest.oneOf.find(
    (request) => request?.properties?.method?.enum?.[0] === method
  )
}

const { stdout: versionOutput } = await execFileAsync(codexBinary, ['--version'])
assert.equal(versionOutput.trim(), expectedVersion, `Expected ${expectedVersion}`)

const outputDirectory = await mkdtemp(join(tmpdir(), 'codex-integrations-schema-'))
try {
  await execFileAsync(codexBinary, [
    'app-server',
    'generate-json-schema',
    '--experimental',
    '--out',
    outputDirectory
  ])

  const [
    protocol,
    skillsParams,
    skillsResponse,
    skillsWriteParams,
    mcpParams,
    mcpResponse,
    appsListParams,
    appsListResponse,
    appsInstalledParams,
    appsInstalledResponse,
    pluginListParams,
    pluginListResponse
  ] = await Promise.all([
    readJson(join(outputDirectory, 'codex_app_server_protocol.v2.schemas.json')),
    readJson(join(outputDirectory, 'v2', 'SkillsListParams.json')),
    readJson(join(outputDirectory, 'v2', 'SkillsListResponse.json')),
    readJson(join(outputDirectory, 'v2', 'SkillsConfigWriteParams.json')),
    readJson(join(outputDirectory, 'v2', 'ListMcpServerStatusParams.json')),
    readJson(join(outputDirectory, 'v2', 'ListMcpServerStatusResponse.json')),
    readJson(join(outputDirectory, 'v2', 'AppsListParams.json')),
    readJson(join(outputDirectory, 'v2', 'AppsListResponse.json')),
    readJson(join(outputDirectory, 'v2', 'AppsInstalledParams.json')),
    readJson(join(outputDirectory, 'v2', 'AppsInstalledResponse.json')),
    readJson(join(outputDirectory, 'v2', 'PluginListParams.json')),
    readJson(join(outputDirectory, 'v2', 'PluginListResponse.json'))
  ])

  assert.equal(skillsParams.properties.cwds.items.type, 'string')
  assert.equal(skillsParams.properties.forceReload.type, 'boolean')
  assert.deepEqual(skillsResponse.required, ['data'])
  assert.deepEqual(skillsResponse.definitions.SkillScope.enum, [
    'user',
    'repo',
    'system',
    'admin'
  ])
  assert.deepEqual(skillsResponse.definitions.SkillMetadata.required, [
    'description',
    'enabled',
    'name',
    'path',
    'scope'
  ])
  assert.deepEqual(skillsResponse.definitions.SkillErrorInfo.required, ['message', 'path'])
  assert.deepEqual(skillsResponse.definitions.SkillToolDependency.required, ['type', 'value'])

  assert.deepEqual(skillsWriteParams.required, ['enabled'])
  assert.equal(skillsWriteParams.properties.enabled.type, 'boolean')
  assert.ok(skillsWriteParams.properties.name)
  assert.ok(skillsWriteParams.properties.path)

  assert.deepEqual(mcpParams.definitions.McpServerStatusDetail.enum, [
    'full',
    'toolsAndAuthOnly'
  ])
  assert.deepEqual(mcpResponse.required, ['data'])
  assert.deepEqual(mcpResponse.definitions.McpAuthStatus.enum, [
    'unknown',
    'unsupported',
    'notLoggedIn',
    'bearerToken',
    'oAuth'
  ])
  assert.deepEqual(mcpResponse.definitions.McpServerConnectionStatus.enum, [
    'notStarted',
    'starting',
    'connected',
    'authenticationRequired',
    'failed',
    'cancelled',
    'disabled'
  ])

  assert.deepEqual(Object.keys(appsListParams.properties).sort(), [
    'cursor',
    'forceRefetch',
    'limit',
    'threadId'
  ])
  assert.deepEqual(appsListParams.properties.cursor.type, ['string', 'null'])
  assert.equal(appsListParams.properties.forceRefetch.type, 'boolean')
  assert.equal(appsListParams.properties.limit.format, 'uint32')
  assert.equal(appsListParams.properties.limit.minimum, 0)
  assert.deepEqual(appsListParams.properties.threadId.type, ['string', 'null'])
  assert.deepEqual(appsListResponse.required, ['data'])
  assert.deepEqual(appsListResponse.definitions.AppInfo.required, ['id', 'name'])
  assert.equal(appsListResponse.definitions.AppInfo.properties.isAccessible.default, false)
  assert.equal(appsListResponse.definitions.AppInfo.properties.isEnabled.default, true)
  assert.ok(appsListResponse.definitions.AppMetadata.properties.version)

  assert.deepEqual(Object.keys(appsInstalledParams.properties).sort(), [
    'forceRefresh',
    'threadId'
  ])
  assert.equal(appsInstalledParams.properties.forceRefresh.type, 'boolean')
  assert.deepEqual(appsInstalledResponse.required, ['apps'])
  assert.deepEqual(appsInstalledResponse.definitions.InstalledApp.required, [
    'callable',
    'enabled',
    'id'
  ])

  assert.deepEqual(Object.keys(pluginListParams.properties).sort(), [
    'cwds',
    'forceRefetch',
    'marketplaceKinds'
  ])
  assert.deepEqual(pluginListParams.definitions.PluginListMarketplaceKind.enum, [
    'local',
    'vertical',
    'workspace-directory',
    'shared-with-me',
    'created-by-me-remote'
  ])
  assert.deepEqual(pluginListResponse.required, ['marketplaces'])
  assert.deepEqual(pluginListResponse.definitions.PluginSummary.required, [
    'authPolicy',
    'enabled',
    'id',
    'installPolicy',
    'installed',
    'name',
    'source'
  ])
  assert.deepEqual(pluginListResponse.definitions.PluginInstallPolicy.enum, [
    'NOT_AVAILABLE',
    'AVAILABLE',
    'INSTALLED_BY_DEFAULT'
  ])
  assert.deepEqual(
    pluginListResponse.definitions.PluginSource.oneOf.map((source) => source.title),
    ['LocalPluginSource', 'GitPluginSource', 'NpmPluginSource', 'RemotePluginSource']
  )

  const skillsRequest = requestForMethod(protocol, 'skills/list')
  const mcpListRequest = requestForMethod(protocol, 'mcpServerStatus/list')
  const mcpReloadRequest = requestForMethod(protocol, 'config/mcpServer/reload')
  const skillsWriteRequest = requestForMethod(protocol, 'skills/config/write')
  const appsListRequest = requestForMethod(protocol, 'app/list')
  const appsInstalledRequest = requestForMethod(protocol, 'app/installed')
  const pluginListRequest = requestForMethod(protocol, 'plugin/list')
  const pluginInstallRequest = requestForMethod(protocol, 'plugin/install')
  const pluginUninstallRequest = requestForMethod(protocol, 'plugin/uninstall')
  assert.equal(skillsRequest.properties.params.$ref, '#/definitions/SkillsListParams')
  assert.equal(mcpListRequest.properties.params.$ref, '#/definitions/ListMcpServerStatusParams')
  assert.equal(mcpReloadRequest.properties.params.type, 'null')
  assert.deepEqual(mcpReloadRequest.required, ['id', 'method'])
  assert.equal(skillsWriteRequest.properties.params.$ref, '#/definitions/SkillsConfigWriteParams')
  assert.equal(appsListRequest.properties.params.$ref, '#/definitions/AppsListParams')
  assert.equal(appsInstalledRequest.properties.params.$ref, '#/definitions/AppsInstalledParams')
  assert.equal(pluginListRequest.properties.params.$ref, '#/definitions/PluginListParams')
  assert.equal(pluginInstallRequest.properties.params.$ref, '#/definitions/PluginInstallParams')
  assert.equal(pluginUninstallRequest.properties.params.$ref, '#/definitions/PluginUninstallParams')
  assert.equal(requestForMethod(protocol, 'app/installed/list'), undefined)
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

console.log(
  `${expectedVersion} experimental integrations schema verified; app/list, app/installed, and plugin/list are read-only while mutation methods remain intentionally unexposed.`
)

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binary = process.env.CODEX_IMPORT_SCHEMA_BINARY || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
const temporary = await mkdtemp(join(tmpdir(), 'codex-import-verification-'))
const require = createRequire(import.meta.url)
let client, service
try {
  const runtime = join(temporary, 'runtime.cjs')
  await build({ stdin: { contents: "export { AppServerClient } from './src/main/appServer'; export { ExternalAgentImportService } from './src/main/externalAgentImport'", resolveDir: repository }, outfile: runtime, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const { AppServerClient, ExternalAgentImportService } = require(runtime)
  const home = join(temporary, 'home'), serverHome = join(home, '.codex'), project = join(temporary, 'project'), profile = join(temporary, 'replica-profile'), claude = join(home, 'Library/Application Support/Claude')
  await Promise.all([mkdir(serverHome, { recursive: true }), mkdir(project, { recursive: true }), mkdir(join(home, '.claude'), { recursive: true })])
  await writeFile(join(home, '.claude/CLAUDE.md'), 'Fixture global Claude instructions.\n')
  await writeFile(join(project, 'CLAUDE.md'), 'Fixture project Claude instructions.\n')
  client = new AppServerClient({ resolveBinary: () => binary, resolveServerEndpoint: () => null, preferManagedDaemon: false, shutdownGraceMs: 50,
    spawnProcess: (command, args, options) => spawn(command, args, { ...options, env: { ...options.env, HOME: home, CODEX_HOME: serverHome, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share') } }) })
  service = new ExternalAgentImportService({ server: client, profileDirectory: profile, homeDirectory: home, codexHome: serverHome, coworkUserDataDirectory: claude, timeoutMs: 15_000 })
  const detected = await service.detect({ hostId: 'local', providers: ['claude-code', 'cursor'], includeHome: false, workspaceRoots: [project] })
  assert.equal(detected.providers.find(provider => provider.providerId === 'claude-code').status, 'available')
  const instruction = detected.items.find(item => item.providerId === 'claude-code' && item.itemType === 'AGENTS_MD' && item.cwd === project)
  assert.ok(instruction, 'CLI detected the fixture project CLAUDE.md')
  const imported = await service.import({ hostId: 'local', importAttemptId: 'fixture-native', items: [instruction] })
  assert.equal(imported.itemTypeResults.flatMap(result => result.failures).length, 0)
  const agents = await readFile(join(project, 'AGENTS.md'), 'utf8')
  assert.ok(agents.includes('Fixture project Codex instructions.'), 'Native migration adapts the fixture Claude instructions')
  assert.equal(imported.importedProjectIds.length, 1)

  const account = join(claude, 'local-agent-mode-sessions/fixture-user/fixture-org'), storage = join(account, 'session-a')
  await mkdir(storage, { recursive: true })
  await writeFile(join(account, 'spaces.json'), JSON.stringify({ spaces: [{ id: 'space-a', name: 'Fixture Cowork', folders: [project], instructions: 'Cowork fixture instructions.' }] }))
  await writeFile(join(account, 'session-a.json'), JSON.stringify({ sessionId: 'session-a', spaceId: 'space-a', title: 'Cowork fixture transcript', createdAt: Date.now() }))
  await mkdir(join(storage, 'outputs'), { recursive: true })
  await writeFile(join(storage, 'outputs/fixture-output.txt'), 'Fixture generated deliverable.\n')
  await mkdir(join(account, 'session-b'), { recursive: true })
  await writeFile(join(account, 'session-b.json'), JSON.stringify({ sessionId: 'session-b', title: 'Independent Cowork fixture', createdAt: Date.now() }))
  await writeFile(join(account, 'session-b/audit.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'Independent historical question' } })}\n${JSON.stringify({ type: 'assistant', message: { content: 'Independent historical answer' } })}\n`)
  await mkdir(join(account, 'skills'), { recursive: true })
  await writeFile(join(account, 'skills/fixture-skill.md'), 'Fixture migrated skill instructions.\n')
  await writeFile(join(account, 'skills.json'), JSON.stringify({ skills: [{ name: 'Fixture Skill', path: 'fixture-skill.md' }] }))
  await mkdir(join(account, 'agents'), { recursive: true })
  await writeFile(join(account, 'agents/fixture-agent.md'), 'Fixture migrated agent instructions.\n')
  await writeFile(join(account, 'mcp.json'), JSON.stringify({ mcpServers: { 'fixture.disabled': { command: '/usr/bin/false', disabled: true }, 'fixture.imported': { command: '/usr/bin/false', args: [], enabled: true } } }))
  const pluginRoot = join(account, '.local-plugins/fixture-plugin')
  await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true }); await mkdir(join(pluginRoot, 'skills/fixture-plugin-skill'), { recursive: true })
  await writeFile(join(pluginRoot, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'fixture-plugin', version: '1.0.0' }))
  await writeFile(join(pluginRoot, 'skills/fixture-plugin-skill/SKILL.md'), '---\nname: fixture-plugin-skill\ndescription: Fixture plugin skill\n---\nFixture content.\n')
  await writeFile(join(storage, 'audit.jsonl'), [
    { type: 'user', timestamp: new Date().toISOString(), message: { content: 'Fixture historical question' } },
    { type: 'assistant', timestamp: new Date().toISOString(), message: { content: 'Fixture historical answer' } }
  ].map(message => JSON.stringify(message)).join('\n') + '\n')
  const coworkDetection = await service.detect({ hostId: 'local', providers: ['claude-cowork'], includeHome: true })
  assert.ok(coworkDetection.items.some(item => item.itemType === 'SESSIONS'))
  const coworkImported = await service.import({ hostId: 'local', importAttemptId: 'fixture-cowork', items: coworkDetection.items })
  assert.deepEqual(coworkImported.itemTypeResults.flatMap(result => result.failures), [])
  assert.equal(coworkImported.importedSessionThreadIds.length, 2)
  const projectThread = coworkImported.itemTypeResults.flatMap(result => result.successes).find(success => success.title === 'Cowork fixture transcript')
  const independentThread = coworkImported.itemTypeResults.flatMap(result => result.successes).find(success => success.title === 'Independent Cowork fixture')
  const threadId = projectThread.target
  const thread = await client.request('thread/read', { threadId, includeTurns: false })
  assert.equal(thread.thread.projectId, imported.importedProjectIds[0])
  assert.equal(thread.thread.name, 'Cowork fixture transcript')
  const independent = await client.request('thread/read', { threadId: independentThread.target, includeTurns: false })
  assert.equal(independent.thread.projectId, null)
  const replicaState = JSON.parse(await readFile(join(profile, 'external-agent-import.json'), 'utf8'))
  assert.ok(replicaState.projectlessThreads[independent.thread.id].outputDirectory.includes('Documents/Codex'))
  assert.ok((await readFile(join(serverHome, 'skills/fixture-skill/SKILL.md'), 'utf8')).includes('Fixture migrated skill instructions.'))
  assert.ok((await readFile(join(serverHome, 'agents/fixture-agent.toml'), 'utf8')).includes('Fixture migrated agent instructions.'))
  assert.ok((await readFile(join(serverHome, 'config.toml'), 'utf8')).includes('fixture.imported'))
  assert.ok((await readFile(join(serverHome, 'plugins/cache/claude-cowork/fixture-plugin/1.0.0/.codex-plugin/plugin.json'), 'utf8')).includes('fixture-plugin'))
  const inventory = await client.request('plugin/list', { cwds: [project], marketplaceKinds: ['local'], forceRefetch: false })
  const importedPlugin = inventory.marketplaces.find(marketplace => marketplace.name === 'claude-cowork')?.plugins.find(plugin => plugin.name === 'fixture-plugin')
  assert.ok(importedPlugin?.installed && importedPlugin?.enabled, 'Imported Cowork plugin is installed and enabled in native inventory')
  assert.equal(await readFile(join(serverHome, 'claude-cowork-generated-files/session-a/fixture-output.txt'), 'utf8'), 'Fixture generated deliverable.\n')
  const turns = await client.request('thread/turns/list', { threadId })
  assert.ok(turns.data.length > 0, 'Converted Cowork history is durably readable')
  const histories = await service.readHistory({ hostId: 'local' })
  assert.ok(histories.data.some(history => history.providerId === 'claude-cowork'))
  assert.ok(histories.data.some(history => history.providerId === 'claude-code'))
  const cursorTranscript = join(home, '.cursor/projects/empty-window/agent-transcripts/cursor-fixture/cursor-fixture.jsonl')
  await mkdir(dirname(cursorTranscript), { recursive: true })
  await writeFile(cursorTranscript, `${JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: '<user_query>Cursor independent fixture question</user_query>' }] } })}\n${JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'Cursor independent fixture answer' }] } })}\n`)
  const cursorDetection = await service.detect({ hostId: 'local', includeHome: true, providers: ['cursor'] })
  const cursorItem = cursorDetection.items.find(item => item.itemType === 'SESSIONS')
  assert.ok(cursorItem?.details.sessions.some(session => session.path === cursorTranscript && session.workspaceKind === 'projectless'))
  const cursorImported = await service.import({ hostId: 'local', importAttemptId: 'fixture-cursor', items: [cursorItem] })
  assert.deepEqual(cursorImported.itemTypeResults.flatMap(result => result.failures), [])
  assert.equal(cursorImported.importedSessionThreadIds.length, 1)
  assert.deepEqual(cursorImported.importedProjectIds, [])
  const cursorThread = await client.request('thread/read', { threadId: cursorImported.importedSessionThreadIds[0], includeTurns: false })
  assert.equal(cursorThread.thread.projectId, null)
  const cursorState = JSON.parse(await readFile(join(profile, 'external-agent-import.json'), 'utf8'))
  assert.equal(await realpath(cursorThread.thread.cwd), await realpath(cursorState.projectlessThreads[cursorThread.thread.id].cwd))
  const status = await service.readStatus({ hostId: 'local' })
  assert.equal(status.importedSessionCount, 3)
  const output = { success: true, binary, sourceHome: 'isolated temporary fixture', native: { detectedTypes: detected.items.map(item => item.itemType), importedProjectCount: imported.importedProjectIds.length }, cowork: { importedSessionCount: coworkImported.importedSessionThreadIds.length, persistedTurnCount: turns.data.length, canonicalProjectAssignment: true, projectlessOutputAssociation: true, markdownSkillAndAgent: true, mcpConfiguration: true, pluginMarketplace: true, pluginInstalledAndEnabled: true, generatedFileCopy: true, historyRecorded: true }, cursor: { projectlessSessionImport: true, persistentThreadCount: cursorImported.importedSessionThreadIds.length, serverCwdMatchesIndependentPaths: true, noProjectCreated: true }, status, note: 'No real user configuration/history was read or imported; no model turn was started. Fixture MCP runs /usr/bin/false in its isolated profile.' }
  await mkdir(join(repository, 'reverse/raw/checks'), { recursive: true })
  await writeFile(join(repository, 'reverse/raw/checks/external-agent-import-current.json'), `${JSON.stringify(output, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
} finally {
  await service?.dispose(); await client?.stop(); await rm(temporary, { force: true, recursive: true })
}

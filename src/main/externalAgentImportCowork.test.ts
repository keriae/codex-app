import { lstat, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalAgentMigrationDetails, ExternalAgentMigrationItem, JsonMap } from '../shared/api'
import type { ExternalAgentServer, ProjectlessImportPaths } from './externalAgentImport'
import { CoworkImportAdapter } from './externalAgentImportCowork'

const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { force: true, recursive: true })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const details = (): ExternalAgentMigrationDetails => ({ commands: [], hooks: [], mcpServers: [], plugins: [], skills: [], subagents: [], memory: [], sessions: [] })
const exists = (path: string) => lstat(path).then(() => true).catch(() => false)

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-cowork-lifecycle-test-'))
  temporaryDirectories.push(directory)
  const codexHome = join(directory, 'server-home')
  const userDataDirectory = join(directory, 'claude')
  const account = join(userDataDirectory, 'local-agent-mode-sessions/user/org')
  const server = { request: vi.fn<(method: string, params?: JsonMap) => Promise<unknown>>().mockResolvedValue({}) }
  const paths = { cwd: join(directory, 'independent/work'), workspaceRoot: join(directory, 'independent'), outputDirectory: join(directory, 'independent/outputs') }
  const createProjectlessPaths = vi.fn<(title: string | null) => Promise<ProjectlessImportPaths>>().mockResolvedValue(paths)
  const recordProjectlessThread = vi.fn<(threadId: string, paths: ProjectlessImportPaths) => Promise<void>>().mockResolvedValue(undefined)
  let disposed = false
  const adapter = new CoworkImportAdapter({
    server: server as unknown as ExternalAgentServer,
    homeDirectory: join(directory, 'home'),
    codexHome,
    userDataDirectory,
    createProjectlessPaths,
    recordProjectlessThread,
    isDisposed: () => disposed
  })
  return { directory, codexHome, account, server, adapter, paths, createProjectlessPaths, recordProjectlessThread, dispose: () => { disposed = true } }
}

async function detectedSession(adapter: CoworkImportAdapter, account: string): Promise<ExternalAgentMigrationItem> {
  await mkdir(join(account, 'session-a'), { recursive: true })
  await writeFile(join(account, 'session-a.json'), JSON.stringify({ sessionId: 'a', title: 'Fixture session', createdAt: Date.now() }))
  await writeFile(join(account, 'session-a/audit.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'Fixture question' }, timestamp: new Date().toISOString() })}\n`)
  const detected = await adapter.detect({ hostId: 'local', providers: ['claude-cowork'], includeHome: true })
  const sessions = detected.items.find(item => item.itemType === 'SESSIONS')
  if (!sessions) throw new Error('Isolated Cowork transcript fixture was not detected')
  return sessions
}

describe('Cowork import lifecycle', () => {
  it('does not write configuration or skills when stopped while config/read is pending', async () => {
    const { adapter, server, account, codexHome, recordProjectlessThread } = await fixture()
    await mkdir(join(account, 'skills'), { recursive: true })
    await writeFile(join(account, 'skills/fixture.md'), 'Fixture skill instructions')
    await writeFile(join(account, 'cowork_settings.json'), JSON.stringify({ model: 'claude-sonnet-fixture' }))
    await writeFile(join(account, 'mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'fixture-command' } } }))
    const read = deferred<{ config: JsonMap }>(), reachedRead = deferred<void>()
    server.request.mockImplementation(async method => {
      if (method === 'config/read') { reachedRead.resolve(undefined); return read.promise }
      return {}
    })
    let stopped = false
    const pending = adapter.import([{ providerId: 'claude-cowork', itemType: 'CONFIG', cwd: null, sourcePath: account, description: 'Fixture config', details: details() }], () => stopped)
    await reachedRead.promise
    stopped = true
    read.resolve({ config: {} })
    const result = await pending
    expect(server.request.mock.calls.map(([method]) => method)).toEqual(['config/read'])
    expect(result.importedSessionThreadIds).toEqual([])
    expect(recordProjectlessThread).not.toHaveBeenCalled()
    expect(await exists(codexHome)).toBe(false)
  })

  it('does not create a thread when stopped while projectless paths are pending', async () => {
    const { adapter, server, account, codexHome, paths, createProjectlessPaths, recordProjectlessThread } = await fixture()
    const sessions = await detectedSession(adapter, account)
    const preparedPaths = deferred<ProjectlessImportPaths>(), reachedPaths = deferred<void>()
    createProjectlessPaths.mockImplementation(async () => { reachedPaths.resolve(undefined); return preparedPaths.promise })
    let stopped = false
    const pending = adapter.import([sessions], () => stopped)
    await reachedPaths.promise
    stopped = true
    preparedPaths.resolve(paths)
    const result = await pending
    expect(server.request).not.toHaveBeenCalled()
    expect(recordProjectlessThread).not.toHaveBeenCalled()
    expect(result.importedSessionThreadIds).toEqual([])
    expect(await exists(codexHome)).toBe(false)
  })

  it('preserves an already created thread after disposal without later profile or history writes', async () => {
    const { adapter, server, account, codexHome, dispose, recordProjectlessThread } = await fixture()
    const sessions = await detectedSession(adapter, account)
    const fork = deferred<{ thread: { id: string } }>(), reachedFork = deferred<void>()
    server.request.mockImplementation(async method => {
      if (method === 'thread/fork') { reachedFork.resolve(undefined); return fork.promise }
      return {}
    })
    let stopped = false
    const pending = adapter.import([sessions], () => stopped)
    await reachedFork.promise
    dispose()
    stopped = true
    fork.resolve({ thread: { id: 'created-before-dispose' } })
    const result = await pending
    expect(result.importedSessionThreadIds).toEqual(['created-before-dispose'])
    expect(result.itemTypeResults.flatMap(item => item.successes)).toContainEqual(expect.objectContaining({ itemType: 'SESSIONS', target: 'created-before-dispose' }))
    expect(server.request.mock.calls.map(([method]) => method)).toEqual(['thread/fork'])
    expect(recordProjectlessThread).not.toHaveBeenCalled()
    expect(await exists(join(codexHome, 'claude-cowork-import-history.json'))).toBe(false)
  })
})

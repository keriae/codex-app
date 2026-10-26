import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImportCompletionWaiter, cursorProjectlessSource, emptyMigrationDetails, ExternalAgentImportService, type ExternalAgentServer } from './externalAgentImport'
import type { ProjectlessImportPaths } from './externalAgentImport'
import { coworkRollout, readCoworkTranscript } from './externalAgentImportCowork'
import { isExternalAgentDetectOptions, isExternalAgentImportOptions, isExternalAgentReadOptions, isExternalAgentSyncOptions } from './ipcSecurity'
import type { ExternalAgentImportOptions, ExternalAgentMigrationItem, ExternalAgentImportTypeResult, JsonMap } from '../shared/api'

class Server extends EventEmitter {
  request = vi.fn<(method: string, params?: JsonMap) => Promise<unknown>>()
  override on(event: 'notification', listener: (...args: any[]) => void): this { return super.on(event, listener) }
  override removeListener(event: 'notification', listener: (...args: any[]) => void): this { return super.removeListener(event, listener) }
}
const directories: string[] = [], services: ExternalAgentImportService[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.dispose(); for (const path of directories.splice(0)) await rm(path, { force: true, recursive: true }); vi.useRealTimers() })
async function fixture(server = new Server(), timeoutMs?: number) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-external-import-test-')); directories.push(directory)
  const service = new ExternalAgentImportService({ server: server as unknown as ExternalAgentServer, profileDirectory: join(directory, 'profile'), homeDirectory: join(directory, 'home'), codexHome: join(directory, 'server-home'), coworkUserDataDirectory: join(directory, 'claude'), timeoutMs })
  services.push(service); await service.getPreferences()
  return { directory, service, server }
}
function item(type: ExternalAgentMigrationItem['itemType'] = 'AGENTS_MD', cwd = '/fixture/project', providerId: ExternalAgentMigrationItem['providerId'] = 'claude-code'): ExternalAgentMigrationItem { return { cwd, description: 'fixture import', details: null, itemType: type, providerId } }
function opts(items: ExternalAgentMigrationItem[]): ExternalAgentImportOptions { return { hostId: 'local', importAttemptId: 'fixture-attempt', items } }
function done(server: Server, importId: string, itemTypeResults: ExternalAgentImportTypeResult[]): void { server.emit('notification', { method: 'externalAgentConfig/import/completed', params: { importId, itemTypeResults } }) }

describe('external agent completion ownership', () => {
  it('buffers completion before RPC response and ignores unrelated IDs and malformed notifications', async () => {
    const server = new Server(), waiter = createImportCompletionWaiter(server as unknown as ExternalAgentServer)
    done(server, 'unrelated', []); done(server, 'wanted', [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG' }], failures: [] }])
    server.emit('notification', { method: 'externalAgentConfig/import/completed', params: { importId: 'wanted' } })
    expect((await waiter.waitFor('wanted')).itemTypeResults[0].itemType).toBe('CONFIG')
    expect(server.listenerCount('notification')).toBe(0)
  })
  it('replays matching early progress and rejects timeout with uncertain-server wording', async () => {
    vi.useFakeTimers()
    const server = new Server(), progress = vi.fn(), waiter = createImportCompletionWaiter(server as unknown as ExternalAgentServer, 25, progress)
    server.emit('notification', { method: 'externalAgentConfig/import/progress', params: { importId: 'wanted', itemTypeResults: [] } })
    const promise = waiter.waitFor('wanted'); const rejected = expect(promise).rejects.toThrow('server may still be importing')
    await vi.advanceTimersByTimeAsync(25); await rejected
    expect(progress).toHaveBeenCalledOnce(); expect(server.listenerCount('notification')).toBe(0)
  })
  it('cancel rejects pending waiter and releases its listener', async () => {
    const server = new Server(), waiter = createImportCompletionWaiter(server as unknown as ExternalAgentServer), promise = waiter.waitFor('wanted')
    waiter.cancel(); await expect(promise).rejects.toThrow('canceled'); expect(server.listenerCount('notification')).toBe(0)
  })
})

describe('external agent source-edition service', () => {
  it('stops before native submission when canceled during Cursor directory preparation', async () => {
    const { directory, server, service } = await fixture()
    let release!: (paths: ProjectlessImportPaths) => void
    const preparing = vi.spyOn(service as unknown as { createProjectlessPaths(title: string | null): Promise<ProjectlessImportPaths> }, 'createProjectlessPaths').mockImplementation(() => new Promise(resolve => { release = resolve }))
    const d = emptyMigrationDetails(); d.sessions = [{ cwd: directory, path: join(directory, 'projects/empty-window/agent-transcripts/fixture.jsonl'), title: 'Fixture', workspaceKind: 'projectless' }]
    const pending = service.import(opts([{ ...item('SESSIONS', '', 'cursor'), details: d }]))
    await vi.waitFor(() => expect(preparing).toHaveBeenCalledOnce())
    expect(service.cancel('fixture-attempt')).toEqual({ stopRequested: true, inFlight: false })
    release({ cwd: directory, workspaceRoot: directory, outputDirectory: directory })
    expect(await pending).toMatchObject({ canceled: true, importedSessionThreadIds: [], importedProjectIds: [] })
    expect(server.request).not.toHaveBeenCalled()
  })
  it('disposes an active completion waiter and prevents late finalization or profile writes', async () => {
    const { directory, server, service } = await fixture()
    server.request.mockImplementation(async method => method === 'externalAgentConfig/import' ? { importId: 'disposed-id' } : { data: [], connectors: [] })
    const pending = service.import(opts([item()]))
    const rejected = expect(pending).rejects.toThrow('outcome remains unknown')
    await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith('externalAgentConfig/import', expect.anything()))
    await service.dispose()
    expect(server.listenerCount('notification')).toBe(0)
    done(server, 'disposed-id', [{ itemType: 'AGENTS_MD', successes: [{ itemType: 'AGENTS_MD', cwd: directory }], failures: [] }])
    await rejected
    expect(server.request.mock.calls.map(([method]) => method)).toEqual(['externalAgentConfig/import'])
    await expect(readFile(join(directory, 'profile/external-agent-import.json'))).rejects.toThrow()
    await expect(service.import({ ...opts([]), importAttemptId: 'retry' })).rejects.toThrow('must not be retried blindly')
  })
  it('does not create a project when disposal occurs during the finalization catalog read', async () => {
    const { directory, server, service } = await fixture()
    let releaseCatalog!: (value: unknown) => void
    server.request.mockImplementation(async method => {
      if (method === 'externalAgentConfig/import') { done(server, 'acknowledged', [{ itemType: 'AGENTS_MD', successes: [{ itemType: 'AGENTS_MD', cwd: directory }], failures: [] }]); return { importId: 'acknowledged' } }
      if (method === 'project/list') return new Promise(resolve => { releaseCatalog = resolve })
      return {}
    })
    const pending = service.import(opts([item()]))
    const rejected = expect(pending).rejects.toThrow('must not be retried blindly')
    await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith('project/list', expect.anything()))
    await service.dispose(); releaseCatalog({ data: [] }); await rejected
    expect(server.request.mock.calls.map(([method]) => method)).toEqual(['externalAgentConfig/import', 'project/list'])
    await expect(readFile(join(directory, 'profile/external-agent-import.json'))).rejects.toThrow()
  })
  it('retains a timed-out server operation until late completion and prevents duplicate submissions', async () => {
    const { server, service } = await fixture(new Server(), 10)
    server.request.mockImplementation(async method => method === 'externalAgentConfig/import' ? { importId: 'late-id' } : { data: [], connectors: [] })
    await expect(service.import(opts([item('CONFIG', '')]))).rejects.toThrow('server may still be importing')
    expect((await service.readStatus({ hostId: 'local' })).runningImport?.progress.importId).toBe('late-id')
    await expect(service.import({ ...opts([]), importAttemptId: 'second' })).rejects.toThrow('still running')
    done(server, 'late-id', [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG' }], failures: [] }])
    await vi.waitFor(async () => expect((await service.readStatus({ hostId: 'local' })).runningImport).toBeUndefined())
    expect(server.request.mock.calls.filter(([method]) => method === 'externalAgentConfig/import')).toHaveLength(1)
  })
  it('reconciles an exact timed-out importId from persisted history when its notification was lost', async () => {
    const { server, service } = await fixture(new Server(), 10)
    server.request.mockImplementation(async method => method === 'externalAgentConfig/import' ? { importId: 'lost-id' } : { data: [{ importId: 'lost-id', providerId: 'claude-code', completedAtMs: 123, successes: [{ itemType: 'CONFIG', target: null }], failures: [] }], connectors: [] })
    await expect(service.import(opts([item('CONFIG', '')]))).rejects.toThrow('server may still be importing')
    const progress = vi.fn(); service.on('progress', progress)
    expect((await service.readStatus({ hostId: 'local' })).runningImport).toBeUndefined()
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'completed', result: expect.objectContaining({ canceled: true }) }))
  })
  it('retains delivery ambiguity instead of claiming a dispatched import failed', async () => {
    const { server, service } = await fixture()
    const error = Object.assign(new Error('[outcome-unknown] connection lost'), { method: 'externalAgentConfig/import', stage: 'outcome-unknown' })
    server.request.mockImplementation(async method => { if (method === 'externalAgentConfig/import') throw error; return { data: [], connectors: [] } })
    await expect(service.import(opts([item('CONFIG', '')]))).rejects.toThrow('outcome-unknown')
    expect((await service.readStatus({ hostId: 'local' })).runningImport?.progress.phase).toBe('stopping')
    await expect(service.import({ ...opts([]), importAttemptId: 'second' })).rejects.toThrow('still running')
  })
  it('enables source customization only after a real successful import and preserves explicit category choices', async () => {
    const { server, service } = await fixture()
    expect((await service.getPreferences()).providers).toEqual([])
    await service.setSync({ syncEnabled: false, syncItemTypes: { CONFIG: true } })
    server.request.mockImplementation(async method => {
      if (method === 'externalAgentConfig/import') { done(server, 'id', [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG' }], failures: [] }]); return { importId: 'id' } }
      return {}
    })
    await service.import(opts([item('CONFIG', '', 'cursor')]))
    expect(await service.getPreferences()).toMatchObject({ providers: ['cursor'], syncItemTypes: { CONFIG: true } })
  })
  it('expands newly found roots across both providers even when existing roots were passed', async () => {
    const { server, service } = await fixture()
    server.request.mockImplementation(async (method, params) => {
      if (method === 'externalAgentConfig/detect') return { items: params?.includeHome && !params.migrationSource ? [{ ...item('AGENTS_MD', '/new/project'), providerId: undefined }] : [] }
      return {}
    })
    const result = await service.detect({ hostId: 'local', includeHome: true, providers: ['claude-code', 'cursor'], workspaceRoots: ['/old/project'] })
    expect(result.items).toHaveLength(1); expect(result.providers.every(provider => provider.status === 'available')).toBe(true)
    expect(server.request.mock.calls.filter(([, params]) => params?.includeHome === false)).toEqual([
      ['externalAgentConfig/detect', { includeHome: false, cwds: ['/new/project'] }],
      ['externalAgentConfig/detect', { includeHome: false, cwds: ['/new/project'], migrationSource: 'cursor' }]
    ])
  })
  it('preserves per-provider detection failures instead of reporting an empty installation', async () => {
    const { server, service } = await fixture(); server.request.mockRejectedValue(new Error('detection unavailable'))
    const result = await service.detect({ hostId: 'local', providers: ['claude-code'] })
    expect(result.providers).toEqual([{ providerId: 'claude-code', status: 'error', message: 'detection unavailable' }])
  })
  it('awaits actual in-flight completion after stop and never submits the next provider', async () => {
    const { server, service } = await fixture()
    server.request.mockImplementation(async method => method === 'externalAgentConfig/import' ? { importId: 'import-a' } : method === 'externalAgentConfig/import/readHistories' ? { data: [], connectors: [] } : { data: [] })
    const pending = service.import(opts([item('CONFIG', '', 'claude-code'), item('CONFIG', '', 'cursor')]))
    await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith('externalAgentConfig/import', expect.anything()))
    expect(service.cancel('fixture-attempt')).toEqual({ stopRequested: true, inFlight: true })
    const status = await service.readStatus({ hostId: 'local' }); expect(status.runningImport?.progress.phase).toBe('stopping')
    await expect(service.import({ ...opts([]), importAttemptId: 'second' })).rejects.toThrow('still running')
    done(server, 'import-a', [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG' }], failures: [] }])
    expect((await pending).canceled).toBe(true)
    expect(server.request.mock.calls.filter(([method]) => method === 'externalAgentConfig/import')).toHaveLength(1)
    expect((await service.readStatus({ hostId: 'local' })).runningImport).toBeUndefined()
  })
  it('finalizes canonical project identity and assigns only unassigned imported sessions', async () => {
    const { directory, server, service } = await fixture(), root = join(directory, 'project'), alias = join(directory, 'alias')
    await mkdir(root); await symlink(root, alias)
    const d = emptyMigrationDetails(); d.sessions = [{ cwd: alias, path: join(directory, 'session.jsonl'), title: 'Imported' }]
    server.request.mockImplementation(async method => {
      if (method === 'externalAgentConfig/import') { done(server, 'import-a', [{ itemType: 'SESSIONS', successes: [{ itemType: 'SESSIONS', source: d.sessions[0].path, target: 'thread-a' }], failures: [] }]); return { importId: 'import-a' } }
      if (method === 'project/list') return { data: [{ id: 'existing', roots: [{ path: root }] }] }
      if (method === 'thread/read') return { thread: { projectId: null } }
      return {}
    })
    const result = await service.import(opts([{ ...item('SESSIONS', alias), details: d }]))
    expect(result.importedProjectIds).toEqual(['existing']); expect(server.request).not.toHaveBeenCalledWith('project/create', expect.anything())
    expect(server.request).toHaveBeenCalledWith('thread/metadata/update', { threadId: 'thread-a', projectId: 'existing' })
  })
  it('allocates projectless Cursor paths without creating a project and persists output associations', async () => {
    const { directory, server, service } = await fixture(), path = join(directory, 'projects/empty-window/agent-transcripts/session.txt')
    const d = emptyMigrationDetails(); d.sessions = [{ cwd: directory, path, title: 'Independent', workspaceKind: 'projectless' }]
    server.request.mockImplementation(async (method, params) => {
      if (method === 'externalAgentConfig/import') {
        const cwd = ((params!.migrationItems as { details: typeof d }[])[0].details.sessions[0]).cwd
        done(server, 'cursor-id', [{ itemType: 'SESSIONS', successes: [{ itemType: 'SESSIONS', source: path, target: 'cursor-thread', cwd }], failures: [] }]); return { importId: 'cursor-id' }
      }
      return {}
    })
    const result = await service.import(opts([{ ...item('SESSIONS', '', 'cursor'), details: d }]))
    expect(result.projectRoots).toEqual([]); expect(result.importedProjectIds).toEqual([])
    const profile = JSON.parse(await readFile(join(directory, 'profile/external-agent-import.json'), 'utf8'))
    expect(profile.projectlessThreads['cursor-thread'].cwd).toContain('Documents/Codex/independent-')
    expect(cursorProjectlessSource(path)).toBe('session.txt')
  })
  it('retains failed item results and finalizes successful roots', async () => {
    const { server, service } = await fixture()
    server.request.mockImplementation(async method => {
      if (method === 'externalAgentConfig/import') { done(server, 'id', [{ itemType: 'AGENTS_MD', successes: [{ itemType: 'AGENTS_MD', cwd: '/success' }], failures: [{ itemType: 'AGENTS_MD', cwd: '/failed', message: 'fixture failure', failureStage: 'read' }] }]); return { importId: 'id' } }
      if (method === 'project/list') return { data: [] }
      if (method === 'project/create') return { project: { id: 'created' } }
      return {}
    })
    const result = await service.import(opts([item()]))
    expect(result.projectRoots).toEqual(['/success']); expect(result.itemTypeResults[0].failures).toHaveLength(1)
  })
  it('keeps sync preferences in the replica profile and filters categories', async () => {
    const { directory, server, service } = await fixture()
    server.request.mockImplementation(async (method, params) => {
      if (method === 'externalAgentConfig/detect') return { items: [{ ...item('CONFIG', ''), providerId: undefined }, { ...item('AGENTS_MD'), providerId: undefined }] }
      if (method === 'externalAgentConfig/import') { done(server, 'sync-id', [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG' }], failures: [] }]); return { importId: 'sync-id' } }
      if (method === 'project/list') return { data: [] }
      if (method === 'project/create') return { project: { id: 'created' } }
      void params; return {}
    })
    await service.setSync({ syncEnabled: true, providers: ['claude-code'], syncItemTypes: { CONFIG: true, AGENTS_MD: false } }); await service.runSync()
    expect((server.request.mock.calls.find(([method]) => method === 'externalAgentConfig/import')![1]!.migrationItems as unknown[])).toHaveLength(1)
    expect((await service.getPreferences()).lastSyncAtMs).toBeTypeOf('number')
    expect((JSON.parse(await readFile(join(directory, 'profile/external-agent-import.json'), 'utf8'))).preferences.syncEnabled).toBe(true)
  })
  it('does not submit an import after sync is disabled while detection was pending', async () => {
    const { server, service } = await fixture()
    let resolveDetection!: (value: unknown) => void
    server.request.mockImplementation(async method => method === 'externalAgentConfig/detect' ? new Promise(resolve => { resolveDetection = resolve }) : {})
    await service.setSync({ syncEnabled: true, providers: ['claude-code'], syncItemTypes: 'all' })
    const pending = service.runSync()
    await vi.waitFor(() => expect(server.request).toHaveBeenCalled())
    await service.setSync({ syncEnabled: false })
    resolveDetection({ items: [{ ...item('CONFIG', ''), providerId: undefined }] }); await pending
    expect(server.request.mock.calls.some(([method]) => method === 'externalAgentConfig/import')).toBe(false)
  })
})

describe('Cowork local source formats', () => {
  it('detects local projects, independent sessions and unsupported multi-folder spaces without writes', async () => {
    const { directory, service } = await fixture(), root = join(directory, 'project'), account = join(directory, 'claude/local-agent-mode-sessions/user/org')
    await mkdir(root); await mkdir(join(account, 'session-a'), { recursive: true })
    await writeFile(join(account, 'spaces.json'), JSON.stringify({ spaces: [{ id: 'project', name: 'Project', folders: [root], instructions: 'Local instructions' }, { id: 'multi', folders: [root, directory] }] }))
    await writeFile(join(account, 'session-a.json'), JSON.stringify({ sessionId: 'a', title: 'A', spaceId: 'project', createdAt: Date.now() }))
    await writeFile(join(account, 'session-a/audit.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'Fixture' }, timestamp: new Date().toISOString() })}\n`)
    const result = await service.detect({ hostId: 'local', providers: ['claude-cowork'], includeHome: true })
    expect(result.items.map(item => item.itemType)).toEqual(['AGENTS_MD', 'SESSIONS'])
    expect(result.unsupportedProjects[0].reason).toBe('multiple-source-folders')
    await expect(readFile(join(root, 'AGENTS.md'))).rejects.toThrow()
  })
  it('converts tool blocks to historical text, preserves user images and closes turns', async () => {
    const { directory } = await fixture(), path = join(directory, 'audit.jsonl')
    await writeFile(path, [
      { type: 'assistant', message: { content: 'orphan' } },
      { type: 'user', message: { content: [{ type: 'text', text: 'Question' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/fixture' } }, { type: 'text', text: 'Answer' }] } },
      { type: 'user', isSidechain: true, message: { content: 'ignored' } }
    ].map(value => JSON.stringify(value)).join('\n'))
    const messages = await readCoworkTranscript(path), rows = coworkRollout(messages, { id: 'fixture', cwd: directory, projectless: false, outputDirectory: directory, lastActivityAtMs: 0 }).trim().split('\n').map(line => JSON.parse(line))
    expect(messages).toHaveLength(3)
    expect(rows.find(row => row.payload.type === 'user_message').payload.images).toEqual(['data:image/png;base64,AA=='])
    expect(rows.find(row => row.payload.type === 'agent_message').payload.message).toContain('[external_agent_tool_call: Read]')
    expect(rows.at(-1).payload.type).toBe('task_complete'); expect(rows.some(row => row.payload.message === 'orphan')).toBe(false)
  })
})

describe('import IPC guards', () => {
  it('accepts native migration structure and rejects forged host/path/oversized data', () => {
    expect(isExternalAgentDetectOptions({ hostId: 'local', providers: ['cursor'], workspaceRoots: ['/fixture'] })).toBe(true)
    expect(isExternalAgentDetectOptions({ hostId: 'remote', providers: ['cursor'] })).toBe(false)
    expect(isExternalAgentImportOptions(opts([item()]))).toBe(true)
    expect(isExternalAgentImportOptions(opts([{ ...item(), cwd: '../escape' }]))).toBe(false)
    expect(isExternalAgentReadOptions({ hostId: 'local', providers: ['claude-cowork'] })).toBe(true)
    expect(isExternalAgentSyncOptions({ syncEnabled: true, syncItemTypes: { SESSIONS: 'original' } })).toBe(true)
    expect(isExternalAgentSyncOptions({ syncEnabled: true, syncItemTypes: { fake: true } })).toBe(false)
  })
})

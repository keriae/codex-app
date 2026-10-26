import { describe, expect, it } from 'vitest'
import type { ExternalAgentImportResult, ExternalAgentMigrationItem } from '../../shared/api'
import { createImportReview, importItemKey, importMessage, importProjectItemKey, importResultOutcome, initialImportSelection, loadImportedAppLinks, selectedImportItems } from './importModels'

const details = { commands: [], hooks: [], mcpServers: [], plugins: [], skills: [], subagents: [], memory: [], sessions: [] }
function item(itemType: ExternalAgentMigrationItem['itemType'], cwd: string | null = null, providerId: ExternalAgentMigrationItem['providerId'] = 'claude-code'): ExternalAgentMigrationItem { return { itemType, cwd, providerId, description: `${itemType} ${cwd ?? 'home'}`, details: { ...details } } }
function result(overrides: Partial<ExternalAgentImportResult>): ExternalAgentImportResult { return { importedProjectIds: [], importedSessionThreadIds: [], projectRoots: [], itemTypeResults: [], canceled: false, ...overrides } }

describe('original import selection model', () => {
  it('separates provider home setup, project setup and home chat sessions', () => {
    const home = item('CONFIG'); const project = item('AGENTS_MD', '/synthetic/project'); const excluded = item('SKILLS', null, 'cursor')
    const sessions = item('SESSIONS'); sessions.details!.sessions = [{ cwd: '/synthetic/project', path: '/synthetic/session.jsonl', title: 'Example' }]
    const model = createImportReview([project, home, sessions, excluded, item('SESSIONS', '/synthetic/project')], ['claude-code'])
    expect(model.choices.map((choice) => choice.kind)).toEqual(['setup', 'projects', 'chats'])
    expect(selectedImportItems(model, initialImportSelection(model))).toEqual([home, project, sessions])
    expect(model.projectRoots).toEqual(['/synthetic/project'])
  })

  it('does not deselect chat sessions when Projects is disabled', () => {
    const project = item('SKILLS', '/synthetic/project'); const sessions = item('SESSIONS')
    sessions.details!.sessions = [{ cwd: '/synthetic/project', path: '/synthetic/session.jsonl', title: null }, { cwd: '/synthetic/projectless', path: '/synthetic/empty.jsonl', title: 'Outside project', workspaceKind: 'projectless' }]
    const model = createImportReview([project, sessions], ['claude-code'])
    expect(model.projectRoots).toEqual(['/synthetic/project'])
    expect(selectedImportItems(model, { ...initialImportSelection(model), projects: false })).toEqual([sessions])
    expect(model.choices.find((choice) => choice.kind === 'chats')?.count).toBe(2)
  })

  it('respects explicit project detail selection without sending unchecked items', () => {
    const first = item('SKILLS', '/synthetic/first'); const second = item('AGENTS_MD', '/synthetic/second')
    const model = createImportReview([first, second], ['claude-code'])
    expect(selectedImportItems(model, { projects: true, [importProjectItemKey(first)]: true, [importProjectItemKey(second)]: false })).toEqual([first])
  })

  it('groups Cowork home categories while retaining their distinct native source paths', () => {
    const first = { ...item('CONFIG', null, 'claude-cowork'), sourcePath: '/synthetic/cowork/a.json' }
    const second = { ...item('CONFIG', null, 'claude-cowork'), sourcePath: '/synthetic/cowork/b.json', description: 'Second configuration' }
    const model = createImportReview([first, second], ['claude-cowork'])
    expect(model.choices).toHaveLength(1)
    expect(model.choices[0].key).toBe('CONFIG:claude-cowork:home')
    expect(selectedImportItems(model, initialImportSelection(model))).toEqual([first, second])
    expect(importItemKey(first)).not.toBe(importItemKey(second))
  })

  it('reports partial failures, all failures, canceled imports and empty results truthfully', () => {
    const success = { itemType: 'SKILLS' as const, title: 'Example' }; const failure = { itemType: 'SKILLS' as const, failureStage: 'write', message: 'Fixture failure' }
    expect(importResultOutcome(result({ itemTypeResults: [{ itemType: 'SKILLS', successes: [success], failures: [failure] }] }))).toBe('partial')
    expect(importResultOutcome(result({ itemTypeResults: [{ itemType: 'SKILLS', successes: [], failures: [failure] }] }))).toBe('failed')
    expect(importResultOutcome(result({ canceled: true }))).toBe('stopped')
    expect(importResultOutcome(result({}))).toBe('empty')
  })

  it('formats recovered Chinese messages with nested plural arguments', () => {
    expect(importMessage('electron.onboarding.welcomeV2.externalAgentImport.recentChats.tooltip', { count: 3, providers: 'Claude Code' })).toBe('将导入来自 Claude Code 的 3 个最近聊天')
    expect(importMessage('settings.import.history.summaryWithFailures', { importedCount: 2, failedCount: 1 })).toBe('已导入 2 项 · 1 项未导入')
  })
})

describe('imported application connection metadata', () => {
  it('matches canonical app IDs and derives connection state only from the runtime', async () => {
    const apps = await loadImportedAppLinks([{ name: 'Different name', codexAppId: 'app-a', sessionCount: 1, source: 'sessionToolUse' }, { name: 'Other', sessionCount: 1, source: 'sessionToolUse' }], async (method) => method === 'app/list' ? { data: [{ id: 'app-a', name: 'App A', installUrl: 'https://example.invalid/auth', isAccessible: true }, { id: 'app-b', name: 'Other', installUrl: 'https://user:password@example.invalid' }], nextCursor: null } : { apps: [{ id: 'app-a', enabled: true, callable: true }, { id: 'app-b', enabled: true, callable: false }] })
    expect(apps).toEqual([{ id: 'app-a', name: 'App A', connectionUrl: 'https://example.invalid/auth', connected: true }, { id: 'app-b', name: 'Other', connectionUrl: null, connected: false }])
  })

  it('rejects catalog cursor loops instead of presenting incomplete connection state', async () => {
    await expect(loadImportedAppLinks([], async (method) => method === 'app/list' ? { data: [], nextCursor: 'repeated' } : { apps: [] })).rejects.toThrow('cursor')
  })
})

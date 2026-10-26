import { describe, expect, it } from 'vitest'
import {
  isAllowedAuthenticationUrl,
  isAllowedExternalUrl,
  isAllowedRendererRpc,
  isAllowedWorkspacePathRequest,
  isTrustedRendererUrl,
  MAX_RENDERER_RPC_BYTES
} from './ipcSecurity'

describe('workspace path IPC policy', () => {
  it('accepts normalized absolute paths contained by the selected root', () => {
    expect(
      isAllowedWorkspacePathRequest({
        root: '/synthetic/workspace',
        path: '/synthetic/workspace'
      })
    ).toBe(true)
    expect(
      isAllowedWorkspacePathRequest({
        root: '/synthetic/workspace',
        path: '/synthetic/workspace/src/App.tsx'
      })
    ).toBe(true)
  })

  it('rejects traversal, sibling paths, relative paths, and broadened payloads', () => {
    expect(
      isAllowedWorkspacePathRequest({
        root: '/synthetic/workspace',
        path: '/synthetic/workspace/../private.txt'
      })
    ).toBe(false)
    expect(
      isAllowedWorkspacePathRequest({
        root: '/synthetic/workspace',
        path: '/synthetic/workspace-other/private.txt'
      })
    ).toBe(false)
    expect(
      isAllowedWorkspacePathRequest({
        root: 'synthetic/workspace',
        path: 'synthetic/workspace/src'
      })
    ).toBe(false)
    expect(
      isAllowedWorkspacePathRequest({
        root: '/synthetic/workspace',
        path: '/synthetic/workspace/src',
        recursive: true
      })
    ).toBe(false)
    expect(
      isAllowedWorkspacePathRequest({
        root: '/synthetic/workspace',
        path: '/synthetic/workspace/src\0secret'
      })
    ).toBe(false)
  })
})

describe('isTrustedRendererUrl', () => {
  it('accepts only the configured development origin', () => {
    const developmentUrl = 'http://127.0.0.1:5173/'

    expect(isTrustedRendererUrl('http://127.0.0.1:5173/settings', developmentUrl)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/', developmentUrl)).toBe(false)
    expect(isTrustedRendererUrl('https://127.0.0.1:5173/', developmentUrl)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/', developmentUrl)).toBe(false)
    expect(isTrustedRendererUrl('file:///tmp/index.html', 'file:///tmp/index.html')).toBe(false)
  })

  it('accepts only the exact packaged renderer entry point', () => {
    expect(isTrustedRendererUrl('app://-/index.html', null)).toBe(true)
    expect(isTrustedRendererUrl('app://-/index.html?debug=true', null)).toBe(false)
    expect(isTrustedRendererUrl('app://-/index.html#settings', null)).toBe(false)
    expect(isTrustedRendererUrl('app://-/nested/index.html', null)).toBe(false)
    expect(isTrustedRendererUrl('file:///Applications/Codex.app/index.html', null)).toBe(false)
  })

  it('rejects web and malformed senders in production', () => {
    expect(isTrustedRendererUrl('https://example.com/', null)).toBe(false)
    expect(isTrustedRendererUrl('not a url', null)).toBe(false)
  })
})

describe('renderer RPC policy', () => {
  it('strictly validates catalog, hydration, and picker reads', () => {
    expect(
      isAllowedRendererRpc('thread/list', {
        archived: false,
        cursor: 'synthetic-cursor',
        cwd: ['/synthetic/workspace', '/synthetic/other'],
        excludedThreadIds: ['synthetic-excluded'],
        limit: 50,
        modelProviders: ['synthetic-provider'],
        originators: [],
        sortKey: 'recency_at',
        sortDirection: 'desc',
        sourceKinds: ['appServer'],
        useStateDbOnly: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/read', {
        threadId: 'synthetic-thread',
        includeTurns: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/resume', {
        threadId: 'synthetic-thread',
        excludeTurns: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/turns/list', {
        threadId: 'synthetic-thread',
        cursor: 'synthetic-cursor',
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'full'
      })
    ).toBe(true)
    expect(isAllowedRendererRpc('model/list', { limit: 100 })).toBe(true)
    expect(
      isAllowedRendererRpc('project/list', {
        limit: 100,
        sortKey: 'position',
        sortDirection: 'asc'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('permissionProfile/list', { cwd: '/synthetic/workspace' })
    ).toBe(true)
  })

  it('rejects unknown, oversized, malformed, and ambiguous catalog fields', () => {
    expect(isAllowedRendererRpc('thread/list', { limit: 50, includeTurns: true })).toBe(false)
    expect(isAllowedRendererRpc('thread/list', { limit: 0 })).toBe(false)
    expect(isAllowedRendererRpc('thread/list', { cursor: '' })).toBe(false)
    expect(isAllowedRendererRpc('thread/list', { cwd: 'relative/workspace' })).toBe(false)
    expect(
      isAllowedRendererRpc('thread/list', {
        parentThreadId: 'synthetic-parent',
        ancestorThreadId: 'synthetic-ancestor'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/list', {
        excludedThreadIds: Array.from({ length: 101 }, (_, index) => `thread-${index}`)
      })
    ).toBe(false)
    expect(isAllowedRendererRpc('thread/list', { sourceKinds: ['browser'] })).toBe(false)
    expect(
      isAllowedRendererRpc('thread/read', {
        threadId: 'synthetic-thread',
        includeTurns: 'yes'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/resume', {
        threadId: 'synthetic-thread',
        path: '/synthetic/rollout.jsonl'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/turns/list', {
        threadId: 'synthetic-thread',
        cursor: 'synthetic-cursor',
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'all'
      })
    ).toBe(false)
    expect(isAllowedRendererRpc('model/list', { limit: 100, provider: 'synthetic' })).toBe(false)
    expect(
      isAllowedRendererRpc('permissionProfile/list', { cwd: '/synthetic/../workspace' })
    ).toBe(false)
  })

  it('accepts only the desktop thread and turn creation shapes', () => {
    expect(
      isAllowedRendererRpc('thread/start', {
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        permissions: ':workspace',
        approvalsReviewer: 'auto_review',
        projectId: 'synthetic-project',
        ephemeral: false
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('project/create', {
        name: 'synthetic-project',
        roots: [{ path: '/synthetic/workspace' }],
        metadata: {},
        idempotencyKey: 'synthetic-idempotency-key'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        lastTurnId: 'synthetic-turn',
        excludeTurns: false
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        beforeTurnId: 'synthetic-turn',
        excludeTurns: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        excludeTurns: true,
        ephemeral: true,
        approvalsReviewer: 'auto_review',
        experimentalPredictionMode: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        excludeTurns: true,
        ephemeral: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [
          { type: 'text', text: 'Inspect the project', text_elements: [] },
          { type: 'localImage', path: '/synthetic/screenshot.png', detail: 'high' },
          { type: 'mention', name: 'README.md', path: '/synthetic/README.md' },
          { type: 'mention', name: 'src', path: '/synthetic/src/' }
        ],
        cwd: '/synthetic/workspace',
        permissions: undefined,
        approvalsReviewer: 'guardian_subagent',
        model: 'synthetic-model',
        effort: 'high'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [{ type: 'text', text: 'Draft a plan', text_elements: [] }],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: 'synthetic-model',
            reasoning_effort: 'high'
          }
        }
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        objective: 'Ship the replica',
        status: 'active',
        tokenBudget: 100_000,
        origin: 'user'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/get', {
        threadId: 'synthetic-thread'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/clear', {
        threadId: 'synthetic-thread',
        origin: 'user'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/clear', {
        threadId: 'synthetic-thread',
        origin: 'automatic'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        status: 'complete',
        origin: 'automatic'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        objective: 'x'.repeat(4_001)
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/start', {
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        approvalsReviewer: 'untrusted-reviewer',
        ephemeral: false
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [{ type: 'text', text: 'Inspect the project', text_elements: [] }],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high',
        approvalsReviewer: 'untrusted-reviewer'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        objective: '🚀'.repeat(4_000)
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        status: 'active',
        tokenBudget: 0
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/interrupt', {
        threadId: 'synthetic-thread',
        turnId: 'synthetic-turn'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('turn/steer', {
        threadId: 'synthetic-thread',
        expectedTurnId: 'synthetic-turn',
        clientUserMessageId: 'synthetic-steer-message',
        input: [
          { type: 'text', text: 'Also inspect this', text_elements: [] },
          { type: 'mention', name: 'README.md', path: '/synthetic/README.md' }
        ]
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/queue/add', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-queued-message',
        input: [
          { type: 'text', text: 'Run after this turn', text_elements: [] },
          { type: 'mention', name: 'README.md', path: '/synthetic/README.md' }
        ]
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/queue/list', {
        threadId: 'synthetic-thread',
        cursor: null,
        limit: 100
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/queue/update', {
        threadId: 'synthetic-thread',
        queuedSubmissionId: 'synthetic-queue-id',
        input: [
          { type: 'text', text: 'Use the revised follow-up', text_elements: [] },
          { type: 'localImage', path: '/synthetic/screenshot.png' }
        ]
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/queue/delete', {
        threadId: 'synthetic-thread',
        queuedSubmissionId: 'synthetic-queue-id'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/queue/reorder', {
        threadId: 'synthetic-thread',
        queuedSubmissionIds: ['synthetic-queue-2', 'synthetic-queue-1']
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/queue/start', {
        threadId: 'synthetic-thread',
        queuedSubmissionId: 'synthetic-queue-id'
      })
    ).toBe(true)
  })

  it('rejects hidden configuration injection and malformed turn input', () => {
    expect(
      isAllowedRendererRpc('thread/start', {
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        ephemeral: false,
        developerInstructions: 'untrusted override'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('project/list', {
        limit: 100,
        sortDirection: 'desc'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('project/create', {
        name: 'synthetic-project',
        roots: [{ path: 'relative/workspace' }],
        idempotencyKey: 'synthetic-idempotency-key'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        lastTurnId: '',
        excludeTurns: false
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        lastTurnId: 'synthetic-turn',
        beforeTurnId: 'synthetic-turn-2',
        excludeTurns: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        lastTurnId: 'synthetic-turn',
        excludeTurns: true,
        ephemeral: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        excludeTurns: false,
        ephemeral: true,
        experimentalPredictionMode: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/fork', {
        threadId: 'synthetic-thread',
        excludeTurns: true,
        experimentalPredictionMode: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [{ type: 'localImage', path: 'relative/image.png' }],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [{ type: 'text', text: 'Draft a plan', text_elements: [] }],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: 'synthetic-model',
            reasoning_effort: 'high',
            developer_instructions: 'untrusted override'
          }
        }
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [{ type: 'text', text: 'Draft a plan', text_elements: [] }],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high',
        collaborationMode: {
          mode: 'default',
          settings: {
            model: 'synthetic-model',
            reasoning_effort: 'high'
          }
        }
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        objective: 'Ship the replica',
        origin: 'daemon'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/goal/set', {
        threadId: 'synthetic-thread',
        objective: 'Ship the replica',
        tokenBudget: -1,
        origin: 'user'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/goal/clear', {
        threadId: 'synthetic-thread',
        origin: 'user',
        force: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [{ type: 'text', text: 'hello', text_elements: [], extra: true }],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: Array.from({ length: 22 }, () => ({
          type: 'mention',
          name: 'file.txt',
          path: '/synthetic/file.txt'
        })),
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/interrupt', {
        threadId: 'synthetic-thread',
        turnId: 'synthetic-turn',
        force: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('turn/steer', {
        threadId: 'synthetic-thread',
        expectedTurnId: 'synthetic-turn',
        input: [{ type: 'text', text: 'hello', text_elements: [] }],
        cwd: '/synthetic/workspace'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/queue/add', {
        threadId: 'synthetic-thread',
        input: [{ type: 'text', text: 'missing client id', text_elements: [] }]
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/queue/start', {
        threadId: 'synthetic-thread'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/queue/reorder', {
        threadId: 'synthetic-thread',
        queuedSubmissionIds: Array.from({ length: 101 }, (_, index) => `queue-${index}`)
      })
    ).toBe(false)
  })

  it('caps the fully serialized renderer RPC payload', () => {
    expect(
      isAllowedRendererRpc('turn/start', {
        threadId: 'synthetic-thread',
        clientUserMessageId: 'synthetic-message',
        input: [
          {
            type: 'text',
            text: 'x'.repeat(MAX_RENDERER_RPC_BYTES),
            text_elements: []
          }
        ],
        cwd: '/synthetic/workspace',
        model: 'synthetic-model',
        effort: 'high'
      })
    ).toBe(false)
  })

  it('allows only the supported managed ChatGPT account flow', () => {
    expect(isAllowedRendererRpc('account/read', { refreshToken: false })).toBe(true)
    expect(
      isAllowedRendererRpc('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
        appBrand: 'codex'
      })
    ).toBe(true)
    expect(isAllowedRendererRpc('account/logout', undefined)).toBe(true)
    expect(isAllowedRendererRpc('account/rateLimits/read', undefined)).toBe(true)
  })

  it('rejects renderer API-key auth and broadened account payloads', () => {
    expect(
      isAllowedRendererRpc('account/login/start', { type: 'apiKey', apiKey: 'secret' })
    ).toBe(false)
    expect(isAllowedRendererRpc('account/read', { refreshToken: true })).toBe(false)
    expect(
      isAllowedRendererRpc('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
        appBrand: 'codex',
        apiKey: 'secret'
      })
    ).toBe(false)
    expect(isAllowedRendererRpc('config/read', { includeCredentials: true })).toBe(false)
  })

  it('allows effective config reads and the specific configuration settings shown in the desktop UI', () => {
    expect(isAllowedRendererRpc('config/read', { cwd: null, includeLayers: true })).toBe(true)
    expect(isAllowedRendererRpc('config/read', { cwd: '/synthetic/workspace' })).toBe(true)
    for (const [keyPath, value] of [
      ['approval_policy', 'on-request'],
      ['sandbox_mode', 'workspace-write'],
      ['web_search', 'live'],
      ['model_verbosity', null],
      ['model_reasoning_summary', null],
      ['sandbox_workspace_write.network_access', false]
    ]) {
      expect(isAllowedRendererRpc('config/value/write', { keyPath, value, mergeStrategy: 'replace' })).toBe(true)
    }
    expect(isAllowedRendererRpc('skills/config/write', { path: '/synthetic/skill/SKILL.md', enabled: false })).toBe(true)
  })

  it('rejects arbitrary configuration keys, file destinations, unknown enums and skill selectors', () => {
    for (const params of [
      { keyPath: 'mcp_servers', value: {}, mergeStrategy: 'replace' },
      { keyPath: 'approval_policy', value: 'always', mergeStrategy: 'replace' },
      { keyPath: 'web_search', value: 'indexed', mergeStrategy: 'replace' },
      { keyPath: 'sandbox_workspace_write.network_access', value: 'true', mergeStrategy: 'replace' },
      { keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'upsert' },
      { keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'replace', filePath: '/synthetic/private.toml' },
      { keyPath: 'model_verbosity', mergeStrategy: 'replace' }
    ]) {
      expect(isAllowedRendererRpc('config/value/write', params)).toBe(false)
    }
    expect(isAllowedRendererRpc('config/read', { cwd: 'relative/path' })).toBe(false)
    expect(isAllowedRendererRpc('skills/config/write', { name: 'skill', enabled: true })).toBe(false)
    expect(isAllowedRendererRpc('skills/config/write', { path: 'relative/SKILL.md', enabled: true })).toBe(false)
  })

  it('strictly validates destructive thread operations and search', () => {
    expect(isAllowedRendererRpc('thread/archive', { threadId: 'synthetic-thread' })).toBe(true)
    expect(isAllowedRendererRpc('thread/delete', { threadId: '' })).toBe(false)
    expect(
      isAllowedRendererRpc('thread/delete', {
        threadId: 'synthetic-thread',
        deleteWorkingTree: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/name/set', {
        threadId: 'synthetic-thread',
        name: 'Renamed chat'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/revert', {
        threadId: 'synthetic-thread',
        beforeTurnId: 'synthetic-turn'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/revert', {
        threadId: 'synthetic-thread',
        beforeTurnId: 'synthetic-turn',
        restoreWorkingTree: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/search', {
        searchTerm: 'needle',
        limit: 50,
        sortKey: 'recency_at',
        sortDirection: 'desc',
        archived: false
      })
    ).toBe(true)
    expect(isAllowedRendererRpc('thread/search', { searchTerm: ' ', limit: 50 })).toBe(false)
  })

  it('allows only thread-scoped background terminal inspection and cleanup', () => {
    expect(
      isAllowedRendererRpc('thread/backgroundTerminals/list', {
        threadId: 'synthetic-thread',
        cursor: null,
        limit: 100
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/backgroundTerminals/terminate', {
        threadId: 'synthetic-thread',
        processId: 'synthetic-process'
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('thread/backgroundTerminals/clean', {
        threadId: 'synthetic-thread'
      })
    ).toBe(true)

    expect(
      isAllowedRendererRpc('thread/backgroundTerminals/list', {
        threadId: 'synthetic-thread',
        limit: 101
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('thread/backgroundTerminals/terminate', {
        threadId: 'synthetic-thread',
        processId: '',
        signal: 'SIGKILL'
      })
    ).toBe(false)
    expect(isAllowedRendererRpc('thread/shellCommand', { threadId: 'synthetic-thread' })).toBe(false)
    expect(isAllowedRendererRpc('process/spawn', { command: 'synthetic command' })).toBe(false)
  })

  it('allows only the read-only integrations inventory shapes and explicit MCP reload', () => {
    expect(
      isAllowedRendererRpc('skills/list', {
        cwds: ['/synthetic/workspace'],
        forceReload: true
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('mcpServerStatus/list', {
        cursor: null,
        detail: 'full',
        limit: 100
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('mcpServerStatus/list', {
        cursor: 'synthetic-cursor',
        detail: 'full',
        limit: 100
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('app/list', {
        cursor: null,
        forceRefetch: false,
        limit: 100,
        threadId: null
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('app/list', {
        cursor: 'synthetic-cursor',
        forceRefetch: true,
        limit: 100,
        threadId: null
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('app/installed', {
        forceRefresh: true,
        threadId: null
      })
    ).toBe(true)
    expect(
      isAllowedRendererRpc('plugin/list', {
        cwds: ['/synthetic/workspace'],
        forceRefetch: false
      })
    ).toBe(true)
    expect(isAllowedRendererRpc('config/mcpServer/reload', undefined)).toBe(true)
  })

  it('rejects broadened integrations reads, config writes, plugin changes, and OAuth brokerage', () => {
    expect(
      isAllowedRendererRpc('skills/list', {
        cwds: ['relative/workspace'],
        forceReload: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('skills/list', {
        cwds: ['/synthetic/workspace', '/synthetic/other'],
        forceReload: false
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('skills/list', {
        cwds: ['/synthetic/workspace'],
        forceReload: false,
        includeContents: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('mcpServerStatus/list', {
        cursor: null,
        detail: 'toolsAndAuthOnly',
        limit: 100
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('mcpServerStatus/list', {
        cursor: null,
        detail: 'full',
        limit: 100,
        serverName: 'synthetic-server'
      })
    ).toBe(false)
    expect(isAllowedRendererRpc('config/mcpServer/reload', {})).toBe(false)
    expect(
      isAllowedRendererRpc('app/list', {
        cursor: '',
        forceRefetch: false,
        limit: 100,
        threadId: null
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('app/list', {
        cursor: null,
        forceRefetch: false,
        limit: 101,
        threadId: null
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('app/list', {
        cursor: null,
        forceRefetch: false,
        limit: 100,
        threadId: 'synthetic-thread'
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('app/installed', {
        forceRefresh: false,
        threadId: null,
        includeTools: true
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('plugin/list', {
        cwds: ['/synthetic/workspace'],
        forceRefetch: false,
        marketplaceKinds: ['local']
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('plugin/list', {
        cwds: ['relative/workspace'],
        forceRefetch: false
      })
    ).toBe(false)
    expect(
      isAllowedRendererRpc('skills/config/write', {
        name: 'synthetic-skill',
        enabled: false
      })
    ).toBe(false)
    expect(isAllowedRendererRpc('app/read', { appId: 'synthetic-app' })).toBe(false)
    expect(isAllowedRendererRpc('plugin/installed', { cwds: ['/synthetic/workspace'] })).toBe(false)
    expect(isAllowedRendererRpc('plugin/install', { id: 'synthetic-plugin' })).toBe(false)
    expect(isAllowedRendererRpc('plugin/uninstall', { id: 'synthetic-plugin' })).toBe(false)
    expect(isAllowedRendererRpc('mcpServer/oauth/login', { name: 'synthetic-server' })).toBe(false)
  })
})

describe('external URL policy', () => {
  it('allows reviewed product documentation and source-code links', () => {
    expect(isAllowedExternalUrl('https://learn.chatgpt.com/docs/codex/overview')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/openai/codex')).toBe(true)
    expect(isAllowedExternalUrl('https://developers.openai.com/resources')).toBe(true)
  })

  it('rejects unreviewed hosts, credentials, non-default ports, and non-HTTPS URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/')).toBe(false)
    expect(isAllowedExternalUrl('http://chatgpt.com/auth/login')).toBe(false)
    expect(isAllowedExternalUrl('https://user@chatgpt.com/auth/login')).toBe(false)
    expect(isAllowedExternalUrl('https://auth.openai.com:8443/authorize')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('does not let the generic external-link capability bypass the auth broker', () => {
    expect(isAllowedExternalUrl('https://chatgpt.com/auth/login?state=abc')).toBe(false)
    expect(isAllowedExternalUrl('https://auth.openai.com/authorize')).toBe(false)
    expect(isAllowedExternalUrl('https://platform.openai.com/account')).toBe(false)
  })

  it('keeps authentication redirects on explicitly trusted OpenAI hosts', () => {
    expect(isAllowedAuthenticationUrl('https://chatgpt.com/auth/login?state=abc')).toBe(true)
    expect(isAllowedAuthenticationUrl('https://auth.openai.com/authorize')).toBe(true)
    expect(isAllowedAuthenticationUrl('https://platform.openai.com/account')).toBe(true)
    expect(isAllowedAuthenticationUrl('https://chatgpt.com.evil.example/auth')).toBe(false)
    expect(isAllowedAuthenticationUrl('https://evil.example/?next=https://chatgpt.com')).toBe(false)
  })

  it('bounds external and authentication URLs before they reach the operating system', () => {
    const oversized = `https://github.com/openai/codex?value=${'x'.repeat(8_192)}`
    expect(isAllowedExternalUrl(oversized)).toBe(false)
    expect(isAllowedAuthenticationUrl(oversized.replace('github.com', 'auth.openai.com'))).toBe(false)
  })
})

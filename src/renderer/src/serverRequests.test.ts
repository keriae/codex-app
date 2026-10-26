import { describe, expect, it } from 'vitest'
import type { RpcServerRequest } from '../../shared/api'
import {
  approvalChoices,
  buildApprovalResponse,
  buildMcpElicitationResponse,
  buildPermissionsApprovalResponse,
  buildUserInputResponse,
  declinedRequestResponse,
  enqueueServerRequest,
  isServerRequestForThread,
  parseUserInputQuestions,
  partitionServerRequestsForThread,
  rejectedSideChatRequestResponse,
  removeServerRequest,
  resolvedServerRequestId,
  serverRequestDestination,
  serverRequestIdKey,
  serverRequestThreadId,
  unsupportedServerRequestResponse
} from './serverRequests'

function request(method: string, params: Record<string, unknown> = {}): RpcServerRequest {
  return { id: 'request-1', method, params }
}

describe('server request responses', () => {
  it('keeps request arrival order and namespaces numeric and string ids', () => {
    const first = request('item/tool/requestUserInput')
    const second = { ...request('mcpServer/elicitation/request'), id: 2 }
    const stringSecond = { ...request('item/permissions/requestApproval'), id: '2' }
    let queue = enqueueServerRequest([], first)
    queue = enqueueServerRequest(queue, second)
    queue = enqueueServerRequest(queue, first)
    queue = enqueueServerRequest(queue, stringSecond)

    expect(serverRequestIdKey(2)).toBe('number:2')
    expect(serverRequestIdKey('2')).toBe('string:2')
    expect(queue.map((item) => item.id)).toEqual(['request-1', 2, '2'])
    expect(removeServerRequest(queue, '2').map((item) => item.id)).toEqual(['request-1', 2])
    expect(removeServerRequest(queue, 2).map((item) => item.id)).toEqual([
      'request-1',
      '2'
    ])
  })

  it('routes only the currently open ephemeral thread into Side Chat', () => {
    const sideRequest: RpcServerRequest = {
      ...request('item/commandExecution/requestApproval', { threadId: 'side-1' }),
      desktopContext: { ephemeralThread: true }
    }
    const context = {
      sideChatOpen: true,
      sideChatThreadId: 'side-1',
      transientThreadIds: new Set(['side-1']),
      discardedSideChatThreadIds: new Set<string>()
    }

    expect(serverRequestDestination(sideRequest, context)).toBe('side-chat')
    expect(isServerRequestForThread(sideRequest, 'side-1')).toBe(true)
    expect(serverRequestThreadId(sideRequest)).toBe('side-1')

    expect(serverRequestDestination(sideRequest, { ...context, sideChatOpen: false })).toBe(
      'reject-side-chat'
    )
    expect(
      serverRequestDestination(sideRequest, {
        ...context,
        transientThreadIds: new Set<string>()
      })
    ).toBe('reject-side-chat')
    expect(
      serverRequestDestination(sideRequest, {
        ...context,
        discardedSideChatThreadIds: new Set(['side-1'])
      })
    ).toBe('reject-side-chat')
  })

  it('preserves main requests and extracts all supported thread id shapes', () => {
    const context = {
      sideChatOpen: false,
      sideChatThreadId: null,
      transientThreadIds: new Set<string>(),
      discardedSideChatThreadIds: new Set<string>()
    }
    expect(serverRequestDestination(request('item/fileChange/requestApproval', {
      threadId: 'main-1'
    }), context)).toBe('main-chat')
    expect(serverRequestThreadId(request('x', { conversationId: 'legacy-1' }))).toBe(
      'legacy-1'
    )
    expect(serverRequestThreadId(request('x', { thread: { id: 'nested-1' } }))).toBe(
      'nested-1'
    )
  })

  it('builds a terminal structured rejection for a discarded Side Chat request', () => {
    const value: RpcServerRequest = {
      ...request('item/tool/requestUserInput', { thread: { id: 'side-2' } }),
      desktopContext: { ephemeralThread: true }
    }
    expect(rejectedSideChatRequestResponse(value)).toEqual({
      error: {
        code: -32000,
        message: 'Interactive requests are unavailable for a discarded side chat',
        data: {
          kind: 'ephemeral_thread_request_rejected',
          method: value.method,
          retryable: false
        }
      }
    })
  })

  it('removes every queued request for a closed Side Chat without touching main chat', () => {
    const side = (id: string): RpcServerRequest => ({
      ...request('item/fileChange/requestApproval', { threadId: 'side-3' }),
      id,
      desktopContext: { ephemeralThread: true }
    })
    const main = { ...request('item/fileChange/requestApproval', { threadId: 'main-3' }), id: 'main' }
    const otherSide: RpcServerRequest = {
      ...side('other-side'),
      params: { threadId: 'side-4' }
    }

    const partition = partitionServerRequestsForThread(
      [side('side-a'), main, side('side-b'), otherSide],
      'side-3'
    )
    expect(partition.requests.map((item) => item.id)).toEqual(['side-a', 'side-b'])
    expect(partition.remaining.map((item) => item.id)).toEqual(['main', 'other-side'])
  })

  it('preserves the server approval decision order, including cancel', () => {
    const value = request('item/fileChange/requestApproval', {
      availableDecisions: ['cancel', 'decline', 'accept']
    })

    expect(approvalChoices(value).map((choice) => choice.key)).toEqual([
      'cancel',
      'decline',
      'accept'
    ])
    expect(buildApprovalResponse(value, 'cancel')).toEqual({
      result: { decision: 'cancel' }
    })
  })

  it('returns opaque modern policy amendments without reshaping them', () => {
    const decision = {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ['git', 'status']
      }
    }
    const value = request('item/commandExecution/requestApproval', {
      availableDecisions: [decision]
    })

    expect(approvalChoices(value)).toMatchObject([
      { key: 'acceptWithExecpolicyAmendment', decision }
    ])
    expect(buildApprovalResponse(value, decision)).toEqual({
      result: { decision }
    })
  })

  it('maps current decisions to the legacy approval response schema', () => {
    const value = request('execCommandApproval')

    expect(buildApprovalResponse(value, 'acceptForSession')).toEqual({
      result: { decision: 'approved_for_session' }
    })
    expect(buildApprovalResponse(value, 'decline')).toEqual({
      result: {
        decision: { denied: { rejection: 'Declined in Codex desktop' } }
      }
    })
  })

  it('parses one to three user questions and emits answers by question id', () => {
    const value = request('item/tool/requestUserInput', {
      questions: [
        {
          header: 'Mode',
          id: 'mode',
          question: 'Choose a mode',
          isOther: true,
          options: [{ label: 'Safe', description: 'Use safe defaults' }]
        },
        {
          header: 'Token',
          id: 'token',
          question: 'Enter the token',
          isSecret: true,
          options: null
        }
      ]
    })

    expect(parseUserInputQuestions(value)).toMatchObject([
      { id: 'mode', isOther: true, options: [{ label: 'Safe' }] },
      { id: 'token', isSecret: true, options: [] }
    ])
    expect(buildUserInputResponse({ mode: ['Safe'], token: ['s3cret'] })).toEqual({
      result: {
        answers: {
          mode: { answers: ['Safe'] },
          token: { answers: ['s3cret'] }
        }
      }
    })
  })

  it('rejects invalid user question counts instead of leaving the request pending', () => {
    const questions = Array.from({ length: 4 }, (_, index) => ({
      header: `Question ${index}`,
      id: `question-${index}`,
      question: 'Answer me'
    }))
    expect(parseUserInputQuestions(request('item/tool/requestUserInput', { questions }))).toBeNull()
  })

  it('builds MCP accept, decline, and cancel response shapes', () => {
    expect(buildMcpElicitationResponse('accept', { name: 'Ada', enabled: true })).toEqual({
      result: { action: 'accept', content: { name: 'Ada', enabled: true } }
    })
    expect(buildMcpElicitationResponse('decline')).toEqual({
      result: { action: 'decline' }
    })
    expect(buildMcpElicitationResponse('cancel')).toEqual({
      result: { action: 'cancel' }
    })
  })

  it('returns only the visibly confirmed permission profile and scope', () => {
    const permissions = {
      fileSystem: { write: ['/tmp/project'] },
      network: { enabled: true }
    }
    const value = request('item/permissions/requestApproval', { permissions })

    expect(buildPermissionsApprovalResponse(value, 'turn')).toEqual({
      result: { permissions, scope: 'turn' }
    })
    expect(declinedRequestResponse(value, 'permissions')).toMatchObject({
      error: {
        code: -32000,
        data: { kind: 'permission_request_declined', retryable: false }
      }
    })
  })

  it('returns structured refusals for sensitive unsupported capabilities', () => {
    expect(unsupportedServerRequestResponse('item/tool/call')).toMatchObject({
      error: {
        code: -32601,
        data: { kind: 'dynamic_tool_unavailable', retryable: false }
      }
    })
    expect(unsupportedServerRequestResponse('account/chatgptAuthTokens/refresh')).toMatchObject({
      error: { data: { kind: 'auth_token_broker_unavailable' } }
    })
    expect(unsupportedServerRequestResponse('attestation/generate')).toMatchObject({
      error: { data: { kind: 'attestation_unavailable' } }
    })
  })

  it('extracts externally resolved numeric and string request ids', () => {
    expect(
      resolvedServerRequestId({
        method: 'serverRequest/resolved',
        params: { threadId: 'thread-1', requestId: 42 }
      })
    ).toBe(42)
    expect(
      resolvedServerRequestId({
        method: 'serverRequest/resolved',
        params: { threadId: 'thread-1', requestId: 'request-2' }
      })
    ).toBe('request-2')
  })
})

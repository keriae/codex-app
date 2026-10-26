import type {
  RpcId,
  RpcNotification,
  RpcServerRequest,
  RpcServerResponse
} from '../../shared/api'

export const interactiveServerRequestMethods = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
  'item/permissions/requestApproval',
  'execCommandApproval',
  'applyPatchApproval'
] as const

export type InteractiveServerRequestMethod =
  (typeof interactiveServerRequestMethods)[number]

export type ApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'
  | Record<string, unknown>

export interface ApprovalChoice {
  key: string
  label: string
  decision: ApprovalDecision
  tone: 'primary' | 'neutral' | 'danger'
}

export interface UserInputQuestion {
  header: string
  id: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: Array<{ label: string; description: string }>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function requestParams(request: RpcServerRequest): Record<string, unknown> {
  return record(request.params) || {}
}

export function isInteractiveServerRequest(
  method: string
): method is InteractiveServerRequestMethod {
  return (interactiveServerRequestMethods as readonly string[]).includes(method)
}

export function serverRequestIdKey(id: RpcId): string {
  return `${typeof id}:${String(id)}`
}

export function enqueueServerRequest(
  queue: RpcServerRequest[],
  request: RpcServerRequest
): RpcServerRequest[] {
  const key = serverRequestIdKey(request.id)
  return queue.some((candidate) => serverRequestIdKey(candidate.id) === key)
    ? queue
    : [...queue, request]
}

export function removeServerRequest(
  queue: RpcServerRequest[],
  requestId: string | number
): RpcServerRequest[] {
  const key = serverRequestIdKey(requestId)
  return queue.filter((request) => serverRequestIdKey(request.id) !== key)
}

export function serverRequestThreadId(request: RpcServerRequest): string | null {
  const params = record(request.params)
  if (!params) return null
  if (typeof params.threadId === 'string') return params.threadId
  if (typeof params.conversationId === 'string') return params.conversationId
  const thread = record(params.thread)
  return typeof thread?.id === 'string' ? thread.id : null
}

export function isEphemeralServerRequest(request: RpcServerRequest): boolean {
  return request.desktopContext?.ephemeralThread === true
}

export type ServerRequestDestination = 'main-chat' | 'side-chat' | 'reject-side-chat'

export interface ServerRequestRouteContext {
  sideChatOpen: boolean
  sideChatThreadId: string | null
  transientThreadIds: ReadonlySet<string>
  discardedSideChatThreadIds: ReadonlySet<string>
}

export function serverRequestDestination(
  request: RpcServerRequest,
  context: ServerRequestRouteContext
): ServerRequestDestination {
  if (!isEphemeralServerRequest(request)) return 'main-chat'

  const threadId = serverRequestThreadId(request)
  if (
    threadId &&
    context.sideChatOpen &&
    threadId === context.sideChatThreadId &&
    context.transientThreadIds.has(threadId) &&
    !context.discardedSideChatThreadIds.has(threadId)
  ) {
    return 'side-chat'
  }
  return 'reject-side-chat'
}

export function isServerRequestForThread(
  request: RpcServerRequest,
  threadId: string
): boolean {
  return isEphemeralServerRequest(request) && serverRequestThreadId(request) === threadId
}

export function partitionServerRequestsForThread(
  queue: RpcServerRequest[],
  threadId: string
): { requests: RpcServerRequest[]; remaining: RpcServerRequest[] } {
  const requests: RpcServerRequest[] = []
  const remaining: RpcServerRequest[] = []
  for (const request of queue) {
    if (isServerRequestForThread(request, threadId)) requests.push(request)
    else remaining.push(request)
  }
  return { requests, remaining }
}

export function rejectedSideChatRequestResponse(
  request: RpcServerRequest
): RpcServerResponse {
  return {
    error: {
      code: -32000,
      message: 'Interactive requests are unavailable for a discarded side chat',
      data: {
        kind: 'ephemeral_thread_request_rejected',
        method: request.method,
        retryable: false
      }
    }
  }
}

function approvalDecisionKey(decision: ApprovalDecision): string | null {
  if (typeof decision === 'string') {
    return ['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)
      ? decision
      : null
  }

  const value = record(decision)
  if (!value) return null
  if (record(value.acceptWithExecpolicyAmendment)) return 'acceptWithExecpolicyAmendment'
  if (record(value.applyNetworkPolicyAmendment)) return 'applyNetworkPolicyAmendment'
  return null
}

function choiceForDecision(decision: ApprovalDecision): ApprovalChoice | null {
  const key = approvalDecisionKey(decision)
  if (!key) return null

  const labels: Record<string, string> = {
    accept: 'Allow once',
    acceptForSession: 'Allow for session',
    acceptWithExecpolicyAmendment: 'Allow and remember command',
    applyNetworkPolicyAmendment: 'Apply network rule',
    decline: 'Deny',
    cancel: 'Stop turn'
  }
  return {
    key,
    label: labels[key],
    decision,
    tone:
      key === 'decline' || key === 'cancel'
        ? 'danger'
        : key === 'accept'
          ? 'primary'
          : 'neutral'
  }
}

export function approvalChoices(request: RpcServerRequest): ApprovalChoice[] {
  const params = requestParams(request)
  const modern = !['execCommandApproval', 'applyPatchApproval'].includes(request.method)
  const defaults: ApprovalDecision[] = modern
    ? ['decline', 'cancel', 'acceptForSession', 'accept']
    : ['decline', 'acceptForSession', 'accept']
  const available = Array.isArray(params.availableDecisions)
    ? params.availableDecisions
    : defaults

  const seen = new Set<string>()
  const choices: ApprovalChoice[] = []
  for (const candidate of available) {
    const decision =
      typeof candidate === 'string' || record(candidate)
        ? (candidate as ApprovalDecision)
        : null
    if (!decision) continue
    const choice = choiceForDecision(decision)
    if (!choice || seen.has(choice.key)) continue
    seen.add(choice.key)
    choices.push(choice)
  }
  return choices
}

export function buildApprovalResponse(
  request: RpcServerRequest,
  decision: ApprovalDecision
): RpcServerResponse {
  const legacy = request.method === 'execCommandApproval' || request.method === 'applyPatchApproval'
  if (!legacy) return { result: { decision } }

  const legacyDecision =
    decision === 'accept'
      ? 'approved'
      : decision === 'acceptForSession'
        ? 'approved_for_session'
        : decision === 'cancel'
          ? 'abort'
          : { denied: { rejection: 'Declined in Codex desktop' } }
  return { result: { decision: legacyDecision } }
}

export function parseUserInputQuestions(request: RpcServerRequest): UserInputQuestion[] | null {
  const questions = requestParams(request).questions
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) return null

  const parsed: UserInputQuestion[] = []
  const ids = new Set<string>()
  for (const value of questions) {
    const question = record(value)
    if (
      !question ||
      typeof question.id !== 'string' ||
      !question.id ||
      ids.has(question.id) ||
      typeof question.header !== 'string' ||
      typeof question.question !== 'string'
    ) {
      return null
    }

    const options: UserInputQuestion['options'] = []
    if (question.options !== null && question.options !== undefined) {
      if (!Array.isArray(question.options)) return null
      for (const value of question.options) {
        const option = record(value)
        if (
          !option ||
          typeof option.label !== 'string' ||
          typeof option.description !== 'string'
        ) {
          return null
        }
        options.push({ label: option.label, description: option.description })
      }
    }

    ids.add(question.id)
    parsed.push({
      header: question.header,
      id: question.id,
      question: question.question,
      isOther: question.isOther === true,
      isSecret: question.isSecret === true,
      options
    })
  }
  return parsed
}

export function buildUserInputResponse(
  answers: Record<string, string[]>
): RpcServerResponse {
  return {
    result: {
      answers: Object.fromEntries(
        Object.entries(answers).map(([id, values]) => [id, { answers: [...values] }])
      )
    }
  }
}

export function buildMcpElicitationResponse(
  action: 'accept' | 'decline' | 'cancel',
  content?: Record<string, unknown>
): RpcServerResponse {
  return {
    result:
      action === 'accept'
        ? { action, content: content || {} }
        : { action }
  }
}

export function buildPermissionsApprovalResponse(
  request: RpcServerRequest,
  scope: 'turn' | 'session'
): RpcServerResponse {
  const permissions = record(requestParams(request).permissions) || {}
  return { result: { permissions, scope } }
}

export function declinedRequestResponse(
  request: RpcServerRequest,
  kind: 'user_input' | 'permissions'
): RpcServerResponse {
  return {
    error: {
      code: -32000,
      message:
        kind === 'permissions'
          ? 'The user declined the requested permissions'
          : 'The user cancelled the input request',
      data: {
        kind: kind === 'permissions' ? 'permission_request_declined' : 'user_input_cancelled',
        method: request.method,
        retryable: false
      }
    }
  }
}

export function invalidServerRequestResponse(request: RpcServerRequest): RpcServerResponse {
  return {
    error: {
      code: -32602,
      message: `Invalid parameters for server request ${request.method}`,
      data: {
        kind: 'invalid_server_request_params',
        method: request.method,
        retryable: false
      }
    }
  }
}

export function unsupportedServerRequestResponse(method: string): RpcServerResponse {
  const category =
    method === 'item/tool/call'
      ? 'dynamic_tool_unavailable'
      : method === 'account/chatgptAuthTokens/refresh'
        ? 'auth_token_broker_unavailable'
        : method === 'attestation/generate'
          ? 'attestation_unavailable'
          : 'unsupported_server_request'

  const messages: Record<string, string> = {
    dynamic_tool_unavailable: 'No renderer tool is registered for this dynamic tool call',
    auth_token_broker_unavailable: 'This client cannot broker ChatGPT authentication tokens',
    attestation_unavailable: 'Client attestation is unavailable in this build',
    unsupported_server_request: `The desktop client does not support server request ${method}`
  }

  return {
    error: {
      code: -32601,
      message: messages[category],
      data: { kind: category, method, retryable: false }
    }
  }
}

export function resolvedServerRequestId(notification: RpcNotification): string | number | null {
  if (notification.method !== 'serverRequest/resolved') return null
  const params = record(notification.params)
  return typeof params?.requestId === 'string' || typeof params?.requestId === 'number'
    ? params.requestId
    : null
}

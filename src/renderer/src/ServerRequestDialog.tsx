import {
  FileDiff,
  KeyRound,
  MessageCircleQuestion,
  ShieldAlert,
  TerminalSquare
} from 'lucide-react'
import { type FormEvent, type KeyboardEvent, type ReactNode, useMemo, useState } from 'react'
import type { RpcServerRequest, RpcServerResponse } from '../../shared/api'
import {
  approvalChoices,
  buildApprovalResponse,
  buildMcpElicitationResponse,
  buildPermissionsApprovalResponse,
  buildUserInputResponse,
  declinedRequestResponse,
  invalidServerRequestResponse,
  parseUserInputQuestions,
  requestParams,
  type ApprovalChoice,
  type UserInputQuestion
} from './serverRequests'

interface ServerRequestDialogProps {
  request: RpcServerRequest
  busy: boolean
  error: string | null
  onRespond(response: RpcServerResponse): void
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function approvalChoiceLabel(choice: ApprovalChoice): string {
  const labels: Record<string, string> = {
    accept: '允许一次',
    acceptForSession: '本次会话中允许',
    acceptWithExecpolicyAmendment: '允许并记住此命令',
    applyNetworkPolicyAmendment: '应用网络规则',
    decline: '拒绝',
    cancel: '停止本轮'
  }
  return labels[choice.key] || choice.label
}

function DialogFrame({
  icon,
  title,
  description,
  error,
  onEscape,
  children,
  actions
}: {
  icon: ReactNode
  title: string
  description: string
  error: string | null
  onEscape(): void
  children?: ReactNode
  actions: ReactNode
}): ReactNode {
  const titleId = 'server-request-title'
  const descriptionId = 'server-request-description'
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (document.body.dataset.windowCloseActive || event.key !== 'Escape') return
    event.preventDefault()
    onEscape()
  }

  return (
    <div className="approval-backdrop" role="presentation">
      <section
        className="approval-dialog server-request-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
      >
        <div className="approval-icon">{icon}</div>
        <div className="approval-copy">
          <h3 id={titleId}>{title}</h3>
          <p id={descriptionId}>{description}</p>
        </div>
        {children}
        {error && (
          <p className="request-response-error" role="alert">
            {error}
          </p>
        )}
        <div className="approval-actions">{actions}</div>
      </section>
    </div>
  )
}

function ApprovalDialog({
  request,
  busy,
  error,
  onRespond
}: ServerRequestDialogProps): ReactNode {
  const params = requestParams(request)
  const choices = approvalChoices(request)
  const command = Array.isArray(params.command)
    ? params.command.filter((part): part is string => typeof part === 'string').join(' ')
    : stringValue(params.command)
  const reason = stringValue(params.reason)
  const cwd = stringValue(params.cwd)
  const grantRoot = stringValue(params.grantRoot)
  const itemId = stringValue(params.itemId)
  const kind = stringValue(params.kind)
  const isFileChange =
    request.method === 'item/fileChange/requestApproval' || request.method === 'applyPatchApproval'
  const fileChanges = record(params.fileChanges)
  const paths = fileChanges ? Object.keys(fileChanges) : []
  const commandActions = Array.isArray(params.commandActions)
    ? params.commandActions.flatMap((value) => {
        const action = record(value)
        return typeof action?.command === 'string' ? [action.command] : []
      })
    : []
  const detail = command || commandActions.join('\n') || paths.join('\n') || grantRoot || itemId || cwd
  const fallback = choices.find((choice) => choice.key === 'cancel') ||
    choices.find((choice) => choice.key === 'decline')
  const focusedChoice = choices.find((choice) => choice.key === 'accept') ||
    choices.find((choice) => choice.key === 'decline') || choices[0]

  const respond = (choice: ApprovalChoice): void => {
    onRespond(buildApprovalResponse(request, choice.decision))
  }

  if (!choices.length) {
    return (
      <DialogFrame
        icon={isFileChange ? <FileDiff /> : <TerminalSquare />}
        title="不支持的批准请求"
        description="服务器未提供此客户端可以安全返回的决定。"
        error={error}
        onEscape={() => onRespond(invalidServerRequestResponse(request))}
        actions={
          <button
            type="button"
            className="approval-deny"
            disabled={busy}
            autoFocus
            onClick={() => onRespond(invalidServerRequestResponse(request))}
          >
            拒绝请求
          </button>
        }
      />
    )
  }

  return (
    <DialogFrame
      icon={isFileChange ? <FileDiff /> : <TerminalSquare />}
      title={
        isFileChange
          ? '允许更改文件吗？'
          : kind === 'writeStdin'
            ? '向此终端发送输入吗？'
            : '运行此命令吗？'
      }
      description={reason || 'Codex 需要你的批准才能继续。'}
      error={error}
      onEscape={() => fallback && respond(fallback)}
      actions={choices.map((choice, index) => (
        <button
          key={choice.key}
          type="button"
          className={
            choice.tone === 'danger'
              ? index === 0 ? 'approval-deny' : 'approval-danger'
              : choice.tone === 'primary'
                ? 'approval-primary'
                : undefined
          }
          disabled={busy}
          autoFocus={choice.key === focusedChoice.key}
          onClick={() => respond(choice)}
        >
          {approvalChoiceLabel(choice)}
        </button>
      ))}
    >
      {detail && <pre>{detail}</pre>}
      {cwd && command && <p className="request-context-line">工作目录：{cwd}</p>}
    </DialogFrame>
  )
}

interface QuestionState {
  selected: string
  other: string
  text: string
}

const otherAnswer = '__codex_other_answer__'

function initialQuestionState(questions: UserInputQuestion[]): Record<string, QuestionState> {
  return Object.fromEntries(
    questions.map((question) => [question.id, { selected: '', other: '', text: '' }])
  )
}

function UserInputDialog({
  request,
  busy,
  error,
  onRespond
}: ServerRequestDialogProps): ReactNode {
  const questions = useMemo(() => parseUserInputQuestions(request), [request])
  const [answers, setAnswers] = useState<Record<string, QuestionState>>(() =>
    initialQuestionState(questions || [])
  )

  if (!questions) {
    return (
      <DialogFrame
        icon={<MessageCircleQuestion />}
        title="无效的输入请求"
        description="服务器发送了一组此客户端无法验证的问题。"
        error={error}
        onEscape={() => onRespond(invalidServerRequestResponse(request))}
        actions={
          <button
            type="button"
            className="approval-deny"
            disabled={busy}
            autoFocus
            onClick={() => onRespond(invalidServerRequestResponse(request))}
          >
            拒绝请求
          </button>
        }
      />
    )
  }

  const valueFor = (question: UserInputQuestion): string => {
    const state = answers[question.id]
    if (!state) return ''
    if (!question.options.length) return state.text
    return state.selected === otherAnswer ? state.other : state.selected
  }
  const complete = questions.every((question) => valueFor(question).trim().length > 0)

  const update = (id: string, patch: Partial<QuestionState>): void => {
    setAnswers((current) => ({
      ...current,
      [id]: { ...current[id], ...patch }
    }))
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!complete || busy) return
    onRespond(
      buildUserInputResponse(
        Object.fromEntries(questions.map((question) => [question.id, [valueFor(question)]]))
      )
    )
  }
  const cancel = (): void => onRespond(declinedRequestResponse(request, 'user_input'))

  return (
    <form onSubmit={submit}>
      <DialogFrame
        icon={<MessageCircleQuestion />}
        title="Codex 需要你的输入"
        description="回答以下问题以继续当前任务。"
        error={error}
        onEscape={cancel}
        actions={
          <>
            <button type="button" className="approval-deny" disabled={busy} onClick={cancel}>
              取消
            </button>
            <button
              type="submit"
              className="approval-primary"
              disabled={busy || !complete}
            >
              提交回答
            </button>
          </>
        }
      >
        <div className="request-form-fields">
          {questions.map((question, questionIndex) => {
            const state = answers[question.id]
            return (
              <fieldset className="request-fieldset" key={question.id}>
                <legend>
                  <span>{question.header}</span>
                  <small>第 {questionIndex + 1} 个，共 {questions.length} 个</small>
                </legend>
                <p>{question.question}</p>
                {question.options.length ? (
                  <div className="request-option-list">
                    {question.options.map((option, index) => (
                      <label className="request-option" key={`${option.label}-${index}`}>
                        <input
                          type="radio"
                          name={`question-${question.id}`}
                          value={option.label}
                          checked={state?.selected === option.label}
                          autoFocus={questionIndex === 0 && index === 0}
                          onChange={() => update(question.id, { selected: option.label })}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </label>
                    ))}
                    {question.isOther && (
                      <label className="request-option request-option-other">
                        <input
                          type="radio"
                          name={`question-${question.id}`}
                          value={otherAnswer}
                          checked={state?.selected === otherAnswer}
                          onChange={() => update(question.id, { selected: otherAnswer })}
                        />
                        <span><strong>其他</strong></span>
                      </label>
                    )}
                    {question.isOther && state?.selected === otherAnswer && (
                      <input
                        className="request-text-input"
                        type={question.isSecret ? 'password' : 'text'}
                        value={state.other}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`${question.header}的其他回答`}
                        placeholder="输入你的回答"
                        onChange={(event) => update(question.id, { other: event.target.value })}
                      />
                    )}
                  </div>
                ) : (
                  <input
                    className="request-text-input"
                    type={question.isSecret ? 'password' : 'text'}
                    value={state?.text || ''}
                    autoFocus={questionIndex === 0}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={question.header}
                    placeholder={question.isSecret ? '安全输入' : '输入你的回答'}
                    onChange={(event) => update(question.id, { text: event.target.value })}
                  />
                )}
              </fieldset>
            )
          })}
        </div>
      </DialogFrame>
    </form>
  )
}

interface McpField {
  name: string
  title: string
  description: string | null
  required: boolean
  schema: Record<string, unknown>
}

interface McpOption {
  value: string
  label: string
}

function mcpOptions(schema: Record<string, unknown>): McpOption[] {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.flatMap((value) => {
      const option = record(value)
      return typeof option?.const === 'string'
        ? [{ value: option.const, label: stringValue(option.title) || option.const }]
        : []
    })
  }
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : []
    return schema.enum.flatMap((value, index) =>
      typeof value === 'string'
        ? [{ value, label: typeof names[index] === 'string' ? names[index] : value }]
        : []
    )
  }
  return []
}

function mcpArrayOptions(schema: Record<string, unknown>): McpOption[] {
  const items = record(schema.items)
  if (!items) return []
  if (Array.isArray(items.anyOf)) {
    return items.anyOf.flatMap((value) => {
      const option = record(value)
      return typeof option?.const === 'string'
        ? [{ value: option.const, label: stringValue(option.title) || option.const }]
        : []
    })
  }
  return mcpOptions(items)
}

function parseMcpFields(params: Record<string, unknown>): McpField[] | null {
  const schema = record(params.requestedSchema)
  const properties = record(schema?.properties)
  if (!schema || !properties) return null
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === 'string')
      : []
  )
  return Object.entries(properties).flatMap(([name, value]) => {
    const fieldSchema = record(value)
    if (!fieldSchema) return []
    return [{
      name,
      title: stringValue(fieldSchema.title) || name,
      description: stringValue(fieldSchema.description),
      required: required.has(name),
      schema: fieldSchema
    }]
  })
}

function initialMcpValues(fields: McpField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.schema.default !== undefined && field.schema.default !== null
        ? [[field.name, field.schema.default]]
        : field.required && field.schema.type === 'boolean'
          ? [[field.name, false]]
        : []
    )
  )
}

function mcpValueIsValid(field: McpField, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return !field.required
  if (field.schema.type === 'number' || field.schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
    if (typeof field.schema.minimum === 'number' && value < field.schema.minimum) return false
    if (typeof field.schema.maximum === 'number' && value > field.schema.maximum) return false
  }
  if (field.schema.type === 'array') {
    if (!Array.isArray(value)) return false
    if (typeof field.schema.minItems === 'number' && value.length < field.schema.minItems) return false
    if (typeof field.schema.maxItems === 'number' && value.length > field.schema.maxItems) return false
  }
  if (typeof value === 'string') {
    if (typeof field.schema.minLength === 'number' && value.length < field.schema.minLength) return false
    if (typeof field.schema.maxLength === 'number' && value.length > field.schema.maxLength) return false
  }
  return true
}

function McpElicitationDialog({
  request,
  busy,
  error,
  onRespond
}: ServerRequestDialogProps): ReactNode {
  const params = requestParams(request)
  const message = stringValue(params.message) || 'MCP 服务器正在请求信息。'
  const mode = stringValue(params.mode) || '未知'
  const fields = useMemo(() => parseMcpFields(params), [request])
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialMcpValues(fields || [])
  )
  const formMode = ['form', 'openai/form', 'openaiForm'].includes(mode) && fields !== null
  const complete = formMode && fields.every((field) => mcpValueIsValid(field, values[field.name]))
  const cancel = (): void => onRespond(buildMcpElicitationResponse('cancel'))
  const decline = (): void => onRespond(buildMcpElicitationResponse('decline'))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!complete || busy) return
    const content = Object.fromEntries(
      fields
        .filter((field) => values[field.name] !== undefined && values[field.name] !== '')
        .map((field) => [field.name, values[field.name]])
    )
    onRespond(buildMcpElicitationResponse('accept', content))
  }

  const renderField = (field: McpField, index: number): ReactNode => {
    const type = field.schema.type
    const value = values[field.name]
    const update = (next: unknown): void => setValues((current) => ({ ...current, [field.name]: next }))
    const options = mcpOptions(field.schema)
    const arrayOptions = mcpArrayOptions(field.schema)

    if (type === 'boolean') {
      return (
        <label className="request-checkbox" key={field.name}>
          <input
            type="checkbox"
            checked={value === true}
            autoFocus={index === 0}
            onChange={(event) => update(event.target.checked)}
          />
          <span>{field.title}{field.required ? ' *' : ''}</span>
        </label>
      )
    }

    if (type === 'array' && arrayOptions.length) {
      const selected = Array.isArray(value) ? value : []
      return (
        <fieldset className="request-fieldset compact" key={field.name}>
          <legend>{field.title}{field.required ? ' *' : ''}</legend>
          {field.description && <p>{field.description}</p>}
          <div className="request-option-list">
            {arrayOptions.map((option, optionIndex) => (
              <label className="request-option" key={option.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  autoFocus={index === 0 && optionIndex === 0}
                  onChange={(event) => update(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value)
                  )}
                />
                <span><strong>{option.label}</strong></span>
              </label>
            ))}
          </div>
        </fieldset>
      )
    }

    return (
      <label className="request-input-label" key={field.name}>
        <span>{field.title}{field.required ? ' *' : ''}</span>
        {field.description && <small>{field.description}</small>}
        {options.length ? (
          <select
            className="request-text-input"
            value={typeof value === 'string' ? value : ''}
            required={field.required}
            autoFocus={index === 0}
            onChange={(event) => update(event.target.value)}
          >
            <option value="">选择一个选项</option>
            {options.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        ) : (
          <input
            className="request-text-input"
            type={
              type === 'number' || type === 'integer'
                ? 'number'
                : field.schema.format === 'email'
                  ? 'email'
                  : field.schema.format === 'uri'
                    ? 'url'
                    : field.schema.format === 'date'
                      ? 'date'
                      : field.schema.format === 'date-time'
                        ? 'datetime-local'
                        : 'text'
            }
            value={typeof value === 'string' || typeof value === 'number' ? value : ''}
            required={field.required}
            min={typeof field.schema.minimum === 'number' ? field.schema.minimum : undefined}
            max={typeof field.schema.maximum === 'number' ? field.schema.maximum : undefined}
            minLength={typeof field.schema.minLength === 'number' ? field.schema.minLength : undefined}
            maxLength={typeof field.schema.maxLength === 'number' ? field.schema.maxLength : undefined}
            autoFocus={index === 0}
            onChange={(event) => update(
              type === 'number' || type === 'integer'
                ? event.target.value === '' ? undefined : Number(event.target.value)
                : event.target.value
            )}
          />
        )}
      </label>
    )
  }

  return (
    <form onSubmit={submit}>
      <DialogFrame
        icon={<KeyRound />}
        title="MCP 服务器请求"
        description={message}
        error={error}
        onEscape={cancel}
        actions={
          <>
            <button
              type="button"
              className="approval-deny"
              disabled={busy}
              autoFocus={!formMode}
              onClick={decline}
            >
              拒绝
            </button>
            <button type="button" disabled={busy} onClick={cancel}>取消</button>
            {formMode && (
              <button
                type="submit"
                className="approval-primary"
                disabled={busy || !complete}
              >
                提交
              </button>
            )}
          </>
        }
      >
        {formMode ? (
          <div className="request-form-fields">{fields.map(renderField)}</div>
        ) : (
          <div className="request-unsupported-mode">
            <strong>{mode}</strong>
            <span>当前版本无法安全接受这种请求模式。</span>
            {stringValue(params.url) && <code>{stringValue(params.url)}</code>}
          </div>
        )}
      </DialogFrame>
    </form>
  )
}

function permissionSummary(permissions: Record<string, unknown>): string {
  const lines: string[] = []
  const fileSystem = record(permissions.fileSystem)
  const network = record(permissions.network)
  if (network?.enabled === true) lines.push('网络访问')
  for (const mode of ['read', 'write'] as const) {
    const paths = fileSystem?.[mode]
    if (Array.isArray(paths)) {
      const label = mode === 'read' ? '读取' : '写入'
      for (const path of paths) if (typeof path === 'string') lines.push(`${label}：${path}`)
    }
  }
  if (Array.isArray(fileSystem?.entries)) {
    for (const value of fileSystem.entries) {
      const entry = record(value)
      const path = record(entry?.path)
      const renderedPath = stringValue(path?.path) || stringValue(path?.pattern) ||
        stringValue(record(path?.value)?.kind) || '自定义路径'
      lines.push(`${stringValue(entry?.access) || '访问'}：${renderedPath}`)
    }
  }
  return lines.length ? lines.join('\n') : JSON.stringify(permissions, null, 2)
}

function PermissionsDialog({
  request,
  busy,
  error,
  onRespond
}: ServerRequestDialogProps): ReactNode {
  const params = requestParams(request)
  const permissions = record(params.permissions)
  if (!permissions) {
    return (
      <DialogFrame
        icon={<ShieldAlert />}
        title="无效的权限请求"
        description="请求中未包含有效的权限配置。"
        error={error}
        onEscape={() => onRespond(invalidServerRequestResponse(request))}
        actions={
          <button
            type="button"
            className="approval-deny"
            disabled={busy}
            autoFocus
            onClick={() => onRespond(invalidServerRequestResponse(request))}
          >
            拒绝请求
          </button>
        }
      />
    )
  }

  const decline = (): void => onRespond(declinedRequestResponse(request, 'permissions'))
  return (
    <DialogFrame
      icon={<ShieldAlert />}
      title="授予额外权限吗？"
      description={stringValue(params.reason) || 'Codex 请求了超出当前配置的访问权限。'}
      error={error}
      onEscape={decline}
      actions={
        <>
          <button
            type="button"
            className="approval-deny"
            disabled={busy}
            autoFocus
            onClick={decline}
          >
            拒绝
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRespond(buildPermissionsApprovalResponse(request, 'session'))}
          >
            本次会话中允许
          </button>
          <button
            type="button"
            className="approval-primary"
            disabled={busy}
            onClick={() => onRespond(buildPermissionsApprovalResponse(request, 'turn'))}
          >
            本轮允许
          </button>
        </>
      }
    >
      <pre>{permissionSummary(permissions)}</pre>
      {stringValue(params.cwd) && (
        <p className="request-context-line">工作区：{stringValue(params.cwd)}</p>
      )}
    </DialogFrame>
  )
}

export function ServerRequestDialog(props: ServerRequestDialogProps): ReactNode {
  switch (props.request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return <ApprovalDialog {...props} />
    case 'item/tool/requestUserInput':
      return <UserInputDialog {...props} />
    case 'mcpServer/elicitation/request':
      return <McpElicitationDialog {...props} />
    case 'item/permissions/requestApproval':
      return <PermissionsDialog {...props} />
    default:
      return null
  }
}

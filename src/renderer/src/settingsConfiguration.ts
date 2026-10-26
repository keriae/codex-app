export type ConfigurationKey =
  | 'approval_policy'
  | 'sandbox_mode'
  | 'web_search'
  | 'model_verbosity'
  | 'model_reasoning_summary'
  | 'sandbox_workspace_write.network_access'

export interface ConfigurationSnapshot {
  values: Record<ConfigurationKey, string | boolean | null>
  readOnly: ConfigurationKey[]
}

export const CONFIGURATION_DEFAULTS: ConfigurationSnapshot['values'] = {
  approval_policy: 'on-request',
  sandbox_mode: 'read-only',
  web_search: 'cached',
  model_verbosity: null,
  model_reasoning_summary: 'auto',
  'sandbox_workspace_write.network_access': false
}

const allowedValues: Record<ConfigurationKey, readonly unknown[]> = {
  approval_policy: ['on-request', 'on-failure', 'untrusted', 'never', null],
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access', null],
  web_search: ['disabled', 'cached', 'live', null],
  model_verbosity: ['low', 'medium', 'high', null],
  model_reasoning_summary: ['auto', 'concise', 'detailed', 'none', null],
  'sandbox_workspace_write.network_access': [true, false, null]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeConfiguration(value: unknown): ConfigurationSnapshot {
  if (!isRecord(value) || !isRecord(value.config)) {
    throw new Error('Codex Server 返回了无效的配置。')
  }
  const values = { ...CONFIGURATION_DEFAULTS }
  const readOnly: ConfigurationKey[] = []
  for (const key of Object.keys(values) as ConfigurationKey[]) {
    const candidate = key.includes('.')
      ? (isRecord(value.config.sandbox_workspace_write) ? value.config.sandbox_workspace_write.network_access : null)
      : value.config[key]
    if (candidate !== undefined && !(candidate === null && (key === 'approval_policy' || key === 'sandbox_mode')) && allowedValues[key].includes(candidate)) {
      values[key] = candidate as string | boolean | null
    }
    const origin = isRecord(value.origins) ? value.origins[key] : null
    const source = isRecord(origin) ? origin.source : null
    if (isRecord(source) && ['mdm', 'enterpriseManaged', 'legacyManagedConfigTomlFromMdm', 'legacyManagedConfigTomlFromFile'].includes(String(source.type))) readOnly.push(key)
  }
  return { values, readOnly }
}

export function configurationWriteParams(key: ConfigurationKey, value: unknown): {
  keyPath: ConfigurationKey
  value: string | boolean | null
  mergeStrategy: 'replace'
} {
  if (!allowedValues[key].includes(value)) throw new Error('无效的配置选项。')
  return { keyPath: key, value: value as string | boolean | null, mergeStrategy: 'replace' }
}

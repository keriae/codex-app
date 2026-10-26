import { describe, expect, it } from 'vitest'
import { configurationWriteParams, normalizeConfiguration } from './settingsConfiguration'

describe('settings configuration protocol', () => {
  it('reads effective settings, sandbox networking and enterprise constraints', () => {
    const snapshot = normalizeConfiguration({ config: {
      approval_policy: 'never', sandbox_mode: 'workspace-write',
      sandbox_workspace_write: { network_access: true },
      web_search: 'live', model_verbosity: 'high', model_reasoning_summary: 'detailed'
    }, origins: {
      approval_policy: { source: { type: 'enterpriseManaged' } },
      sandbox_mode: { source: { type: 'system' } }
    } })
    expect(snapshot.values.approval_policy).toBe('never')
    expect(snapshot.values['sandbox_workspace_write.network_access']).toBe(true)
    expect(snapshot.values.model_reasoning_summary).toBe('detailed')
    expect(snapshot.readOnly).toEqual(['approval_policy'])
  })

  it('keeps default permissions when optional server values are unset', () => {
    const snapshot = normalizeConfiguration({ config: { approval_policy: null, sandbox_mode: null, model_verbosity: null } })
    expect(snapshot.values.approval_policy).toBe('on-request')
    expect(snapshot.values.sandbox_mode).toBe('read-only')
    expect(snapshot.values.model_verbosity).toBeNull()
    expect(() => normalizeConfiguration({ data: [] })).toThrow('无效的配置')
  })

  it('writes only supported settings with the server merge strategy', () => {
    expect(configurationWriteParams('model_verbosity', null)).toEqual({ keyPath: 'model_verbosity', value: null, mergeStrategy: 'replace' })
    expect(configurationWriteParams('sandbox_workspace_write.network_access', true).value).toBe(true)
    expect(() => configurationWriteParams('approval_policy', 'sometimes')).toThrow('无效')
    expect(() => configurationWriteParams('sandbox_workspace_write.network_access', 'true')).toThrow('无效')
  })
})

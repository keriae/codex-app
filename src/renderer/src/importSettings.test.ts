import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExternalAgentImportApi, ExternalAgentImportPreferences } from '../../shared/api'
import { ImportReviewDialog, ImportSettingsView } from './ImportSettings'
import { INITIAL_IMPORT_STATE, type ImportState } from './importController'

const api = {} as ExternalAgentImportApi // Static rendering never calls the native bridge.
const preferences: ExternalAgentImportPreferences = { syncEnabled: false, syncItemTypes: null, providers: [], sessionLimits: { maxSessionAgeMs: 2592000000, maxSessionsPerSpace: 50 }, lastSyncAtMs: null, lastSyncError: null }
function render(state: Partial<ImportState>, connected = true): string {
  return renderToStaticMarkup(createElement(ImportSettingsView, { state: { ...INITIAL_IMPORT_STATE, preferences, ...state }, connected, api, onRefresh() {}, onImport() {}, onCancel() {}, onSetSync: async () => true }))
}
describe('import page state rendering', () => {
  it('ends checking when real detection finds no setup', () => {
    const html = render({ detection: { items: [], unsupportedProjects: [], providers: [], connectors: [] } })
    expect(html).toContain('未找到可导入的设置')
    expect(html).not.toContain('正在检查导入项')
    expect(html).toContain('disabled=""')
  })

  it('shows a retryable detection error instead of an endless spinner', () => {
    const html = render({ errors: { detection: 'Fixture detection failed' } })
    expect(html).toContain('无法检查导入项')
    expect(html).toContain('Fixture detection failed')
    expect(html).toContain('重试')
    expect(html).not.toContain('正在检查导入项')
  })

  it('shows editable provider icons and native unsupported-project diagnostics', () => {
    const html = render({ detection: { items: [{ providerId: 'cursor', itemType: 'CONFIG', cwd: null, description: 'Fixture', details: null }], providers: [{ providerId: 'claude-cowork', status: 'unavailable', message: 'Fixture unavailable', warnings: ['Fixture cloud sessions unavailable'] }], unsupportedProjects: [{ name: 'Fixture project', reason: 'Fixture unsupported', sourceFolders: [] }], connectors: [] } })
    expect(html).toContain('Cursor')
    expect(html).toContain('lucide-mouse-pointer2')
    expect(html).toContain('Fixture unsupported')
    expect(html).toContain('Fixture unavailable')
    expect(html).toContain('Fixture cloud sessions unavailable')
    expect(html).not.toContain('✳')
  })

  it('does not call an empty completed result successful', () => {
    const html = render({ operation: { importAttemptId: 'fixture', items: [], startedAtMs: 0, progress: { importAttemptId: 'fixture', phase: 'completed' }, result: { importedProjectIds: [], importedSessionThreadIds: [], projectRoots: [], itemTypeResults: [], canceled: false } } })
    expect(html).toContain('未记录结果')
    expect(html).not.toContain('已导入外部智能体配置')
  })

  it('does not count failed history or an unverified status timestamp as a successful import', () => {
    const state: Partial<ImportState> = { detection: { items: [], providers: [], unsupportedProjects: [], connectors: [] }, status: { importedSessionCount: 0, latestImportedAtMs: 1000 }, history: { data: [{ completedAtMs: 1000, importId: 'fixture-failed', providerId: 'claude-code', successes: [], failures: [{ itemType: 'CONFIG', failureStage: 'write', message: 'Fixture failure' }] }], connectors: [] } }
    for (const history of [state.history, null]) {
      const html = render({ ...state, history })
      expect(html).toContain('未找到可导入的设置')
      expect(html).not.toContain('未找到新项目')
      expect(html).not.toContain('上次导入时间')
    }
  })

  it('shows explicit disconnected state without starting a detection spinner', () => {
    expect(render({}, false)).toContain('Codex Server 尚未连接')
    expect(render({}, false)).not.toContain('正在检查导入项')
  })

  it('renders accessible review controls from synthetic setup items', () => {
    const html = renderToStaticMarkup(createElement(ImportReviewDialog, { items: [{ providerId: 'claude-code', itemType: 'CONFIG', cwd: null, description: 'Fixture', details: null }], providers: ['claude-code'], operation: null, onImport() {}, onClose() {}, onViewImported() {} }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('选择要导入的项目')
    expect(html).toContain('工具和设置')
    expect(html).toContain('导入到 ChatGPT')
  })
})

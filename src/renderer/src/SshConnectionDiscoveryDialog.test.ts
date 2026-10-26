import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  selectableSshAliases,
  sshDiscoveryEndpoint,
  SshConnectionDiscoveryDialog,
  type SshConnectionDiscoveryDialogProps
} from './SshConnectionDiscoveryDialog'

const aliases = [
  { displayName: 'Build host', sshAlias: 'build', host: 'builder.internal', port: 2222 },
  { displayName: 'Production', sshAlias: 'prod', host: 'prod.internal', identityFile: '~/.ssh/id_ed25519' },
  { displayName: 'Already added', sshAlias: 'saved', host: 'saved.internal', configured: true }
]

function render(overrides: Partial<SshConnectionDiscoveryDialogProps> = {}): string {
  return renderToStaticMarkup(createElement(SshConnectionDiscoveryDialog, {
    aliases,
    open: true,
    selectedAliases: ['build'],
    onToggleAlias: vi.fn(),
    onRefresh: vi.fn(),
    onAddManually: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }))
}

describe('SSH connection discovery dialog', () => {
  it('formats resolved SSH endpoints', () => {
    expect(sshDiscoveryEndpoint({host: 'builder.internal', port: 2222})).toBe('builder.internal:2222')
    expect(sshDiscoveryEndpoint({host: 'prod.internal'})).toBe('prod.internal')
  })

  it('keeps only selectable discovered aliases in the selection', () => {
    expect(selectableSshAliases(aliases, ['build', 'saved', 'missing'])).toEqual(['build'])
  })

  it('renders the original discovery actions and accessible multi-select rows', () => {
    const html = render()
    expect(html).toContain('添加 SSH 连接')
    expect(html).toContain('SSH 配置')
    expect(html).toContain('刷新')
    expect(html).toContain('手动添加')
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('builder.internal:2222')
    expect(html).toContain('~/.ssh/id_ed25519')
    expect(html).toContain('已添加')
  })

  it('disables saving when no new alias is selected', () => {
    const html = render({selectedAliases: ['saved']})
    expect(html).toMatch(/class="ssh-discovery-save" disabled=""/u)
  })

  it('shows refresh and manual-add actions in the empty state', () => {
    const html = render({aliases: [], selectedAliases: []})
    expect(html).toContain('未找到 SSH 连接')
    expect(html).toContain('请检查 ~/.ssh/config，或手动添加主机。')
    expect(html).toContain('手动添加')
  })

  it('shows progress, errors, and hides itself when closed', () => {
    const html = render({refreshing: true, saving: true, error: '读取 SSH 配置失败'})
    expect(html).toContain('正在刷新…')
    expect(html).toContain('正在添加…')
    expect(html).toContain('读取 SSH 配置失败')
    expect(render({open: false})).toBe('')
  })
})

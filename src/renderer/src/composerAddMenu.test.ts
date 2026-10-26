import { describe, expect, it } from 'vitest'
import {
  composerAddMenuEntries,
  composerContextSegments,
  nextEnabledComposerAddMenuIndex
} from './ComposerAddMenu'

describe('composerContextSegments', () => {
  it('describes the project, local host, and branch from AppContext', () => {
    expect(
      composerContextSegments({
        cwd: '/Users/example/src/codex-app',
        folderName: 'codex-app',
        branch: 'main',
        platform: 'darwin'
      })
    ).toEqual([
      {
        id: 'project',
        label: 'codex-app',
        title: '/Users/example/src/codex-app'
      },
      { id: 'local', label: '本地', title: undefined },
      { id: 'branch', label: 'main' }
    ])
  })

  it('keeps the directory picker available before context has loaded', () => {
    expect(composerContextSegments(null)).toEqual([
      { id: 'project', label: '选择文件夹', title: undefined },
      { id: 'local', label: '本地', title: undefined }
    ])
  })

  it('shows the remote host and projectless chat labels', () => {
    expect(composerContextSegments({
      cwd: '/srv/codex-app', folderName: 'codex-app', branch: 'main', platform: 'darwin',
      hostId: 'remote-one', hostDisplayName: '构建机', projectKind: 'remote'
    })).toEqual([
      { id: 'project', label: 'codex-app', title: '/srv/codex-app' },
      { id: 'local', label: '构建机', title: '构建机' },
      { id: 'branch', label: 'main' }
    ])
    expect(composerContextSegments({
      cwd: '/Users/example', folderName: 'example', branch: null, platform: 'darwin',
      hostId: 'local', projectKind: 'projectless'
    })[0]).toEqual({ id: 'project', label: '选择项目', title: undefined })
  })
})

describe('composerAddMenuEntries', () => {
  it('matches the two measured groups and their ordering', () => {
    const entries = composerAddMenuEntries()

    expect(entries.filter((entry) => entry.group === 'add').map((entry) => entry.label))
      .toEqual([
        '文件和文件夹',
        '附加 Electron',
        '在项目中使用 Work',
        '目标',
        '计划模式',
        '绘图'
      ])
    expect(entries.filter((entry) => entry.group === 'plugins').map((entry) => entry.label))
      .toEqual([
        'Documents',
        'PDF',
        'Spreadsheets',
        'Presentations',
        'Template Creator',
        '浏览器',
        '电脑',
        'LaTeX',
        'Visualize',
        'Zotero'
      ])
  })

  it('retains the observed secondary labels', () => {
    const byId = new Map(composerAddMenuEntries().map((entry) => [entry.id, entry]))

    expect(byId.get('work-project')?.description).toBe('为新聊天选择项目')
    expect(byId.get('goal')?.description).toBe('设置要持续追求的目标')
    expect(byId.get('plan')?.description).toBe('开启计划模式')
    expect(byId.get('drawing')?.description).toBe('绘制草图')
  })

  it('enables every action exposed by the measured desktop build', () => {
    const enabled = composerAddMenuEntries().filter((entry) => !entry.disabled)

    expect(enabled).toHaveLength(composerAddMenuEntries().length)
    expect(enabled).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'attachments', action: 'attachments' }),
      expect.objectContaining({ id: 'attach-codex', action: 'attach-electron' }),
      expect.objectContaining({ id: 'work-project', action: 'work-project' }),
      expect.objectContaining({ id: 'goal', action: 'goal' }),
      expect.objectContaining({ id: 'plan', action: 'plan' }),
      expect.objectContaining({ id: 'drawing', action: 'drawing' })
    ]))
    expect(
      composerAddMenuEntries()
        .filter((entry) => entry.group === 'plugins')
        .every((entry) => !entry.disabled && entry.action === 'plugin' && entry.pluginId)
    ).toBe(true)
  })

  it('returns fresh entries so callers cannot mutate the shared model', () => {
    const first = composerAddMenuEntries()
    first[0].label = 'changed'

    expect(composerAddMenuEntries()[0].label).toBe('文件和文件夹')
  })

  it('filters actions for composers with a smaller capability set', () => {
    const entries = composerAddMenuEntries([
      'attachments',
      'attach-electron',
      'drawing',
      'plugin'
    ])

    expect(entries.filter((entry) => entry.group === 'add').map((entry) => entry.id))
      .toEqual(['attachments', 'attach-codex', 'drawing'])
    expect(entries.filter((entry) => entry.group === 'plugins'))
      .toHaveLength(10)
    expect(entries.some((entry) => (
      entry.action === 'work-project' || entry.action === 'goal' || entry.action === 'plan'
    ))).toBe(false)
  })
})

describe('nextEnabledComposerAddMenuIndex', () => {
  const disabled = [false, true, false, true]

  it('wraps while skipping disabled placeholders', () => {
    expect(nextEnabledComposerAddMenuIndex(2, disabled, 1)).toBe(0)
    expect(nextEnabledComposerAddMenuIndex(0, disabled, -1)).toBe(2)
  })

  it('opens at the first or last enabled item', () => {
    expect(nextEnabledComposerAddMenuIndex(-1, disabled, 1)).toBe(0)
    expect(nextEnabledComposerAddMenuIndex(-1, disabled, -1)).toBe(2)
  })

  it('returns no focus target when every item is disabled', () => {
    expect(nextEnabledComposerAddMenuIndex(-1, [true, true], 1)).toBe(-1)
  })
})

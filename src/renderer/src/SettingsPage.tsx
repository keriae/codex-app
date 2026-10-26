import {
  AppWindow,
  Archive,
  AtSign,
  Bot,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  Folder,
  Gauge,
  GitBranch,
  Globe2,
  HardDrive,
  Image,
  Keyboard,
  Link2,
  ListFilter,
  Mic2,
  Monitor,
  MousePointer2,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppContext,
  BackendStatus,
  ExternalAgentImportResult,
  GitMetadata,
  RemoteConnection,
  SaveRemoteConnectionOptions
} from '../../shared/api'
import type { Thread } from './protocol'
import { ArchivedSettings } from './ArchivedSettings'
import { RemoteConnectionDialog } from './RemoteConnectionDialog'
import {
  SshConnectionDiscoveryDialog,
  type SshDiscoveryAlias
} from './SshConnectionDiscoveryDialog'
import { SettingsSelect, SettingsSegmented } from './SettingsControls'
import { DEFAULT_DESKTOP_SETTINGS, updateDesktopSettings, useDesktopSettings, type AppearanceMode, type DesktopSettings } from './desktopSettings'
import { CONFIGURATION_DEFAULTS, configurationWriteParams, normalizeConfiguration, type ConfigurationKey, type ConfigurationSnapshot } from './settingsConfiguration'
import { sanitizeIntegrationDiagnostic } from './integrationModels'
import { SettingsIntegrations } from './SettingsIntegrations'
import { ImportSettings, type ImportIntegrationTab } from './ImportSettings'

type Theme = 'dark' | 'light'

const SETTINGS_DOCS = {
  permissions: 'https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it',
  configuration: 'https://developers.openai.com/codex/config-basic',
  memories: 'https://developers.openai.com/codex/memories',
  agents: 'https://developers.openai.com/codex/guides/agents-md/#create-global-guidance',
  browserExtension: 'https://developers.openai.com/codex/app/chrome-extension',
  hooks: 'https://developers.openai.com/codex/hooks',
  remoteConnections: 'https://developers.openai.com/codex/remote-connections#connect-to-an-ssh-host',
  environments: 'https://developers.openai.com/codex/app/local-environments'
} as const

const UNSUPPORTED_SETTING = '当前复刻版尚未接入此设置'

export type SettingsSectionId =
  | 'general'
  | 'import'
  | 'appearance'
  | 'archived'
  | 'speech'
  | 'storage'
  | 'configuration'
  | 'personalization'
  | 'mini'
  | 'shortcuts'
  | 'plugins'
  | 'computer-control'
  | 'app-snapshots'
  | 'browser'
  | 'hooks'
  | 'connections'
  | 'git'
  | 'environments'
  | 'worktrees'

interface SettingsPageProps {
  backend: BackendStatus
  context: AppContext | null
  theme: Theme
  initialSection?: SettingsSectionId
  onToggleTheme(): void
  themePreference?: AppearanceMode
  onThemePreferenceChange?(preference: AppearanceMode): void
  onThreadRestored?(thread: Thread): void
  onOpenThread?(thread: Thread): void
  projectPaths?: string[]
  onAddProject?(): void
  onNewThreadInProject?(path: string): void
  onImportCompleted?(result: ExternalAgentImportResult): void
}

interface SettingsNavItem {
  id: SettingsSectionId
  label: string
  keywords: string
  icon: LucideIcon
}

interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

const SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    label: '个人',
    items: [
      { id: 'general', label: '常规', keywords: 'general permissions notifications editor', icon: Settings },
      { id: 'import', label: '导入', keywords: 'import sync chats projects', icon: Download },
      { id: 'appearance', label: '外观', keywords: 'appearance theme color font', icon: Sun },
      { id: 'archived', label: '已归档的聊天', keywords: 'archived chats history', icon: Archive },
      { id: 'speech', label: '语音', keywords: 'speech voice dictation microphone', icon: Mic2 },
      { id: 'storage', label: '存储', keywords: 'storage files data', icon: Folder },
      { id: 'configuration', label: '配置', keywords: 'configuration permissions sandbox web model reasoning', icon: ShieldCheck },
      { id: 'personalization', label: '个性化', keywords: 'personalization memory instructions', icon: Gauge },
      { id: 'mini', label: 'Mini 与虚拟宠物', keywords: 'mini pets companion', icon: Bot },
      { id: 'shortcuts', label: '键盘快捷键', keywords: 'keyboard shortcuts hotkeys', icon: Keyboard }
    ]
  },
  {
    label: '集成',
    items: [
      { id: 'plugins', label: '插件', keywords: 'plugins skills mcp integrations', icon: AtSign },
      { id: 'computer-control', label: '电脑操控', keywords: 'computer control automation', icon: MousePointer2 },
      { id: 'app-snapshots', label: '应用快照', keywords: 'app snapshots screen capture', icon: Image },
      { id: 'browser', label: '浏览器', keywords: 'browser chrome extension', icon: AppWindow }
    ]
  },
  {
    label: '编码',
    items: [
      { id: 'hooks', label: '钩子', keywords: 'hooks lifecycle plugins', icon: CircleDot },
      { id: 'connections', label: '连接', keywords: 'connections remote ssh', icon: Globe2 },
      { id: 'git', label: 'Git', keywords: 'git source control branch', icon: GitBranch },
      { id: 'environments', label: '环境', keywords: 'environments projects workspaces', icon: Monitor },
      { id: 'worktrees', label: 'Worktrees', keywords: 'worktrees checkout branches', icon: GitBranch }
    ]
  }
]

const ALL_SECTIONS = SETTINGS_GROUPS.flatMap((group) => group.items)

function currentSectionLabel(section: SettingsSectionId): string {
  return ALL_SECTIONS.find((item) => item.id === section)?.label || '常规'
}

export function SettingsPage({
  backend,
  context,
  theme,
  initialSection = 'general',
  onToggleTheme,
  themePreference,
  onThemePreferenceChange,
  onThreadRestored,
  onOpenThread,
  projectPaths,
  onAddProject,
  onNewThreadInProject,
  onImportCompleted
}: SettingsPageProps): ReactNode {
  const [section, setSection] = useState<SettingsSectionId>(initialSection)
  const [integrationTab, setIntegrationTab] = useState<ImportIntegrationTab>('plugins')
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [section])

  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return SETTINGS_GROUPS
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(normalized)
      )
    })).filter((group) => group.items.length > 0)
  }, [query])

  return (
    <section className="settings-page" aria-label="设置">
      <aside className="settings-page-sidebar">
        <div className="settings-page-sidebar-title">
          <h1>设置</h1>
          <ListFilter aria-hidden="true" />
        </div>
        <label className="settings-page-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="搜索"
            aria-label="搜索设置"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <nav className="settings-page-nav" aria-label="设置部分">
          {groups.length ? groups.map((group) => (
            <section className="settings-page-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={section === item.id ? 'active' : undefined}
                    aria-current={section === item.id ? 'page' : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </section>
          )) : (
            <p className="settings-page-no-results">没有匹配的设置</p>
          )}
        </nav>
      </aside>
      <div ref={scrollRef} className="settings-page-scroll" data-settings-route={section}>
        <div className="settings-page-content">
          <SettingsSection
            section={section}
            backend={backend}
            context={context}
            theme={theme}
            onToggleTheme={onToggleTheme}
            themePreference={themePreference}
            onThemePreferenceChange={onThemePreferenceChange}
            onThreadRestored={onThreadRestored}
            onOpenThread={onOpenThread}
            projectPaths={projectPaths}
            onAddProject={onAddProject}
            onNewThreadInProject={onNewThreadInProject}
            onImportCompleted={onImportCompleted}
            integrationTab={integrationTab}
            onNavigateSettings={(next, tab) => { setSection(next); if (tab) setIntegrationTab(tab) }}
          />
        </div>
      </div>
    </section>
  )
}

function SettingsSection({
  section,
  backend,
  context,
  theme,
  onToggleTheme,
  themePreference,
  onThemePreferenceChange,
  onThreadRestored,
  onOpenThread,
  projectPaths,
  onAddProject,
  onNewThreadInProject,
  onImportCompleted,
  integrationTab,
  onNavigateSettings
}: SettingsPageProps & { section: SettingsSectionId; integrationTab: ImportIntegrationTab; onNavigateSettings(section: SettingsSectionId, tab?: ImportIntegrationTab): void }): ReactNode {
  switch (section) {
    case 'general':
      return <GeneralSettings context={context} />
    case 'import':
      return <ImportSettings backend={backend} workspaceRoots={projectPaths} onNavigateSettings={onNavigateSettings} onOpenThread={onOpenThread} onImportCompleted={onImportCompleted} />
    case 'appearance':
      return <AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} themePreference={themePreference} onThemePreferenceChange={onThemePreferenceChange} />
    case 'archived':
      return <ArchivedSettings backend={backend} onThreadRestored={onThreadRestored} onOpenThread={onOpenThread} />
    case 'speech':
      return <SpeechSettings />
    case 'storage':
      return <StorageSettings context={context} />
    case 'configuration':
      return <ConfigurationSettings backend={backend} />
    case 'personalization':
      return <PersonalizationSettings />
    case 'mini':
      return <MiniSettings />
    case 'shortcuts':
      return <ShortcutSettings />
    case 'plugins':
      return <SettingsIntegrations backend={backend} cwd={context?.cwd || null} initialTab={integrationTab} />
    case 'computer-control':
      return <ComputerControlSettings />
    case 'app-snapshots':
      return <AppSnapshotSettings />
    case 'browser':
      return <BrowserSettings />
    case 'hooks':
      return <HooksSettings />
    case 'connections':
      return <ConnectionsSettings />
    case 'git':
      return <GitSettings context={context} />
    case 'environments':
      return <EnvironmentSettings projectPaths={projectPaths} onAddProject={onAddProject} onNewThreadInProject={onNewThreadInProject} />
    case 'worktrees':
      return <WorktreeSettings context={context} onNewThreadInProject={onNewThreadInProject} />
    default:
      return <PageHeading title={currentSectionLabel(section)} />
  }
}

function PageHeading({ title, description }: { title: string; description?: ReactNode }): ReactNode {
  return (
    <header className="settings-page-heading">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
  )
}

function SettingsGroup({ title, children }: { title?: string; children: ReactNode }): ReactNode {
  return (
    <section className="settings-page-group">
      {title && <h3>{title}</h3>}
      <div className="settings-page-card">{children}</div>
    </section>
  )
}

function SettingsRow({
  title,
  description,
  children
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}): ReactNode {
  return (
    <div className="settings-page-row">
      <div className="settings-page-row-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      {children && <div className="settings-page-row-control">{children}</div>}
    </div>
  )
}

type BooleanSettingKey = { [Key in keyof DesktopSettings]: DesktopSettings[Key] extends boolean ? Key : never }[keyof DesktopSettings]
const BOOLEAN_SETTINGS: Record<string, BooleanSettingKey> = {
  '完整访问权限': 'fullAccessVisible',
  '默认使用完整视图': 'defaultFullView',
  '底部面板': 'bottomPanelEnabled',
  '运行时防止系统休眠': 'preventSleepWhileRunning',
  '压缩聊天历史': 'compressHistory',
  '权限通知': 'permissionNotifications',
  '问题通知': 'questionNotifications',
  'Dot 通知': 'dotNotifications'
}

function Toggle({ label, initial = false, disabled = false, checked: controlled, onChange }: { label: string; initial?: boolean; disabled?: boolean; checked?: boolean; onChange?(checked: boolean): void }): ReactNode {
  const settings = useDesktopSettings()
  const [checked, setChecked] = useState(initial)
  const settingKey = BOOLEAN_SETTINGS[label]
  const value = controlled ?? (settingKey ? settings[settingKey] : checked)
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      className={`settings-page-toggle${value ? ' checked' : ''}`}
      onClick={() => {
        if (onChange) onChange(!value)
        else if (settingKey) updateDesktopSettings({ [settingKey]: !value })
        else setChecked(!value)
      }}
    >
      <span />
    </button>
  )
}

export function SettingsPill({ children, muted = false, onClick, disabled = false, unavailableReason = UNSUPPORTED_SETTING }: { children: ReactNode; muted?: boolean; onClick?(): void; disabled?: boolean; unavailableReason?: string }): ReactNode {
  const unavailable = !onClick
  const reason = unavailable ? unavailableReason : undefined
  return <button type="button" className={`settings-page-pill${muted ? ' muted' : ''}`} disabled={disabled || unavailable} title={reason} aria-description={reason} onClick={onClick}>{children}</button>
}

function StaticPill({ children }: { children: ReactNode }): ReactNode {
  return <span className="settings-page-pill settings-page-static-pill">{children}</span>
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>
}

function ExternalPill({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return <a className="settings-page-pill settings-page-pill-link" href={href} target="_blank" rel="noreferrer">{children}</a>
}

export function UnavailableSelectPill({ children, unavailableReason = UNSUPPORTED_SETTING }: { children: ReactNode; unavailableReason?: string }): ReactNode {
  return (
    <button type="button" className="settings-page-pill" disabled title={unavailableReason} aria-description={unavailableReason}>
      {children}
      <ChevronDown aria-hidden="true" />
    </button>
  )
}

const Pill = SettingsPill
const SelectPill = UnavailableSelectPill

function GeneralSettings({ context }: { context: AppContext | null }): ReactNode {
  const settings = useDesktopSettings()
  const [directoryBusy, setDirectoryBusy] = useState(false)
  const pickDirectory = async (): Promise<void> => {
    setDirectoryBusy(true)
    try {
      const picked = await window.codex.pickDirectory()
      if (picked) updateDesktopSettings({ projectlessDirectory: picked.cwd })
    } finally {
      setDirectoryBusy(false)
    }
  }
  return (
    <>
      <PageHeading title="常规" />
      <SettingsGroup title="权限">
        <SettingsRow
          title="默认权限"
          description="默认情况下，ChatGPT 可以读取和编辑其工作空间中的文件。需要时，它可以请求额外访问权限"
        >
          <Toggle label="默认权限" initial disabled />
        </SettingsRow>
        <SettingsRow
          title="完整访问权限"
          description={<>当 ChatGPT 以完整访问权限运行时，它无需你的批准即可编辑你电脑上的任何文件，并运行可访问网络的命令。这会显著增加数据丢失、泄露或意外行为的风险。<ExternalTextLink href={SETTINGS_DOCS.permissions}>了解更多关于风险升高的信息。</ExternalTextLink></>}
        >
          <Toggle label="完整访问权限" initial />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="常规">
        <SettingsRow title="项目外聊天文件夹" description="在项目外发起的聊天，其数据的默认存储位置。">
          <span className="settings-page-path">{settings.projectlessDirectory || context?.cwd || '~/Documents/Codex'}</span>
          <Pill disabled={directoryBusy} onClick={() => void pickDirectory()}>{directoryBusy ? '正在选择…' : '更改'}</Pill>
        </SettingsRow>
        <SettingsRow title="默认文件打开位置" description="默认打开文件和文件夹的位置">
          <SettingsSelect label="默认文件打开位置" value={settings.defaultFileTarget} options={[{ value: 'terminal', label: 'Terminal' }, { value: 'finder', label: 'Finder' }]} leading={settings.defaultFileTarget === 'terminal' ? <TerminalSquare /> : <Folder />} onChange={(value) => updateDesktopSettings({ defaultFileTarget: value as DesktopSettings['defaultFileTarget'] })} />
        </SettingsRow>
        <SettingsRow title="语言" description="应用界面语言"><SettingsSelect label="语言" value={settings.language} options={[{ value: 'auto', label: '自动检测' }, { value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} onChange={(value) => updateDesktopSettings({ language: value as DesktopSettings['language'] })} /></SettingsRow>
        <SettingsRow title="在菜单栏中显示" description="关闭主窗口后，仍在 macOS 菜单栏中保留 ChatGPT">
          <Toggle label="在菜单栏中显示" initial />
        </SettingsRow>
        <SettingsRow title="关闭窗口前确认" description="使用关闭标签页的快捷键会导致窗口关闭时，显示警告">
          <SettingsSelect label="关闭窗口前确认" value={settings.closeWindowConfirmation} options={[{ value: 'shortcut', label: '仅在使用“关闭”快捷键时' }, { value: 'always', label: '始终' }, { value: 'never', label: '从不' }]} onChange={(value) => updateDesktopSettings({ closeWindowConfirmation: value as DesktopSettings['closeWindowConfirmation'] })} />
        </SettingsRow>
        <SettingsRow title="默认使用完整视图" description="新建聊天时，将聊天和内容显示在同一个标签页栏中">
          <Toggle label="默认使用完整视图" />
        </SettingsRow>
        <SettingsRow title="底部面板" description="在应用标题栏中显示底部面板控件">
          <Toggle label="底部面板" initial />
        </SettingsRow>
        <SettingsRow title="默认终端位置" description="选择终端快捷键和环境操作在何处打开终端标签页">
          <SettingsSegmented label="默认终端位置" value={settings.defaultTerminalLocation} options={[{ value: 'bottom', label: '底部' }, { value: 'right', label: '右侧' }]} onChange={(value) => updateDesktopSettings({ defaultTerminalLocation: value as DesktopSettings['defaultTerminalLocation'] })} />
        </SettingsRow>
        <SettingsRow title="运行时防止系统休眠" description="在 ChatGPT 运行任务时，让电脑保持唤醒状态">
          <Toggle label="运行时防止系统休眠" />
        </SettingsRow>
        <SettingsRow title="自动归档不活跃的聊天" description="将一段时间未活动的本地聊天归档">
          <SettingsSelect label="自动归档不活跃的聊天" value={String(settings.autoArchiveAfterDays)} options={[0, 1, 7, 14, 30, 90].map((days) => ({ value: String(days), label: days ? `${days} 天后` : '永不' }))} onChange={(value) => updateDesktopSettings({ autoArchiveAfterDays: Number(value) as DesktopSettings['autoArchiveAfterDays'] })} />
        </SettingsRow>
        <SettingsRow title="压缩本地保存的聊天历史记录" description="压缩较早的本地聊天历史记录，以节省磁盘空间。">
          <Toggle label="压缩聊天历史" initial />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="弹出窗口">
        <SettingsRow title="弹出窗口快捷键" description="为弹出窗口设置全局快捷键。不设置则保持关闭。">
          <Pill unavailableReason="当前复刻版尚未接入 macOS 全局快捷键注册">关闭</Pill>
        </SettingsRow>
        <SettingsRow title="默认使用独立聊天" description="在任何项目外开始新聊天">
          <Toggle label="默认使用独立聊天" />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="通知">
        <SettingsRow title="轮次完成通知" description="设置 ChatGPT 完成后何时提醒你"><SettingsSelect label="轮次完成通知" value={settings.turnCompletionNotifications} options={[{ value: 'always', label: '始终' }, { value: 'unfocused', label: '仅在未聚焦时' }, { value: 'never', label: '从不' }]} onChange={(value) => updateDesktopSettings({ turnCompletionNotifications: value as DesktopSettings['turnCompletionNotifications'] })} /></SettingsRow>
        <SettingsRow title="启用权限通知" description="在需要通知权限时显示提醒"><Toggle label="权限通知" initial /></SettingsRow>
        <SettingsRow title="启用问题通知" description="在需要回答问题才能继续时显示通知"><Toggle label="问题通知" initial /></SettingsRow>
        <SettingsRow title="启用 Dot 通知" description="当你的 Dot 发来消息时显示提醒"><Toggle label="Dot 通知" initial /></SettingsRow>
        <SettingsRow title="通知提示音" description="任务完成、请求权限和提问时的提示音"><SelectPill unavailableReason="当前通知桥接尚不支持选择提示音">默认</SelectPill></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function AppearanceSettings({ theme, onToggleTheme, themePreference, onThemePreferenceChange }: Pick<SettingsPageProps, 'theme' | 'onToggleTheme' | 'themePreference' | 'onThemePreferenceChange'>): ReactNode {
  const settings = useDesktopSettings()
  const [mode, setMode] = useState<AppearanceMode>(themePreference || 'system')
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => { if (themePreference) setMode(themePreference) }, [themePreference])
  const chooseMode = (nextMode: AppearanceMode): void => {
    setMode(nextMode)
    if (onThemePreferenceChange) {
      onThemePreferenceChange(nextMode)
      return
    }
    const nextTheme = nextMode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : nextMode
    if (theme !== nextTheme) onToggleTheme()
  }
  const reset = (): void => {
    updateDesktopSettings({ accentColor: DEFAULT_DESKTOP_SETTINGS.accentColor, backgroundColor: DEFAULT_DESKTOP_SETTINGS.backgroundColor, foregroundColor: DEFAULT_DESKTOP_SETTINGS.foregroundColor, fontFamily: 'system' })
  }
  const customized = settings.accentColor !== DEFAULT_DESKTOP_SETTINGS.accentColor || settings.backgroundColor !== DEFAULT_DESKTOP_SETTINGS.backgroundColor || settings.foregroundColor !== DEFAULT_DESKTOP_SETTINGS.foregroundColor || settings.fontFamily !== 'system'
  const colorPicker = (label: string, key: 'accentColor' | 'backgroundColor' | 'foregroundColor'): ReactNode => {
    const themeDefault = theme === 'light'
      ? { accentColor: DEFAULT_DESKTOP_SETTINGS.accentColor, backgroundColor: '#ffffff', foregroundColor: '#282828' }[key]
      : DEFAULT_DESKTOP_SETTINGS[key]
    const value = settings[key] === DEFAULT_DESKTOP_SETTINGS[key] ? themeDefault : settings[key]
    return <label className="settings-page-pill settings-page-color-picker"><span className="settings-page-color" style={{ background: value }} />{value.toUpperCase()}<input type="color" value={value} aria-label={label} onChange={(event) => updateDesktopSettings({ [key]: event.currentTarget.value })} /></label>
  }
  return (
    <>
      <PageHeading title="外观" />
      <SettingsGroup title="视觉风格">
        <SettingsRow title="模式">
          <div className="settings-page-theme-choices" aria-label="模式">
            <button type="button" aria-label="跟随系统" title="跟随系统" aria-pressed={mode === 'system'} className={mode === 'system' ? 'active system' : 'system'} onClick={() => chooseMode('system')}><span /><i /></button>
            <button type="button" aria-label="浅色" title="浅色" aria-pressed={mode === 'light'} className={mode === 'light' ? 'active light' : 'light'} onClick={() => chooseMode('light')}><span /></button>
            <button type="button" aria-label="深色" title="深色" aria-pressed={mode === 'dark'} className={mode === 'dark' ? 'active dark' : 'dark'} onClick={() => chooseMode('dark')}><span /></button>
          </div>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow title="主题"><SettingsSelect label="主题" value={customized ? 'custom' : 'chatgpt'} leading={<Sparkles />} options={[{ value: 'chatgpt', label: 'ChatGPT' }, { value: 'custom', label: '自定义' }]} onChange={(value) => { if (value === 'chatgpt') reset(); else setAdvanced(true) }} /></SettingsRow>
        <SettingsRow title="强调色">{colorPicker('强调色', 'accentColor')}</SettingsRow>
        <SettingsRow title="背景">{colorPicker('背景', 'backgroundColor')}</SettingsRow>
        <SettingsRow title="前景">{colorPicker('前景', 'foregroundColor')}</SettingsRow>
        <SettingsRow title="字体"><SettingsSelect label="字体" value={settings.fontFamily} options={[{ value: 'system', label: '系统' }, { value: 'Helvetica Neue', label: 'Helvetica Neue' }, { value: 'Arial', label: 'Arial' }, { value: 'SF Mono', label: 'SF Mono' }]} onChange={(value) => updateDesktopSettings({ fontFamily: value })} /></SettingsRow>
      </SettingsGroup>
      <div className="settings-page-inline-actions"><button type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>高级 <ChevronRight style={{ transform: advanced ? 'rotate(90deg)' : undefined }} /></button><button type="button" disabled={!customized} onClick={reset}>重置为默认设置</button></div>
      {advanced && <SettingsGroup><SettingsRow title="自定义字体" description="输入字体名称或以逗号分隔的备用字体列表"><input className="settings-page-input editable" aria-label="自定义字体" value={settings.fontFamily === 'system' ? '' : settings.fontFamily} placeholder="系统" onChange={(event) => updateDesktopSettings({ fontFamily: event.currentTarget.value || 'system' })} /></SettingsRow></SettingsGroup>}
    </>
  )
}

function SpeechSettings(): ReactNode {
  return (
    <>
      <PageHeading title="语音" />
      <SettingsGroup title="语音聊天"><SettingsRow title="语音聊天不可用" description="你的账户或工作空间无法使用语音聊天" /></SettingsGroup>
      <SettingsGroup title="听写"><SettingsRow title="语音输入不可用" description="当前配置不支持听写" /></SettingsGroup>
    </>
  )
}

function StorageSettings({ context }: { context: AppContext | null }): ReactNode {
  return (
    <>
      <PageHeading title="存储" description="管理 ChatGPT 在此 Mac 上保存的数据" />
      <SettingsGroup title="本地数据">
        <SettingsRow title="聊天与附件" description="聊天历史、附件和本地索引"><Pill unavailableReason="当前客户端尚未提供本地数据管理器">管理</Pill></SettingsRow>
        <SettingsRow title="当前工作空间" description={context?.cwd || '未选择工作空间'}><HardDrive /></SettingsRow>
        <SettingsRow title="清理缓存" description="移除可安全重新生成的本地数据"><Pill unavailableReason="当前客户端尚未定义可安全清理的缓存边界">清理</Pill></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function ConfigurationSettings({ backend }: { backend: BackendStatus }): ReactNode {
  const [snapshot, setSnapshot] = useState<ConfigurationSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<ConfigurationKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const current = ++generation.current
    if (backend.state !== 'ready') return
    setLoading(true)
    setError(null)
    try {
      const result = await window.codex.invoke<unknown>('config/read', { includeLayers: true, cwd: null })
      if (generation.current === current) setSnapshot(normalizeConfiguration(result))
    } catch (failure) {
      if (generation.current === current) setError(sanitizeIntegrationDiagnostic(failure instanceof Error ? failure.message : String(failure)))
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [backend.state])
  useEffect(() => {
    void load()
    return () => { generation.current += 1 }
  }, [load])
  const write = async (key: ConfigurationKey, value: string | boolean | null): Promise<void> => {
    if (!snapshot || saving || snapshot.readOnly.includes(key)) return
    setSaving(key)
    setError(null)
    const current = generation.current
    try {
      await window.codex.invoke('config/value/write', configurationWriteParams(key, value))
      if (generation.current !== current) return
      await load()
    } catch (failure) {
      setError(sanitizeIntegrationDiagnostic(failure instanceof Error ? failure.message : String(failure)))
    } finally {
      setSaving(null)
    }
  }
  const select = (key: ConfigurationKey, label: string, options: Array<{ value: string; label: string }>): ReactNode => (
    <SettingsSelect label={label} value={String((snapshot ? snapshot.values[key] : CONFIGURATION_DEFAULTS[key]) ?? 'default')} options={options} disabled={!snapshot || backend.state !== 'ready' || loading || saving !== null || snapshot.readOnly.includes(key)} onChange={(value) => void write(key, value === 'default' ? null : value)} />
  )
  return (
    <>
      <PageHeading title="配置" description={<>配置新聊天的权限、网页访问和智能体回复 <ExternalTextLink href={SETTINGS_DOCS.configuration}>了解更多</ExternalTextLink></>} />
      <section className="settings-page-subheading-row"><h3>智能体默认设置</h3><button type="button" aria-label="刷新配置" disabled={loading || saving !== null || backend.state !== 'ready'} onClick={() => void load()}><RotateCw className={loading ? 'spin' : undefined} /></button></section>
      <span className="settings-page-pill">用户配置</span>
      {error && <div className="settings-page-error" role="alert">{error}</div>}
      <SettingsGroup>
        <SettingsRow title="批准策略" description="选择 ChatGPT 何时请求批准">{select('approval_policy', '批准策略', [{ value: 'on-request', label: '按请求' }, { value: 'never', label: '从不' }, ...snapshot?.values.approval_policy === 'on-failure' ? [{ value: 'on-failure', label: '仅失败时' }] : [], ...snapshot?.values.approval_policy === 'untrusted' ? [{ value: 'untrusted', label: '不可信命令' }] : []])}</SettingsRow>
        <SettingsRow title="沙盒设置" description="选择 ChatGPT 运行命令时的权限范围">{select('sandbox_mode', '沙盒设置', [{ value: 'read-only', label: '只读' }, { value: 'workspace-write', label: '工作空间写入' }, { value: 'danger-full-access', label: '完整访问权限' }])}</SettingsRow>
        {snapshot?.values.sandbox_mode === 'workspace-write' && <SettingsRow title="允许网络访问" description="允许工作空间内的命令访问网络"><Toggle label="允许网络访问" checked={snapshot.values['sandbox_workspace_write.network_access'] === true} disabled={saving !== null || snapshot.readOnly.includes('sandbox_workspace_write.network_access')} onChange={(value) => void write('sandbox_workspace_write.network_access', value)} /></SettingsRow>}
        <SettingsRow title="网页搜索" description="选择 ChatGPT 访问网络的方式">{select('web_search', '网页搜索', [{ value: 'disabled', label: '关闭' }, { value: 'cached', label: '缓存' }, { value: 'live', label: '实时' }, { value: 'default', label: '默认' }])}</SettingsRow>
        <SettingsRow title="输出详细程度" description="选择 ChatGPT 回复包含细节的详细程度">{select('model_verbosity', '输出详细程度', [{ value: 'default', label: '模型默认' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }])}</SettingsRow>
        <SettingsRow title="推理摘要" description="选择 ChatGPT 总结其推理的方式">{select('model_reasoning_summary', '推理摘要', [{ value: 'auto', label: '自动' }, { value: 'concise', label: '简洁' }, { value: 'detailed', label: '详细' }, { value: 'none', label: '无' }, { value: 'default', label: '模型默认' }])}</SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="模型功能">
        <SettingsRow title="可用推理强度" description="选择在模型控件中显示哪些推理强度级别。可用性因模型而异"><SelectPill unavailableReason="当前 app-server 配置桥接未暴露可用推理强度列表">已选择 5 个</SelectPill></SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="工作空间依赖项">
        <SettingsRow title="Codex 依赖项" description="允许 ChatGPT 安装并提供随附的 Node.js 和 Python 工具"><Toggle label="Codex 依赖项" initial /></SettingsRow>
        <SettingsRow title="诊断 Codex 工作空间中的问题" description={backend.state === 'ready' ? '检查当前捆绑包并记录诊断日志' : '等待本地 Codex 服务连接'}><Pill unavailableReason="当前桌面桥接未提供工作空间诊断命令"><Search /> 诊断</Pill></SettingsRow>
        <SettingsRow title="重置并安装工作空间" description="下载新的软件包并安装，然后重新加载工具"><Pill unavailableReason="当前桌面桥接未提供依赖包重装流程"><Download /> 重新安装</Pill></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function PersonalizationSettings(): ReactNode {
  return (
    <>
      <PageHeading title="个性化" />
      <section className="settings-page-subheading-row"><div><h3>Codex 记忆</h3><p>配置 Codex 在 Local 上管理记忆的方式。<ExternalTextLink href={SETTINGS_DOCS.memories}>了解更多</ExternalTextLink></p></div><SelectPill unavailableReason="当前复刻版仅支持本地主机"><Monitor /> 本地主机</SelectPill></section>
      <SettingsGroup>
        <SettingsRow title="启用 Codex 记忆功能" description="根据 Local 上的聊天创建记忆，并使用这些记忆为今后在 Local 上的聊天提供个性化体验"><Toggle label="Codex 记忆" /></SettingsRow>
        <SettingsRow title="允许从使用工具的聊天中生成记忆" description="从使用过 MCP 工具或网页搜索的聊天生成记忆"><Toggle label="工具聊天记忆" initial /></SettingsRow>
        <SettingsRow title="删除 Codex 记忆" description="删除 Local 上的全部 Codex 记忆"><Pill unavailableReason="当前 app-server 桥接未提供记忆删除操作">删除</Pill></SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="自定义指令">
        <SettingsRow title="Codex 指令" description={<>编辑所选机器上的 AGENTS.md 文件。代码仓库的说明也可能适用。<ExternalTextLink href={SETTINGS_DOCS.agents}>了解更多</ExternalTextLink></>}><Pill unavailableReason="当前文件桥接只能编辑已授权的工作空间文件">编辑 <ChevronRight /></Pill></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function MiniSettings(): ReactNode {
  return (
    <>
      <PageHeading title="Mini 与虚拟宠物" description="选择一个轻量窗口，让 ChatGPT 陪伴在桌面一角" />
      <SettingsGroup title="Mini">
        <SettingsRow title="启用 Mini" description="在应用外快速开始聊天"><Toggle label="启用 Mini" /></SettingsRow>
        <SettingsRow title="始终置于顶层" description="让 Mini 保持在其他窗口上方"><Toggle label="Mini 始终置顶" /></SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="虚拟宠物"><SettingsRow title="显示桌面伙伴" description="在 Mini 中显示你的虚拟伙伴"><Toggle label="虚拟宠物" /></SettingsRow></SettingsGroup>
    </>
  )
}

const SHORTCUT_ROWS = [
  ['新建聊天', '⌘ N'],
  ['搜索聊天', '⌘ K'],
  ['显示或隐藏侧边栏', '⌘ B'],
  ['打开设置', '⌘ ,'],
  ['打开终端', '⌘ J'],
  ['发送消息', '↵'],
  ['在编辑器中换行', '⇧ ↵']
]

function ShortcutSettings(): ReactNode {
  return (
    <>
      <PageHeading title="键盘快捷键" />
      <SettingsGroup>
        {SHORTCUT_ROWS.map(([label, keys]) => <SettingsRow key={label} title={label}><kbd>{keys}</kbd></SettingsRow>)}
      </SettingsGroup>
    </>
  )
}

function ComputerControlSettings(): ReactNode {
  return (
    <>
      <PageHeading title="电脑操控" description="允许 ChatGPT 在你授权后查看并操作应用" />
      <SettingsGroup title="权限">
        <SettingsRow title="电脑操控" description="让 ChatGPT 使用鼠标和键盘完成任务"><Toggle label="电脑操控" /></SettingsRow>
        <SettingsRow title="辅助功能访问" description="需要在 macOS 系统设置中启用"><Pill unavailableReason="当前桌面桥接未授权打开 macOS 系统设置 URL">打开系统设置</Pill></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function AppSnapshotSettings(): ReactNode {
  return (
    <>
      <PageHeading title="应用快照" />
      <div className="settings-page-callout"><AppWindow /><div><strong>截取应用快照，向 ChatGPT 展示最前面的窗口</strong><span>应用快照包含视觉和文本内容，包括滚动到屏幕外的文本。</span></div></div>
      <div className="settings-page-snapshot-layout">
        <SettingsGroup>
          <SettingsRow title="快捷键" description="同时按下两个 ⌘ 键"><Pill unavailableReason="当前桌面桥接尚未提供应用快照快捷键注册">⌘ + ⌘ <ChevronDown /></Pill></SettingsRow>
          <SettingsRow title="应用快照发送目标" description="选择使用快捷键时将应用快照发送到哪里"><SelectPill unavailableReason="当前桌面桥接尚未提供应用快照路由设置">自动</SelectPill></SettingsRow>
          <SettingsRow title="可见时使用 Mini" description="Mini 未显示时，应用快照会使用你选择的目标位置"><Toggle label="应用快照使用 Mini" /></SettingsRow>
          <SettingsRow title="播放音效"><Toggle label="应用快照播放音效" initial /></SettingsRow>
        </SettingsGroup>
        <div className="settings-page-snapshot-preview"><span className="preview-window" /><span className="preview-keyboard" /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
      </div>
    </>
  )
}

function BrowserSettings(): ReactNode {
  return (
    <>
      <PageHeading title="浏览器" description="连接浏览器，以便 ChatGPT 在你许可时查看网页" />
      <SettingsGroup>
        <SettingsRow title="Chrome 扩展程序" description="当前复刻版未接入账号级扩展管理；可按原版文档完成安装与授权。"><ExternalPill href={SETTINGS_DOCS.browserExtension}>设置扩展程序 ↗</ExternalPill></SettingsRow>
        <SettingsRow title="在浏览器中打开链接" description="选择 ChatGPT 如何打开网页"><SelectPill unavailableReason="当前桌面桥接未暴露浏览器打开偏好">默认浏览器</SelectPill></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function HooksSettings(): ReactNode {
  return (
    <>
      <section className="settings-page-heading-row"><PageHeading title="钩子" description={<>通过配置和已启用的插件管理生命周期钩子。<ExternalTextLink href={SETTINGS_DOCS.hooks}>了解更多</ExternalTextLink></>} /><button type="button" className="settings-page-icon-button" aria-label="刷新钩子" disabled title="当前 renderer IPC 未接入 hooks/list" aria-description="当前 renderer IPC 未接入 hooks/list"><RotateCw /></button></section>
      <SettingsGroup><SettingsRow title="钩子列表暂不可用" description="原版使用 hooks/list 读取并刷新配置；当前客户端尚未将该方法暴露给 renderer。" /></SettingsGroup>
    </>
  )
}

function remoteConnectionEndpoint(connection: RemoteConnection): string {
  if (connection.sshAlias) return `SSH 配置 · ${connection.sshAlias}`
  const port = connection.port ? `:${connection.port}` : ''
  return `${connection.host}${port}`
}

function remoteConnectionStateLabel(connection: RemoteConnection): string {
  if (connection.state === 'connected') return '已连接'
  if (connection.state === 'connecting') return '正在连接'
  if (connection.state === 'error') return '连接失败'
  return '未连接'
}

function settingsConnectionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ConnectionsSettings(): ReactNode {
  const [connections, setConnections] = useState<RemoteConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [discoveredAliases, setDiscoveredAliases] = useState<SshDiscoveryAlias[]>([])
  const [selectedAliases, setSelectedAliases] = useState<string[]>([])
  const [discoveryRefreshing, setDiscoveryRefreshing] = useState(false)
  const [discoverySaving, setDiscoverySaving] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<RemoteConnection | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [busyHostId, setBusyHostId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.codex.listRemoteConnections()
      setConnections(next)
      setPageError(null)
    } catch (error) {
      setPageError(settingsConnectionError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.codex.onRemoteConnectionsChanged((next) => {
      if (!cancelled) setConnections(next)
    })
    void window.codex.listRemoteConnections().then((next) => {
      if (!cancelled) {
        setConnections(next)
        setPageError(null)
      }
    }).catch((error) => {
      if (!cancelled) setPageError(settingsConnectionError(error))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const openEditor = (connection: RemoteConnection | null): void => {
    setEditingConnection(connection)
    setEditorError(null)
    setEditorOpen(true)
  }

  const refreshDiscovery = async (): Promise<void> => {
    setDiscoveryRefreshing(true)
    setDiscoveryError(null)
    try {
      setDiscoveredAliases(await window.codex.discoverSshConnections())
    } catch (error) {
      setDiscoveryError(settingsConnectionError(error))
    } finally {
      setDiscoveryRefreshing(false)
    }
  }

  const openDiscovery = (): void => {
    setSelectedAliases([])
    setDiscoveryError(null)
    setDiscoveryOpen(true)
    void refreshDiscovery()
  }

  const openManualEditor = (): void => {
    setDiscoveryOpen(false)
    openEditor(null)
  }

  const saveDiscoveredConnections = async (): Promise<void> => {
    const selection = new Set(selectedAliases)
    const aliases = discoveredAliases.filter((candidate) => selection.has(candidate.sshAlias))
    if (aliases.length === 0) return
    setDiscoverySaving(true)
    setDiscoveryError(null)
    try {
      const saved: RemoteConnection[] = []
      for (const alias of aliases) {
        saved.push(await window.codex.saveRemoteConnection({
          displayName: alias.displayName || alias.sshAlias,
          sshAlias: alias.sshAlias,
          host: alias.host
        }))
      }
      const connectionResults = await Promise.allSettled(
        saved.map((connection) => window.codex.connectRemoteConnection(connection.hostId))
      )
      const connectionFailure = connectionResults.find((result) => result.status === 'rejected')
      setDiscoveryOpen(false)
      setSelectedAliases([])
      await refresh()
      if (connectionFailure?.status === 'rejected') {
        setPageError(settingsConnectionError(connectionFailure.reason))
      }
    } catch (error) {
      setDiscoveryError(settingsConnectionError(error))
      await refresh()
    } finally {
      setDiscoverySaving(false)
    }
  }

  const discoveryAliases = useMemo(() => {
    const configuredAliases = new Set(connections.flatMap((connection) =>
      connection.sshAlias ? [connection.sshAlias.toLocaleLowerCase()] : []))
    const configuredNames = new Set(connections.map((connection) => connection.displayName.toLocaleLowerCase()))
    return discoveredAliases.map((alias) => ({
      ...alias,
      configured: configuredAliases.has(alias.sshAlias.toLocaleLowerCase()) ||
        configuredNames.has(alias.displayName.toLocaleLowerCase())
    }))
  }, [connections, discoveredAliases])

  const saveConnection = async (options: SaveRemoteConnectionOptions): Promise<void> => {
    setEditorBusy(true)
    setEditorError(null)
    try {
      const saved = await window.codex.saveRemoteConnection(options)
      setEditorOpen(false)
      setEditingConnection(null)
      let connectionError: string | null = null
      try {
        await window.codex.connectRemoteConnection(saved.hostId)
      } catch (error) {
        connectionError = settingsConnectionError(error)
      }
      await refresh()
      if (connectionError) setPageError(connectionError)
    } catch (error) {
      setEditorError(settingsConnectionError(error))
    } finally {
      setEditorBusy(false)
    }
  }

  const toggleConnection = async (connection: RemoteConnection): Promise<void> => {
    setBusyHostId(connection.hostId)
    setPageError(null)
    try {
      if (connection.state === 'connected' || connection.state === 'connecting') {
        await window.codex.disconnectRemoteConnection(connection.hostId)
      } else {
        await window.codex.connectRemoteConnection(connection.hostId)
      }
      await refresh()
    } catch (error) {
      const message = settingsConnectionError(error)
      await refresh()
      setPageError(message)
    } finally {
      setBusyHostId(null)
    }
  }

  const deleteConnection = async (connection: RemoteConnection): Promise<void> => {
    if (!window.confirm(`删除远程连接“${connection.displayName}”？\n\n使用此连接的远程项目也将无法打开。`)) return
    setBusyHostId(connection.hostId)
    setPageError(null)
    try {
      await window.codex.deleteRemoteConnection(connection.hostId)
      await refresh()
    } catch (error) {
      setPageError(settingsConnectionError(error))
    } finally {
      setBusyHostId(null)
    }
  }

  return (
    <>
      <section className="settings-page-heading-row">
        <PageHeading title="连接" description="管理 Codex 可使用的本地和远程连接" />
        <button type="button" className="settings-page-pill" onClick={openDiscovery}><Plus /> 添加连接</button>
      </section>
      <SettingsGroup title="本地主机"><SettingsRow title="Local" description="当前 Mac"><span className="settings-page-status"><i /> 已连接</span></SettingsRow></SettingsGroup>
      <SettingsGroup title="远程连接">
        {loading ? (
          <div className="settings-page-loading"><RotateCw className="spin" /> 正在载入连接…</div>
        ) : connections.length === 0 ? (
          <div className="settings-page-empty"><Link2 /><strong>没有远程连接</strong><span>添加 SSH 主机后，可以直接打开远端项目并在远端运行 Codex。</span><div className="settings-page-empty-actions"><Pill onClick={openDiscovery}><Plus /> 添加连接</Pill><ExternalPill href={SETTINGS_DOCS.remoteConnections}>SSH 设置指南 ↗</ExternalPill></div></div>
        ) : (
          <div className="settings-remote-connection-list">
            {connections.map((connection) => {
              const busy = busyHostId === connection.hostId || connection.state === 'connecting'
              const active = connection.state === 'connected' || connection.state === 'connecting'
              return (
                <div className="settings-remote-connection-row" key={connection.hostId}>
                  <span className="settings-remote-connection-icon" data-state={connection.state}><Monitor aria-hidden="true" /><i /></span>
                  <div className="settings-remote-connection-copy">
                    <strong>{connection.displayName}</strong>
                    <span title={remoteConnectionEndpoint(connection)}>{remoteConnectionEndpoint(connection)}</span>
                    {connection.message && <small title={connection.message}>{connection.message}</small>}
                  </div>
                  <span className="settings-remote-connection-state" data-state={connection.state}><i /> {remoteConnectionStateLabel(connection)}</span>
                  <div className="settings-remote-connection-actions">
                    <button type="button" className="settings-page-pill" disabled={busyHostId !== null} onClick={() => void toggleConnection(connection)}>
                      {busy ? <RotateCw className="spin" /> : active ? '断开' : connection.state === 'error' ? '重试' : '连接'}
                    </button>
                    <button type="button" className="settings-page-icon-button" aria-label={`编辑 ${connection.displayName}`} title="编辑" disabled={busyHostId !== null} onClick={() => openEditor(connection)}><Pencil /></button>
                    <button type="button" className="settings-page-icon-button is-danger" aria-label={`删除 ${connection.displayName}`} title="删除" disabled={busyHostId !== null} onClick={() => void deleteConnection(connection)}><Trash2 /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingsGroup>
      {pageError && <div className="settings-page-error" role="alert">{pageError}</div>}
      <SshConnectionDiscoveryDialog
        aliases={discoveryAliases}
        open={discoveryOpen}
        refreshing={discoveryRefreshing}
        saving={discoverySaving}
        selectedAliases={selectedAliases}
        error={discoveryError}
        onToggleAlias={(alias) => setSelectedAliases((current) => current.includes(alias)
          ? current.filter((candidate) => candidate !== alias)
          : [...current, alias])}
        onRefresh={refreshDiscovery}
        onAddManually={openManualEditor}
        onSave={saveDiscoveredConnections}
        onClose={() => { if (!discoverySaving) setDiscoveryOpen(false) }}
      />
      {editorOpen && (
        <RemoteConnectionDialog
          connection={editingConnection}
          connections={connections}
          busy={editorBusy}
          error={editorError}
          onCancel={() => { if (!editorBusy) setEditorOpen(false) }}
          onSubmit={saveConnection}
        />
      )}
    </>
  )
}

function GitSettings({ context }: { context: AppContext | null }): ReactNode {
  return (
    <>
      <PageHeading title="Git" description="配置 Codex 如何使用版本控制" />
      <SettingsGroup title="提交与分支">
        <SettingsRow title="当前分支" description={context?.cwd || '当前工作空间'}><StaticPill><GitBranch /> {context?.branch || '未检测到'}</StaticPill></SettingsRow>
        <SettingsRow title="自动获取远程更新" description="创建工作树前获取最新的上游更新"><Toggle label="Git 自动获取" /></SettingsRow>
        <SettingsRow title="在完成时显示变更" description="任务完成后自动打开 Changes"><Toggle label="完成后显示变更" initial /></SettingsRow>
      </SettingsGroup>
    </>
  )
}

function EnvironmentSettings({ projectPaths = [], onAddProject, onNewThreadInProject }: Pick<SettingsPageProps, 'projectPaths' | 'onAddProject' | 'onNewThreadInProject'>): ReactNode {
  const paths = [...new Set(projectPaths)]
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  return (
    <>
      <PageHeading title="环境" description={<>本地环境用于指导 ChatGPT 如何为项目设置工作树。<ExternalTextLink href={SETTINGS_DOCS.environments}>了解更多</ExternalTextLink></>} />
      <section className="settings-page-subheading-row"><h3>选择项目</h3>{onAddProject && <Pill onClick={onAddProject}>添加项目</Pill>}</section>
      <div className="settings-page-project-list">
        {paths.map((path) => <button type="button" key={path} title={path} aria-expanded={selectedPath === path} onClick={() => setSelectedPath((current) => current === path ? null : path)}><Box /><span>{path.split('/').filter(Boolean).at(-1) || path}</span><ChevronRight /></button>)}
      </div>
      {selectedPath && <SettingsGroup title={selectedPath}><SettingsRow title="本地项目" description="此项目中的聊天使用所选文件夹作为工作空间。">{onNewThreadInProject && <Pill onClick={() => onNewThreadInProject(selectedPath)}><Plus />新建聊天</Pill>}<Pill onClick={() => void window.codex.openWorkingDirectory(selectedPath, 'finder')}>在 Finder 中显示</Pill></SettingsRow></SettingsGroup>}
    </>
  )
}

function WorktreeSettings({ context, onNewThreadInProject }: Pick<SettingsPageProps, 'context' | 'onNewThreadInProject'>): ReactNode {
  const [metadata, setMetadata] = useState<GitMetadata | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    if (!context?.cwd) return
    const current = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const result = await window.codex.getGitMetadata(context.cwd, { redactRemoteNames: true })
      if (generation.current === current) setMetadata(result)
    } catch (failure) {
      if (generation.current === current) setError(sanitizeIntegrationDiagnostic(failure instanceof Error ? failure.message : String(failure)))
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [context?.cwd])
  useEffect(() => {
    void refresh()
    return () => { generation.current += 1 }
  }, [refresh])
  return (
    <>
      <PageHeading title="Worktrees" />
      <SettingsGroup>
        <SettingsRow title="工作树根目录" description="ChatGPT 创建托管工作树的目录。留空则使用默认位置"><span className="settings-page-input">~/.codex/worktrees</span></SettingsRow>
        <SettingsRow title="创建工作树前始终获取上游更新" description="Codex 通常会在常规 Git 操作中获取分支更新。此设置还会在创建每个新工作树前获取上游更新。"><Toggle label="工作树获取上游" /></SettingsRow>
        <SettingsRow title="自动删除旧工作树" description="推荐大多数用户启用。仅当你需要手动管理旧工作树和磁盘使用空间时，再关闭此功能。"><Toggle label="自动删除旧工作树" initial /></SettingsRow>
        <SettingsRow title="自动删除限制" description="要保留的托管工作树数量；超过后，较旧的工作树会自动被清理。"><span className="settings-page-input short">15</span></SettingsRow>
      </SettingsGroup>
      {context?.cwd && (
        <>
          <section className="settings-page-subheading-row worktree"><h3>{context.cwd}</h3><button type="button" aria-label="刷新工作树" disabled={loading} onClick={() => void refresh()}><RotateCw className={loading ? 'spin' : undefined} /></button></section>
          {error && <div className="settings-page-error" role="alert">{error}</div>}
          <SettingsGroup>
            {loading && !metadata ? <div className="settings-page-loading" role="status"><span className="settings-page-spinner" />正在载入工作树…</div> : metadata?.isRepository ? metadata.worktrees.map((worktree) => <SettingsRow key={worktree.path} title={worktree.branch || (worktree.detached ? '分离的 HEAD' : '工作树')} description={worktree.path}>{worktree.current && <span className="settings-page-status">当前工作树</span>}{onNewThreadInProject && !worktree.bare && <Pill onClick={() => onNewThreadInProject(worktree.path)}><Plus />在此工作树中新建聊天</Pill>}<Pill onClick={() => void window.codex.openWorkingDirectory(worktree.path, 'finder')}>在 Finder 中显示</Pill></SettingsRow>) : <div className="settings-page-empty"><GitBranch /><strong>{metadata?.isRepository === false ? '当前项目不是 Git 仓库' : '没有可用的工作树'}</strong></div>}
          </SettingsGroup>
        </>
      )}
    </>
  )
}

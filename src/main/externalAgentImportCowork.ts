import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExternalAgentConnector, ExternalAgentDetectOptions, ExternalAgentImportTypeResult, ExternalAgentMigrationDetails, ExternalAgentMigrationItem, JsonMap } from '../shared/api'
import type { ExternalAgentServer, ProjectlessImportPaths } from './externalAgentImport'

const excludedManifests = new Set(['spaces.json', 'scheduled-tasks.json', 'artifacts.json', 'mcp.json', 'mcp-servers.json', 'plugins.json', 'plugins-mcp-skills.json', 'skills.json', 'agents.json', 'cowork_settings.json', 'cowork_account_settings.json', 'cowork-clientdata-cache.json', 'cowork-gb-cache.json', 'remote-session-spaces.json'])
const details = (): ExternalAgentMigrationDetails => ({ commands: [], hooks: [], mcpServers: [], plugins: [], skills: [], subagents: [], memory: [], sessions: [] })
function record(value: unknown): value is Record<string, unknown> { return value != null && typeof value === 'object' && !Array.isArray(value) }
function text(value: unknown): string | null { return typeof value === 'string' ? value : null }
function stamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1_000 : value
  if (typeof value === 'string') { const n = Date.parse(value); return Number.isFinite(n) ? n : null }
  return null
}
async function exists(path: string): Promise<boolean> { return lstat(path).then(stat => !stat.isSymbolicLink()).catch(() => false) }
async function json(path: string): Promise<Record<string, unknown> | unknown[] | null> {
  try { const stat = await lstat(path); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null; return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}
async function directories(path: string): Promise<string[]> { return (await readdir(path, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name)) }
function folders(value: unknown): string[] { return Array.isArray(value) ? value.flatMap(folder => typeof folder === 'string' ? [folder] : record(folder) && typeof folder.path === 'string' ? [folder.path] : []).filter(Boolean).map(path => resolve(path)) : [] }
function within(root: string, path: string): boolean { const r = relative(root, path); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)) }
function slug(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cowork-item' }
interface CoworkSession {
  sourcePath: string; sourceId: string; accountDirectory: string; cwd: string; title: string | null
  lastActivityAtMs: number | null; workspaceKind: 'project' | 'projectless'; generatedFiles: { source: string; name: string }[]
  remoteMcpServerNames: string[]
}
interface CoworkProject { accountDirectory: string; root: string; name: string; instructions: string | null; spaceId: string | null }
interface CoworkPlugin { name: string; root: string; manifest: Record<string, unknown>; version: string }
interface CoworkHistory { version: 1; records: { importedAtMs: number; importedThreadId: string; sourcePath: string; sourceId: string; projectRoot: string; contentSha256: string }[]; connectorCandidates: (ExternalAgentConnector & { importedAtMs: number })[]; accountSetupItems: { accountOrgDir: string; itemType: string; importedAtMs: number }[]; projects: { sourceRoot: string; spaceId: string; importedAtMs: number }[] }
interface AdapterOptions {
  server: ExternalAgentServer; homeDirectory: string; codexHome: string; userDataDirectory: string
  createProjectlessPaths(title: string | null): Promise<ProjectlessImportPaths>
  recordProjectlessThread(threadId: string, paths: ProjectlessImportPaths): Promise<void>
  isDisposed?(): boolean
  onMutationSubmitted?(): void
}

/** Directly follows shipped EE/ixe/HE/oSe and dD/Bye. Detection never repairs marketplaces. */
export class CoworkImportAdapter {
  private sessions = new Map<string, CoworkSession>()
  private projects = new Map<string, CoworkProject>()
  private plugins = new Map<string, CoworkPlugin>()
  private readonly historyPath: string
  private historyTail = Promise.resolve()
  private writes = new Set<Promise<unknown>>()
  constructor(private readonly options: AdapterOptions) { this.historyPath = join(options.codexHome, 'claude-cowork-import-history.json') }
  private get disposed(): boolean { return this.options.isDisposed?.() === true }
  private write<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Cowork import service closed before write'))
    this.options.onMutationSubmitted?.()
    const pending = operation().finally(() => this.writes.delete(pending))
    this.writes.add(pending)
    return pending
  }
  private requestMutation<T = unknown>(method: string, params?: JsonMap): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Cowork import service closed before submission'))
    this.options.onMutationSubmitted?.()
    return this.options.server.request<T>(method, params)
  }
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.writes])
    await this.historyTail.catch(() => {})
  }
  private async history(): Promise<CoworkHistory> {
    const value = await json(this.historyPath)
    if (record(value) && value.version === 1 && Array.isArray(value.records)) return { version: 1, records: value.records as CoworkHistory['records'], connectorCandidates: (value.connectorCandidates ?? []) as CoworkHistory['connectorCandidates'], accountSetupItems: (value.accountSetupItems ?? []) as CoworkHistory['accountSetupItems'], projects: (value.projects ?? []) as CoworkHistory['projects'] }
    return { version: 1, records: [], connectorCandidates: [], accountSetupItems: [], projects: [] }
  }
  private updateHistory(update: (history: CoworkHistory) => void): Promise<void> {
    const next = this.historyTail.catch(() => {}).then(async () => {
      if (this.disposed) return
      const history = await this.history(); update(history)
      if (this.disposed) return
      await this.write(() => mkdir(dirname(this.historyPath), { recursive: true }))
      const temporary = `${this.historyPath}.${randomUUID()}.tmp`
      if (this.disposed) return
      try {
        await this.write(() => writeFile(temporary, `${JSON.stringify(history)}\n`, { mode: 0o600, flag: 'wx' }))
        if (this.disposed) return
        await this.write(() => rename(temporary, this.historyPath))
      } finally { await rm(temporary, { force: true }).catch(() => {}) }
    })
    this.historyTail = next; return next
  }
  async readConnectors(): Promise<ExternalAgentConnector[]> {
    const appIds: Record<string, string> = { figma: 'connector_figma', github: 'connector_github', gmail: 'connector_gmail', 'google calendar': 'connector_google_calendar', 'google drive': 'connector_google_drive', linear: 'connector_linear', notion: 'connector_notion', slack: 'connector_slack' }
    return (await this.history()).connectorCandidates.map(connector => ({ ...connector, codexAppId: appIds[connector.name.trim().toLowerCase()] ?? null }))
  }
  async detect(options: ExternalAgentDetectOptions) {
    const items: ExternalAgentMigrationItem[] = []
    const unsupportedProjects: { name: string; reason: string; sourceFolders: string[]; spaceId?: string; spaceConfigPath?: string }[] = []
    const warnings: string[] = []
    const connectors = new Map<string, ExternalAgentConnector>()
    if (options.includeHome === false && options.workspaceRoots == null) return { items, unsupportedProjects, connectors: [], warnings }
    const history = await this.history()
    const allAccounts = (await Promise.all((await directories(join(this.options.userDataDirectory, 'local-agent-mode-sessions'))).map(directories))).flat()
    if (!allAccounts.length) return { items, unsupportedProjects, connectors: [], warnings: ['No Claude Cowork account/org directories were found'] }
    this.sessions.clear(); this.projects.clear(); this.plugins.clear()
    const maxAge = options.sessionLimits?.maxSessionAgeMs ?? 2_592_000_000
    const maxSessions = Math.min(options.sessionLimits?.maxSessionsPerSpace ?? 50, 50)
    for (const accountDirectory of allAccounts) {
      const spacesPath = join(accountDirectory, 'spaces.json')
      const spacesValue = await json(spacesPath)
      const spaces = Array.isArray(spacesValue) ? spacesValue : record(spacesValue) && Array.isArray(spacesValue.spaces) ? spacesValue.spaces : []
      const accountProjects: CoworkProject[] = []
      for (const space of spaces) {
        if (!record(space) || typeof space.id !== 'string') continue
        const sources = folders(space.folders ?? space.userSelectedFolders)
        const name = text(space.name ?? space.title) ?? space.id
        if (sources.length > 1) { unsupportedProjects.push({ name, reason: 'multiple-source-folders', sourceFolders: sources, spaceId: space.id, spaceConfigPath: spacesPath }); continue }
        const root = sources[0]
        if (root && (!await exists(root) || within(this.options.userDataDirectory, root) || within(join(this.options.homeDirectory, 'Documents/Claude/Artifacts'), root))) {
          unsupportedProjects.push({ name, reason: await exists(root) ? 'claude-managed-folder' : 'missing-source-folder', sourceFolders: sources, spaceId: space.id, spaceConfigPath: spacesPath }); continue
        }
        if (root && options.workspaceRoots && !options.workspaceRoots.some(path => resolve(path) === root)) continue
        if (!root && options.includeHome === false) continue
        const project = { accountDirectory, root: root ?? join(accountDirectory, 'projectless-spaces', space.id), name, instructions: text(space.instructions), spaceId: space.id }
        accountProjects.push(project); this.projects.set(project.root, project)
        if (root && !history.projects.some(item => item.sourceRoot === root && item.spaceId === space.id)) items.push({ providerId: 'claude-cowork', cwd: root, description: `Append imported Cowork project instructions for ${name}`, details: null, itemType: 'AGENTS_MD' })
      }
      const recents = { accountDirectory, root: join(accountDirectory, 'projectless-spaces', 'account'), name: 'Cowork recents', instructions: null, spaceId: null }
      if (options.includeHome !== false) accountProjects.push(recents)
      const mcp = await this.mcpServers(accountDirectory)
      if (options.includeHome !== false) {
        const surfaces = await Promise.all(['cowork_account_settings.json', 'cowork_settings.json', 'skills.json', 'agents.json', 'skills', 'agents'].map(async name => await exists(join(accountDirectory, name)) ? name : null))
        if ((mcp.size || surfaces.some(Boolean)) && !history.accountSetupItems.some(item => item.accountOrgDir === accountDirectory && item.itemType === 'CONFIG')) {
          const d = details(); d.mcpServers = [...mcp.keys()].map(name => ({ name }))
          items.push({ providerId: 'claude-cowork', cwd: null, sourcePath: accountDirectory, description: 'Migrate supported Cowork account/org setup', details: d, itemType: 'CONFIG' })
          if (surfaces.some(Boolean)) warnings.push('Cowork model/permission mode, Markdown skills and agents are supported; other account preferences remain unchanged.')
        }
        const foundPlugins = await this.findPlugins(accountDirectory)
        if (foundPlugins.length && !history.accountSetupItems.some(item => item.accountOrgDir === accountDirectory && item.itemType === 'PLUGINS')) {
          const d = details(); d.plugins = [{ marketplaceName: 'claude-cowork', pluginNames: foundPlugins.map(plugin => plugin.name) }]
          items.push({ providerId: 'claude-cowork', cwd: null, sourcePath: accountDirectory, description: 'Install supported Cowork plugins', details: d, itemType: 'PLUGINS' })
        }
        const remote = await json(join(accountDirectory, 'remote-session-spaces.json'))
        if (record(remote) && Array.isArray(remote.entries) && remote.entries.length) warnings.push(`${remote.entries.length} cloud Cowork sessions have no local transcript and cannot be imported`)
      }
      const manifests = (await Promise.all([accountDirectory, join(accountDirectory, 'agent')].map(async root => (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isFile() && entry.name.endsWith('.json') && !excludedManifests.has(entry.name)).map(entry => join(root, entry.name))))).flat()
      const found: CoworkSession[] = []
      for (const manifestPath of manifests) {
        const manifest = await json(manifestPath)
        if (!record(manifest)) continue
        const sourceId = text(manifest.sessionId ?? manifest.id) ?? basename(manifestPath, '.json')
        const lastActivityAtMs = stamp(manifest.lastActivityAt ?? manifest.updatedAt ?? manifest.createdAt)
        if (lastActivityAtMs != null && lastActivityAtMs < Date.now() - maxAge) continue
        const sessionFolders = folders(manifest.userSelectedFolders)
        const project = accountProjects.find(project => project.spaceId != null && project.spaceId === manifest.spaceId) ?? accountProjects.find(project => sessionFolders.includes(project.root) || text(manifest.cwd) === project.root) ?? (options.includeHome !== false ? recents : null)
        if (!project) continue
        const storage = manifestPath.slice(0, -5)
        const paths = await this.transcriptPaths(storage, text(manifest.cliSessionId))
        const sourcePath = paths[0]
        if (!sourcePath || history.records.some(item => item.sourceId === sourceId && item.projectRoot === project.root)) continue
        const transcript = await readCoworkTranscript(sourcePath).catch(() => null)
        if (!transcript?.some(message => message.role === 'user')) continue
        const remoteMcpServerNames = record(manifest.remoteMcpServersConfig) ? Object.keys(manifest.remoteMcpServersConfig) : []
        for (const name of remoteMcpServerNames) { const current = connectors.get(name); connectors.set(name, { name, sessionCount: (current?.sessionCount ?? 0) + 1, source: 'remoteMcpServersConfig' }) }
        const generatedFiles = Array.isArray(manifest.fsDetectedFiles) ? manifest.fsDetectedFiles.flatMap(file => record(file) && typeof file.hostPath === 'string' && typeof file.fileName === 'string' ? [{ source: file.hostPath, name: file.fileName }] : []) : []
        for (const source of await this.filesUnder(join(storage, 'outputs'), 6)) generatedFiles.push({ source, name: relative(join(storage, 'outputs'), source) })
        const session: CoworkSession = { sourcePath, sourceId, accountDirectory, cwd: project.root, title: text(manifest.title) ?? (project.spaceId == null ? null : project.name), lastActivityAtMs, workspaceKind: within(join(accountDirectory, 'projectless-spaces'), project.root) ? 'projectless' : 'project', generatedFiles, remoteMcpServerNames }
        found.push(session)
      }
      const counts = new Map<string, number>()
      for (const session of found.sort((a, b) => (b.lastActivityAtMs ?? 0) - (a.lastActivityAtMs ?? 0))) {
        const count = counts.get(session.cwd) ?? 0
        if (count >= maxSessions) continue
        counts.set(session.cwd, count + 1); this.sessions.set(session.sourcePath, session)
      }
    }
    const selectedSessions = [...this.sessions.values()]
    if (selectedSessions.length) {
      const d = details(); d.sessions = selectedSessions.map(session => ({ cwd: session.cwd, path: session.sourcePath, title: session.title, ...(session.workspaceKind === 'projectless' ? { workspaceKind: 'projectless' as const } : {}) }))
      items.push({ providerId: 'claude-cowork', cwd: null, description: `Import ${selectedSessions.length} Cowork JSONL transcript${selectedSessions.length === 1 ? '' : 's'}`, details: d, itemType: 'SESSIONS' })
    }
    return { items, unsupportedProjects: options.workspaceRoots ? unsupportedProjects.filter(project => project.sourceFolders.some(root => options.workspaceRoots!.includes(root))) : unsupportedProjects, connectors: [...connectors.values()], warnings }
  }
  private async filesUnder(root: string, depth: number): Promise<string[]> {
    if (depth < 0) return []
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    if (entries.length > 2_000) throw new Error('Cowork directory exceeds discovery limit')
    const files: string[] = []
    for (const entry of entries) { if (entry.isFile()) files.push(join(root, entry.name)); else if (entry.isDirectory()) files.push(...await this.filesUnder(join(root, entry.name), depth - 1)) }
    return files
  }
  private async transcriptPaths(storage: string, cliId: string | null): Promise<string[]> {
    if (cliId) { const paths = (await Promise.all(['transcripts', 'projects'].map(name => this.filesUnder(join(storage, '.claude', name), 8)))).flat().filter(path => basename(path) === `${cliId}.jsonl`); if (paths.length) return paths }
    const audit = join(storage, 'audit.jsonl'); return await exists(audit) ? [audit] : []
  }
  private async mcpServers(accountDirectory: string): Promise<Map<string, JsonMap>> {
    const servers = new Map<string, JsonMap>()
    const settings = await this.accountSettings(accountDirectory)
    const disabledValue = settings.disabledMcpjsonServers ?? settings.disabledMcpServers
    const disabled = new Set(Array.isArray(disabledValue) ? disabledValue.filter(name => typeof name === 'string').map(name => name.trim()) : [])
    for (const path of [join(this.options.userDataDirectory, 'claude_desktop_config.json'), join(accountDirectory, 'mcp.json'), join(accountDirectory, 'mcp-servers.json')]) {
      const config = await json(path)
      if (!record(config)) continue
      const value = { ...(record(config.mcpServers) ? config.mcpServers : {}), ...(record(config.mcp_servers) ? config.mcp_servers : {}) }
      for (const [name, entry] of Object.entries(value)) {
        if (!name.trim() || disabled.has(name.trim()) || !record(entry) || entry.disabled === true || entry.enabled === false || servers.has(name.trim())) continue
        const supported: JsonMap = { enabled: true }
        if (typeof entry.command === 'string' && entry.command.trim()) {
          if (entry.type != null && entry.type !== 'stdio') continue
          const command = entry.command.trim()
          supported.command = command.startsWith('./') || command.startsWith('../') ? resolve(dirname(path), command) : command
          if (Array.isArray(entry.args) && entry.args.length) supported.args = entry.args
          if (record(entry.env)) {
            const env: JsonMap = {}, envVars: string[] = []
            for (const [key, raw] of Object.entries(entry.env)) { const value = String(raw); if (value === '${' + key + '}') envVars.push(key); else env[key] = value }
            if (envVars.length) supported.env_vars = envVars
            if (Object.keys(env).length) supported.env = env
          }
        } else if (typeof entry.url === 'string' && entry.url.trim()) {
          if (entry.type != null && !['http', 'streamable_http', 'streamable-http'].includes(String(entry.type))) continue
          supported.url = entry.url.trim()
          if (record(entry.headers)) {
            const headers: JsonMap = {}, envHeaders: JsonMap = {}
            for (const [key, raw] of Object.entries(entry.headers)) {
              const value = String(raw), bearer = /^Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value), env = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)
              if (key.toLowerCase() === 'authorization' && bearer) supported.bearer_token_env_var = bearer[1]
              else if (env) envHeaders[key] = env[1]
              else headers[key] = value
            }
            if (Object.keys(headers).length) supported.http_headers = headers
            if (Object.keys(envHeaders).length) supported.env_http_headers = envHeaders
          }
        } else continue
        servers.set(name.trim(), supported)
      }
    }
    return servers
  }
  private async accountSettings(accountDirectory: string): Promise<JsonMap> {
    const settings: JsonMap = {}
    for (const name of ['cowork_account_settings.json', 'cowork_settings.json']) { const value = await json(join(accountDirectory, name)); if (record(value)) Object.assign(settings, value) }
    return settings
  }
  private async registryNames(accountDirectory: string, kind: 'agents' | 'skills', count: number): Promise<Map<string, string>> {
    const registry = await json(join(accountDirectory, `${kind}.json`))
    const entries = Array.isArray(registry) ? registry : record(registry) && Array.isArray(registry[kind]) ? registry[kind] as unknown[] : []
    const names = new Map<string, string>()
    for (const entry of entries) {
      if (!record(entry)) continue
      const name = text(entry.name ?? entry.id)
      if (!name) continue
      names.set(typeof entry.path === 'string' ? basename(entry.path, '.md') : slug(name), name)
    }
    if (entries.length === 1 && count === 1 && record(entries[0])) { const name = text(entries[0].name ?? entries[0].id); if (name) names.set('fallback', name) }
    return names
  }
  private async importSkillsAndAgents(accountDirectory: string, stopRequested: () => boolean): Promise<string[]> {
    const imported: string[] = []
    for (const kind of ['skills', 'agents'] as const) {
      const sourceRoot = join(accountDirectory, kind)
      const files = (await readdir(sourceRoot, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => join(sourceRoot, entry.name))
      const names = await this.registryNames(accountDirectory, kind, files.length)
      for (const path of files) {
        if (stopRequested() || this.disposed) return imported
        const fallback = basename(path, '.md'), name = names.get(fallback) ?? names.get('fallback') ?? (kind === 'agents' ? fallback.split(/[-_]+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : fallback)
        const target = kind === 'skills' ? join(this.options.codexHome, 'skills', slug(name), 'SKILL.md') : join(this.options.codexHome, 'agents', `${slug(name)}.toml`)
        if (await exists(target)) continue
        const body = (await readFile(path, 'utf8')).trim()
        if (stopRequested() || this.disposed) return imported
        const skillBody = /^---\n([\s\S]*?)\n---/.exec(body)
        const output = kind === 'skills' ? skillBody && /\bname\s*:/.test(skillBody[1]) && /\bdescription\s*:/.test(skillBody[1]) ? `${body}\n` : `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(`Migrated Claude Cowork skill ${name}.`)}\n---\n\n${body}\n` : `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(`Migrated Claude Cowork agent ${name}.`)}\ndeveloper_instructions = ${JSON.stringify(body)}\n`
        await this.write(() => mkdir(dirname(target), { recursive: true }))
        if (stopRequested() || this.disposed) return imported
        await this.write(() => writeFile(target, output, { flag: 'wx', mode: 0o600 })); imported.push(target)
      }
    }
    const accountName = basename(dirname(accountDirectory)), orgName = basename(accountDirectory)
    const skillPluginRoot = join(this.options.userDataDirectory, 'local-agent-mode-sessions/skills-plugin', orgName, accountName)
    const skip = await json(join(skillPluginRoot, 'manifest.json'))
    const skipIds = new Set(record(skip) && Array.isArray(skip.skills) ? skip.skills.flatMap(entry => record(entry) && entry.creatorType === 'anthropic' && typeof entry.skillId === 'string' ? [entry.skillId] : []) : [])
    for (const root of [...['rpm', 'skills', 'cowork_plugins', '.local-plugins', '.remote-plugins'].map(name => join(accountDirectory, name)), skillPluginRoot]) {
      for (const path of (await this.filesUnder(root, 8)).filter(path => basename(path) === 'SKILL.md')) {
        if (stopRequested() || this.disposed) return imported
        const source = dirname(path)
        if (root === skillPluginRoot && skipIds.has(basename(source))) continue
        let parent = source, plugin = false
        while (within(root, parent)) {
          if (await exists(join(parent, '.claude-plugin/plugin.json')) || await exists(join(parent, '.codex-plugin/plugin.json'))) { plugin = true; break }
          if (parent === root) break
          parent = dirname(parent)
        }
        if (plugin) continue
        const target = join(this.options.codexHome, 'skills', slug(basename(source)))
        if (await exists(join(target, 'SKILL.md'))) continue
        if (stopRequested() || this.disposed) return imported
        await this.write(() => mkdir(dirname(target), { recursive: true }))
        if (stopRequested() || this.disposed) return imported
        await this.write(() => cp(source, target, { recursive: true, force: false, errorOnExist: false })); imported.push(join(target, 'SKILL.md'))
      }
    }
    return imported
  }
  private async findPlugins(accountDirectory: string): Promise<CoworkPlugin[]> {
    const plugins: CoworkPlugin[] = []
    const orgName = basename(accountDirectory), accountName = basename(dirname(accountDirectory))
    for (const root of [...['rpm', 'cowork_plugins', '.local-plugins', '.remote-plugins', 'skills'].map(name => join(accountDirectory, name)), join(this.options.userDataDirectory, 'local-agent-mode-sessions/skills-plugin', orgName, accountName)]) {
      const files = await this.filesUnder(root, 6)
      for (const path of files.filter(path => basename(path) === 'plugin.json' && ['.claude-plugin', '.codex-plugin'].includes(basename(dirname(path))))) {
        const manifest = await json(path)
        if (!record(manifest) || typeof manifest.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(manifest.name)) continue
        const plugin = { name: manifest.name, root: dirname(dirname(path)), manifest, version: text(manifest.version) ?? 'local' }
        plugins.push(plugin); this.plugins.set(`${accountDirectory}:${plugin.name}`, plugin)
      }
    }
    return plugins
  }
  async import(items: ExternalAgentMigrationItem[], stopRequested: () => boolean) {
    const itemTypeResults: ExternalAgentImportTypeResult[] = []
    const projectRoots = new Set<string>(), threadRoots = new Map<string, string>(), importedSessionThreadIds: string[] = []
    const resultFor = (item: ExternalAgentMigrationItem): ExternalAgentImportTypeResult => { const result = { itemType: item.itemType, successes: [], failures: [] }; itemTypeResults.push(result); return result }
    for (const item of items) {
      if (stopRequested() || this.disposed) break
      const result = resultFor(item)
      try {
        if (item.itemType === 'AGENTS_MD') {
          const project = item.cwd ? this.projects.get(item.cwd) : null
          if (!project) throw new Error('Cowork project instructions are no longer available; detect again')
          const target = join(project.root, 'AGENTS.md'), previous = await readFile(target, 'utf8').catch(() => '')
          if (stopRequested() || this.disposed) break
          const section = `## Imported Claude Cowork project instructions${project.instructions?.trim() ? `\n\n${project.instructions.trim()}` : ''}\n`
          if (!previous.includes('## Imported Claude Cowork project instructions') && !previous.includes('## Claude Cowork Migration')) await this.write(() => writeFile(target, `${previous}${previous === '' || previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n'}${section}`, { mode: 0o600 }))
          result.successes.push({ itemType: item.itemType, cwd: project.root, source: project.root, target }); projectRoots.add(project.root)
          await this.updateHistory(history => { if (!history.projects.some(entry => entry.sourceRoot === project.root && entry.spaceId === project.spaceId)) history.projects.push({ sourceRoot: project.root, spaceId: project.spaceId!, importedAtMs: Date.now() }) })
        } else if (item.itemType === 'CONFIG' || item.itemType === 'MCP_SERVER_CONFIG') {
          if (!item.sourcePath) throw new Error('Cowork account/org source is missing')
          const servers = await this.mcpServers(item.sourcePath)
          const configResponse = await this.options.server.request<{ config?: JsonMap }>('config/read', { includeLayers: false })
          if (stopRequested() || this.disposed) break
          const current = configResponse.config ?? {}
          const selected = item.details?.mcpServers.length ? new Set(item.details.mcpServers.map(server => server.name)) : null
          for (const [name, value] of servers) if (!selected || selected.has(name)) {
            if (stopRequested() || this.disposed) break
            if (record(current.mcp_servers) && current.mcp_servers[name] != null) continue
            await this.requestMutation('config/value/write', { keyPath: `mcp_servers.${JSON.stringify(name)}`, value, mergeStrategy: 'replace' })
            result.successes.push({ itemType: 'MCP_SERVER_CONFIG', source: name, target: name })
          }
          const settings = await this.accountSettings(item.sourcePath)
          const model = text(settings.model)
          const modelName = model?.startsWith('claude-opus') ? 'gpt-5.6-terra' : model?.startsWith('claude-sonnet') || model?.startsWith('claude-haiku') ? 'gpt-5.6-luna' : model
          const permission = settings.permissionMode === 'acceptEdits' ? 'workspace-write' : settings.permissionMode === 'readOnly' ? 'read-only' : null
          for (const [keyPath, value] of [['model', modelName], ['sandbox_mode', permission]] as const) if (!stopRequested() && !this.disposed && value && current[keyPath] == null) await this.requestMutation('config/value/write', { keyPath, value, mergeStrategy: 'replace' })
          const importedPaths = stopRequested() || this.disposed ? [] : await this.importSkillsAndAgents(item.sourcePath, stopRequested)
          if (result.successes.length || importedPaths.length || modelName || permission) {
            if (!this.disposed) await this.requestMutation('config/mcpServer/reload')
            result.successes.push({ itemType: 'CONFIG', source: item.sourcePath })
            await this.updateHistory(history => history.accountSetupItems.push({ accountOrgDir: item.sourcePath!, itemType: 'CONFIG', importedAtMs: Date.now() }))
          }
          if (!stopRequested() && !this.disposed && !servers.size && !importedPaths.length && !modelName && !permission) result.failures.push({ itemType: 'CONFIG', source: item.sourcePath, failureStage: 'unsupported-surface', message: 'No supported Cowork model, permission mode, MCP server, Markdown skill or agent was found.' })
        } else if (item.itemType === 'PLUGINS') {
          if (!item.sourcePath) throw new Error('Cowork plugin account/org source is missing')
          const names = item.details?.plugins.flatMap(group => group.pluginNames) ?? []
          const cacheRoot = join(this.options.codexHome, 'plugins/cache/claude-cowork')
          const marketplacePlugins: { name: string; source: { path: string; source: string } }[] = []
          for (const name of names) {
            if (stopRequested() || this.disposed) break
            const plugin = this.plugins.get(`${item.sourcePath}:${name}`)
            if (!plugin) throw new Error(`Cowork plugin ${name} is unavailable; detect again`)
            const version = /^[a-zA-Z0-9._-]{1,128}$/.test(plugin.version) ? plugin.version : 'local'
            const target = join(cacheRoot, name, version)
            await this.write(() => mkdir(dirname(target), { recursive: true }))
            if (stopRequested() || this.disposed) break
            await this.write(() => cp(plugin.root, target, { recursive: true, force: false, errorOnExist: false, filter: path => !['.mcp.json', 'mcp.json'].includes(basename(path)) }))
            if (stopRequested() || this.disposed) break
            await this.write(() => mkdir(join(target, '.codex-plugin'), { recursive: true }))
            const manifest: JsonMap = { ...plugin.manifest, name, version }; delete manifest.skills; delete manifest.mcpServers; delete manifest.mcp_servers
            if (stopRequested() || this.disposed) break
            await this.write(() => writeFile(join(target, '.codex-plugin/plugin.json'), `${JSON.stringify(manifest)}\n`))
            marketplacePlugins.push({ name, source: { path: `./${name}/${version}`, source: 'local' } })
          }
          if (stopRequested() || this.disposed) break
          await this.write(() => mkdir(join(cacheRoot, '.agents/plugins'), { recursive: true }))
          if (stopRequested() || this.disposed) break
          await this.write(() => writeFile(join(cacheRoot, '.agents/plugins/marketplace.json'), `${JSON.stringify({ name: 'claude-cowork', plugins: marketplacePlugins })}\n`))
          if (stopRequested() || this.disposed) break
          if (names.length) await this.requestMutation('marketplace/add', { source: cacheRoot })
          for (const name of names) {
            if (stopRequested() || this.disposed) break
            await this.requestMutation('config/value/write', { keyPath: `plugins.${JSON.stringify(`${name}@claude-cowork`)}.enabled`, value: true, mergeStrategy: 'replace' })
            result.successes.push({ itemType: 'PLUGINS', source: name, target: name })
          }
          if (names.length) await this.updateHistory(history => history.accountSetupItems.push({ accountOrgDir: item.sourcePath!, itemType: 'PLUGINS', importedAtMs: Date.now() }))
        } else if (item.itemType === 'SESSIONS') {
          for (const selected of item.details?.sessions ?? []) {
            if (stopRequested() || this.disposed) break
            const session = this.sessions.get(selected.path)
            if (!session) throw new Error('Cowork transcript is no longer detected; detect again')
            const h = await this.history()
            if (h.records.some(entry => entry.sourceId === session.sourceId && entry.projectRoot === session.cwd)) continue
            const paths = session.workspaceKind === 'projectless' ? await this.options.createProjectlessPaths(session.title) : null
            if (stopRequested() || this.disposed) break
            const cwd = paths?.cwd ?? session.cwd
            const outputDirectory = paths?.outputDirectory ?? join(this.options.codexHome, 'claude-cowork-generated-files', session.sourceId.replace(/[^a-zA-Z0-9._-]/g, '-'))
            const links: string[] = []
            for (const file of session.generatedFiles) {
              if (stopRequested() || this.disposed) break
              const name = file.name.replaceAll('\\', '/')
              if (!name || name.startsWith('/') || name.split('/').includes('..') || !await exists(file.source)) continue
              const target = join(outputDirectory, name)
              if (stopRequested() || this.disposed) break
              await this.write(() => mkdir(dirname(target), { recursive: true }))
              if (stopRequested() || this.disposed) break
              await this.write(() => cp(file.source, target, { force: false, errorOnExist: false })); links.push(`[${basename(target)}](${target})`)
            }
            const messages = await readCoworkTranscript(session.sourcePath)
            if (stopRequested() || this.disposed) break
            const sourceThreadId = randomUUID(), rolloutRoot = join(this.options.codexHome, 'claude-cowork-transcript-imports', sourceThreadId), rolloutPath = join(rolloutRoot, `rollout-${sourceThreadId}.jsonl`)
            const rollout = coworkRollout(messages, { id: sourceThreadId, cwd, lastActivityAtMs: session.lastActivityAtMs, projectless: paths != null, outputDirectory, generatedLinks: links })
            await this.write(() => mkdir(rolloutRoot, { recursive: true }))
            try {
              if (stopRequested() || this.disposed) break
              await this.write(() => writeFile(rolloutPath, rollout))
              if (stopRequested() || this.disposed) break
              const fork = await this.requestMutation<{ thread: { id: string; ephemeral?: boolean } }>('thread/fork', { cwd, ephemeral: false, excludeTurns: true, path: rolloutPath, threadId: sourceThreadId })
              if (!fork.thread.id || fork.thread.ephemeral) throw new Error('Cowork import did not produce a persistent thread')
              const threadId = fork.thread.id
              result.successes.push({ itemType: 'SESSIONS', cwd, source: session.sourcePath, target: threadId, title: session.title }); importedSessionThreadIds.push(threadId)
              if (!paths) { projectRoots.add(session.cwd); threadRoots.set(threadId, session.cwd) }
              if (this.disposed) break
              if (paths) await this.options.recordProjectlessThread(threadId, paths)
              if (this.disposed) break
              if (session.title) await this.requestMutation('thread/name/set', { threadId, name: session.title })
              if (this.disposed) break
              const hash = createHash('sha256').update(await readFile(session.sourcePath)).digest('hex')
              await this.updateHistory(history => {
                history.records.push({ importedAtMs: Date.now(), importedThreadId: threadId, sourcePath: session.sourcePath, sourceId: session.sourceId, projectRoot: session.cwd, contentSha256: hash })
                for (const name of session.remoteMcpServerNames) { const old = history.connectorCandidates.find(candidate => candidate.name === name); if (old) old.sessionCount++; else history.connectorCandidates.push({ importedAtMs: Date.now(), name, sessionCount: 1, source: 'remoteMcpServersConfig' }) }
              })
            } finally { await rm(rolloutRoot, { force: true, recursive: true }) }
          }
        } else throw new Error(`Cowork ${item.itemType} is unsupported by the recovered local adapter`)
      } catch (error) { if (this.disposed) break; result.failures.push({ itemType: item.itemType, cwd: item.cwd, source: item.sourcePath, failureStage: 'import', message: error instanceof Error ? error.message : 'Cowork import failed' }) }
    }
    const grouped = new Map<ExternalAgentImportTypeResult['itemType'], ExternalAgentImportTypeResult>()
    const group = (itemType: ExternalAgentImportTypeResult['itemType']): ExternalAgentImportTypeResult => { let result = grouped.get(itemType); if (!result) { result = { itemType, successes: [], failures: [] }; grouped.set(itemType, result) } return result }
    for (const result of itemTypeResults) { for (const success of result.successes) group(success.itemType).successes.push(success); for (const failure of result.failures) group(failure.itemType).failures.push(failure) }
    const completed = [...grouped.values()]
    if (completed.length && !this.disposed) await this.requestMutation('externalAgentConfig/import/recordHistory', { providerId: 'claude-cowork', itemTypeResults: completed })
    return { itemTypeResults: completed, projectRoots: [...projectRoots], threadRoots, importedSessionThreadIds }
  }
}

export interface CoworkMessage { role: 'user' | 'assistant'; text: string; images: string[]; timestampMs: number | null }
function truncate(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, length - 1)}…` }
function content(value: unknown): { text: string; images: string[]; onlyToolResult: boolean } {
  if (typeof value === 'string') return { text: value.trim(), images: [], onlyToolResult: false }
  if (!Array.isArray(value)) return { text: '', images: [], onlyToolResult: false }
  const parts: string[] = [], images: string[] = []
  let onlyToolResult = value.length > 0
  for (const block of value) {
    if (typeof block === 'string') { parts.push(block); onlyToolResult = false; continue }
    if (!record(block)) continue
    if (block.type !== 'tool_result' && block.type !== 'thinking') onlyToolResult = false
    if (block.type === 'text' || block.type == null) parts.push(text(block.text) ?? '')
    else if (block.type === 'tool_use') {
      const input = record(block.input) ? block.input : null
      const fields = [input?.description ? `description: ${input.description}` : '', input?.command ? `command: ${input.command}` : '', input?.file_path || input?.file ? `file: ${input.file_path ?? input.file}` : ''].filter(Boolean)
      parts.push(`[external_agent_tool_call: ${text(block.name) ?? 'unknown'}]\n${fields.length ? fields.join('\n') : `input: ${truncate(JSON.stringify(block.input ?? null), 2_000)}`}\n[/external_agent_tool_call]`)
    } else if (block.type === 'tool_result') parts.push(`[external_agent_tool_result${block.is_error === true ? ': error' : ''}]\n${truncate(content(block.content).text, 4_000)}\n[/external_agent_tool_result]`)
    else if (block.type === 'image' && record(block.source) && block.source.type === 'base64' && typeof block.source.media_type === 'string' && block.source.media_type.toLowerCase().startsWith('image/') && typeof block.source.data === 'string') images.push(`data:${block.source.media_type.toLowerCase().split(';')[0].trim()};base64,${block.source.data}`)
    else if (block.type !== 'thinking') parts.push(`[external unsupported block: ${block.type}]`)
  }
  return { text: parts.filter(Boolean).join('\n\n').trim(), images, onlyToolResult }
}
export async function readCoworkTranscript(path: string): Promise<CoworkMessage[]> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('Cowork transcript exceeds the 32 MiB local import limit')
  const result: CoworkMessage[] = []
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    let value: unknown; try { value = JSON.parse(line) } catch { continue }
    if (!record(value) || value.isMeta === true || value.isSidechain === true) continue
    const role = value.role ?? value.type
    if (role !== 'user' && role !== 'assistant') continue
    const part = content(record(value.message) ? value.message.content : value.content)
    if (!part.text && !part.images.length) continue
    result.push({ role: role === 'assistant' || part.onlyToolResult ? 'assistant' : 'user', text: part.text, images: role === 'user' ? part.images : [], timestampMs: stamp(value.timestamp) })
    if (result.length > 50_000) throw new Error('Cowork transcript exceeds the message import limit')
  }
  return result
}
export function coworkRollout(messages: CoworkMessage[], options: { id: string; cwd: string; lastActivityAtMs: number | null; projectless: boolean; outputDirectory: string; generatedLinks?: string[] }): string {
  const timestamp = new Date(messages[0]?.timestampMs ?? options.lastActivityAtMs ?? 0).toISOString()
  const rows: { type: string; payload: JsonMap; timestamp: string }[] = []
  rows.push({ type: 'session_meta', timestamp, payload: { id: options.id, cwd: options.cwd, timestamp, cli_version: '0.0.0', source: 'vscode', originator: 'Codex Desktop', agent_nickname: null, agent_path: null, agent_role: null, dynamic_tools: null, model_provider: null, memory_mode: null,
    base_instructions: options.projectless ? { text: `### Projectless Chat\nThis projectless thread starts in a generated directory under the user's Documents/Codex folder.\nPrefer answering inline in chat unless using local files would make the result more useful.\nUse work/ for intermediate files, scratch analysis, scripts, drafts, and temporary assets.\nUse ${options.outputDirectory} only for user-facing deliverables that should appear as outputs.` } : null } })
  let turn = 0, last: string | null = null
  const push = (type: string, payload: JsonMap): void => { rows.push({ type, payload, timestamp }) }
  const finish = (time: number | null): void => { if (turn) push('event_msg', { type: 'task_complete', turn_id: `external-import-turn-${turn}`, last_agent_message: last, ...(time == null ? {} : { completed_at: Math.floor(time / 1_000) }) }) }
  for (const message of messages) {
    if (message.role === 'user') { finish(null); turn++; last = null; push('event_msg', { type: 'task_started', turn_id: `external-import-turn-${turn}`, collaboration_mode_kind: 'default', model_context_window: null, ...(message.timestampMs == null ? {} : { started_at: Math.floor(message.timestampMs / 1_000) }) }) }
    else if (!turn) continue
    let body = message.text
    if (message === messages.at(-1) && message.role === 'assistant' && options.generatedLinks?.length) body += `\n\nImported Cowork generated files:\n${options.generatedLinks.join('\n')}`
    push('response_item', { type: 'message', role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: body }] })
    push('event_msg', message.role === 'user' ? { type: 'user_message', message: body, text_elements: [], local_images: [], ...(message.images.length ? { images: message.images } : {}) } : { type: 'agent_message', message: body, phase: null, memory_citation: null })
    if (message.role === 'assistant') last = body
  }
  if (turn) {
    const total = messages.reduce((n, message) => n + Math.ceil(message.text.length / 4), 0)
    const usage = { cached_input_tokens: 0, input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total }
    push('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage, model_context_window: null }, rate_limits: null }); finish(messages.at(-1)?.timestampMs ?? null)
  }
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
}

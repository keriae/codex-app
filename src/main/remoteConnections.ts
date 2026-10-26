import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, posix } from 'node:path'
import type {
  CreateRemoteProjectOptions,
  RemoteProject,
  SaveRemoteConnectionOptions
} from '../shared/api'

const STORE_VERSION = 1
const MAX_CONNECTIONS = 128
const MAX_PROJECTS = 2_048
const MAX_TEXT_LENGTH = 4_096

export interface StoredRemoteConnection {
  hostId: string
  displayName: string
  host: string
  sshAlias?: string
  port?: number
  identityFile?: string
}

interface RemoteConnectionsFile {
  version: 1
  connections: StoredRemoteConnection[]
  projects: RemoteProject[]
}

const EMPTY_STATE: RemoteConnectionsFile = {
  version: STORE_VERSION,
  connections: [],
  projects: []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeSshAlias(value: unknown): string {
  if (typeof value !== 'string') throw new Error('SSH alias must be a string')
  const alias = value.trim()
  if (!alias || alias.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._:@%+\-]*$/u.test(alias)) {
    throw new Error('SSH alias contains unsupported characters')
  }
  return alias
}

function normalizeSshHost(value: unknown): string {
  if (typeof value !== 'string') throw new Error('SSH host must be a string')
  const host = value.trim()
  if (!host || host.length > 512 || host.startsWith('-') || /[\s\0]/u.test(host)) {
    throw new Error('SSH host is invalid')
  }
  return host
}

function normalizePort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new Error('SSH port must be between 1 and 65535')
  }
  return value as number
}

function normalizeIdentityFile(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('SSH identity file must be a string')
  const path = value.trim()
  if (!path || path.length > MAX_TEXT_LENGTH || path.includes('\0') || /[\r\n]/u.test(path) ||
      (!isAbsolute(path) && !path.startsWith('~/'))) {
    throw new Error('SSH identity file must be an absolute path')
  }
  return path.startsWith('~/') ? path : normalize(path)
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (value !== undefined && typeof value !== 'string') throw new Error('Display name must be a string')
  const label = typeof value === 'string' ? value.trim() : ''
  if (label.length > 256 || label.includes('\0') || /[\r\n]/u.test(label)) {
    throw new Error('Display name is invalid')
  }
  return label || fallback
}

export function normalizeRemotePath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Remote path must be a string')
  const path = value.trim()
  if (!path || path.length > MAX_TEXT_LENGTH || path.includes('\0') || /[\r\n]/u.test(path)) {
    throw new Error('Remote path is invalid')
  }
  if (!posix.isAbsolute(path)) throw new Error('Remote path must be absolute')
  const normalized = posix.normalize(path)
  return normalized.length > 1 ? normalized.replace(/\/+$/u, '') : normalized
}

function validHostId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) && value !== 'local'
}

function parseConnection(value: unknown): StoredRemoteConnection | null {
  if (!isRecord(value) || !validHostId(value.hostId)) return null
  try {
    const sshAlias = value.sshAlias === undefined ? undefined : normalizeSshAlias(value.sshAlias)
    // Files written by the first replica implementation only had sshAlias.
    const host = normalizeSshHost(value.host ?? sshAlias)
    const displayName = normalizeLabel(value.displayName, sshAlias ?? host)
    const port = normalizePort(value.port)
    const identityFile = normalizeIdentityFile(value.identityFile)
    return {
      hostId: value.hostId,
      displayName,
      host,
      ...(sshAlias ? { sshAlias } : {}),
      ...(port ? { port } : {}),
      ...(identityFile ? { identityFile } : {})
    }
  } catch {
    return null
  }
}

function parseProject(value: unknown, hostIds: ReadonlySet<string>): RemoteProject | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !validHostId(value.hostId) ||
      !hostIds.has(value.hostId)) return null
  try {
    const remotePath = normalizeRemotePath(value.remotePath)
    const label = normalizeLabel(value.label, posix.basename(remotePath) || remotePath)
    if (!value.id || value.id.length > 128) return null
    return { id: value.id, hostId: value.hostId, label, remotePath }
  } catch {
    return null
  }
}

function parseState(value: unknown): RemoteConnectionsFile | null {
  if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.connections) ||
      !Array.isArray(value.projects) || value.connections.length > MAX_CONNECTIONS ||
      value.projects.length > MAX_PROJECTS) return null
  const connections = value.connections.map(parseConnection)
  if (connections.some((item) => item === null)) return null
  const typedConnections = connections as StoredRemoteConnection[]
  const hostIds = new Set(typedConnections.map((connection) => connection.hostId))
  const projects = value.projects.map((project) => parseProject(project, hostIds))
  if (projects.some((item) => item === null)) return null
  if (hostIds.size !== typedConnections.length) return null
  const aliases = typedConnections.flatMap((connection) =>
    connection.sshAlias ? [connection.sshAlias.toLocaleLowerCase()] : [])
  if (new Set(aliases).size !== aliases.length) return null
  const displayNames = typedConnections.map((connection) => connection.displayName.toLocaleLowerCase())
  if (new Set(displayNames).size !== displayNames.length) return null
  const typedProjects = projects as RemoteProject[]
  const projectIds = new Set(typedProjects.map((project) => project.id))
  const projectPaths = new Set(typedProjects.map((project) => `${project.hostId}\0${project.remotePath}`))
  if (projectIds.size !== typedProjects.length || projectPaths.size !== typedProjects.length) return null
  return { version: STORE_VERSION, connections: typedConnections, projects: typedProjects }
}

export class RemoteConnectionStore {
  private readonly filePath: string
  private state: RemoteConnectionsFile

  constructor(userDataDirectory: string) {
    this.filePath = join(userDataDirectory, 'remote-connections.json')
    this.state = this.load()
  }

  listConnections(): StoredRemoteConnection[] {
    return this.state.connections.map((connection) => ({ ...connection }))
  }

  getConnection(hostId: string): StoredRemoteConnection {
    const connection = this.state.connections.find((item) => item.hostId === hostId)
    if (!connection) throw new Error(`Remote host ${hostId} is not configured`)
    return { ...connection }
  }

  saveConnection(options: SaveRemoteConnectionOptions): StoredRemoteConnection {
    const existing = options.hostId
      ? this.state.connections.find((connection) => connection.hostId === options.hostId)
      : undefined
    if (options.hostId && !existing) throw new Error(`Remote host ${options.hostId} is not configured`)
    const aliasValue = options.sshAlias === undefined ? existing?.sshAlias : options.sshAlias
    const sshAlias = aliasValue === undefined || aliasValue.trim() === ''
      ? undefined
      : normalizeSshAlias(aliasValue)
    const host = normalizeSshHost(options.host ?? existing?.host ?? sshAlias)
    const displayName = normalizeLabel(options.displayName, existing?.displayName ?? sshAlias ?? host)
    const port = options.port === undefined ? existing?.port : normalizePort(options.port)
    const identityFile = options.identityFile === undefined
      ? existing?.identityFile
      : normalizeIdentityFile(options.identityFile)
    const duplicate = sshAlias && this.state.connections.find((connection) =>
      connection.hostId !== existing?.hostId &&
      connection.sshAlias?.toLocaleLowerCase() === sshAlias.toLocaleLowerCase())
    if (duplicate) throw new Error(`SSH alias ${sshAlias} is already configured`)
    const duplicateDisplayName = this.state.connections.find((connection) =>
      connection.hostId !== existing?.hostId &&
      connection.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase())
    if (duplicateDisplayName) throw new Error(`Display name ${displayName} is already configured`)
    const values = {
      sshAlias,
      host,
      displayName,
      port,
      identityFile
    }
    const connection = existing
      ? {
          ...existing,
          displayName: values.displayName,
          host: values.host,
          ...(values.sshAlias ? { sshAlias: values.sshAlias } : {}),
          ...(values.port ? { port: values.port } : {}),
          ...(values.identityFile ? { identityFile: values.identityFile } : {})
        }
      : {
          hostId: randomUUID(),
          displayName: values.displayName,
          host: values.host,
          ...(values.sshAlias ? { sshAlias: values.sshAlias } : {}),
          ...(values.port ? { port: values.port } : {}),
          ...(values.identityFile ? { identityFile: values.identityFile } : {})
        }
    if (existing) {
      if (!values.sshAlias) delete connection.sshAlias
      if (!values.port) delete connection.port
      if (!values.identityFile) delete connection.identityFile
    }
    const connections = existing
      ? this.state.connections.map((item) => item.hostId === existing.hostId ? connection : item)
      : [...this.state.connections, connection]
    if (connections.length > MAX_CONNECTIONS) throw new Error('Too many remote connections')
    this.commit({ ...this.state, connections })
    return { ...connection }
  }

  deleteConnection(hostId: string): void {
    if (!this.state.connections.some((connection) => connection.hostId === hostId)) return
    this.commit({
      ...this.state,
      connections: this.state.connections.filter((connection) => connection.hostId !== hostId),
      projects: this.state.projects.filter((project) => project.hostId !== hostId)
    })
  }

  listProjects(): RemoteProject[] {
    return this.state.projects.map((project) => ({ ...project }))
  }

  getProject(id: string): RemoteProject {
    const project = this.state.projects.find((item) => item.id === id)
    if (!project) throw new Error(`Remote project ${id} is not configured`)
    return { ...project }
  }

  createProject(options: CreateRemoteProjectOptions): RemoteProject {
    this.getConnection(options.hostId)
    const remotePath = normalizeRemotePath(options.remotePath)
    const label = normalizeLabel(options.label, posix.basename(remotePath) || remotePath)
    const duplicate = this.state.projects.find((project) =>
      project.hostId === options.hostId && project.remotePath === remotePath)
    if (duplicate) throw new Error('This remote directory is already a project')
    if (this.state.projects.length >= MAX_PROJECTS) throw new Error('Too many remote projects')
    const project = { id: randomUUID(), hostId: options.hostId, label, remotePath }
    this.commit({ ...this.state, projects: [...this.state.projects, project] })
    return { ...project }
  }

  deleteProject(id: string): void {
    if (!this.state.projects.some((project) => project.id === id)) return
    this.commit({ ...this.state, projects: this.state.projects.filter((project) => project.id !== id) })
  }

  private load(): RemoteConnectionsFile {
    try {
      return parseState(JSON.parse(readFileSync(this.filePath, 'utf8'))) ?? { ...EMPTY_STATE }
    } catch {
      return { ...EMPTY_STATE }
    }
  }

  private commit(state: RemoteConnectionsFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
    this.state = state
  }
}

import type { HostId } from '../shared/api'

export interface HostTerminalSessionBridge {
  closeOwner(owner: number): Promise<void>
  dispose(): Promise<void>
}

/** Owns the terminal bridge and session routing for each app-server host. */
export class HostTerminalSessions<Bridge extends HostTerminalSessionBridge> {
  private readonly sessionsByHost = new Map<HostId, Bridge>()
  private readonly hostBySessionId = new Map<string, HostId>()

  constructor(private readonly createSessions: (hostId: HostId) => Bridge) {}

  forHost(hostId: HostId): Bridge {
    const existing = this.sessionsByHost.get(hostId)
    if (existing) return existing
    const sessions = this.createSessions(hostId)
    this.sessionsByHost.set(hostId, sessions)
    return sessions
  }

  rememberSession(id: string, hostId: HostId): void {
    this.hostBySessionId.set(id, hostId)
  }

  forgetSession(id: string): void {
    this.hostBySessionId.delete(id)
  }

  hostForSession(id: string): HostId | undefined {
    return this.hostBySessionId.get(id)
  }

  async closeOwner(owner: number): Promise<void> {
    await Promise.allSettled([...this.sessionsByHost.values()].map((sessions) => sessions.closeOwner(owner)))
  }

  async disposeHost(hostId: HostId): Promise<void> {
    const sessions = this.sessionsByHost.get(hostId)
    this.sessionsByHost.delete(hostId)
    for (const [id, sessionHostId] of this.hostBySessionId) {
      if (sessionHostId === hostId) this.hostBySessionId.delete(id)
    }
    if (sessions) await sessions.dispose()
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessionsByHost.values()]
    this.sessionsByHost.clear()
    this.hostBySessionId.clear()
    await Promise.allSettled(sessions.map((bridge) => bridge.dispose()))
  }
}

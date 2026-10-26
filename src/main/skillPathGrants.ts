import { isAbsolute, normalize } from 'node:path'

const MAX_GRANTED_SKILLS = 4_096

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSkillPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4_096 &&
    !value.includes('\0') && isAbsolute(value) && normalize(value) === value
}

/** Settings may toggle only a path returned by the server's skills catalog. */
export class SkillPathGrants {
  private readonly paths = new Map<string, true>()

  rememberList(response: unknown): void {
    if (!isRecord(response) || !Array.isArray(response.data)) return
    for (const entry of response.data.slice(0, MAX_GRANTED_SKILLS)) {
      if (!isRecord(entry) || !Array.isArray(entry.skills)) continue
      for (const skill of entry.skills.slice(0, MAX_GRANTED_SKILLS)) {
        if (!isRecord(skill) || !isSkillPath(skill.path)) continue
        this.paths.delete(skill.path)
        this.paths.set(skill.path, true)
        while (this.paths.size > MAX_GRANTED_SKILLS) {
          const oldest = this.paths.keys().next().value
          if (oldest) this.paths.delete(oldest)
        }
      }
    }
  }

  assertAllowedRpc(method: string, params: unknown): void {
    if (method !== 'skills/config/write') return
    if (!isRecord(params) || !isSkillPath(params.path) || !this.paths.has(params.path)) {
      throw new Error('Skill path was not returned by the app-server skills catalog')
    }
  }

  clear(): void {
    this.paths.clear()
  }
}

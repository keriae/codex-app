import { describe, expect, it } from 'vitest'
import { skillOperationPaths } from './SettingsIntegrations'

describe('settings skill operation selectors', () => {
  it('keeps duplicate skill selectors distinct and matches normalized inventory IDs', () => {
    const paths = skillOperationPaths({ data: [{ skills: [
      { name: 'review', scope: 'user', enabled: true, path: '/synthetic/a/SKILL.md' },
      { name: 'review', scope: 'user', enabled: false, path: '/synthetic/b/SKILL.md' },
      { name: 'review', scope: 'repo', enabled: true, path: '/synthetic/project/SKILL.md' }
    ] }] })
    expect(paths.get('user:review:0')).toBe('/synthetic/a/SKILL.md')
    expect(paths.get('user:review:1')).toBe('/synthetic/b/SKILL.md')
    expect(paths.get('repo:review:0')).toBe('/synthetic/project/SKILL.md')
  })

  it('excludes malformed records and paths that cannot be passed to main', () => {
    expect(skillOperationPaths({ data: [{ skills: [
      { name: 'review', scope: 'user', enabled: true, path: 'relative/SKILL.md' },
      { name: 'admin', scope: 'invalid', enabled: true, path: '/synthetic/SKILL.md' },
      { name: 'bad', scope: 'repo', enabled: 'true', path: '/synthetic/SKILL.md' }
    ] }] }).size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { SkillPathGrants } from './skillPathGrants'

describe('skill catalog path grants', () => {
  it('only allows skill paths explicitly returned by skills/list', () => {
    const grants = new SkillPathGrants()
    const params = { path: '/synthetic/skill/SKILL.md', enabled: false }
    expect(() => grants.assertAllowedRpc('skills/config/write', params)).toThrow('not returned')
    grants.rememberList({ data: [{
      cwd: '/synthetic/workspace',
      errors: [{ path: '/synthetic/error/SKILL.md' }],
      skills: [{ path: params.path }, { path: 'relative/SKILL.md' }]
    }] })
    expect(() => grants.assertAllowedRpc('skills/config/write', params)).not.toThrow()
    expect(() => grants.assertAllowedRpc('skills/config/write', { path: '/synthetic/error/SKILL.md' })).toThrow('not returned')
    expect(() => grants.assertAllowedRpc('skills/config/write', { path: 'relative/SKILL.md' })).toThrow('not returned')
    grants.clear()
    expect(() => grants.assertAllowedRpc('skills/config/write', params)).toThrow('not returned')
  })

  it('does not infer grants from unrelated response objects', () => {
    const grants = new SkillPathGrants()
    grants.rememberList({ path: '/synthetic/skill/SKILL.md', data: [{ path: '/synthetic/skill/SKILL.md' }] })
    expect(() => grants.assertAllowedRpc('skills/config/write', { path: '/synthetic/skill/SKILL.md' })).toThrow()
    expect(() => grants.assertAllowedRpc('skills/list', {})).not.toThrow()
  })
})

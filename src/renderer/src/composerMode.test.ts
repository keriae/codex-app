import { describe, expect, it } from 'vitest'
import {
  collaborationModeForTurn,
  composerModeIndicator,
  composerModePlaceholder,
  insertPluginInvocation
} from './composerMode'

describe('composer modes', () => {
  it('uses the measured localized placeholders and indicators', () => {
    expect(composerModePlaceholder('default')).toBeNull()
    expect(composerModePlaceholder('goal')).toBe(
      '描述你的目标，并设定可衡量的预期成果，以取得最佳效果'
    )
    expect(composerModePlaceholder('plan')).toBe('描述你的任务以生成套餐…')
    expect(composerModeIndicator('goal')).toEqual({ label: '目标', ariaLabel: '明确目标' })
    expect(composerModeIndicator('plan')).toEqual({
      label: '计划',
      ariaLabel: '关闭计划模式'
    })
  })

  it('builds the app-server plan collaboration payload only in plan mode', () => {
    expect(collaborationModeForTurn('default', 'gpt-6.1-sol', 'high')).toBeUndefined()
    expect(collaborationModeForTurn('goal', 'gpt-6.1-sol', 'high')).toBeUndefined()
    expect(collaborationModeForTurn('plan', 'gpt-6.1-sol', 'high')).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-6.1-sol',
        reasoning_effort: 'high'
      }
    })
  })

  it('inserts a functional plugin invocation without duplicating it', () => {
    expect(insertPluginInvocation('', 'documents')).toBe('$documents ')
    expect(insertPluginInvocation('Create a report', 'documents')).toBe(
      'Create a report $documents '
    )
    expect(insertPluginInvocation('$documents already selected', 'documents')).toBe(
      '$documents already selected'
    )
  })
})

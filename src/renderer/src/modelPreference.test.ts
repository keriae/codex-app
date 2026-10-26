import { describe, expect, it } from 'vitest'
import type { ModelOption, Thread } from './protocol'
import { selectInitialModel } from './modelPreference'

const models: ModelOption[] = [
  {
    id: 'new-model',
    model: 'new-model',
    displayName: 'New',
    description: '',
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: '' },
      { reasoningEffort: 'medium', description: '' }
    ]
  },
  {
    id: 'known-working-model',
    model: 'known-working-model',
    displayName: 'Known working',
    description: '',
    isDefault: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: '' },
      { reasoningEffort: 'high', description: '' }
    ]
  }
]

function thread(model: string, reasoningEffort: Thread['reasoningEffort']): Thread {
  return {
    id: `thread-${model}`,
    preview: '',
    cwd: '/workspace',
    model,
    reasoningEffort,
    createdAt: 1,
    updatedAt: 1,
    turns: []
  }
}

describe('initial model preference', () => {
  it('uses an explicitly saved model before server and history defaults', () => {
    expect(selectInitialModel(models, 'known-working-model', [])).toEqual({
      model: models[1],
      effort: 'low'
    })
  })

  it('continues the most recently used available model and effort', () => {
    expect(
      selectInitialModel(models, null, [thread('known-working-model', 'high')])
    ).toEqual({ model: models[1], effort: 'high' })
  })

  it('falls back to the model default effort when a historical effort is unsupported', () => {
    expect(
      selectInitialModel(models, null, [thread('known-working-model', 'ultra')])
    ).toEqual({ model: models[1], effort: 'low' })
  })

  it('uses the catalog default when no saved or recent model is available', () => {
    expect(selectInitialModel(models, 'removed-model', [thread('removed-model', 'low')])).toEqual({
      model: models[0],
      effort: 'medium'
    })
  })
})

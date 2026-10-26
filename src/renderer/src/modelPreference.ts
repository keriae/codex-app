import type { ModelOption, ReasoningEffort, Thread } from './protocol'

export const MODEL_PREFERENCE_KEY = 'codex-selected-model'

export interface InitialModelSelection {
  model: ModelOption
  effort: ReasoningEffort
}

export function selectInitialModel(
  models: ModelOption[],
  savedModel: string | null,
  recentThreads: Thread[]
): InitialModelSelection | null {
  if (models.length === 0) return null

  const saved = findModel(models, savedModel)
  if (saved) return { model: saved, effort: saved.defaultReasoningEffort }

  for (const thread of recentThreads) {
    const model = findModel(models, thread.model)
    if (!model) continue
    const effort = model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === thread.reasoningEffort
    )
      ? thread.reasoningEffort!
      : model.defaultReasoningEffort
    return { model, effort }
  }

  const fallback = models.find((model) => model.isDefault) || models[0]
  return { model: fallback, effort: fallback.defaultReasoningEffort }
}

function findModel(models: ModelOption[], value: string | null | undefined): ModelOption | null {
  if (!value) return null
  return models.find((model) => model.id === value || model.model === value) || null
}

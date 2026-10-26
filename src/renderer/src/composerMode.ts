import type { ReasoningEffort } from './protocol'

export type ComposerMode = 'default' | 'goal' | 'plan'

export interface ComposerModeIndicator {
  label: string
  ariaLabel: string
}

export interface PlanCollaborationMode {
  mode: 'plan'
  settings: {
    model: string
    reasoning_effort: ReasoningEffort
  }
}

export function composerModePlaceholder(mode: ComposerMode): string | null {
  if (mode === 'goal') {
    return '描述你的目标，并设定可衡量的预期成果，以取得最佳效果'
  }
  // Preserve the measured zh-CN string from the installed desktop build.
  if (mode === 'plan') return '描述你的任务以生成套餐…'
  return null
}

export function composerModeIndicator(mode: ComposerMode): ComposerModeIndicator | null {
  if (mode === 'goal') return { label: '目标', ariaLabel: '明确目标' }
  if (mode === 'plan') return { label: '计划', ariaLabel: '关闭计划模式' }
  return null
}

export function collaborationModeForTurn(
  mode: ComposerMode,
  model: string,
  effort: ReasoningEffort
): PlanCollaborationMode | undefined {
  if (mode !== 'plan') return undefined
  return {
    mode: 'plan',
    settings: {
      model,
      reasoning_effort: effort
    }
  }
}

export function insertPluginInvocation(draft: string, pluginId: string): string {
  const invocation = `$${pluginId}`
  if (!draft.trim()) return `${invocation} `
  if (draft.split(/\s+/u).includes(invocation)) return draft
  return `${draft}${/\s$/u.test(draft) ? '' : ' '}${invocation} `
}

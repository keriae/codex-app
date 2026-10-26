import { Goal as GoalIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  formatThreadGoalDuration,
  type ThreadGoal
} from './threadGoal'
import './threadGoal.css'

export interface ThreadGoalCompletionProps {
  goal: ThreadGoal | null | undefined
  locale?: string
  className?: string
}

/** Completion metadata retained after app-server automatically clears the goal. */
export function ThreadGoalCompletion({
  goal,
  locale,
  className
}: ThreadGoalCompletionProps): ReactNode {
  if (!goal || goal.status !== 'complete') return null
  const totalTime = formatThreadGoalDuration(goal.timeUsedSeconds * 1_000, locale)
  return (
    <span className={`thread-goal-completion${className ? ` ${className}` : ''}`}>
      <span className="thread-goal-completion-separator" aria-hidden="true" />
      <GoalIcon aria-hidden="true" />
      <span>{`已在 ${totalTime} 内达成目标`}</span>
    </span>
  )
}

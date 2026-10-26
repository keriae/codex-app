import type { NewThreadWorktreeChoice } from './localEnvironmentState'

export interface DraftSubmissionIdentity {
  scope: string
  id: string
}

export interface DraftSubmissionOwner {
  currentDraftScope: string | null
  currentDraftId: string | null | undefined
  selectedThreadId: string | null
  activeSubmissionId: string | null
  pendingSubmissionId: string | null | undefined
}

/** A navigation round trip can reclaim only the same still-pending empty draft. */
export function canReclaimDraftSubmission(operation: DraftSubmissionIdentity, current: DraftSubmissionOwner): boolean {
  return operation.scope.length > 0 && operation.id.length > 0 &&
    current.currentDraftScope === operation.scope &&
    current.currentDraftId === operation.scope &&
    current.selectedThreadId === null &&
    current.activeSubmissionId === null &&
    current.pendingSubmissionId === operation.id
}

/** Once creation changed the run directory, recovery must reuse that checkout. */
export function draftRecoveryWorktreeChoice(
  originalChoice: NewThreadWorktreeChoice | null | undefined,
  submissionCwd: string,
  runCwd: string
): NewThreadWorktreeChoice | null {
  return runCwd === submissionCwd && originalChoice?.enabled && originalChoice.cwd === submissionCwd
    ? { ...originalChoice }
    : null
}

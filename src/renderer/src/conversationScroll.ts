export const CONVERSATION_BOTTOM_THRESHOLD_PX = 24

export interface ConversationScrollMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export function conversationDistanceFromBottom({
  clientHeight,
  scrollHeight,
  scrollTop
}: ConversationScrollMetrics): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop)
}

export function conversationIsAtBottom(
  metrics: ConversationScrollMetrics,
  threshold = CONVERSATION_BOTTOM_THRESHOLD_PX
): boolean {
  return conversationDistanceFromBottom(metrics) <= threshold
}

/** CSS column-reverse scrollers use a negative scrollTop above their bottom. */
export function scrollContainerCanScrollUp(
  { clientHeight, scrollHeight, scrollTop }: ConversationScrollMetrics,
  { overflowY, flexDirection }: { overflowY: string; flexDirection: string }
): boolean {
  if (!['auto', 'scroll', 'overlay'].includes(overflowY)) return false
  const range = scrollHeight - clientHeight
  if (!Number.isFinite(range) || !Number.isFinite(scrollTop) || range <= 0) return false
  return flexDirection === 'column-reverse' ? scrollTop > -range : scrollTop > 0
}

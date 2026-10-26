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

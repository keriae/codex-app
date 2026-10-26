import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_BOTTOM_THRESHOLD_PX,
  conversationDistanceFromBottom,
  conversationIsAtBottom
} from './conversationScroll'

describe('conversation scroll position', () => {
  it('measures distance from the latest message', () => {
    expect(
      conversationDistanceFromBottom({
        clientHeight: 700,
        scrollHeight: 1_600,
        scrollTop: 780
      })
    ).toBe(120)
  })

  it('treats the upstream 24px tolerance as pinned to the bottom', () => {
    expect(
      conversationIsAtBottom({
        clientHeight: 700,
        scrollHeight: 1_600,
        scrollTop: 876
      })
    ).toBe(true)
    expect(
      conversationIsAtBottom({
        clientHeight: 700,
        scrollHeight: 1_600,
        scrollTop: 875
      })
    ).toBe(false)
    expect(CONVERSATION_BOTTOM_THRESHOLD_PX).toBe(24)
  })

  it('clamps browser overscroll past the end', () => {
    expect(
      conversationDistanceFromBottom({
        clientHeight: 700,
        scrollHeight: 1_000,
        scrollTop: 340
      })
    ).toBe(0)
  })
})

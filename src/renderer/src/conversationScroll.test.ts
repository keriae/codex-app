import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_BOTTOM_THRESHOLD_PX,
  conversationDistanceFromBottom,
  conversationIsAtBottom,
  scrollContainerCanScrollUp
} from './conversationScroll'

describe('conversation scroll position', () => {
  it.each([
    [0, false], [1, true], [100, true], [-10, false]
  ])('consumes upward input in ordinary nested output at scrollTop %i: %s', (scrollTop, expected) => {
    expect(scrollContainerCanScrollUp({ clientHeight: 100, scrollHeight: 300, scrollTop }, { overflowY: 'auto', flexDirection: 'column' })).toBe(expected)
  })

  it.each([
    [0, true], [-1, true], [-199, true], [-200, false], [-210, false]
  ])('consumes upward input in reversed command output at scrollTop %i: %s', (scrollTop, expected) => {
    expect(scrollContainerCanScrollUp({ clientHeight: 100, scrollHeight: 300, scrollTop }, { overflowY: 'auto', flexDirection: 'column-reverse' })).toBe(expected)
  })

  it('does not retain follow for output with no scroll range or disabled scrolling', () => {
    const metrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 10 }
    expect(scrollContainerCanScrollUp(metrics, { overflowY: 'hidden', flexDirection: 'column' })).toBe(false)
    expect(scrollContainerCanScrollUp({ ...metrics, scrollHeight: 100 }, { overflowY: 'auto', flexDirection: 'column' })).toBe(false)
    expect(scrollContainerCanScrollUp({ ...metrics, scrollTop: Number.NaN }, { overflowY: 'scroll', flexDirection: 'column-reverse' })).toBe(false)
  })

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

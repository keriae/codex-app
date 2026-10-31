import { useEffect, useRef, useState } from 'react'
import type { CommandItem } from './protocol'
import { commandActivityElapsedMs } from './commandActivity'

/** pT/RT in the installed renderer tick only the visible foreground command. */
export function useCommandActivityTiming(item: CommandItem, enabled: boolean): CommandItem {
  const fallback = useRef({ id: item.id, startedAtMs: Date.now() })
  if (fallback.current.id !== item.id) fallback.current = { id: item.id, startedAtMs: Date.now() }
  const [nowMs, setNowMs] = useState(Date.now)
  const running = enabled && item.status === 'inProgress'
  useEffect(() => {
    if (!running) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [item.id, running])
  return running ? { ...item, durationMs: commandActivityElapsedMs(item, nowMs, fallback.current.startedAtMs) } : item
}

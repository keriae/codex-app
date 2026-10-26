export interface ScheduledTaskWindow {
  isDestroyed(): boolean
}

/**
 * Scheduled runs have exactly one renderer consumer. Prefer the primary window;
 * if it no longer exists, fall back deterministically to the oldest live window.
 */
export function scheduledTaskRunnerWindow<T extends ScheduledTaskWindow>(
  primary: T | null,
  windows: Iterable<T>
): T | null {
  const liveWindows = [...windows].filter((window) => !window.isDestroyed())
  if (primary && liveWindows.includes(primary)) return primary
  return liveWindows[0] ?? null
}

export function deliverScheduledTaskRun<T extends ScheduledTaskWindow, Run>(
  primary: T | null,
  windows: Iterable<T>,
  run: Run,
  send: (window: T, run: Run) => void
): T | null {
  const runner = scheduledTaskRunnerWindow(primary, windows)
  if (runner) send(runner, run)
  return runner
}

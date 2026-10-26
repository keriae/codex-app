export interface DesktopNotificationCopy {
  title: string
  body: string
}

export function notificationForServerEvent(
  kind: 'notification' | 'server-request',
  method: string
): DesktopNotificationCopy | null {
  if (kind === 'server-request') {
    const normalizedMethod = method.toLowerCase()
    if (
      normalizedMethod.includes('approval') ||
      normalizedMethod.includes('requestuserinput') ||
      normalizedMethod.includes('elicitation') ||
      normalizedMethod.includes('permissions')
    ) {
      return { title: 'Codex needs your input', body: 'Open Codex to continue the task.' }
    }
    return null
  }

  if (method === 'turn/completed') {
    return { title: 'Codex finished a task', body: 'Open Codex to review the result.' }
  }
  return null
}

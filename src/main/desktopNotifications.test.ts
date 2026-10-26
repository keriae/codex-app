import { describe, expect, it } from 'vitest'
import { notificationForServerEvent } from './desktopNotifications'

describe('desktop notification copy', () => {
  it('uses content-free copy for completed turns', () => {
    expect(notificationForServerEvent('notification', 'turn/completed')).toEqual({
      title: 'Codex finished a task',
      body: 'Open Codex to review the result.'
    })
  })

  it('notifies for interactive server requests without including request payloads', () => {
    expect(
      notificationForServerEvent('server-request', 'item/commandExecution/requestApproval')
    ).toEqual({
      title: 'Codex needs your input',
      body: 'Open Codex to continue the task.'
    })
    expect(notificationForServerEvent('server-request', 'dynamicTool/call')).toBeNull()
  })
})

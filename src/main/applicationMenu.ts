import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../shared/api'

export function applicationMenuTemplate(
  appName: string,
  sendCommand: (command: AppCommand) => void,
  openHelp: () => void,
  includeDeveloperItems: boolean,
  windowActions?: {
    close: (keyboard: boolean) => void
    stepZoom: (delta: -1 | 1) => void
    resetZoom: () => void
  }
): MenuItemConstructorOptions[] {
  const viewItems: MenuItemConstructorOptions[] = [
    {
      label: 'Toggle Sidebar',
      accelerator: 'CmdOrCtrl+B',
      click: () => sendCommand('toggle-sidebar')
    },
    { type: 'separator' },
    ...(windowActions ? [
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => windowActions.stepZoom(1) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => windowActions.stepZoom(-1) },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: windowActions.resetZoom }
    ] : [{ role: 'resetZoom' as const }, { role: 'zoomIn' as const }, { role: 'zoomOut' as const }]),
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]

  if (includeDeveloperItems) {
    viewItems.push({ type: 'separator' }, { role: 'toggleDevTools' })
  }

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendCommand('show-settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendCommand('new-chat')
        },
        ...(windowActions ? [{
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: (_item: Electron.MenuItem, _window: Electron.BaseWindow | undefined, event: Electron.KeyboardEvent) =>
            windowActions.close(event.triggeredByAccelerator === true)
        }] : [{ role: 'close' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find Chats',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendCommand('focus-search')
        },
        { type: 'separator' },
        { role: 'startSpeaking' },
        { role: 'stopSpeaking' }
      ]
    },
    { label: 'View', submenu: viewItems },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      role: 'help',
      submenu: [{ label: 'Codex Help', click: openHelp }]
    }
  ]
}

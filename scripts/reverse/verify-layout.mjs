#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.argv[2] || 9225)
const baselinePath = resolve(process.argv[3] || 'reverse/baseline/26.1016.61520.json')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`CDP target discovery failed: ${response.status}`)
  return response.json()
})
const target = targets.find((candidate) => candidate.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error(`No page target exposed on port ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
let runtimeExceptions = 0

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === 'Runtime.exceptionThrown') runtimeExceptions += 1
  if (!message.id) return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})

await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})

function command(method, params = {}) {
  const id = nextId++
  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await command('Runtime.enable')
const result = await command('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius: Number.parseFloat(style.borderRadius) || 0,
        backgroundColor: style.backgroundColor
      };
    };

    const measureContent = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const horizontalInsets =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight) +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.borderRightWidth);
      return {
        ...measure(selector),
        innerWidth: rect.width - horizontalInsets
      };
    };

    const titlebar = measure('.window-titlebar');
    const workspace = measure('.workspace-frame');
    const rail = measure('.activity-rail');
    const railIcon = measure('.rail-button svg');
    const sidebar = measure('.sidebar');
    const main = measure('.main-panel');
    const emptyChat = Boolean(document.querySelector('.conversation-content.is-empty'));
    const outputPanel = emptyChat ? null : measure('.output-panel');
    const conversationTrack = measure('.conversation-scroll');
    const conversation = measureContent('.conversation-content');
    const composerOuter = measure('.composer-dock');
    const composer = measure('.composer');
    const contextStrip = measure('.composer-context-strip');
    const editor = measure('.composer textarea');
    const editorStyle = document.querySelector('.composer textarea')
      ? getComputedStyle(document.querySelector('.composer textarea'))
      : null;
    const titlebarActions = [...document.querySelectorAll('.titlebar-actions > button')]
      .map((button) => button.getAttribute('aria-label'))
      .filter(Boolean);
    const outputTrack = main && conversationTrack
      ? {
          x: conversationTrack.x + conversationTrack.width,
          y: main.y,
          width: main.x + main.width - conversationTrack.x - conversationTrack.width,
          height: main.height
        }
      : null;

    return {
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      emptyChat,
      titlebar,
      workspace,
      rail,
      railIcon,
      sidebar,
      main,
      outputTrack,
      outputPanel,
      outputPanelInsets: main && outputPanel
        ? {
            top: outputPanel.y - main.y,
            right: main.x + main.width - outputPanel.x - outputPanel.width
          }
        : null,
      conversationTrack,
      conversation,
      composerOuter,
      composer,
      contextStrip,
      editor: editor && editorStyle
        ? {
            ...editor,
            fontSize: Number.parseFloat(editorStyle.fontSize),
            lineHeight: Number.parseFloat(editorStyle.lineHeight)
          }
        : null,
      composerInsets: composerOuter && composer
        ? {
            outerBottom: main.y + main.height - composerOuter.y - composerOuter.height,
            bottom: main.y + main.height - composer.y - composer.height,
            inline: composer.x - composerOuter.x
          }
        : null,
      titlebarActions,
      titlebarThreadVisible: Boolean(document.querySelector('.titlebar-thread-primary')),
      rendererRequire: typeof window.require,
      rendererProcess: typeof window.process
    };
  })()`
})

await new Promise((resolveWait) => setTimeout(resolveWait, 150))
const actual = result.result.value
const expected = baseline.renderer.layoutCssPixels
const expectedViewport = baseline.renderer.viewportCssPixels
const expectedState = actual.emptyChat ? expected.emptyChat : expected
const failures = []

function closeTo(label, value, targetValue, tolerance = 1) {
  if (typeof value !== 'number' || Math.abs(value - targetValue) > tolerance) {
    failures.push(`${label}: expected ${targetValue}±${tolerance}, received ${String(value)}`)
  }
}

function cssRgb(value) {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!hex) return value.replace(/\s+/g, ' ').trim().toLowerCase()
  return `rgb(${Number.parseInt(hex[1], 16)}, ${Number.parseInt(hex[2], 16)}, ${Number.parseInt(hex[3], 16)})`
}

function sameColor(label, value, targetValue) {
  if (typeof value !== 'string' || cssRgb(value) !== cssRgb(targetValue)) {
    failures.push(`${label}: expected ${targetValue}, received ${String(value)}`)
  }
}

closeTo('viewport.width', actual.viewport?.width, expectedViewport.width)
closeTo('viewport.height', actual.viewport?.height, expectedViewport.height)
closeTo('devicePixelRatio', actual.devicePixelRatio, expectedViewport.devicePixelRatio, 0.01)

closeTo('titlebar.x', actual.titlebar?.x, 0)
closeTo('titlebar.y', actual.titlebar?.y, 0)
closeTo('titlebar.width', actual.titlebar?.width, expectedViewport.width)
closeTo('titlebar.height', actual.titlebar?.height, expected.titlebarHeight)

closeTo('workspace.x', actual.workspace?.x, 0)
closeTo('workspace.y', actual.workspace?.y, expected.titlebarHeight)
closeTo(
  'workspace.width',
  actual.workspace?.width,
  expectedViewport.width - expected.workspaceInsets.right
)
closeTo(
  'workspace.height',
  actual.workspace?.height,
  expectedViewport.height - expected.titlebarHeight - expected.workspaceInsets.bottom
)

closeTo('rail.x', actual.rail?.x, 0)
closeTo('rail.y', actual.rail?.y, expected.titlebarHeight)
closeTo('rail.width', actual.rail?.width, expected.iconRailWidth)
closeTo('rail.height', actual.rail?.height, expected.main.height)
closeTo('railIcon.width', actual.railIcon?.width, expected.railIconSize)
closeTo('railIcon.height', actual.railIcon?.height, expected.railIconSize)

closeTo('sidebar.x', actual.sidebar?.x, expected.iconRailWidth)
closeTo('sidebar.y', actual.sidebar?.y, expected.titlebarHeight)
closeTo('sidebar.width', actual.sidebar?.width, expected.sidebarWidth)
closeTo('sidebar.height', actual.sidebar?.height, expected.main.height)
closeTo('sidebar.borderRadius', actual.sidebar?.borderRadius, expected.sidebarBorderRadius)

closeTo('main.x', actual.main?.x, expected.main.x)
closeTo('main.y', actual.main?.y, expected.main.y)
closeTo('main.width', actual.main?.width, expected.main.width)
closeTo('main.height', actual.main?.height, expected.main.height)

const expectedOutputTrackWidth = expectedState.outputTrackWidth ?? expected.outputTrackWidth
const expectedOutputTrackX = expected.main.x + expected.main.width - expectedOutputTrackWidth
closeTo('conversationTrack.x', actual.conversationTrack?.x, expected.main.x)
closeTo('conversationTrack.y', actual.conversationTrack?.y, expected.main.y)
closeTo(
  'conversationTrack.width',
  actual.conversationTrack?.width,
  expected.main.width - expectedOutputTrackWidth
)
closeTo('conversationTrack.height', actual.conversationTrack?.height, expected.main.height)
closeTo('outputTrack.x', actual.outputTrack?.x, expectedOutputTrackX)
closeTo('outputTrack.y', actual.outputTrack?.y, expected.main.y)
closeTo('outputTrack.width', actual.outputTrack?.width, expectedOutputTrackWidth)
closeTo('outputTrack.height', actual.outputTrack?.height, expected.main.height)

if (actual.emptyChat) {
  if (actual.outputPanel !== null) failures.push('empty chat unexpectedly renders an output panel')
  if (JSON.stringify(actual.titlebarActions) !== JSON.stringify(expectedState.titlebarActions)) {
    failures.push(
      `empty chat titlebar actions: expected ${JSON.stringify(expectedState.titlebarActions)}, received ${JSON.stringify(actual.titlebarActions)}`
    )
  }
  if (actual.titlebarThreadVisible !== expectedState.titlebarThreadVisible) {
    failures.push(
      `empty chat titlebar thread visibility: expected ${String(expectedState.titlebarThreadVisible)}, received ${String(actual.titlebarThreadVisible)}`
    )
  }
} else {
  const expectedOutputPanelX =
    expected.main.x + expected.main.width - expected.outputCard.right - expected.outputCard.width
  const expectedOutputPanelY = expected.main.y + expected.outputCard.top
  closeTo('outputPanel.x', actual.outputPanel?.x, expectedOutputPanelX)
  closeTo('outputPanel.y', actual.outputPanel?.y, expectedOutputPanelY)
  closeTo('outputPanel.width', actual.outputPanel?.width, expected.outputCard.width)
  closeTo('outputPanel.height', actual.outputPanel?.height, expected.outputCard.height)
  closeTo('outputPanel.borderRadius', actual.outputPanel?.borderRadius, expected.outputCard.borderRadius)
  closeTo('outputPanelInsets.top', actual.outputPanelInsets?.top, expected.outputCard.top)
  closeTo('outputPanelInsets.right', actual.outputPanelInsets?.right, expected.outputCard.right)
}

closeTo('conversation.x', actual.conversation?.x, expectedState.conversation.outerX)
closeTo('conversation.width', actual.conversation?.width, expectedState.conversation.outerWidth)
closeTo('conversation.innerWidth', actual.conversation?.innerWidth, expectedState.conversation.innerWidth)

closeTo('composerOuter.x', actual.composerOuter?.x, expectedState.composer.outerX)
closeTo('composerOuter.width', actual.composerOuter?.width, expectedState.composer.outerWidth)
closeTo('composer.x', actual.composer?.x, expectedState.composer.x)
closeTo('composer.width', actual.composer?.width, expectedState.composer.innerWidth)
closeTo('composer.height', actual.composer?.height, expectedState.composer.height)
closeTo('composer.borderRadius', actual.composer?.borderRadius, expectedState.composer.borderRadius)
closeTo('composerInsets.outerBottom', actual.composerInsets?.outerBottom, expectedState.composer.bottom)
closeTo('composerInsets.bottom', actual.composerInsets?.bottom, expectedState.composer.bottom)
closeTo(
  'composerInsets.inline',
  actual.composerInsets?.inline,
  (expectedState.composer.outerWidth - expectedState.composer.innerWidth) / 2
)

if (actual.emptyChat) {
  closeTo('contextStrip.x', actual.contextStrip?.x, expectedState.contextStrip.x)
  closeTo('contextStrip.width', actual.contextStrip?.width, expectedState.contextStrip.width)
  closeTo('contextStrip.height', actual.contextStrip?.height, expectedState.contextStrip.height)
  closeTo(
    'contextStrip.borderRadius',
    actual.contextStrip?.borderRadius,
    expectedState.contextStrip.borderRadius
  )
  closeTo('editor.x', actual.editor?.x, expectedState.editor.x)
  closeTo('editor.width', actual.editor?.width, expectedState.editor.width)
  closeTo('editor.height', actual.editor?.height, expectedState.editor.height)
  closeTo('editor.fontSize', actual.editor?.fontSize, expectedState.editor.fontSize, 0.01)
  closeTo('editor.lineHeight', actual.editor?.lineHeight, expectedState.editor.lineHeight, 0.01)
}

sameColor('titlebar.backgroundColor', actual.titlebar?.backgroundColor, baseline.renderer.colors.chromeBackground)
sameColor('rail.backgroundColor', actual.rail?.backgroundColor, baseline.renderer.colors.railBackground)
sameColor('sidebar.backgroundColor', actual.sidebar?.backgroundColor, baseline.renderer.colors.sidebarBackground)
sameColor('main.backgroundColor', actual.main?.backgroundColor, baseline.renderer.colors.mainBackground)
if (!actual.emptyChat) {
  sameColor(
    'outputPanel.backgroundColor',
    actual.outputPanel?.backgroundColor,
    baseline.renderer.colors.outputCardBackground
  )
}
sameColor(
  'composer.backgroundColor',
  actual.composer?.backgroundColor,
  baseline.renderer.colors.composerBackground
)
if (actual.rendererRequire !== 'undefined' || actual.rendererProcess !== 'undefined') {
  failures.push('renderer unexpectedly exposes Node.js globals')
}
if (runtimeExceptions !== 0) failures.push(`runtime exceptions: ${runtimeExceptions}`)

const report = {
  targetVersion: baseline.application.marketingVersion,
  actual,
  runtimeExceptions,
  passed: failures.length === 0,
  failures
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
socket.close()
if (failures.length) process.exitCode = 1

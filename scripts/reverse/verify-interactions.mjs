#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const port = Number(process.argv[2] || 9225)
const outputDirectory = resolve(
  process.argv[3] || 'reverse/raw/checks/interactions'
)

await mkdir(outputDirectory, { recursive: true })

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

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  }
  return response.result.value
}

const pause = (duration = 100) => new Promise((resolvePause) => setTimeout(resolvePause, duration))

async function waitFor(expression, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(expression)
    if (lastValue) return lastValue
    await pause(50)
  }
  throw new Error(`Timed out waiting for ${expression}; last value: ${JSON.stringify(lastValue)}`)
}

async function rect(selector, text = null) {
  return evaluate(`(() => {
    const selector = ${JSON.stringify(selector)};
    const expectedText = ${JSON.stringify(text)};
    const candidates = [...document.querySelectorAll(selector)];
    const element = expectedText === null
      ? candidates[0]
      : candidates.find((candidate) => candidate.textContent?.trim() === expectedText);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  })()`)
}

async function click(selector, text = null) {
  const box = await rect(selector, text)
  if (!box) throw new Error(`Could not find click target ${selector} ${text || ''}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
  await pause()
}

async function hover(selector, text = null) {
  const box = await rect(selector, text)
  if (!box) throw new Error(`Could not find hover target ${selector} ${text || ''}`)
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  })
  await pause(180)
}

const keyCodes = {
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  ArrowUp: 38,
  End: 35,
  Enter: 13,
  Escape: 27,
  Home: 36,
  Tab: 9,
  ' ': 32
}

async function pressKey(key) {
  const code = key === ' ' ? 'Space' : key
  const windowsVirtualKeyCode = keyCodes[key]
  await command('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode
  })
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode
  })
  await pause()
}

async function drag(from, to) {
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: from.x,
    y: from.y
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      button: 'left',
      buttons: 1
    })
  }
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
  await pause(150)
}

async function screenshot(name, selector, padding = 0) {
  const box = await rect(selector)
  if (!box) throw new Error(`Could not find screenshot target ${selector}`)
  const viewport = await evaluate(`({ width: innerWidth, height: innerHeight })`)
  const x = Math.max(0, box.x - padding)
  const y = Math.max(0, box.y - padding)
  const width = Math.min(viewport.width - x, box.width + padding * 2)
  const height = Math.min(viewport.height - y, box.height + padding * 2)
  const result = await command('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x, y, width, height, scale: 1 }
  })
  const path = resolve(outputDirectory, `${name}.png`)
  await writeFile(path, Buffer.from(result.data, 'base64'))
  return relative(process.cwd(), path)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = []
async function check(name, run) {
  try {
    const evidence = await run()
    checks.push({ name, passed: true, evidence })
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) })
  }
}

await command('Page.enable')
await command('Runtime.enable')
await command('Page.reload', { ignoreCache: true })
await waitFor(`document.querySelector('.app-shell')?.dataset.backendState === 'ready'`)

const initialSidebar = await evaluate(`(() => {
  const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
  return {
    width: sidebar?.width || null,
    stored: localStorage.getItem('codex-sidebar-preferred-width-v1')
  };
})()`)

async function startBlankChat() {
  await click('button[aria-label="New chat"]')
  return waitFor(`(() => ({
    noWorkspace: !document.querySelector('.workspace-pane'),
    noThreadTitle: !document.querySelector('.titlebar-thread-primary'),
    noConversationMenu: !document.querySelector('button[aria-label="会话操作"]'),
    noControlsMenu: !document.querySelector('button[aria-label="会话控制"]'),
    composer: Boolean(document.querySelector('.composer-dock.empty .composer textarea')),
    sendableContext: !document.querySelector('.composer textarea')?.disabled
  }))().noWorkspace &&
    !document.querySelector('.titlebar-thread-primary') &&
    !document.querySelector('button[aria-label="会话操作"]') &&
    !document.querySelector('button[aria-label="会话控制"]') &&
    Boolean(document.querySelector('.composer-dock.empty .composer textarea'))`)
}

async function requireSelectedThread() {
  const selected = await evaluate(`(() => ({
    title: document.querySelector('.titlebar-thread-primary span')?.textContent?.trim() || null,
    workspace: Boolean(document.querySelector('.workspace-pane')),
    operations: Boolean(document.querySelector('button[aria-label="会话操作"]')),
    controls: Boolean(document.querySelector('button[aria-label="会话控制"]')),
    composer: Boolean(document.querySelector('.composer-dock:not(.empty) textarea'))
  }))()`)
  assert(selected.title, 'no real thread is selected')
  assert(selected.workspace, 'selected thread did not render WorkspacePane')
  assert(selected.operations && selected.controls, 'selected thread titlebar controls are missing')
  assert(selected.composer, 'selected thread composer is missing')
  return selected
}

let smokeMarker = null
let smokeThreadId = null

await check('New-chat empty state has no WorkspacePane and only the New chat titlebar action', async () => {
  await startBlankChat()
  const empty = await evaluate(`(() => {
    const actions = [...document.querySelectorAll('.titlebar-actions > button')].map((button) =>
      button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim()
    );
    const send = document.querySelector('.composer .send-button.send');
    const sendIcon = send?.querySelector('svg');
    const sendBox = send?.getBoundingClientRect();
    const sendIconBox = sendIcon?.getBoundingClientRect();
    const sendStyle = send ? getComputedStyle(send) : null;
    const sendIconStyle = sendIcon ? getComputedStyle(sendIcon) : null;
    return {
      workspace: Boolean(document.querySelector('.workspace-pane')),
      output: Boolean(document.querySelector('.output-panel')),
      composerEmpty: Boolean(document.querySelector('.composer-dock.empty')),
      heading: document.querySelector('.conversation-empty h1')?.textContent?.trim() || null,
      threadTitle: Boolean(document.querySelector('.titlebar-thread-primary')),
      conversationMenu: Boolean(document.querySelector('button[aria-label="会话操作"]')),
      controlsMenu: Boolean(document.querySelector('button[aria-label="会话控制"]')),
      actions,
      send: sendBox && sendIconBox ? {
        label: send?.getAttribute('aria-label'),
        disabled: send?.disabled,
        width: sendBox.width,
        height: sendBox.height,
        opacity: sendStyle?.opacity || null,
        backgroundColor: sendStyle?.backgroundColor || null,
        color: sendStyle?.color || null,
        iconWidth: sendIconBox.width,
        iconHeight: sendIconBox.height,
        iconFill: sendIconStyle?.fill || null,
        iconStroke: sendIconStyle?.stroke || null,
        iconStrokeWidth: sendIconStyle?.strokeWidth || null,
        path: sendIcon.querySelector('path')?.getAttribute('d') || null
      } : null
    };
  })()`)
  assert(!empty.workspace && !empty.output, 'new chat unexpectedly rendered Workspace/output')
  assert(empty.composerEmpty, 'new chat did not render the empty composer layout')
  assert(!empty.threadTitle, 'new chat unexpectedly rendered a conversation title')
  assert(!empty.conversationMenu && !empty.controlsMenu, 'new chat rendered thread-only menus')
  assert(JSON.stringify(empty.actions) === JSON.stringify(['New chat']), `empty titlebar actions: ${JSON.stringify(empty.actions)}`)
  assert(empty.send?.label === '发送' && empty.send.disabled, `empty send control: ${JSON.stringify(empty.send)}`)
  assert(empty.send?.width === 28 && empty.send?.height === 28, `send button geometry: ${JSON.stringify(empty.send)}`)
  assert(empty.send?.opacity === '0.5', `disabled send opacity: ${empty.send?.opacity}`)
  assert(empty.send?.backgroundColor === 'rgb(252, 252, 252)', `send button background: ${empty.send?.backgroundColor}`)
  assert(empty.send?.color === 'rgb(38, 38, 38)', `send button color: ${empty.send?.color}`)
  assert(empty.send?.iconWidth === 16 && empty.send?.iconHeight === 16, `send icon geometry: ${JSON.stringify(empty.send)}`)
  assert(empty.send?.iconFill === 'none' && empty.send?.iconStroke === 'rgb(38, 38, 38)', `send icon paint: ${JSON.stringify(empty.send)}`)
  assert(empty.send?.path, 'send arrow path is missing')
  const emptyScreenshot = await screenshot('01-new-chat-empty', '.main-panel')
  return { empty, screenshot: emptyScreenshot }
})

await check('Composer add menu supports mouse, keyboard, disabled-item skipping, and Escape', async () => {
  await click('button[aria-label="添加"]')
  await pause(80)
  const opened = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="添加到聊天"]');
    const box = menu?.getBoundingClientRect();
    const style = menu ? getComputedStyle(menu) : null;
    return {
      exists: Boolean(menu),
      placement: menu?.dataset.placement,
      positioned: menu?.dataset.positioned,
      geometry: box ? { width: box.width, height: box.height } : null,
      borderRadius: style?.borderRadius || null,
      headings: [...menu?.querySelectorAll('.composer-add-menu-heading') || []]
        .map((heading) => heading.textContent?.trim()),
      scrollTop: menu?.querySelector('.composer-add-menu-scroll')?.scrollTop || 0,
      items: [...menu?.querySelectorAll('[role="menuitem"]') || []].map((item) => ({
        id: [...item.classList].find((name) => name.startsWith('composer-add-menu-option-'))
          ?.replace('composer-add-menu-option-', ''),
        label: item.querySelector('.composer-add-menu-label')?.textContent?.trim(),
        disabled: item.disabled,
        tabIndex: item.tabIndex
      })),
      focused: document.activeElement?.querySelector('.composer-add-menu-label')?.textContent?.trim()
    };
  })()`)
  assert(opened.exists && opened.positioned === 'true', 'add menu was not positioned')
  assert(Math.abs(opened.geometry?.width - 736) <= 1, `add menu width: ${opened.geometry?.width}`)
  assert(Math.abs(opened.geometry?.height - 320) <= 1, `add menu height: ${opened.geometry?.height}`)
  assert(opened.borderRadius === '20px', `add menu radius: ${opened.borderRadius}`)
  assert(
    JSON.stringify(opened.headings) === JSON.stringify(['添加', '插件']),
    `add menu groups: ${JSON.stringify(opened.headings)}`
  )
  assert(opened.scrollTop === 0, `add menu did not open at the first row: ${opened.scrollTop}`)
  assert(opened.items.length === 17, `unexpected add menu item count: ${opened.items.length}`)
  assert(opened.focused === '文件和文件夹', `unexpected initial focus: ${opened.focused}`)
  assert(
    JSON.stringify(opened.items.filter((item) => !item.disabled).map((item) => item.id)) ===
      JSON.stringify(['attachments', 'work-project']),
    `unexpected enabled add-menu items: ${JSON.stringify(opened.items)}`
  )
  const menuScreenshot = await screenshot(
    '04-composer-add-menu',
    '[role="menu"][aria-label="添加到聊天"]',
    8
  )

  await pressKey('ArrowDown')
  const secondFocus = await evaluate(`document.activeElement?.querySelector('.composer-add-menu-label')?.textContent?.trim()`)
  assert(secondFocus === '在项目中使用 Work', `ArrowDown focused ${secondFocus}`)
  await pressKey('ArrowDown')
  const wrappedFocus = await evaluate(`document.activeElement?.querySelector('.composer-add-menu-label')?.textContent?.trim()`)
  assert(wrappedFocus === '文件和文件夹', `disabled items were not skipped: ${wrappedFocus}`)
  await pressKey('Escape')
  const closed = await evaluate(`(() => ({
    menuExists: Boolean(document.querySelector('[role="menu"][aria-label="添加到聊天"]')),
    focusedLabel: document.activeElement?.getAttribute('aria-label')
  }))()`)
  assert(!closed.menuExists && closed.focusedLabel === '添加', 'Escape did not close and restore focus')
  return { opened, secondFocus, wrappedFocus, closed, screenshot: menuScreenshot }
})

await check('Composer draft accepts pointer focus and keyboard input without submitting', async () => {
  await startBlankChat()
  await click('.composer textarea')
  const marker = 'UI interaction smoke'
  await command('Input.insertText', { text: marker })
  await pause()
  const typed = await evaluate(`(() => ({
    value: document.querySelector('.composer textarea')?.value,
    focused: document.activeElement?.matches('.composer textarea') || false,
    sendDisabled: document.querySelector('.composer .send-button.send')?.disabled
  }))()`)
  assert(typed.value === marker, `composer value did not match keyboard input: ${typed.value}`)
  assert(typed.focused, 'composer textarea lost focus after typing')
  assert(typed.sendDisabled === false, 'send button did not enable for a non-empty draft')
  const composerScreenshot = await screenshot('05-composer-draft', '.composer-dock', 8)

  await evaluate(`(() => {
    const textarea = document.querySelector('.composer textarea');
    if (!textarea) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, '');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitFor(`document.querySelector('.composer textarea')?.value === ''`)
  const cleared = await evaluate(`(() => ({
    value: document.querySelector('.composer textarea')?.value,
    sendDisabled: document.querySelector('.composer .send-button.send')?.disabled,
    operationMenuPresent: Boolean(document.querySelector('button[aria-label="会话操作"]')),
    workspacePresent: Boolean(document.querySelector('.workspace-pane'))
  }))()`)
  assert(cleared.sendDisabled === true, 'send button did not disable after draft cleanup')
  assert(!cleared.operationMenuPresent, 'typing unexpectedly created conversation controls')
  assert(!cleared.workspacePresent, 'typing unexpectedly created a conversation workspace')
  return { typed, cleared, screenshot: composerScreenshot }
})

await check('Permission and combined model-effort menus match the upstream interaction', async () => {
  await click('button[aria-label="权限"]')
  const permission = await evaluate(`(() => {
    const menu = document.querySelector('[role="listbox"][aria-label="权限"]');
    return {
      options: [...menu?.querySelectorAll('[role="option"]') || []].map((option) => ({
        text: option.querySelector('strong')?.textContent?.trim(),
        selected: option.getAttribute('aria-selected')
      })),
      placement: menu?.dataset.placement,
      focused: document.activeElement?.querySelector('strong')?.textContent?.trim()
    };
  })()`)
  assert(permission.options.length >= 3, 'permission menu options were missing')
  const permissionScreenshot = await screenshot(
    '06-permission-menu',
    '[role="listbox"][aria-label="权限"]',
    8
  )
  await pressKey('Escape')

  const trigger = await evaluate(`(() => {
    const triggers = [...document.querySelectorAll('.model-effort-menus > button.model-effort-menu-trigger')];
    const button = triggers[0];
    return {
      count: triggers.length,
      text: button?.innerText?.replace(/\\n+/g, ' ').trim(),
      chevrons: button?.querySelectorAll(':scope > .composer-menu-chevron').length || 0,
      legacyModelTriggers: document.querySelectorAll('button[aria-label="模型"]').length,
      legacyEffortTriggers: document.querySelectorAll('button[aria-label="推理强度"]').length,
      effort: button?.dataset.selectedReasoningEffort
    };
  })()`)
  assert(trigger.count === 1, `expected one combined trigger, received ${trigger.count}`)
  assert(trigger.chevrons === 1, `combined trigger chevrons: ${trigger.chevrons}`)
  assert(trigger.legacyModelTriggers === 0 && trigger.legacyEffortTriggers === 0, 'legacy split triggers remain')
  assert(trigger.text?.split(' ').length >= 2, `combined trigger did not include model and effort: ${trigger.text}`)

  await evaluate(`document.querySelector('button[aria-label="模型和推理强度"]')?.focus()`)
  await pressKey('ArrowDown')
  await pause(80)
  const effortOpen = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="模型和推理强度"]');
    const box = menu?.getBoundingClientRect();
    const slider = menu?.querySelector('[data-reasoning-slider="true"]');
    return {
      view: menu?.classList.contains('model-effort-view-simple') ? 'simple' : null,
      positioned: menu?.dataset.positioned,
      geometry: box ? { width: box.width, height: box.height } : null,
      focused: document.activeElement?.getAttribute('aria-label'),
      effort: menu?.dataset.effort,
      title: menu?.querySelector('.model-effort-current-title')?.textContent?.trim(),
      model: menu?.querySelector('.model-effort-current-model')?.textContent?.trim(),
      reset: Boolean(menu?.querySelector('[role="menuitem"][aria-label="重置为默认"]')),
      slider: {
        exists: Boolean(slider),
        ticks: [...menu?.querySelectorAll('.reasoning-slider-ticks > i') || []]
          .map((tick) => tick.dataset.effort),
        value: menu?.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'),
        maximum: menu?.querySelector('[role="slider"]')?.getAttribute('aria-valuemax'),
        label: menu?.querySelector('[role="slider"]')?.getAttribute('aria-valuetext')
      }
    };
  })()`)
  assert(effortOpen.positioned === 'true' && effortOpen.view === 'simple', 'combined menu did not open')
  assert(Math.abs(effortOpen.geometry?.width - 254) <= 1, `combined menu width: ${effortOpen.geometry?.width}`)
  assert(Math.abs(effortOpen.geometry?.height - 96) <= 1, `combined menu height: ${effortOpen.geometry?.height}`)
  assert(effortOpen.focused === '选择模型', `combined menu initial focus: ${effortOpen.focused}`)
  assert(effortOpen.title && effortOpen.model && effortOpen.reset, 'combined menu top row is incomplete')
  assert(effortOpen.slider.exists && effortOpen.slider.ticks.length > 0, 'reasoning slider is missing')
  assert(
    Number(effortOpen.slider.maximum) === effortOpen.slider.ticks.length - 1,
    `slider maximum did not match supported effort count: ${JSON.stringify(effortOpen.slider)}`
  )
  assert(effortOpen.slider.ticks.includes(effortOpen.effort), `selected effort was not a supported tick: ${effortOpen.effort}`)
  const effortScreenshot = await screenshot(
    '07-model-effort-menu',
    '[role="menu"][aria-label="模型和推理强度"]',
    8
  )

  await pressKey('ArrowDown')
  await pressKey('ArrowDown')
  const sliderFocus = await evaluate(`document.activeElement?.getAttribute('aria-label')`)
  assert(sliderFocus === '强度', `ArrowDown did not reach slider: ${sliderFocus}`)
  const moveKey = Number(effortOpen.slider.value) < Number(effortOpen.slider.maximum)
    ? 'ArrowRight'
    : 'ArrowLeft'
  await pressKey(moveKey)
  const movedEffort = await evaluate(`document.querySelector('.model-effort-menu-trigger')?.dataset.selectedReasoningEffort`)
  assert(movedEffort && movedEffort !== trigger.effort, `slider did not change effort with ${moveKey}`)
  await pressKey(moveKey === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight')
  await waitFor(`document.querySelector('.model-effort-menu-trigger')?.dataset.selectedReasoningEffort === ${JSON.stringify(trigger.effort)}`)

  await click('[role="menuitem"][aria-label="选择模型"]')
  const modelOpen = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="模型和推理强度"]');
    return {
      view: menu?.classList.contains('model-effort-view-models') ? 'models' : null,
      count: menu?.querySelectorAll('[role="menuitemradio"]').length || 0,
      selected: menu?.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent?.trim(),
      focused: document.activeElement?.textContent?.trim()
    };
  })()`)
  assert(modelOpen.view === 'models' && modelOpen.count > 0, 'model list did not open from the model row')
  assert(modelOpen.selected && modelOpen.focused === modelOpen.selected, 'selected model was not focused')
  const modelScreenshot = await screenshot(
    '08-model-list',
    '[role="menu"][aria-label="模型和推理强度"]',
    8
  )
  await pressKey('Escape')
  return {
    permission,
    trigger,
    effortOpen,
    sliderFocus,
    movedEffort,
    modelOpen,
    screenshots: [permissionScreenshot, effortScreenshot, modelScreenshot]
  }
})

await check('Composer sends from an explicit new-chat context and streams the reply', async () => {
  await startBlankChat()
  const blankContext = await evaluate(`(() => ({
    emptyComposer: Boolean(document.querySelector('.composer-dock.empty')),
    noWorkspace: !document.querySelector('.workspace-pane'),
    noThreadControls: !document.querySelector('button[aria-label="会话操作"]'),
    sendDisabled: document.querySelector('.composer .send-button.send')?.disabled
  }))()`)
  assert(blankContext.emptyComposer && blankContext.noWorkspace, 'send smoke did not start on a new chat')
  assert(blankContext.noThreadControls, 'send smoke unexpectedly started with a selected thread')
  assert(blankContext.sendDisabled === true, 'empty new-chat composer should not be sendable')

  smokeMarker = `CODEX_UI_SMOKE_OK_${Date.now()}`
  const wrapMarker = `CODEX_WRAP_PROBE_${Date.now()}`
  const prompt = [
    `Use one read-only shell command that waits 2 seconds and then prints ${smokeMarker}. Do not modify files.`,
    'Then reply in Markdown with exactly these three blocks and no additional text:',
    smokeMarker,
    '```text',
    `${wrapMarker} 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789`,
    '```',
    '【src/renderer/src/App.tsx†L1-L3】'
  ].join('\n')
  await click('.composer textarea')
  await command('Input.insertText', { text: prompt })
  await waitFor(`document.querySelector('.composer .send-button.send')?.disabled === false`)
  await evaluate(`(() => {
    window.__codexRunningTurnUiTraceObserver?.disconnect?.();
    const trace = {
      startup: false,
      thinking: false,
      stop: false,
      processed: false,
      finalWhileRunningCollapsed: false,
      liveActivityAlongsideFinal: false,
      legacyActivityHeading: false,
      startingIconSizes: [],
      commandRows: []
    };
    const visibleText = (element) => {
      if (!(element instanceof HTMLElement)) return '';
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return '';
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 ? element.textContent?.trim() || '' : '';
    };
    const record = () => {
      const statusTexts = [...document.querySelectorAll(
        '.conversation-content span, .conversation-content div, .composer textarea'
      )].map((element) => element instanceof HTMLTextAreaElement
        ? element.placeholder.trim()
        : visibleText(element));
      trace.startup ||= statusTexts.some((text) => text === '正在开启聊天' || text === '正在开启聊天…');
      const startingIcon = document.querySelector('.composer .send-button.starting svg');
      if (startingIcon) {
        const box = startingIcon.getBoundingClientRect();
        const signature = String(box.width) + ':' + String(box.height);
        if (!trace.startingIconSizes.some((entry) => entry.signature === signature)) {
          trace.startingIconSizes.push({ signature, width: box.width, height: box.height });
        }
      }
      trace.thinking ||= statusTexts.some((text) => text === '正在思考' || text === '正在思考…');
      trace.stop ||= Boolean(document.querySelector('.composer .send-button.stop'));
      const turnStillRunning = Boolean(document.querySelector('.composer .send-button.stop'));
      const streamingFinal = Boolean(document.querySelector('.conversation-content .agent-message-group'));
      trace.finalWhileRunningCollapsed ||= Boolean(
        turnStillRunning && streamingFinal &&
        document.querySelector('.conversation-content .turn-activity.is-complete')
      );
      trace.liveActivityAlongsideFinal ||= Boolean(
        turnStillRunning && streamingFinal &&
        document.querySelector('.conversation-content .turn-activity.is-live')
      );
      const headings = [...document.querySelectorAll('.conversation-content .activity-section-heading')]
        .map(visibleText)
        .filter(Boolean);
      trace.processed ||= headings.some((text) => /^已处理\\s+(?:少于\\s*1\\s*秒|\\d+\\s*(?:小时(?:\\s*\\d+\\s*分钟)?(?:\\s*\\d+\\s*秒)?|分钟(?:\\s*\\d+\\s*秒)?|秒|s))$/.test(text));
      trace.legacyActivityHeading ||= headings.some((text) => text === '活动');
      for (const summary of document.querySelectorAll(
        '.conversation-content .turn-activity.is-live .activity-item > summary'
      )) {
        const row = summary.closest('.activity-item');
        if (!(summary instanceof HTMLElement) || !(row instanceof HTMLElement)) continue;
        const box = summary.getBoundingClientRect();
        const style = getComputedStyle(summary);
        const rowStyle = getComputedStyle(row);
        const signature = [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)].join(':');
        if (trace.commandRows.some((candidate) => candidate.signature === signature)) continue;
        trace.commandRows.push({
          signature,
          height: box.height,
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          marginBottom: rowStyle.marginBottom
        });
      }
    };
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        record();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'placeholder'],
      characterData: true,
      childList: true,
      subtree: true
    });
    window.__codexRunningTurnUiTrace = trace;
    window.__codexRunningTurnUiTraceObserver = observer;
    record();
  })()`)
  await click('.composer .send-button.send')

  const optimisticMessage = await waitFor(`(() => {
    const marker = ${JSON.stringify(smokeMarker)};
    return [...document.querySelectorAll('.user-message')]
      .some((message) => message.textContent?.includes(marker));
  })()`)
  assert(optimisticMessage === true, 'submitted text did not render as a user message')
  await waitFor(`Boolean(document.querySelector('.workspace-pane')) &&
    Boolean(document.querySelector('button[aria-label="会话操作"]')) &&
    Boolean(document.querySelector('button[aria-label="会话控制"]'))`)

  const completion = await waitFor(`(() => {
    const marker = ${JSON.stringify(smokeMarker)};
    const error = document.querySelector('.turn-error')?.textContent?.trim() || null;
    const matchingReply = [...document.querySelectorAll('.agent-message')]
      .map((message) => message.textContent?.trim() || '')
      .find((reply) => reply.includes(marker)) || null;
    const running = Boolean(document.querySelector('.composer .send-button.stop'));
    return error || (matchingReply && !running) ? { error, matchingReply, running } : null;
  })()`, 120_000)
  assert(!completion.error, `app-server turn failed: ${completion.error}`)
  assert(completion.matchingReply?.includes(smokeMarker), `agent reply did not contain ${smokeMarker}`)

  const runningTurnUi = await evaluate(`(() => {
    window.__codexRunningTurnUiTraceObserver?.disconnect?.();
    const trace = window.__codexRunningTurnUiTrace || null;
    delete window.__codexRunningTurnUiTraceObserver;
    delete window.__codexRunningTurnUiTrace;
    return trace;
  })()`)
  assert(runningTurnUi?.startup, 'running turn never rendered the observed 正在开启聊天 startup state')
  assert(
    runningTurnUi?.startingIconSizes?.some((entry) => entry.width === 16 && entry.height === 16),
    `startup spinner size: ${JSON.stringify(runningTurnUi?.startingIconSizes)}`
  )
  assert(runningTurnUi?.thinking, 'running turn never rendered the observed 正在思考 state')
  assert(runningTurnUi?.stop, 'running turn never exposed the observed stop control')
  assert(runningTurnUi?.processed, 'running turn never rendered an 已处理 Ns heading')
  assert(
    runningTurnUi?.finalWhileRunningCollapsed,
    'activity did not collapse to 用时 while the final answer was still streaming'
  )
  assert(
    !runningTurnUi?.liveActivityAlongsideFinal,
    '已处理 remained expanded after the final answer started streaming'
  )
  assert(
    !runningTurnUi?.legacyActivityHeading,
    'running turn rendered the unobserved 活动 section heading'
  )
  assert(
    runningTurnUi?.commandRows?.length > 0,
    'read-only command did not render a command activity row'
  )
  const nonCompactCommandRows = runningTurnUi.commandRows.filter((row) =>
    row.height > 30 ||
    row.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
    Number.parseFloat(row.borderTopWidth) > 0 ||
    Number.parseFloat(row.paddingTop) > 2 ||
    Number.parseFloat(row.paddingBottom) > 2 ||
    Number.parseFloat(row.marginBottom) > 10
  )
  assert(
    nonCompactCommandRows.length === 0,
    `command activity row was not compact: ${JSON.stringify(nonCompactCommandRows)}`
  )

  const transcript = await evaluate(`(() => {
    const marker = ${JSON.stringify(smokeMarker)};
    const userMessage = [...document.querySelectorAll('.user-message')]
      .find((message) => message.textContent?.includes(marker)) || null;
    const agentMessage = [...document.querySelectorAll('.agent-message')]
      .find((message) => message.textContent?.includes(marker)) || null;
    return {
      selectedConversation: Boolean(document.querySelector('button[aria-label="会话操作"]')),
      workspace: Boolean(document.querySelector('.workspace-pane')),
      userMessageCount: document.querySelectorAll('.user-message').length,
      agentMessageCount: document.querySelectorAll('.agent-message').length,
      running: Boolean(document.querySelector('.composer .send-button.stop')),
      markerMessagesShareTurn: Boolean(
        userMessage && agentMessage &&
        userMessage.closest('.turn-block') === agentMessage.closest('.turn-block')
      ),
      userPrecedesReply: Boolean(
        userMessage && agentMessage &&
        (userMessage.compareDocumentPosition(agentMessage) & Node.DOCUMENT_POSITION_FOLLOWING)
      )
    };
  })()`)
  assert(transcript.selectedConversation && transcript.workspace, 'successful send did not select a real conversation')
  assert(transcript.userMessageCount > 0 && transcript.agentMessageCount > 0, 'transcript DOM is incomplete')
  assert(!transcript.running, 'turn still appeared to be running after the final reply')
  assert(transcript.markerMessagesShareTurn, 'submitted message and final reply were split across turns')
  assert(transcript.userPrecedesReply, 'final reply rendered before the submitted user message')

  const completedActivity = await evaluate(`(() => {
    const disclosure = document.querySelector('.turn-activity.is-complete .activity-disclosure button[aria-expanded]');
    const divider = document.querySelector('.turn-activity.is-complete .activity-disclosure-divider .activity-heading-divider');
    const dividerWrapper = divider?.parentElement || null;
    const chevron = disclosure?.querySelector('svg') || null;
    const items = document.querySelector('.turn-activity.is-complete .turn-activity-items');
    const dividerStyle = divider ? getComputedStyle(divider) : null;
    const dividerWrapperStyle = dividerWrapper ? getComputedStyle(dividerWrapper) : null;
    const disclosureStyle = disclosure ? getComputedStyle(disclosure) : null;
    const disclosureBox = disclosure?.getBoundingClientRect() || null;
    const chevronBox = chevron?.getBoundingClientRect() || null;
    return {
      exists: Boolean(disclosure),
      text: disclosure?.textContent?.trim() || null,
      expanded: disclosure?.getAttribute('aria-expanded') || null,
      legacyDetails: Boolean(document.querySelector('details.turn-activity.is-complete')),
      button: disclosureBox ? {
        height: disclosureBox.height,
        gap: disclosureStyle?.gap || null,
        padding: disclosureStyle?.padding || null,
        margin: disclosureStyle?.margin || null,
        radius: disclosureStyle?.borderRadius || null,
        color: disclosureStyle?.color || null,
        backgroundColor: disclosureStyle?.backgroundColor || null,
        fontSize: disclosureStyle?.fontSize || null,
        fontWeight: disclosureStyle?.fontWeight || null,
        lineHeight: disclosureStyle?.lineHeight || null
      } : null,
      chevron: chevronBox ? { width: chevronBox.width, height: chevronBox.height } : null,
      divider: divider ? {
        width: divider.getBoundingClientRect().width,
        borderTopWidth: dividerStyle?.borderTopWidth || null,
        borderTopColor: dividerStyle?.borderTopColor || null,
        wrapperPaddingTop: dividerWrapperStyle?.paddingTop || null
      } : null,
      itemsMounted: Boolean(items)
    };
  })()`)
  assert(completedActivity.exists, 'completed activity disclosure button is missing')
  assert(/^用时\s+/.test(completedActivity.text || ''), `completed activity label: ${completedActivity.text}`)
  assert(completedActivity.expanded === 'false', 'completed activity was not collapsed by default')
  assert(!completedActivity.legacyDetails, 'completed activity still uses the legacy details element')
  assert(Math.abs(completedActivity.button?.height - 21) <= 0.5, `activity button height: ${completedActivity.button?.height}`)
  assert(completedActivity.button?.gap === '4px', `activity button gap: ${completedActivity.button?.gap}`)
  assert(completedActivity.button?.padding === '0px', `activity button padding: ${completedActivity.button?.padding}`)
  assert(completedActivity.button?.margin === '0px', `activity button margin: ${completedActivity.button?.margin}`)
  assert(completedActivity.button?.radius === '10px', `activity button radius: ${completedActivity.button?.radius}`)
  assert(completedActivity.button?.color === 'rgba(252, 252, 252, 0.498)', `activity button color: ${completedActivity.button?.color}`)
  assert(completedActivity.button?.backgroundColor === 'rgba(0, 0, 0, 0)', `activity button background: ${completedActivity.button?.backgroundColor}`)
  assert(completedActivity.button?.fontSize === '14px' && completedActivity.button?.fontWeight === '430', `activity button font: ${JSON.stringify(completedActivity.button)}`)
  assert(completedActivity.button?.lineHeight === '21px', `activity button line-height: ${completedActivity.button?.lineHeight}`)
  assert(Math.abs(completedActivity.chevron?.width - 14) <= 0.5 && Math.abs(completedActivity.chevron?.height - 14) <= 0.5, `activity chevron: ${JSON.stringify(completedActivity.chevron)}`)
  assert(completedActivity.divider?.width > 0, 'completed activity divider is missing')
  assert(completedActivity.divider?.borderTopWidth === '1px', `activity divider width: ${completedActivity.divider?.borderTopWidth}`)
  assert(completedActivity.divider?.wrapperPaddingTop === '4px', `activity divider inset: ${completedActivity.divider?.wrapperPaddingTop}`)
  assert(completedActivity.itemsMounted === false, 'collapsed activity content was mounted eagerly')
  await click('.turn-activity.is-complete .activity-disclosure button[aria-expanded]')
  const expandedActivity = await evaluate(`(() => {
    const disclosure = document.querySelector('.turn-activity.is-complete .activity-disclosure button[aria-expanded]');
    const items = document.querySelector('.turn-activity.is-complete .turn-activity-items');
    const collapse = document.querySelector('.turn-activity.is-complete .activity-collapse');
    return {
      expanded: disclosure?.getAttribute('aria-expanded') || null,
      color: disclosure ? getComputedStyle(disclosure).color : null,
      itemsMounted: Boolean(items),
      collapseExpanded: collapse?.classList.contains('is-expanded') || false,
      ariaHidden: collapse?.getAttribute('aria-hidden') || null
    };
  })()`)
  assert(
    expandedActivity.expanded === 'true' &&
      expandedActivity.itemsMounted &&
      expandedActivity.collapseExpanded &&
      expandedActivity.ariaHidden === 'false',
    'activity disclosure did not expand'
  )
  assert(expandedActivity.color === 'rgb(252, 252, 252)', `activity hover color: ${expandedActivity.color}`)
  await click('.turn-activity.is-complete .activity-disclosure button[aria-expanded]')
  await waitFor(`!document.querySelector('.turn-activity.is-complete .turn-activity-items')`)
  const collapsedActivity = await evaluate(`(() => ({
    expanded: document.querySelector('.turn-activity.is-complete .activity-disclosure button')?.getAttribute('aria-expanded') || null,
    itemsMounted: Boolean(document.querySelector('.turn-activity.is-complete .turn-activity-items'))
  }))()`)
  assert(collapsedActivity.expanded === 'false' && !collapsedActivity.itemsMounted, 'activity content did not unmount after its 150ms collapse')

  const userActionsIdle = await evaluate(`(() => {
    const marker = ${JSON.stringify(smokeMarker)};
    const message = [...document.querySelectorAll('.user-message')]
      .find((candidate) => candidate.textContent?.includes(marker));
    const group = message?.closest('.user-message-group');
    const button = group?.querySelector('.message-actions button[aria-label="Copy message"]');
    const groupStyle = group ? getComputedStyle(group) : null;
    const buttonBox = button?.getBoundingClientRect() || null;
    return button ? {
      opacity: getComputedStyle(button).opacity,
      gap: groupStyle?.gap || null,
      marginBottom: groupStyle?.marginBottom || null,
      buttonWidth: buttonBox?.width || null,
      buttonHeight: buttonBox?.height || null
    } : null;
  })()`)
  assert(userActionsIdle?.opacity === '0', `user copy action idle opacity: ${userActionsIdle?.opacity}`)
  assert(userActionsIdle?.gap === '4px', `user message action gap: ${userActionsIdle?.gap}`)
  assert(userActionsIdle?.marginBottom === '16px', `user message bottom spacer: ${userActionsIdle?.marginBottom}`)
  assert(userActionsIdle?.buttonWidth === 26 && userActionsIdle?.buttonHeight === 26, `user message action size: ${JSON.stringify(userActionsIdle)}`)
  await hover('.user-message-group')
  const userActionsHover = await evaluate(`(() => {
    const marker = ${JSON.stringify(smokeMarker)};
    const message = [...document.querySelectorAll('.user-message')]
      .find((candidate) => candidate.textContent?.includes(marker));
    const button = message?.closest('.user-message-group')?.querySelector('.message-actions button[aria-label="Copy message"]');
    return button ? { opacity: getComputedStyle(button).opacity } : null;
  })()`)
  assert(userActionsHover?.opacity === '1', `user copy action hover opacity: ${userActionsHover?.opacity}`)

  const richContent = await evaluate(`(() => {
    const marker = ${JSON.stringify(wrapMarker)};
    const block = [...document.querySelectorAll('.markdown-code-block')]
      .find((candidate) => candidate.textContent?.includes(marker));
    const wrap = block?.querySelector('button[aria-label="开启代码自动换行"]');
    const copy = block?.querySelector('button[aria-label="复制代码"]');
    const caption = block?.querySelector('figcaption');
    const pre = block?.querySelector(':scope > pre');
    const code = block?.querySelector('code.hljs');
    const link = document.querySelector('.markdown-workspace-file-link[data-workspace-path="src/renderer/src/App.tsx"][data-workspace-line="1"][data-workspace-end-line="3"]');
    const blockStyle = block ? getComputedStyle(block) : null;
    const captionStyle = caption ? getComputedStyle(caption) : null;
    const preStyle = pre ? getComputedStyle(pre) : null;
    return {
      block: Boolean(block),
      language: block?.querySelector('.markdown-code-language')?.textContent?.trim() || null,
      surface: {
        blockBackground: blockStyle?.backgroundColor || null,
        captionMinHeight: captionStyle?.minHeight || null,
        captionPadding: captionStyle?.padding || null,
        preBackground: preStyle?.backgroundColor || null,
        preBorderTopWidth: preStyle?.borderTopWidth || null,
        preBorderRadius: preStyle?.borderRadius || null,
        preMargin: preStyle?.margin || null,
        prePadding: preStyle?.padding || null
      },
      wrap: wrap ? {
        pressed: wrap.getAttribute('aria-pressed'),
        text: wrap.textContent?.trim() || '',
        icons: wrap.querySelectorAll('svg').length
      } : null,
      copy: copy ? {
        text: copy.textContent?.trim() || '',
        icons: copy.querySelectorAll('svg').length
      } : null,
      whiteSpace: code ? getComputedStyle(code).whiteSpace : null,
      fileLink: link ? {
        endLine: link.getAttribute('data-workspace-end-line'),
        reactIcon: Boolean(link.querySelector('.markdown-workspace-file-icon.is-react svg'))
      } : null
    };
  })()`)
  assert(richContent.block, 'assistant reply did not render the requested code block')
  assert(richContent.language === '纯文本', `code block language: ${richContent.language}`)
  assert(richContent.surface.blockBackground === 'rgb(34, 34, 34)', `code block surface: ${richContent.surface.blockBackground}`)
  assert(richContent.surface.captionMinHeight === '48px', `code header height: ${richContent.surface.captionMinHeight}`)
  assert(richContent.surface.captionPadding === '0px 6px 0px 20px', `code header padding: ${richContent.surface.captionPadding}`)
  assert(richContent.surface.preBackground === 'rgba(0, 0, 0, 0)', `code body background: ${richContent.surface.preBackground}`)
  assert(richContent.surface.preBorderTopWidth === '0px', `code body border: ${richContent.surface.preBorderTopWidth}`)
  assert(richContent.surface.preBorderRadius === '0px', `code body radius: ${richContent.surface.preBorderRadius}`)
  assert(richContent.surface.preMargin === '0px', `code body margin: ${richContent.surface.preMargin}`)
  assert(richContent.surface.prePadding === '0px 20px 12px', `code body padding: ${richContent.surface.prePadding}`)
  assert(richContent.wrap?.pressed === 'false' && richContent.wrap.icons === 1 && !richContent.wrap.text, 'wrap control is not icon-only')
  assert(richContent.copy?.icons === 1 && !richContent.copy.text, 'copy control is not icon-only')
  assert(richContent.whiteSpace === 'pre', `code block default white-space: ${richContent.whiteSpace}`)
  assert(richContent.fileLink?.endLine === '3', 'assistant reply did not render the requested workspace citation range')
  assert(richContent.fileLink?.reactIcon, 'TSX workspace citation did not use the recorded React icon')
  await click('.markdown-code-block button[aria-label="开启代码自动换行"]')
  const wrappedCode = await evaluate(`(() => {
    const marker = ${JSON.stringify(wrapMarker)};
    const block = [...document.querySelectorAll('.markdown-code-block')]
      .find((candidate) => candidate.textContent?.includes(marker));
    const button = block?.querySelector('button[aria-pressed]');
    const code = block?.querySelector('code.hljs');
    return {
      pressed: button?.getAttribute('aria-pressed') || null,
      label: button?.getAttribute('aria-label') || null,
      whiteSpace: code ? getComputedStyle(code).whiteSpace : null
    };
  })()`)
  assert(wrappedCode.pressed === 'true', 'code wrap toggle did not become pressed')
  assert(wrappedCode.label === '关闭代码自动换行', `wrapped control label: ${wrappedCode.label}`)
  assert(wrappedCode.whiteSpace === 'pre-wrap', `wrapped code white-space: ${wrappedCode.whiteSpace}`)
  const richContentScreenshot = await screenshot('09-rich-message-content', '.conversation-scroll', 4)

  await click('.markdown-workspace-file-link[data-workspace-path="src/renderer/src/App.tsx"][data-workspace-line="1"][data-workspace-end-line="3"]')
  const openedWorkspaceFile = await waitFor(`(() => {
    const pane = document.querySelector('.workspace-pane-expanded');
    const target = pane?.querySelector('.workspace-source-line[data-target-line="true"][data-line="1"]');
    const selectedTab = pane?.querySelector('[role="tab"][aria-selected="true"]');
    return pane && target ? {
      selectedTab: selectedTab?.textContent?.trim() || null,
      selectedPath: pane.querySelector('.workspace-pane-file-tab')?.getAttribute('title') || null,
      targetLine: target.getAttribute('data-line')
    } : null;
  })()`, 15_000)
  assert(openedWorkspaceFile.selectedTab?.startsWith('Files'), `file link selected tab: ${openedWorkspaceFile.selectedTab}`)
  assert(openedWorkspaceFile.selectedPath?.endsWith('/src/renderer/src/App.tsx'), `opened path: ${openedWorkspaceFile.selectedPath}`)
  assert(openedWorkspaceFile.targetLine === '1', `opened target line: ${openedWorkspaceFile.targetLine}`)
  const workspaceFileScreenshot = await screenshot('10-workspace-file-link', '.main-panel')
  await click('button[aria-label="Close workspace"]')

  const ids = await evaluate(`(async () => {
    const marker = ${JSON.stringify(smokeMarker)};
    const search = await window.codex.invoke('thread/search', {
      searchTerm: marker,
      limit: 20,
      sortKey: 'recency_at',
      sortDirection: 'desc',
      archived: false
    });
    return [...new Set((search.data || [])
      .filter((entry) => entry?.thread?.id && (
        String(entry.thread.preview || '').includes(marker) ||
        String(entry.snippet || '').includes(marker)
      ))
      .map((entry) => entry.thread.id))];
  })()`)
  assert(ids.length === 1, `could not resolve the smoke thread uniquely: ${JSON.stringify(ids)}`)
  smokeThreadId = ids[0]
  const selected = await requireSelectedThread()
  const sendScreenshot = await screenshot('08-composer-send', '.main-panel', 8)
  return {
    marker: smokeMarker,
    threadResolved: true,
    blankContext,
    completion,
    runningTurnUi,
    transcript,
    completedActivity,
    expandedActivity,
    collapsedActivity,
    userActionsIdle,
    userActionsHover,
    richContent,
    wrappedCode,
    openedWorkspaceFile,
    selected,
    screenshots: [sendScreenshot, richContentScreenshot, workspaceFileScreenshot]
  }
})

await check('WorkspacePane appears only for the selected thread, switches tabs, and closes', async () => {
  const selected = await requireSelectedThread()
  await click('.workspace-pane-summary-row')
  await click('#workspace-pane-tab-changes')
  const expanded = await evaluate(`(() => {
    const pane = document.querySelector('.workspace-pane-expanded');
    return {
      exists: Boolean(pane),
      selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
      panelLabel: document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')
    };
  })()`)
  assert(expanded.exists, 'expanded workspace pane was not rendered')
  assert(expanded.selected?.startsWith('Changes'), `expected Changes tab, received ${expanded.selected}`)
  const expandedScreenshot = await screenshot('09-workspace-expanded', '.main-panel')

  await click('#workspace-pane-tab-output')
  const output = await evaluate(`(() => ({
    selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
    panelLabel: document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby'),
    emptyTitle: document.querySelector('.workspace-pane-empty strong')?.textContent?.trim()
  }))()`)
  assert(output.selected?.startsWith('Output'), `expected Output tab, received ${output.selected}`)
  assert(output.panelLabel === 'workspace-pane-tab-output', 'tabpanel label did not follow Output tab')
  const outputScreenshot = await screenshot('10-workspace-output', '.workspace-pane-expanded')

  await click('button[aria-label="Close workspace"]')
  const closed = await evaluate(`(() => ({
    collapsed: Boolean(document.querySelector('.workspace-pane-collapsed')),
    expanded: Boolean(document.querySelector('.workspace-pane-expanded'))
  }))()`)
  assert(closed.collapsed && !closed.expanded, 'workspace pane did not return to collapsed state')
  return { selected, expanded, output, closed, screenshots: [expandedScreenshot, outputScreenshot] }
})

await check('Selected-thread titlebar menus and Side Chat send/stop match the observed interaction', async () => {
  await requireSelectedThread()
  await click('button[aria-label="会话控制"]')
  const controls = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="会话控制"]');
    return {
      positioned: menu?.dataset.positioned,
      items: [...menu?.querySelectorAll('[role="menuitem"]') || []].map((item) => ({
        text: item.textContent?.trim(),
        disabled: item.disabled,
        tabIndex: item.tabIndex
      })),
      focused: document.activeElement?.textContent?.trim()
    };
  })()`)
  assert(controls.positioned === 'true' && controls.items.length === 2, 'conversation controls menu invalid')
  const controlsScreenshot = await screenshot(
    '09-titlebar-controls-menu',
    '[role="menu"][aria-label="会话控制"]',
    8
  )
  await pressKey('Escape')

  await click('button[aria-label="会话操作"]')
  const operations = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="会话操作"]');
    return {
      positioned: menu?.dataset.positioned,
      items: [...menu?.querySelectorAll(':scope > .titlebar-menu-entry > [role="menuitem"]') || []].map((item) => ({
        id: item.dataset.menuItemId,
        label: item.querySelector('.titlebar-menu-label')?.textContent?.trim(),
        shortcut: item.querySelector('.titlebar-menu-shortcut')?.textContent?.trim() || null,
        disabled: item.disabled
      })),
      selectedThreadPresent: Boolean(document.querySelector('.thread-row.selected, .thread-row.active'))
    };
  })()`)
  assert(operations.positioned === 'true' && operations.items.length === 9, 'conversation operations menu invalid')
  assert(
    JSON.stringify(operations.items.map((item) => item.id)) === JSON.stringify([
      'rename',
      'toggle-pin',
      'open-side-chat',
      'fork',
      'schedule',
      'copy',
      'open-new-window',
      'open-with',
      'archive'
    ]),
    `unexpected conversation menu order: ${JSON.stringify(operations.items)}`
  )
  assert(operations.items[4]?.disabled, 'scheduled-task item should be disabled')
  assert(operations.items[0]?.shortcut === '⌥⌘R', 'rename shortcut is missing')
  assert(operations.items[2]?.shortcut === '⌥⌘S', 'Side Chat shortcut is missing')
  assert(operations.items[8]?.shortcut === '⇧⌘A', 'archive shortcut is missing')
  const operationsScreenshot = await screenshot(
    '10-titlebar-conversation-menu',
    '[role="menu"][aria-label="会话操作"]',
    8
  )

  await pressKey('ArrowDown')
  await pressKey('ArrowDown')
  await pressKey('ArrowDown')
  await pressKey('ArrowRight')
  await waitFor(`document.activeElement?.dataset.menuItemId === 'fork-same-worktree'`)
  const forkSubmenu = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="分叉"]');
    return {
      exists: Boolean(menu),
      ids: [...menu?.querySelectorAll('[role="menuitem"]') || []].map((item) => item.dataset.menuItemId),
      focused: document.activeElement?.dataset.menuItemId
    };
  })()`)
  assert(forkSubmenu.exists, 'fork submenu did not open from ArrowRight')
  assert(
    JSON.stringify(forkSubmenu.ids) === JSON.stringify(['fork-same-worktree', 'fork-new-worktree']),
    `unexpected fork submenu: ${JSON.stringify(forkSubmenu)}`
  )
  assert(forkSubmenu.focused === 'fork-same-worktree', 'fork submenu did not focus its first item')
  await pressKey('ArrowLeft')
  const forkClosed = await evaluate(`(() => ({
    submenu: Boolean(document.querySelector('[role="menu"][aria-label="分叉"]')),
    focused: document.activeElement?.dataset.menuItemId
  }))()`)
  assert(!forkClosed.submenu && forkClosed.focused === 'fork', 'ArrowLeft did not close the submenu')

  await click('[data-menu-item-id="open-side-chat"]')
  const sideChat = await evaluate(`(() => ({
    exists: Boolean(document.querySelector('.side-chat-pane')),
    title: document.querySelector('.side-chat-empty strong')?.textContent?.trim(),
    closeLabel: document.querySelector('.titlebar-side-chat-tab button')?.getAttribute('aria-label'),
    menuClosed: !document.querySelector('[role="menu"][aria-label="会话操作"]')
  }))()`)
  assert(sideChat.exists && sideChat.title === '侧边聊天', 'Side Chat pane did not open')
  assert(sideChat.menuClosed, 'conversation menu stayed open after opening Side Chat')
  const sideChatScreenshot = await screenshot('11-side-chat', '.chat-workspace')

  const sideMarker = `CODEX_SIDE_CHAT_STOP_${Date.now()}`
  const sidePrompt = `Begin a long response containing ${sideMarker} and continue until stopped.`
  await click('.side-chat-pane .composer textarea')
  await command('Input.insertText', { text: sidePrompt })
  await waitFor(`document.querySelector('.side-chat-pane .send-button.send')?.disabled === false`)
  await click('.side-chat-pane .send-button.send')
  await waitFor(`Boolean(document.querySelector('.side-chat-pane .send-button.stop'))`, 30_000)
  const sideOptimistic = await waitFor(`(() => {
    const marker = ${JSON.stringify(sideMarker)};
    return [...document.querySelectorAll('.side-chat-pane .user-message')]
      .some((message) => message.textContent?.includes(marker));
  })()`, 30_000)
  assert(sideOptimistic, 'Side Chat did not render the submitted user message')
  await click('.side-chat-pane .send-button.stop')
  const sideStopped = await waitFor(`(() => {
    const pane = document.querySelector('.side-chat-pane');
    return pane && !pane.querySelector('.send-button.stop') && pane.querySelector('.send-button.send')
      ? { stopped: true, error: pane.querySelector('.turn-error')?.textContent?.trim() || null }
      : null;
  })()`, 30_000)
  assert(sideStopped.stopped, 'Side Chat did not return to the stopped state')
  const sideStoppedScreenshot = await screenshot('12-side-chat-stopped', '.side-chat-pane')
  await click('button[aria-label="关闭侧边聊天"]')
  assert(!(await evaluate(`Boolean(document.querySelector('.side-chat-pane'))`)), 'Side Chat pane did not close')
  return {
    controls,
    operations,
    forkSubmenu,
    forkClosed,
    sideChat,
    sideMarker,
    sideOptimistic,
    sideStopped,
    screenshots: [controlsScreenshot, operationsScreenshot, sideChatScreenshot, sideStoppedScreenshot]
  }
})

await check('Sidebar drag persists across reload and restores original state', async () => {
  const handle = await rect('.sidebar-resize-handle')
  assert(handle, 'sidebar resize handle missing')
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const targetWidth = Math.min(initialSidebar.width + 72, 620)
  const delta = targetWidth - initialSidebar.width
  await drag(from, { x: from.x + delta, y: from.y })
  const afterDrag = await evaluate(`(() => ({
    width: document.querySelector('.sidebar')?.getBoundingClientRect().width || null,
    stored: localStorage.getItem('codex-sidebar-preferred-width-v1'),
    resizing: document.body.dataset.sidebarResizing || null
  }))()`)
  assert(Math.abs(afterDrag.width - targetWidth) <= 1, `sidebar width after drag: ${afterDrag.width}`)
  assert(Math.abs(Number(afterDrag.stored) - targetWidth) <= 1, `stored width after drag: ${afterDrag.stored}`)
  assert(afterDrag.resizing === null, 'sidebar resizing marker was not cleared')
  const draggedScreenshot = await screenshot('13-sidebar-dragged', '.sidebar-resize-handle', 10)

  await command('Page.reload', { ignoreCache: true })
  await waitFor(`document.querySelector('.app-shell')?.dataset.backendState === 'ready'`)
  const afterReload = await evaluate(`(() => ({
    width: document.querySelector('.sidebar')?.getBoundingClientRect().width || null,
    stored: localStorage.getItem('codex-sidebar-preferred-width-v1')
  }))()`)
  assert(Math.abs(afterReload.width - targetWidth) <= 1, `persisted width after reload: ${afterReload.width}`)
  const persistedScreenshot = await screenshot(
    '14-sidebar-persisted',
    '.sidebar-resize-handle',
    10
  )

  await evaluate(`(() => {
    const key = 'codex-sidebar-preferred-width-v1';
    const original = ${JSON.stringify(initialSidebar.stored)};
    if (original === null) localStorage.removeItem(key);
    else localStorage.setItem(key, original);
  })()`)
  await command('Page.reload', { ignoreCache: true })
  await waitFor(`document.querySelector('.app-shell')?.dataset.backendState === 'ready'`)
  const restored = await evaluate(`(() => ({
    width: document.querySelector('.sidebar')?.getBoundingClientRect().width || null,
    stored: localStorage.getItem('codex-sidebar-preferred-width-v1'),
    newChat: !document.querySelector('button[aria-label="会话操作"]') &&
      !document.querySelector('.workspace-pane')
  }))()`)
  assert(Math.abs(restored.width - initialSidebar.width) <= 1, `restored width: ${restored.width}`)
  assert(restored.stored === initialSidebar.stored, 'original localStorage value was not restored')
  return {
    initial: initialSidebar,
    targetWidth,
    afterDrag,
    afterReload,
    restored,
    screenshots: [draggedScreenshot, persistedScreenshot]
  }
})

if (smokeThreadId) {
  try {
    await startBlankChat()
    await evaluate(`window.codex.invoke('thread/delete', { threadId: ${JSON.stringify(smokeThreadId)} })`)
  } catch {
    // Best-effort cleanup; completed interaction assertions remain authoritative.
  }
}

await pause(150)
const failures = checks.filter((candidate) => !candidate.passed)
const report = {
  target: {
    port,
    url: target.url,
    title: target.title
  },
  checks,
  runtimeExceptions,
  passed: failures.length === 0 && runtimeExceptions === 0,
  failures: failures.map((failure) => ({ name: failure.name, error: failure.error }))
}

const reportPath = resolve(outputDirectory, 'interaction-report.json')
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
socket.close()
if (!report.passed) process.exitCode = 1

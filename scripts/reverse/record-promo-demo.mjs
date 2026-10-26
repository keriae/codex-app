#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rmdir, stat, unlink } from 'node:fs/promises'
import { homedir, hostname, tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const defaults = {
  port: 9237,
  output: 'promo/public/codex-replica-live.mp4',
  seconds: 11,
  thread: 'Polish the Orbit Notes launch',
  prompt: 'Refine the launch card and run the check.',
  file: 'src/App.tsx',
  finalSurface: 'none',
  region: { x: 36, y: 80, width: 1440, height: 810 }
}

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  process.stdout.write(`Usage: node scripts/reverse/record-promo-demo.mjs [options]\n\n` +
    `Records the real replica renderer while CDP drives a privacy-safe demo flow.\n\n` +
    `  --workspace <absolute path>  Required demo workspace root\n` +
    `  --port <number>              Electron CDP port (default: ${defaults.port})\n` +
    `  --output <path>              .mp4, .m4v, or .mov output\n` +
    `  --seconds <number>           Recording duration (default: ${defaults.seconds})\n` +
    `  --thread <title>             Sidebar thread to select\n` +
      `  --prompt <text>              Composer text to type and send\n` +
    `  --file <relative path>       Workspace file to open\n` +
    `  --final-surface <value>      changes, terminal, or none\n` +
    `  --region <x,y,w,h>           Window/capture bounds\n` +
    `  --no-record                  Exercise and verify the UI without recording\n` +
    `  --keep-window                Do not move or resize the Electron window\n` +
    `  --help                       Show this help\n`)
  process.exit(0)
}

if (!options.workspace) throw new Error('--workspace is required')
if (!isAbsolute(options.workspace)) throw new Error('--workspace must be an absolute path')
if (!['changes', 'terminal', 'none'].includes(options.finalSurface)) {
  throw new Error('--final-surface must be changes, terminal, or none')
}

const workspace = await realpath(options.workspace)
const workspaceInfo = await stat(workspace)
if (!workspaceInfo.isDirectory()) throw new Error('--workspace must identify a directory')

const requestedFile = resolve(workspace, options.file)
const relativeFile = relative(workspace, requestedFile)
if (!relativeFile || relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
  throw new Error('--file must stay inside --workspace')
}
const file = await realpath(requestedFile)
const fileInfo = await stat(file)
if (!fileInfo.isFile()) throw new Error('--file must identify a regular file')

const targets = await fetch(`http://127.0.0.1:${options.port}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`CDP target discovery failed: ${response.status}`)
  return response.json()
})
const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
if (!target?.webSocketDebuggerUrl) throw new Error(`No page target exposed on port ${options.port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
const startedAt = Date.now()

function reportStage(stage) {
  process.stderr.write(`[promo +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${stage}\n`)
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
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

const pause = (duration) => new Promise((resolvePause) => setTimeout(resolvePause, duration))

async function waitFor(expression, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let lastValue
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(expression)
    } catch (error) {
      lastValue = error instanceof Error ? error.message : String(error)
      await pause(60)
      continue
    }
    if (lastValue) return lastValue
    await pause(60)
  }
  throw new Error(`Timed out waiting for ${expression}; last value: ${JSON.stringify(lastValue)}`)
}

async function elementRect(query) {
  return evaluate(`(() => {
    const query = ${JSON.stringify(query)};
    const candidates = [...document.querySelectorAll(query.selector)];
    const element = candidates.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || getComputedStyle(candidate).visibility === 'hidden') return false;
      if (query.text !== undefined && !candidate.textContent?.trim().includes(query.text)) return false;
      if (query.attribute !== undefined && candidate.getAttribute(query.attribute) !== query.value) return false;
      return true;
    });
    if (!element) return null;
    element.scrollIntoView({block: 'center', inline: 'center'});
    const rect = element.getBoundingClientRect();
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
  })()`)
}

async function click(query, timeout = 15_000) {
  const box = await waitFor(`Boolean((() => {
    const query = ${JSON.stringify(query)};
    return [...document.querySelectorAll(query.selector)].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && getComputedStyle(candidate).visibility !== 'hidden' &&
        (query.text === undefined || candidate.textContent?.trim().includes(query.text)) &&
        (query.attribute === undefined || candidate.getAttribute(query.attribute) === query.value);
    });
  })())`, timeout).then(() => elementRect(query))
  if (!box) throw new Error(`Could not find click target ${JSON.stringify(query)}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await pause(60)
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
  })
}

async function clickVisibleNow(query) {
  const clicked = await evaluate(`(() => {
    const query = ${JSON.stringify(query)};
    const element = [...document.querySelectorAll(query.selector)].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && getComputedStyle(candidate).visibility !== 'hidden' &&
        (query.text === undefined || candidate.textContent?.trim().includes(query.text)) &&
        (query.attribute === undefined || candidate.getAttribute(query.attribute) === query.value);
    });
    if (!element) return false;
    element.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Could not find immediate click target ${JSON.stringify(query)}`)
}

async function setWindowBounds() {
  if (options.keepWindow) return options.region
  let browserSocket
  try {
    const browserEndpoint = await fetch(`http://127.0.0.1:${options.port}/json/version`)
      .then((response) => response.json())
      .then((version) => version.webSocketDebuggerUrl)
    if (!browserEndpoint) throw new Error('Browser CDP endpoint is unavailable')
    browserSocket = new WebSocket(browserEndpoint)
    await new Promise((resolveOpen, rejectOpen) => {
      browserSocket.addEventListener('open', resolveOpen, { once: true })
      browserSocket.addEventListener('error', rejectOpen, { once: true })
    })
    let browserRequestId = 1
    const browserPending = new Map()
    browserSocket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const request = browserPending.get(message.id)
      if (!request) return
      browserPending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
    const browserCommand = (method, params = {}) => {
      const id = browserRequestId++
      return new Promise((resolveRequest, rejectRequest) => {
        browserPending.set(id, { resolve: resolveRequest, reject: rejectRequest })
        browserSocket.send(JSON.stringify({ id, method, params }))
      })
    }

    const current = await browserCommand('Browser.getWindowForTarget', { targetId: target.id })
    await browserCommand('Browser.setWindowBounds', {
      windowId: current.windowId,
      bounds: { windowState: 'normal' }
    })
    await browserCommand('Browser.setWindowBounds', {
      windowId: current.windowId,
      bounds: {
        left: options.region.x,
        top: options.region.y,
        width: options.region.width,
        height: options.region.height
      }
    })
    await pause(300)
    const updated = await browserCommand('Browser.getWindowBounds', { windowId: current.windowId })
    const bounds = updated.bounds || {}
    if ([bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)) {
      return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
    }
  } catch (error) {
    process.stderr.write(`Window bounds API unavailable; measuring renderer window instead: ${error.message}\n`)
    await evaluate(`window.resizeTo(${Math.round(options.region.width)}, ${Math.round(options.region.height)})`)
    await waitFor(`Math.abs(innerWidth - ${Math.round(options.region.width)}) <= 2 && Math.abs(innerHeight - ${Math.round(options.region.height)}) <= 2`, 8_000)
    const measured = await evaluate(`({ x: screenX, y: screenY, width: innerWidth, height: innerHeight })`)
    if ([measured.x, measured.y, measured.width, measured.height].every(Number.isFinite)) {
      return measured
    }
  } finally {
    browserSocket?.close()
  }
  return options.region
}

function sensitiveTokens() {
  const values = [
    process.env.USER,
    process.env.LOGNAME,
    homedir(),
    hostname(),
    hostname().split('.')[0]
  ]
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length >= 4))]
}

async function assertPrivacySafe(stage) {
  const result = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    const tokens = ${JSON.stringify(sensitiveTokens())};
    return {
      sensitiveToken: tokens.some((token) => text.includes(token)),
      homePath: /\\/(?:Users|home)\\/[^\\s/]+(?:\\/[^\\s]+)+/.test(text),
      privateIp: /\\b(?:10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2})\\b/.test(text),
      email: /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i.test(text)
    };
  })()`)
  const findings = Object.entries(result).filter(([, found]) => found).map(([name]) => name)
  if (findings.length) {
    throw new Error(`Privacy preflight failed at ${stage}: ${findings.join(', ')}`)
  }
}

async function workspaceExpanded() {
  return evaluate(`Boolean(
    [...document.querySelectorAll('.workspace-pane-expanded:not(.is-workbench-inactive)')]
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
      })
  )`)
}

async function closeWorkspacePane() {
  if (!(await workspaceExpanded())) return
  const selector = await evaluate(`(() => {
    const selectors = [
      'button[aria-label="隐藏标签页"]',
      'button[aria-label="Close workspace"]',
      'button.right-workbench-title-close'
    ];
    return selectors.find((selector) => [...document.querySelectorAll(selector)].some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
    })) || null;
  })()`)
  if (!selector) throw new Error('Could not find a visible workspace close control')
  await clickVisibleNow({ selector })
  await waitFor(`!Boolean(
    [...document.querySelectorAll('.workspace-pane-expanded:not(.is-workbench-inactive)')]
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
      })
  )`)
}

async function prepareDemo() {
  await waitFor(`document.querySelector('.app-shell')?.dataset.backendState === 'ready'`, 25_000)
  await evaluate(`document.documentElement && (document.documentElement.dataset.theme = 'dark')`)
  await clickVisibleNow({ selector: 'button.thread-row', attribute: 'aria-label', value: options.thread })
  await waitFor(`Boolean(document.querySelector('.workspace-pane')) && Boolean(document.querySelector('[aria-label="对话"]'))`, 20_000)
  const context = await evaluate(`window.codex.getAppContext()`)
  const selectedWorkspace = context?.cwd ? await realpath(context.cwd).catch(() => context.cwd) : null
  if (selectedWorkspace !== workspace) {
    throw new Error(`Selected thread opened an unexpected workspace: ${selectedWorkspace || 'none'}`)
  }
  await closeWorkspacePane()
  await evaluate(`(() => {
    const scroll = document.querySelector('.conversation-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  })()`)
  await waitFor(`Boolean((() => {
    const textarea = document.querySelector('.composer textarea');
    if (!textarea || textarea.disabled) return false;
    const rect = textarea.closest('.composer-dock')?.getBoundingClientRect();
    return Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.height > 80);
  })())`)
  const viewport = await evaluate(`({ width: innerWidth, height: innerHeight })`)
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: viewport.width * 0.7,
    y: viewport.height * 0.72
  })
  await pause(180)
  await assertPrivacySafe('selected conversation')
}

async function typeTerminalDemo() {
  await waitFor(`document.querySelector('.interactive-terminal-session')?.dataset.terminalState === 'ready'`, 20_000)
  await pause(350)
  await assertPrivacySafe('terminal startup')
  await evaluate(`document.querySelector('.interactive-terminal-session .xterm-helper-textarea')?.focus()`)
  await command('Input.insertText', {
    text: "clear; printf '\\033[1;36mcodex-app reconstruction\\033[0m\\n'; printf 'Live workspace · editor · review · terminal\\n'; sleep 30\n"
  })
}

async function typeComposerPrompt(text, pace) {
  await evaluate(`document.querySelector('.composer textarea')?.focus()`)
  const words = text.match(/\S+\s*/gu) || [text]
  const chunks = pace === 0
    ? [text]
    : Array.from({ length: Math.ceil(words.length / 2) }, (_, index) =>
        words.slice(index * 2, index * 2 + 2).join(''))
  for (const chunk of chunks) {
    await evaluate(`(() => {
      const textarea = document.querySelector('.composer textarea');
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(textarea, textarea.value + ${JSON.stringify(chunk)});
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: ${JSON.stringify(chunk)}
      }));
      return true;
    })()`)
    if (pace !== 0) await pause(190)
  }
  await waitFor(`Boolean(document.querySelector('button.send-button.send[aria-label="发送"]:not([disabled])'))`)
}

async function openChangesPane() {
  const expanded = await workspaceExpanded()
  if (expanded) {
    await evaluate(`window.dispatchEvent(new CustomEvent('codex-replica:open-workspace-content', { detail: { tab: 'changes' } }))`)
    return
  }

  const retainedTabsVisible = await evaluate(`Boolean(
    [...document.querySelectorAll('button[aria-label^="显示标签页"]')]
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
      })
  )`)
  if (retainedTabsVisible) {
    await clickVisibleNow({ selector: 'button[aria-label^="显示标签页"]' })
    await waitFor(`Boolean(
      [...document.querySelectorAll('.workspace-pane-expanded:not(.is-workbench-inactive)')]
        .find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
        })
    )`)
    await evaluate(`window.dispatchEvent(new CustomEvent('codex-replica:open-workspace-content', { detail: { tab: 'changes' } }))`)
    return
  }

  const summaryVisible = () => evaluate(`Boolean(
    [...document.querySelectorAll('.workspace-pane-collapsed, .project-summary-popover[data-state="open"]')]
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
      })
  )`)
  if (!(await summaryVisible())) {
    await clickVisibleNow({ selector: 'button[aria-label="切换摘要面板固定状态"]' })
    await waitFor(`Boolean(
      [...document.querySelectorAll('.workspace-pane-collapsed, .project-summary-popover[data-state="open"]')]
        .find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 2 && rect.height > 2 && getComputedStyle(node).visibility !== 'hidden';
        })
    )`)
  }
  await pause(180)
  const popoverVisible = await evaluate(`Boolean(
    [...document.querySelectorAll('.project-summary-popover[data-state="open"]')]
      .find((node) => node.getBoundingClientRect().width > 2)
  )`)
  await clickVisibleNow(popoverVisible
    ? { selector: '.project-summary-changes' }
    : { selector: '.workspace-pane-summary-section-trigger', text: '变更' })
  await waitFor(`Boolean(document.querySelector('.workspace-pane-expanded:not(.is-workbench-inactive)'))`, 20_000)
  await evaluate(`window.dispatchEvent(new CustomEvent('codex-replica:open-workspace-content', { detail: { tab: 'changes' } }))`)
}

async function runDemoFlow(pace = 1) {
  const wait = (duration) => pause(pace === 0 ? Math.min(70, duration) : duration)
  await wait(200)
  const initialTurns = await evaluate(`document.querySelectorAll('.turn-block').length`)
  await typeComposerPrompt(options.prompt, pace)
  reportStage('composer input complete')
  await wait(180)
  reportStage('clicking send')
  await clickVisibleNow({ selector: 'button.send-button.send', attribute: 'aria-label', value: '发送' })
  reportStage('send clicked')
  await waitFor(`Boolean(document.querySelector('button.send-button.stop[aria-label="停止"]'))`, 20_000)
  reportStage('turn running')
  await waitFor(`document.querySelectorAll('.turn-block').length > ${initialTurns}`, 20_000)
  await waitFor(`Boolean(document.querySelector('.turn-block:last-of-type .conversation-command-item[data-status="inProgress"]'))`, 20_000)
  await wait(850)

  await waitFor(`Boolean(document.querySelector('.turn-block:last-of-type .conversation-command-item[data-status="completed"]'))`, 20_000)
  reportStage('command completed')
  await waitFor(`Boolean(
    [...document.querySelectorAll('.turn-block:last-of-type .live-summary-row')]
      .find((node) => node.textContent?.includes('正在编辑文件'))
  )`, 20_000)
  reportStage('file changes running')
  await wait(850)

  if (options.finalSurface === 'changes') {
    await openChangesPane()
    await waitFor(`Boolean(document.querySelector('.workspace-code-viewer[aria-label="所有更改"], .workspace-diff-viewer'))`, 20_000)
    reportStage('changes pane open')
    await wait(1_250)
    await closeWorkspacePane()
    reportStage('changes pane closed')
  } else if (options.finalSurface === 'none' && await workspaceExpanded()) {
    throw new Error('Workspace pane opened during a no-surface demo')
  }

  await waitFor(`!Boolean(document.querySelector('button.send-button.stop[aria-label="停止"]'))`, 20_000)
  await waitFor(`Boolean(document.querySelector('.turn-block:last-of-type:not(.is-active) .agent-message'))`, 20_000)
  reportStage('turn completed')
  if (options.finalSurface === 'none' && await workspaceExpanded()) {
    throw new Error('Workspace pane opened before the no-surface demo completed')
  }
  await evaluate(`(() => {
    const scroll = document.querySelector('.conversation-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  })()`)
  await wait(900)
}

async function reloadDemo() {
  const previousTimeOrigin = await evaluate(`performance.timeOrigin`)
  await command('Page.reload', { ignoreCache: true })
  await waitFor(`document.readyState === 'complete' && performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, 25_000)
  await prepareDemo()
}

function waitForProcess(child, label) {
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolveProcess, rejectProcess) => {
    child.once('error', rejectProcess)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveProcess()
      else rejectProcess(new Error(`${label} failed (${signal || code}): ${stderr.trim()}`))
    })
  })
}

function collectProcessOutput(executable, args, label) {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolveProcess, rejectProcess) => {
    child.once('error', rejectProcess)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveProcess(stdout.trim())
      else rejectProcess(new Error(`${label} failed (${signal || code}): ${stderr.trim()}`))
    })
  })
}

async function activateCaptureApp() {
  const listenerOutput = await collectProcessOutput(
    '/usr/sbin/lsof',
    ['-nP', `-iTCP:${options.port}`, '-sTCP:LISTEN', '-t'],
    'CDP listener lookup'
  )
  const appPid = Number(listenerOutput.split(/\s+/u).find(Boolean))
  if (!Number.isInteger(appPid) || appPid <= 0) {
    throw new Error(`Could not resolve the Electron process listening on CDP port ${options.port}`)
  }

  await collectProcessOutput('/usr/bin/osascript', [
    '-e',
    `tell application "System Events" to set frontmost of first application process whose unix id is ${appPid} to true`
  ], 'Electron activation')
  await pause(500)

  const frontmostPid = Number(await collectProcessOutput('/usr/bin/osascript', [
    '-e',
    'tell application "System Events" to get unix id of first application process whose frontmost is true'
  ], 'frontmost application check'))
  if (frontmostPid !== appPid) {
    throw new Error(`Refusing to record: Electron PID ${appPid} is not frontmost (found ${frontmostPid || 'unknown'})`)
  }
}

async function record(bounds) {
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true })
  const extension = extname(output).toLocaleLowerCase()
  if (!['.mov', '.mp4', '.m4v'].includes(extension)) {
    throw new Error('--output must end in .mov, .mp4, or .m4v')
  }

  const temporaryDirectory = extension === '.mov'
    ? null
    : await mkdtemp(join(tmpdir(), 'codex-replica-promo-'))
  const capture = temporaryDirectory ? join(temporaryDirectory, 'capture.mov') : output
  const captureArguments = [
    '-v', '-x', '-k', `-V${options.seconds}`,
    `-R${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`,
    capture
  ]
  await command('Page.bringToFront')
  await activateCaptureApp()
  const recorder = spawn('/usr/sbin/screencapture', captureArguments, { stdio: ['ignore', 'ignore', 'pipe'] })
  const recorded = waitForProcess(recorder, 'screencapture')
  await pause(200)
  await runDemoFlow(1)
  await recorded

  if (temporaryDirectory) {
    const converter = spawn('/usr/bin/avconvert', [
      '--source', capture,
      '--preset', 'Preset1920x1080',
      '--output', output,
      '--replace'
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    await waitForProcess(converter, 'avconvert')
    await unlink(capture)
    await rmdir(temporaryDirectory)
  }
  return output
}

await command('Page.enable')
await command('Runtime.enable')
const captureBounds = await setWindowBounds()

try {
  await prepareDemo()

  if (options.noRecord) {
    await runDemoFlow(0)
    await assertPrivacySafe('completed demo flow')
    process.stdout.write(`${JSON.stringify({ ok: true, recorded: false, workspace, file, finalSurface: options.finalSurface })}\n`)
  } else {
    await reloadDemo()
    const output = await record(captureBounds)
    process.stdout.write(`${JSON.stringify({ ok: true, recorded: true, output, seconds: options.seconds, bounds: captureBounds })}\n`)
  }
} finally {
  socket.close()
}

function parseArguments(args) {
  const parsed = {
    ...defaults,
    region: { ...defaults.region },
    workspace: process.env.CODEX_DEMO_WORKSPACE || null,
    noRecord: false,
    keepWindow: false,
    help: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const next = () => {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
      return value
    }
    if (argument === '--help') parsed.help = true
    else if (argument === '--no-record') parsed.noRecord = true
    else if (argument === '--keep-window') parsed.keepWindow = true
    else if (argument === '--workspace') parsed.workspace = next()
    else if (argument === '--port') parsed.port = positiveNumber(next(), '--port')
    else if (argument === '--output') parsed.output = next()
    else if (argument === '--seconds') parsed.seconds = positiveNumber(next(), '--seconds')
    else if (argument === '--thread') parsed.thread = next()
    else if (argument === '--prompt') parsed.prompt = next()
    else if (argument === '--file') parsed.file = next()
    else if (argument === '--final-surface') parsed.finalSurface = next()
    else if (argument === '--region') parsed.region = parseRegion(next())
    else throw new Error(`Unknown option: ${argument}`)
  }
  return parsed
}

function positiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`)
  return number
}

function parseRegion(value) {
  const parts = value.split(',').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[2] < 320 || parts[3] < 240) {
    throw new Error('--region must be x,y,width,height with a minimum size of 320x240')
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

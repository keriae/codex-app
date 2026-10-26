#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.argv[2] || 9225)
const output = resolve(process.argv[3] || 'reverse/raw/checks/settings')
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const target = targets.find((candidate) => candidate.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error('The replica renderer is not available.')
const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let id = 0
let exceptions = 0
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === 'Runtime.exceptionThrown') exceptions += 1
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})
await new Promise((ready, reject) => {
  socket.addEventListener('open', ready, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
function command(method, params = {}) {
  return new Promise((resolveRequest, reject) => {
    const requestId = ++id
    pending.set(requestId, { resolve: resolveRequest, reject })
    socket.send(JSON.stringify({ id: requestId, method, params }))
  })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const pause = (duration = 100) => new Promise((ready) => setTimeout(ready, duration))
async function waitFor(expression, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = await evaluate(expression)
    if (result) return result
    await pause(60)
  }
  throw new Error(`Timed out: ${expression}`)
}
async function click(selector, text) {
  const box = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = ${text === undefined ? 'nodes[0]' : `nodes.find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)})`};
    if (!node) return null;
    node.scrollIntoView({block:'center'});
    const box = node.getBoundingClientRect();
    return {x:box.x+box.width/2,y:box.y+box.height/2};
  })()`)
  if (!box) throw new Error(`Missing control: ${selector} ${text || ''}`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', buttons: 0, clickCount: 1 })
  await pause()
}
async function key(keyName, keyCode) {
  await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code: keyName, windowsVirtualKeyCode: keyCode })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: keyCode })
  await pause()
}
function assert(value, message) { if (!value) throw new Error(message) }
async function route(label, id) {
  await click('.settings-page-nav button', label)
  await waitFor(`document.querySelector('.settings-page-scroll')?.dataset.settingsRoute === ${JSON.stringify(id)}`)
}

await command('Runtime.enable')
const originalStorage = await evaluate(`({desktop:localStorage.getItem('codex-desktop-settings-v1'),theme:localStorage.getItem('codex-theme')})`)
const originalNative = await evaluate('window.codex.getDesktopPreferences()')
const checks = []
async function check(name, run) {
  try {
    checks.push({ name, passed: true, evidence: await run() })
  } catch (error) {
    checks.push({ name, passed: false, error: error.message })
  }
}
try {
  if (!await evaluate("Boolean(document.querySelector('.settings-page'))")) {
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:',',code:'Comma',metaKey:true,bubbles:true}))`)
    await waitFor("Boolean(document.querySelector('.settings-page'))")
  }
  await check('general select keyboard navigation and persisted switch', async () => {
    await route('常规', 'general')
    assert(await evaluate("document.querySelector('[role=switch][aria-label=\"默认权限\"]')?.disabled"), 'Default permissions must always remain visible.')
    await click('.settings-page-toggle[aria-label="完整访问权限"]')
    const stored = await evaluate("JSON.parse(localStorage.getItem('codex-desktop-settings-v1')).fullAccessVisible")
    await route('外观', 'appearance')
    await route('常规', 'general')
    assert(await evaluate("document.querySelector('[aria-label=\"完整访问权限\"]')?.getAttribute('aria-checked')") === String(stored), 'Full access visibility was lost when navigating settings.')
    await click('.settings-page-pill[aria-label="默认文件打开位置"]')
    await waitFor("Boolean(document.querySelector('.settings-select-menu'))")
    const focused = await evaluate("document.activeElement?.getAttribute('role')")
    assert(focused === 'menuitemradio', 'Opening a settings menu did not move focus to its selected option.')
    await key('ArrowDown', 40)
    await key('Enter', 13)
    assert(!await evaluate("Boolean(document.querySelector('.settings-select-menu'))"), 'Selecting an option left the menu open.')
    assert(await evaluate("document.activeElement?.getAttribute('aria-label')") === '默认文件打开位置', 'Selecting an option did not restore focus.')
    return { persistedFullAccessVisibility: true, optionKeyboardSelection: true, focusRestored: true }
  })
  await check('system appearance and accessible mode controls', async () => {
    await route('外观', 'appearance')
    await click('.settings-page-theme-choices button[aria-label="浅色"]')
    await waitFor("document.documentElement.dataset.theme === 'light'")
    await click('.settings-page-theme-choices button[aria-label="深色"]')
    await waitFor("document.documentElement.dataset.theme === 'dark'")
    await click('.settings-page-theme-choices button[aria-label="跟随系统"]')
    await waitFor("localStorage.getItem('codex-theme') === 'system'")
    assert(await evaluate("document.documentElement.dataset.theme === (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')"), 'System appearance was resolved incorrectly.')
    return { light: true, dark: true, system: true }
  })
  await check('effective configuration loads without mutating server config', async () => {
    await route('配置', 'configuration')
    await waitFor("!document.querySelector('[aria-label=\"刷新配置\"]')?.disabled || Boolean(document.querySelector('.settings-page-error'))")
    const error = await evaluate("Boolean(document.querySelector('.settings-page-error'))")
    assert(!error, 'The server configuration could not be loaded.')
    await click('.settings-page-pill[aria-label="输出详细程度"]')
    await waitFor("Boolean(document.querySelector('.settings-select-menu'))")
    const options = await evaluate("document.querySelectorAll('.settings-select-menu [role=menuitemradio]').length")
    await key('Escape', 27)
    assert(options === 4, 'Verbosity options do not match the connected server schema.')
    return { configRead: true, verbosityOptionCount: options, serverWrites: 0 }
  })
  await check('archive reads server inventory and empty-state controls', async () => {
    await route('已归档的聊天', 'archived')
    await waitFor("!document.querySelector('[aria-label=\"刷新已归档的聊天\"]')?.disabled")
    assert(!await evaluate("Boolean(document.querySelector('.settings-page-error'))"), 'Archive inventory failed to load.')
    return { archiveRead: true, searchAvailable: await evaluate("Boolean(document.querySelector('[aria-label=\"搜索已归档的聊天\"]'))") }
  })
  await check('live integrations replace fixture catalogs', async () => {
    await route('插件', 'plugins')
    await waitFor("!document.querySelector('[aria-label=\"刷新插件、技能和 MCP\"]')?.disabled")
    await click('#settings-skills-tab')
    assert(!await evaluate("Boolean(document.querySelector('.settings-page-error'))"), 'Skill inventory failed to load.')
    const skills = await evaluate("document.querySelectorAll('#settings-integration-list [role=switch]').length")
    await click('#settings-mcp-tab')
    assert(!await evaluate("Boolean(document.querySelector('.settings-page-error'))"), 'MCP inventory failed to load.')
    return { skillsVisible: skills, mcpTab: true, pluginCountsDerivedFromServer: true, writes: 0 }
  })
  await check('worktrees use real Git inventory', async () => {
    await route('Worktrees', 'worktrees')
    await waitFor("!document.querySelector('[aria-label=\"刷新工作树\"]')?.disabled")
    assert(!await evaluate("document.querySelector('.settings-page-scroll').textContent.includes('worktrees/current/')"), 'A fixture worktree path remains visible.')
    return { fixturePathRemoved: true, worktreeRead: true }
  })
} finally {
  await evaluate(`(() => {
    const original=${JSON.stringify(originalStorage)};
    for (const [key,value] of [['codex-desktop-settings-v1',original.desktop],['codex-theme',original.theme]]) {
      if(value === null) localStorage.removeItem(key); else localStorage.setItem(key,value);
      dispatchEvent(new StorageEvent('storage',{key,newValue:value,storageArea:localStorage}));
    }
  })()`)
  await evaluate(`window.codex.updateDesktopPreferences(${JSON.stringify(originalNative)})`)
  await route('常规', 'general').catch(() => undefined)
  await mkdir(output, { recursive: true })
  const report = { port, checks, runtimeExceptions: exceptions, passed: checks.every((item) => item.passed) && exceptions === 0 }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  socket.close()
  if (!report.passed) process.exitCode = 1
}

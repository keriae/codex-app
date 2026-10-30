#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { connectReplica, connectTarget } from './replica-cdp.mjs'
const port = Number(process.argv[2] || 9231)
const output = resolve(process.argv[3] || 'reverse/raw/parity-2026-10-28/runtime')
await mkdir(output, { recursive: true })
const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-workbench-parity-')))
await mkdir(join(root, 'folder'))
await writeFile(join(root, 'folder', 'sample.ts'), 'export const parity = "verified"\n')
const http = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<title>Workbench parity fixture</title><h1>Browser fixture</h1><p>parityneedle</p><p>parityneedle</p><p>parityneedle</p>')
})
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${http.address().port}/`
const c = await connectReplica(port)
const fixtures = []
const report = { backend: null, checks: [], runtimeExceptions: 0 }
const invoke = (method, params) => c.evaluate(`window.codex.invoke(${JSON.stringify(method)},${JSON.stringify(params)})`)
const capture = async name => {
  const result = await c.command('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(output, `${name}.png`), Buffer.from(result.data, 'base64'))
}
try {
  report.backend = await c.evaluate('window.codex.getBackendStatus()')
  assert.equal(report.backend.state, 'ready')
  const model = (await invoke('model/list', { includeHidden: false })).data[0].model
  for (const suffix of ['A', 'B']) {
    const result = await invoke('thread/start', { cwd: root, model, ephemeral: false })
    fixtures.push({ id: result.thread.id, name: `Workbench parity ${suffix} ${Date.now()}` })
    await invoke('thread/name/set', { threadId: result.thread.id, name: fixtures.at(-1).name })
  }
  await writeFile(join(output, 'fixtures.json'), JSON.stringify(fixtures, null, 2))
  const select = async fixture => {
    const selector = `.thread-row[aria-label=${JSON.stringify(fixture.name)}]`
    await c.waitFor(`document.querySelector(${JSON.stringify(selector)})`)
    await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await c.waitFor(`document.querySelector('.thread-row.active')?.getAttribute('aria-label')===${JSON.stringify(fixture.name)}`)
    await c.waitFor(`document.querySelector('.workspace-pane')?.textContent.includes(${JSON.stringify(root.split('/').at(-1))})`)
  }
  await select(fixtures[0])
  await c.evaluate(`window.dispatchEvent(new CustomEvent('codex:open-workspace-file',{detail:{path:${JSON.stringify(join(root,'folder','sample.ts'))},line:1}}))`)
  await c.waitFor(`document.querySelector('.workspace-file-editor') || document.querySelector('.cm-editor')`)
  await c.waitFor(`document.querySelector('.right-workbench-title-tab')`)
  const fileTabs = await c.evaluate(`[...document.querySelectorAll('.right-workbench-title-tab')].map(e=>e.textContent.trim())`)
  assert(fileTabs.some(t => t.includes('sample.ts')), JSON.stringify(fileTabs))
  assert(!fileTabs.includes('变更'), JSON.stringify(fileTabs))
  report.checks.push('file opens without an unsolicited Changes tab')
  await capture('file')
  await c.click('button[aria-label="新标签页"]')
  await c.waitFor(`document.querySelector('.workbench-browser.is-active')`)
  const address = '.workbench-browser.is-active input[aria-label="搜索或输入网址"]'
  await c.click(address)
  await c.command('Input.insertText', { text: url })
  await c.command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await c.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 })
  await c.waitFor(`document.querySelector('.workbench-browser.is-active')?.getAttribute('aria-label')==='Workbench parity fixture'`)
  await c.evaluate(`window.__parityFind=[];window.__parityFindStop=window.codex.onBrowserViewEvent(e=>{if(e.type==='find-result')window.__parityFind.push(e.result)})`)
  await c.click('.workbench-browser.is-active button[aria-label="浏览器选项"]')
  await new Promise(resolve=>setTimeout(resolve,150))
  await c.click('.workbench-browser-options-menu button[role="menuitem"]')
  await c.waitFor(`document.querySelector('input[aria-label="查找文本"]')`)
  await c.click('input[aria-label="查找文本"]')
  await c.command('Input.insertText', { text: 'parityneedle' })
  await c.waitFor(`document.querySelector('output[aria-label="匹配数量"]')?.textContent==='1/3'`)
  await c.click('button[aria-label="下一个匹配"]')
  await c.waitFor(`document.querySelector('output[aria-label="匹配数量"]')?.textContent==='2/3'`)
  await c.click('button[aria-label="关闭页内查找"]')
  report.checks.push('native page find, counts, next match and close')
  await c.click('.workbench-browser.is-active button[aria-label="浏览器选项"]')
  await new Promise(resolve=>setTimeout(resolve,150))
  await c.click('.workbench-browser-options-menu button[aria-label="放大"]')
  await c.waitFor(`document.querySelector('output[aria-label="当前缩放比例"]')?.textContent==='110%'`)
  await c.click('.workbench-browser-options-menu button[aria-label="重置缩放"]')
  await c.waitFor(`document.querySelector('output[aria-label="当前缩放比例"]')?.textContent==='100%'`)
  await c.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 })
  report.checks.push('native page zoom and reset')
  await select(fixtures[1])
  assert.equal(await c.evaluate(`document.querySelectorAll('.workbench-browser.is-active').length`), 0)
  await select(fixtures[0])
  await c.waitFor(`document.querySelector('.workbench-browser.is-active')?.getAttribute('aria-label')==='Workbench parity fixture'`)
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
  const page = targets.find(t => t.url === url)
  assert(page, 'same native page survives the chat switch')
  report.checks.push('chat switch preserves native page and active tab')
  await capture('browser')
  report.runtimeExceptions = c.exceptions
  assert.equal(c.exceptions, 0)
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await capture('failure')
  console.error(await c.evaluate(`({panes:[...document.querySelectorAll('.workspace-pane')].map(e=>({class:e.className,label:e.getAttribute('aria-label'),text:e.textContent.slice(0,800)})),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),find:window.__parityFind,tabs:[...document.querySelectorAll('.right-workbench-title-tab')].map(e=>e.textContent)})`))
  throw error
} finally {
  for (const fixture of fixtures) {
    try { await invoke('thread/delete', { threadId: fixture.id }) } catch (error) { console.error(`Fixture cleanup: ${error.message.slice(0,180)}`) }
  }
  await c.evaluate(`window.__parityFindStop?.(); delete window.__parityFind;delete window.__parityFindStop`).catch(()=>{})
  c.close()
  http.closeAllConnections()
  await new Promise(resolve => http.close(resolve))
  await rm(root, { recursive: true, force: true })
}

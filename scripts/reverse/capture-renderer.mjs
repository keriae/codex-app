#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const port = Number(process.argv[2] || 9225)
const output = process.argv[3] || '/tmp/codex-replica-renderer.png'
const clickText = process.argv[4] || null
const targetUrl = process.argv[5] || null
const cdpHost = process.env.CODEX_CDP_HOST || '127.0.0.1'
const captureTheme = process.env.CODEX_CAPTURE_THEME || null
const targets = await fetch(`http://${cdpHost}:${port}/json/list`).then((response) => response.json())
const target = targets.find(
  (candidate) => candidate.type === 'page' && (!targetUrl || candidate.url === targetUrl)
)
if (!target?.webSocketDebuggerUrl) throw new Error(`No page target on port ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (!message.id) return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function command(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await command('Page.enable')
if (captureTheme) {
  await command('Runtime.evaluate', {
    expression: `document.documentElement.dataset.theme = ${JSON.stringify(captureTheme)}`
  })
}
if (clickText) {
  await command('Runtime.evaluate', {
    expression: `(() => {
      const requested = ${JSON.stringify(clickText)};
      const byAriaLabel = requested.startsWith('aria:');
      const targetText = byAriaLabel ? requested.slice(5) : requested;
      const candidate = [...document.querySelectorAll('button')].find((button) =>
        byAriaLabel
          ? button.getAttribute('aria-label') === targetText
          : button.textContent?.trim().includes(targetText)
      );
      if (!candidate) throw new Error('Button not found: ' + requested);
      candidate.click();
    })()`
  })
  await new Promise((resolve) => setTimeout(resolve, 1_500))
}
const result = await command('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
  captureBeyondViewport: false
})
await writeFile(output, Buffer.from(result.data, 'base64'))
socket.close()
process.stdout.write(`${output}\n`)

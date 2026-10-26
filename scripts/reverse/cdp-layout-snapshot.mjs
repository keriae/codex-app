#!/usr/bin/env node

const port = Number(process.argv[2] || 9224)
const targetUrl = process.argv[3] || 'app://-/index.html'
const cdpHost = process.env.CODEX_CDP_HOST || '127.0.0.1'
const endpoint = `http://${cdpHost}:${port}/json/list`

const targets = await fetch(endpoint).then((response) => {
  if (!response.ok) throw new Error(`CDP target discovery failed: ${response.status}`)
  return response.json()
})
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === targetUrl)
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No ${targetUrl} target exposed on port ${port}`)
}

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

const expression = `(() => {
  const describe = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      display: style.display,
      position: style.position,
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderRadius: style.borderRadius
    };
  };
  const candidates = [...document.querySelectorAll('main, nav, aside, form, textarea, [role="navigation"], [contenteditable="true"]')];
  return {
    url: location.href,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio
    },
    body: describe(document.body),
    candidates: candidates.slice(0, 200).map(describe)
  };
})()`

const result = await command('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true
})

// This intentionally records geometry and computed styles only. It does not
// capture DOM text, screenshots, cookies, storage, or network traffic.
process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`)
socket.close()

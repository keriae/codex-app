#!/usr/bin/env node

const port = Number(process.argv[2] || 9225)
const expectedUrl = process.argv[3] || 'app://-/index.html'
const expectedBackendMode = process.argv[4] || null
const discoveryDeadline = Date.now() + 20_000

async function discoverPage() {
  let lastError
  while (Date.now() < discoveryDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const target = targets.find((candidate) => candidate.type === 'page')
        if (target?.webSocketDebuggerUrl) return target
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No page target exposed on port ${port}: ${lastError?.message || 'timed out'}`)
}

const target = await discoverPage()
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

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  }
  return response.result.value
}

await command('Runtime.enable')

const state = await evaluate(`(async () => {
  const deadline = Date.now() + 20_000;
  let appShell;
  while (Date.now() < deadline) {
    appShell = document.querySelector('.app-shell');
    if (appShell?.dataset.backendState === 'ready') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  window.__codexInlineCspProbe = undefined;
  const inlineScript = document.createElement('script');
  inlineScript.textContent = 'window.__codexInlineCspProbe = true';
  document.head.append(inlineScript);
  await new Promise((resolve) => setTimeout(resolve, 50));

  let geolocationPermission = 'unavailable';
  try {
    geolocationPermission = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch (error) {
    geolocationPermission = 'error';
  }

  return {
    url: location.href,
    readyState: document.readyState,
    backendState: appShell?.dataset.backendState || null,
    backendMode: appShell?.dataset.backendMode || null,
    inlineScriptExecuted: window.__codexInlineCspProbe === true,
    geolocationPermission,
    rendererRequire: typeof window.require,
    rendererProcess: typeof window.process
  };
})()`)

await new Promise((resolve) => setTimeout(resolve, 150))

const failures = []
if (state.url !== expectedUrl) failures.push(`url: expected ${expectedUrl}, received ${state.url}`)
if (state.readyState !== 'complete') failures.push(`document.readyState: received ${state.readyState}`)
if (state.backendState !== 'ready') {
  failures.push(`backend: expected ready state, received ${String(state.backendState)}`)
}
if (expectedBackendMode && state.backendMode !== expectedBackendMode) {
  failures.push(
    `backend mode: expected ${expectedBackendMode}, received ${String(state.backendMode)}`
  )
}
if (state.inlineScriptExecuted) failures.push('CSP allowed an inline script')
if (state.geolocationPermission !== 'denied') {
  failures.push(`geolocation permission: expected denied, received ${state.geolocationPermission}`)
}
if (state.rendererRequire !== 'undefined' || state.rendererProcess !== 'undefined') {
  failures.push('renderer unexpectedly exposes Node.js globals')
}
if (runtimeExceptions !== 0) failures.push(`runtime exceptions: ${runtimeExceptions}`)

const report = {
  state,
  runtimeExceptions,
  passed: failures.length === 0,
  failures
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
socket.close()
if (failures.length) process.exitCode = 1

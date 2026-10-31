#!/usr/bin/env node

// Passive recording only. Operate the isolated replica manually or with CUA.
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { homedir, hostname } from 'node:os'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const rawRoot = resolve(root, 'reverse/raw')
const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`Usage: node scripts/reverse/record-promo-demo.mjs --workspace /tmp/orbit-notes-demo --window-id <id> [options]

Records only the isolated replica window. Does not click, type, resize, focus,
scroll, or reload the app. Use the app normally while the capture runs.

  --port <number>       Replica's read-only CDP endpoint (default: 9237)
  --seconds <number>    Capture duration (default: 60)
  --output <path>       .mov below ignored reverse/raw/ (default: promo-session.mov)

Raw MOV files may contain macOS author metadata. Strip all metadata when
transcoding; inspect every published frame before committing any media.`)
  process.exit(0)
}
const options = {port: 9237, seconds: 60, output: resolve(rawRoot, 'promo-session.mov')}
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace(/^--/, '')
  if (!['workspace', 'window-id', 'port', 'seconds', 'output'].includes(key) || !args[i + 1]) {
    throw new Error('Unknown option or missing value. Use --help.')
  }
  options[key] = args[i + 1]
}
if (process.platform !== 'darwin') throw new Error('macOS is required')
if (!options.workspace || !isAbsolute(options.workspace)) throw new Error('An absolute demo workspace is required')
const workspace = await realpath(options.workspace)
const port = Number(options.port)
const windowId = Number(options['window-id'])
const seconds = Number(options.seconds)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
if (!Number.isInteger(windowId) || windowId < 1) throw new Error('Invalid window id')
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) throw new Error('Duration must be 1–300 seconds')
const output = resolve(options.output)
const outputRelative = relative(rawRoot, output)
if (isAbsolute(outputRelative) || outputRelative.startsWith('..') || !output.endsWith('.mov')) {
  throw new Error('Raw recording must be a .mov below ignored reverse/raw/')
}

const listeners = await exec('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
const pid = Number(listeners.stdout.trim().split(/\s+/)[0])
if (!Number.isInteger(pid)) throw new Error('Isolated replica listener missing')
const processInfo = await exec('/bin/ps', ['-p', String(pid), '-o', 'comm='])
if (!processInfo.stdout.trim().startsWith(root + '/')) throw new Error('Capture listener must belong to this local replica checkout')
const windowInfo = await exec('/usr/bin/swift', ['-e', `import CoreGraphics
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String:Any]]
let found = windows.contains { ($0[kCGWindowNumber as String] as? Int) == ${windowId} && ($0[kCGWindowOwnerPID as String] as? Int) == ${pid} }
print(found ? "yes" : "no")`])
if (windowInfo.stdout.trim() !== 'yes') throw new Error('Window does not belong to the isolated replica listener')
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
const target = targets.find(t => t.type === 'page' && t.url === 'app://-/index.html')
if (!target?.webSocketDebuggerUrl) throw new Error('Replica renderer missing')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((ok, no) => { socket.addEventListener('open', ok, {once: true}); socket.addEventListener('error', no, {once: true}) })
let id = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data))
  if (!message.id) return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  message.error ? request.reject(new Error('Read-only observation failed')) : request.resolve(message.result)
})
async function observe() {
  const requestId = ++id
  const response = await new Promise((ok, no) => {
    pending.set(requestId, {resolve: ok, reject: no})
    socket.send(JSON.stringify({id: requestId, method: 'Runtime.evaluate', params: {
      expression: `(async () => ({ text: document.body.innerText, cwd: (await window.codex.getAppContext()).cwd }))()`,
      returnByValue: true, awaitPromise: true
    }}))
  })
  if (response.exceptionDetails) throw new Error('Read-only renderer observation failed')
  const value = response.result.value
  if (await realpath(value.cwd) !== workspace) throw new Error('Unexpected demo workspace')
  const text = value.text || ''
  const tokens = [process.env.USER, process.env.LOGNAME, homedir(), hostname()].filter(v => v && v.length >= 4)
  const ipAddresses = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []
  const privateIp = ipAddresses.some(ip => {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  })
  if (tokens.some(t => text.includes(t)) || /\/Users\/[^/\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) || privateIp) {
    throw new Error('Privacy preflight failed; recording remains local')
  }
}
try {
  await observe()
  await mkdir(dirname(output), {recursive: true})
  await new Promise((ok, no) => {
    const child = spawn('/usr/sbin/screencapture', ['-v', '-x', `-V${seconds}`, `-l${windowId}`, output], {stdio: ['ignore', 'ignore', 'pipe']})
    child.once('error', no)
    child.once('exit', code => code === 0 ? ok() : no(new Error('Passive window capture failed')))
  })
  await observe()
  console.log('Local recording complete. Strip container metadata and review the footage before publication.')
} finally {
  socket.close()
}

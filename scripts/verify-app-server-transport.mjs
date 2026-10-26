import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer, createConnection } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'

// Read-only RPC smoke against the installed server implementation. These
// servers belong to this script; the user's running servers are untouched.
const binary = process.env.CODEX_BINARY || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
const temporary = await mkdtemp(join(tmpdir(), 'codex-transport-smoke-'))
const bundle = join(temporary, 'transport.cjs')
await build({ entryPoints: [resolve('src/main/appServer.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const { AppServerClient } = createRequire(import.meta.url)(bundle)

async function availablePort() {
  const socket = createServer()
  await new Promise((resolveListening, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolveListening) })
  const port = socket.address().port
  await new Promise((resolveClosed) => socket.close(resolveClosed))
  return port
}

async function waitForListener(address, child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Installed app-server exited before opening its listener')
    const available = await new Promise((resolveReady) => {
      const socket = createConnection(address)
      socket.once('connect', () => { socket.destroy(); resolveReady(true) })
      socket.once('error', () => { socket.destroy(); resolveReady(false) })
    })
    if (available) return
    await delay(25)
  }
  throw new Error('Installed app-server listener did not open within 5 seconds')
}

async function stopOwnedServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  const stopped = await Promise.race([exited.then(() => true), delay(1_000).then(() => false)])
  if (!stopped) { child.kill('SIGKILL'); await exited }
}

try {
  for (const kind of ['websocket', 'unix']) {
    const port = kind === 'websocket' ? await availablePort() : null
    const socketPath = join(temporary, 'server.sock')
    const listener = port ? `ws://127.0.0.1:${port}` : `unix://${socketPath}`
    const endpoint = port ? { kind: 'websocket', url: listener } : { kind: 'unix', socketPath }
    const child = spawn(binary, ['-c', 'features.code_mode_host=true', 'app-server', '--listen', listener], { stdio: ['ignore', 'ignore', 'ignore'], env: process.env })
    let spawnError
    child.on('error', (error) => { spawnError = error })
    const client = new AppServerClient({ resolveServerEndpoint: () => endpoint, autoReconnect: false, initializeTimeoutMs: 5_000 })
    try {
      if (spawnError) throw spawnError
      await waitForListener(port ? { host: '127.0.0.1', port } : { path: socketPath }, child)
      const models = await client.request('model/list', { limit: 1 })
      const threads = await client.request('thread/list', { limit: 1 })
      const status = client.getStatus()
      await client.stop()
      // A second client proves that closing a client leaves its server alive.
      await client.start()
      const again = await client.request('model/list', { limit: 1 })
      console.log(JSON.stringify({ transport: kind, state: status.state, models: models.data?.length ?? 0, threads: threads.data?.length ?? 0, secondSessionModels: again.data?.length ?? 0, serverStillRunning: child.exitCode === null }))
    } finally {
      await client.stop()
      await stopOwnedServer(child)
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

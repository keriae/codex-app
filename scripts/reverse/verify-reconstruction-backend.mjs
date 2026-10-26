#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const app = path.resolve(process.argv[2] || 'release/local-runtime/Codex Study Verified.app')
const resources = path.join(app, 'Contents/Resources')
const config = JSON.parse(await fs.readFile(path.join(resources, 'codex-replica-runtime.json'), 'utf8'))
assert.equal(config.marker, 'codex-replica-local-runtime-v1')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-reconstruction-backend-'))
const bundle = path.join(temporary, 'client.cjs')
await build({ entryPoints: [path.resolve('src/main/appServer.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const { AppServerClient } = createRequire(import.meta.url)(bundle)
let initializedHome
const client = new AppServerClient({
  resolveBinary: () => path.join(resources, 'native/codex-replica-server'),
  resolveServerEndpoint: () => null,
  preferManagedDaemon: false,
  autoReconnect: false,
  spawnProcess: (command, args, options) => {
    const child = spawn(command, args, { ...options, env: {
      ...options.env,
      CODEX_HOME: path.join(config.profile, 'codex-home'),
      CODEX_REPLICA_SERVER_HOME: config.serverHome
    } })
    let buffered = ''
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop()
      for (const line of lines) {
        try {
          const response = JSON.parse(line)
          if (response.id === '__codex_initialize__') initializedHome = response.result?.codexHome
        } catch { /* The actual client reports malformed protocol lines. */ }
      }
    })
    return child
  }
})

try {
  const auth = await client.request('getAuthStatus', { includeToken: false, refreshToken: false })
  const models = await client.request('model/list', { limit: 1 })
  const threads = await client.request('thread/list', { limit: 1 })
  assert.equal(await fs.realpath(initializedHome), await fs.realpath(config.serverHome), 'Wrapper must route the server to its existing home')
  assert.equal(client.getStatus().state, 'ready')
  assert(Array.isArray(models.data))
  assert(Array.isArray(threads.data))
  console.log(JSON.stringify({
    app, passed: true, state: client.getStatus().state,
    methods: ['initialize', 'getAuthStatus', 'model/list', 'thread/list'],
    serverHomeRestored: true,
    desktopProfileIndependent: path.resolve(config.profile) !== path.resolve(config.serverHome),
    models: models.data.length,
    threads: threads.data.length,
    pendingServerRequests: client.getPendingServerRequests().length,
    authMethod: auth.authMethod ?? null
  }, null, 2))
} finally {
  await client.stop()
  await fs.rm(temporary, { recursive: true, force: true })
}

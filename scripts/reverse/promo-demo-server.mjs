#!/usr/bin/env node

import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { WebSocketServer } from 'ws'

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  process.stdout.write(`Usage: node scripts/reverse/promo-demo-server.mjs [options]\n\n` +
    `Starts a deterministic, privacy-safe app-server fixture for the live promo recording.\n\n` +
    `  --workspace <absolute path>  Demo workspace root\n` +
    `  --codex-home <absolute path> Independent demo Codex home\n` +
    `  --port <number>              WebSocket port (default: 9387)\n` +
    `  --help                       Show this help\n`)
  process.exit(0)
}

if (!options.workspace || !isAbsolute(options.workspace)) {
  throw new Error('--workspace must be an absolute path')
}
if (!options.codexHome || !isAbsolute(options.codexHome)) {
  throw new Error('--codex-home must be an absolute path')
}

const workspace = await realpath(options.workspace)
if (!(await stat(workspace)).isDirectory()) throw new Error('--workspace must identify a directory')
const codexHome = resolve(options.codexHome)
await mkdir(codexHome, { recursive: true })
const scheduledNotifications = new Set()
let liveTurnSequence = 0

const now = Math.floor(Date.now() / 1000)
const thread = {
  id: 'demo-orbit-launch',
  preview: 'Match the launch card to the reference.',
  name: 'Polish the Orbit Notes launch',
  cwd: workspace,
  model: 'gpt-6.1-sol',
  reasoningEffort: 'high',
  createdAt: now - 180,
  updatedAt: now - 30,
  recencyAt: now - 30,
  projectId: 'orbit-notes',
  status: { type: 'idle' },
  turns: []
}

const turns = [{
  id: 'demo-turn-1',
  status: 'completed',
  startedAt: now - 80,
  completedAt: now - 32,
  durationMs: 48_000,
  items: [
    {
      type: 'userMessage',
      id: 'demo-user-1',
      content: [{
        type: 'text',
        text: 'Match the launch card to the reference, down to spacing, radius, and type.',
        text_elements: []
      }]
    },
    {
      type: 'commandExecution',
      id: 'demo-command-1',
      command: "sed -n '1,220p' src/App.tsx",
      commandActions: [{
        type: 'read',
        command: "sed -n '1,220p' src/App.tsx",
        name: 'App.tsx',
        path: 'src/App.tsx'
      }],
      status: 'completed',
      aggregatedOutput: 'Reviewed the launch card structure and visual hierarchy.',
      exitCode: 0,
      durationMs: 210
    },
    {
      type: 'fileChange',
      id: 'demo-change-1',
      status: 'completed',
      changes: [{
        path: 'src/App.tsx',
        kind: { type: 'update', move_path: null },
        diff: [
          '@@ -10,3 +10,4 @@ export function App() {',
          '   return (',
          '-    <main className="launch-card">',
          '+    <main className="launch-card" aria-label="Orbit Notes launch">',
          '+      <span className="status">Ready to launch</span>',
          '       <p className="eyebrow">ORBIT NOTES</p>'
        ].join('\n')
      }, {
        path: 'src/styles.css',
        kind: { type: 'update', move_path: null },
        diff: [
          '@@ -11,6 +11,6 @@ body {',
          ' .launch-card {',
          '-  max-width: 680px;',
          '+  max-width: 720px;',
          '   margin: 12vh auto;',
          '   padding: 64px;',
          '   border: 1px solid rgb(255 255 255 / 10%);',
          '   border-radius: 32px;'
        ].join('\n')
      }]
    },
    {
      type: 'agentMessage',
      id: 'demo-agent-1',
      phase: 'final_answer',
      text: 'Updated the launch card: added an accessible label, a launch status, and a wider layout. Review the two changed files in the workspace.'
    }
  ]
}]

const project = {
  id: 'orbit-notes',
  name: 'Orbit Notes',
  roots: [{ path: workspace }],
  metadata: {},
  position: 0,
  createdAt: now - 600,
  updatedAt: now - 30,
  recencyAt: now - 30
}

const model = {
  id: 'gpt-6.1-sol',
  model: 'gpt-6.1-sol',
  displayName: 'GPT-6.1 Sol',
  description: 'Codex demo model',
  isDefault: true,
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [
    { reasoningEffort: 'medium', description: 'Balanced' },
    { reasoningEffort: 'high', description: 'Deep reasoning' }
  ]
}

const liveChanges = [{
  path: 'src/App.tsx',
  kind: { type: 'update', move_path: null },
  diff: [
    '@@ -10,3 +10,4 @@ export function App() {',
    '   return (',
    '-    <main className="launch-card">',
    '+    <main className="launch-card" aria-label="Orbit Notes launch">',
    '+      <span className="status">Ready to launch</span>',
    '       <p className="eyebrow">ORBIT NOTES</p>'
  ].join('\n')
}, {
  path: 'src/styles.css',
  kind: { type: 'update', move_path: null },
  diff: [
    '@@ -11,6 +11,6 @@ body {',
    ' .launch-card {',
    '-  max-width: 680px;',
    '+  max-width: 720px;',
    '   margin: 12vh auto;',
          '   padding: 64px;',
          '   border: 1px solid rgb(255 255 255 / 10%);',
    '   border-radius: 32px;'
  ].join('\n')
}]

function broadcast(method, params) {
  const payload = JSON.stringify({ method, params })
  for (const client of server.clients) {
    if (client.readyState === 1) client.send(payload)
  }
}

function schedule(delay, task) {
  const timer = setTimeout(() => {
    scheduledNotifications.delete(timer)
    task()
  }, delay)
  scheduledNotifications.add(timer)
}

function replaceTurn(nextTurn) {
  const index = turns.findIndex((candidate) => candidate.id === nextTurn.id)
  if (index === -1) turns.push(nextTurn)
  else turns[index] = nextTurn
}

function demoTurnInput(params) {
  if (!Array.isArray(params.input)) return [{
    type: 'text',
    text: 'Refine the launch card and verify the result.',
    text_elements: []
  }]
  return params.input.map((input) => {
    if (!input || typeof input !== 'object' || input.type !== 'text') return input
    return {
      ...input,
      text_elements: Array.isArray(input.text_elements) ? input.text_elements : []
    }
  })
}

function startDemoTurn(params) {
  if (params.threadId !== thread.id) throw new Error('Unknown demo thread')

  const sequence = ++liveTurnSequence
  const turnId = `demo-live-turn-${sequence}`
  const clientId = typeof params.clientUserMessageId === 'string'
    ? params.clientUserMessageId
    : `demo-live-client-${sequence}`
  const userMessage = {
    type: 'userMessage',
    id: `demo-live-user-${sequence}`,
    clientId,
    content: demoTurnInput(params)
  }
  const commentary = {
    type: 'agentMessage',
    id: `demo-live-commentary-${sequence}`,
    phase: 'commentary',
    text: 'I’ll inspect the current card, tune the layout, and verify the result.'
  }
  const command = {
    type: 'commandExecution',
    id: `demo-live-command-${sequence}`,
    command: "sed -n '1,220p' src/App.tsx && sed -n '1,220p' src/styles.css",
    commandActions: [{
      type: 'read',
      command: "sed -n '1,220p' src/App.tsx",
      name: 'App.tsx',
      path: 'src/App.tsx'
    }, {
      type: 'read',
      command: "sed -n '1,220p' src/styles.css",
      name: 'styles.css',
      path: 'src/styles.css'
    }],
    cwd: workspace,
    status: 'inProgress',
    aggregatedOutput: null,
    durationMs: null
  }
  const completedCommand = {
    ...command,
    status: 'completed',
    aggregatedOutput: 'Compared the component structure and visual tokens.\n',
    exitCode: 0,
    durationMs: 1_420
  }
  const fileChange = {
    type: 'fileChange',
    id: `demo-live-change-${sequence}`,
    status: 'inProgress',
    changes: []
  }
  const completedFileChange = {
    ...fileChange,
    status: 'completed',
    changes: liveChanges
  }
  const verifyCommand = {
    type: 'commandExecution',
    id: `demo-live-verify-${sequence}`,
    command: 'npm run check',
    commandActions: [{
      type: 'unknown',
      command: 'npm run check'
    }],
    cwd: workspace,
    status: 'inProgress',
    aggregatedOutput: null,
    durationMs: null
  }
  const completedVerifyCommand = {
    ...verifyCommand,
    status: 'completed',
    aggregatedOutput: 'Demo check passed. Updated spacing and launch status.\n',
    exitCode: 0,
    durationMs: 1_150
  }
  const finalMessage = {
    type: 'agentMessage',
    id: `demo-live-final-${sequence}`,
    phase: 'final_answer',
    text: 'Updated the launch card. Review the diff or keep editing in the workspace.'
  }
  const startedAt = Date.now() / 1_000
  const startedTurn = {
    id: turnId,
    status: 'inProgress',
    startedAt,
    completedAt: null,
    durationMs: null,
    items: [userMessage]
  }

  replaceTurn(startedTurn)
  thread.status = { type: 'active', activeFlags: [] }

  schedule(100, () => {
    broadcast('turn/started', { threadId: thread.id, turn: startedTurn })
    broadcast('thread/status/changed', { threadId: thread.id, status: thread.status })
  })
  schedule(350, () => broadcast('item/started', {
    threadId: thread.id,
    turnId,
    item: { ...commentary, text: '' }
  }))
  schedule(500, () => broadcast('item/agentMessage/delta', {
    threadId: thread.id,
    turnId,
    itemId: commentary.id,
    delta: commentary.text
  }))
  schedule(1_050, () => broadcast('item/completed', {
    threadId: thread.id,
    turnId,
    item: commentary
  }))
  schedule(1_200, () => broadcast('item/started', {
    threadId: thread.id,
    turnId,
    item: command
  }))
  schedule(1_550, () => broadcast('item/commandExecution/outputDelta', {
    threadId: thread.id,
    turnId,
    itemId: command.id,
    delta: 'Reading the launch card and theme tokens…\n'
  }))
  schedule(2_450, () => broadcast('item/commandExecution/outputDelta', {
    threadId: thread.id,
    turnId,
    itemId: command.id,
    delta: 'Comparing spacing, radius, and typography…\n'
  }))
  schedule(3_350, () => broadcast('item/commandExecution/outputDelta', {
    threadId: thread.id,
    turnId,
    itemId: command.id,
    delta: 'Measuring the card against the reference geometry…\n'
  }))
  schedule(4_100, () => broadcast('item/completed', {
    threadId: thread.id,
    turnId,
    item: completedCommand
  }))
  schedule(4_300, () => broadcast('item/started', {
    threadId: thread.id,
    turnId,
    item: fileChange
  }))
  schedule(4_650, () => broadcast('item/fileChange/patchUpdated', {
    threadId: thread.id,
    turnId,
    itemId: fileChange.id,
    changes: liveChanges.slice(0, 1)
  }))
  schedule(5_350, () => broadcast('item/fileChange/patchUpdated', {
    threadId: thread.id,
    turnId,
    itemId: fileChange.id,
    changes: liveChanges
  }))
  schedule(6_000, () => broadcast('item/completed', {
    threadId: thread.id,
    turnId,
    item: completedFileChange
  }))
  schedule(6_200, () => broadcast('item/started', {
    threadId: thread.id,
    turnId,
    item: verifyCommand
  }))
  schedule(6_500, () => broadcast('item/commandExecution/outputDelta', {
    threadId: thread.id,
    turnId,
    itemId: verifyCommand.id,
    delta: 'Checking layout constraints…\n'
  }))
  schedule(7_000, () => broadcast('item/commandExecution/outputDelta', {
    threadId: thread.id,
    turnId,
    itemId: verifyCommand.id,
    delta: 'Confirming spacing, radius, and typography…\n'
  }))
  schedule(7_350, () => broadcast('item/completed', {
    threadId: thread.id,
    turnId,
    item: completedVerifyCommand
  }))
  schedule(7_550, () => broadcast('item/started', {
    threadId: thread.id,
    turnId,
    item: { ...finalMessage, text: '' }
  }))
  schedule(7_700, () => broadcast('item/agentMessage/delta', {
    threadId: thread.id,
    turnId,
    itemId: finalMessage.id,
    delta: 'Updated the launch card. '
  }))
  schedule(7_900, () => broadcast('item/agentMessage/delta', {
    threadId: thread.id,
    turnId,
    itemId: finalMessage.id,
    delta: 'Review the diff or keep editing in the workspace.'
  }))
  schedule(8_100, () => broadcast('item/completed', {
    threadId: thread.id,
    turnId,
    item: finalMessage
  }))
  schedule(8_300, () => {
    const completedAt = Date.now() / 1_000
    const completedTurn = {
      ...startedTurn,
      status: 'completed',
      completedAt,
      durationMs: Math.round((completedAt - startedAt) * 1_000),
      items: [
        userMessage,
        commentary,
        completedCommand,
        completedFileChange,
        completedVerifyCommand,
        finalMessage
      ]
    }
    replaceTurn(completedTurn)
    thread.status = { type: 'idle' }
    thread.updatedAt = Math.floor(completedAt)
    thread.recencyAt = Math.floor(completedAt)
    broadcast('turn/completed', { threadId: thread.id, turn: completedTurn })
    broadcast('thread/status/changed', { threadId: thread.id, status: thread.status })
  })

  return { turn: startedTurn }
}

function pathInsideWorkspace(path) {
  const relativePath = relative(workspace, path)
  return relativePath === '' || (
    !isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('../')
  )
}

async function safeWorkspacePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid demo filesystem path')
  const path = await realpath(value)
  if (!pathInsideWorkspace(path)) throw new Error('Demo filesystem path leaves the workspace')
  return path
}

async function resultFor(method, params = {}) {
  if (method === 'initialize') {
    return {
      userAgent: 'codex-replica-promo',
      codexHome,
      platformFamily: 'unix',
      platformOs: 'macos'
    }
  }
  if (method === 'getAuthStatus') return { authMethod: 'chatgpt' }
  if (method === 'thread/list') return { data: [thread], nextCursor: null }
  if (method === 'project/list') return { data: [project], nextCursor: null }
  if (method === 'model/list') return { data: [model], nextCursor: null }
  if (method === 'permissionProfile/list') {
    return {
      data: [
        { id: 'workspace-write', description: 'Read and edit files in the workspace', allowed: true }
      ]
    }
  }
  if (method === 'thread/resume') {
    return {
      thread,
      model: model.model,
      cwd: workspace,
      reasoningEffort: 'high',
      activePermissionProfile: { id: 'workspace-write' },
      approvalsReviewer: 'user'
    }
  }
  if (method === 'thread/turns/list') return { data: turns, nextCursor: null }
  if (method === 'thread/read') return { thread: { ...thread, turns } }
  if (method === 'thread/goal/get') return { goal: null }
  if (method === 'thread/backgroundTerminals/list') return { data: [], nextCursor: null }
  if (method === 'turn/start') return startDemoTurn(params)
  if (method === 'fs/readDirectory') {
    const path = await safeWorkspacePath(params.path)
    if (!(await stat(path)).isDirectory()) throw new Error('Demo path is not a directory')
    const entries = await readdir(path, { withFileTypes: true })
    return {
      entries: entries.map((entry) => ({
        fileName: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }))
    }
  }
  if (method === 'fs/readFile') {
    const path = await safeWorkspacePath(params.path)
    if (!(await stat(path)).isFile()) throw new Error('Demo path is not a file')
    return { dataBase64: (await readFile(path)).toString('base64') }
  }
  if (method === 'fs/getMetadata') {
    const path = await safeWorkspacePath(params.path)
    const metadata = await stat(path)
    return {
      isDirectory: metadata.isDirectory(),
      isFile: metadata.isFile(),
      isSymlink: false,
      createdAtMs: metadata.birthtimeMs,
      modifiedAtMs: metadata.mtimeMs
    }
  }
  return {}
}

const server = new WebSocketServer({ host: '127.0.0.1', port: options.port })
server.on('connection', (socket) => {
  socket.on('message', async (chunk) => {
    let message
    try {
      message = JSON.parse(String(chunk))
    } catch {
      return
    }
    if (message.id === undefined || typeof message.method !== 'string') return
    try {
      const result = await resultFor(message.method, message.params)
      socket.send(JSON.stringify({ id: message.id, result }))
    } catch (error) {
      socket.send(JSON.stringify({
        id: message.id,
        error: { code: -32_000, message: error instanceof Error ? error.message : String(error) }
      }))
    }
  })
})

server.on('listening', () => {
  process.stdout.write(`${JSON.stringify({
    ready: true,
    url: `ws://127.0.0.1:${options.port}`,
    workspace,
    thread: thread.name,
    codexHome
  })}\n`)
})

function shutdown() {
  for (const timer of scheduledNotifications) clearTimeout(timer)
  scheduledNotifications.clear()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function parseArguments(args) {
  const parsed = {
    port: 9387,
    workspace: process.env.CODEX_DEMO_WORKSPACE || null,
    codexHome: process.env.CODEX_HOME || null,
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
    else if (argument === '--workspace') parsed.workspace = next()
    else if (argument === '--codex-home') parsed.codexHome = next()
    else if (argument === '--port') {
      parsed.port = Number(next())
      if (!Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65_535) {
        throw new Error('--port must be an integer between 1024 and 65535')
      }
    } else throw new Error(`Unknown option: ${argument}`)
  }
  return parsed
}

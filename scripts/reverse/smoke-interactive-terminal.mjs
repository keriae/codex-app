import { build } from 'esbuild'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const installedBinary = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
const evidenceFile = join(repository, 'reverse/raw/checks/terminal/bridge-smoke.json')
const taskDirectory = await mkdtemp(join(tmpdir(), 'codex-replica-terminal-smoke-'))
const taskCodexDirectory = join(taskDirectory, 'codex')
const taskShellDirectory = join(taskDirectory, 'zsh')
const taskWorkspace = join(taskDirectory, 'workspace')
const started = Date.now()
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  binary: installedBinary,
  sourceHashes: {},
  isolation: { codexHome: '<temporary>/codex', zshDotDirectory: '<temporary>/zsh', cwd: '<temporary>/workspace', modelTurn: false },
  scenarios: [],
  cleanup: {},
  passed: false
}
let server
let terminalSessions
let serverChild
const allEvents = []
const completions = new Map()
const submissions = new Map()
const requestLog = []
const protocolErrors = []
const statuses = []
const observedDescendants = new Map()
let onSubmit = null
let canonicalTaskDirectory = taskDirectory

function clean(value) {
  return String(value).replaceAll(canonicalTaskDirectory, '<temporary>').replaceAll(taskDirectory, '<temporary>')
}
function delay(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds))
}
async function waitUntil(predicate, description, milliseconds = 8000) {
  const end = Date.now() + milliseconds
  while (Date.now() < end) {
    const result = predicate()
    if (result) return result
    await delay(15)
  }
  throw new Error(`Timed out waiting for ${description}`)
}
function output(id) {
  return allEvents.filter((event) => event.id === id && event.type === 'output').map((event) => event.data || '').join('')
}
async function processes() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,comm='])
  return stdout.trim().split('\n').map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    return match ? { pid: Number(match[1]), parent: Number(match[2]), command: match[3] } : null
  }).filter(Boolean)
}
async function descendants(pid) {
  const rows = await processes()
  const ids = new Set([pid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true }
  }
  return rows.filter((row) => row.pid !== pid && ids.has(row.pid))
}
async function run(name, action) {
  const scenario = { name, startedMs: Date.now() - started, passed: false }
  report.scenarios.push(scenario)
  try {
    Object.assign(scenario, await action())
    scenario.passed = true
  } catch (error) {
    scenario.error = clean(error instanceof Error ? error.message : error)
  }
  scenario.elapsedMs = Date.now() - started - scenario.startedMs
}

try {
  await Promise.all([mkdir(taskCodexDirectory), mkdir(taskShellDirectory), mkdir(taskWorkspace)])
  canonicalTaskDirectory = await realpath(taskDirectory)
  await writeFile(join(taskShellDirectory, '.zshrc'), "PROMPT='REA_SMOKE % '\nHISTFILE=''\n")
  await writeFile(join(taskShellDirectory, '.zprofile'), '')
  for (const name of ['src/main/appServer.ts', 'src/main/terminalSessions.ts', 'src/shared/api.ts']) {
    report.sourceHashes[name] = createHash('sha256').update(await readFile(join(repository, name))).digest('hex')
  }
  report.binarySha256 = createHash('sha256').update(await readFile(installedBinary)).digest('hex')
  report.scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')
  report.binaryVersion = (await execFileAsync(installedBinary, ['--version'])).stdout.trim()
  const bundle = join(taskDirectory, 'bridge.mjs')
  await build({
    stdin: {
      contents: `export { AppServerClient } from ${JSON.stringify(join(repository, 'src/main/appServer.ts'))};\nexport { TerminalSessions } from ${JSON.stringify(join(repository, 'src/main/terminalSessions.ts'))};`,
      resolveDir: repository,
      loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle,
    packages: 'external'
  })
  // The transient bundle resolves ws from the repository dependency tree.
  const { symlink } = await import('node:fs/promises')
  await symlink(join(repository, 'node_modules'), join(taskDirectory, 'node_modules'), 'dir')
  const { AppServerClient, TerminalSessions } = await import(pathToFileURL(bundle).href)
  server = new AppServerClient({
    resolveBinary: () => installedBinary,
    preferManagedDaemon: false,
    requestTimeoutMs: 8000,
    spawnProcess(command, args, options) {
      report.serverArguments = args
      serverChild = spawn(command, args, {
        ...options,
        cwd: taskWorkspace,
        env: { ...options.env, CODEX_HOME: taskCodexDirectory, ZDOTDIR: taskShellDirectory, TERM: 'xterm-256color' }
      })
      return serverChild
    }
  })
  server.on('status', (status) => statuses.push({ ...status, elapsedMs: Date.now() - started }))
  server.on('protocol-error', (error) => protocolErrors.push(clean(error.message)))
  server.on('server-request', (request) => {
    // No approval is automatically granted by this smoke test.
    protocolErrors.push(`Unexpected server request: ${request.method}`)
    void server.respond(request.id, { error: { code: -32000, message: 'No interactive approval in terminal smoke test' } })
  })
  const adapter = {
    on: (...args) => server.on(...args),
    off: (...args) => server.off(...args),
    async request(method, params) {
      const entry = { method, processId: params?.processId, elapsedMs: Date.now() - started }
      if (method === 'command/exec/resize') entry.size = params.size
      requestLog.push(entry)
      try { const result = await server.request(method, params); entry.passed = true; return result }
      catch (error) { entry.passed = false; entry.error = clean(error.message); throw error }
    },
    executeStandaloneCommand(params, options = {}) {
      const id = String(params.processId)
      const promise = server.executeStandaloneCommand(params, {
        ...options,
        onSubmitted() {
          submissions.set(id, Date.now() - started)
          options.onSubmitted?.()
          onSubmit?.(id)
        }
      })
      promise.then(
        (result) => completions.set(id, { result, elapsedMs: Date.now() - started }),
        (error) => completions.set(id, { error: clean(error.message), elapsedMs: Date.now() - started })
      )
      return promise
    }
  }
  terminalSessions = new TerminalSessions(adapter, (_owner, event) => allEvents.push(event))
  await server.start()
  report.initializedMs = Date.now() - started

  await run('unicode-read-stty-resize-and-exit', async () => {
    const { id } = terminalSessions.open(1, { cwd: taskWorkspace, cols: 80, rows: 24 })
    await waitUntil(() => output(id).length > 0, 'initial zsh prompt')
    await terminalSessions.write(1, id, "stty -echo; printf '\\nREA_PRINTF_BEGIN\\n你好🙂\\nREA_PRINTF_END\\n'; printf 'REA_SIZE_INITIAL='; stty size; printf 'REA_READ_READY\\n'; IFS= read -r rea_text; printf 'REA_READ_VALUE=%s\\n' \"$rea_text\"\r")
    await waitUntil(() => /\r?\nREA_READ_READY\r?\n/.test(output(id)), 'read prompt')
    await terminalSessions.write(1, id, '中文输入🙂\r')
    await waitUntil(() => output(id).includes('REA_READ_VALUE=中文输入🙂'), 'Unicode read value')
    await terminalSessions.resize(1, id, { cols: 103, rows: 37 })
    await terminalSessions.write(1, id, "printf 'REA_SIZE_RESIZED='; stty size; printf 'REA_CWD='; pwd; printf 'REA_SHELL_PID=%s\\n' \"$$\"; exit 7\r")
    const exit = await waitUntil(() => allEvents.find((event) => event.id === id && event.type === 'exit'), 'PTY exit')
    const text = output(id)
    if (!text.includes('REA_PRINTF_BEGIN\r\n你好🙂\r\nREA_PRINTF_END')) throw new Error('Unicode printf output mismatch')
    if (!text.includes('REA_SIZE_INITIAL=24 80')) throw new Error('Initial stty size mismatch')
    if (!text.includes('REA_SIZE_RESIZED=37 103')) throw new Error('Resized stty size mismatch')
    if (!text.includes(`REA_CWD=${await realpath(taskWorkspace)}`)) throw new Error('Terminal cwd mismatch')
    if (exit.exitCode !== 7) throw new Error(`Unexpected exit code ${exit.exitCode}`)
    const pid = Number(/REA_SHELL_PID=(\d+)/.exec(text)?.[1])
    if ((await processes()).some((row) => row.pid === pid)) throw new Error('Exited terminal shell is still running')
    return { processId: id, exitCode: exit.exitCode, openingSize: { rows: 24, cols: 80 }, resizedSize: { rows: 37, cols: 103 }, unicodePrintf: true, unicodeRead: true, cwdMatched: true, shellStopped: true, output: clean(text) }
  })

  await run('close-immediately-before-submission', async () => {
    const { id } = terminalSessions.open(2, { cwd: taskWorkspace, cols: 80, rows: 24 })
    await terminalSessions.close(2, id)
    const completion = await waitUntil(() => completions.get(id), 'canceled command completion')
    if (submissions.has(id)) throw new Error('Terminal command submitted despite synchronous close')
    return { processId: id, submitted: false, completion }
  })

  await run('close-on-submission-microtask', async () => {
    let closing
    onSubmit = (id) => { queueMicrotask(() => {
      closing = terminalSessions.close(3, id).then(() => ({ passed: true }), (error) => ({ passed: false, error }))
    }) }
    const { id } = terminalSessions.open(3, { cwd: taskWorkspace, cols: 80, rows: 24 })
    await waitUntil(() => closing, 'microtask close')
    const closed = await closing
    if (!closed.passed) throw closed.error
    await waitUntil(() => completions.get(id), 'terminated command completion')
    onSubmit = null
    return { processId: id, submitted: true, completion: completions.get(id) }
  })
  onSubmit = null

  await run('dispose-active-session-and-stop-owned-server', async () => {
    const { id } = terminalSessions.open(4, { cwd: taskWorkspace, cols: 80, rows: 24 })
    await waitUntil(() => output(id).length > 0, 'dispose zsh prompt')
    const before = await descendants(serverChild.pid)
    for (const row of before) observedDescendants.set(row.pid, row)
    await terminalSessions.dispose()
    await waitUntil(() => completions.get(id), 'dispose command completion')
    const remainingShells = (await descendants(serverChild.pid)).filter((row) => row.command.endsWith('/zsh') || row.command === 'zsh')
    if (remainingShells.length) throw new Error('Terminal shell remains after dispose')
    const listenersRemoved = server.listenerCount('notification') === 0 && server.listenerCount('status') === 1
    if (!listenersRemoved) throw new Error('Terminal bridge event listeners remain after dispose')
    return { processId: id, ownedDescendantsBefore: before.map((row) => ({ ...row, command: clean(row.command) })), terminalShellsRemaining: 0, completion: completions.get(id), listenersRemoved }
  })
  report.passed = report.scenarios.every((scenario) => scenario.passed) && protocolErrors.length === 0
} catch (error) {
  report.fatalError = clean(error instanceof Error ? error.stack : error)
} finally {
  onSubmit = null
  try { await terminalSessions?.dispose(); report.cleanup.terminalBridgeDisposed = true }
  catch (error) { report.cleanup.disposeError = clean(error.message) }
  if (serverChild?.pid) {
    for (const row of await descendants(serverChild.pid)) observedDescendants.set(row.pid, row)
  }
  try { await server?.stop(); report.cleanup.serverStopped = true }
  catch (error) { report.cleanup.stopError = clean(error.message) }
  if (serverChild?.pid) {
    const rows = await processes()
    report.cleanup.ownedServerRunning = rows.some((row) => row.pid === serverChild.pid)
    report.cleanup.serverExitCode = serverChild.exitCode
    report.cleanup.serverSignal = serverChild.signalCode
    const survivors = rows.filter((row) => observedDescendants.get(row.pid)?.command === row.command)
    report.cleanup.observedDescendantsStillRunning = survivors.map((row) => ({ ...row, command: clean(row.command) }))
    if (survivors.length) {
      report.cleanup.terminatedRemainingOwnedDescendants = survivors.map((row) => row.pid)
      for (const row of survivors) { try { process.kill(row.pid, 'SIGTERM') } catch {} }
      await delay(200)
      const remaining = (await processes()).filter((row) => survivors.some((owned) => owned.pid === row.pid && owned.command === row.command))
      for (const row of remaining) { try { process.kill(row.pid, 'SIGKILL') } catch {} }
      if (remaining.length) await delay(100)
      report.cleanup.observedDescendantsStillRunning = (await processes()).filter((row) => survivors.some((owned) => owned.pid === row.pid && owned.command === row.command)).map((row) => ({ ...row, command: clean(row.command) }))
    }
  }
  report.statuses = statuses
  report.protocolErrors = protocolErrors
  report.requests = requestLog
  report.finishedAt = new Date().toISOString()
  report.elapsedMs = Date.now() - started
  await rm(taskDirectory, { recursive: true, force: true })
  report.cleanup.temporaryDirectoryRemoved = true
  report.passed &&= report.cleanup.serverStopped === true && report.cleanup.ownedServerRunning === false && report.cleanup.observedDescendantsStillRunning?.length === 0
  await mkdir(dirname(evidenceFile), { recursive: true })
  await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ passed: report.passed, scenarios: report.scenarios.map(({ name, passed, error }) => ({ name, passed, error })), evidenceFile, cleanup: report.cleanup }, null, 2))
  if (!report.passed) process.exitCode = 1
}

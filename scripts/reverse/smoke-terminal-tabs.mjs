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
const evidenceFile = resolve(process.argv[2] || join(repository, 'reverse/raw/checks/terminal/tab-runtime-smoke.json'))
const taskDirectory = await mkdtemp(join(tmpdir(), 'codex-replica-terminal-tabs-smoke-'))
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
let terminalRegistry
const runtimeEvents = new Set()
const runtimeOpenCalls = []
const runtimeCloseCalls = []
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
  for (const name of ['src/main/appServer.ts', 'src/main/terminalSessions.ts', 'src/shared/api.ts', 'src/renderer/src/interactiveTerminalRuntime.ts', 'src/renderer/src/terminalTabs.ts', 'src/renderer/src/useTerminalTabsController.ts', 'src/renderer/src/InteractiveTerminalPanel.tsx']) {
    report.sourceHashes[name] = createHash('sha256').update(await readFile(join(repository, name))).digest('hex')
  }
  report.binarySha256 = createHash('sha256').update(await readFile(installedBinary)).digest('hex')
  report.scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')
  report.binaryVersion = (await execFileAsync(installedBinary, ['--version'])).stdout.trim()
  const bundle = join(taskDirectory, 'bridge.mjs')
  await build({
    stdin: {
      contents: `export { AppServerClient } from ${JSON.stringify(join(repository, 'src/main/appServer.ts'))};\nexport { TerminalSessions } from ${JSON.stringify(join(repository, 'src/main/terminalSessions.ts'))};\nexport { InteractiveTerminalRuntime } from ${JSON.stringify(join(repository, 'src/renderer/src/interactiveTerminalRuntime.ts'))};\nexport { TerminalTabsRegistry } from ${JSON.stringify(join(repository, 'src/renderer/src/terminalTabs.ts'))};`,
      resolveDir: repository,
      loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle,
    packages: 'external'
  })
  // The transient bundle resolves ws from the repository dependency tree.
  const { symlink } = await import('node:fs/promises')
  await symlink(join(repository, 'node_modules'), join(taskDirectory, 'node_modules'), 'dir')
  const { AppServerClient, TerminalSessions, InteractiveTerminalRuntime, TerminalTabsRegistry } = await import(pathToFileURL(bundle).href)
  server = new AppServerClient({
    resolveBinary: () => installedBinary,
    preferManagedDaemon: false,
    requestTimeoutMs: 8000,
    spawnProcess(command, args, options) {
      report.serverArguments = args
      serverChild = spawn(command, args, {
        ...options,
        cwd: taskWorkspace,
        env: { ...options.env, CODEX_HOME: taskCodexDirectory, ZDOTDIR: taskShellDirectory,
          TERM: 'dumb', TERMINFO: '/nonexistent/rea-terminal-test', TERMINFO_DIRS: '/nonexistent/rea-terminal-test' }
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
  terminalSessions = new TerminalSessions(adapter, (_owner, event) => { allEvents.push(event); for (const listener of runtimeEvents) listener(event) })
  await server.start()
  report.initializedMs = Date.now() - started

  await run('terminal-environment-overrides', async () => {
    const { id } = terminalSessions.open(1, { cwd: taskWorkspace, cols: 80, rows: 24 })
    await waitUntil(() => output(id).length > 0, 'environment zsh prompt')
    await terminalSessions.write(1, id, "printf '\\nREA_TERM=%s\\nREA_TERMINFO=%s\\nREA_TERMINFO_DIRS=%s\\n' \"$TERM\" \"${TERMINFO-unset}\" \"${TERMINFO_DIRS-unset}\"; exit\\r".replace(/\\r$/, '\r'))
    await waitUntil(() => completions.has(id), 'environment command exit')
    const text = output(id)
    if (!/\r?\nREA_TERM=xterm-256color\r?\n/.test(text) ||
      !/\r?\nREA_TERMINFO=unset\r?\n/.test(text) || !/\r?\nREA_TERMINFO_DIRS=unset\r?\n/.test(text)) {
      throw new Error('Terminal environment overrides were not applied by the installed CLI')
    }
    return { inheritedTerm: 'dumb', term: 'xterm-256color', terminfoUnset: true, terminfoDirectoriesUnset: true,
      modelTurn: false, exitCode: completions.get(id).result?.exitCode }
  })

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


  // Renderer lifecycle classes use injected xterm/DOM objects. Their bridge is
  // the real TerminalSessions transport running the installed native CLI.
  class FakeElement {
    parentElement = null
    remove() { this.parentElement = null }
  }
  class FakeHost {
    clientWidth = 500
    clientHeight = 280
    isConnected = true
    appendChild(element) { element.parentElement = this }
  }
  class FakeTerminal {
    cols = 80
    rows = 24
    written = []
    constructor(options) { this.options = options }
    loadAddon() {}
    open(host) { this.element = new FakeElement(); host.appendChild(this.element) }
    write(data) { this.written.push(data) }
    focus() {}
    dispose() { this.element?.remove() }
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} } }
    onResize() { return { dispose() {} } }
    onTitleChange() { return { dispose() {} } }
  }
  let nextTab = 0
  let earlyExitNext = false
  terminalRegistry = new TerminalTabsRegistry(() => `native-tab-${++nextTab}`)
  const runtimeBridge = {
    async openTerminal(params) {
      const early = earlyExitNext
      earlyExitNext = false
      const opened = terminalSessions.open(100, params)
      const entry = { id: opened.id, earlyExit: early, openedMs: Date.now() - started }
      runtimeOpenCalls.push(entry)
      await waitUntil(() => output(opened.id).length > 0, 'runtime native zsh prompt')
      if (early) {
        await terminalSessions.write(100, opened.id, 'exit 0\r')
        const event = await waitUntil(() => allEvents.find((event) => event.id === opened.id && event.type === 'exit'), 'native exit before renderer open resolves')
        entry.exitBeforeResolve = true
        entry.exitCode = event.exitCode
      }
      entry.resolvedMs = Date.now() - started
      return opened
    },
    writeTerminal: (id, data) => terminalSessions.write(100, id, data),
    resizeTerminal: (id, size) => terminalSessions.resize(100, id, size),
    async closeTerminal(id) {
      const entry = { id, startedMs: Date.now() - started }
      runtimeCloseCalls.push(entry)
      try { await terminalSessions.close(100, id) }
      catch (error) { entry.error = clean(error.message); throw error }
      finally { entry.closedMs = Date.now() - started }
    },
    onTerminalEvent(listener) { runtimeEvents.add(listener); return () => runtimeEvents.delete(listener) }
  }
  const runtimeDependencies = {
    getBridge: () => runtimeBridge, loadTerminal: async () => FakeTerminal,
    loadFit: async () => class { fit() {} }, readTheme: () => ({}), installMouseZoom: () => () => {},
    frame: (callback) => setTimeout(() => callback(Date.now()), 0), cancelFrame: (id) => clearTimeout(id),
    observeHost: () => () => {}, observeTheme: () => () => {}
  }
  const makeRuntime = (tab) => new InteractiveTerminalRuntime({ cwd: tab.cwd }, runtimeDependencies)
  let survivingRuntime
  let survivingProcessId
  let survivingShellPid
  await run('native-scoped-runtime-hide-move-return-and-normal-exit', async () => {
    const first = terminalRegistry.get('chat-a')
    const second = terminalRegistry.get('chat-b')
    const firstTab = first.create('bottom', taskWorkspace)
    const secondTab = second.create('right', taskWorkspace)
    const firstRuntime = first.acquireRuntime(firstTab, makeRuntime)
    const secondRuntime = second.acquireRuntime(secondTab, makeRuntime)
    const originalHost = new FakeHost()
    firstRuntime.attach(originalHost)
    secondRuntime.attach(new FakeHost())
    await waitUntil(() => firstRuntime.getSnapshot().state === 'running' && secondRuntime.getSnapshot().state === 'running', 'both native renderer sessions')
    const firstId = firstRuntime.getSnapshot().sessionId
    const secondId = secondRuntime.getSnapshot().sessionId
    await firstRuntime.write("stty -echo; REA_TAB_VALUE='保留🙂'; printf '\\nREA_SCOPE_A=%s\\n' \"$REA_TAB_VALUE\"; printf 'REA_PID_A=%s\\n' \"$$\"\r")
    await secondRuntime.write("stty -echo; printf '\\nREA_SCOPE_B=独立\\n'; printf 'REA_PID_B=%s\\n' \"$$\"\r")
    await waitUntil(() => /REA_PID_A=\d+/.test(output(firstId)) && /REA_PID_B=\d+/.test(output(secondId)), 'independent native shell identities')
    const pidA = Number(/REA_PID_A=(\d+)/.exec(output(firstId))[1])
    const pidB = Number(/REA_PID_B=(\d+)/.exec(output(secondId))[1])
    if (pidA === pidB) throw new Error('Two runtimes share one shell')
    const node = firstRuntime.terminal.element
    first.hide('bottom')
    firstRuntime.detach(originalHost)
    terminalRegistry.get('chat-b')
    await firstRuntime.write("printf 'REA_HIDDEN=%s\\n' \"$REA_TAB_VALUE\"\r")
    await waitUntil(() => firstRuntime.terminal.written.join('').includes('REA_HIDDEN=保留🙂'), 'native output consumed by detached renderer')
    if (terminalRegistry.get('chat-a') !== first) throw new Error('Returning to chat recreated controller')
    first.move(firstTab, 'right')
    const nextHost = new FakeHost()
    firstRuntime.attach(nextHost)
    if (firstRuntime.terminal.element !== node || node.parentElement !== nextHost) throw new Error('Moving recreated the xterm node')
    if (first.acquireRuntime(firstTab, () => { throw new Error('Runtime recreated') }) !== firstRuntime) throw new Error('Moving recreated runtime')
    await firstRuntime.write("printf 'REA_RESTORED=%s\\n' \"$REA_TAB_VALUE\"; printf 'REA_PID_RESTORED=%s\\n' \"$$\"\r")
    await waitUntil(() => output(firstId).includes(`REA_PID_RESTORED=${pidA}`), 'same native shell after hide/move/return')
    if (!output(firstId).includes('REA_RESTORED=保留🙂')) throw new Error('Shell variable was not retained')
    if (secondRuntime.terminal.written.join('').includes('REA_HIDDEN=')) throw new Error('Output leaked to other chat')
    await secondRuntime.write('exit 7\r')
    await waitUntil(() => second.getSnapshot().tabs.length === 0 && runtimeCloseCalls.some((call) => call.id === secondId && call.closedMs != null), 'local normal exit removes tab and finishes cleanup')
    if ((await processes()).some((row) => row.pid === pidB)) throw new Error('Normally exited runtime shell remains alive')
    survivingRuntime = firstRuntime
    survivingProcessId = firstId
    survivingShellPid = pidA
    return { firstProcessId: firstId, secondProcessId: secondId, distinctShells: true, shellStateRetained: true, sameNodeRetained: true, hiddenOutputConsumed: true, normalExitRemovedTab: true, normalExitCode: 7, runtimeOpenCount: runtimeOpenCalls.length }
  })
  await run('native-early-exit-replays-and-releases-cross-scope-reservation', async () => {
    const fast = terminalRegistry.get('fast-exit')
    const placeholders = terminalRegistry.get('reserved-other-chat')
    earlyExitNext = true
    const tab = fast.create('bottom', taskWorkspace)
    const runtime = fast.acquireRuntime(tab, makeRuntime)
    for (let index = 0; index < 6; index++) placeholders.create('right', taskWorkspace)
    runtime.attach(new FakeHost())
    let capped = false
    try { placeholders.create('right', taskWorkspace) } catch (error) { capped = /Maximum number/.test(error.message) }
    if (!capped) throw new Error('Eight reservation budget did not apply across scopes')
    await waitUntil(() => fast.getSnapshot().tabs.length === 0 && placeholders.getSnapshot().canCreate, 'early local exit releases reservation')
    const early = runtimeOpenCalls.find((call) => call.earlyExit)
    if (!early?.exitBeforeResolve || early.exitCode !== 0) throw new Error('Native early-exit ordering was not exercised')
    placeholders.create('right', taskWorkspace)
    if (placeholders.getSnapshot().canCreate) throw new Error('Reused final reservation did not exhaust budget')
    if (survivingRuntime.getSnapshot().sessionId !== survivingProcessId) throw new Error('Unrelated surviving runtime was replaced')
    await terminalRegistry.dispose()
    if (runtimeEvents.size !== 0) throw new Error('Runtime event subscribers remain after root disposal')
    await waitUntil(() => completions.has(survivingProcessId), 'root-disposed native shell completion')
    if ((await processes()).some((row) => row.pid === survivingShellPid)) throw new Error('Root-disposed native shell remains alive')
    return { earlyProcessId: early.id, exitBeforeOpenResolved: true, exitCode: early.exitCode, crossScopeReservationCap: 8, reservationReusableAfterCleanup: true, rootDisposedEveryRuntime: true, runtimeSubscribersRemaining: runtimeEvents.size }
  })
  report.runtimeOpenCalls = runtimeOpenCalls
  report.runtimeCloseCalls = runtimeCloseCalls
  report.renderer = { classes: ['TerminalTabsRegistry', 'TerminalTabsController', 'InteractiveTerminalRuntime'], xtermAndDOM: 'injected test objects', bridge: 'real TerminalSessions and installed CLI' }

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
  try { await terminalRegistry?.dispose() } catch (error) { report.cleanup.registryError = clean(error.message) }
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

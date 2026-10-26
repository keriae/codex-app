#!/usr/bin/env node
/**
 * Reconstruct the locally installed macOS Codex runtime from its shipped
 * artifacts. This is deliberately not a clean-room renderer implementation.
 * The installed app and its profile are never modified. Output is local-only.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const execFileAsync = promisify(execFile)
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKER = 'codex-replica-local-runtime-v1'
const REVIEWED_SIGNED_UNPACKED_PATHS = new Set([
  'node_modules/@worklouder/device-kit-oai/node_modules/@worklouder/wl-device-kit/dist/native/darwin/permissions.node',
  'node_modules/@worklouder/device-kit-oai/node_modules/@worklouder/wl-device-kit/node_modules/node-hid/prebuilds/HID-darwin-arm64/node-napi-v4.node',
  'node_modules/@worklouder/device-kit-oai/node_modules/@worklouder/wl-device-kit/node_modules/serialport/node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/node.napi.node',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/node-pty/build/Release/pty.node',
  'node_modules/node-pty/build/Release/spawn-helper',
  'node_modules/objc-js/prebuilds/darwin-arm64/node.napi.armv8.node'
])
// These run as independent processes (or inside the original signed child
// runtime). Re-signing them destroys the identity checked by the unchanged
// native pipe authorizer. Keep their complete, unmodified shipped trees.
const PRESERVED_SIGNED_HELPER_ROOTS = [
  'Contents/Resources/codex-cli',
  'Contents/Resources/cua_node',
  'Contents/Resources/plugins',
  'Contents/Resources/rg',
  'Contents/Resources/tectonic',
  'Contents/Resources/native/bare-modifier-monitor',
  'Contents/Resources/native/launch-services-helper',
  'Contents/Resources/native/system-audio-spectrum'
]

function preservesSourceHelper(relative) {
  return PRESERVED_SIGNED_HELPER_ROOTS.some(root => relative === root || relative.startsWith(`${root}/`))
}

function help() {
  console.log(`Usage: node scripts/reverse/reconstruct-local.mjs [options]

  --source PATH         Installed .app (default: /Applications/ChatGPT.app)
  --output PATH         New .app; existing paths are never overwritten
  --profile PATH        Independent desktop profile and desktop CODEX_HOME
  --server-home PATH    Existing server CODEX_HOME (default: current CODEX_HOME)
  --server-binary PATH  Existing Codex CLI (default: source app's companion CLI)
  --help                Show this help

The build preserves the installed renderer and native runtime, adds profile
isolation, restores the normal server home through a CLI wrapper, updates ASAR
integrity metadata, and signs the output locally with an ad-hoc identity.
It does not launch the app, copy credentials, or configure REA/MCP globally.`)
}

function parseArgs(args) {
  const result = {}
  const allowed = new Set(['source', 'output', 'profile', 'server-home', 'server-binary'])
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      help()
      process.exit(0)
    }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[i])
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown option: ${args[i]}`)
    const value = match[2] ?? args[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${match[1]}`)
    result[match[1]] = value
  }
  return result
}

function log(message) {
  console.log(`[local reconstruction] ${message}`)
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024, ...options })
  return result.stdout.trim()
}

function within(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function canonicalTarget(input) {
  let cursor = path.resolve(input)
  const suffix = []
  while (!fs.existsSync(cursor)) {
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Dangling path alias: ${cursor}`)
    const parent = path.dirname(cursor)
    if (parent === cursor) throw new Error(`Cannot resolve path: ${input}`)
    suffix.unshift(path.basename(cursor))
    cursor = parent
  }
  return path.join(await fsp.realpath(cursor), ...suffix)
}

async function validateIsolatedTreeAliases(root, forbiddenRoots) {
  if (!fs.existsSync(root)) return
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const singleton = dir === root && /^Singleton(Cookie|Lock|Socket)$/.test(entry.name)
        const target = await canonicalTarget(path.resolve(dir, await fsp.readlink(filename)))
        if (forbiddenRoots.some(forbidden => within(forbidden, target) || within(target, forbidden))) throw new Error(`Profile child aliases a protected path: ${filename}`)
        // Chromium owns these process-lock links and can point its socket at
        // an OS temporary directory. Every data/cache link stays in the profile.
        if (!within(root, target) && !singleton) throw new Error(`Profile child aliases outside its independent root: ${filename}`)
      } else if (entry.isDirectory()) await walk(filename)
    }
  }
  await walk(root)
}

// This function is embedded verbatim ahead of the original CJS entrypoint.
// It uses only the runtime's supported environment and Electron path controls.
function __codexReplicaApplyEnvironment() {
  const fs = require('node:fs')
  const path = require('node:path')
  const electron = require('electron')
  const config = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'codex-replica-runtime.json'), 'utf8'))
  const canonical = input => {
    let cursor = path.resolve(input)
    const suffix = []
    while (!fs.existsSync(cursor)) {
      if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Dangling profile alias: ${cursor}`)
      const parent = path.dirname(cursor)
      if (parent === cursor) throw new Error('Cannot resolve independent profile')
      suffix.unshift(path.basename(cursor))
      cursor = parent
    }
    return path.join(fs.realpathSync(cursor), ...suffix)
  }
  const contains = (parent, child) => {
    const relative = path.relative(parent, child)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  }
  const profile = canonical(process.env.CODEX_REPLICA_PROFILE_PATH || config.profile)
  const serverHome = canonical(process.env.CODEX_REPLICA_SERVER_HOME || config.serverHome)
  const nativeProfile = canonical(config.nativeProfile)
  const forbidden = [serverHome, config.originalProfile, config.sourceApp, path.join(process.resourcesPath, '../..')].map(canonical)
  if ([profile, nativeProfile].some(candidate => forbidden.some(root => contains(root, candidate) || contains(candidate, root)))) throw new Error('Replica profile overlaps the installed app, original profile, or server home')
  for (const name of ['Default', 'Default/Partitions', 'Crashpad', 'BrowserMetrics', 'GPUCache', 'GraphiteDawnCache']) if (!contains(nativeProfile, canonical(path.join(nativeProfile, name)))) throw new Error('Replica native profile child follows a symlink outside its independent profile')
  const children = Object.fromEntries(['codex-home', 'logs', 'session', 'crash-dumps'].map(name => [name, canonical(path.join(profile, name))]))
  if (Object.values(children).some(child => !contains(profile, child))) throw new Error('Replica profile child follows a symlink outside the independent profile')
  for (const dir of [profile, ...Object.values(children)]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  // The shipped unified renderer defaults a new desktop profile to ChatGPT
  // welcome/chat. Seed only its supported local atoms so this Codex study copy
  // opens Work. Do not submit hosted onboarding or overwrite existing choices.
  if (config.startupMode === 'work') {
    const statePath = path.join(children['codex-home'], '.codex-global-state.json')
    const stateStat = fs.lstatSync(statePath, { throwIfNoEntry: false })
    if (stateStat && !stateStat.isFile()) throw new Error('Replica global state must be a regular file inside its independent profile')
    const state = stateStat ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    if (!isRecord(state) || (state['electron-persisted-atom-state'] !== undefined && !isRecord(state['electron-persisted-atom-state']))) throw new Error('Replica global state has an invalid persisted atom record')
    const atoms = state['electron-persisted-atom-state'] ?? {}
    const defaults = {
      'electron:onboarding-projectless-completed': true,
      'electron:onboarding-welcome-pending': false,
      'electron:onboarding-override': 'auto',
      'electron:onboarding-welcome-v2-role-state': { roles: ['default'], personalizedSuggestionsEnabled: false, workMode: 'coding' },
      'home-composer-mode-v1': 'work'
    }
    let changed = false
    for (const [key, value] of Object.entries(defaults)) if (!Object.hasOwn(atoms, key)) {
      atoms[key] = value
      changed = true
    }
    if (changed) {
      state['electron-persisted-atom-state'] = atoms
      const temporaryState = `${statePath}.replica-startup-defaults`
      fs.writeFileSync(temporaryState, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 })
      try { fs.renameSync(temporaryState, statePath) } finally {
        if (fs.existsSync(temporaryState)) fs.unlinkSync(temporaryState)
      }
    }
  }
  process.env.CODEX_REPLICA_PROFILE_PATH = profile
  process.env.CODEX_ELECTRON_USER_DATA_PATH = profile
  process.env.CODEX_HOME = children['codex-home']
  process.env.CODEX_REPLICA_SERVER_HOME = serverHome
  process.env.CODEX_CLI_PATH = path.join(process.resourcesPath, 'native', 'codex-replica-server')
  process.env.CODEX_SPARKLE_ENABLED = 'false'
  process.env.CODEX_REPLICA_LOGS_DIR = children.logs
  electron.app.setPath('userData', profile)
  electron.app.setPath('sessionData', children.session)
  electron.app.setPath('crashDumps', children['crash-dumps'])
  electron.app.setAppLogsPath(children.logs)
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function fileHash(filename) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

function archiveEntries(header) {
  const result = []
  function walk(node, prefix = '') {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const filename = prefix ? `${prefix}/${name}` : name
      if (filename.split('/').some(part => part === '..' || part === '')) throw new Error(`Unsafe ASAR path: ${filename}`)
      result.push({ path: filename, ...value })
      if (value.files) walk(value, filename)
    }
  }
  walk(header)
  return result
}

async function diskInventory(root) {
  const entries = []
  async function walk(dir, prefix = '') {
    for (const entry of (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const filename = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(filename, relative)
      else if (entry.isSymbolicLink()) entries.push({ path: relative, type: 'link', target: await fsp.readlink(filename) })
      else if (entry.isFile()) {
        const handle = await fsp.open(filename, 'r')
        const magic = Buffer.alloc(4)
        await handle.read(magic, 0, 4, 0)
        await handle.close()
        const macho = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']).has(magic.toString('hex'))
        entries.push({ path: relative, type: 'file', bytes: (await fsp.stat(filename)).size, sha256: await fileHash(filename), macho })
      } else throw new Error(`Unsupported file type: ${relative}`)
    }
  }
  await walk(root)
  return entries
}

function replaceExactly(source, search, replacement, label) {
  if (source.split(search).length !== 2) throw new Error(`Installed ${label} changed; expected exactly one reviewed patch anchor`)
  return source.replace(search, replacement)
}

function replaceRegexExactly(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) throw new Error(`Installed ${label} changed; expected exactly one reviewed patch anchor`)
  return source.replace(pattern, replacement)
}

function exactlyOnePath(entries, pattern, label) {
  const matches = entries.filter(entry => !entry.files && !entry.link && pattern.test(entry.path))
  if (matches.length !== 1) throw new Error(`Installed ${label} changed; expected exactly one matching artifact`)
  return matches[0].path
}

async function readPlist(filename) {
  return JSON.parse(await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', filename]))
}

async function writePlist(filename, value) {
  const temporary = `${filename}.replica-json`
  await fsp.writeFile(temporary, JSON.stringify(value))
  await run('/usr/bin/plutil', ['-convert', 'xml1', '-o', filename, temporary])
  await fsp.unlink(temporary)
}

async function findFrameworkBinary(app) {
  const frameworkRoot = path.join(app, 'Contents/Frameworks')
  for (const dir of await fsp.readdir(frameworkRoot)) {
    if (!dir.endsWith(' Framework.framework')) continue
    const candidate = path.join(frameworkRoot, dir, dir.slice(0, -'.framework'.length))
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('Cannot find the installed Electron/Owl framework binary')
}

async function readCurrentFuses(binary) {
  // @electron/fuses assumes every .app has "Electron Framework.framework".
  // This installed Owl runtime calls it "Codex Framework.framework", so read
  // the same published fuse wire format from the selected framework directly.
  const bytes = await fsp.readFile(binary)
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
  const wires = []
  let offset = 0
  for (;;) {
    const found = bytes.indexOf(sentinel, offset)
    if (found < 0) break
    const start = found + sentinel.length
    const version = bytes[start]
    const length = bytes[start + 1]
    if (version !== 1 || length < 8 || length > 32 || start + 2 + length > bytes.length) throw new Error('Unsupported Electron fuse wire')
    const wire = { version: String(version) }
    for (let i = 0; i < length; i++) wire[i] = bytes[start + 2 + i]
    wires.push(wire)
    offset = start + 2 + length
  }
  if (!wires.length || wires.some(wire => JSON.stringify(wire) !== JSON.stringify(wires[0]))) throw new Error('Missing or inconsistent Electron fuse wires')
  return { ...wires[0], wireCount: wires.length }
}

function integrityDictionarySHA256(dictionary) {
  if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) throw new Error('Missing Electron ASAR integrity dictionary')
  const hash = crypto.createHash('sha256')
  // Electron sorts with NSLiteralSearch. Reviewed archive paths and payloads
  // are ASCII, for which JavaScript's lexical ordering is exactly equivalent.
  for (const relativePath of Object.keys(dictionary).sort()) {
    const payload = dictionary[relativePath]
    if (!/^[\x20-\x7e]+$/.test(relativePath) || payload?.algorithm !== 'SHA256' || !/^[a-f0-9]{64}$/.test(payload?.hash ?? '')) throw new Error('Unsupported Electron ASAR integrity dictionary entry')
    hash.update(relativePath)
    hash.update(payload.algorithm)
    hash.update(payload.hash)
  }
  return hash.digest('hex')
}

async function readIntegrityDictionarySlots(binary) {
  const bytes = await fsp.readFile(binary)
  const sentinel = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A')
  const slots = []
  let cursor = 0
  for (;;) {
    const offset = bytes.indexOf(sentinel, cursor)
    if (offset < 0) break
    const start = offset + sentinel.length
    if (start + 34 > bytes.length || bytes[start] !== 1 || bytes[start + 1] !== 1) throw new Error('Unsupported or disabled Electron integrity dictionary digest slot')
    slots.push({ offset, used: bytes[start], version: bytes[start + 1], digestSHA256: bytes.subarray(start + 2, start + 34).toString('hex') })
    cursor = start + 34
  }
  if (!slots.length) throw new Error('Missing Electron integrity dictionary digest slot; audit the installed runtime first')
  return slots
}

async function updateIntegrityDictionarySlots(binary, originalSlots, digestSHA256) {
  const before = await fsp.readFile(binary)
  const after = Buffer.from(before)
  const actualSlots = await readIntegrityDictionarySlots(binary)
  if (JSON.stringify(actualSlots) !== JSON.stringify(originalSlots)) throw new Error('Copied integrity dictionary digest slots differ before repackaging')
  for (const slot of actualSlots) Buffer.from(digestSHA256, 'hex').copy(after, slot.offset + 34)
  await fsp.writeFile(binary, after)
  const updatedSlots = await readIntegrityDictionarySlots(binary)
  if (updatedSlots.some((slot, i) => slot.offset !== originalSlots[i].offset || slot.used !== originalSlots[i].used || slot.version !== originalSlots[i].version || slot.digestSHA256 !== digestSHA256)) throw new Error('Electron integrity dictionary digest update failed')
  // Verify this package-time operation touched only the 32-byte digest fields;
  // the slot remains enabled and all runtime implementation bytes are preserved.
  for (const slot of actualSlots) before.subarray(slot.offset + 34, slot.offset + 66).copy(after, slot.offset + 34)
  if (!before.equals(after)) throw new Error('Unexpected native change while updating Electron integrity metadata')
  return updatedSlots
}

async function removeProvisioningProfiles(root) {
  const removed = []
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name)
      if (preservesSourceHelper(path.relative(root, filename))) continue
      if (entry.isDirectory()) await walk(filename)
      else if (entry.isFile() && /^(embedded\.provisionprofile|embedded\.mobileprovision)$/.test(entry.name)) {
        await fsp.unlink(filename)
        removed.push(path.relative(root, filename))
      }
    }
  }
  await walk(root)
  return removed
}

async function nestedCodeBundles(root) {
  const bundles = []
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const filename = path.join(dir, entry.name)
      await walk(filename)
      if (/\.(app|framework|xpc|appex|docktileplugin|bundle)$/.test(entry.name)) bundles.push(filename)
    }
  }
  await walk(root)
  return bundles
}

function compareInventories(source, output) {
  const sourceByPath = new Map(source.map(entry => [entry.path, entry]))
  const outputByPath = new Map(output.map(entry => [entry.path, entry]))
  const changed = []
  let identical = 0
  for (const name of new Set([...sourceByPath.keys(), ...outputByPath.keys()])) {
    const before = sourceByPath.get(name)
    const after = outputByPath.get(name)
    if (before?.type === after?.type && (before?.type === 'link' ? before.target === after.target : before?.sha256 === after?.sha256)) identical++
    else changed.push({ path: name, before: before ?? null, after: after ?? null })
  }
  return { identical, changed }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('This local reconstruction requires macOS')
  const args = parseArgs(process.argv.slice(2))
  const source = await fsp.realpath(path.resolve(args.source ?? '/Applications/ChatGPT.app'))
  const output = await canonicalTarget(args.output ?? path.join(scriptRoot, 'release/local-runtime/Codex Replica Local.app'))
  const profile = await canonicalTarget(args.profile ?? path.join(os.homedir(), 'Library/Application Support/Codex Replica Local'))
  // Owl creates the Chromium profile before the JavaScript entrypoint. Its
  // reviewed ini setting accepts the app-data directory name, so a custom
  // desktop --profile has this second independent native/browser root.
  const nativeProfile = await canonicalTarget(path.join(os.homedir(), 'Library/Application Support/Codex Replica Local'))
  const serverHome = await fsp.realpath(path.resolve(args['server-home'] ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')))
  const serverBinary = await fsp.realpath(path.resolve(args['server-binary'] ?? path.join(source, 'Contents/Resources/codex-cli/bin/codex')))
  if (!source.endsWith('.app') || !output.endsWith('.app')) throw new Error('--source and --output must name macOS .app bundles')
  if (within(source, output) || within(output, source)) throw new Error('Output must not overlap the installed source application')
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`)
  const originalProfile = await canonicalTarget(path.join(os.homedir(), 'Library/Application Support/Codex'))
  const forbiddenProfileRoots = [source, output, originalProfile, serverHome]
  if ([profile, nativeProfile].some(candidate => forbiddenProfileRoots.some(root => within(root, candidate) || within(candidate, root)))) {
    throw new Error('Profile must be separate from the installed app, original desktop profile, and server home')
  }
  for (const candidate of new Set([profile, nativeProfile])) await validateIsolatedTreeAliases(candidate, forbiddenProfileRoots)
  for (const name of ['codex-home', 'logs', 'session', 'crash-dumps']) if (!within(profile, await canonicalTarget(path.join(profile, name)))) throw new Error('A profile child follows a symlink outside the independent profile')
  const evidence = path.join(path.dirname(output), `${path.basename(output, '.app')}.reconstruction`)
  if (fs.existsSync(evidence)) throw new Error(`Refusing to overwrite existing build report: ${evidence}`)
  await fsp.access(serverBinary, fs.constants.X_OK)
  const sourceInfo = await readPlist(path.join(source, 'Contents/Info.plist'))
  if (sourceInfo.CFBundleIdentifier !== 'com.openai.codex') throw new Error('Selected app is not the reviewed installed Codex runtime')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source])
  const sourceArchive = path.join(source, 'Contents/Resources/app.asar')
  const sourceHeader = asar.getRawHeader(sourceArchive)
  const originalEntries = archiveEntries(sourceHeader.header)
  const packageInfo = JSON.parse(asar.extractFile(sourceArchive, 'package.json').toString('utf8'))
  if (packageInfo.main !== '.vite/build/early-bootstrap.js') throw new Error('Unsupported upstream entrypoint; audit this installed version first')
  const originalArchiveSHA256 = await fileHash(sourceArchive)
  const originalHeaderSHA256 = sha256(sourceHeader.headerString)
  const declaredHeaderHash = sourceInfo.ElectronAsarIntegrity?.['Resources/app.asar']?.hash
  if (declaredHeaderHash !== originalHeaderSHA256) throw new Error('Installed app header does not match its Info.plist integrity declaration')
  const sourceFramework = await findFrameworkBinary(source)
  const sourceFuses = await readCurrentFuses(sourceFramework)
  if (sourceFuses[4] !== 49 || sourceFuses[5] !== 49) throw new Error('Installed app ASAR integrity and ASAR-only fuses must both be enabled')
  const sourceDictionarySHA256 = integrityDictionarySHA256(sourceInfo.ElectronAsarIntegrity)
  const sourceIntegritySlots = await readIntegrityDictionarySlots(sourceFramework)
  if (sourceIntegritySlots.some(slot => slot.digestSHA256 !== sourceDictionarySHA256)) throw new Error('Installed framework integrity dictionary digest does not match its Info.plist')
  log(`Source ${packageInfo.version}, build ${packageInfo.codexBuildNumber}; ${originalEntries.length} ASAR entries`)
  log('Hashing installed resources before reconstruction')
  const sourceDisk = await diskInventory(source)
  await fsp.mkdir(path.dirname(output), { recursive: true })
  const stage = path.join(path.dirname(output), `.codex-local-build-${crypto.randomUUID()}.app`)
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-local-reconstruction-'))
  const extracted = path.join(temporary, 'asar')
  const archive = path.join(stage, 'Contents/Resources/app.asar')
  const resources = path.join(stage, 'Contents/Resources')
  const report = {
    schemaVersion: 1,
    marker: MARKER,
    createdAt: new Date().toISOString(),
    source,
    output,
    profile,
    nativeProfile,
    desktopHome: path.join(profile, 'codex-home'),
    serverHome,
    serverBinary,
    version: packageInfo.version,
    buildNumber: packageInfo.codexBuildNumber,
    startupMode: 'work',
    sourceArchiveSHA256: originalArchiveSHA256,
    sourceHeaderSHA256: originalHeaderSHA256,
    sourceFuses,
    integrityDictionary: { sourceSHA256: sourceDictionarySHA256, sourceSlots: sourceIntegritySlots },
    sourceInfoSHA256: await fileHash(path.join(source, 'Contents/Info.plist')),
    limits: [
      'The modified main runtime is ad-hoc signed and cannot reproduce OpenAI signing identity, DeviceCheck attestation, APNs entitlements, or shared Keychain groups. Unmodified standalone child runtimes retain their original signatures and entitlements.',
      'Hosted capabilities remain subject to the existing server account and service authorization.',
      'The desktop profile, desktop CODEX_HOME, logs, and UI SQLite are independent; Owl uses its separate Codex Replica Local native/browser root when --profile is customized. The Codex CLI uses the existing server home.',
      'The replica does not register the original codex:// OS protocol handler; the installed original retains external deep-link handling.',
      'Runtime UI and interaction parity are not asserted by this static reconstruction report.'
    ]
  }
  let createdEvidence = false
  try {
    log('Copying the installed app with APFS copy-on-write')
    await run('/bin/cp', ['-cR', source, stage])
    report.removedProvisioningProfiles = await removeProvisioningProfiles(stage)
    const info = { ...sourceInfo, CFBundleIdentifier: 'com.openai.codex.replica.local', CFBundleName: 'Codex', CFBundleDisplayName: 'Codex Replica Local' }
    if (Array.isArray(info.CFBundleURLTypes)) info.CFBundleURLTypes = info.CFBundleURLTypes.map(type => ({ ...type, CFBundleURLSchemes: (type.CFBundleURLSchemes ?? []).map(scheme => `codex-replica-local-${scheme}`) }))
    await writePlist(path.join(stage, 'Contents/Info.plist'), info)
    const owlIniPath = path.join(resources, 'owl-app.ini')
    const owlIni = await fsp.readFile(owlIniPath, 'utf8')
    await fsp.writeFile(owlIniPath, replaceExactly(owlIni, 'UserDataDirectoryName=Codex', 'UserDataDirectoryName=Codex Replica Local', 'Owl user-data directory'))
    const config = { marker: MARKER, profile, nativeProfile, serverHome, serverBinary, sourceApp: source, originalProfile, startupMode: 'work' }
    await fsp.writeFile(path.join(resources, 'codex-replica-runtime.json'), `${JSON.stringify(config, null, 2)}\n`)
    const wrapper = `#!/bin/sh\n# ${MARKER}; credentials remain in the existing server home.\nexport CODEX_HOME=\"\${CODEX_REPLICA_SERVER_HOME:-${serverHome.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')}}\"\nexec ${shellQuote(serverBinary)} \"$@\"\n`
    await fsp.writeFile(path.join(resources, 'native/codex-replica-server'), wrapper, { mode: 0o755 })
    // These are ordinary local runtime capabilities, not copied team, Keychain,
    // application-group, APNs, or provisioning entitlements.
    const entitlementsPath = path.join(temporary, 'local-entitlements.plist')
    await fsp.writeFile(entitlementsPath, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><false/><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.automation.apple-events</key><true/><key>com.apple.security.device.audio-input</key><true/><key>com.apple.security.device.camera</key><true/><key>com.apple.security.files.user-selected.read-write</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.personal-information.calendars</key><true/></dict></plist>')
    log('Signing the local main runtime and preserving unmodified signed standalone helpers')
    // --deep can retain a valid nested framework's original Team ID and does
    // not reliably sign standalone .node resources. That passes static verify
    // but fails dyld library validation in an ad-hoc outer process. Explicitly
    // sign all native files, then their containing bundles from leaves to root.
    const copiedMachos = (await diskInventory(stage)).filter(entry => entry.macho)
    const localMachos = copiedMachos.filter(entry => !preservesSourceHelper(entry.path))
    const preservedMachos = copiedMachos.filter(entry => preservesSourceHelper(entry.path))
    // Ordinary local development signing is required for an ad-hoc process:
    // hardened-runtime library validation cannot match two empty Team IDs.
    // This does not change Electron fuses or production authentication checks.
    for (const entry of localMachos) await run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlementsPath, path.join(stage, entry.path)])
    const copiedBundles = await nestedCodeBundles(stage)
    const localBundles = copiedBundles.filter(bundle => !preservesSourceHelper(path.relative(stage, bundle)))
    for (const bundle of localBundles) await run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlementsPath, bundle])
    report.signedNativeFiles = localMachos.map(entry => entry.path)
    report.signedNestedCodeBundles = localBundles.map(bundle => path.relative(stage, bundle))
    report.preservedSignedHelperRoots = PRESERVED_SIGNED_HELPER_ROOTS
    report.preservedSignedNativeFiles = preservedMachos.map(entry => ({ path: entry.path, sha256: entry.sha256 }))
    report.preservedSignedNestedCodeBundles = copiedBundles.filter(bundle => preservesSourceHelper(path.relative(stage, bundle))).map(bundle => path.relative(stage, bundle))
    log('Extracting shipped ASAR bytes and preserving every original entry')
    asar.extractAll(sourceArchive, extracted)
    const sourceAssetHashes = []
    const sourceUnpackedIntegrityContradictions = []
    for (const entry of originalEntries) {
      if (entry.files || entry.link) continue
      const filename = path.join(extracted, entry.path)
      const hash = await fileHash(filename)
      sourceAssetHashes.push({ path: entry.path, sha256: hash, bytes: (await fsp.stat(filename)).size, unpacked: !!entry.unpacked })
      if (entry.integrity?.hash && entry.integrity.hash !== hash) {
        if (!entry.unpacked || !REVIEWED_SIGNED_UNPACKED_PATHS.has(entry.path)) throw new Error(`Unreviewed installed ASAR integrity contradiction: ${entry.path}`)
        sourceUnpackedIntegrityContradictions.push({ path: entry.path, declaredSHA256: entry.integrity.hash, observedSHA256: hash, unpacked: true })
      }
      if (entry.unpacked) await fsp.copyFile(path.join(`${archive}.unpacked`, entry.path), filename)
    }
    report.sourceUnpackedIntegrityContradictions = sourceUnpackedIntegrityContradictions
    const earlyPath = '.vite/build/early-bootstrap.js'
    const loggerPath = exactlyOnePath(originalEntries, /^\.vite\/build\/file-based-logger-[^/]+\.js$/, 'file logger bundle')
    const applyEnvironment = `/* ${MARKER} */\n${__codexReplicaApplyEnvironment.toString()}\n__codexReplicaApplyEnvironment();\n`
    let early = await fsp.readFile(path.join(extracted, earlyPath), 'utf8')
    if (early.includes(MARKER)) throw new Error('Source is already a reconstructed runtime')
    // The supported shell-environment loader can replace CLI_PATH. Reapply only
    // local profile/CLI routing after its completion, before the normal bootstrap.
    const bootstrapImport = /await ([A-Za-z_$][\w$]*)\(\)&&await Promise\.resolve\(\)\.then\(\(\)=>require\("(\.\/bootstrap-[^"/]+\.js)"\)\)/g
    const bootstrapMatch = [...early.matchAll(bootstrapImport)]
    if (bootstrapMatch.length !== 1) throw new Error('Installed post-environment bootstrap changed; expected exactly one reviewed patch anchor')
    const bootstrapPath = path.posix.join('.vite/build', bootstrapMatch[0][2].slice(2))
    early = replaceRegexExactly(
      early,
      bootstrapImport,
      (_match, loader, modulePath) => `await ${loader}()&&(__codexReplicaApplyEnvironment(),await Promise.resolve().then(()=>require("${modulePath}")))`,
      'post-environment bootstrap'
    )
    await fsp.writeFile(path.join(extracted, earlyPath), `${applyEnvironment}${early}`)
    let logger = await fsp.readFile(path.join(extracted, loggerPath), 'utf8')
    logger = replaceRegexExactly(
      logger,
      /function ([A-Za-z_$][\w$]*)\(e,t=process\.platform\)\{/g,
      (_match, functionName) => `function ${functionName}(e,t=process.platform){if(process.env.CODEX_REPLICA_LOGS_DIR)return require("node:path").resolve(process.env.CODEX_REPLICA_LOGS_DIR);`,
      'file logger root'
    )
    await fsp.writeFile(path.join(extracted, loggerPath), logger)
    let bootstrap = await fsp.readFile(path.join(extracted, bootstrapPath), 'utf8')
    bootstrap = replaceExactly(
      bootstrap,
      'if(process.platform===`win32`)return;let t=',
      'if(process.env.CODEX_REPLICA_PROFILE_PATH||process.platform===`win32`)return;let t=',
      'external protocol registration'
    )
    await fsp.writeFile(path.join(extracted, bootstrapPath), bootstrap)
    report.infrastructurePatches = [earlyPath, loggerPath, bootstrapPath]
    const streams = []
    for (const entry of originalEntries) {
      const filename = path.join(extracted, entry.path)
      if (entry.files) streams.push({ path: entry.path, type: 'directory', unpacked: !!entry.unpacked })
      else if (entry.link) streams.push({ path: entry.path, type: 'link', unpacked: !!entry.unpacked, symlink: await fsp.readlink(filename), stat: await fsp.lstat(filename) })
      else streams.push({ path: entry.path, type: 'file', unpacked: !!entry.unpacked, stat: await fsp.stat(filename), streamGenerator: () => fs.createReadStream(filename) })
    }
    log('Repacking ASAR with freshly computed file integrity after native signing')
    const packed = path.join(temporary, 'app.asar')
    await asar.createPackageFromStreams(packed, streams)
    await fsp.copyFile(packed, archive)
    // Generated unpacked files carry exactly the signed bytes used to calculate
    // ASAR integrity. Preserve the other original companion resources as well.
    for (const entry of originalEntries.filter(entry => entry.unpacked && !entry.files && !entry.link)) await fsp.copyFile(path.join(`${packed}.unpacked`, entry.path), path.join(`${archive}.unpacked`, entry.path))
    asar.uncache(archive)
    const outputHeaderSHA256 = sha256(asar.getRawHeader(archive).headerString)
    info.ElectronAsarIntegrity = { ...info.ElectronAsarIntegrity, 'Resources/app.asar': { algorithm: 'SHA256', hash: outputHeaderSHA256 } }
    await writePlist(path.join(stage, 'Contents/Info.plist'), info)
    // Newer Electron seals the Info.plist integrity dictionary in a native
    // package-time digest slot. Update that digest as well as the header hash,
    // retaining used=1/version=1 and the original ASAR-validation fuse state.
    const framework = await findFrameworkBinary(stage)
    const outputDictionarySHA256 = integrityDictionarySHA256(info.ElectronAsarIntegrity)
    const outputIntegritySlots = await updateIntegrityDictionarySlots(framework, sourceIntegritySlots, outputDictionarySHA256)
    const frameworkBundle = path.join(stage, 'Contents/Frameworks', path.relative(path.join(stage, 'Contents/Frameworks'), framework).split(path.sep)[0])
    await run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlementsPath, framework])
    await run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlementsPath, frameworkBundle])
    report.integrityDictionary.outputSHA256 = outputDictionarySHA256
    report.integrityDictionary.outputSlots = outputIntegritySlots
    report.integrityDictionary.onlyDigestBytesModifiedBeforeSigning = true
    log('Signing the final outer app and verifying every renderer/resource digest')
    await run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlementsPath, stage])
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', stage])
    const sealedSlots = await readIntegrityDictionarySlots(framework)
    const sealedDictionary = integrityDictionarySHA256((await readPlist(path.join(stage, 'Contents/Info.plist'))).ElectronAsarIntegrity)
    if (sealedDictionary !== outputDictionarySHA256 || JSON.stringify(sealedSlots) !== JSON.stringify(outputIntegritySlots)) throw new Error('Final signature changed Electron ASAR integrity metadata')
    report.integrityDictionary.finalSignatureVerified = true
    const outputEntries = archiveEntries(asar.getRawHeader(archive).header)
    if (outputEntries.length !== originalEntries.length) throw new Error('ASAR entry count changed unexpectedly')
    const originalByPath = new Map(sourceAssetHashes.map(entry => [entry.path, entry]))
    const modifiedAssets = []
    let rendererIdentical = 0
    let archiveFilesIdentical = 0
    const outputAssetHashes = []
    for (const entry of outputEntries) {
      if (entry.files || entry.link) continue
      const buffer = asar.extractFile(archive, entry.path)
      const hash = sha256(buffer)
      if (entry.integrity?.hash !== hash) throw new Error(`Output ASAR integrity mismatch: ${entry.path}`)
      const before = originalByPath.get(entry.path)
      if (!before) throw new Error(`Unexpected output ASAR entry: ${entry.path}`)
      if (before.unpacked !== !!entry.unpacked) throw new Error(`ASAR unpacked placement changed: ${entry.path}`)
      if (before.sha256 === hash) {
        archiveFilesIdentical++
        if (entry.path.startsWith('webview/')) rendererIdentical++
      } else {
        modifiedAssets.push({ path: entry.path, beforeSHA256: before.sha256, afterSHA256: hash, reason: entry.unpacked ? 'local native code signature' : 'desktop isolation infrastructure' })
        if (!entry.unpacked && !report.infrastructurePatches.includes(entry.path)) throw new Error(`Unexpected ASAR content change: ${entry.path}`)
      }
      if (entry.path.startsWith('webview/') && before.sha256 !== hash) throw new Error(`Original renderer byte parity failed: ${entry.path}`)
      outputAssetHashes.push({ path: entry.path, sha256: hash, bytes: buffer.length, unpacked: !!entry.unpacked })
    }
    const outputFuses = await readCurrentFuses(await findFrameworkBinary(stage))
    if (JSON.stringify(sourceFuses) !== JSON.stringify(outputFuses)) throw new Error('Electron fuse state changed during reconstruction')
    report.outputFuses = outputFuses
    report.outputHeaderSHA256 = outputHeaderSHA256
    report.outputArchiveSHA256 = await fileHash(archive)
    report.archiveVerification = { entries: outputEntries.length, files: outputAssetHashes.length, identicalFiles: archiveFilesIdentical, identicalRendererFiles: rendererIdentical, modifiedAssets, integrityValidated: true }
    const outputDisk = await diskInventory(stage)
    report.diskVerification = compareInventories(sourceDisk, outputDisk)
    const allowedResourceChanges = new Set(['Contents/Info.plist', 'Contents/Resources/app.asar', 'Contents/Resources/owl-app.ini', 'Contents/Resources/codex-replica-runtime.json', 'Contents/Resources/native/codex-replica-server'])
    for (const change of report.diskVerification.changed) {
      if (preservesSourceHelper(change.path)) throw new Error(`Unmodified signed helper changed: ${change.path}`)
      if (allowedResourceChanges.has(change.path) || change.path.includes('/_CodeSignature/') || change.path.endsWith('/CodeResources') || report.removedProvisioningProfiles.includes(change.path) || change.before?.macho || change.after?.macho) continue
      throw new Error(`Unexpected copied resource change: ${change.path}`)
    }
    // The original source is read-only throughout: verify the two files that
    // define installed application code and packaging identity before delivery.
    if (await fileHash(sourceArchive) !== originalArchiveSHA256 || await fileHash(path.join(source, 'Contents/Info.plist')) !== report.sourceInfoSHA256) throw new Error('Installed source changed during reconstruction; do not deliver this build')
    const sourceDiskAfterBuild = await diskInventory(source)
    if (compareInventories(sourceDisk, sourceDiskAfterBuild).changed.length) throw new Error('Installed native/resource files changed during reconstruction; do not deliver this build')
    report.sourceDiskUnchanged = true
    if (fs.existsSync(output)) throw new Error('Output appeared while building; refusing to replace it')
    report.helperSignaturePreservation = { allFilesByteIdentical: true, nativeFiles: report.preservedSignedNativeFiles.length, nestedBundles: report.preservedSignedNestedCodeBundles.length }
    report.codesign = { identity: 'ad-hoc', hardenedRuntime: false, deepStrictVerified: true, originalMainTeamAndKeychainEntitlementsCopied: false, unmodifiedChildSignaturesPreserved: true }
    report.status = 'static-verification-passed'
    report.completedAt = new Date().toISOString()
    await fsp.mkdir(evidence, { recursive: false })
    createdEvidence = true
    await fsp.writeFile(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await fsp.writeFile(path.join(evidence, 'source-disk-manifest.json'), `${JSON.stringify(sourceDisk, null, 2)}\n`)
    await fsp.writeFile(path.join(evidence, 'output-disk-manifest.json'), `${JSON.stringify(outputDisk, null, 2)}\n`)
    await fsp.writeFile(path.join(evidence, 'source-asar-manifest.json'), `${JSON.stringify(sourceAssetHashes, null, 2)}\n`)
    await fsp.writeFile(path.join(evidence, 'output-asar-manifest.json'), `${JSON.stringify(outputAssetHashes, null, 2)}\n`)
    if (fs.existsSync(output)) throw new Error('Output appeared while writing evidence; refusing to replace it')
    await fsp.rename(stage, output)
    log(`Verified ${rendererIdentical} original renderer files byte-for-byte; ${archiveFilesIdentical} unchanged ASAR files`)
    log(`Ready: ${output}`)
    log(`Local report: ${path.join(evidence, 'report.json')}`)
  } catch (error) {
    // The staged copy is ours; remove it on failure, never the installed source.
    await fsp.rm(stage, { recursive: true, force: true })
    if (createdEvidence) await fsp.rm(evidence, { recursive: true, force: true })
    throw error
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(`[local reconstruction] ${error.stack ?? error}`)
  process.exitCode = 1
})

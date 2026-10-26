#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { extractFile } from '@electron/asar'

const app = path.resolve(process.argv[2] || 'release/local-runtime/Codex Study Verified.app')
const early = extractFile(path.join(app, 'Contents/Resources/app.asar'), '.vite/build/early-bootstrap.js').toString()
const start = early.indexOf('function __codexReplicaApplyEnvironment()')
const end = early.indexOf('\n__codexReplicaApplyEnvironment();', start)
assert(start >= 0 && end > start, 'Reconstruction has no isolated bootstrap guard')
const guard = early.slice(start, end)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-profile-guard-test-'))
const results = []

function fixture(name) {
  const root = path.join(temporary, name)
  const resourcesPath = path.join(root, 'replica.app/Contents/Resources')
  fs.mkdirSync(resourcesPath, { recursive: true })
  const config = {
    profile: path.join(root, 'desktop-profile'),
    nativeProfile: path.join(root, 'browser-profile'),
    serverHome: path.join(root, 'server-home'),
    sourceApp: path.join(root, 'source.app'),
    originalProfile: path.join(root, 'original-profile')
  }
  Object.values(config).forEach((value) => fs.mkdirSync(value, { recursive: true }))
  config.startupMode = 'work'
  return { root, resourcesPath, config, env: {}, calls: [] }
}

function apply(fixture) {
  fs.writeFileSync(path.join(fixture.resourcesPath, 'codex-replica-runtime.json'), JSON.stringify(fixture.config))
  const context = {
    process: { env: fixture.env, resourcesPath: fixture.resourcesPath },
    require: (name) => {
      if (name === 'node:fs') return fs
      if (name === 'node:path') return path
      if (name === 'electron') return { app: {
        setPath: (key, value) => fixture.calls.push([key, value]),
        setAppLogsPath: (value) => fixture.calls.push(['logs', value])
      } }
      throw new Error(`Unexpected guard dependency: ${name}`)
    }
  }
  vm.runInNewContext(`${guard}\n__codexReplicaApplyEnvironment();`, context, { timeout: 1_000 })
}

function check(name, alter, reject = true, verify) {
  const test = fixture(name)
  alter(test)
  if (reject) assert.throws(() => apply(test), undefined, `${name} must be rejected`)
  else {
    apply(test)
    const expected = fs.realpathSync(test.env.CODEX_REPLICA_PROFILE_PATH)
    assert.equal(test.env.CODEX_ELECTRON_USER_DATA_PATH, expected)
    assert.equal(test.env.CODEX_HOME, path.join(expected, 'codex-home'))
    assert.equal(test.env.CODEX_SPARKLE_ENABLED, 'false')
    assert.equal(test.env.CODEX_CLI_PATH, path.join(test.resourcesPath, 'native/codex-replica-server'))
    assert.equal(test.calls.find(([key]) => key === 'userData')[1], expected)
    for (const child of ['codex-home', 'logs', 'session', 'crash-dumps']) {
      assert.equal(fs.statSync(path.join(expected, child)).mode & 0o077, 0)
    }
    verify?.(test)
  }
  results.push({ name, passed: true, expectation: reject ? 'rejected' : 'accepted' })
}

try {
  check('valid-independent-profile', () => {}, false, (test) => {
    const statePath = path.join(test.env.CODEX_HOME, '.codex-global-state.json')
    const atoms = JSON.parse(fs.readFileSync(statePath, 'utf8'))['electron-persisted-atom-state']
    assert.equal(atoms['electron:onboarding-projectless-completed'], true)
    assert.equal(atoms['electron:onboarding-welcome-pending'], false)
    assert.equal(atoms['electron:onboarding-override'], 'auto')
    assert.deepEqual(atoms['electron:onboarding-welcome-v2-role-state'], { roles: ['default'], personalizedSuggestionsEnabled: false, workMode: 'coding' })
    assert.equal(atoms['home-composer-mode-v1'], 'work')
    assert.equal(fs.statSync(statePath).mode & 0o077, 0)
    const before = fs.readFileSync(statePath, 'utf8')
    const beforeTime = fs.statSync(statePath).mtimeMs
    apply(test)
    assert.equal(fs.readFileSync(statePath, 'utf8'), before)
    assert.equal(fs.statSync(statePath).mtimeMs, beforeTime)
  })
  check('valid-profile-environment-override', (test) => { test.env.CODEX_REPLICA_PROFILE_PATH = path.join(test.root, 'custom-profile') }, false)
  check('valid-server-home-environment-override', (test) => { test.env.CODEX_REPLICA_SERVER_HOME = path.join(test.root, 'custom-server-home') }, false)
  for (const key of ['serverHome', 'originalProfile', 'sourceApp']) {
    check(`profile-equals-${key}`, (test) => { test.config.profile = test.config[key] })
    check(`profile-contains-${key}`, (test) => { test.config.profile = test.root })
    check(`profile-within-${key}`, (test) => { test.config.profile = path.join(test.config[key], 'child') })
  }
  check('profile-equals-output-app', (test) => { test.config.profile = path.resolve(test.resourcesPath, '../..') })
  check('profile-symlink-to-server-home', (test) => {
    const alias = path.join(test.root, 'profile-alias')
    fs.symlinkSync(test.config.serverHome, alias)
    test.config.profile = alias
  })
  check('native-profile-equals-original-profile', (test) => { test.config.nativeProfile = test.config.originalProfile })
  check('server-home-override-overlaps-profile', (test) => { test.env.CODEX_REPLICA_SERVER_HOME = test.config.profile })
  for (const child of ['codex-home', 'logs', 'session', 'crash-dumps']) {
    check(`profile-child-${child}-symlink-escape`, (test) => { fs.symlinkSync(test.config.serverHome, path.join(test.config.profile, child)) })
  }
  for (const child of ['Default', 'Default/Partitions', 'Crashpad', 'BrowserMetrics', 'GPUCache', 'GraphiteDawnCache']) {
    check(`native-child-${child.replaceAll('/', '-')}-symlink-escape`, (test) => {
      fs.mkdirSync(path.dirname(path.join(test.config.nativeProfile, child)), { recursive: true })
      fs.symlinkSync(test.config.originalProfile, path.join(test.config.nativeProfile, child))
    })
  }
  check('dangling-profile-path-alias', (test) => {
    const alias = path.join(test.root, 'dangling-profile')
    fs.symlinkSync(path.join(test.root, 'absent'), alias)
    test.config.profile = alias
  })
  const prepareState = (test, data) => {
    const home = path.join(test.config.profile, 'codex-home')
    fs.mkdirSync(home, { mode: 0o700 })
    const filename = path.join(home, '.codex-global-state.json')
    fs.writeFileSync(filename, data)
    return filename
  }
  check('startup-preserves-existing-local-choices', (test) => {
    prepareState(test, JSON.stringify({ unrelated: { kept: true }, 'electron-persisted-atom-state': {
      'electron:onboarding-projectless-completed': false,
      'electron:onboarding-welcome-pending': true,
      'electron:onboarding-override': 'welcome',
      'electron:onboarding-welcome-v2-role-state': { roles: ['product'], personalizedSuggestionsEnabled: true, workMode: 'non_coding' },
      'home-composer-mode-v1': 'chat'
    } }))
  }, false, (test) => {
    const state = JSON.parse(fs.readFileSync(path.join(test.env.CODEX_HOME, '.codex-global-state.json'), 'utf8'))
    assert.deepEqual(state.unrelated, { kept: true })
    assert.equal(state['electron-persisted-atom-state']['home-composer-mode-v1'], 'chat')
    assert.equal(state['electron-persisted-atom-state']['electron:onboarding-projectless-completed'], false)
    assert.deepEqual(state['electron-persisted-atom-state']['electron:onboarding-welcome-v2-role-state'].roles, ['product'])
  })
  check('startup-preserves-unrelated-atom', (test) => {
    prepareState(test, JSON.stringify({ 'electron-persisted-atom-state': { existing: 42, 'home-composer-mode-v1': null } }))
  }, false, (test) => {
    const atoms = JSON.parse(fs.readFileSync(path.join(test.env.CODEX_HOME, '.codex-global-state.json'), 'utf8'))['electron-persisted-atom-state']
    assert.equal(atoms.existing, 42)
    assert.equal(atoms['home-composer-mode-v1'], null)
    assert.equal(atoms['electron:onboarding-projectless-completed'], true)
  })
  check('startup-rejects-state-symlink', (test) => {
    const filename = prepareState(test, '{}')
    fs.unlinkSync(filename)
    const protectedState = path.join(test.config.serverHome, 'protected.json')
    fs.writeFileSync(protectedState, '{}')
    fs.symlinkSync(protectedState, filename)
  })
  check('startup-rejects-state-directory', (test) => {
    const filename = prepareState(test, '{}')
    fs.unlinkSync(filename)
    fs.mkdirSync(filename)
  })
  for (const [name, data] of [['malformed-json', '{bad'], ['null-state', 'null'], ['array-state', '[]'], ['invalid-atom-record', '{"electron-persisted-atom-state":[]}']]) {
    check(`startup-rejects-${name}`, (test) => { prepareState(test, data) })
  }
  check('startup-rejects-temporary-state-collision', (test) => {
    const filename = prepareState(test, '{}')
    fs.writeFileSync(`${filename}.replica-startup-defaults`, 'untouched')
  })
  check('legacy-config-does-not-seed-work-atoms', (test) => { delete test.config.startupMode }, false, (test) => {
    assert.equal(fs.existsSync(path.join(test.env.CODEX_HOME, '.codex-global-state.json')), false)
  })
  console.log(JSON.stringify({ app, cases: results.length, passed: true, results }, null, 2))
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

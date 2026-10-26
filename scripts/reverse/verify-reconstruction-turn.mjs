#!/usr/bin/env node
// Read-only verification of the fixed native UI acceptance fixture. This
// script neither submits a model turn nor resumes an existing conversation.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const app = path.resolve(process.argv[2] || 'release/local-runtime/Codex Study Ready.app')
const threadId = process.argv[3]
assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(threadId ?? ''), 'Pass the independent native fixture thread ID')
const config = JSON.parse(await fs.readFile(path.join(app, 'Contents/Resources/codex-replica-runtime.json'), 'utf8'))
const state = JSON.parse(await fs.readFile(path.join(config.profile, 'codex-home/.codex-global-state.json'), 'utf8'))
assert(state['projectless-thread-ids']?.includes(threadId), 'Fixture must belong to this independent desktop profile')
const sessions = path.join(config.serverHome, 'sessions')
const matches = (await fs.readdir(sessions, { recursive: true })).filter(name => name.endsWith(`-${threadId}.jsonl`))
assert.equal(matches.length, 1, 'Expected one server transcript for the fixture')
const transcript = path.join(sessions, matches[0])
const rows = (await fs.readFile(transcript, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
const meta = rows.find(row => row.type === 'session_meta')?.payload
assert.equal(meta?.id, threadId)
assert.equal(meta?.originator, 'Codex Desktop')
const prompt = 'Codex replica native acceptance fixture: 只回复 codex-replica-ok。不要调用任何工具，不要读取或修改任何文件。'
assert(rows.some(row => row.type === 'response_item' && row.payload?.role === 'user' && row.payload.content?.some(item => item.text?.trimEnd() === prompt)), 'Transcript must contain the exact fixed test prompt')
const turn = rows.find(row => row.type === 'turn_context')?.payload
const started = rows.find(row => row.type === 'event_msg' && row.payload?.type === 'task_started')
const completed = rows.find(row => row.type === 'event_msg' && row.payload?.type === 'task_complete' && row.payload.turn_id === turn?.turn_id)
assert.equal(started?.payload.turn_id, turn?.turn_id)
assert.equal(completed?.payload.last_agent_message, 'codex-replica-ok')
const assistant = rows.filter(row => row.type === 'response_item' && row.payload?.role === 'assistant').flatMap(row => row.payload.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('')
assert.equal(assistant, 'codex-replica-ok')
const toolCalls = rows.filter(row => row.type === 'response_item' && ['function_call', 'custom_tool_call', 'web_search_call'].includes(row.payload?.type)).length
assert.equal(toolCalls, 0, 'Fixed acceptance fixture must not call tools')
const logRoot = path.join(config.profile, 'logs')
const logs = (await fs.readdir(logRoot, { recursive: true })).filter(name => name.endsWith('.log'))
let runtimeLog
let handshake
for (const name of logs) {
  const body = await fs.readFile(path.join(logRoot, name), 'utf8')
  if (!body.includes(threadId)) continue
  const candidate = body.split('\n').find(line => line.includes('initialize_handshake_result') && line.includes('outcome=success') && line.includes('transportKind=stdio'))
  if (candidate) { runtimeLog = path.join(logRoot, name); handshake = candidate; break }
}
assert(handshake, 'Own desktop runtime must record a successful local stdio handshake and fixture activity')
console.log(JSON.stringify({
  app, passed: true, desktopProfile: config.profile, serverHome: config.serverHome,
  threadId, turnId: turn.turn_id, fixtureKind: 'independent projectless persisted test chat',
  originator: meta.originator, serverCLI: meta.cli_version, model: turn.model, reasoningEffort: turn.effort,
  startedAt: started.timestamp, completedAt: completed.timestamp, durationMs: completed.payload.duration_ms,
  assistantOutput: assistant, toolCalls, transcript, runtimeLog, handshake,
  nativeScreenshots: path.resolve('reverse/raw/checks/reconstruction-native-current')
}, null, 2))

#!/usr/bin/env node
// A real app-server turn through the replica's IPC bridge. No desktop input,
// document selection, screenshots, historical chats, or file edits are used.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { connectReplica } from './replica-cdp.mjs'
const output = resolve(process.argv[3] || 'reverse/raw/parity-2026-10-28/live-backend')
await mkdir(output, { recursive: true })
const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-live-parity-')))
const c = await connectReplica(Number(process.argv[2] || 9231))
const invoke = (method, params) => c.evaluate(`window.codex.invoke(${JSON.stringify(method)},${JSON.stringify(params)})`)
let threadId
try {
  const backend = await c.evaluate('window.codex.getBackendStatus()')
  assert.equal(backend.state, 'ready')
  const model = (await invoke('model/list', { includeHidden: false })).data[0].model
  threadId = (await invoke('thread/start', { cwd: root, model, permissions: ':workspace', ephemeral: false })).thread.id
  await invoke('thread/name/set', { threadId, name: `Replica live backend acceptance ${Date.now()}` })
  await c.evaluate(`window.__liveBackendParity={done:false,methods:{}};window.__liveBackendParityStop=window.codex.onNotification(n=>{
    const p=n.params;if(!p||p.threadId!==${JSON.stringify(threadId)})return;
    const s=window.__liveBackendParity;s.methods[n.method]=(s.methods[n.method]||0)+1;
    if(n.method==='turn/completed')s.done=true;
  })`)
  const result = await invoke('turn/start', {
    threadId, clientUserMessageId: randomUUID(), cwd: root, model, effort: 'low', permissions: ':workspace',
    input: [{ type: 'text', text: '这是复刻客户端的只读验收。请用执行命令工具运行 pwd 并用 sleep 2 等待两秒。不要读取或修改文件，不要调用其他工具。完成后只回复 codex-workbench-stream-ok。', text_elements: [] }]
  })
  await c.waitFor('window.__liveBackendParity.done', 120_000)
  const thread = (await invoke('thread/read', { threadId, includeTurns: true })).thread
  const turn = thread.turns.find(t => t.id === result.turn.id)
  assert.equal(turn?.status, 'completed')
  const commands = turn.items.filter(i => i.type === 'commandExecution')
  assert(commands.length > 0)
  assert(commands.every(i => i.exitCode === 0))
  const final = turn.items.filter(i => i.type === 'agentMessage' && i.phase === 'final_answer').map(i => i.text).join('')
  assert.equal(final.trim(), 'codex-workbench-stream-ok')
  const events = await c.evaluate('window.__liveBackendParity')
  const report = { backend, model, completed: true, commandCount: commands.length, commandExitCodes: commands.map(i => i.exitCode), final, notificationMethods: events.methods, graphicalAcceptance: false, runtimeExceptions: c.exceptions }
  assert.equal(c.exceptions, 0)
  await writeFile(join(output, 'turn.json'), JSON.stringify(turn, null, 2))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await c.evaluate('window.__liveBackendParityStop?.();delete window.__liveBackendParityStop;delete window.__liveBackendParity').catch(()=>{})
  if (threadId) await invoke('thread/delete', { threadId }).catch(error => console.error(error.message.slice(0,200)))
  c.close()
  await rm(root, { recursive: true, force: true })
}

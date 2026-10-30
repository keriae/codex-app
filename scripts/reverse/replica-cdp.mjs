// Deliberately accepts only the editable localhost renderer, never the installed app.
export async function connectReplica(port = 9231) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
  const target = targets.find(t => t.type === 'page' && /^http:\/\/localhost:5173\//.test(t.url))
  if (!target) throw new Error('Editable replica renderer is unavailable')
  return connectTarget(target)
}
export async function connectTarget(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let next = 1
  let exceptions = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Runtime.exceptionThrown') exceptions++
    if (!message.id) return
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, timeout = 10_000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const result = await evaluate(`Boolean(${expression})`)
      if (result) return result
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  const click = async selector => {
    const rect = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    if (!rect) throw new Error(`Missing ${selector}`)
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 })
  }
  await command('Runtime.enable')
  return { command, evaluate, waitFor, click, close: () => socket.close(), get exceptions() { return exceptions } }
}

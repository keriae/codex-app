#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const port = Number(process.argv[2])
const selector = process.argv[3]
const textNeedle = process.argv[4]
const output = process.argv[5] || null
const targetUrl = process.argv[6] || 'app://-/index.html'
const delayMs = Number(process.env.HOVER_DELAY_MS || 800)

if (!Number.isInteger(port) || !selector || textNeedle === undefined) {
  throw new Error('Usage: probe-hover-surface.mjs <port> <selector> <text> [screenshot] [url]')
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === targetUrl)
if (!target?.webSocketDebuggerUrl) throw new Error(`No ${targetUrl} page target on ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (!message.id) return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function command(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  return result.result.value
}

await command('Page.enable')
await command('Runtime.enable')
if (process.env.RESET_HOVER === '1') {
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 120 })
  await new Promise((resolve) => setTimeout(resolve, 1200))
}
const match = await evaluate(`(() => {
  const selector = ${JSON.stringify(selector)};
  const needle = ${JSON.stringify(textNeedle)};
  const candidates = [...document.querySelectorAll(selector)];
  const element = candidates.find((candidate) => candidate.textContent?.trim().includes(needle));
  if (!(element instanceof HTMLElement)) return null;
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, rect: {
    x: rect.x, y: rect.y, width: rect.width, height: rect.height
  }};
})()`)
if (!match) throw new Error(`No ${selector} containing ${JSON.stringify(textNeedle)}`)

await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: match.x, y: match.y })
await new Promise((resolve) => setTimeout(resolve, delayMs))

const result = await evaluate(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
    const fiberProps = [];
    if (fiberKey) {
      for (let fiber = element[fiberKey], index = 0; fiber && index < 20; fiber = fiber.return, index += 1) {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        const selected = Object.fromEntries(Object.entries(props).filter(([key, value]) =>
          ['delayDuration', 'disableHoverOpen', 'disabled', 'interactive', 'showProjectHoverCard', 'showPinActionOnHover', 'side', 'sideOffset'].includes(key) &&
          ['number', 'boolean', 'string'].includes(typeof value)
        ));
        if (Object.keys(selected).length) fiberProps.push(selected);
      }
    }
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      className: typeof element.className === 'string' ? element.className : null,
      text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 500) || '',
      rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
      style: {
        position: style.position,
        zIndex: style.zIndex,
        padding: style.padding,
        border: style.border,
        borderRadius: style.borderRadius,
        background: style.background,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        opacity: style.opacity
      },
      fiberProps,
      html: element.outerHTML.slice(0, 4000)
    };
  };
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const candidates = [...document.querySelectorAll('[role="tooltip"], [role="dialog"], [role="menu"], body > [data-radix-popper-content-wrapper], body > div')]
    .filter(visible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return element.getAttribute('role') || style.position === 'fixed' || style.position === 'absolute' || rect.x >= 500;
    });
  return {
    bodyTextTail: document.body.innerText.slice(-1800),
    candidates: candidates.slice(-80).map(describe)
  };
})()`)

if (output) {
  const screenshot = await command('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  })
  await writeFile(output, Buffer.from(screenshot.data, 'base64'))
}

process.stdout.write(`${JSON.stringify({ match, ...result }, null, 2)}\n`)
socket.close()

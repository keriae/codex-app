#!/usr/bin/env node

/**
 * Bounded, read-only Mermaid probe for the original Codex renderer.
 *
 * It imports the already bundled Mermaid helper through the renderer origin,
 * evaluates its theme-token mapping, and renders one synthetic diagram in the
 * helper's hidden disposable container. No user state, storage, or network
 * payloads are read or changed.
 *
 * Usage:
 *   node scripts/reverse/probe-original-mermaid.mjs \
 *     9224 FCC081FDB2FD5A78E52D381EE7930194 \
 *     app://-/assets/image-b55a08088b24.js
 */

const port = Number(process.argv[2] || 9224)
const targetNeedle = process.argv[3] || 'app://-/index.html'
const moduleUrl = process.argv[4] || 'app://-/assets/image-b55a08088b24.js'

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`CDP target discovery failed: ${response.status}`)
  return response.json()
})
const target =
  targets.find((candidate) => candidate.id === targetNeedle) ||
  targets.find((candidate) => candidate.url === targetNeedle) ||
  targets.find((candidate) => candidate.url?.includes(targetNeedle))
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No target matching ${JSON.stringify(targetNeedle)} on port ${port}`)
}

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

const expression = String.raw`(async () => {
  const moduleUrl = ${JSON.stringify(moduleUrl)};
  const module = await import(moduleUrl);
  if (typeof module.c !== 'function' || typeof module.u !== 'function') {
    throw new Error('Expected Mermaid theme/render exports were not found');
  }
  if (typeof module.a === 'function') module.a();

  const chatThemes = [null, 'default', 'green', 'yellow', 'pink', 'orange', 'purple', 'black'];
  const themeMatrix = {};
  for (const isDarkMode of [true, false]) {
    const mode = isDarkMode ? 'dark' : 'light';
    themeMatrix[mode] = {};
    for (const chatTheme of chatThemes) {
      const key = chatTheme == null ? 'automatic' : chatTheme;
      themeMatrix[mode][key] = module.c({ chatTheme: chatTheme ?? undefined, isDarkMode });
    }
  }

  const source = [
    'flowchart LR',
    '  A[Start] --> B{Decision}',
    '  B -->|Yes| C[Done]',
    '  B -->|No| D[Retry]'
  ].join('\n');
  const themeVariables = themeMatrix.dark.default;
  const svgMarkup = await module.u({
    source,
    themeVariables,
    isDarkMode: true,
    diagramId: 'codex-original-reverse-probe'
  });
  const template = document.createElement('template');
  template.innerHTML = svgMarkup || '';
  const svg = template.content.querySelector('svg');
  const renderHost = document.createElement('div');
  renderHost.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none';
  if (svg) renderHost.append(svg);
  document.body.append(renderHost);
  const selected = (selector) => [...renderHost.querySelectorAll(selector)].slice(0, 20).map((node) => ({
    tag: node.tagName.toLowerCase(),
    id: node.id || null,
    className: node.getAttribute('class'),
    attributes: Object.fromEntries([...node.attributes].map(({ name, value }) => [name, value])),
    fill: node.getAttribute('fill') || node.style?.fill || null,
    stroke: node.getAttribute('stroke') || node.style?.stroke || null,
    d: node.getAttribute('d'),
    text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  }));

  const cloned = typeof module.n === 'function' ? module.n(svg) : null;
  const computed = {
    edgeStroke: svg?.querySelector('.edgePaths .flowchart-link') == null
      ? null
      : getComputedStyle(svg.querySelector('.edgePaths .flowchart-link')).stroke,
    markerStroke: svg?.querySelector('marker[id$="-pointEnd"] path') == null
      ? null
      : getComputedStyle(svg.querySelector('marker[id$="-pointEnd"] path')).stroke
  };
  const result = {
    moduleUrl,
    exports: Object.keys(module).sort(),
    documentTheme: document.documentElement.dataset.theme || null,
    themeMatrix,
    rendered: {
      source,
      svgPresent: Boolean(svg),
      svgAttributes: svg == null ? null : Object.fromEntries([...svg.attributes].map(({ name, value }) => [name, value])),
      viewBox: svg?.getAttribute('viewBox') || null,
      nodes: selected('.node'),
      nodeShapes: selected('.node .label-container, .node .basic.label-container'),
      edgeLabels: selected('.edgeLabel'),
      edgePaths: selected('.edgePaths .flowchart-link'),
      markers: selected('marker'),
      markerPaths: selected('marker path'),
      computed,
      clonedImage: cloned == null ? null : {
        width: cloned.width,
        height: cloned.height,
        srcPrefix: String(cloned.src).slice(0, 80),
        srcLength: String(cloned.src).length
      },
      markupLength: svgMarkup?.length || 0
    }
  };
  renderHost.remove();
  return result;
})()`

try {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: false
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`)
} finally {
  socket.close()
}

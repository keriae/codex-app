#!/usr/bin/env node

/**
 * Read-only, selector-focused CDP probe for the original Codex UI.
 *
 * Usage:
 *   node scripts/reverse/probe-original-dom.mjs 9224 app://-/index.html \
 *     '.group\\/agent-activity' '._MarkdownRoot_1fgd0_2'
 */

const port = Number(process.argv[2] || 9224)
const targetNeedle = process.argv[3] || 'app://-/index.html'
const cdpHost = process.env.CODEX_CDP_HOST || '127.0.0.1'
const probeArguments = process.argv.slice(4)
const selectors = probeArguments.filter((argument) => !argument.startsWith('--'))
const limitArgument = probeArguments.find((argument) => argument.startsWith('--limit='))
const matchLimit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : 30
const reverseMatches = probeArguments.includes('--reverse')
const includeMatchedCss = !probeArguments.includes('--no-css')
if (!selectors.length) throw new Error('At least one CSS selector is required')
if (!Number.isInteger(matchLimit) || matchLimit < 1 || matchLimit > 100) {
  throw new Error('--limit must be an integer from 1 through 100')
}

const targets = await fetch(`http://${cdpHost}:${port}/json/list`).then((response) => {
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
const styleSheetHeaders = new Map()
let nextId = 1

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === 'CSS.styleSheetAdded') {
    const header = message.params?.header
    if (header?.styleSheetId) styleSheetHeaders.set(header.styleSheetId, header)
    return
  }
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

await command('DOM.enable')
await command('CSS.enable')
await command('Runtime.enable')
const documentNode = await command('DOM.getDocument', { depth: -1, pierce: true })

const describeFunction = String.raw`function () {
  const clean = (value, max = 200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const round = (value) => Math.round(value * 100) / 100;
  const safeAttributes = (element) => {
    const output = {};
    for (const attribute of element.attributes || []) {
      const name = attribute.name;
      if (
        name === 'class' || name === 'id' || name === 'role' || name === 'title' ||
        name.startsWith('aria-') ||
        /^(data-(testid|state|slot|spacing|multiline|markdown-text-style|summary-panel-variant|summary-panel-density|thread-scroll-footer|virtualized-turn-content|agent-activity-file-link))$/.test(name)
      ) output[name] = clean(attribute.value, 500);
    }
    return output;
  };
  const describe = (element) => {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      attributes: safeAttributes(element),
      ownText: clean([...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ')),
      text: clean(element.textContent),
      rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
      style: {
        display: style.display,
        position: style.position,
        width: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        height: style.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        overflow: style.overflow,
        color: style.color,
        backgroundColor: style.backgroundColor,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        padding: style.padding,
        margin: style.margin,
        gap: style.gap,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        opacity: style.opacity,
        transform: style.transform,
        cursor: style.cursor,
        zIndex: style.zIndex
      }
    };
  };
  const ancestors = [];
  for (let element = this.parentElement, index = 0; element && index < 12; element = element.parentElement, index += 1) {
    ancestors.push(describe(element));
  }
  const fiberKey = Object.keys(this).find((key) => key.startsWith('__reactFiber$'));
  const fiber = [];
  if (fiberKey) {
    for (let node = this[fiberKey], index = 0; node && index < 36; node = node.return, index += 1) {
      const type = node.elementType || node.type;
      const name = typeof type === 'string' ? type : type?.displayName || type?.name || type?.render?.displayName || type?.render?.name || null;
      fiber.push({
        name,
        tag: node.tag,
        propKeys: node.memoizedProps && typeof node.memoizedProps === 'object'
          ? Object.keys(node.memoizedProps).sort().slice(0, 100)
          : [],
        numericProps: node.memoizedProps && typeof node.memoizedProps === 'object'
          ? Object.fromEntries(Object.entries(node.memoizedProps)
              .filter(([key, value]) => [
                'currentSize', 'defaultSize', 'maximumSize', 'minimumSize',
                'leftPanelWidth', 'minimumWidth', 'shellWidth', 'viewportWidth',
                'visibleWidth', 'visibleLeftPanelWidth', 'closedLeftPanelWidth'
              ].includes(key) && typeof value === 'number'))
          : {}
      });
    }
  }
  return {
    element: describe(this),
    ancestors,
    children: [...this.children].slice(0, 80).map(describe),
    fiber
  };
}`

const cleanStyles = (matched) => {
  const rules = []
  for (const entry of matched?.matchedCSSRules || []) {
    const rule = entry.rule
    if (!rule) continue
    const properties = (rule.style?.cssProperties || [])
      .filter((property) => property.value && !property.disabled)
      .map((property) => ({
        name: property.name,
        value: property.value,
        important: Boolean(property.important)
      }))
    rules.push({
      origin: rule.origin,
      selector: rule.selectorList?.text || '',
      sourceUrl: styleSheetHeaders.get(rule.styleSheetId)?.sourceURL || null,
      range: rule.style?.range || null,
      properties
    })
  }
  return rules
}

const output = {
  target: { id: target.id, type: target.type, url: target.url, title: target.title },
  selectors: []
}

for (const selector of selectors) {
  const query = await command('DOM.querySelectorAll', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  const matches = []
  const selectedNodeIds = (reverseMatches ? [...query.nodeIds].reverse() : query.nodeIds).slice(
    0,
    matchLimit
  )
  for (const nodeId of selectedNodeIds) {
    const resolved = await command('DOM.resolveNode', { nodeId })
    const objectId = resolved.object?.objectId
    if (!objectId) continue
    const described = await command('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: describeFunction,
      returnByValue: true,
      awaitPromise: true
    })
    let matched = null
    if (includeMatchedCss) {
      try {
        matched = await command('CSS.getMatchedStylesForNode', { nodeId })
      } catch {
        // Some embedded/replaced nodes do not expose matched CSS rules.
      }
    }
    matches.push({
      nodeId,
      ...described.result.value,
      matchedRules: cleanStyles(matched)
    })
    await command('Runtime.releaseObject', { objectId })
  }
  output.selectors.push({ selector, total: query.nodeIds.length, matches })
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
socket.close()

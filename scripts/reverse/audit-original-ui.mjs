#!/usr/bin/env node

/**
 * Read-only UI inventory for the original Codex renderer exposed through CDP.
 *
 * The script intentionally avoids cookies, storage values, network bodies, and
 * unrestricted page text. It records UI structure, computed styles, resource
 * names, test IDs, and bounded labels useful for parity work.
 */

const port = Number(process.argv[2] || 9224)
const targetNeedle = process.argv[3] || 'app://-/index.html'
const endpoint = `http://127.0.0.1:${port}/json/list`

const targets = await fetch(endpoint).then((response) => {
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

const expression = String.raw`(() => {
  const round = (number) => Math.round(number * 100) / 100;
  const cleanText = (value, max = 160) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  const cleanUrl = (value) => {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.origin + url.pathname
        : url.protocol + '//' + url.host + url.pathname;
    } catch {
      return cleanText(value, 240);
    }
  };
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const describe = (element) => {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const attributes = {};
    for (const name of ['role', 'aria-label', 'aria-expanded', 'aria-pressed', 'title', 'data-testid', 'data-state', 'data-slot']) {
      const value = element.getAttribute(name);
      if (value != null) attributes[name] = cleanText(value, 160);
    }
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: cleanText(element.getAttribute('class'), 600) || null,
      attributes,
      text: cleanText(element.textContent),
      rect: {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height)
      },
      style: {
        display: style.display,
        position: style.position,
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
        padding: style.padding,
        margin: style.margin,
        gap: style.gap,
        opacity: style.opacity,
        transform: style.transform,
        zIndex: style.zIndex
      }
    };
  };
  const unique = (values) => [...new Set(values)].sort();
  const all = [...document.querySelectorAll('*')];
  const classCounts = new Map();
  for (const element of all) {
    for (const token of element.classList || []) {
      classCounts.set(token, (classCounts.get(token) || 0) + 1);
    }
  }
  const markerPattern = /(markdown|mermaid|message|turn|activity|reason|command|tool|composer|thread|diagram|visuali|copy|preview|zoom|pan)/i;
  const markerElements = all.filter((element) => {
    const marker = [
      element.id,
      element.getAttribute('class'),
      element.getAttribute('data-testid'),
      element.getAttribute('aria-label'),
      element.getAttribute('title')
    ].filter(Boolean).join(' ');
    return markerPattern.test(marker) && visible(element);
  });
  const labelPattern = /(正在开启聊天|正在思考|已处理|用时|复制|停止|预览|放大|缩小|重置|全屏|mermaid)/i;
  const labelledElements = all.filter((element) => {
    if (!visible(element)) return false;
    const ownText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ');
    return labelPattern.test(ownText) || labelPattern.test(element.getAttribute('aria-label') || '') || labelPattern.test(element.getAttribute('title') || '');
  });
  const reactInfo = (element) => {
    if (!(element instanceof Element)) return null;
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) return null;
    let fiber = element[fiberKey];
    const chain = [];
    for (let index = 0; fiber && index < 24; index += 1, fiber = fiber.return) {
      const type = fiber.elementType || fiber.type;
      const name = typeof type === 'string'
        ? type
        : type?.displayName || type?.name || type?.render?.displayName || type?.render?.name || null;
      const props = fiber.memoizedProps && typeof fiber.memoizedProps === 'object'
        ? Object.keys(fiber.memoizedProps).sort().slice(0, 60)
        : [];
      chain.push({ name, tag: fiber.tag, propKeys: props });
    }
    return chain;
  };
  const reactSamples = [...new Set([...markerElements, ...labelledElements])]
    .slice(0, 40)
    .map((element) => ({ element: describe(element), fiber: reactInfo(element) }));
  const stylesheets = [...document.styleSheets].map((sheet) => ({
    href: sheet.href ? cleanUrl(sheet.href) : null,
    owner: sheet.ownerNode ? describe(sheet.ownerNode) : null
  }));
  const resources = performance.getEntriesByType('resource')
    .map((entry) => cleanUrl(entry.name))
    .filter((name) => markerPattern.test(name));
  const cssVariables = {};
  const rootStyle = getComputedStyle(document.documentElement);
  for (const name of [...rootStyle]) {
    if (!name.startsWith('--')) continue;
    if (!/(background|foreground|text|border|radius|spacing|font|color|surface|sidebar|composer|thread)/i.test(name)) continue;
    cssVariables[name] = cleanText(rootStyle.getPropertyValue(name), 160);
  }
  return {
    target: {
      url: cleanUrl(location.href),
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }
    },
    document: {
      elementCount: all.length,
      body: describe(document.body),
      semantic: [...document.querySelectorAll('main, aside, nav, article, section, form, [role], [contenteditable="true"]')]
        .filter(visible)
        .slice(0, 260)
        .map(describe),
      testIds: unique(all.map((element) => element.getAttribute('data-testid')).filter(Boolean)),
      classTokens: [...classCounts.entries()]
        .filter(([name]) => markerPattern.test(name))
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 300)
        .map(([name, count]) => ({ name, count })),
      markerElements: markerElements.slice(0, 300).map(describe),
      labelledElements: labelledElements.slice(0, 160).map(describe),
      reactSamples,
      webviews: [...document.querySelectorAll('webview, iframe')].map(describe)
    },
    assets: {
      scripts: [...document.scripts].map((script) => ({ src: script.src ? cleanUrl(script.src) : null, inlineLength: script.src ? 0 : script.textContent.length })),
      stylesheets,
      relevantResources: unique(resources)
    },
    cssVariables
  };
})()`

const result = await command('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true
})

if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
}

process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`)
socket.close()

#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.argv[2] || 9225)
const outputDirectory = resolve(
  process.argv[3] || 'reverse/raw/checks/mermaid'
)
await mkdir(outputDirectory, { recursive: true })
const downloadDirectory = resolve(outputDirectory, 'downloads')
await mkdir(downloadDirectory, { recursive: true })

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const target = targets.find((candidate) => candidate.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error(`No page target exposed on port ${port}`)

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
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})

function command(method, params = {}) {
  const id = nextId++
  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Evaluation failed')
  return response.result.value
}

const pause = (duration = 50) => new Promise((resolvePause) => setTimeout(resolvePause, duration))

async function waitFor(expression, timeout = 120_000) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    value = await evaluate(expression)
    if (value) return value
    await pause()
  }
  throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(value)}`)
}

async function rect(selector, index = 0) {
  return evaluate(`(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  })()`)
}

async function hover(selector, index = 0) {
  await evaluate(`(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    element?.scrollIntoView({ block: 'center', inline: 'center' });
  })()`)
  await pause(50)
  const box = await rect(selector, index)
  if (!box) throw new Error(`Missing hover target: ${selector}[${index}]`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

async function click(selector, index = 0) {
  await evaluate(`(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    element?.scrollIntoView({ block: 'center', inline: 'center' });
  })()`)
  await pause(50)
  const box = await rect(selector, index)
  if (!box) throw new Error(`Missing click target: ${selector}[${index}]`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

async function clickDiagramButtonBySource(sourceNeedle, ariaLabel) {
  const revealed = await evaluate(`(() => {
    const diagram = [...document.querySelectorAll('.mermaid-diagram')]
      .find((candidate) => candidate.getAttribute('data-markdown-copy-text')?.includes(${JSON.stringify(sourceNeedle)}));
    const button = [...(diagram?.querySelectorAll('.mermaid-diagram-actions button') || [])]
      .find((candidate) => candidate.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)});
    if (!button) return false;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`)
  if (!revealed) {
    throw new Error(
      `Missing diagram button ${JSON.stringify(ariaLabel)} for source ${JSON.stringify(sourceNeedle)}`
    )
  }
  const deadline = Date.now() + 3_000
  let previousBox = null
  let box = null
  while (Date.now() < deadline) {
    const candidate = await evaluate(`(() => {
      const diagram = [...document.querySelectorAll('.mermaid-diagram')]
        .find((item) => item.getAttribute('data-markdown-copy-text')?.includes(${JSON.stringify(sourceNeedle)}));
      const button = [...(diagram?.querySelectorAll('.mermaid-diagram-actions button') || [])]
        .find((item) => item.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)});
      if (!button) return null;
      const value = button.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    })()`)
    if (
      candidate &&
      previousBox &&
      Math.abs(candidate.x - previousBox.x) < 0.5 &&
      Math.abs(candidate.y - previousBox.y) < 0.5 &&
      Math.abs(candidate.width - previousBox.width) < 0.5 &&
      Math.abs(candidate.height - previousBox.height) < 0.5
    ) {
      box = candidate
      break
    }
    previousBox = candidate
    await pause(50)
  }
  if (!box) {
    throw new Error(
      `Missing diagram button ${JSON.stringify(ariaLabel)} for source ${JSON.stringify(sourceNeedle)}`
    )
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

async function settleAnimationFrames(count = 2) {
  await evaluate(`new Promise((resolve) => {
    let remaining = ${count};
    const fallback = setTimeout(resolve, 100);
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimeout(fallback);
        resolve(true);
      } else {
        requestAnimationFrame(next);
      }
    };
    requestAnimationFrame(next);
  })`)
}

async function screenshot(name) {
  const result = await command('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  })
  const path = resolve(outputDirectory, `${name}.png`)
  await writeFile(path, Buffer.from(result.data, 'base64'))
  return path
}

async function downloadedPngs() {
  const names = (await readdir(downloadDirectory))
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort()
  const snapshots = []
  for (const name of names) {
    const path = resolve(downloadDirectory, name)
    try {
      const metadata = await stat(path, { bigint: true })
      snapshots.push({
        name,
        fingerprint: [
          metadata.dev,
          metadata.ino,
          metadata.size,
          metadata.birthtimeNs,
          metadata.mtimeNs,
          metadata.ctimeNs
        ].join(':')
      })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return snapshots
}

async function waitForDownloadedPng(previous, timeout = 20_000) {
  const before = new Map(previous.map(({ name, fingerprint }) => [name, fingerprint]))
  const deadline = Date.now() + timeout
  let lastCandidate = null
  while (Date.now() < deadline) {
    const current = await downloadedPngs()
    const candidate = current.find(
      ({ name, fingerprint }) => before.get(name) !== fingerprint
    )
    if (candidate) {
      const { name, fingerprint } = candidate
      const path = resolve(downloadDirectory, name)
      let bytes
      try {
        bytes = await readFile(path)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          lastCandidate = null
          await pause(50)
          continue
        }
        throw error
      }
      const stable = lastCandidate?.name === name && lastCandidate.fingerprint === fingerprint
      lastCandidate = { name, fingerprint }
      if (
        stable &&
        bytes.length >= 24 &&
        bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      ) {
        return {
          name,
          path,
          size: bytes.length,
          signature: bytes.subarray(0, 8).toString('hex'),
          width: bytes.readUInt32BE(16),
          height: bytes.readUInt32BE(20)
        }
      }
    }
    await pause(50)
  }
  throw new Error('Timed out waiting for Mermaid PNG download')
}

async function pressKey(key, code, windowsVirtualKeyCode, modifiers = 0) {
  await command('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers
  })
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers
  })
}

let phase = 'enable-cdp'
try {
await command('Page.enable')
await command('Runtime.enable')
try {
  await command('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory,
    eventsEnabled: true
  })
} catch {
  await command('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory
  })
}

phase = 'recover-overlay-and-create-chat'
const emptyComposerExpression = `Boolean(document.querySelector('.composer-dock.empty textarea'))`
if (await evaluate(`Boolean(document.querySelector('.diagram-lightbox'))`)) {
  await pressKey('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('.diagram-lightbox')`, 2_000)
}
await click('button[aria-label="New chat"]')
try {
  await waitFor(emptyComposerExpression, 1_500)
} catch {
  const activated = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="New chat"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`)
  if (!activated) throw new Error('Missing New chat button')
  await waitFor(emptyComposerExpression)
}

await evaluate(`(() => {
  window.__codexMermaidTrace = { loadingSeen: false, maxLoading: 0, maxReady: 0 };
  window.__codexMermaidObserver?.disconnect?.();
  const record = () => {
    const loading = [...document.querySelectorAll('.mermaid-diagram-loading')]
      .filter((element) => element.textContent?.trim() === '正在加载图表').length;
    const ready = document.querySelectorAll('.mermaid-diagram-svg svg').length;
    window.__codexMermaidTrace.loadingSeen ||= loading > 0;
    window.__codexMermaidTrace.maxLoading = Math.max(window.__codexMermaidTrace.maxLoading, loading);
    window.__codexMermaidTrace.maxReady = Math.max(window.__codexMermaidTrace.maxReady, ready);
  };
  const observer = new MutationObserver(record);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.__codexMermaidObserver = observer;
  record();
})()`)

const roadmapSentinel = '阶段 13 · 全量发布与持续改进'
const prompt = [
  'Reply with exactly this Markdown and nothing else:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Start] --> B{Decision}',
  '  B -->|Yes| C[Done]',
  '  B -->|No| D[Retry]',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  participant U as 用户',
  '  participant C as Codex',
  '  U->>C: 请求',
  '  C-->>U: 完成',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  R00["阶段 00 · 明确年度目标与成功指标"] --> R01["阶段 01 · 用户研究与问题空间确认"]',
  '  R01 --> R02["阶段 02 · 产品方案和交互原型评审"]',
  '  R02 --> G1{"架构与安全评审是否通过？"}',
  '  G1 -- "补充材料" --> F1["风险清单、性能预算与回滚预案"]',
  '  F1 --> R03["阶段 03 · 核心架构和数据模型冻结"]',
  '  G1 -- "通过" --> R03',
  '  R03 --> R04["阶段 04 · 桌面端基础框架与导航"]',
  '  R04 --> R05["阶段 05 · 会话生命周期和流式响应"]',
  '  R05 --> R06["阶段 06 · 工具调用、审批和错误恢复"]',
  '  R06 --> R07["阶段 07 · Mermaid、代码块与富媒体"]',
  '  R07 --> G2{"端到端质量门禁是否全部通过？"}',
  '  G2 -- "修复回归" --> F2["视觉差异、无障碍和稳定性整改"]',
  '  F2 --> R08["阶段 08 · Worktree 与多会话协同"]',
  '  G2 -- "通过" --> R08',
  '  R08 --> R09["阶段 09 · 自动化、市场和插件目录"]',
  '  R09 --> R10["阶段 10 · 语音、通知和系统集成"]',
  '  R10 --> R11["阶段 11 · 大规模性能与故障演练"]',
  '  R11 --> R12["阶段 12 · 灰度发布和遥测观察"]',
  `  R12 --> R13["${roadmapSentinel}"]`,
  '```'
].join('\n')
phase = 'submit-complex-mermaid-fixture'
await click('.composer textarea')
await command('Input.insertText', { text: prompt })
await waitFor(`document.querySelector('.composer .send-button.send')?.disabled === false`)
await click('.composer .send-button.send')
phase = 'wait-for-three-rendered-diagrams'
await waitFor(`document.querySelectorAll('.mermaid-diagram-svg svg').length === 3 &&
  !document.querySelector('.composer .send-button.stop')`)

phase = 'capture-inline-and-synthetic-metrics'
const inline = await evaluate(`(() => {
  window.__codexMermaidObserver?.disconnect?.();
  const diagrams = [...document.querySelectorAll('.mermaid-diagram')];
  const actions = document.querySelectorAll('.mermaid-diagram-actions button');
  const answerActions = document.querySelectorAll('.agent-message-actions button');
  const boxes = diagrams.map((diagram) => {
    const box = diagram.getBoundingClientRect();
    const preview = diagram.querySelector('.mermaid-preview');
    const stage = diagram.querySelector('.mermaid-diagram-layer')?.getBoundingClientRect();
    const svg = diagram.querySelector('svg')?.getBoundingClientRect();
    const sourceSvg = diagram.querySelector('svg');
    const viewBox = sourceSvg?.viewBox?.baseVal;
    const nodes = sourceSvg ? [...sourceSvg.querySelectorAll('.node')] : [];
    const pointEnd = sourceSvg?.querySelector('marker[id$="-pointEnd"]');
    return {
      source: diagram.getAttribute('data-markdown-copy-text'),
      width: box.width,
      parentWidth: diagram.parentElement?.getBoundingClientRect().width || null,
      minHeight: preview ? parseFloat(getComputedStyle(preview).minHeight) : null,
      stageHeight: stage?.height || null,
      svgWidth: svg?.width || null,
      svgHeight: svg?.height || null,
      naturalWidth: Number(sourceSvg?.getAttribute('width')) || viewBox?.width || null,
      naturalHeight: Number(sourceSvg?.getAttribute('height')) || viewBox?.height || null,
      viewBox: viewBox ? {
        x: viewBox.x,
        y: viewBox.y,
        width: viewBox.width,
        height: viewBox.height
      } : null,
      flowchart: sourceSvg ? {
        nodeCount: nodes.length,
        decisionCount: sourceSvg.querySelectorAll('.node.mermaid-decision').length,
        nodeShapeHeights: nodes.map((node) => {
          const shape = node.querySelector(':scope > rect, :scope > polygon, :scope > path, .label-container');
          return shape instanceof SVGGraphicsElement ? shape.getBBox().height : null;
        }),
        edgeCount: sourceSvg.querySelectorAll('.edgePaths .flowchart-link').length,
        edgeStrokes: [...sourceSvg.querySelectorAll('.edgePaths .flowchart-link')]
          .map((edge) => getComputedStyle(edge).stroke),
        markerCount: sourceSvg.querySelectorAll('marker').length,
        markerIds: [...sourceSvg.querySelectorAll('marker')].map((marker) => marker.id),
        pointEnd: pointEnd ? {
          viewBox: pointEnd.getAttribute('viewBox'),
          markerWidth: pointEnd.getAttribute('markerWidth'),
          markerHeight: pointEnd.getAttribute('markerHeight'),
          refX: pointEnd.getAttribute('refX'),
          refY: pointEnd.getAttribute('refY'),
          path: pointEnd.querySelector('path')?.getAttribute('d') || null,
          stroke: pointEnd.querySelector('path')
            ? getComputedStyle(pointEnd.querySelector('path')).stroke
            : null
        } : null
      } : null
    };
  });
  return {
    trace: window.__codexMermaidTrace,
    count: diagrams.length,
    boxes,
    background: diagrams[0] ? getComputedStyle(diagrams[0]).backgroundColor : null,
    actionCount: actions.length,
    answerActionCount: answerActions.length
  };
})()`)
const wideDiagramIndex = inline.boxes.reduce(
  (largestIndex, box, index, boxes) =>
    (box.naturalWidth || 0) > (boxes[largestIndex]?.naturalWidth || 0) ? index : largestIndex,
  0
)

await hover('.mermaid-diagram-actions', 0)
await waitFor(`(() => {
  const actions = document.querySelectorAll('.mermaid-diagram-actions')[0];
  return actions && Number.parseFloat(getComputedStyle(actions).opacity) === 1;
})()`)
await settleAnimationFrames()
const inlineActionOpacityAtCapture = await evaluate(`(() => {
  const actions = document.querySelectorAll('.mermaid-diagram-actions')[0];
  return actions ? Number.parseFloat(getComputedStyle(actions).opacity) : null;
})()`)
const inlineScreenshot = await screenshot('01-inline-diagram')

phase = 'capture-stable-inline-menu'
await click('.mermaid-diagram-menu-anchor > button', 0)
const menu = await waitFor(`(() => {
  const menu = document.querySelector('.mermaid-diagram-menu');
  return menu ? [...menu.querySelectorAll('button')].map((button) => button.textContent?.trim()) : null;
})()`)
await waitFor(`(() => {
  const menu = document.querySelector('.mermaid-diagram-menu');
  const actions = menu?.closest('.mermaid-diagram-actions');
  return menu && actions &&
    Number.parseFloat(getComputedStyle(menu).opacity) === 1 &&
    Number.parseFloat(getComputedStyle(actions).opacity) === 1;
})()`)
await settleAnimationFrames()
const menuPresentation = await evaluate(`(() => {
  const menu = document.querySelector('.mermaid-diagram-menu');
  const actions = menu?.closest('.mermaid-diagram-actions');
  const trigger = menu?.parentElement?.querySelector(':scope > button');
  if (!menu || !actions || !trigger) return null;
  const box = (element) => {
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  };
  const items = [...menu.querySelectorAll('button')];
  const copyItem = items.find((button) => button.textContent?.trim() === '复制为代码');
  const copyIcon = copyItem?.querySelector('svg');
  const iconClass = copyIcon?.getAttribute('class') || '';
  return {
    actionOpacity: Number.parseFloat(getComputedStyle(actions).opacity),
    menuOpacity: Number.parseFloat(getComputedStyle(menu).opacity),
    menuRect: box(menu),
    menuBackground: getComputedStyle(menu).backgroundColor,
    itemRects: items.map(box),
    itemFontSizes: items.map((item) => Number.parseFloat(getComputedStyle(item).fontSize)),
    itemLineHeights: items.map((item) => getComputedStyle(item).lineHeight),
    triggerRect: box(trigger),
    triggerBorderRadius: getComputedStyle(trigger).borderRadius,
    copyIcon: copyIcon ? {
      className: iconClass,
      semanticName: iconClass.split(/\\s+/).find((name) => name.startsWith('lucide-') && name !== 'lucide') || null,
      pathData: [...copyIcon.querySelectorAll('path')].map((path) => path.getAttribute('d')),
      isCodeSemantic: /(?:^|\\s)lucide-(?:code|code-xml|braces)(?:$|\\s)/.test(iconClass),
      isCopySemantic: /(?:^|\\s)lucide-copy(?:$|\\s)/.test(iconClass)
    } : null
  };
})()`)
const menuScreenshot = await screenshot('02-inline-menu')

phase = 'download-inline-png'
await evaluate(`(() => {
  const prototype = CanvasRenderingContext2D.prototype;
  window.__codexMermaidExportTrace = [];
  window.__codexMermaidOriginalFillRect ||= prototype.fillRect;
  prototype.fillRect = function (...args) {
    window.__codexMermaidExportTrace.push({
      fillStyle: this.fillStyle,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      args
    });
    return window.__codexMermaidOriginalFillRect.apply(this, args);
  };
})()`)
const beforeInlineDownload = await downloadedPngs()
await click('.mermaid-diagram-menu button:last-child')
const inlineDownload = await waitForDownloadedPng(beforeInlineDownload)
const exportTrace = await evaluate(`(() => {
  const trace = window.__codexMermaidExportTrace || [];
  const prototype = CanvasRenderingContext2D.prototype;
  if (window.__codexMermaidOriginalFillRect) {
    prototype.fillRect = window.__codexMermaidOriginalFillRect;
  }
  delete window.__codexMermaidOriginalFillRect;
  delete window.__codexMermaidExportTrace;
  const context = document.createElement('canvas').getContext('2d');
  if (context) context.fillStyle = getComputedStyle(document.querySelector('.main-panel')).backgroundColor;
  return { trace, expectedBackground: context?.fillStyle || null };
})()`)

phase = 'open-wide-roadmap-viewer'
await evaluate(`(() => {
  window.__codexViewerTrace = {
    shellWithoutContentSeen: false,
    contentSeen: false,
    shellAt: null,
    contentAt: null,
    events: []
  };
  window.__codexViewerObserver?.disconnect?.();
  const record = () => {
    const shell = document.querySelector('.diagram-lightbox');
    const content = shell?.querySelector('.diagram-lightbox-canvas');
    const now = performance.now();
    if (shell && !content) {
      window.__codexViewerTrace.shellWithoutContentSeen = true;
      window.__codexViewerTrace.shellAt ??= now;
      if (window.__codexViewerTrace.events.at(-1)?.state !== 'shell') {
        window.__codexViewerTrace.events.push({ state: 'shell', at: now });
      }
    }
    if (shell && content) {
      window.__codexViewerTrace.contentSeen = true;
      window.__codexViewerTrace.contentAt ??= now;
      if (window.__codexViewerTrace.events.at(-1)?.state !== 'content') {
        window.__codexViewerTrace.events.push({ state: 'content', at: now });
      }
    }
  };
  const observer = new MutationObserver(record);
  observer.observe(document.body, { childList: true, subtree: true });
  window.__codexViewerObserver = observer;
  record();
})()`)
await clickDiagramButtonBySource(roadmapSentinel, '展开图表')
const fullscreen = await waitFor(`(() => {
  const lightbox = document.querySelector('.diagram-lightbox');
  const canvas = document.querySelector('.diagram-lightbox-canvas');
  const viewport = document.querySelector('.diagram-lightbox-viewport');
  if (!lightbox || !canvas || !viewport) return null;
  window.__codexViewerObserver?.disconnect?.();
  const sourceDiagram = [...document.querySelectorAll('.mermaid-diagram')]
    .find((candidate) => candidate.getAttribute('data-markdown-copy-text')?.includes(${JSON.stringify(roadmapSentinel)}));
  const sourceSvg = sourceDiagram?.querySelector('.mermaid-diagram-svg svg');
  const viewBox = sourceSvg?.viewBox?.baseVal;
  const naturalWidth = Number(sourceSvg?.getAttribute('width')) || viewBox?.width || 0;
  const naturalHeight = Number(sourceSvg?.getAttribute('height')) || viewBox?.height || 0;
  const availableWidth = viewport.clientWidth - 32;
  const availableHeight = viewport.clientHeight - 32;
  const expectedFit = Math.max(0.1, Math.min(
    1,
    availableWidth / naturalWidth,
    availableHeight / naturalHeight
  ));
  const expectedZoom = Math.round(expectedFit * 100) + '%';
  const zoom = document.querySelector('.diagram-lightbox-zoom');
  const zoomText = zoom?.querySelector('span')?.textContent?.trim();
  if (zoomText !== expectedZoom) return null;
  const topActionBoxes = [...document.querySelectorAll('.diagram-lightbox-actions button')]
    .map((button) => button.getBoundingClientRect());
  const zoomActionBoxes = [...document.querySelectorAll('.diagram-lightbox-zoom button')]
    .map((button) => button.getBoundingClientRect());
  const canvasBox = canvas.getBoundingClientRect();
  const viewportBox = viewport.getBoundingClientRect();
  const availableCenterX = viewportBox.x + viewportBox.width / 2;
  const availableCenterY = viewportBox.y + viewportBox.height / 2;
  return {
    shellWithoutContentSeen: window.__codexViewerTrace?.shellWithoutContentSeen === true,
    contentSeen: window.__codexViewerTrace?.contentSeen === true,
    shellAt: window.__codexViewerTrace?.shellAt || null,
    contentAt: window.__codexViewerTrace?.contentAt || null,
    lifecycleEvents: window.__codexViewerTrace?.events || [],
    zoom: zoomText,
    expectedZoom,
    expectedFit,
    topActions: document.querySelectorAll('.diagram-lightbox-actions button').length,
    topActionSizes: topActionBoxes.map((box) => [box.width, box.height]),
    topActionBackgrounds: [...document.querySelectorAll('.diagram-lightbox-actions button')]
      .map((button) => getComputedStyle(button).backgroundColor),
    zoomActionSizes: zoomActionBoxes.map((box) => [box.width, box.height]),
    zoomActionBackgrounds: [...document.querySelectorAll('.diagram-lightbox-zoom button')]
      .map((button) => getComputedStyle(button).backgroundColor),
    hasHeader: Boolean(document.querySelector('.diagram-lightbox-header')),
    overlayBackground: getComputedStyle(lightbox).backgroundColor,
    viewportBackground: getComputedStyle(viewport).backgroundColor,
    zoomBackground: zoom ? getComputedStyle(zoom).backgroundColor : null,
    viewportOverflowX: getComputedStyle(viewport).overflowX,
    viewportOverflowY: getComputedStyle(viewport).overflowY,
    viewportRect: {
      x: viewportBox.x,
      y: viewportBox.y,
      width: viewportBox.width,
      height: viewportBox.height
    },
    canvasRect: {
      x: canvasBox.x,
      y: canvasBox.y,
      width: canvasBox.width,
      height: canvasBox.height
    },
    centerDelta: {
      x: canvasBox.x + canvasBox.width / 2 - availableCenterX,
      y: canvasBox.y + canvasBox.height / 2 - availableCenterY
    },
    canvasTransform: canvas.style.transform,
    availableWidth,
    availableHeight,
    naturalWidth,
    naturalHeight
  };
})()`)
await pause(180)
const fullscreenScreenshot = await screenshot('03-fullscreen-fit')

phase = 'exercise-zoom-pan-and-clipping'
const initialZoom = Number.parseInt(fullscreen.zoom, 10)
await click('button[aria-label="放大"]')
const zoomAfterPlus = await waitFor(`(() => {
  const value = Number.parseInt(document.querySelector('.diagram-lightbox-zoom span')?.textContent || '', 10);
  return value > ${initialZoom} ? value : null;
})()`)
await pause(180)
const panBefore = await evaluate(`(() => {
  const canvas = document.querySelector('.diagram-lightbox-canvas');
  const viewport = document.querySelector('.diagram-lightbox-viewport');
  if (!canvas || !viewport) return null;
  const canvasBox = canvas.getBoundingClientRect();
  const viewportBox = viewport.getBoundingClientRect();
  return {
    transform: canvas.style.transform,
    canvasRect: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
    viewportRect: { x: viewportBox.x, y: viewportBox.y, width: viewportBox.width, height: viewportBox.height }
  };
})()`)
const dragViewportBox = await rect('.diagram-lightbox-viewport')
const dragStart = {
  x: dragViewportBox.x + dragViewportBox.width / 2,
  y: dragViewportBox.y + dragViewportBox.height / 2
}
const dragEnd = {
  x: dragStart.x + Math.min(140, dragViewportBox.width / 8),
  y: dragStart.y + Math.min(70, dragViewportBox.height / 8)
}
await command('Input.dispatchMouseEvent', {
  type: 'mouseMoved',
  x: dragStart.x,
  y: dragStart.y
})
await command('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: dragStart.x,
  y: dragStart.y,
  button: 'left',
  buttons: 1,
  clickCount: 1
})
await pause(25)
const draggingObserved = await evaluate(
  `document.querySelector('.diagram-lightbox-viewport')?.classList.contains('is-dragging') === true`
)
await command('Input.dispatchMouseEvent', {
  type: 'mouseMoved',
  x: dragEnd.x,
  y: dragEnd.y,
  button: 'left',
  buttons: 1
})
const panAfter = await waitFor(`(() => {
  const canvas = document.querySelector('.diagram-lightbox-canvas');
  const viewport = document.querySelector('.diagram-lightbox-viewport');
  if (!canvas || !viewport || canvas.style.transform === ${JSON.stringify(panBefore?.transform)}) return null;
  const canvasBox = canvas.getBoundingClientRect();
  const viewportBox = viewport.getBoundingClientRect();
  const inset = 16;
  return {
    transform: canvas.style.transform,
    canvasRect: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
    viewportRect: { x: viewportBox.x, y: viewportBox.y, width: viewportBox.width, height: viewportBox.height },
    clipped: {
      left: canvasBox.left < viewportBox.left + inset,
      right: canvasBox.right > viewportBox.right - inset,
      top: canvasBox.top < viewportBox.top + inset,
      bottom: canvasBox.bottom > viewportBox.bottom - inset
    },
    overflowX: getComputedStyle(viewport).overflowX,
    overflowY: getComputedStyle(viewport).overflowY
  };
})()`)
await command('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: dragEnd.x,
  y: dragEnd.y,
  button: 'left',
  buttons: 0,
  clickCount: 1
})
await waitFor(`!document.querySelector('.diagram-lightbox-viewport')?.classList.contains('is-dragging')`)
const draggingFinished = !(await evaluate(
  `document.querySelector('.diagram-lightbox-viewport')?.classList.contains('is-dragging') === true`
))
await click('button[aria-label="缩小"]')
const zoomAfterMinus = await waitFor(`(() => {
  const value = Number.parseInt(document.querySelector('.diagram-lightbox-zoom span')?.textContent || '', 10);
  return value === ${initialZoom} ? value : null;
})()`)

const viewportBox = await rect('.diagram-lightbox-viewport')
await command('Input.dispatchMouseEvent', {
  type: 'mouseWheel',
  x: viewportBox.x + viewportBox.width / 2,
  y: viewportBox.y + viewportBox.height / 2,
  deltaX: 0,
  deltaY: -100,
  modifiers: 4
})
const zoomAfterWheel = await waitFor(`(() => {
  const value = Number.parseInt(document.querySelector('.diagram-lightbox-zoom span')?.textContent || '', 10);
  return value > ${initialZoom} ? value : null;
})()`)
await pressKey('0', 'Digit0', 48, 4)
const zoomAfterReset = await waitFor(`(() => {
  const value = Number.parseInt(document.querySelector('.diagram-lightbox-zoom span')?.textContent || '', 10);
  return value === ${initialZoom} ? value : null;
})()`)
const transformAfterReset = await waitFor(`(() => {
  const transform = document.querySelector('.diagram-lightbox-canvas')?.style.transform || '';
  return /^translate\\(calc\\(-50% \\+ 0px\\), calc\\(-50% \\+ 0px\\)\\)/.test(transform)
    ? transform
    : null;
})()`)

await pressKey('Escape', 'Escape', 27)
await waitFor(`!document.querySelector('.diagram-lightbox')`)
const escaped = !(await evaluate(`Boolean(document.querySelector('.diagram-lightbox'))`))

phase = 'reopen-download-and-close-viewer'
await clickDiagramButtonBySource(roadmapSentinel, '展开图表')
await waitFor(`Boolean(document.querySelector('.diagram-lightbox-canvas'))`)
const beforeFullscreenDownload = await downloadedPngs()
await click('.diagram-lightbox-actions button[aria-label="下载图像"]')
const fullscreenDownload = await waitForDownloadedPng(beforeFullscreenDownload)
await click('.diagram-lightbox-actions button[aria-label="关闭预览"]')
await waitFor(`!document.querySelector('.diagram-lightbox')`)
const closeButtonClosed = !(await evaluate(`Boolean(document.querySelector('.diagram-lightbox'))`))

const interactions = {
  wideDiagramIndex,
  initialZoom,
  zoomAfterPlus,
  zoomAfterMinus,
  zoomAfterWheel,
  zoomAfterReset,
  panBefore,
  panAfter,
  draggingObserved,
  draggingFinished,
  transformAfterReset,
  escaped,
  closeButtonClosed,
  inlineDownload,
  fullscreenDownload,
  exportTrace
}

phase = 'assert-mermaid-contract'
const approximately = (value, expected, tolerance) =>
  Number.isFinite(value) && Math.abs(value - expected) <= tolerance
const failures = []
if (!inline.trace?.loadingSeen) failures.push('did not observe the plain 正在加载图表 state')
if (inline.count !== 3) failures.push(`inline diagram count: ${inline.count}`)
if (inline.trace?.maxReady !== 3) failures.push(`ready diagram count: ${inline.trace?.maxReady}`)
if (inline.background !== 'rgba(0, 0, 0, 0)') failures.push(`inline background: ${inline.background}`)
if (inline.actionCount !== 6) failures.push(`inline actions: ${inline.actionCount}`)
if (inline.answerActionCount < 2) failures.push(`answer actions: ${inline.answerActionCount}`)
if (inlineActionOpacityAtCapture !== 1) {
  failures.push(`inline action opacity at capture: ${inlineActionOpacityAtCapture}`)
}
if (inline.boxes.some((box) =>
  box.width < (box.parentWidth || 0) || box.minHeight < 240 || box.stageHeight < 240)) {
  failures.push(`inline sizing: ${JSON.stringify(inline.boxes)}`)
}
if (JSON.stringify(menu) !== JSON.stringify(['复制为代码', '下载图像'])) {
  failures.push(`menu labels: ${JSON.stringify(menu)}`)
}
const synthetic = inline.boxes[0]
const syntheticFlowchart = synthetic?.flowchart
const expectedViewBox = { x: 4, y: 4, width: 526.359375, height: 176 }
if (
  !synthetic?.viewBox ||
  !approximately(synthetic.viewBox.x, expectedViewBox.x, 0.05) ||
  !approximately(synthetic.viewBox.y, expectedViewBox.y, 0.05) ||
  !approximately(synthetic.viewBox.width, expectedViewBox.width, 0.05) ||
  !approximately(synthetic.viewBox.height, expectedViewBox.height, 0.05)
) {
  failures.push(`synthetic flowchart viewBox: ${JSON.stringify(synthetic?.viewBox)}`)
}
if (
  syntheticFlowchart?.nodeCount !== 4 ||
  syntheticFlowchart?.decisionCount !== 1 ||
  syntheticFlowchart?.edgeCount !== 3
) {
  failures.push(`synthetic flowchart structure: ${JSON.stringify(syntheticFlowchart)}`)
}
if (
  !syntheticFlowchart?.nodeShapeHeights?.length ||
  syntheticFlowchart.nodeShapeHeights.some((height) => !approximately(height, 60, 0.05))
) {
  failures.push(`synthetic node heights: ${JSON.stringify(syntheticFlowchart?.nodeShapeHeights)}`)
}
if (
  syntheticFlowchart?.markerCount !== 12 ||
  !['pointStart', 'pointEnd', 'circleStart', 'circleEnd', 'crossStart', 'crossEnd'].every(
    (kind) => syntheticFlowchart?.markerIds?.some((id) => id.includes(kind))
  )
) {
  failures.push(`synthetic marker set: ${JSON.stringify(syntheticFlowchart?.markerIds)}`)
}
const pointEnd = syntheticFlowchart?.pointEnd
const expectedPointEndPath =
  'M 0 0 L 4 0 M 0.8180194846605362 -3.181980515339464 L 4 0 L 0.8180194846605362 3.181980515339464'
if (
  pointEnd?.viewBox !== '-5 -5 10 10' ||
  Number(pointEnd?.markerWidth) !== 10 ||
  Number(pointEnd?.markerHeight) !== 10 ||
  Number(pointEnd?.refX) !== 0 ||
  Number(pointEnd?.refY) !== 0 ||
  pointEnd?.path !== expectedPointEndPath
) {
  failures.push(`synthetic point marker: ${JSON.stringify(pointEnd)}`)
}
const originalComputedLine = 'rgba(252, 252, 252, 0.498)'
if (
  syntheticFlowchart?.edgeStrokes?.some((stroke) => stroke !== originalComputedLine) ||
  pointEnd?.stroke !== originalComputedLine
) {
  failures.push(
    `synthetic computed line colors: ${JSON.stringify({
      edges: syntheticFlowchart?.edgeStrokes,
      marker: pointEnd?.stroke
    })}`
  )
}
if (!inline.boxes[wideDiagramIndex]?.source?.includes(roadmapSentinel)) {
  failures.push(`wide roadmap fixture missing at index ${wideDiagramIndex}`)
}
if (!menuPresentation) {
  failures.push('menu presentation metrics missing')
} else {
  if (menuPresentation.actionOpacity !== 1 || menuPresentation.menuOpacity !== 1) {
    failures.push(`menu opacity: ${JSON.stringify(menuPresentation)}`)
  }
  if (
    !approximately(menuPresentation.menuRect?.width, 152, 2) ||
    !approximately(menuPresentation.menuRect?.height, 64, 4)
  ) {
    failures.push(`menu geometry: ${JSON.stringify(menuPresentation.menuRect)}`)
  }
  if (
    menuPresentation.itemRects?.length !== 2 ||
    menuPresentation.itemRects.some(({ height }) => !approximately(height, 28, 0.5))
  ) {
    failures.push(`menu row geometry: ${JSON.stringify(menuPresentation.itemRects)}`)
  }
  if (
    menuPresentation.itemFontSizes?.length !== 2 ||
    menuPresentation.itemFontSizes.some((size) => !approximately(size, 14, 0.1))
  ) {
    failures.push(`menu font size: ${JSON.stringify(menuPresentation.itemFontSizes)}`)
  }
  if (
    !approximately(menuPresentation.triggerRect?.width, 36, 0.5) ||
    !approximately(menuPresentation.triggerRect?.height, 36, 0.5)
  ) {
    failures.push(`menu trigger geometry: ${JSON.stringify(menuPresentation.triggerRect)}`)
  }
  if (!menuPresentation.copyIcon?.isCodeSemantic || menuPresentation.copyIcon?.isCopySemantic) {
    failures.push(`copy-as-code icon semantics: ${JSON.stringify(menuPresentation.copyIcon)}`)
  }
}
if (
  !fullscreen.shellWithoutContentSeen ||
  !fullscreen.contentSeen ||
  !(fullscreen.shellAt <= fullscreen.contentAt) ||
  fullscreen.lifecycleEvents?.[0]?.state !== 'shell' ||
  fullscreen.lifecycleEvents?.at(-1)?.state !== 'content'
) {
  failures.push(`viewer shell/content lifecycle: ${JSON.stringify(fullscreen.lifecycleEvents)}`)
}
if (fullscreen.zoom !== fullscreen.expectedZoom) {
  failures.push(`fullscreen zoom: ${fullscreen.zoom}, expected ${fullscreen.expectedZoom}`)
}
if (!(fullscreen.expectedFit < 1 && initialZoom < 100 && fullscreen.naturalWidth > fullscreen.availableWidth)) {
  failures.push(
    `wide fullscreen did not require sub-100% fit: ${JSON.stringify({
      initialZoom,
      expectedFit: fullscreen.expectedFit,
      naturalWidth: fullscreen.naturalWidth,
      availableWidth: fullscreen.availableWidth
    })}`
  )
}
if (
  !approximately(fullscreen.centerDelta?.x, 0, 1) ||
  !approximately(fullscreen.centerDelta?.y, 0, 1)
) {
  failures.push(`fullscreen canvas is not centered: ${JSON.stringify(fullscreen.centerDelta)}`)
}
if (fullscreen.topActions !== 2) failures.push(`fullscreen top actions: ${fullscreen.topActions}`)
if (fullscreen.topActionSizes.some(([width, height]) => width !== 40 || height !== 40)) {
  failures.push(`fullscreen action sizes: ${JSON.stringify(fullscreen.topActionSizes)}`)
}
if (fullscreen.zoomActionSizes.some(([width, height]) => width !== 36 || height !== 36)) {
  failures.push(`fullscreen zoom action sizes: ${JSON.stringify(fullscreen.zoomActionSizes)}`)
}
if (fullscreen.hasHeader) failures.push('fullscreen unexpectedly rendered a header')
if (fullscreen.overlayBackground !== 'rgba(0, 0, 0, 0.9)') {
  failures.push(`fullscreen overlay: ${fullscreen.overlayBackground}`)
}
if (fullscreen.viewportBackground !== 'rgb(34, 34, 34)') {
  failures.push(`fullscreen canvas: ${fullscreen.viewportBackground}`)
}
if (fullscreen.zoomBackground !== 'rgb(30, 30, 30)') {
  failures.push(`fullscreen zoom pill: ${fullscreen.zoomBackground}`)
}
if (fullscreen.zoomActionBackgrounds.some((color) => color !== 'rgb(48, 48, 48)')) {
  failures.push(`fullscreen zoom button colors: ${JSON.stringify(fullscreen.zoomActionBackgrounds)}`)
}
if (!(zoomAfterPlus > initialZoom && zoomAfterMinus === initialZoom)) {
  failures.push(`zoom buttons: ${JSON.stringify({ initialZoom, zoomAfterPlus, zoomAfterMinus })}`)
}
if (!(zoomAfterWheel > initialZoom && zoomAfterReset === initialZoom)) {
  failures.push(`wheel/reset zoom: ${JSON.stringify({ initialZoom, zoomAfterWheel, zoomAfterReset })}`)
}
const panDelta = panBefore && panAfter
  ? {
      x: panAfter.canvasRect.x - panBefore.canvasRect.x,
      y: panAfter.canvasRect.y - panBefore.canvasRect.y
    }
  : null
if (
  !draggingObserved ||
  !draggingFinished ||
  !panDelta ||
  Math.abs(panDelta.x) < 40 ||
  Math.abs(panDelta.y) < 20
) {
  failures.push(`viewer drag: ${JSON.stringify({ draggingObserved, draggingFinished, panDelta })}`)
}
if (
  panAfter?.overflowX !== 'hidden' ||
  panAfter?.overflowY !== 'hidden' ||
  !(panAfter?.clipped?.left || panAfter?.clipped?.right) ||
  !(panAfter?.canvasRect?.width > panAfter?.viewportRect?.width - 32)
) {
  failures.push(`viewer clipping after drag: ${JSON.stringify(panAfter)}`)
}
if (!/^translate\(calc\(-50% \+ 0px\), calc\(-50% \+ 0px\)\)/.test(transformAfterReset)) {
  failures.push(`viewer reset transform: ${transformAfterReset}`)
}
if (!escaped || !closeButtonClosed) failures.push('viewer did not close through Escape and close button')
for (const download of [inlineDownload, fullscreenDownload]) {
  if (download.signature !== '89504e470d0a1a0a' || download.size < 100) {
    failures.push(`invalid PNG download: ${JSON.stringify(download)}`)
  }
}
const naturalWidth = inline.boxes[0]?.naturalWidth
const naturalHeight = inline.boxes[0]?.naturalHeight
if (
  naturalWidth && naturalHeight &&
  (inlineDownload.width !== Math.ceil(naturalWidth * 2) ||
    inlineDownload.height !== Math.ceil(naturalHeight * 2))
) {
  failures.push(
    `PNG dimensions: ${inlineDownload.width}x${inlineDownload.height}, expected ${Math.ceil(naturalWidth * 2)}x${Math.ceil(naturalHeight * 2)}`
  )
}
if (
  fullscreen.naturalWidth && fullscreen.naturalHeight &&
  (fullscreenDownload.width !== Math.ceil(fullscreen.naturalWidth * 2) ||
    fullscreenDownload.height !== Math.ceil(fullscreen.naturalHeight * 2))
) {
  failures.push(
    `fullscreen PNG dimensions: ${fullscreenDownload.width}x${fullscreenDownload.height}, expected ${Math.ceil(fullscreen.naturalWidth * 2)}x${Math.ceil(fullscreen.naturalHeight * 2)}`
  )
}
const fill = exportTrace.trace.at(-1)
if (!fill || fill.fillStyle !== exportTrace.expectedBackground) {
  failures.push(`PNG background fill: ${JSON.stringify(exportTrace)}`)
}

const report = {
  phase: 'complete',
  target: { port, url: target.url, title: target.title },
  inline,
  inlineActionOpacityAtCapture,
  menu,
  menuPresentation,
  fullscreen,
  interactions,
  screenshots: [inlineScreenshot, menuScreenshot, fullscreenScreenshot],
  passed: failures.length === 0,
  failures
}
await writeFile(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failures.length) process.exitCode = 1
} catch (error) {
  try {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 0,
      y: 0,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
    await evaluate(`(() => {
      window.__codexMermaidObserver?.disconnect?.();
      window.__codexViewerObserver?.disconnect?.();
      if (window.__codexMermaidOriginalFillRect) {
        CanvasRenderingContext2D.prototype.fillRect = window.__codexMermaidOriginalFillRect;
        delete window.__codexMermaidOriginalFillRect;
      }
      delete window.__codexMermaidExportTrace;
    })()`)
    if (await evaluate(`Boolean(document.querySelector('.diagram-lightbox'))`)) {
      await pressKey('Escape', 'Escape', 27)
      await waitFor(`!document.querySelector('.diagram-lightbox')`, 2_000)
    }
  } catch {
    // Preserve the original verifier exception even when best-effort UI recovery fails.
  }
  const report = {
    phase,
    target: { port, url: target.url, title: target.title },
    passed: false,
    failures: [`verifier exception during ${phase}: ${error instanceof Error ? error.message : String(error)}`],
    exception: {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    }
  }
  await writeFile(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = 1
} finally {
  socket.close()
}

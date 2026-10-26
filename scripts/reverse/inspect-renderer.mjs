#!/usr/bin/env node

const port = Number(process.argv[2] || 9225)
const targetUrl = process.argv[3] || null
const cdpHost = process.env.CODEX_CDP_HOST || '127.0.0.1'
const targets = await fetch(`http://${cdpHost}:${port}/json/list`).then((response) => response.json())
const target = targets.find(
  (candidate) => candidate.type === 'page' && (!targetUrl || candidate.url === targetUrl)
)
if (!target?.webSocketDebuggerUrl) throw new Error(`No matching page target on port ${port}`)

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

await command('Runtime.enable')
const result = await command('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const inspect = (element) => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: typeof element.className === 'string' ? element.className : null,
        text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 220) || null,
        rect: rect(element),
        style: {
          display: style.display,
          position: style.position,
          flex: style.flex,
          flexDirection: style.flexDirection,
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          gap: style.gap,
          padding: style.padding,
          margin: style.margin,
          border: style.border,
          borderRadius: style.borderRadius,
          background: style.background,
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          color: style.color,
          opacity: style.opacity,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing
        }
      };
    };
    const ancestors = (element) => {
      const values = [];
      let current = element;
      while (current && values.length < 9) {
        values.push(inspect(current));
        current = current.parentElement;
      }
      return values;
    };
    const all = [...document.querySelectorAll('*')];
    const heading = document.querySelector('[data-feature="game-source"]');
    const homeIcon = document.querySelector('[data-testid="home-icon"]');
    const editor = document.querySelector('textarea, [contenteditable="true"]');
    const interesting = all.filter((element) =>
      element.hasAttribute('data-testid') ||
      element.hasAttribute('data-feature') ||
      element.hasAttribute('data-codex-character-input-boundary') ||
      element.getAttribute('role') === 'main'
    ).slice(0, 240).map((element) => ({
      tag: element.tagName.toLowerCase(),
      testId: element.getAttribute('data-testid'),
      feature: element.getAttribute('data-feature'),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      className: typeof element.className === 'string' ? element.className : null,
      text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 160) || null,
      rect: rect(element)
    }));
    const buttons = [...document.querySelectorAll('button')].slice(0, 600).map((element) => ({
      ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 100) || null,
      className: typeof element.className === 'string' ? element.className : null,
      svg: element.querySelector('svg')?.outerHTML || null,
      svgs: [...element.querySelectorAll('svg')].map((svg) => svg.outerHTML),
      rect: rect(element)
    }));
    const buttonByAriaPrefix = (prefix) => [...document.querySelectorAll('button')]
      .find((element) => element.getAttribute('aria-label')?.startsWith(prefix));
    const namedElements = {
      originalProjectControl: buttonByAriaPrefix('选择项目') || buttonByAriaPrefix('切换项目'),
      originalRunLocationControl: buttonByAriaPrefix('选择聊天的运行位置'),
      originalPermissionControl: buttonByAriaPrefix('更改权限'),
      originalSendControl: buttonByAriaPrefix('发送'),
      originalHomeNav: [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === '首页'),
      originalScheduledNav: [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === '定时任务'),
      originalPluginsNav: [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === '插件'),
      originalExploreNav: [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === '探索'),
      originalProfileNav: buttonByAriaPrefix('打开个人资料菜单'),
      originalMainSurface: document.querySelector('main'),
      replicaTitlebar: document.querySelector('.window-titlebar'),
      replicaWorkspace: document.querySelector('.workspace-frame'),
      replicaRail: document.querySelector('.activity-rail'),
      replicaSidebar: document.querySelector('.sidebar'),
      replicaMain: document.querySelector('.main-panel'),
      replicaEmptyState: document.querySelector('.empty-conversation'),
      replicaHomeIcon: document.querySelector('.welcome-mark'),
      replicaHeading: document.querySelector('.empty-conversation h2'),
      replicaContextStrip: document.querySelector('.composer-context-strip'),
      replicaComposer: document.querySelector('.composer')
    };
    const points = [
      [25, 70], [100, 70], [520, 44], [521, 45], [700, 70],
      [1280, 520], [930, 1055], [920, 1090], [2045, 1197],
      [2049, 600], [2049, 20], [2, 20], [2, 1201]
    ];
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      theme: document.documentElement.getAttribute('data-theme'),
      bodyText: document.body.innerText.slice(0, 2000),
      homeIconSvg: homeIcon?.querySelector('svg')?.outerHTML || null,
      heading: heading ? ancestors(heading) : null,
      homeIcon: homeIcon ? ancestors(homeIcon) : null,
      editor: editor ? ancestors(editor) : null,
      named: Object.fromEntries(Object.entries(namedElements).map(([name, element]) => [
        name,
        element ? ancestors(element) : null
      ])),
      pointStacks: points.map(([x, y]) => ({
        x,
        y,
        elements: document.elementsFromPoint(x, y).slice(0, 8).map(inspect)
      })),
      interesting,
      buttons
    };
  })()`
})

process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`)
socket.close()

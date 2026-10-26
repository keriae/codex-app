#!/usr/bin/env node

/**
 * Read-only CDP conformance gate for the Codex sidebar.
 *
 * Usage:
 *   node scripts/reverse/verify-sidebar.mjs [port]
 *
 * The port defaults to 9225. Port 9224 is deliberately rejected because it is
 * reserved for the installed upstream Codex app. The gate selects only the
 * exact app://-/index.html page target, prints a JSON report, and exits non-zero
 * when a check fails.
 *
 * Collapse/expand controls are clicked to exercise their behavior. Before any
 * click, the relevant localStorage values are snapshotted; they are restored in
 * a finally block and the replica page is reloaded before the script exits.
 */

const usage = `Usage: node scripts/reverse/verify-sidebar.mjs [port]

Runs the sidebar visual/behavior gate against the replica (default: 9225).
Port 9224 is reserved for the upstream app and is always rejected.
The script emits JSON on stdout and temporarily exercises collapse/expand UI,
then restores the original sidebar state and reloads the page.
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(usage)
  process.exit(0)
}

const port = Number(process.argv[2] || 9225)
const expectedUrl = 'app://-/index.html'
const forbiddenUpstreamPort = 9224

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  process.stderr.write(`Invalid CDP port: ${String(process.argv[2])}\n`)
  process.exit(2)
}

if (port === forbiddenUpstreamPort) {
  process.stderr.write(
    `Refusing to connect to CDP port ${forbiddenUpstreamPort}; it is reserved for the upstream Codex app.\n`
  )
  process.exit(2)
}

const pause = (duration = 100) =>
  new Promise((resolvePause) => setTimeout(resolvePause, duration))

async function discoverReplicaPage() {
  const deadline = Date.now() + 20_000
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const targets = await response.json()
      const target = targets.find(
        (candidate) => candidate.type === 'page' && candidate.url === expectedUrl
      )
      if (target?.webSocketDebuggerUrl) return target
      lastError = new Error(`no exact ${expectedUrl} page target was exposed`)
    } catch (error) {
      lastError = error
    }
    await pause(250)
  }

  throw new Error(
    `Could not discover the replica page on CDP port ${port}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}

const target = await discoverReplicaPage()
const debuggerUrl = new URL(target.webSocketDebuggerUrl)
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const debuggerPort = Number(debuggerUrl.port)
if (
  debuggerUrl.protocol !== 'ws:' ||
  !loopbackHosts.has(debuggerUrl.hostname) ||
  debuggerPort !== port ||
  debuggerPort === forbiddenUpstreamPort
) {
  throw new Error(
    `Refusing mismatched CDP WebSocket endpoint: ${debuggerUrl.toString()} (requested port ${port})`
  )
}

const socket = new WebSocket(debuggerUrl.toString())
const pending = new Map()
let nextId = 1
let runtimeExceptions = 0

function rejectPending(error) {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === 'Runtime.exceptionThrown') runtimeExceptions += 1
  if (!message.id) return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})

socket.addEventListener('close', () => {
  rejectPending(new Error('CDP WebSocket closed before the command completed'))
})

socket.addEventListener('error', () => {
  rejectPending(new Error('CDP WebSocket failed before the command completed'))
})

await new Promise((resolveOpen, rejectOpen) => {
  const timeout = setTimeout(() => {
    cleanup()
    rejectOpen(new Error('Timed out opening the CDP WebSocket'))
  }, 15_000)
  const cleanup = () => {
    clearTimeout(timeout)
    socket.removeEventListener('open', onOpen)
    socket.removeEventListener('error', onError)
    socket.removeEventListener('close', onClose)
  }
  const onOpen = () => {
    cleanup()
    resolveOpen()
  }
  const onError = () => {
    cleanup()
    rejectOpen(new Error('Failed to open the CDP WebSocket'))
  }
  const onClose = () => {
    cleanup()
    rejectOpen(new Error('CDP WebSocket closed before opening'))
  }
  socket.addEventListener('open', onOpen, { once: true })
  socket.addEventListener('error', onError, { once: true })
  socket.addEventListener('close', onClose, { once: true })
})

function command(method, params = {}) {
  const id = nextId++
  return new Promise((resolveRequest, rejectRequest) => {
    if (socket.readyState !== WebSocket.OPEN) {
      rejectRequest(new Error(`CDP WebSocket is not open for ${method}`))
      return
    }
    const timeout = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`CDP command timed out: ${method}`))
    }, 30_000)
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout)
        resolveRequest(value)
      },
      reject(error) {
        clearTimeout(timeout)
        rejectRequest(error)
      }
    })
    try {
      socket.send(JSON.stringify({ id, method, params }))
    } catch (error) {
      pending.delete(id)
      clearTimeout(timeout)
      rejectRequest(error)
    }
  })
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        'Runtime evaluation failed'
    )
  }
  return response.result.value
}

async function waitFor(expression, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let lastValue = null
  while (Date.now() < deadline) {
    lastValue = await evaluate(expression)
    if (lastValue) return lastValue
    await pause(50)
  }
  throw new Error(
    `Timed out waiting for ${expression}; last value: ${JSON.stringify(lastValue)}`
  )
}

async function pointFor(expression, label) {
  const found = await evaluate(`(() => {
    const element = (${expression});
    if (!(element instanceof HTMLElement)) return false;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`)
  if (!found) throw new Error(`Could not find ${label}`)
  await pause(80)

  const box = await evaluate(`(() => {
    const element = (${expression});
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight
    };
  })()`)
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`${label} is not visible: ${JSON.stringify(box)}`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (x < 0 || y < 0 || x > box.viewportWidth || y > box.viewportHeight) {
    throw new Error(`${label} is outside the viewport: ${JSON.stringify(box)}`)
  }
  return { x, y }
}

async function clickExpression(expression, label) {
  const point = await pointFor(expression, label)
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
  await pause(120)
}

async function hoverExpression(expression, label) {
  const point = await pointFor(expression, label)
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  })
  await pause(180)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertClose(label, actual, expected, tolerance = 0.5) {
  assert(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}±${tolerance}, received ${String(actual)}`
  )
}

function assertMacSystemFont(label, family) {
  assert(
    typeof family === 'string' &&
      /(?:-apple-system|system-ui|BlinkMacSystemFont|AppleSystemUIFont|SF Pro)/i.test(family),
    `${label}: expected the macOS system font stack, received ${String(family)}`
  )
}

function normalizeWorkspacePath(value) {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path === '/' || path.includes('\0')) return null
  const normalized = path.replace(/\/+$/, '')
  return normalized && normalized !== '/' ? normalized : null
}

function threadTitle(thread) {
  if (typeof thread?.name === 'string' && thread.name.trim()) return thread.name.trim()
  const firstLine = String(thread?.preview || '')
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return firstLine || 'New thread'
}

function projectForThread(thread, projects) {
  const projectId = typeof thread?.projectId === 'string' ? thread.projectId.trim() : ''
  if (projectId) return projects.find((project) => project.id === projectId) || null
  const path = normalizeWorkspacePath(thread?.cwd)
  return path
    ? projects.find((project) => project.roots.includes(path)) || null
    : null
}

function parseThreadPreferences(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      pinned: Array.isArray(parsed?.pinned)
        ? parsed.pinned.filter((id) => typeof id === 'string' && id)
        : [],
      unread: Array.isArray(parsed?.unread)
        ? parsed.unread.filter((id) => typeof id === 'string' && id)
        : []
    }
  } catch {
    return { pinned: [], unread: [] }
  }
}

function sameStringSet(left, right) {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  )
}

function sectionExpression(heading) {
  return `[...document.querySelectorAll('[data-app-action-sidebar-section]')]
    .find((section) => section.getAttribute('data-app-action-sidebar-section-heading') === ${JSON.stringify(heading)})`
}

function projectExpression(projectId) {
  return `[...document.querySelectorAll('[data-app-action-sidebar-project-list-id]')]
    .find((group) => group.getAttribute('data-app-action-sidebar-project-list-id') === ${JSON.stringify(projectId)})`
}

const checks = []

async function check(name, run) {
  try {
    const evidence = await run()
    checks.push({ name, passed: true, evidence })
  } catch (error) {
    checks.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

const sidebarStorageKeys = [
  'codex-sidebar-collapsed-sections-v1',
  'codex-sidebar-collapsed-projects-v1',
  'codex-sidebar-expanded-projects-v1',
  'codex-sidebar-pinned-projects-v1',
  'codex-thread-preferences-v1'
]

let initialStorage = null
let initialScrollTop = null
let catalogThreads = null
let explicitProjects = null
let restoration = { attempted: false, passed: false }
let fatalError = null

const rendererReadyExpression = `(() => {
  const shell = document.querySelector('.app-shell');
  return location.href === ${JSON.stringify(expectedUrl)} &&
    document.readyState === 'complete' &&
    shell?.dataset.backendState === 'ready' &&
    Boolean(document.querySelector('.sidebar')) &&
    !document.querySelector('.sidebar-skeleton');
})()`

async function sectionState(heading) {
  return evaluate(`(() => {
    const section = (${sectionExpression(heading)});
    if (!(section instanceof HTMLElement)) return null;
    const toggle = section.querySelector('[data-app-action-sidebar-section-toggle]');
    return {
      collapsed: section.getAttribute('data-app-action-sidebar-section-collapsed'),
      expanded: toggle?.getAttribute('aria-expanded') || null,
      contentMounted: Boolean(section.querySelector(':scope > .sidebar-section-content'))
    };
  })()`)
}

async function ensureSectionOpen(heading) {
  const before = await sectionState(heading)
  if (!before) return false
  if (before.collapsed === 'false') return true
  await clickExpression(
    `(${sectionExpression(heading)})?.querySelector('[data-app-action-sidebar-section-toggle]')`,
    `${heading} section toggle`
  )
  await waitFor(`(() => {
    const section = (${sectionExpression(heading)});
    return section?.getAttribute('data-app-action-sidebar-section-collapsed') === 'false' &&
      section.querySelector('[data-app-action-sidebar-section-toggle]')?.getAttribute('aria-expanded') === 'true';
  })()`)
  return true
}

async function ensureAllProjectsOpen() {
  const collapsedIds = await evaluate(`(() =>
    [...document.querySelectorAll('[data-app-action-sidebar-project-row][data-app-action-sidebar-project-collapsed="true"]')]
      .map((row) => row.getAttribute('data-app-action-sidebar-project-id'))
      .filter(Boolean)
  )()`)

  for (const projectId of collapsedIds) {
    await clickExpression(
      `(${projectExpression(projectId)})?.querySelector('[data-app-action-sidebar-project-row]')`,
      `project row ${projectId}`
    )
    await waitFor(`(() => {
      const group = (${projectExpression(projectId)});
      return group?.querySelector('[data-app-action-sidebar-project-row]')
        ?.getAttribute('data-app-action-sidebar-project-collapsed') === 'false';
    })()`)
  }
}

async function ensureAllProjectPreviewsExpanded() {
  await ensureAllProjectsOpen()
  const collapsedPreviewIds = await evaluate(`(() =>
    [...document.querySelectorAll('[data-app-action-sidebar-project-list-id]')]
      .filter((group) => group.querySelector('.sidebar-expand')?.textContent?.trim() === '展开显示')
      .map((group) => group.getAttribute('data-app-action-sidebar-project-list-id'))
      .filter(Boolean)
  )()`)

  for (const projectId of collapsedPreviewIds) {
    await clickExpression(
      `(${projectExpression(projectId)})?.querySelector('.sidebar-expand')`,
      `展开显示 for ${projectId}`
    )
    await waitFor(`(() => {
      const group = (${projectExpression(projectId)});
      return group?.querySelector('.sidebar-expand')?.textContent?.trim() === '收起显示';
    })()`)
  }
}

async function ensureRecentRowsRendered(expectedCount) {
  await ensureSectionOpen('Recents')
  const countExpression = `(() => {
    const section = (${sectionExpression('Recents')});
    return section
      ? section.querySelectorAll('[data-app-action-sidebar-thread-row]').length
      : 0;
  })()`

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const before = await evaluate(countExpression)
    if (before >= expectedCount) return before
    const moved = await evaluate(`(() => {
      const sentinel = document.querySelector('[data-app-action-sidebar-load-sentinel]');
      if (!(sentinel instanceof HTMLElement)) return false;
      sentinel.scrollIntoView({ block: 'end', inline: 'nearest' });
      return true;
    })()`)
    if (!moved) return before
    try {
      await waitFor(`(${countExpression}) > ${JSON.stringify(before)}`, 3_000)
    } catch {
      return evaluate(countExpression)
    }
  }
  return evaluate(countExpression)
}

async function movePointerAway() {
  const viewport = await evaluate(`({ width: innerWidth, height: innerHeight })`)
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: viewport.width / 2,
    y: Math.min(1, viewport.height - 1)
  })
  await pause(80)
}

try {
  await command('Runtime.enable')
  await command('Page.enable')

  await waitFor(rendererReadyExpression, 30_000)
  await pause(250)
  initialStorage = await evaluate(`Object.fromEntries(
    ${JSON.stringify(sidebarStorageKeys)}.map((key) => [key, localStorage.getItem(key)])
  )`)
  initialScrollTop = await evaluate(
    `document.querySelector('[data-app-action-sidebar-scroll]')?.scrollTop || 0`
  )

  await command('Page.reload', { ignoreCache: true })
  const ready = await waitFor(rendererReadyExpression, 30_000)

  await check('Exact replica target and ready sidebar', async () => {
    const actual = await evaluate(`({
      url: location.href,
      readyState: document.readyState,
      backendState: document.querySelector('.app-shell')?.dataset.backendState || null,
      sidebar: Boolean(document.querySelector('.sidebar'))
    })`)
    assert(ready === true, 'replica page did not become ready')
    assert(target.url === expectedUrl, `discovered target URL was ${target.url}`)
    assert(actual.url === expectedUrl, `renderer URL was ${actual.url}`)
    assert(actual.readyState === 'complete', `document.readyState was ${actual.readyState}`)
    assert(actual.backendState === 'ready', `backend state was ${actual.backendState}`)
    assert(actual.sidebar, 'sidebar is missing')
    return actual
  })

  await check('Sidebar section data contract and title typography', async () => {
    const sections = await evaluate(`(() =>
      [...document.querySelectorAll('[data-app-action-sidebar-section]')].map((section) => {
        const toggle = section.querySelector('[data-app-action-sidebar-section-toggle]');
        const title = toggle?.querySelector('span');
        const sectionTitle = section.querySelector(':scope > .section-title');
        const box = toggle?.getBoundingClientRect();
        const style = toggle ? getComputedStyle(toggle) : null;
        const sectionStyle = getComputedStyle(section);
        const sectionTitleStyle = sectionTitle ? getComputedStyle(sectionTitle) : null;
        return {
          heading: section.getAttribute('data-app-action-sidebar-section-heading'),
          collapsed: section.getAttribute('data-app-action-sidebar-section-collapsed'),
          toggleCount: section.querySelectorAll('[data-app-action-sidebar-section-toggle]').length,
          ariaExpanded: toggle?.getAttribute('aria-expanded') || null,
          title: title?.textContent?.trim() || null,
          geometry: box ? { width: box.width, height: box.height } : null,
          typography: style ? {
            fontFamily: style.fontFamily,
            fontSize: Number.parseFloat(style.fontSize),
            fontWeight: Number.parseFloat(style.fontWeight),
            lineHeight: Number.parseFloat(style.lineHeight),
            padding: style.padding,
            gap: style.gap,
            marginLeft: style.marginLeft,
            display: style.display,
            borderRadius: style.borderRadius
          } : null,
          outerPadding: sectionStyle.padding,
          titlePadding: sectionTitleStyle?.padding || null
        };
      })
    )()`)

    const expectedHeadings = new Set(['Pinned', 'Projects', 'Recents'])
    const expectedTitles = new Map([
      ['Pinned', '置顶'],
      ['Projects', '项目'],
      ['Recents', '最近']
    ])
    const seen = new Set()
    assert(sections.length > 0, 'no sidebar sections were rendered')
    assert(sections.some((section) => section.heading === 'Recents'), 'Recents section is missing')

    for (const section of sections) {
      assert(expectedHeadings.has(section.heading), `unknown section heading: ${section.heading}`)
      assert(!seen.has(section.heading), `duplicate section heading: ${section.heading}`)
      seen.add(section.heading)
      assert(
        section.collapsed === 'true' || section.collapsed === 'false',
        `${section.heading} has invalid collapsed data: ${section.collapsed}`
      )
      assert(section.toggleCount === 1, `${section.heading} toggle count: ${section.toggleCount}`)
      assert(
        section.ariaExpanded === String(section.collapsed === 'false'),
        `${section.heading} aria-expanded does not match its collapsed data`
      )
      assert(
        section.title === expectedTitles.get(section.heading),
        `${section.heading} visible title: expected ${expectedTitles.get(section.heading)}, received ${section.title}`
      )
      assertClose(`${section.heading} toggle height`, section.geometry?.height, 25)
      assertClose(`${section.heading} font size`, section.typography?.fontSize, 14, 0.1)
      assertClose(`${section.heading} font weight`, section.typography?.fontWeight, 500, 0.1)
      assertClose(`${section.heading} line height`, section.typography?.lineHeight, 21, 0.1)
      assertMacSystemFont(`${section.heading} font family`, section.typography?.fontFamily)
      assert(section.outerPadding === '0px 8px', `${section.heading} outer padding: ${section.outerPadding}`)
      assert(section.titlePadding === '0px 6px 0px 8px', `${section.heading} title padding: ${section.titlePadding}`)
      assert(section.typography?.padding === '2px 4px', `${section.heading} padding: ${section.typography?.padding}`)
      assert(section.typography?.gap === '4px', `${section.heading} gap: ${section.typography?.gap}`)
      assert(section.typography?.marginLeft === '-4px', `${section.heading} left margin: ${section.typography?.marginLeft}`)
      assert(section.typography?.display === 'flex', `${section.heading} display: ${section.typography?.display}`)
      assert(section.typography?.borderRadius === '10px', `${section.heading} radius: ${section.typography?.borderRadius}`)
    }

    return {
      expectedWhenPresent: [...expectedHeadings],
      present: [...seen],
      sections
    }
  })

  await check('Disclosure, project icon, activity spinner, and auto-paging chrome match upstream', async () => {
    const evidence = await evaluate(`(() => {
      const toggle = document.querySelector('[data-app-action-sidebar-section-toggle]');
      const disclosure = toggle?.querySelector('svg');
      const toggleBox = toggle?.getBoundingClientRect();
      const disclosureBox = disclosure?.getBoundingClientRect();
      const projectIcon = document.querySelector('.sidebar-project-heading > svg');
      const projectIconBox = projectIcon?.getBoundingClientRect();
      const activeRows = [...document.querySelectorAll(
        '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]'
      )].map((row) => {
        const status = row.querySelector('.thread-row-status');
        const spinner = row.querySelector('.thread-row-spinner');
        const statusBox = status?.getBoundingClientRect();
        const spinnerStyle = spinner ? getComputedStyle(spinner) : null;
        return {
          label: row.getAttribute('aria-label'),
          statusRole: status?.getAttribute('role') || null,
          statusLabel: status?.getAttribute('aria-label') || null,
          status: statusBox ? { width: statusBox.width, height: statusBox.height } : null,
          spinner: spinnerStyle ? {
            width: Number.parseFloat(spinnerStyle.width),
            height: Number.parseFloat(spinnerStyle.height)
          } : null,
          animation: spinnerStyle?.animation || null
        };
      });
      return {
        disclosure: disclosureBox && toggleBox ? {
          width: disclosureBox.width,
          height: disclosureBox.height,
          centerDelta: Math.abs(
            (disclosureBox.top + disclosureBox.height / 2) -
              (toggleBox.top + toggleBox.height / 2)
          ),
          transform: getComputedStyle(disclosure).transform
        } : null,
        projectIcon: projectIconBox
          ? { width: projectIconBox.width, height: projectIconBox.height }
          : null,
        activeRows,
        visibleLoadButton: Boolean(document.querySelector('.sidebar-load-more')),
        loadSentinel: Boolean(document.querySelector('[data-app-action-sidebar-load-sentinel]')),
        blueUpdateButton: Boolean(document.querySelector('.rail-update-button'))
      };
    })()`)

    assertClose('disclosure width', evidence.disclosure?.width, 14)
    assertClose('disclosure height', evidence.disclosure?.height, 14)
    assert(
      (evidence.disclosure?.centerDelta ?? Number.POSITIVE_INFINITY) <= 0.5,
      `disclosure is not vertically centered: ${JSON.stringify(evidence.disclosure)}`
    )
    assertClose('project icon width', evidence.projectIcon?.width, 16)
    assertClose('project icon height', evidence.projectIcon?.height, 16)
    assert(!evidence.visibleLoadButton, 'a visible load-more button is still rendered')
    assert(!evidence.blueUpdateButton, 'the removed blue update button is still rendered')
    for (const active of evidence.activeRows) {
      assert(active.statusRole === 'status', `active row status role is missing: ${JSON.stringify(active)}`)
      assert(active.statusLabel === '处理中', `active row status label is wrong: ${JSON.stringify(active)}`)
      assertClose('active status width', active.status?.width, 20)
      assertClose('active status height', active.status?.height, 20)
      assertClose('active spinner width', active.spinner?.width, 16)
      assertClose('active spinner height', active.spinner?.height, 16)
      assert(
        active.animation?.includes('2s') && active.animation?.includes('steps(60)'),
        `active spinner animation is wrong: ${JSON.stringify(active)}`
      )
    }
    return evidence
  })

  await check('Every rendered section toggle collapses, expands, and returns to its state', async () => {
    const headings = await evaluate(`(() =>
      [...document.querySelectorAll('[data-app-action-sidebar-section]')]
        .map((section) => section.getAttribute('data-app-action-sidebar-section-heading'))
        .filter(Boolean)
    )()`)
    const transitions = []

    for (const heading of headings) {
      const before = await sectionState(heading)
      assert(before, `${heading} section disappeared before the interaction`)
      await clickExpression(
        `(${sectionExpression(heading)})?.querySelector('[data-app-action-sidebar-section-toggle]')`,
        `${heading} section toggle`
      )
      const after = await waitFor(`(() => {
        const section = (${sectionExpression(heading)});
        const collapsed = section?.getAttribute('data-app-action-sidebar-section-collapsed');
        if (!collapsed || collapsed === ${JSON.stringify(before.collapsed)}) return null;
        return {
          collapsed,
          expanded: section.querySelector('[data-app-action-sidebar-section-toggle]')?.getAttribute('aria-expanded') || null,
          contentMounted: Boolean(section.querySelector(':scope > .sidebar-section-content'))
        };
      })()`)
      assert(
        after.expanded === String(after.collapsed === 'false'),
        `${heading} aria-expanded did not follow the toggle`
      )
      assert(
        after.contentMounted === (after.collapsed === 'false'),
        `${heading} content mount did not follow the toggle`
      )

      await clickExpression(
        `(${sectionExpression(heading)})?.querySelector('[data-app-action-sidebar-section-toggle]')`,
        `${heading} section toggle restore`
      )
      const restored = await waitFor(`(() => {
        const section = (${sectionExpression(heading)});
        const collapsed = section?.getAttribute('data-app-action-sidebar-section-collapsed');
        if (collapsed !== ${JSON.stringify(before.collapsed)}) return null;
        return {
          collapsed,
          expanded: section.querySelector('[data-app-action-sidebar-section-toggle]')?.getAttribute('aria-expanded') || null,
          contentMounted: Boolean(section.querySelector(':scope > .sidebar-section-content'))
        };
      })()`)
      assert(
        restored.expanded === before.expanded && restored.contentMounted === before.contentMounted,
        `${heading} did not return to its initial state`
      )
      transitions.push({ heading, before, after, restored })
    }

    return transitions
  })

  await ensureSectionOpen('Pinned')
  await ensureSectionOpen('Projects')
  await ensureSectionOpen('Recents')

  await check('Only explicitly registered workspaces become projects; projectless chats stay in Recents', async () => {
    await ensureAllProjectPreviewsExpanded()
    const page = await evaluate(`window.codex.invoke('thread/list', {
      limit: 50,
      sortKey: 'recency_at',
      sortDirection: 'desc'
    })`)
    assert(Array.isArray(page?.data), 'thread/list did not return a data array')
    catalogThreads = page.data
    const renderedRecentCount = await ensureRecentRowsRendered(catalogThreads.length)
    assert(
      renderedRecentCount >= catalogThreads.length,
      `Recents auto-paging did not reveal the loaded catalog: ${renderedRecentCount}/${catalogThreads.length}`
    )

    const projectInputs = await evaluate(`(async () => ({
      page: await window.codex.invoke('project/list', {
        limit: 100,
        sortKey: 'position',
        sortDirection: 'asc'
      }),
      savedRaw: localStorage.getItem('codex-saved-projects-v1')
    }))()`)
    let savedProjectPaths = []
    try {
      const parsed = projectInputs?.savedRaw ? JSON.parse(projectInputs.savedRaw) : []
      savedProjectPaths = Array.isArray(parsed) ? parsed : []
    } catch {}
    const serverProjects = []
    const serverProjectsByRoot = new Map()
    for (const candidate of projectInputs?.page?.data || []) {
      const id = typeof candidate?.id === 'string' ? candidate.id.trim() : ''
      const roots = [...new Set(
        (candidate?.roots || [])
          .map((root) => normalizeWorkspacePath(root?.path))
          .filter(Boolean)
      )]
      if (!id || !roots.length || serverProjects.some((project) => project.id === id)) continue
      const project = {
        id,
        label: typeof candidate?.name === 'string' && candidate.name.trim()
          ? candidate.name.trim()
          : roots[0].split('/').filter(Boolean).at(-1) || roots[0],
        roots
      }
      serverProjects.push(project)
      for (const root of roots) {
        if (!serverProjectsByRoot.has(root)) serverProjectsByRoot.set(root, project)
      }
    }
    const normalizedSavedPaths = [...new Set(
      savedProjectPaths.map(normalizeWorkspacePath).filter(Boolean)
    )]
    const savedPathSet = new Set(normalizedSavedPaths)
    const expectedProjects = []
    const seenProjectIds = new Set()
    for (const path of normalizedSavedPaths) {
      const serverProject = serverProjectsByRoot.get(path)
      if (serverProject) {
        if (seenProjectIds.has(serverProject.id)) continue
        seenProjectIds.add(serverProject.id)
        expectedProjects.push({
          ...serverProject,
          roots: serverProject.roots.filter((root) => savedPathSet.has(root))
        })
        continue
      }
      const id = `saved-path:${encodeURIComponent(path)}`
      if (seenProjectIds.has(id)) continue
      seenProjectIds.add(id)
      expectedProjects.push({ id, label: path.split('/').filter(Boolean).at(-1) || path, roots: [path] })
    }
    const expectedProjectPaths = normalizedSavedPaths
    explicitProjects = expectedProjects
    const projectlessThreads = catalogThreads.filter(
      (thread) => !projectForThread(thread, expectedProjects)
    )
    const titleCounts = new Map()
    for (const thread of catalogThreads) {
      const title = threadTitle(thread)
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1)
    }

    const dom = await evaluate(`(() => {
      const groups = [...document.querySelectorAll('[data-app-action-sidebar-project-list-id]')]
        .map((group) => {
          const row = group.querySelector('[data-app-action-sidebar-project-row]');
          return {
            listId: group.getAttribute('data-app-action-sidebar-project-list-id'),
            root: group.getAttribute('data-app-action-sidebar-project-root'),
            rowId: row?.getAttribute('data-app-action-sidebar-project-id') || null,
            label: row?.getAttribute('data-app-action-sidebar-project-label') || null,
            title: row?.getAttribute('title') || null,
            section: group.closest('[data-app-action-sidebar-section]')
              ?.getAttribute('data-app-action-sidebar-section-heading') || null,
            collapsed: row?.getAttribute('data-app-action-sidebar-project-collapsed') || null
          };
        });
      const placements = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')]
        .map((row) => ({
          title: row.querySelector('.thread-row-copy .sidebar-marquee-track > span:not([aria-hidden])')
            ?.textContent?.trim() || '',
          section: row.closest('[data-app-action-sidebar-section]')
            ?.getAttribute('data-app-action-sidebar-section-heading') || null,
          projectId: row.closest('[data-app-action-sidebar-project-list-id]')
            ?.getAttribute('data-app-action-sidebar-project-list-id') || null
        }));
      return { groups, placements };
    })()`)

    const projectIds = dom.groups.map((group) => group.listId)
    assert(
      new Set(projectIds).size === projectIds.length,
      `project groups contain duplicate ids: ${JSON.stringify(projectIds)}`
    )
    for (const group of dom.groups) {
      const expected = expectedProjects.find((project) => project.id === group.listId)
      assert(expected, `unknown project id was rendered: ${JSON.stringify(group)}`)
      assert(group.rowId === group.listId, `project row/list ids differ: ${JSON.stringify(group)}`)
      assert(group.label === expected.label, `project label differs from catalog: ${JSON.stringify(group)}`)
      assert(
        expected.roots.includes(normalizeWorkspacePath(group.root)),
        `project primary root differs from catalog: ${JSON.stringify(group)}`
      )
      assert(
        group.section === 'Pinned' || group.section === 'Projects',
        `project group is in the wrong section: ${JSON.stringify(group)}`
      )
      assert(
        group.collapsed === 'true' || group.collapsed === 'false',
        `project collapsed data is invalid: ${JSON.stringify(group)}`
      )
    }

    const missingProjectIds = expectedProjects
      .map((project) => project.id)
      .filter((id) => !projectIds.includes(id))
    assert(
      missingProjectIds.length === 0,
      `registered projects missing groups: ${JSON.stringify(missingProjectIds)}`
    )
    const unexpectedProjectIds = projectIds.filter(
      (id) => !expectedProjects.some((project) => project.id === id)
    )
    assert(
      unexpectedProjectIds.length === 0,
      `unknown projects were rendered: ${JSON.stringify(unexpectedProjectIds)}`
    )

    const uniquelyIdentifiedThreads = catalogThreads.filter(
      (thread) => titleCounts.get(threadTitle(thread)) === 1
    )
    const catalogPlacements = uniquelyIdentifiedThreads.map((thread) => {
      const title = threadTitle(thread)
      const registeredProject = projectForThread(thread, expectedProjects)
      return {
        id: thread.id,
        cwd: thread.cwd,
        title,
        registeredProjectId: registeredProject?.id || null,
        placements: dom.placements.filter((placement) => placement.title === title)
      }
    })
    for (const entry of catalogPlacements) {
      const recentPlacements = entry.placements.filter(
        (placement) => placement.section === 'Recents' && placement.projectId === null
      )
      assert(
        recentPlacements.length === 1,
        `global Recents placement is missing or duplicated: ${JSON.stringify(entry)}`
      )
      if (entry.registeredProjectId) {
        const projectPlacements = entry.placements.filter(
          (placement) => placement.projectId === entry.registeredProjectId
        )
        assert(
          projectPlacements.length === 1,
          `registered project thread is not duplicated in its project and Recents: ${JSON.stringify(entry)}`
        )
      }
    }

    const uniquelyIdentifiedProjectlessThreads = projectlessThreads.filter(
      (thread) => titleCounts.get(threadTitle(thread)) === 1
    )
    const projectlessPlacements = uniquelyIdentifiedProjectlessThreads.map((thread) => {
      const title = threadTitle(thread)
      return {
        id: thread.id,
        cwd: thread.cwd,
        title,
        placements: dom.placements.filter((placement) => placement.title === title)
      }
    })
    for (const entry of projectlessPlacements) {
      assert(
        entry.placements.length === 1 &&
          entry.placements[0].section === 'Recents' &&
          entry.placements[0].projectId === null,
        `projectless thread escaped Recents: ${JSON.stringify(entry)}`
      )
    }

    return {
      backendThreadCount: catalogThreads.length,
      expectedProjects,
      expectedProjectPaths,
      renderedProjectIds: projectIds,
      catalogPlacements,
      projectlessThreads: projectlessThreads.map((thread) => ({
        id: thread.id,
        cwd: thread.cwd,
        title: threadTitle(thread),
        uniquelyIdentifiable: titleCounts.get(threadTitle(thread)) === 1
      })),
      projectlessPlacements,
      groups: dom.groups
    }
  })

  await check('Visible project and thread rows are 30 CSS pixels high', async () => {
    await ensureSectionOpen('Pinned')
    await ensureSectionOpen('Projects')
    await ensureSectionOpen('Recents')
    await ensureAllProjectsOpen()
    const rows = await evaluate(`(() => {
      const measure = (selector) => [...document.querySelectorAll(selector)]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const projectLabel = element.matches('[data-app-action-sidebar-project-row]')
            ? element.querySelector(':scope > span')
            : null;
          const projectLabelStyle = projectLabel ? getComputedStyle(projectLabel) : null;
          const threadCopy = element.matches('[data-app-action-sidebar-thread-row]')
            ? element.querySelector('.thread-row-copy > span')
            : null;
          const threadCopyStyle = threadCopy ? getComputedStyle(threadCopy) : null;
          return {
            height: box.height,
            fontFamily: style.fontFamily,
            fontSize: Number.parseFloat(style.fontSize),
            fontWeight: Number.parseFloat(style.fontWeight),
            lineHeight: Number.parseFloat(style.lineHeight),
            text: element.textContent?.trim() || '',
            id: element.getAttribute('data-app-action-sidebar-project-id') || null,
            projectLabelTypography: projectLabelStyle ? {
              fontFamily: projectLabelStyle.fontFamily,
              fontSize: Number.parseFloat(projectLabelStyle.fontSize),
              fontWeight: Number.parseFloat(projectLabelStyle.fontWeight),
              lineHeight: Number.parseFloat(projectLabelStyle.lineHeight)
            } : null,
            threadCopyTypography: threadCopyStyle ? {
              fontFamily: threadCopyStyle.fontFamily,
              fontSize: Number.parseFloat(threadCopyStyle.fontSize),
              fontWeight: Number.parseFloat(threadCopyStyle.fontWeight),
              lineHeight: Number.parseFloat(threadCopyStyle.lineHeight)
            } : null
          };
        });
      return {
        projects: measure('[data-app-action-sidebar-project-row]'),
        threads: measure('[data-app-action-sidebar-thread-row]')
      };
    })()`)

    const expectedProjectCount = explicitProjects?.length || 0
    if (expectedProjectCount > 0) {
      assert(rows.projects.length > 0, 'registered projects exist but no visible project row was measured')
    }
    if ((catalogThreads?.length || 0) > 0) {
      assert(rows.threads.length > 0, 'threads exist but no visible thread row was measured')
    }
    for (const [index, row] of rows.projects.entries()) {
      assertClose(`project row ${index} height`, row.height, 30)
      assertClose(`project row ${index} font size`, row.fontSize, 13, 0.1)
      assertClose(`project row ${index} font weight`, row.fontWeight, 430, 0.1)
      assertClose(`project row ${index} line height`, row.lineHeight, 18.5714, 0.1)
      assertMacSystemFont(`project row ${index} font family`, row.fontFamily)
      assertClose(
        `project label ${index} font size`,
        row.projectLabelTypography?.fontSize,
        14,
        0.1
      )
      assertClose(
        `project label ${index} font weight`,
        row.projectLabelTypography?.fontWeight,
        430,
        0.1
      )
      assertClose(
        `project label ${index} line height`,
        row.projectLabelTypography?.lineHeight,
        21,
        0.1
      )
      assertMacSystemFont(
        `project label ${index} font family`,
        row.projectLabelTypography?.fontFamily
      )
    }
    for (const [index, row] of rows.threads.entries()) {
      assertClose(`thread row ${index} height`, row.height, 30)
      assertClose(`thread row ${index} font size`, row.fontSize, 13, 0.1)
      assertClose(`thread row ${index} font weight`, row.fontWeight, 430, 0.1)
      assertClose(`thread row ${index} line height`, row.lineHeight, 18.5714, 0.1)
      assertMacSystemFont(`thread row ${index} font family`, row.fontFamily)
      assertClose(
        `thread copy ${index} font size`,
        row.threadCopyTypography?.fontSize,
        14,
        0.1
      )
      assertClose(
        `thread copy ${index} font weight`,
        row.threadCopyTypography?.fontWeight,
        430,
        0.1
      )
      assertClose(
        `thread copy ${index} line height`,
        row.threadCopyTypography?.lineHeight,
        20,
        0.1
      )
      assertMacSystemFont(
        `thread copy ${index} font family`,
        row.threadCopyTypography?.fontFamily
      )
    }
    return rows
  })

  await check('Project rows toggle their nested thread list and restore', async () => {
    await ensureSectionOpen('Pinned')
    await ensureSectionOpen('Projects')
    const candidates = await evaluate(`(() =>
      [...document.querySelectorAll('[data-app-action-sidebar-project-list-id]')].map((group) => {
        const row = group.querySelector('[data-app-action-sidebar-project-row]');
        const box = row?.getBoundingClientRect();
        return {
          id: group.getAttribute('data-app-action-sidebar-project-list-id'),
          visible: Boolean(box && box.width > 0 && box.height > 0),
          collapsed: row?.getAttribute('data-app-action-sidebar-project-collapsed') || null,
          expanded: row?.getAttribute('aria-expanded') || null,
          contentMounted: Boolean(group.querySelector(':scope > .sidebar-project-threads'))
        };
      })
    )()`)
    const expectedCounts = new Map()
    for (const thread of catalogThreads || []) {
      const project = projectForThread(thread, explicitProjects || [])
      if (project) expectedCounts.set(project.id, (expectedCounts.get(project.id) || 0) + 1)
    }
    const candidate =
      candidates.find((entry) => entry.visible && (expectedCounts.get(entry.id) || 0) > 0) ||
      candidates.find((entry) => entry.visible)
    if (!candidate) return { skipped: true, reason: 'no project row is present in this catalog' }

    await clickExpression(
      `(${projectExpression(candidate.id)})?.querySelector('[data-app-action-sidebar-project-row]')`,
      `project row ${candidate.id}`
    )
    const after = await waitFor(`(() => {
      const group = (${projectExpression(candidate.id)});
      const row = group?.querySelector('[data-app-action-sidebar-project-row]');
      const collapsed = row?.getAttribute('data-app-action-sidebar-project-collapsed');
      if (!collapsed || collapsed === ${JSON.stringify(candidate.collapsed)}) return null;
      return {
        collapsed,
        expanded: row.getAttribute('aria-expanded'),
        contentMounted: Boolean(group.querySelector(':scope > .sidebar-project-threads'))
      };
    })()`)
    assert(
      after.expanded === String(after.collapsed === 'false'),
      `project aria-expanded did not follow the toggle: ${JSON.stringify(after)}`
    )
    if ((expectedCounts.get(candidate.id) || 0) > 0) {
      assert(
        after.contentMounted === (after.collapsed === 'false'),
        `project thread list mount did not follow the toggle: ${JSON.stringify(after)}`
      )
    }

    await clickExpression(
      `(${projectExpression(candidate.id)})?.querySelector('[data-app-action-sidebar-project-row]')`,
      `project row ${candidate.id} restore`
    )
    const restored = await waitFor(`(() => {
      const group = (${projectExpression(candidate.id)});
      const row = group?.querySelector('[data-app-action-sidebar-project-row]');
      const collapsed = row?.getAttribute('data-app-action-sidebar-project-collapsed');
      if (collapsed !== ${JSON.stringify(candidate.collapsed)}) return null;
      return {
        collapsed,
        expanded: row.getAttribute('aria-expanded'),
        contentMounted: Boolean(group.querySelector(':scope > .sidebar-project-threads'))
      };
    })()`)
    assert(
      restored.expanded === candidate.expanded &&
        restored.contentMounted === candidate.contentMounted,
      `project row did not return to its initial state: ${JSON.stringify(restored)}`
    )
    return { candidate, expectedThreadCount: expectedCounts.get(candidate.id) || 0, after, restored }
  })

  await check('Project preview exposes five rows and 展开显示 reveals the remainder', async () => {
    await ensureSectionOpen('Pinned')
    await ensureSectionOpen('Projects')
    await ensureAllProjectsOpen()
    const controls = await evaluate(`(() =>
      [...document.querySelectorAll('.sidebar-expand')].map((button) => {
        const group = button.closest('[data-app-action-sidebar-project-list-id]');
        return {
          projectId: group?.getAttribute('data-app-action-sidebar-project-list-id') || null,
          label: button.textContent?.trim() || '',
          height: button.getBoundingClientRect().height,
          threadCount: group?.querySelectorAll('.sidebar-project-threads [data-app-action-sidebar-thread-row]').length || 0
        };
      })
    )()`)
    const maximumBackendGroup = Math.max(
      0,
      ...[...(catalogThreads || []).reduce((counts, thread) => {
        const project = projectForThread(thread, explicitProjects || [])
        if (project) counts.set(project.id, (counts.get(project.id) || 0) + 1)
        return counts
      }, new Map()).values()]
    )
    if (controls.length === 0) {
      assert(
        maximumBackendGroup <= 5,
        `a project has ${maximumBackendGroup} threads but no 展开显示 control was rendered`
      )
      return {
        skipped: true,
        reason: 'no project in the current 50-thread catalog exceeds five rows',
        maximumBackendGroup
      }
    }

    const before = controls[0]
    assert(
      before.label === '展开显示' || before.label === '收起显示',
      `unexpected project preview action: ${before.label}`
    )
    assertClose('project preview action height', before.height, 24)
    await clickExpression(
      `(${projectExpression(before.projectId)})?.querySelector('.sidebar-expand')`,
      `${before.label} for ${before.projectId}`
    )
    const after = await waitFor(`(() => {
      const group = (${projectExpression(before.projectId)});
      const button = group?.querySelector('.sidebar-expand');
      const label = button?.textContent?.trim() || '';
      if (!label || label === ${JSON.stringify(before.label)}) return null;
      return {
        label,
        height: button.getBoundingClientRect().height,
        threadCount: group.querySelectorAll('.sidebar-project-threads [data-app-action-sidebar-thread-row]').length
      };
    })()`)
    assertClose('toggled project preview action height', after.height, 24)
    if (before.label === '展开显示') {
      assert(before.threadCount === 5, `collapsed project preview showed ${before.threadCount} rows`)
      assert(after.label === '收起显示', `expand action became ${after.label}`)
      assert(after.threadCount > before.threadCount, '展开显示 did not reveal additional threads')
    } else {
      assert(before.threadCount > 5, `expanded project preview showed ${before.threadCount} rows`)
      assert(after.label === '展开显示', `collapse action became ${after.label}`)
      assert(after.threadCount === 5, `收起显示 left ${after.threadCount} rows visible`)
    }

    await clickExpression(
      `(${projectExpression(before.projectId)})?.querySelector('.sidebar-expand')`,
      `restore project preview for ${before.projectId}`
    )
    const restored = await waitFor(`(() => {
      const group = (${projectExpression(before.projectId)});
      const button = group?.querySelector('.sidebar-expand');
      const label = button?.textContent?.trim() || '';
      const threadCount = group?.querySelectorAll('.sidebar-project-threads [data-app-action-sidebar-thread-row]').length || 0;
      return label === ${JSON.stringify(before.label)} && threadCount === ${before.threadCount}
        ? { label, threadCount, height: button.getBoundingClientRect().height }
        : null;
    })()`)
    return { before, after, restored, maximumBackendGroup }
  })

  await check('Project hover exposes two 20×20 new-chat/menu controls', async () => {
    await ensureSectionOpen('Pinned')
    await ensureSectionOpen('Projects')
    const visibleProjectExpression = `[...document.querySelectorAll('.sidebar-project-row-wrap')]
      .find((wrap) => {
        const box = wrap.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && Boolean(wrap.querySelector('.sidebar-project-hover-actions'));
      })`
    const before = await evaluate(`(() => {
      const wrap = (${visibleProjectExpression});
      const actions = wrap?.querySelector('.sidebar-project-hover-actions');
      return actions ? {
        opacity: getComputedStyle(actions).opacity,
        pointerEvents: getComputedStyle(actions).pointerEvents,
        row: (() => {
          const box = wrap.getBoundingClientRect();
          return { x: box.x, width: box.width, right: box.right };
        })(),
        projectId: wrap.closest('[data-app-action-sidebar-project-list-id]')
          ?.getAttribute('data-app-action-sidebar-project-list-id') || null,
        projectLabel: wrap.querySelector('[data-app-action-sidebar-project-row]')
          ?.getAttribute('data-app-action-sidebar-project-label') || null
      } : null;
    })()`)
    if (!before) {
      const registeredProjectCount = explicitProjects?.length || 0
      assert(registeredProjectCount === 0, 'registered projects exist but no project hover target was found')
      return { skipped: true, reason: 'the current active catalog has no project rows' }
    }
    assert(before.projectLabel, `project hover target is missing its label: ${JSON.stringify(before)}`)

    await hoverExpression(visibleProjectExpression, 'project row')
    const hovered = await evaluate(`(() => {
      const wrap = (${visibleProjectExpression});
      const actions = wrap?.querySelector('.sidebar-project-hover-actions');
      if (!actions) return null;
      return {
        opacity: getComputedStyle(actions).opacity,
        pointerEvents: getComputedStyle(actions).pointerEvents,
        buttons: [...actions.querySelectorAll('button')].map((button) => {
          const box = button.getBoundingClientRect();
          const icon = button.querySelector('svg')?.getBoundingClientRect();
          return {
            label: button.getAttribute('aria-label'),
            x: box.x,
            right: box.right,
            width: box.width,
            height: box.height,
            borderRadius: getComputedStyle(button).borderRadius,
            iconWidth: icon?.width || null,
            iconHeight: icon?.height || null
          };
        })
      };
    })()`)
    assert(hovered, 'project hover controls disappeared')
    assert(hovered.opacity === '1', `project hover opacity was ${hovered.opacity}`)
    assert(hovered.pointerEvents !== 'none', 'project hover controls reject pointer events')
    assert(hovered.buttons.length === 2, `project hover button count: ${hovered.buttons.length}`)
    assert(
      hovered.buttons.some(
        (button) => button.label === `在 ${before.projectLabel} 中开始新聊天`
      ),
      `project new-chat action is missing: ${JSON.stringify(hovered.buttons)}`
    )
    assert(
      hovered.buttons.some(
        (button) => button.label === `${before.projectLabel} 的项目操作`
      ),
      `project menu action is missing: ${JSON.stringify(hovered.buttons)}`
    )
    for (const [index, button] of hovered.buttons.entries()) {
      assertClose(`project hover button ${index} width`, button.width, 20)
      assertClose(`project hover button ${index} height`, button.height, 20)
      assertClose(`project hover icon ${index} width`, button.iconWidth, 14)
      assertClose(`project hover icon ${index} height`, button.iconHeight, 14)
      assert(button.borderRadius === '9999px', `project hover button ${index} radius: ${button.borderRadius}`)
    }
    assertClose('project hover first button x', hovered.buttons[0].x, before.row.right - 56)
    assertClose('project hover button gap', hovered.buttons[1].x - hovered.buttons[0].right, 8)
    assertClose('project hover trailing inset', before.row.right - hovered.buttons[1].right, 8)
    await movePointerAway()
    return { before, hovered }
  })

  await check('Thread hover exposes exactly two 20×20 pin/archive controls', async () => {
    await ensureSectionOpen('Pinned')
    await ensureSectionOpen('Projects')
    await ensureSectionOpen('Recents')
    await ensureAllProjectsOpen()
    const visibleThreadExpression = `[...document.querySelectorAll('.thread-row-wrap')]
      .find((wrap) => {
        const box = wrap.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && Boolean(wrap.querySelector('.thread-row-hover-actions'));
      })`
    const before = await evaluate(`(() => {
      const wrap = (${visibleThreadExpression});
      const row = wrap?.querySelector('[data-app-action-sidebar-thread-row]');
      const actions = wrap?.querySelector('.thread-row-hover-actions');
      return row && actions ? {
        rowHeight: row.getBoundingClientRect().height,
        row: (() => {
          const box = row.getBoundingClientRect();
          return { x: box.x, width: box.width, right: box.right };
        })(),
        opacity: getComputedStyle(actions).opacity,
        pointerEvents: getComputedStyle(actions).pointerEvents,
        section: wrap.closest('[data-app-action-sidebar-section]')
          ?.getAttribute('data-app-action-sidebar-section-heading') || null,
        projectId: wrap.closest('[data-app-action-sidebar-project-list-id]')
          ?.getAttribute('data-app-action-sidebar-project-list-id') || null
      } : null;
    })()`)
    if (!before) {
      assert((catalogThreads?.length || 0) === 0, 'threads exist but no thread hover target was found')
      return { skipped: true, reason: 'the current active catalog has no threads' }
    }
    assertClose('thread row height', before.rowHeight, 30)

    await hoverExpression(visibleThreadExpression, 'thread row')
    const hovered = await evaluate(`(() => {
      const wrap = (${visibleThreadExpression});
      const actions = wrap?.querySelector('.thread-row-hover-actions');
      if (!actions) return null;
      return {
        opacity: getComputedStyle(actions).opacity,
        pointerEvents: getComputedStyle(actions).pointerEvents,
        buttons: [...actions.querySelectorAll('button')].map((button) => {
          const box = button.getBoundingClientRect();
          const icon = button.querySelector('svg')?.getBoundingClientRect();
          return {
            label: button.getAttribute('aria-label'),
            x: box.x,
            right: box.right,
            width: box.width,
            height: box.height,
            borderRadius: getComputedStyle(button).borderRadius,
            iconWidth: icon?.width || null,
            iconHeight: icon?.height || null
          };
        })
      };
    })()`)
    assert(hovered, 'thread hover controls disappeared')
    assert(hovered.opacity === '1', `thread hover opacity was ${hovered.opacity}`)
    assert(hovered.pointerEvents !== 'none', 'thread hover controls reject pointer events')
    assert(hovered.buttons.length === 2, `thread hover button count: ${hovered.buttons.length}`)
    assert(
      hovered.buttons.some((button) => /^(?:取消)?置顶聊天$/.test(button.label || '')),
      `thread pin action is missing: ${JSON.stringify(hovered.buttons)}`
    )
    assert(
      hovered.buttons.some((button) => button.label === '归档聊天'),
      `thread archive action is missing: ${JSON.stringify(hovered.buttons)}`
    )
    for (const [index, button] of hovered.buttons.entries()) {
      assertClose(`thread hover button ${index} width`, button.width, 20)
      assertClose(`thread hover button ${index} height`, button.height, 20)
      assertClose(`thread hover icon ${index} width`, button.iconWidth, 14)
      assertClose(`thread hover icon ${index} height`, button.iconHeight, 14)
      assert(button.borderRadius === '9999px', `thread hover button ${index} radius: ${button.borderRadius}`)
    }
    assertClose('thread hover first button x', hovered.buttons[0].x, before.row.right - 56)
    assertClose('thread hover button gap', hovered.buttons[1].x - hovered.buttons[0].right, 8)
    assertClose('thread hover trailing inset', before.row.right - hovered.buttons[1].right, 8)

    await movePointerAway()
    return { before, hovered }
  })

  await check('Workspace thread pin/unpin updates Pinned, Project, Recents, and restores state', async () => {
    await ensureSectionOpen('Pinned')
    await ensureSectionOpen('Projects')
    await ensureSectionOpen('Recents')
    await ensureAllProjectPreviewsExpanded()

    const initialPreferenceRaw = await evaluate(
      `localStorage.getItem('codex-thread-preferences-v1')`
    )
    const initialPreferences = parseThreadPreferences(initialPreferenceRaw)
    const titleCounts = new Map()
    for (const thread of catalogThreads || []) {
      const title = threadTitle(thread)
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1)
    }
    const renderedProjectThreads = await evaluate(`(() =>
      [...document.querySelectorAll('[data-app-action-sidebar-project-list-id] .thread-row-wrap')]
        .map((wrap) => {
          const row = wrap.querySelector('[data-app-action-sidebar-thread-row]');
          return {
            projectId: wrap.closest('[data-app-action-sidebar-project-list-id]')
              ?.getAttribute('data-app-action-sidebar-project-list-id') || null,
            title: row?.querySelector('.thread-row-copy .sidebar-marquee-track > span:not([aria-hidden])')
              ?.textContent?.trim() || '',
            pinned: row?.getAttribute('data-app-action-sidebar-thread-pinned') || null
          };
        })
    )()`)
    const candidates = (catalogThreads || []).filter((thread) => {
      const project = projectForThread(thread, explicitProjects || [])
      const title = threadTitle(thread)
      return Boolean(
        project &&
        titleCounts.get(title) === 1 &&
        renderedProjectThreads.some(
          (row) => row.projectId === project.id && row.title === title
        )
      )
    })
    const candidatesById = new Map(candidates.map((thread) => [thread.id, thread]))
    const initiallyPinnedCandidate = initialPreferences.pinned
      .map((id) => candidatesById.get(id))
      .find(Boolean)
    const candidate =
      initiallyPinnedCandidate ||
      candidates.find((thread) => !initialPreferences.pinned.includes(thread.id))

    if (!candidate) {
      const validWorkspaceThreadCount = (catalogThreads || []).filter((thread) =>
        Boolean(projectForThread(thread, explicitProjects || []))
      ).length
      assert(
        validWorkspaceThreadCount === 0,
        'valid workspace threads exist, but none has a unique rendered project title for the pin gate'
      )
      return { skipped: true, reason: 'the active catalog has no valid workspace thread' }
    }

    const candidateId = candidate.id
    const candidateCwd = normalizeWorkspacePath(candidate.cwd)
    const candidateProjectId = projectForThread(candidate, explicitProjects || [])?.id
    assert(candidateProjectId, 'pin candidate lost its explicit project assignment')
    const candidateTitle = threadTitle(candidate)
    const initiallyPinned = initialPreferences.pinned.includes(candidateId)
    const candidateWrapExpression = `(() => {
      const group = (${projectExpression(candidateProjectId)});
      return [...(group?.querySelectorAll('.thread-row-wrap') || [])]
        .find((wrap) => wrap.querySelector('.thread-row-copy .sidebar-marquee-track > span:not([aria-hidden])')
          ?.textContent?.trim() === ${JSON.stringify(candidateTitle)}) || null;
    })()`

    const captureState = async () =>
      evaluate(`(() => {
        const title = ${JSON.stringify(candidateTitle)};
        const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')]
          .filter((row) => row.querySelector('.thread-row-copy .sidebar-marquee-track > span:not([aria-hidden])')
            ?.textContent?.trim() === title)
          .map((row) => ({
            section: row.closest('[data-app-action-sidebar-section]')
              ?.getAttribute('data-app-action-sidebar-section-heading') || null,
            projectId: row.closest('[data-app-action-sidebar-project-list-id]')
              ?.getAttribute('data-app-action-sidebar-project-list-id') || null,
            pinned: row.getAttribute('data-app-action-sidebar-thread-pinned'),
            pinAction: row.closest('.thread-row-wrap')
              ?.querySelector('.thread-row-hover-actions button:first-child')
              ?.getAttribute('aria-label') || null
          }));
        const preferenceRaw = localStorage.getItem('codex-thread-preferences-v1');
        let preferencePinned = false;
        try {
          const parsed = preferenceRaw ? JSON.parse(preferenceRaw) : {};
          preferencePinned = Array.isArray(parsed?.pinned) &&
            parsed.pinned.includes(${JSON.stringify(candidateId)});
        } catch {}
        return {
          rows,
          preferenceRaw,
          preferencePinned,
          pinnedSectionExists: Boolean((${sectionExpression('Pinned')}))
        };
      })()`)

    const toggleCandidate = async (targetPinned) => {
      const actionLabel = targetPinned ? '置顶聊天' : '取消置顶聊天'
      await hoverExpression(candidateWrapExpression, `${candidateTitle} project thread`)
      await clickExpression(
        `(() => {
          const wrap = (${candidateWrapExpression});
          return [...(wrap?.querySelectorAll('.thread-row-hover-actions button') || [])]
            .find((button) => button.getAttribute('aria-label') === ${JSON.stringify(actionLabel)}) || null;
        })()`,
        `${actionLabel}: ${candidateTitle}`
      )
      await waitFor(`(() => {
        const wrap = (${candidateWrapExpression});
        const row = wrap?.querySelector('[data-app-action-sidebar-thread-row]');
        let preferencePinned = false;
        try {
          const raw = localStorage.getItem('codex-thread-preferences-v1');
          const parsed = raw ? JSON.parse(raw) : {};
          preferencePinned = Array.isArray(parsed?.pinned) &&
            parsed.pinned.includes(${JSON.stringify(candidateId)});
        } catch {}
        return preferencePinned === ${JSON.stringify(targetPinned)} &&
          row?.getAttribute('data-app-action-sidebar-thread-pinned') === ${JSON.stringify(String(targetPinned))};
      })()`)
      if (targetPinned) await ensureSectionOpen('Pinned')
      await pause(120)
      return captureState()
    }

    const initialState = await captureState()
    let toggledState = null
    let restoredState = null
    try {
      toggledState = await toggleCandidate(!initiallyPinned)
      restoredState = await toggleCandidate(initiallyPinned)
    } finally {
      const currentState = await captureState()
      if (currentState.preferencePinned !== initiallyPinned) {
        await toggleCandidate(initiallyPinned)
      }
    }

    const assertPlacement = (state, expectedPinned, label) => {
      const projectRows = state.rows.filter((row) => row.projectId === candidateProjectId)
      const standalonePinnedRows = state.rows.filter(
        (row) => row.section === 'Pinned' && row.projectId === null
      )
      const recentRows = state.rows.filter((row) => row.section === 'Recents')
      assert(
        state.preferencePinned === expectedPinned,
        `${label} localStorage pin state: ${JSON.stringify(state)}`
      )
      assert(
        projectRows.length === 1 && projectRows[0].pinned === String(expectedPinned),
        `${label} project placement: ${JSON.stringify(state.rows)}`
      )
      assert(
        standalonePinnedRows.length === (expectedPinned ? 1 : 0),
        `${label} standalone Pinned placement: ${JSON.stringify(state.rows)}`
      )
      assert(
        recentRows.length === 1 && recentRows[0].pinned === String(expectedPinned),
        `${label} global Recents placement: ${JSON.stringify(recentRows)}`
      )
      if (expectedPinned) {
        assert(state.pinnedSectionExists, `${label} did not render the Pinned section`)
        assert(
          standalonePinnedRows[0]?.pinned === 'true',
          `${label} standalone Pinned row is not marked pinned`
        )
      }
    }

    assertPlacement(initialState, initiallyPinned, 'initial')
    assertPlacement(toggledState, !initiallyPinned, 'toggled')
    assertPlacement(restoredState, initiallyPinned, 'restored')
    assert(
      restoredState.pinnedSectionExists === initialState.pinnedSectionExists,
      `Pinned section presence was not restored: ${JSON.stringify({ initialState, restoredState })}`
    )

    const restoredPreferences = parseThreadPreferences(restoredState.preferenceRaw)
    assert(
      sameStringSet(restoredPreferences.pinned, initialPreferences.pinned),
      `pinned preference membership was not restored: ${JSON.stringify({ initialPreferences, restoredPreferences })}`
    )
    assert(
      sameStringSet(restoredPreferences.unread, initialPreferences.unread),
      `unread preferences changed during pin gate: ${JSON.stringify({ initialPreferences, restoredPreferences })}`
    )
    const placementSignature = (state) =>
      JSON.stringify(
        state.rows
          .map((row) => ({ section: row.section, projectId: row.projectId, pinned: row.pinned }))
          .sort((left, right) =>
            `${left.section}:${left.projectId}`.localeCompare(`${right.section}:${right.projectId}`)
          )
      )
    assert(
      placementSignature(restoredState) === placementSignature(initialState),
      `thread DOM placement was not restored: ${JSON.stringify({ initialState, restoredState })}`
    )

    await movePointerAway()
    return {
      branch: initiallyPinned ? 'unpin-repin' : 'pin-unpin',
      candidate: {
        id: candidateId,
        cwd: candidateCwd,
        projectId: candidateProjectId,
        title: candidateTitle
      },
      initialPinnedSectionExists: initialState.pinnedSectionExists,
      initialPreferenceRaw,
      restoredPreferenceRaw: restoredState.preferenceRaw,
      rawPreferenceRestored: restoredState.preferenceRaw === initialPreferenceRaw,
      initialState,
      toggledState,
      restoredState
    }
  })
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error)
} finally {
  if (initialStorage) {
    restoration = { attempted: true, passed: false }
    try {
      await evaluate(`(() => {
        const snapshot = ${JSON.stringify(initialStorage)};
        for (const key of ${JSON.stringify(sidebarStorageKeys)}) {
          if (snapshot[key] === null) localStorage.removeItem(key);
          else localStorage.setItem(key, snapshot[key]);
        }
      })()`)
      await command('Page.reload', { ignoreCache: true })
      await waitFor(rendererReadyExpression, 30_000)
      await pause(250)
      await evaluate(`(() => {
        const scroll = document.querySelector('[data-app-action-sidebar-scroll]');
        if (scroll) scroll.scrollTop = ${JSON.stringify(initialScrollTop || 0)};
      })()`)
      const restoredState = await waitFor(`(() => {
        const snapshot = ${JSON.stringify(initialStorage)};
        const storageMatches = ${JSON.stringify(sidebarStorageKeys)}.every((key) => {
          const current = localStorage.getItem(key);
          return snapshot[key] === null
            ? current === null || current === '[]'
            : current === snapshot[key];
        });
        const scrollTop = document.querySelector('[data-app-action-sidebar-scroll]')?.scrollTop || 0;
        return storageMatches && Math.abs(scrollTop - ${JSON.stringify(initialScrollTop || 0)}) <= 1
          ? { storageMatches, scrollTop }
          : null;
      })()`, 30_000)
      restoration = {
        attempted: true,
        passed: true,
        storage: initialStorage,
        scrollTop: initialScrollTop,
        restoredState
      }
    } catch (error) {
      restoration = {
        attempted: true,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        storage: initialStorage
      }
    }
  }
}

if (fatalError) {
  checks.push({ name: 'Gate execution completed', passed: false, error: fatalError })
}
if (!restoration.passed) {
  checks.push({
    name: 'Temporary sidebar state was restored',
    passed: false,
    error: restoration.error || 'sidebar state restoration did not complete'
  })
} else {
  checks.push({
    name: 'Temporary sidebar state was restored',
    passed: true,
    evidence: restoration
  })
}
if (runtimeExceptions !== 0) {
  checks.push({
    name: 'No runtime exceptions during sidebar gate',
    passed: false,
    error: `${runtimeExceptions} Runtime.exceptionThrown event(s) were observed`
  })
} else {
  checks.push({
    name: 'No runtime exceptions during sidebar gate',
    passed: true,
    evidence: { runtimeExceptions }
  })
}

const failures = checks.filter((entry) => !entry.passed)
const report = {
  target: {
    port,
    url: target.url,
    id: target.id || null,
    title: target.title || null,
    upstreamPortRejected: forbiddenUpstreamPort
  },
  checks,
  runtimeExceptions,
  restoration,
  passed: failures.length === 0,
  failures: failures.map((entry) => ({ name: entry.name, error: entry.error }))
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
socket.close()
if (failures.length > 0) process.exitCode = 1

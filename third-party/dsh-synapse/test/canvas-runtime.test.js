import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('uses one camera transform without browser scroll coordinates', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /canvasCamera: \{ x: 0, y: 0 \}/)
  assert.match(source, /translate\(\$\{state\.canvasCamera\.x\}px, \$\{state\.canvasCamera\.y\}px\) scale\(\$\{state\.zoom\}\)/)
  assert.doesNotMatch(source, /canvasScroll|canvasPadding|canvasDomShift|canvasMetrics|viewport\.scrollLeft|viewport\.scrollTop/)
})

test('reuses the live map iframe and retries initialization only after iframe load', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const openFlow = source.slice(source.indexOf('let mapOpenFallback'), source.indexOf('const onMessage'))
  const open = openFlow.slice(openFlow.indexOf('const open ='), openFlow.indexOf('const onFrameLoad'))

  assert.doesNotMatch(openFlow, /frame\.src\s*=/)
  assert.match(openFlow, /const onFrameLoad/)
  assert.match(openFlow, /if \(mapOpening\) send\('synapse:map-opened'\)/)
  assert.ok(open.indexOf('overlay.hidden = false') < open.indexOf("send('synapse:map-opened')"))
  assert.match(open, /overlay\.classList\.add\('is-opening'\)/)
})

test('recenters the canvas whenever the map view is reopened', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const mapOpened = source.slice(source.indexOf("if (data.type === 'synapse:map-opened')"), source.indexOf("if (data.type === 'synapse:workspaces')"))

  assert.match(mapOpened, /resetCanvasCamera\(\)/)
  assert.match(mapOpened, /state\.mode = 'canvas'\s+render\(\)/)
})

test('lets the card answer scroll with the native wheel instead of adding deltaY', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const wheel = source.slice(source.indexOf("app.addEventListener('wheel'"), source.indexOf("app.addEventListener('click'"))

  assert.match(wheel, /native wheel/)
  assert.doesNotMatch(wheel, /scrollTop\s*\+=/)
})

test('preserves each card answer scroll across canvas re-renders', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const render = source.slice(source.indexOf('function render() {'), source.indexOf('function renderPreservingDetailScroll'))

  assert.match(render, /cardScrollTops/)
  assert.match(render, /\.thread-answer`\)\s*if \(answer instanceof HTMLElement\) answer\.scrollTop = scrollTop/)
})

test('activating a session from the map syncs DSH without closing the map', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const activate = source.slice(source.indexOf("'synapse:activate-session'"), source.indexOf("'synapse:fork-session'"))

  assert.match(activate, /ctx\.sessions\.open\(event\.data\.sessionId\)/)
  assert.doesNotMatch(activate, /close\(\)/)
})

test('selecting a session in the sidebar syncs the DSH current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("button.dataset.action === 'show-thread'"))

  assert.match(selectThread, /synapse:activate-session/)
})

test('clicking a session card syncs the DSH current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(cardClick, /thread\.dshSessionId !== null\) post\('synapse:activate-session'/)
})

test('renders markdown tables and allows higher canvas zoom', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const markdown = source.slice(source.indexOf('function markdownBlock'), source.indexOf('function overlapsCard'))

  assert.match(markdown, /<table><thead>/)
  assert.match(markdown, /isTableDelimiter/)
  assert.match(source, /Math\.min\(4,/)
})

test('renders the refactored detail view with role-based messages', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const thread = source.slice(source.indexOf('function renderThread'), source.indexOf('function render()'))
  const message = source.slice(source.indexOf('function threadMessage'), source.indexOf('function processRecords'))

  assert.match(thread, /detail-scroll/)
  assert.match(thread, /detail-head/)
  assert.match(message, /message-avatar/)
  assert.match(message, /message-body/)
})

test('detail view renders an inline branch/follow-up draft', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const thread = source.slice(source.indexOf('function renderThread'), source.indexOf('function render()'))

  assert.match(thread, /detail-draft/)
  assert.match(thread, /draft\.parentId === thread\.id/)
  assert.match(thread, /draftActions\(draft\)/)
})

test('persists dragged card positions and can focus the current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /localStorage\.setItem\(CARD_POSITIONS_KEY/)
  assert.match(source, /function focusActiveCard\(\)/)
  assert.match(source, /data-action="focus-active"/)
})

test('loads full DSH history into the canvas instead of only post-install projections', async () => {
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // Client side: a history RPC that opens/pages the session log and returns nodes.
  assert.match(client, /synapse:load-history/)
  assert.match(client, /loadOlder\(\)/)
  assert.match(client, /messagesFromNodes\(snapshot\.nodes, atSeq\)/)
  // App side: real cache writes + merge with projected tail.
  assert.match(app, /state\.historyBySession\.set\(thread\.dshSessionId, messages\)/)
  assert.match(app, /function persistedMessagesFor\(thread\)/)
})

test('fork history is trimmed to the branch tail, not the inherited prefix', async () => {
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // Client trims nodes whose seq <= the fork cut.
  assert.match(client, /node\.seq < cut/)
  // App passes the cut through loadSessionToMap and caches it as sourceSeedLength.
  assert.match(app, /loadSessionToMap\(session\.id, \{ title: session\.title \}, parent, false, draft\.atSeq\)/)
  assert.match(app, /sourceSeedLength: sourceSeedLength \?\? previous\?\.sourceSeedLength \?\? null/)
  // When no cut is supplied (sync button), infer the branch boundary from the
  // first user message that is not part of the parent's history.
  assert.match(app, /const firstOwnUser = messages\.find\(message => message\.kind === 'user' && !parentUserTexts\.has\(message\.text\)\)/)
  assert.match(app, /seed = firstOwnUser\.sourceSeq/)
  // Force-refresh after turn completion preserves the branch cut.
  assert.match(app, /entry\?\.sourceSeedLength/)
})

test('map is drag-to-load with localStorage cache, not auto-projection', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // Drag source in the left session library.
  assert.match(app, /draggable="true"/)
  assert.match(app, /data-session-id=/)
  // Drop target loads the session into the map.
  assert.match(app, /app\.addEventListener\('drop'/)
  assert.match(app, /loadSessionToMap\(/)
  // The whole right map area is the drop zone (works even when canvas is empty).
  assert.match(app, /event\.target instanceof Element \? event\.target\.closest\('\.main-stage'\)/)
  assert.match(app, /setDropTarget\(true\)/)
  // Persisted cache: read at startup + written on load.
  assert.match(app, /LOADED_SESSIONS_KEY/)
  assert.match(app, /localStorage\.getItem\(LOADED_SESSIONS_KEY\)/)
  assert.match(app, /function persistLoadedSessions\(\)/)
  // The left list carries per-session id/title from the DSH workspace snapshot.
  assert.match(client, /sessions: workspace\.sessionIds\.map\(toSession\)/)
})

test('loaded sessions can be unloaded individually or all at once', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // Unload a single loaded session from the left list or map card.
  assert.match(app, /function unloadSession\(sessionId\)/)
  assert.match(app, /state\.loadedSessions\.delete\(sessionId\)/)
  assert.match(app, /data-action="unload-session"/)
  // Clear the whole map.
  assert.match(app, /data-action="clear-map"/)
  assert.match(app, /for \(const sessionId of \[\.\.\.state\.loadedSessions\.keys\(\)\]\) unloadSession\(sessionId\)/)
})

test('a branch card always links to its parent thread, never becomes a new root row', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const cards = app.slice(app.indexOf('function conversationCards'), app.indexOf('function canvasConnectors'))

  // Fallback chain: explicit anchor -> DSH seed boundary -> parent thread's last card.
  assert.match(cards, /branchAnchors\.get\(card\.dshThreadId\) \?\? inheritedTurn\?\.id \?\? parentCards\?\.at\(-1\)\?\.id \?\? null/)
  // The comment documents why null must be avoided.
  assert.match(cards, /never fall back to null/)
})

test('streaming from another conversation does not rebuild the canvas', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // While running===true, only store the live text and return (no render).
  assert.match(app, /data\.running === true[\s\S]*?state\.liveReplies\.set[\s\S]*?return/)
  // Polling refreshes metadata but must not re-render the canvas.
  assert.match(app, /refreshProjection\(\)[\s\S]*?await refreshSummaries\(\{ renderAfter: false \}\)[\s\S]*?return false/)
  // Wheel gestures suppress full re-renders.
  assert.match(app, /wheelGestureUntil = Date\.now\(\) \+ 150/)
  assert.match(app, /Date\.now\(\) >= state\.wheelGestureUntil/)
})

test('turn completion clears pending reply so cards never stay on 正在回复', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // On running=false the pending marker is removed before the history refresh.
  assert.match(app, /state\.liveReplies\.delete\(data\.sessionId\)[\s\S]*?state\.pendingReplies\.delete\(data\.sessionId\)/)
  // Pending settlement matches user text without a fragile 2s timestamp window.
  assert.match(app, /Match by text only\./)
  assert.doesNotMatch(app, /pending\.at - 2_000/)
})

test('request ids work outside secure contexts (LAN http)', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // A fallback id helper exists and is used for RPC request ids.
  assert.match(app, /const makeId = \(\) =>/)
  assert.match(app, /getRandomValues/)
  assert.match(app, /const requestId = makeId\(\)/)
  // The direct global call must not appear outside the helper (only inside makeId's guard).
  const outside = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/const makeId = \(\) =>[\s\S]*?\n}/, '')
  assert.doesNotMatch(outside, /crypto\.randomUUID\(\)/)
})

test('map state syncs to the server so every device sees the same map', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const server = await readFile(new URL('../index.js', import.meta.url), 'utf8')

  // Local changes push to /api/map (debounced).
  assert.match(app, /fetch\('\/synapse\/api\/map', \{ method: 'PUT'/)
  assert.match(app, /mapSyncTimer = window\.setTimeout/)
  // On first open, pull the server map and adopt it. Server is authoritative,
  // but a pending local push skips the pull so a brand-new local session is
  // not clobbered before its debounced PUT fires.
  assert.match(app, /loadServerMap\(\)/)
  assert.match(app, /if \(mapSyncTimer !== 0\) return false/)
  // Server map is lightweight metadata; merge it into the local full cache
  // instead of replacing the heavy message logs.
  assert.match(app, /state\.loadedSessions = next/)
  assert.match(app, /hydrateServerMap\(\)/)
  // Push-based sync: SSE subscription, no polling interval for the map.
  assert.match(app, /new EventSource\('\/synapse\/api\/map\/events'\)/)
  assert.match(app, /map-changed/)
  assert.doesNotMatch(app, /setInterval\(\(\) => \{ void pollServerMap\(\) \}/)
  // Server broadcasts after a PUT and holds long-lived SSE connections.
  assert.match(server, /text\/event-stream/)
  assert.match(server, /broadcastMapChanged\(\)/)
})

test('sync button pulls server map and auto-adds DSH forks', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // Button exists in the top-right controls.
  assert.match(app, /data-action="sync-forks"/)
  assert.match(app, /title="同步：拉取服务端地图并自动加入新分支"/)
  // syncForks pulls server map + scans dshWorkspaces for forks with parentId.
  // Only forks whose parent is already on the map are auto-added: a sync must
  // not pull every historical fork/archived conversation onto the canvas.
  assert.match(app, /async function syncForks\(\)/)
  assert.match(app, /state\.loadedSessions\.has\(session\.parentId\)/)
  assert.match(app, /!state\.loadedSessions\.has\(session\.id\)/)
  // Archived forks are filtered client-side too (in addition to the server).
  assert.match(app, /!archived\.has\(session\.id\)/)
  assert.match(app, /loadSessionToMap\(session\.id, \{ title: session\.title \}/)
  // Client sends parentId + archivedSessionIds so forks/archived can be detected.
  assert.match(client, /parentId: summary\.parentId \?\? null/)
  assert.match(client, /archivedSessionIds/)
  // Subagent/team sessions are excluded from the left library (native sidebar parity).
  assert.match(client, /summary\.origin === 'subagent'/)
})



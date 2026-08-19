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

test('workspace select only updates the left session library (drag-only map)', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const select = source.slice(source.indexOf("app.addEventListener('change'"), source.indexOf("app.addEventListener('input'"))

  assert.match(select, /state\.selectedDshWorkspaceId = choice\.id/)
  assert.doesNotMatch(select, /post\('synapse:activate-session'/)
  assert.doesNotMatch(select, /choice\.sessionIds\[0\]/)
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

test('persists dragged card positions and can focus the current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /localStorage\.setItem\(CARD_POSITIONS_KEY/)
  assert.match(source, /function focusActiveCard\(\)/)
  assert.match(source, /data-action="focus-active"/)
})

test('workspace switching does not auto-load sessions into the map', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const select = source.slice(source.indexOf("app.addEventListener('change'"), source.indexOf("app.addEventListener('input'"))

  assert.doesNotMatch(select, /updatedAt/)
  assert.doesNotMatch(select, /openDshWorkspace\(|openWorkspace\(/)
  assert.match(select, /state\.selectedDshWorkspaceId = null/)
})

test('loads full DSH history into the canvas instead of only post-install projections', async () => {
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // Client side: a history RPC that opens/pages the session log and returns nodes.
  assert.match(client, /synapse:load-history/)
  assert.match(client, /loadOlder\(\)/)
  assert.match(client, /messagesFromNodes\(snapshot\.nodes\)/)
  // App side: real cache writes + merge with projected tail.
  assert.match(app, /state\.historyBySession\.set\(thread\.dshSessionId, messages\)/)
  assert.match(app, /function persistedMessagesFor\(thread\)/)
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

test('mirrors the Wallpaper Engine background inside the Synapse iframe', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  assert.match(app, /dsh-wallpaper-engine:selection/)
  assert.match(app, /function applySynapseWallpaper\(\)/)
  assert.match(app, /synapse-wallpaper-layer/)
  assert.match(app, /addEventListener\('storage'/)
  assert.match(css, /body\[data-synapse-wallpaper\]/)
  assert.match(css, /\.synapse-wallpaper-layer/)
  assert.match(css, /\.synapse-wallpaper-scrim/)
})

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
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("if (button.dataset.action === 'open-continue'"))

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

test('pure canvas map directly presents markdown and connects branches without redundant details view', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /renderMarkdown\(card\.answer\.text\)/)
  assert.match(source, /data-action="open-branch"/)
  assert.match(source, /data-action="open-dsh"/)
  assert.doesNotMatch(source, /class="canvas-tabs"/)
})

test('persists dragged card positions and can focus the current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /localStorage\.setItem\(mapStorageKey\(CARD_POSITIONS_KEY\)/)
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
  assert.match(cards, /card\.parentId = validAnchor \?\? inheritedTurn\?\.id \?\? parentCards\?\.at\(-1\)\?\.id \?\? null/)
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

  // Local changes push map metadata and card notes to /api/map (debounced).
  assert.match(app, /fetch\('\/synapse\/api\/map'/)
  assert.match(app, /notes: notesPayload/)
  assert.match(app, /triggerServerMapSync\(\)/)
  // On first open, pull the server map & notes and adopt them.
  assert.match(app, /loadServerMap\(\)/)
  assert.match(app, /if \(mapSyncTimer !== 0\) return false/)
  // Server map is lightweight metadata; merge it into the local full cache
  // instead of replacing the heavy message logs.
  assert.match(app, /state\.loadedSessions = next/)
  assert.match(app, /state\.cardNotes\.set\(cardId/)
  assert.match(app, /hydrateServerMap\(\)/)
  // Push-based sync: SSE subscription, no polling interval for the map.
  assert.match(app, /new EventSource\('\/synapse\/api\/map\/events'\)/)
  assert.match(app, /map-changed/)
  assert.doesNotMatch(app, /setInterval\(\(\) => \{ void pollServerMap\(\) \}/)
  // Server broadcasts after a PUT and holds long-lived SSE connections.
  assert.match(server, /text\/event-stream/)
  assert.match(server, /broadcastMapChanged\(\)/)
  assert.match(server, /getNotes\(\)/)
  assert.match(server, /setNotes\(/)
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

test('layout button automatically repairs broken parent-child connections', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  // Button triggers connection repair before resetting positions and re-rendering
  assert.match(app, /if \(button\.dataset\.action === 'layout' && mapThreads\(\)\.length > 0\)/)
  assert.match(app, /await repairLoadedSessionConnections\(\)/)
  assert.match(app, /async function repairLoadedSessionConnections\(\)/)

  // Test the repair function logic with VM
  const vm = await import('node:vm')
  const context = {
    globalThis: {},
    fetch: async () => ({ ok: false }),
    state: {
      dshWorkspaces: [
        {
          id: 'w1',
          title: '工作区',
          sessionIds: ['parent-1', 'child-1', 'child-2'],
          sessions: [
            { id: 'parent-1', title: '父会话', parentId: null },
            { id: 'child-1', title: '子分支1', parentId: 'parent-1' },
            { id: 'child-2', title: '子分支2', parentId: null },
          ],
        },
      ],
      loadedSessions: new Map([
        ['parent-1', { messages: [{ kind: 'user', text: '你好', sourceSeq: 1 }, { kind: 'assistant', text: '你好！', sourceSeq: 2 }], cachedAt: 1, title: '父会话', parentId: null, sourceSeedLength: null }],
        ['child-1', { messages: [{ kind: 'user', text: '你好', sourceSeq: 1 }, { kind: 'assistant', text: '你好！', sourceSeq: 2 }, { kind: 'user', text: '分支1问题', sourceSeq: 3 }], cachedAt: 2, title: '子分支1', parentId: null, sourceSeedLength: null }],
        ['child-2', { messages: [{ kind: 'user', text: '你好', sourceSeq: 1 }, { kind: 'assistant', text: '你好！', sourceSeq: 2 }, { kind: 'user', text: '分支2问题', sourceSeq: 4 }], cachedAt: 3, title: '子分支2', parentId: null, sourceSeedLength: null }],
      ]),
      cardPositions: new Map(),
      branchAnchors: new Map(),
    },
    persistLoadedSessions: () => {},
  }
  vm.createContext(context)

  const fnStart = app.indexOf('function normalizeTurnText')
  const fnEnd = app.indexOf('function persistCardPositions()')
  const fnCode = app.slice(fnStart, fnEnd)

  vm.runInContext(`${fnCode}; globalThis.repair = repairLoadedSessionConnections`, context)
  const changed = await context.globalThis.repair()

  assert.equal(changed, true)
  // child-1 and child-2 connected purely by conversation context state
  assert.equal(context.state.loadedSessions.get('child-1').parentId, 'loaded:parent-1')
  assert.equal(context.state.loadedSessions.get('child-1').sourceSeedLength, 3)
  assert.equal(context.state.loadedSessions.get('child-2').parentId, 'loaded:parent-1')
  assert.equal(context.state.loadedSessions.get('child-2').sourceSeedLength, 4)
  assert.equal(context.state.branchAnchors.get('loaded:child-1'), 'loaded:parent-1:turn:1')
  assert.equal(context.state.branchAnchors.get('loaded:child-2'), 'loaded:parent-1:turn:1')
})

test('replaces erroneous or stale parent IDs by evaluating real message context', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const vm = await import('node:vm')

  const context = {
    globalThis: {},
    fetch: async () => ({ ok: false }),
    state: {
      dshWorkspaces: [
        {
          id: 'w1',
          title: '工作区',
          sessionIds: ['s1', 's2', 's3'],
          sessions: [
            { id: 's1', title: '主线', parentId: null },
            { id: 's2', title: '分支A', parentId: 's3' }, // Erroneous / conflicting ID in DSH metadata
            { id: 's3', title: '独立话题', parentId: 's1' }, // Erroneous ID
          ],
        },
      ],
      loadedSessions: new Map([
        ['s1', { messages: [{ kind: 'user', text: '讨论架构', sourceSeq: 1 }, { kind: 'assistant', text: '方案...', sourceSeq: 2 }], cachedAt: 10, title: '主线', parentId: null, sourceSeedLength: null }],
        ['s2', { messages: [{ kind: 'user', text: '讨论架构', sourceSeq: 1 }, { kind: 'assistant', text: '方案...', sourceSeq: 2 }, { kind: 'user', text: '数据库选型', sourceSeq: 5 }], cachedAt: 20, title: '分支A', parentId: 'loaded:s3', sourceSeedLength: null }],
        ['s3', { messages: [{ kind: 'user', text: '天气预报', sourceSeq: 1 }, { kind: 'assistant', text: '晴天', sourceSeq: 2 }], cachedAt: 30, title: '独立话题', parentId: 'loaded:s1', sourceSeedLength: null }],
      ]),
      cardPositions: new Map(),
      branchAnchors: new Map([['loaded:s2', 'loaded:s3:turn:1']]),
    },
    persistLoadedSessions: () => {},
  }
  vm.createContext(context)

  const fnStart = app.indexOf('function normalizeTurnText')
  const fnEnd = app.indexOf('function persistCardPositions()')
  const fnCode = app.slice(fnStart, fnEnd)

  vm.runInContext(`${fnCode}; globalThis.repair = repairLoadedSessionConnections`, context)
  await context.globalThis.repair()

  // s2 shares "讨论架构" with s1 -> repaired to s1, disconnected from s3
  assert.equal(context.state.loadedSessions.get('s2').parentId, 'loaded:s1')
  assert.equal(context.state.loadedSessions.get('s2').sourceSeedLength, 5)
  assert.equal(context.state.branchAnchors.get('loaded:s2'), 'loaded:s1:turn:1')

  // s3 has no shared turns with s1 -> repaired to independent root (parentId: null)
  assert.equal(context.state.loadedSessions.get('s3').parentId, null)
  assert.equal(context.state.loadedSessions.get('s3').sourceSeedLength, null)
  assert.equal(context.state.branchAnchors.has('loaded:s3'), false)
})

test('renders and persists card notes and opens context menu on right click', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  // Context menu on right click
  assert.match(app, /app\.addEventListener\('contextmenu',/)
  assert.match(app, /renderContextMenu\(\)/)
  assert.match(styles, /\.synapse-context-menu/)

  // Card note persistence and display
  assert.match(app, /const CARD_NOTES_KEY = 'dsh-synapse:card-notes:v1'/)
  assert.match(app, /function rememberCardNote\(cardId, note\)/)
  assert.match(app, /function removeCardNote\(cardId\)/)
  assert.match(app, /class="thread-card-note"/)
  assert.match(styles, /\.thread-card-note/)

  // Note modal dialog
  assert.match(app, /function renderNoteModal\(\)/)
  assert.match(app, /data-note-form/)
  assert.match(styles, /\.note-modal/)
})

test('builds maximum spanning tree for multi-level deep branches and sibling forks', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const vm = await import('node:vm')

  const context = {
    globalThis: {},
    fetch: async () => ({ ok: false }),
    state: {
      dshWorkspaces: [],
      loadedSessions: new Map([
        ['trunk', {
          cachedAt: 100,
          messages: Array.from({ length: 15 }, (_, i) => ({ kind: 'user', text: `Q${i + 1}`, sourceSeq: (i + 1) * 2 - 1 })),
        }],
        ['branchA', {
          cachedAt: 200,
          messages: [
            ...Array.from({ length: 10 }, (_, i) => ({ kind: 'user', text: `Q${i + 1}`, sourceSeq: (i + 1) * 2 - 1 })),
            ...Array.from({ length: 8 }, (_, i) => ({ kind: 'user', text: `QA${i + 11}`, sourceSeq: 100 + (i + 11) * 2 - 1 })),
          ],
        }],
        ['deepBranchB', {
          cachedAt: 300,
          messages: [
            ...Array.from({ length: 10 }, (_, i) => ({ kind: 'user', text: `Q${i + 1}`, sourceSeq: (i + 1) * 2 - 1 })),
            ...Array.from({ length: 4 }, (_, i) => ({ kind: 'user', text: `QA${i + 11}`, sourceSeq: 100 + (i + 11) * 2 - 1 })),
            ...Array.from({ length: 6 }, (_, i) => ({ kind: 'user', text: `QB${i + 15}`, sourceSeq: 200 + (i + 15) * 2 - 1 })),
          ],
        }],
        ['siblingBranchC', {
          cachedAt: 250,
          messages: [
            ...Array.from({ length: 10 }, (_, i) => ({ kind: 'user', text: `Q${i + 1}`, sourceSeq: (i + 1) * 2 - 1 })),
            ...Array.from({ length: 3 }, (_, i) => ({ kind: 'user', text: `QC${i + 11}`, sourceSeq: 300 + (i + 11) * 2 - 1 })),
          ],
        }],
      ]),
      cardPositions: new Map(),
      branchAnchors: new Map(),
    },
    persistLoadedSessions: () => {},
  }
  vm.createContext(context)

  const fnStart = app.indexOf('function normalizeTurnText')
  const fnEnd = app.indexOf('function persistCardPositions()')
  const fnCode = app.slice(fnStart, fnEnd)

  vm.runInContext(`${fnCode}; globalThis.repair = repairLoadedSessionConnections`, context)
  await context.globalThis.repair()

  const sessions = context.state.loadedSessions
  // trunk is root
  assert.equal(sessions.get('trunk').parentId, null)

  // branchA forks from trunk at Turn 10 (sourceSeq: 19)
  assert.equal(sessions.get('branchA').parentId, 'loaded:trunk')
  assert.equal(context.state.branchAnchors.get('loaded:branchA'), 'loaded:trunk:turn:19')
  assert.equal(sessions.get('branchA').sourceSeedLength, 121)

  // deepBranchB forks from branchA at Turn 14 (QA14 -> sourceSeq: 127)
  assert.equal(sessions.get('deepBranchB').parentId, 'loaded:branchA')
  assert.equal(context.state.branchAnchors.get('loaded:deepBranchB'), 'loaded:branchA:turn:127')
  assert.equal(sessions.get('deepBranchB').sourceSeedLength, 229)

  // siblingBranchC forks from trunk at Turn 10 (sourceSeq: 19)
  assert.equal(sessions.get('siblingBranchC').parentId, 'loaded:trunk')
  assert.equal(context.state.branchAnchors.get('loaded:siblingBranchC'), 'loaded:trunk:turn:19')
  assert.equal(sessions.get('siblingBranchC').sourceSeedLength, 321)
})

test('restores deep multi-level tree with trimmed tail messages on branches without breaking parent links', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const vm = await import('node:vm')

  const context = {
    globalThis: {},
    fetch: async () => ({ ok: false }),
    state: {
      dshWorkspaces: [],
      loadedSessions: new Map([
        ['Root', {
          cachedAt: 100,
          messages: [
            { kind: 'user', text: '讨论物理学模型', sourceSeq: 1 },
            { kind: 'user', text: '推导光锥动量', sourceSeq: 3 }
          ],
          parentId: null
        }],
        ['Branch1', {
          cachedAt: 200,
          messages: [
            { kind: 'user', text: '那这样的话P^+在这里起什么作用呢', sourceSeq: 10 }
          ],
          parentId: 'loaded:Root',
          sourceSeedLength: 10
        }],
        ['DeepBranch2', {
          cachedAt: 300,
          messages: [
            { kind: 'user', text: '对母粒子的波函数再做一次变换', sourceSeq: 20 }
          ],
          parentId: 'loaded:Branch1',
          sourceSeedLength: 20
        }]
      ]),
      cardPositions: new Map(),
      branchAnchors: new Map([
        ['loaded:Branch1', 'loaded:Root:turn:3'],
        ['loaded:DeepBranch2', 'loaded:Branch1:turn:10']
      ]),
    },
    persistLoadedSessions: () => {},
  }
  vm.createContext(context)

  const fnStart = app.indexOf('function normalizeTurnText')
  const fnEnd = app.indexOf('function persistCardPositions()')
  const fnCode = app.slice(fnStart, fnEnd)

  vm.runInContext(`${fnCode}; globalThis.repair = repairLoadedSessionConnections`, context)
  await context.globalThis.repair()

  const sessions = context.state.loadedSessions
  assert.equal(sessions.get('Root').parentId, null)
  assert.equal(sessions.get('Branch1').parentId, 'loaded:Root')
  assert.equal(context.state.branchAnchors.get('loaded:Branch1'), 'loaded:Root:turn:3')
  assert.equal(sessions.get('DeepBranch2').parentId, 'loaded:Branch1')
  assert.equal(context.state.branchAnchors.get('loaded:DeepBranch2'), 'loaded:Branch1:turn:10')
})


test('renders canvas minimap navigator with interactive viewport bounding', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  // Minimap structure and functions
  assert.match(app, /function renderMinimap/)
  assert.match(app, /function getMinimapMetrics/)
  assert.match(app, /function panCameraToMinimapPoint/)
  assert.match(app, /function updateMinimapViewfinder/)
  assert.match(app, /data-minimap-stage/)
  assert.match(app, /class="minimap-viewfinder"/)

  // Minimap styles
  assert.match(styles, /\.synapse-minimap/)
  assert.match(styles, /\.minimap-stage/)
  assert.match(styles, /\.minimap-viewfinder/)
  assert.match(styles, /\.minimap-node/)

  // Minimap pointer and toggle interactions
  assert.match(app, /data-minimap-stage/)
  assert.match(app, /data-action="toggle-minimap"/)

  // Mobile adaptive layout & collapsible floating design
  assert.match(app, /function getMinimapDimensions/)
  assert.match(styles, /@media \(max-width: 560px\) \{\s*\.synapse-minimap/)
  assert.match(styles, /\.synapse-minimap\.collapsed/)
})

test('exports and imports self-contained .synapse map archives and vector images', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  // Export functions & UI
  assert.match(app, /function exportSynapseArchive/)
  assert.match(app, /function exportMapAsSvg/)
  assert.match(app, /function exportMapAsPng/)
  assert.match(app, /function generateMapSvg/)
  assert.match(app, /function renderExportModal/)
  assert.match(app, /data-action="open-export-modal"/)
  assert.match(styles, /\.export-modal/)
  assert.match(styles, /\.export-card-btn/)

  // Import functions & UI
  assert.match(app, /async function importSynapseArchive/)
  assert.match(app, /data-action="trigger-import"/)
  assert.match(app, /class="synapse-file-input"/)

  // Test SVG generator output
  const vm = await import('node:vm')
  const context = {
    globalThis: {},
    CARD_WIDTH: 310,
    CARD_HEIGHT: 276,
    escapeHtml: t => String(t ?? ''),
    connectorPath: () => 'M 0 0',
  }
  vm.createContext(context)

  const fnStart = app.indexOf('function generateMapSvg')
  const fnEnd = app.indexOf('function renderExportModal')
  const fnCode = app.slice(fnStart, fnEnd)

  vm.runInContext(`${fnCode}; globalThis.generateMapSvg = generateMapSvg`, context)
  const svg = context.globalThis.generateMapSvg([
    { id: 'c1', dshThreadId: 't1', parentId: null, position: { x: 86, y: 82 }, question: '架构问题', answer: { text: '回答内容' } },
  ], new Map([['c1', '重点标记备注']]))

  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /架构问题/)
  assert.match(svg, /重点标记备注/)

  // Test import archive execution
  const importContext = {
    globalThis: {},
    state: {
      loadedSessions: new Map(),
      cardPositions: new Map(),
      cardNotes: new Map(),
      branchAnchors: new Map(),
      activeId: null,
      canvasCamera: { x: 0, y: 0 },
      zoom: 1,
    },
    persistCardPositions: () => {},
    persistCardNotes: () => {},
    persistLoadedSessions: () => {},
    resetCanvasCamera: () => {},
    render: () => {},
    setError: () => {},
  }
  vm.createContext(importContext)

  const importFnStart = app.indexOf('async function importSynapseArchive')
  const importFnEnd = app.indexOf('function conversationCard(card)')
  const importCode = app.slice(importFnStart, importFnEnd)

  vm.runInContext(`${importCode}; globalThis.importArchive = importSynapseArchive`, importContext)
  const archivePayload = JSON.stringify({
    format: 'dsh-synapse-archive',
    version: 1,
    sessions: [
      { id: 's-imported', title: '导入的会话', parentId: null, messages: [{ kind: 'user', text: '你好导入' }] },
    ],
    cardNotes: [['loaded:s-imported:turn:1', '导入的便签备注']],
    cardPositions: [['loaded:s-imported:turn:1', { x: 120, y: 140 }]],
  })

  const success = await importContext.globalThis.importArchive(archivePayload)
  assert.equal(success, true)
  assert.equal(importContext.state.loadedSessions.has('s-imported'), true)
  assert.equal(importContext.state.cardNotes.get('loaded:s-imported:turn:1'), '导入的便签备注')
  assert.equal(importContext.state.cardPositions.get('loaded:s-imported:turn:1')?.x, 120)
  assert.equal(importContext.state.cardPositions.get('loaded:s-imported:turn:1')?.y, 140)
})

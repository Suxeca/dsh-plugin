const app = document.querySelector('#app')
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
/** Generate a UUID v4 string. crypto.randomUUID only exists in secure contexts
 * (localhost/HTTPS); LAN access over plain http (e.g. NetBird) falls back to
 * getRandomValues, then to a timestamp+random id. */
const makeId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch { /* fall through */ }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
const LEGACY_CARD_POSITIONS_KEY = 'dsh-synapse:card-positions'
const CARD_POSITIONS_KEY = 'dsh-synapse:card-positions:v3'
const savedBranchAnchors = (() => {
  try {
    const value = JSON.parse(localStorage.getItem('dsh-synapse:branch-anchors') ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
const savedCardPositions = (() => {
  try {
    // Drop formats that were never persisted; the current key stores drags.
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
    const value = JSON.parse(localStorage.getItem(CARD_POSITIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].x) && Number.isFinite(item[1].y)) : []
  } catch { return [] }
})()
const CARD_WIDTH = 310
const CARD_HEIGHT = 276
const CARD_GAP_Y = 42
const CAMERA_INSET_X = 56
const CAMERA_INSET_Y = 56
const LOADED_SESSIONS_KEY = 'dsh-synapse:loaded-sessions:v1'
const loadedSessionsFromStorage = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(LOADED_SESSIONS_KEY) ?? '{}')
    return typeof value === 'object' && value !== null ? value : {}
  } catch { return {} }
})()
const state = {
  summaries: [], workspace: null, activeId: null, mode: 'canvas', zoom: 1, currentDsh: null, sidebarCollapsed: false,
  dshWorkspaces: [], selectedDshWorkspaceId: null, archivedSessionIds: [], sidebarSessionLimit: 3, sidebarExpanded: false, expandedWorkspaces: new Set(),
  historyBySession: new Map(), historyRequests: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(),
  // Loaded-on-demand sessions: sessionId -> { messages, cachedAt, title }.
  // This is the module that drives the map; the left list is the source module.
  loadedSessions: new Map(Object.entries(loadedSessionsFromStorage)),
  draft: null, error: '', workspaceLoad: 0, branchAnchors: new Map(savedBranchAnchors), cardPositions: new Map(savedCardPositions),
  dragging: false, canvasGesture: false, canvasRefreshAfter: 0, canvasViewInitialized: false, canvasCamera: { x: 0, y: 0 },
  expandedMessageIds: new Set(),
  // Whether the map overlay is actually visible. The iframe stays mounted
  // while hidden, so this flag stops all background polling/rendering work.
  mapVisible: false,
  // Suppress re-renders briefly after a wheel zoom/scroll so an active
  // gesture is never interrupted by a full canvas rebuild.
  wheelGestureUntil: 0,
}

let mapSyncTimer = 0
/** Lightweight server map entry: metadata only, never the full message log.
 * Full logs live in localStorage (and are re-fetched from DSH on demand), so
 * cross-device map sync stays small enough for the server body limit. */
function serverMapEntry(entry) {
  return {
    title: entry?.title ?? null,
    parentId: entry?.parentId ?? null,
    sourceSeedLength: Number.isSafeInteger(entry?.sourceSeedLength) ? entry.sourceSeedLength : null,
  }
}

function persistLoadedSessions() {
  try { localStorage.setItem(LOADED_SESSIONS_KEY, JSON.stringify(Object.fromEntries(state.loadedSessions))) } catch { /* Private browsing may disable local storage. */ }
  // Push only lightweight metadata to the server so every device sees the same
  // map. Debounced so rapid drag/unload operations coalesce into a single PUT.
  if (mapSyncTimer !== 0) return
  mapSyncTimer = window.setTimeout(() => {
    mapSyncTimer = 0
    const payload = Object.fromEntries([...state.loadedSessions.entries()].map(([sessionId, entry]) => [sessionId, serverMapEntry(entry)]))
    void fetch('/synapse/api/map', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ map: payload }) }).catch(() => {})
  }, 150)
}

/** Pull the server-authoritative map state and adopt it locally. */
async function loadServerMap() {
  // If we have a pending local push (debounced PUT not fired yet), the server
  // does not know our latest local state yet. Skipping the pull avoids
  // clobbering a brand-new local session with the older server snapshot; the
  // pending PUT will publish it, and the next SSE event will sync it back.
  if (mapSyncTimer !== 0) return false
  const res = await fetch('/synapse/api/map', { cache: 'no-store' })
  if (!res.ok) return false
  const body = await res.json().catch(() => ({}))
  const map = body?.map
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return false
  const before = JSON.stringify(Object.fromEntries(state.loadedSessions))
  // Server is authoritative for WHICH sessions are on the map. Merge its
  // lightweight metadata into the local full-message cache: a session that is
  // new here gets an empty message list and will be filled on demand (sync or
  // drag) without the server ever carrying the heavy log.
  const next = new Map()
  for (const [sessionId, meta] of Object.entries(map)) {
    const local = state.loadedSessions.get(sessionId)
    next.set(sessionId, {
      messages: Array.isArray(local?.messages) ? local.messages : [],
      cachedAt: local?.cachedAt ?? Date.now(),
      title: typeof meta?.title === 'string' ? meta.title : (local?.title ?? null),
      parentId: typeof meta?.parentId === 'string' ? meta.parentId : (local?.parentId ?? null),
      sourceSeedLength: Number.isSafeInteger(meta?.sourceSeedLength) ? meta.sourceSeedLength : (local?.sourceSeedLength ?? null),
    })
  }
  state.loadedSessions = next
  try { localStorage.setItem(LOADED_SESSIONS_KEY, JSON.stringify(Object.fromEntries(state.loadedSessions))) } catch { /* ignore */ }
  const changed = JSON.stringify(Object.fromEntries(state.loadedSessions)) !== before
  // Lightweight server map carries metadata only. Hydrate any session that is
  // new locally (empty messages) so a remote device sees the actual cards, not
  // blank placeholders, without waiting for a manual drag.
  void hydrateServerMap()
  return changed
}

/** Fill full message logs for server-map sessions that have no local cache. */
async function hydrateServerMap() {
  if (!state.mapVisible || state.draft !== null || state.dragging) return
  for (const [sessionId, entry] of [...state.loadedSessions.entries()]) {
    if (Array.isArray(entry.messages) && entry.messages.length > 0) continue
    const parentSessionId = entry.parentId === null ? null : String(entry.parentId).replace(/^loaded:/, '')
    const parentEntry = parentSessionId === null ? null : state.loadedSessions.get(parentSessionId)
    const parentThread = parentEntry ? threadFromLoadedSession(parentSessionId, parentEntry, sessionSummaryById(parentSessionId)) : null
    try {
      await loadSessionToMap(sessionId, { title: entry.title }, parentThread, true, entry.sourceSeedLength)
    } catch { /* keep going */ }
  }
  if (canReplaceView()) render()
}

/** Subscribe to server-pushed map changes (SSE). No polling: a device only
 * refetches /api/map when another device actually changed the map. */
function setupMapEvents() {
  if (mapEventSource !== null) return
  try {
    const es = new EventSource('/synapse/api/map/events')
    mapEventSource = es
    es.addEventListener('map-changed', () => {
      if (!state.mapVisible || document.hidden) return
      void loadServerMap().then(changed => {
        if (changed && canReplaceView()) render()
      }).catch(() => {})
    })
    es.onerror = () => {
      // EventSource auto-reconnects; nothing else to do.
    }
  } catch { /* EventSource unavailable (rare); map still works via initial load */ }
}

/**
 * Manual sync: pull the server-authoritative map, then auto-add any DSH fork
 * sessions that exist on the server but have not been dragged into the map yet.
 * This is how a fork created in DSH (on this machine or another) shows up on
 * every device without a manual drag.
 */
async function syncForks() {
  setError('')
  await loadServerMap().catch(() => {})
  // Fetch the authoritative DSH session list from the server (not from the
  // parent page push, which may not have arrived yet on a remote device).
  let sessions = []
  try {
    const res = await fetch('/synapse/api/sessions', { cache: 'no-store' })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      sessions = Array.isArray(body.sessions) ? body.sessions : []
    }
  } catch { /* fall back to left library below */ }
  // Collect forks (sessions with a parentId) not yet on the map. Only auto-add
  // a fork whose parent is already part of this map. A fork whose parent is not
  // loaded belongs to a conversation the user has not dragged onto this canvas;
  // pulling in every historical fork would flood the map with old/archived
  // branches. The server list already excludes DSH-archived sessions, and this
  // client-side set is a second guard for archived sessions that the server may
  // not have mirrored yet.
  const archived = new Set(state.archivedSessionIds)
  const forks = []
  for (const session of sessions) {
    if (session?.parentId && !archived.has(session.id) && state.loadedSessions.has(session.parentId) && !state.loadedSessions.has(session.id)) forks.push(session)
  }
  // Also scan the left library in case the server list was unavailable.
  if (forks.length === 0) {
    for (const workspace of state.dshWorkspaces) {
      for (const session of workspace.sessions ?? []) {
        if (session.parentId && !archived.has(session.id) && state.loadedSessions.has(session.parentId) && !state.loadedSessions.has(session.id) && !forks.some(f => f.id === session.id)) forks.push(session)
      }
    }
  }
  if (forks.length === 0) {
    if (canReplaceView()) render()
    return
  }
  for (const session of forks) {
    // Parent is guaranteed to be loaded by the filter above.
    const parentEntry = state.loadedSessions.get(session.parentId)
    const parentThread = parentEntry ? threadFromLoadedSession(session.parentId, parentEntry, sessionSummaryById(session.parentId)) : null
    // Pass the fork's durable seed boundary so only the branch's own tail is
    // shown, not the whole inherited parent context repeated on a second row.
    const atSeq = Number.isSafeInteger(session.seedLength) ? session.seedLength : undefined
    try {
      await loadSessionToMap(session.id, { title: session.title }, parentThread, false, atSeq)
    } catch { /* keep going */ }
  }
  if (canReplaceView()) render()
}

function cacheLoadedSession(sessionId, messages, title = null, parentId = null, sourceSeedLength = null) {
  const previous = state.loadedSessions.get(sessionId)
  state.loadedSessions.set(sessionId, {
    messages: Array.isArray(messages) ? messages : [],
    cachedAt: Date.now(),
    title,
    parentId: parentId ?? previous?.parentId ?? null,
    sourceSeedLength: sourceSeedLength ?? previous?.sourceSeedLength ?? null,
  })
  persistLoadedSessions()
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const currentThread = () => {
  const threads = mapThreads()
  return threads.find(thread => thread.id === state.activeId) ?? threads[0] ?? null
}
const threadListTitle = thread => thread.dshSessionTitle ?? thread.title ?? questionFor(thread)

function rememberBranchAnchor(sessionId, cardId) {
  state.branchAnchors.set(sessionId, cardId)
  try { localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCardPositions() {
  try { localStorage.setItem(CARD_POSITIONS_KEY, JSON.stringify([...state.cardPositions])) } catch { /* Private browsing may disable local storage. */ }
}

function rememberCardPosition(cardId, position, aliases = []) {
  state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
  for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
  persistCardPositions()
}

function resetCardPositions() {
  state.cardPositions.clear()
  persistCardPositions()
  try {
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
  } catch { /* Private browsing may disable local storage. */ }
}

function resetCanvasCamera() {
  state.canvasViewInitialized = false
  state.canvasCamera = { x: 0, y: 0 }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? '请求失败')
  return body
}

function post(type, payload = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin)
}

function dshRpc(type, payload = {}, timeout = 20_000) {
  if (window.parent === window) return Promise.reject(new Error('请从 DSH 页面打开 Synapse 后再操作会话'))
  const requestId = makeId()
  post(type, { requestId, ...payload })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pendingRpc.delete(requestId)
      reject(new Error('DSH 未在规定时间内响应'))
    }, timeout)
    state.pendingRpc.set(requestId, { resolve, reject, timer })
  })
}

function settleRpc(requestId, value, error) {
  const pending = state.pendingRpc.get(requestId)
  if (pending === undefined) return
  state.pendingRpc.delete(requestId)
  window.clearTimeout(pending.timer)
  if (error === undefined) pending.resolve(value)
  else pending.reject(error instanceof Error ? error : new Error(String(error)))
}

function setError(error = '') { state.error = error instanceof Error ? error.message : error; render() }

function messagesFromEvents(events) {
  if (!Array.isArray(events)) return []
  return events.flatMap(event => {
    const content = event?.data?.message?.content ?? event?.data?.content
    const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).filter(Boolean).join('\n') : ''
    if (event?.type === 'user/message' && text && !text.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return [{ kind: 'user', text, at: event.time, sourceSeq: event.seq }]
    if (event?.type === 'assistant/message' && text) return [{ kind: 'assistant', text, at: event.time, sourceSeq: event.seq }]
    return []
  })
}

async function loadThreadHistory(thread, force = false) {
  if (thread?.dshSessionId === null || thread?.dshSessionId === undefined) return
  if (!state.mapVisible) return
  // In drag-only mode, sessions already loaded into the map are the source;
  // never re-fetch them through the legacy projection path.
  if (state.loadedSessions.has(thread.dshSessionId)) return
  if (!force && state.historyBySession.has(thread.dshSessionId)) return
  try {
    const result = await dshRpc('synapse:load-history', { sessionId: thread.dshSessionId }, 60_000)
    const messages = Array.isArray(result?.messages) ? result.messages : []
    state.historyBySession.set(thread.dshSessionId, messages)
    if (canReplaceView()) render()
  } catch {
    // Keep the projected fallback; a later open/refresh can retry.
  }
}

/** Build a map thread object from a loaded session's message list. */
function threadFromLoadedSession(sessionId, entry, sessionSummary = null) {
  const title = sessionSummary?.title ?? entry?.title ?? (entry?.messages?.find(message => message.kind === 'user')?.text ?? 'DSH 会话')
  const messages = Array.isArray(entry?.messages) ? entry.messages : []
  const now = new Date().toISOString()
  return {
    id: `loaded:${sessionId}`,
    title: typeof title === 'string' && title.trim() !== '' ? title.slice(0, 120) : 'DSH 会话',
    parentId: entry?.parentId ?? null,
    sourceSeedLength: Number.isSafeInteger(entry?.sourceSeedLength) ? entry.sourceSeedLength : null,
    dshSessionId: sessionId,
    dshSessionTitle: typeof title === 'string' ? title.slice(0, 120) : null,
    color: '#3478f6',
    position: { x: 86, y: 82 },
    createdAt: now,
    updatedAt: now,
    messages,
  }
}

/**
 * Load a session into the map (the drag-and-drop entry point).
 * Returns the cached thread immediately if already loaded; otherwise pulls the
 * full DSH history, caches it in localStorage, and returns a fresh thread.
 * When `parentThread` is given (a fork created from a loaded map thread), the
 * new thread is linked to it and cached with that parent link.
 */
async function loadSessionToMap(sessionId, sessionSummary = null, parentThread = null, force = false, atSeq = undefined) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  const cached = state.loadedSessions.get(sessionId)
  if (cached !== undefined && !force) {
    if (parentThread !== null && cached.parentId === null) {
      cacheLoadedSession(sessionId, cached.messages, cached.title, parentThread.id, cached.sourceSeedLength)
    }
    return threadFromLoadedSession(sessionId, cached, sessionSummary)
  }
  if (!state.mapVisible) return cached === undefined ? null : threadFromLoadedSession(sessionId, cached, sessionSummary)
  // Load the full log (no client-side cut): a fork's own seq numbering can
  // differ from the parent's cut, so filtering here empties the branch. The
  // cut is stored as sourceSeedLength and applied at render time instead.
  const result = await dshRpc('synapse:load-history', { sessionId, atSeq }, 60_000)
  const messages = Array.isArray(result?.messages) ? result.messages : []
  const title = sessionSummary?.title ?? null
  // Prefer the explicit cut passed by the caller (branch creation). Otherwise,
  // when this is a fork whose parent is already on the map, infer the branch
  // boundary from content: the first user turn in this session that is NOT part
  // of the parent's history is the branch's own first question. Using its seq
  // as the seed means the branch row only shows the new divergence, not the
  // whole inherited parent context repeated on a second row.
  let seed = Number.isSafeInteger(atSeq) ? atSeq : null
  if (!Number.isSafeInteger(seed) && parentThread !== null && parentThread.dshSessionId !== null) {
    const parentMessages = state.loadedSessions.get(parentThread.dshSessionId)?.messages ?? []
    const parentUserTexts = new Set(parentMessages.filter(message => message.kind === 'user').map(message => message.text))
    const firstOwnUser = messages.find(message => message.kind === 'user' && !parentUserTexts.has(message.text))
    if (firstOwnUser !== undefined && Number.isInteger(firstOwnUser.sourceSeq)) seed = firstOwnUser.sourceSeq
  }
  cacheLoadedSession(sessionId, messages, title, parentThread?.id ?? null, seed)
  return threadFromLoadedSession(sessionId, { messages, title, parentId: parentThread?.id ?? null, sourceSeedLength: seed }, sessionSummary)
}

/** All threads currently on the map = the loaded sessions, in load order. */
function mapThreads() {
  return [...state.loadedSessions.entries()].map(([sessionId, entry]) => threadFromLoadedSession(sessionId, entry, sessionSummaryById(sessionId)))
}

function sessionSummaryById(sessionId) {
  for (const workspace of state.dshWorkspaces) {
    const session = (workspace.sessions ?? []).find(item => item.id === sessionId)
    if (session !== undefined) return { title: session.title ?? null }
  }
  return null
}

function canReplaceView() {
  return state.mapVisible && state.draft === null && !state.dragging && !state.canvasGesture && Date.now() >= state.canvasRefreshAfter && Date.now() >= state.wheelGestureUntil && !document.activeElement?.matches('textarea')
}

function deferCanvasRefresh(delay = 700) {
  state.canvasRefreshAfter = Math.max(state.canvasRefreshAfter, Date.now() + delay)
}

function currentDshThread(threads = mapThreads()) {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? threads.find(thread => thread.dshSessionId === id) : undefined
}

async function refreshSummaries({ renderAfter = true } = {}) {
  const before = JSON.stringify(state.summaries)
  const body = await api('/synapse/api/workspaces')
  state.summaries = body.workspaces
  const changed = before !== JSON.stringify(state.summaries)
  // The map is drag-only now: summaries feed the left session library, not
  // the canvas. Do not auto-open any workspace/thread here.
  if (renderAfter && changed && canReplaceView()) render()
  return changed
}

async function refreshProjection() {
  // Polling only keeps the left sidebar/workspace metadata fresh. It must
  // never rebuild the canvas: the map is driven by loadedSessions (drag +
  // localStorage cache) and live messages, so a periodic re-render is what
  // makes the view flash while another conversation is active.
  await refreshSummaries({ renderAfter: false })
  return false
}

function openNewSession() {
  if (state.draft !== null) return
  state.mode = 'canvas'
  state.activeId = null
  state.draft = { kind: 'new', text: '', sending: false }
  state.error = ''
  resetCanvasCamera()
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

function unloadSession(sessionId) {
  if (typeof sessionId !== 'string' || !state.loadedSessions.has(sessionId)) return false
  state.loadedSessions.delete(sessionId)
  state.historyBySession.delete(sessionId)
  state.liveReplies.delete(sessionId)
  persistLoadedSessions()
  for (const key of [...state.cardPositions.keys()]) {
    if (key.startsWith(`loaded:${sessionId}:`) || key.startsWith(`${sessionId}:`)) state.cardPositions.delete(key)
  }
  const threads = mapThreads()
  state.activeId = threads.some(item => item.id === state.activeId) ? state.activeId : threads[0]?.id ?? null
  if (canReplaceView()) render()
  return true
}

async function archiveThread(thread) {
  if (thread?.dshSessionId === null || thread?.dshSessionId === undefined) return
  if (!window.confirm(`从地图卸载「${thread.title}」？DSH 原会话会保留，可随时再次拖入。`)) return
  unloadSession(thread.dshSessionId)
}

function openContinue(parent, anchorId = undefined) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.draft = { kind: 'continue', parentId: parent.id, anchorId, text: '', sending: false }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

function openBranch(parent, atSeq = undefined, anchorId = undefined) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.draft = { kind: 'branch', parentId: parent.id, atSeq, anchorId, text: '', sending: false }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function sendMessage(thread, text) {
  if (thread.dshSessionId === null) throw new Error('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(thread.dshSessionId)) throw new Error('该会话正在回复，请稍后再发送')
  state.pendingReplies.set(thread.dshSessionId, { text, at: Date.now() })
  state.error = ''
  render()
  try {
    await dshRpc('synapse:send-message', { sessionId: thread.dshSessionId, text })
    void loadThreadHistory(thread)
  } catch (error) {
    state.pendingReplies.delete(thread.dshSessionId)
    render()
    throw error
  }
}

async function submitDraft() {
  const draft = state.draft
  const text = draft?.text.trim()
  if (draft === null || !text) return
  const branchPosition = draft.kind === 'branch' ? draftPlacement(conversationCards(mapThreads()))?.position : undefined
  draft.sending = true
  state.error = ''
  render()
  try {
    if (draft.kind === 'new') {
      const session = await dshRpc('synapse:create-session', { workspaceId: state.selectedDshWorkspaceId, cwd: state.currentDsh?.cwd })
      await dshRpc('synapse:send-message', { sessionId: session.id, text })
      state.draft = null
      render()
      window.setTimeout(() => {
        void refreshProjection().catch(() => {})
      }, 150)
      return
    }
    const parent = mapThreads().find(thread => thread.id === draft.parentId)
    if (parent === undefined) throw new Error('来源会话不存在')
    if (draft.kind === 'continue') {
      state.draft = null
      await sendMessage(parent, text)
      return
    }
    const session = await dshRpc('synapse:fork-session', { sessionId: parent.dshSessionId, atSeq: draft.atSeq })
    if (draft.anchorId !== undefined) rememberBranchAnchor(session.id, draft.anchorId)
    // Drag-only model: a fork becomes a loaded map session linked to its parent.
    // Pass the cut seq so history is trimmed to the branch's own tail (the
    // inherited prefix is already drawn by the parent chain).
    const thread = await loadSessionToMap(session.id, { title: session.title }, parent, false, draft.atSeq)
    if (thread === null) throw new Error('分支会话加载失败')
    state.activeId = thread.id
    state.draft = null
    state.pendingReplies.set(thread.dshSessionId, { text, at: Date.now() })
    render()
    await dshRpc('synapse:send-message', { sessionId: thread.dshSessionId, text })
    void loadThreadHistory(thread)
    await refreshProjection()
  } catch (error) {
    if (draft.kind === 'branch') {
      state.pendingReplies.delete(mapThreads().find(thread => thread.id === state.activeId)?.dshSessionId)
      if (state.draft !== null) state.draft = { ...draft, sending: false }
    } else {
      state.draft = { ...draft, sending: false }
    }
    setError(error)
  }
}

function threadsById() { return new Map(mapThreads().map(thread => [thread.id, thread])) }
function persistedMessagesFor(thread) {
  const projected = thread.messages ?? []
  const history = state.historyBySession.get(thread.dshSessionId)
  if (history === undefined) return projected
  // History (from DSH's full log) is authoritative for already-seen seqs.
  // Append only projected events that arrived after the history snapshot.
  const knownSeqs = new Set(history.map(message => message.sourceSeq).filter(Number.isInteger))
  const tail = projected.filter(message => Number.isInteger(message.sourceSeq) && !knownSeqs.has(message.sourceSeq))
  return [...history, ...tail]
}

function pendingUserIndex(messages, pending) {
  // Match by text only. The old time-window (±2s) breaks on forked sessions
  // where history is loaded from DSH's log and timestamps can differ from the
  // local send time (clock skew / refresh delay), leaving the card stuck on
  // "正在回复" forever.
  return messages.findLastIndex(message => message.kind === 'user' && message.text === pending.text)
}

function settlePendingReply(thread, messages) {
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return false
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex === -1 || !messages.slice(userIndex + 1).some(message => message.kind === 'assistant')) return false
  state.pendingReplies.delete(thread.dshSessionId)
  return true
}

function messagesFor(thread) {
  // A runtime-context snapshot is internal DSH state, never a user turn.
  // Filter here as well as during persistence so existing saved workspaces
  // immediately render one question and its answer as one card.
  const messages = persistedMessagesFor(thread).filter(message => !(message.kind === 'user' && typeof message.text === 'string' && message.text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')))
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return messages
  if (settlePendingReply(thread, messages)) {
    state.liveReplies.delete(thread.dshSessionId)
    return messages
  }
  const liveReply = state.liveReplies.get(thread.dshSessionId)
  const liveAssistant = liveReply?.running ? { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() } : { kind: 'assistant', text: '', pending: true, at: new Date().toISOString() }
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex !== -1) return [...messages, liveAssistant]
  return [...messages, { kind: 'user', text: pending.text, pending: true, at: new Date(pending.at).toISOString() }, liveAssistant]
}

function latestMessage(thread, kind) { return [...messagesFor(thread)].reverse().find(message => message.kind === kind) }
function questionFor(thread) { return latestMessage(thread, 'user')?.text ?? thread.dshSessionTitle ?? '等待用户提问' }
function answerFor(thread) { return latestMessage(thread, 'assistant') ?? null }

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

function markdownBlock(text) {
  const lines = text.split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (unordered !== null || ordered !== null) {
      const matcher = unordered === null ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/
      const items = []
      while (index < lines.length) {
        const item = matcher.exec(lines[index])
        if (item === null) break
        items.push(`<li>${inlineMarkdown(item[1])}</li>`)
        index++
      }
      output.push(`<${unordered === null ? 'ol' : 'ul'}>${items.join('')}</${unordered === null ? 'ol' : 'ul'}>`)
      continue
    }
    // GFM table: a leading-pipe header row followed by a |-delimiter row,
    // then any number of leading-pipe body rows.
    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line
      const body = []
      index += 2
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      output.push(`<table><thead><tr>${tableCells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${tableCells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,3})\s+/.test(lines[index]) && !/^[-*+]\s+/.test(lines[index]) && !/^\d+[.)]\s+/.test(lines[index])) paragraph.push(lines[index++])
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) paragraph.push(lines[index++])
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return output.join('')
}

function renderMarkdown(text) {
  const parts = String(text).split(/```/)
  return parts.map((part, index) => index % 2 === 1
    ? `<pre><code>${escapeHtml(part.replace(/^\w*\n/, ''))}</code></pre>`
    : markdownBlock(part)).join('')
}

function overlapsCard(position, other) {
  return position.x < other.x + CARD_WIDTH && position.x + CARD_WIDTH > other.x
    && position.y < other.y + CARD_HEIGHT && position.y + CARD_HEIGHT > other.y
}

function firstAvailableCardPosition(position, occupied) {
  const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
  while (true) {
    const collisions = occupied.filter(other => overlapsCard(candidate, other))
    if (collisions.length === 0) return candidate
    candidate.y = Math.max(...collisions.map(other => other.y + CARD_HEIGHT + CARD_GAP_Y))
  }
}

function connectorPath(fromPosition, toPosition) {
  const fromX = fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + CARD_HEIGHT / 2
  const toX = toPosition.x
  const toY = toPosition.y + CARD_HEIGHT / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function connectorPathFromElements(fromCard, toCard) {
  const fromX = Number.parseFloat(fromCard.style.left) + CARD_WIDTH
  const fromY = Number.parseFloat(fromCard.style.top) + CARD_HEIGHT / 2
  const toX = Number.parseFloat(toCard.style.left)
  const toY = Number.parseFloat(toCard.style.top) + CARD_HEIGHT / 2
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function selectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function refreshCardConnectors(cardId) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const id = selectorValue(cardId)
  for (const path of viewport.querySelectorAll(`.connectors path[data-from="${id}"], .connectors path[data-to="${id}"]`)) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    const fromCard = viewport.querySelector(`[data-card-id="${selectorValue(fromId)}"]`)
    const toCard = viewport.querySelector(`[data-card-id="${selectorValue(toId)}"]`)
    if (!(fromCard instanceof HTMLElement) || !(toCard instanceof HTMLElement)) continue
    const nextPath = connectorPathFromElements(fromCard, toCard)
    if (nextPath !== null) path.setAttribute('d', nextPath)
  }
}

function initialCanvasCamera(cards) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  const active = state.activeId === null ? undefined : cards.find(card => card.dshThreadId === state.activeId)
  const focus = draft ?? active ?? cards[0]
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  return { x: CAMERA_INSET_X - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
}

function placeConversationCards(cards) {
  const saved = new Map(cards.flatMap(card => {
    if (card.positionLocked !== true) return []
    const position = state.cardPositions.get(card.id) ?? state.cardPositions.get(card.positionKey)
    return position === undefined ? [] : [[card.id, { x: position.x, y: position.y }]]
  }))
  const occupied = []
  for (const card of cards) {
    const position = saved.get(card.id)
    if (position !== undefined) {
      card.position = position
      continue
    }
    card.position = firstAvailableCardPosition(card.naturalPosition ?? card.position, occupied)
    occupied.push(card.position)
  }
  return cards
}

function layoutConversationGraph(cards, threads) {
  const childrenByThread = new Map()
  for (const thread of threads) {
    if (thread.parentId === null) continue
    const children = childrenByThread.get(thread.parentId) ?? []
    children.push(thread.id)
    childrenByThread.set(thread.parentId, children)
  }
  const laneByThread = new Map()
  const visitThread = threadId => {
    if (laneByThread.has(threadId)) return
    laneByThread.set(threadId, laneByThread.size)
    for (const childId of childrenByThread.get(threadId) ?? []) visitThread(childId)
  }
  for (const thread of threads) if (thread.parentId === null) visitThread(thread.id)
  for (const thread of threads) visitThread(thread.id)

  const byId = new Map(cards.map(card => [card.id, card]))
  const positioned = new Map()
  const positionFor = (card, visiting = new Set()) => {
    if (positioned.has(card.id)) return positioned.get(card.id)
    if (visiting.has(card.id)) return { x: 86, y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y) }
    visiting.add(card.id)
    const parent = card.parentId === null ? undefined : byId.get(card.parentId)
    const parentPosition = parent === undefined ? undefined : positionFor(parent, visiting)
    const position = {
      x: parentPosition === undefined ? 86 : parentPosition.x + 365,
      y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y),
    }
    visiting.delete(card.id)
    positioned.set(card.id, position)
    return position
  }
  for (const card of cards) {
    card.naturalPosition = positionFor(card)
    if (!card.positionLocked) card.position = card.naturalPosition
  }
  return placeConversationCards(cards)
}

function conversationCards(threads) {
  const cards = []
  const cardsByThread = new Map()
  for (const thread of threads) {
    let messages = messagesFor(thread)
    // Fork display: the branch's own log contains the inherited prefix; only
    // render turns after the durable seed boundary so the parent chain is not
    // duplicated on the branch row.
    if (Number.isSafeInteger(thread.sourceSeedLength)) {
      // The seed is the first event owned by the branch, so keep >= seed.
      messages = messages.filter(message => Number.isInteger(message.sourceSeq) && message.sourceSeq >= thread.sourceSeedLength)
    }
    const turns = []
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const question = messages[messageIndex]
      if (question.kind !== 'user') continue
      const replies = []
      for (let replyIndex = messageIndex + 1; replyIndex < messages.length; replyIndex++) {
        const reply = messages[replyIndex]
        if (reply.kind === 'user') break
        if (reply.kind === 'assistant') replies.push(reply)
      }
      const answer = replies.at(-1) ?? null
      const turnIndex = turns.length
      const id = `${thread.id}:turn:${question.sourceSeq ?? messageIndex}`
      const previous = turns.at(-1)
      const positionKey = `${thread.id}:turn-index:${turnIndex}`
      const naturalPosition = previous === undefined ? { x: 86, y: 82 } : { x: previous.naturalPosition.x + 365, y: previous.naturalPosition.y }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      const position = positionLocked ? savedPosition : naturalPosition
      turns.push({
        id,
        positionKey,
        dshThreadId: thread.id,
        sourceParentId: thread.parentId,
        parentId: null,
        sourceSeq: question.sourceSeq,
        turnIndex,
        naturalPosition,
        position,
        positionLocked,
        question: question.text,
        answer,
      })
    }
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const latestTurn = turns.at(-1)
    if (liveReply?.running && latestTurn !== undefined && (latestTurn.answer === null || latestTurn.answer.pending === true)) latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() }
    if (turns.length === 0) {
      const id = `${thread.id}:turn:empty`
      const positionKey = `${thread.id}:turn-index:0`
      const naturalPosition = { x: 86, y: 82 }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      turns.push({
      id,
      positionKey,
      dshThreadId: thread.id,
      sourceParentId: thread.parentId,
      parentId: null,
      sourceSeq: undefined,
      turnIndex: 0,
      naturalPosition,
      position: positionLocked ? savedPosition : naturalPosition,
      positionLocked,
      question: thread.dshSessionTitle ?? thread.title,
      answer: null,
      })
    }
    turns.at(-1).canContinue = true
    cardsByThread.set(thread.id, turns)
    cards.push(...turns)
  }
  for (const card of cards) {
    const siblings = cardsByThread.get(card.dshThreadId)
    if (card.turnIndex > 0) card.parentId = siblings[card.turnIndex - 1].id
    else {
      const parentCards = cardsByThread.get(card.sourceParentId)
      const sourceThread = threads.find(thread => thread.id === card.dshThreadId)
      const firstChildQuestion = siblings?.[0]
      const seedLength = sourceThread?.sourceSeedLength ?? firstChildQuestion?.sourceSeq
      // A fork inherits every parent event before DSH's durable seed boundary.
      // The latest parent question below that boundary is the exact Turn where
      // this child was born. Canvas coordinates never participate in lineage.
      const inheritedTurn = Number.isSafeInteger(seedLength)
        ? parentCards?.filter(candidate => Number.isInteger(candidate.sourceSeq) && candidate.sourceSeq < seedLength).at(-1)
        : undefined
      // A fork's first card must always connect to its parent thread. Prefer the
      // explicit branch anchor (the exact card the user branched from), then the
      // durable DSH seed boundary, and finally the parent thread's last card —
      // never fall back to null, which would make the branch a new root and push
      // it onto a separate row instead of spacing it beside the parent.
      card.parentId = state.branchAnchors.get(card.dshThreadId) ?? inheritedTurn?.id ?? parentCards?.at(-1)?.id ?? null
    }
  }
  return layoutConversationGraph(cards, threads)
}

function canvasConnectors(cards) {
  const index = new Map(cards.map(card => [card.id, card]))
  const links = cards.map(card => {
    const parent = card.parentId === null ? null : index.get(card.parentId)
    if (parent === undefined || parent === null) return ''
    return `<path data-from="${escapeHtml(parent.id)}" data-to="${escapeHtml(card.id)}" d="${connectorPath(parent.position, card.position)}"></path>`
  })
  const placement = draftPlacement(cards)
  if (placement !== null) {
    links.push(`<path class="draft-connector" data-from="${escapeHtml(placement.parent.id)}" data-to="draft" d="${connectorPath(placement.parent.position, placement.position)}"></path>`)
  }
  return links.join('')
}

function conversationCard(card) {
  const active = card.dshThreadId === state.activeId ? 'active' : ''
  const source = card.parentId === null ? 'DSH 会话' : card.turnIndex === 0 ? 'DSH 分支' : '追问'
  const branchSequence = Number.isInteger(card.answer?.sourceSeq) ? ` data-seq="${card.answer.sourceSeq}"` : ''
  const continueButton = card.canContinue === true
    ? `<button class="branch-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${card.id}" title="添加追问" aria-label="为 ${escapeHtml(card.question)} 添加追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
    : ''
  return `<article class="thread-card ${active}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:#3478f6">
    <button class="node-handle" data-drag-card="${card.id}" aria-label="拖动 ${escapeHtml(card.question)}" title="拖动卡片"></button>
    <div class="thread-card-head"><span class="topic-dot"></span><button class="thread-title" data-action="show-thread" data-thread="${card.dshThreadId}" title="查看完整会话：${escapeHtml(card.question)}">${escapeHtml(card.question)}</button>${continueButton}</div>
    <div class="thread-meta"><span>${source}</span><span>第 ${card.turnIndex + 1} 轮</span></div>
    <div class="thread-answer">${card.answer === null ? '<p class="thread-answer-empty">等待助手回复</p>' : card.answer.pending && card.answer.text === '' ? '<p class="thread-answer-pending">正在回复</p>' : `${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="thread-answer-pending">正在回复</p>' : ''}`}</div>
    <footer><button data-action="show-thread" data-thread="${card.dshThreadId}">详情</button><button data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${card.id}"${branchSequence}>分支</button><button data-action="open-dsh" data-thread="${card.dshThreadId}">打开 DSH</button><button data-action="archive-thread" data-thread="${card.dshThreadId}">卸载</button></footer>
  </article>`
}

function draftActions(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  return `<div class="draft-actions"><button type="button" data-action="cancel-draft" ${disabled} aria-label="取消" title="取消"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button><button class="primary" type="submit" ${disabled} aria-label="发送" title="发送"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg></button></div>`
}

function draftPlacement(cards) {
  const draft = state.draft
  if (draft === null || draft.kind === 'new') return null
  const parent = cards.find(card => card.id === draft.anchorId) ?? cards.filter(card => card.dshThreadId === draft.parentId).at(-1)
  if (parent === undefined) return null
  return { parent, position: firstAvailableCardPosition({ x: parent.position.x + 365, y: parent.position.y }, cards.map(card => card.position)) }
}

function draftCard(cards) {
  const draft = state.draft
  if (draft?.kind === 'new') return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:86px;top:82px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>新会话</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="输入第一条消息" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>${continuing ? '新的追问' : '新的分支'}</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
}

function renderCanvas() {
  const threads = mapThreads()
  if (threads.length === 0 && state.draft?.kind !== 'new') return `<section class="empty-canvas"><strong>地图还没有会话。</strong><p>从左侧历史对话区把一个会话拖到地图上，即可展开它的完整路径节点。</p><div><button class="primary" type="button" data-action="create-session">新建会话</button></div></section>`
  const cards = conversationCards(threads)
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(cards)
    state.canvasViewInitialized = true
  }
  return `<section class="canvas-view"><div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><svg class="connectors">${canvasConnectors(cards)}</svg><div class="cards-layer">${cards.map(conversationCard).join('')}${draftCard(cards)}</div></div></div></section>`
}

function isProcessMessage(message) {
  if (message.kind === 'tool' || message.kind === 'tool-result') return true
  return message.kind === 'assistant' && /(?:^|\n)\s*(?:bash|pwsh|powershell|web_search|web_fetch|browser|read_file|write_file)\s*\n\s*\{/.test(message.text)
}

function processSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140) || '工具调用记录'
}

function threadMessage(thread, message) {
  const isUser = message.kind === 'user'
  const label = isUser ? '你' : message.kind === 'assistant' ? 'DSH' : message.kind === 'error' ? '错误' : '记录'
  const branch = message.kind === 'assistant' && Number.isInteger(message.sourceSeq)
    ? `<button class="message-branch" data-action="open-branch" data-thread="${thread.id}" data-seq="${message.sourceSeq}" title="从此回答创建分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>分支</button>`
    : ''
  const messageId = `${thread.id}:${message.sourceSeq ?? `${message.kind}:${message.at}`}`
  const collapsible = isProcessMessage(message)
  const expanded = state.expandedMessageIds.has(messageId)
  const fold = collapsible ? `<button class="message-fold" data-action="toggle-message" data-message="${escapeHtml(messageId)}" aria-label="${expanded ? '收起过程记录' : '展开过程记录'}" title="${expanded ? '收起' : '展开'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg></button>` : ''
  const process = Array.isArray(message.process) && message.process.length > 0 ? message.process : null
  const body = message.pending && message.text === '' ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>'
    : `${collapsible && !expanded ? `<p class="message-summary">${escapeHtml(processSummary(message.text))}</p>` : renderMarkdown(message.text)}${message.pending ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>' : ''}${process === null ? '' : processRecords(process, messageId)}`
  const avatar = isUser ? '' : '<span class="message-avatar" aria-hidden="true"></span>'
  return `<article class="message message-${message.kind}${message.pending ? ' message-pending' : ''}${collapsible ? ' message-collapsible' : ''}${expanded ? ' expanded' : ''}"><header>${avatar}<span class="message-role">${label}</span><time>${formatTime(message.at)}</time>${branch}${fold}</header><div class="message-body">${body}</div></article>`
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  const entries = process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const entryExpanded = state.expandedMessageIds.has(entryKey)
    const status = entry.error !== null ? '失败' : entry.result === null ? '等待结果' : '完成'
    const argumentsHtml = entry.arguments === null || entry.arguments === '' ? '' : `<pre class="process-args">${escapeHtml(entry.arguments)}</pre>`
    const outcomeHtml = entry.error !== null ? `<pre class="process-error">${escapeHtml(entry.error)}</pre>` : entry.result === null ? '' : `<pre class="process-result">${escapeHtml(entry.result)}</pre>`
    return `<div class="process-entry${entryExpanded ? ' expanded' : ''}"><button class="process-entry-fold" data-action="toggle-message" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(entry.name)}</span><span class="process-status${entry.error !== null ? ' process-status-error' : entry.result === null ? ' process-status-pending' : ' process-status-done'}">${status}</span></button>${entryExpanded ? `<div class="process-entry-body">${argumentsHtml}${outcomeHtml}</div>` : ''}</div>`
  }).join('')
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? entries : ''}</section>`
}

function renderSessionLibrary() {
  const workspaces = state.dshWorkspaces
  if (workspaces.length === 0) return '<nav class="session-library"><p class="tree-empty">暂未同步会话</p></nav>'
  const archived = new Set(state.archivedSessionIds)
  const sections = workspaces.map(workspace => {
    const sessions = (workspace.sessions ?? [])
      .filter(session => !archived.has(session.id))
      .slice()
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    if (sessions.length === 0) return ''
    const expanded = state.expandedWorkspaces.has(workspace.id)
    const limit = expanded ? Math.max(state.sidebarSessionLimit, sessions.length) : state.sidebarSessionLimit
    const visibleSessions = sessions.slice(0, limit)
    const hiddenCount = sessions.length - visibleSessions.length
    const items = visibleSessions.map(session => {
      const loaded = state.loadedSessions.has(session.id)
      const title = session.title ?? session.id
      return `<div class="session-item${loaded ? ' loaded' : ''}" draggable="true" data-session-id="${escapeHtml(session.id)}" title="${escapeHtml(title)}">
        <span class="session-dot"></span><span class="session-title">${escapeHtml(title)}</span>${loaded ? '<i class="session-loaded">已载入</i>' : ''}${loaded ? `<button class="session-unload" type="button" data-action="unload-session" data-session-id="${escapeHtml(session.id)}" title="卸载此会话地图" aria-label="卸载 ${escapeHtml(title)}">×</button>` : ''}
      </div>`
    }).join('')
    const toggle = hiddenCount > 0 || expanded
      ? `<button class="session-group-toggle" type="button" data-action="toggle-workspace-sessions" data-workspace-id="${escapeHtml(workspace.id)}">${expanded ? '收起' : `展开其余 ${hiddenCount} 个会话`}</button>`
      : ''
    return `<section class="session-group"><h3 class="session-group-title">${escapeHtml(workspace.title)}</h3><div class="session-group-body">${items}${toggle}</div></section>`
  }).filter(Boolean).join('')
  return `<nav class="session-library">${sections}</nav>`
}

function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const messages = messagesFor(thread)
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  const draft = state.draft
  const draftForThis = draft !== null && draft.parentId === thread.id
  const detailDraft = draftForThis
    ? `<div class="detail-draft"><div class="detail-draft-label">${draft.kind === 'continue' ? '新的追问' : '新的分支'}</div><form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="${draft.kind === 'continue' ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form></div>`
    : ''
  return `<section class="detail-view"><header class="detail-head"><div class="detail-head-title"><div class="detail-head-meta"><span class="detail-badge">${thread.parentId === null ? '会话' : '分支'}</span>${thread.dshSessionTitle ?? thread.title ? `<span class="detail-subtitle">${escapeHtml(thread.dshSessionTitle ?? thread.title)}</span>` : ''}</div><h1>${escapeHtml(questionFor(thread))}</h1></div><div class="detail-head-actions"><button data-action="open-dsh" data-thread="${thread.id}" title="在原生对话中打开此会话">在 DSH 中打开</button><button data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支">创建分支</button><button class="primary" data-action="show-canvas">返回画布</button></div></header><div class="detail-scroll">${messages.map(message => threadMessage(thread, message)).join('') || '<div class="note-empty">等待这条会话的第一条消息。</div>'}${detailDraft}</div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" placeholder="继续当前会话…" ${waiting ? 'disabled' : ''}></textarea><button class="primary" type="submit" ${waiting ? 'disabled' : ''}>${waiting ? '等待回复' : '发送'}</button></form></section>`
}

function render() {
  const detail = state.mode === 'thread' ? document.querySelector('.detail-scroll') : null
  const detailScrollTop = detail instanceof HTMLElement ? detail.scrollTop : null
  const cardScrollTops = new Map()
  if (state.mode === 'canvas') {
    for (const answer of document.querySelectorAll('.thread-card[data-thread] .thread-answer')) {
      const card = answer.closest('.thread-card')
      if (card instanceof HTMLElement && typeof card.dataset.thread === 'string') cardScrollTops.set(card.dataset.thread, answer.scrollTop)
    }
  }
  const workspace = state.workspace
  const threads = mapThreads()
  const view = state.mode === 'thread' ? renderThread() : renderCanvas()
  const canvasControls = state.mode === 'canvas' && (threads.length > 0 || state.draft?.kind === 'new') ? `<div class="canvas-controls"><button data-action="layout">整理节点</button><button data-action="focus-active" title="定位到当前会话">定位</button><button data-action="zoom-out" aria-label="缩小">-</button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="放大">+</button><button data-action="sync-forks" title="同步：拉取服务端地图并自动加入新分支">同步</button><button data-action="clear-map" title="卸载所有已载入会话">清空地图</button></div>` : ''
  const detailAvailable = currentThread() !== null
  const canvasTabs = `<nav class="canvas-tabs" aria-label="会话地图视图"><button class="${state.mode === 'canvas' ? 'active' : ''}" data-action="show-canvas">地图</button><button class="${state.mode === 'thread' ? 'active' : ''}" data-action="show-thread" data-thread="${state.activeId ?? ''}" ${detailAvailable ? '' : 'disabled'}>详情</button></nav>`
  app.innerHTML = `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-brand-row"><div class="brand" aria-label="Synapse"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>Synapse</strong></div><button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button></div><button class="new-workspace" type="button" data-action="create-session" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新会话</span></button><div class="sidebar-heading"><span>历史对话</span><span class="sidebar-hint">拖到右侧地图加载</span></div>${renderSessionLibrary()}</aside><header class="topbar"><div class="view-switch" role="group" aria-label="视图切换"><button data-action="close" type="button" aria-pressed="false">对话</button><button class="active" type="button" aria-pressed="true">会话地图</button></div>${canvasControls}</header><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}${view}</section></main>`
  installDragging()
  for (const [threadId, scrollTop] of cardScrollTops) {
    const answer = app.querySelector(`.thread-card[data-thread="${CSS.escape(threadId)}"] .thread-answer`)
    if (answer instanceof HTMLElement) answer.scrollTop = scrollTop
  }
  if (detailScrollTop !== null) window.requestAnimationFrame(() => {
    const nextDetail = document.querySelector('.detail-scroll')
    if (nextDetail instanceof HTMLElement) nextDetail.scrollTop = detailScrollTop
  })
}

function renderPreservingDetailScroll() {
  render()
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
}

function installDragging() {
  for (const handle of document.querySelectorAll('[data-drag-card]')) handle.addEventListener('pointerdown', event => {
    const cardId = event.currentTarget.dataset.dragCard
    const card = event.currentTarget.closest('.thread-card')
    if (cardId === undefined || !(card instanceof HTMLElement)) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY, position: { x: Number.parseFloat(card.style.left), y: Number.parseFloat(card.style.top) } }
    const aliases = card.dataset.positionKey === undefined ? [] : [card.dataset.positionKey]
    let position = origin.position
    let stopped = false
    state.dragging = true
    const move = moveEvent => {
      position = { x: origin.position.x + (moveEvent.clientX - origin.x) / state.zoom, y: origin.position.y + (moveEvent.clientY - origin.y) / state.zoom }
      state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
      for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
      card.style.left = `${position.x}px`
      card.style.top = `${position.y}px`
      refreshCardConnectors(cardId)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      rememberCardPosition(cardId, position, aliases)
      state.dragging = false
      deferCanvasRefresh(120)
      render()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function canvasViewport(target) {
  return target instanceof Element ? target.closest('.canvas-viewport') : null
}

function zoomCanvas(viewport, nextZoom, clientX, clientY) {
  const zoom = Math.min(4, Math.max(.6, Math.round(nextZoom * 100) / 100))
  if (zoom === state.zoom) return
  const bounds = viewport.getBoundingClientRect()
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const worldX = (localX - state.canvasCamera.x) / state.zoom
  const worldY = (localY - state.canvasCamera.y) / state.zoom
  state.zoom = zoom
  state.canvasCamera = { x: localX - worldX * zoom, y: localY - worldY * zoom }
  applyCanvasTransform()
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
}

function zoomCanvasAtCenter(delta) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const bounds = viewport.getBoundingClientRect()
  zoomCanvas(viewport, state.zoom + delta, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
}

function focusActiveCard() {
  const card = document.querySelector('.thread-card.active') ?? document.querySelector('.thread-card[data-thread]:not(.draft-card)')
  const viewport = document.querySelector('.canvas-viewport')
  if (!(card instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return
  const left = Number.parseFloat(card.style.left)
  const top = Number.parseFloat(card.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) return
  const bounds = viewport.getBoundingClientRect()
  state.canvasCamera = {
    x: bounds.width / 2 - (left + CARD_WIDTH / 2) * state.zoom,
    y: bounds.height / 2 - (top + CARD_HEIGHT / 2) * state.zoom,
  }
  applyCanvasTransform()
}

app.addEventListener('pointerdown', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select')) return
  event.preventDefault()
  const origin = { x: event.clientX, y: event.clientY, camera: { ...state.canvasCamera } }
  state.canvasGesture = true
  viewport.classList.add('is-panning')
  viewport.setPointerCapture(event.pointerId)
  const move = moveEvent => {
    state.canvasCamera = {
      x: origin.camera.x + moveEvent.clientX - origin.x,
      y: origin.camera.y + moveEvent.clientY - origin.y,
    }
    applyCanvasTransform()
  }
  const stop = () => {
    viewport.classList.remove('is-panning')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    state.canvasGesture = false
    deferCanvasRefresh(120)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

app.addEventListener('wheel', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  // While the user is actively wheeling, suppress full re-renders so a live
  // refresh never yanks the viewport back mid-gesture.
  state.wheelGestureUntil = Date.now() + 150
  const card = event.target instanceof Element ? event.target.closest('.thread-card') : null
  if (card instanceof HTMLElement) {
    // Over a card the wheel scrolls that card's own answer with the browser's
    // native wheel (OS-smooth, never a page jump per notch); the answer's
    // overscroll-behavior: contain stops the scroll chaining into the canvas.
    const answer = card.querySelector('.thread-answer')
    if (answer instanceof HTMLElement && answer.scrollHeight > answer.clientHeight) {
      deferCanvasRefresh()
      return
    }
    // A card with no scrollable answer swallows the wheel instead of zooming.
    event.preventDefault()
    deferCanvasRefresh()
    return
  }
  event.preventDefault()
  zoomCanvas(viewport, state.zoom + (event.deltaY < 0 ? .05 : -.05), event.clientX, event.clientY)
}, { passive: false })

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]')
  if (!(button instanceof HTMLElement)) {
    const card = event.target instanceof Element ? event.target.closest('.thread-card[data-thread]:not(.draft-card)') : null
    if (!(card instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.node-handle, textarea, select, form')) return
    const thread = mapThreads().find(item => item.id === card.dataset.thread)
    if (thread === undefined) return
    state.activeId = thread.id
    state.error = ''
    render()
    void loadThreadHistory(thread)
    // Bidirectional current-session sync: switch DSH's current session
    // without closing the map; the client confirms via synapse:current-session.
    if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
    return
  }
  const thread = mapThreads().find(item => item.id === button.dataset.thread)
  try {
    if (button.dataset.action === 'close') post('synapse:close')
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'toggle-session-library') { state.sidebarExpanded = !state.sidebarExpanded; render() }
    if (button.dataset.action === 'toggle-workspace-sessions' && button.dataset.workspaceId !== undefined) {
      const id = button.dataset.workspaceId
      state.expandedWorkspaces.has(id) ? state.expandedWorkspaces.delete(id) : state.expandedWorkspaces.add(id)
      render()
    }
    if (button.dataset.action === 'create-session') openNewSession()
    if (button.dataset.action === 'open-current' && state.currentDsh !== null) post('synapse:open-session', { sessionId: state.currentDsh.id })
    if (button.dataset.action === 'select-thread' && thread !== undefined) {
      state.activeId = thread.id
      state.error = ''
      render()
      void loadThreadHistory(thread)
      // Bidirectional current-session sync: switch DSH's current session
      // without closing the map; the client confirms via synapse:current-session.
      if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    if (button.dataset.action === 'show-thread' && thread !== undefined) { state.activeId = thread.id; state.mode = 'thread'; render(); void loadThreadHistory(thread) }
    if (button.dataset.action === 'show-canvas') { state.mode = 'canvas'; render() }
    if (button.dataset.action === 'open-continue' && thread !== undefined) openContinue(thread, button.dataset.card)
    if (button.dataset.action === 'open-branch' && thread !== undefined) {
      const requestedSeq = Number(button.dataset.seq)
      if (button.dataset.card !== undefined && !Number.isInteger(requestedSeq)) return setError('请等待这张卡片的最终回答后再创建分支')
      const fallbackSeq = latestMessage(thread, 'assistant')?.sourceSeq
      openBranch(thread, Number.isInteger(requestedSeq) ? requestedSeq : fallbackSeq, button.dataset.card)
    }
    if (button.dataset.action === 'cancel-draft') { state.draft = null; render() }
    if (button.dataset.action === 'toggle-message' && button.dataset.message !== undefined) { state.expandedMessageIds.has(button.dataset.message) ? state.expandedMessageIds.delete(button.dataset.message) : state.expandedMessageIds.add(button.dataset.message); renderPreservingDetailScroll() }
    if (button.dataset.action === 'open-dsh' && thread?.dshSessionId !== null) post('synapse:open-session', { sessionId: thread.dshSessionId })
    if (button.dataset.action === 'archive-thread' && thread !== undefined) await archiveThread(thread)
    if (button.dataset.action === 'unload-session' && button.dataset.sessionId !== undefined) {
      const title = button.dataset.sessionId
      if (window.confirm(`卸载此会话地图？DSH 原会话会保留，可随时再次拖入。`)) unloadSession(button.dataset.sessionId)
      void 0
    }
    if (button.dataset.action === 'sync-forks') {
      void syncForks()
    }
    if (button.dataset.action === 'clear-map') {
      if (mapThreads().length === 0) return
      if (!window.confirm('清空地图？将卸载所有已载入的会话（DSH 原会话全部保留）。')) return
      for (const sessionId of [...state.loadedSessions.keys()]) unloadSession(sessionId)
    }
    if (button.dataset.action === 'zoom-in') zoomCanvasAtCenter(.1)
    if (button.dataset.action === 'zoom-out') zoomCanvasAtCenter(-.1)
    if (button.dataset.action === 'focus-active') focusActiveCard()
    if (button.dataset.action === 'dismiss-error') { state.error = ''; render() }
    if (button.dataset.action === 'layout' && mapThreads().length > 0) {
      resetCardPositions()
      resetCanvasCamera()
      render()
    }
  } catch (error) { setError(error) }
})

const mainStage = () => app.querySelector('.main-stage')

const setDropTarget = active => {
  const stage = mainStage()
  if (stage instanceof HTMLElement) stage.classList.toggle('is-drag-target', active)
}

app.addEventListener('dragstart', event => {
  const item = event.target instanceof Element ? event.target.closest('.session-item') : null
  if (!(item instanceof HTMLElement) || item.dataset.sessionId === undefined) return
  event.dataTransfer?.setData('text/plain', item.dataset.sessionId)
  event.dataTransfer.effectAllowed = 'copy'
  item.classList.add('dragging')
  // Highlight the whole right map area as the drop zone.
  setDropTarget(true)
})

app.addEventListener('dragend', event => {
  const item = event.target instanceof Element ? event.target.closest('.session-item') : null
  if (item instanceof HTMLElement) item.classList.remove('dragging')
  setDropTarget(false)
})

app.addEventListener('dragover', event => {
  const stage = event.target instanceof Element ? event.target.closest('.main-stage') : null
  if (!(stage instanceof HTMLElement)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  stage.classList.add('is-drag-over')
})

app.addEventListener('dragleave', event => {
  const stage = event.target instanceof Element ? event.target.closest('.main-stage') : null
  if (stage instanceof HTMLElement) stage.classList.remove('is-drag-over')
})

app.addEventListener('drop', async event => {
  const stage = event.target instanceof Element ? event.target.closest('.main-stage') : null
  if (!(stage instanceof HTMLElement)) return
  event.preventDefault()
  stage.classList.remove('is-drag-over')
  setDropTarget(false)
  const sessionId = event.dataTransfer?.getData('text/plain')
  if (typeof sessionId !== 'string' || sessionId === '') return
  try {
    const summary = sessionSummaryById(sessionId)
    const thread = await loadSessionToMap(sessionId, summary)
    if (thread === null) return
    state.activeId = thread.id
    state.error = ''
    if (canReplaceView()) render()
    if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
  } catch (error) {
    setError(error)
  }
})

app.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLTextAreaElement && input.closest('[data-draft]') && state.draft !== null) state.draft.text = input.value })
app.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  if (form.matches('[data-draft]')) { event.preventDefault(); void submitDraft(); return }
  const thread = mapThreads().find(item => item.id === form.dataset.compose)
  const input = form.querySelector('textarea')
  if (thread === undefined || !(input instanceof HTMLTextAreaElement) || input.value.trim() === '') return
  event.preventDefault()
  const text = input.value.trim()
  input.value = ''
  void sendMessage(thread, text).catch(setError)
})

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.source !== 'dsh-synapse') return
  const data = event.data
  if (data.type === 'synapse:map-opened') {
    state.mapVisible = true
    resetCanvasCamera()
    state.mode = 'canvas'
    render()
    window.requestAnimationFrame(() => post('synapse:map-ready'))
    // Load the workspace graph only when the map is actually opened, not at
    // DSH startup behind a hidden iframe.
    if (!initialRefreshStarted) {
      initialRefreshStarted = true
      void refreshSummaries().catch(setError)
      // Server-authoritative map: any device sees the same loaded sessions.
      void loadServerMap().then(() => {
        if (canReplaceView()) render()
      }).catch(() => {})
      // Push-based sync: subscribe once, no polling.
      setupMapEvents()
    }
  }
  if (data.type === 'synapse:map-closed') {
    state.mapVisible = false
  }
  if (data.type === 'synapse:workspaces') {
    if (!state.mapVisible) return
    state.dshWorkspaces = Array.isArray(data.workspaces) ? data.workspaces.filter(workspace => typeof workspace?.id === 'string' && typeof workspace.title === 'string' && Array.isArray(workspace.sessionIds)) : []
    state.archivedSessionIds = Array.isArray(data.archivedSessionIds) ? data.archivedSessionIds.filter(id => typeof id === 'string') : (state.archivedSessionIds ?? [])
    if (canReplaceView()) render()
  }
  if (data.type === 'synapse:current-session') {
    if (!state.mapVisible) return
    state.currentDsh = data.session
    // Highlight the loaded map thread that matches the DSH current session,
    // but never auto-load a session into the map — that is drag-only now.
    const thread = currentDshThread()
    if (thread !== undefined) state.activeId = thread.id
    if (canReplaceView()) render()
  }
  if (data.type === 'synapse:live-reply' && typeof data.sessionId === 'string') {
    const thread = mapThreads().find(item => item.dshSessionId === data.sessionId)
    if (thread !== undefined) {
      if (data.running === true) {
        // Streaming output from another conversation must NOT rebuild the whole
        // canvas every ~120ms — that is what causes the view to flash/jump while
        // the user is scrolling or zooming. Keep the live text in state only;
        // a single refresh happens when the turn actually finishes.
        state.liveReplies.set(data.sessionId, { running: true, text: typeof data.text === 'string' ? data.text : '' })
        return
      }
      state.liveReplies.delete(data.sessionId)
      // The turn has finished: clear the pending marker regardless of whether
      // the follow-up history refresh succeeds, so the card can never stay
      // stuck on "正在回复".
      state.pendingReplies.delete(data.sessionId)
      // A turn finished: refresh this loaded session's cached history so the
      // finalized answer lands on the map without a manual re-drag. Preserve the
      // branch cut (sourceSeedLength) so a fork never re-imports its inherited
      // prefix after the first turn completes.
      if (state.loadedSessions.has(data.sessionId)) {
        const entry = state.loadedSessions.get(data.sessionId)
        const atSeq = Number.isSafeInteger(entry?.sourceSeedLength) ? entry.sourceSeedLength : undefined
        void loadSessionToMap(data.sessionId, sessionSummaryById(data.sessionId), null, true, atSeq).then(() => {
          if (canReplaceView()) render()
        }).catch(() => {})
      } else if (canReplaceView()) {
        scheduleLiveRender()
      }
    }
  }
  if (data.type === 'synapse:forked-session' || data.type === 'synapse:created-session' || data.type === 'synapse:message-sent' || data.type === 'synapse:history-loaded') settleRpc(data.requestId, data.session ?? data)
  if (data.type === 'synapse:bridge-error') { settleRpc(data.requestId, undefined, new Error(data.message)); if (data.requestId === undefined) setError(data.message) }
})

let initialRefreshStarted = false
post('synapse:request-current')
let polling = false
let mapEventSource = null
let liveRenderTimer = 0
function scheduleLiveRender() {
  if (liveRenderTimer !== 0 || !canReplaceView()) return
  liveRenderTimer = window.setTimeout(() => {
    liveRenderTimer = 0
    if (canReplaceView()) renderPreservingDetailScroll()
  }, 120)
}
async function pollProjection() {
  if (polling || !state.mapVisible || document.hidden || !canReplaceView()) return
  polling = true
  try {
    await refreshProjection()
  } finally { polling = false }
}
window.setInterval(() => { void pollProjection() }, 2_000)

// Robustness: if the parent page's `synapse:map-opened` message is lost (e.g.
// the iframe was still loading when the user clicked the map toggle), self
// initialize after a short grace period so the map still loads and subscribes.
window.setTimeout(() => {
  if (initialRefreshStarted) return
  initialRefreshStarted = true
  state.mapVisible = true
  render()
  void refreshSummaries().catch(() => {})
  void loadServerMap().then(changed => {
    if (changed && canReplaceView()) render()
  }).catch(() => {})
  setupMapEvents()
}, 2_500)


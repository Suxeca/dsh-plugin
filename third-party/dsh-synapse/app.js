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
const CARD_NOTES_KEY = 'dsh-synapse:card-notes:v1'
const MINIMAP_COLLAPSED_KEY = 'dsh-synapse:minimap-collapsed:v1'
const minimapCollapsedFromStorage = (() => {
  try { return localStorage.getItem(MINIMAP_COLLAPSED_KEY) === 'true' } catch { return false }
})()
const savedCardNotes = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(CARD_NOTES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
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
  summaries: [], workspace: null, activeId: null, mode: 'canvas', zoom: 1, currentDsh: null, sidebarCollapsed: false, sessionPickerOpen: false, sessionPickerLoadingId: null,
  maps: [], activeMapId: 'default',
  dshWorkspaces: [], selectedDshWorkspaceId: null, archivedSessionIds: [], sidebarSessionLimit: 3, sidebarExpanded: false, expandedWorkspaces: new Set(),
  historyBySession: new Map(), historyRequests: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(),
  // Loaded-on-demand sessions: sessionId -> { messages, cachedAt, title }.
  // This is the module that drives the map; the left list is the source module.
  loadedSessions: new Map(Object.entries(loadedSessionsFromStorage)),
  draft: null, error: '', workspaceLoad: 0, branchAnchors: new Map(savedBranchAnchors), cardPositions: new Map(savedCardPositions),
  cardNotes: new Map(savedCardNotes), editingNoteCardId: null, contextMenu: null, minimapCollapsed: minimapCollapsedFromStorage, exportModalOpen: false,
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

function triggerServerMapSync() {
  if (mapSyncTimer !== 0) return
  mapSyncTimer = window.setTimeout(() => {
    mapSyncTimer = 0
    const mapPayload = Object.fromEntries([...state.loadedSessions.entries()].map(([sessionId, entry]) => [sessionId, serverMapEntry(entry)]))
    const notesPayload = Object.fromEntries([...state.cardNotes.entries()])
    void fetch('/synapse/api/map', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ map: mapPayload, notes: notesPayload }),
    }).catch(() => {})
  }, 150)
}

function persistLoadedSessions() {
  try { localStorage.setItem(mapStorageKey(LOADED_SESSIONS_KEY), JSON.stringify(Object.fromEntries(state.loadedSessions))) } catch { /* Private browsing may disable local storage. */ }
  triggerServerMapSync()
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
  const notes = body?.notes
  const serverMapId = typeof body?.activeMap?.id === 'string' ? body.activeMap.id : null
  if (serverMapId !== null && serverMapId !== state.activeMapId) {
    // An SSE notification may have been caused by another device turning the
    // shared map-library page. Swap every local-only cache before hydrating.
    state.activeMapId = serverMapId
    state.loadedSessions = new Map(Object.entries(readMapCache(LOADED_SESSIONS_KEY, {})))
    state.cardPositions = new Map(readMapCache(CARD_POSITIONS_KEY, []))
    state.cardNotes = new Map(readMapCache(CARD_NOTES_KEY, []))
    state.branchAnchors = new Map(readMapCache('dsh-synapse:branch-anchors', []))
    state.activeId = null
    resetCanvasCamera()
    void refreshMaps().catch(() => {})
  }
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return false

  const beforeMap = JSON.stringify(Object.fromEntries(state.loadedSessions))
  const beforeNotes = JSON.stringify([...state.cardNotes])

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

  // Merge server card notes across devices (desktop, Android, etc.)
  if (notes !== null && typeof notes === 'object' && !Array.isArray(notes)) {
    let localHasUnpushedNotes = false
    for (const [cardId, note] of Object.entries(notes)) {
      if (typeof note === 'string' && note.trim() !== '') {
        state.cardNotes.set(cardId, note.trim())
      }
    }
    for (const [cardId] of state.cardNotes.entries()) {
      if (!(cardId in notes)) {
        localHasUnpushedNotes = true
      }
    }
    try { localStorage.setItem(CARD_NOTES_KEY, JSON.stringify([...state.cardNotes])) } catch { /* ignore */ }
    // If this device has historical local notes not yet on the server, upload them so other devices get them
    if (localHasUnpushedNotes) {
      triggerServerMapSync()
    }
  } else if (state.cardNotes.size > 0) {
    // If server has no notes record yet, upload all existing local notes to the server
    triggerServerMapSync()
  }

  const changed = JSON.stringify(Object.fromEntries(state.loadedSessions)) !== beforeMap || JSON.stringify([...state.cardNotes]) !== beforeNotes
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

function persistCardNotes() {
  try { localStorage.setItem(CARD_NOTES_KEY, JSON.stringify([...state.cardNotes])) } catch { /* Private browsing may disable local storage. */ }
  triggerServerMapSync()
}

function rememberCardNote(cardId, note) {
  const text = typeof note === 'string' ? note.trim() : ''
  if (text !== '') {
    state.cardNotes.set(cardId, text)
  } else {
    state.cardNotes.delete(cardId)
  }
  persistCardNotes()
}

function removeCardNote(cardId) {
  state.cardNotes.delete(cardId)
  persistCardNotes()
}

function normalizeTurnText(text) {
  if (typeof text !== 'string') return ''
  let cleaned = text.trim()
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim()
  cleaned = cleaned.replace(/<system-instructions>[\s\S]*?<\/system-instructions>/gi, '').trim()
  cleaned = cleaned.replace(/<context>[\s\S]*?<\/context>/gi, '').trim()
  cleaned = cleaned.replace(/^Current runtime context[\s\S]*?(\n\n|$)/gi, '').trim()
  cleaned = cleaned.replace(/^The following workspace instructions may be relevant[\s\S]*?(\n\n|$)/gi, '').trim()
  cleaned = cleaned.replace(/^# AGENTS\.md[\s\S]*?(\n\n|$)/gi, '').trim()
  return cleaned.replace(/\r\n/g, '\n').replace(/\s+/g, ' ')
}

function sessionUserTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((m, index) => (m && m.kind === 'user' && normalizeTurnText(m.text) !== '') ? [{ ...m, messageIndex: index }] : [])
}

function cardIdForTurn(threadId, turn) {
  if (!turn) return null
  return `${threadId}:turn:${turn.sourceSeq ?? turn.messageIndex ?? 0}`
}

function computeContextTurnsPrefix(turnsA, turnsB) {
  let k = 0
  while (k < turnsA.length && k < turnsB.length) {
    if (normalizeTurnText(turnsA[k].text) === normalizeTurnText(turnsB[k].text)) {
      k++
    } else {
      break
    }
  }
  return k
}

/**
 * Auto-repair broken parent-child connections across all loaded sessions on the map.
 * Evaluates both conversation context turns and metadata, ensuring branch connections
 * are restored accurately even across reloads or when parent IDs were lost/out of sync.
 */
async function repairLoadedSessionConnections() {
  if (state.loadedSessions.size === 0) return false

  const metaParentMap = new Map()
  for (const workspace of state.dshWorkspaces ?? []) {
    for (const s of workspace.sessions ?? []) {
      if (s?.id && s.parentId) {
        metaParentMap.set(s.id, s.parentId)
      }
    }
  }

  try {
    const res = await fetch('/synapse/api/sessions', { cache: 'no-store' })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      if (Array.isArray(body?.sessions)) {
        for (const s of body.sessions) {
          if (s?.id && s.parentId && !metaParentMap.has(s.id)) {
            metaParentMap.set(s.id, s.parentId)
          }
        }
      }
    }
  } catch { /* ignore */ }

  const sessionList = []
  for (const [sessionId, entry] of state.loadedSessions.entries()) {
    const ownMsgs = entry?.messages ?? []
    const ownTurns = sessionUserTurns(ownMsgs)
    const rawParent = entry?.parentId ? String(entry.parentId).replace(/^loaded:/, '') : null
    const metaParent = metaParentMap.get(sessionId) ?? rawParent
    sessionList.push({
      id: sessionId,
      entry,
      messages: ownMsgs,
      turns: ownTurns,
      turnCount: ownTurns.length,
      firstTurn: ownTurns[0]?.text ? normalizeTurnText(ownTurns[0].text) : '',
      cachedAt: entry?.cachedAt ?? 0,
      metaParentId: metaParent,
      existingParentId: rawParent,
      sourceSeedLength: Number.isSafeInteger(entry?.sourceSeedLength) ? entry.sourceSeedLength : null,
    })
  }

  const byId = new Map(sessionList.map(s => [s.id, s]))
  const result = new Map()

  // 1. Sort sessions to identify natural roots (earliest created / least dependencies)
  sessionList.sort((a, b) => {
    const aIsMetaRoot = !a.metaParentId || !byId.has(a.metaParentId)
    const bIsMetaRoot = !b.metaParentId || !byId.has(b.metaParentId)
    if (aIsMetaRoot && !bIsMetaRoot) return -1
    if (!aIsMetaRoot && bIsMetaRoot) return 1
    if ((a.cachedAt || 0) !== (b.cachedAt || 0)) return (a.cachedAt || 0) - (b.cachedAt || 0)
    return a.turnCount - b.turnCount
  })

  const treeNodes = [sessionList[0]]
  result.set(sessionList[0].id, {
    parentId: null,
    parentSessionId: null,
    sourceSeedLength: null,
    anchorCardId: null,
    matchCount: 0,
  })

  const remaining = sessionList.slice(1)

  while (remaining.length > 0) {
    let bestCandidateIdx = -1
    let bestParentNode = null
    let bestMatchK = 0
    let bestForkParentTurn = null
    let bestFirstOwnTurn = null
    let fallbackCandidateIdx = -1
    let fallbackParentNode = null

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      for (const parentNode of treeNodes) {
        let k = 0
        while (k < candidate.turns.length && k < parentNode.turns.length) {
          if (normalizeTurnText(candidate.turns[k].text) === normalizeTurnText(parentNode.turns[k].text)) {
            k++
          } else {
            break
          }
        }
        if (k > bestMatchK) {
          bestMatchK = k
          bestCandidateIdx = i
          bestParentNode = parentNode
          bestForkParentTurn = parentNode.turns[k - 1]
          bestFirstOwnTurn = candidate.turns[k]
        } else if (k === bestMatchK && k > 0 && bestCandidateIdx !== -1) {
          if (candidate.metaParentId === parentNode.id || candidate.existingParentId === parentNode.id) {
            bestCandidateIdx = i
            bestParentNode = parentNode
            bestForkParentTurn = parentNode.turns[k - 1]
            bestFirstOwnTurn = candidate.turns[k]
          }
        } else if (k === 0 && fallbackCandidateIdx === -1) {
          // Check metadata or anchor connection for trimmed branches
          const existingAnchor = state.branchAnchors.get(`loaded:${candidate.id}`) ?? state.branchAnchors.get(candidate.id)
          const targetParentId = candidate.existingParentId ?? candidate.metaParentId
          if (targetParentId === parentNode.id && (existingAnchor || Number.isSafeInteger(candidate.sourceSeedLength))) {
            fallbackCandidateIdx = i
            fallbackParentNode = parentNode
          }
        }
      }
    }

    if (bestCandidateIdx >= 0 && bestMatchK > 0) {
      const selected = remaining.splice(bestCandidateIdx, 1)[0]
      treeNodes.push(selected)
      result.set(selected.id, {
        parentId: `loaded:${bestParentNode.id}`,
        parentSessionId: bestParentNode.id,
        sourceSeedLength: (bestFirstOwnTurn && Number.isInteger(bestFirstOwnTurn.sourceSeq)) ? bestFirstOwnTurn.sourceSeq : selected.sourceSeedLength,
        anchorCardId: cardIdForTurn(`loaded:${bestParentNode.id}`, bestForkParentTurn),
        matchCount: bestMatchK,
      })
    } else if (fallbackCandidateIdx >= 0 && fallbackParentNode) {
      const selected = remaining.splice(fallbackCandidateIdx, 1)[0]
      treeNodes.push(selected)
      const existingAnchor = state.branchAnchors.get(`loaded:${selected.id}`) ?? state.branchAnchors.get(selected.id)
      let anchorCardId = existingAnchor ?? null
      if (!anchorCardId && fallbackParentNode.turns.length > 0) {
        if (Number.isSafeInteger(selected.sourceSeedLength)) {
          const matchingTurn = fallbackParentNode.turns.filter(t => Number.isInteger(t.sourceSeq) ? t.sourceSeq < selected.sourceSeedLength : true).at(-1)
          anchorCardId = cardIdForTurn(`loaded:${fallbackParentNode.id}`, matchingTurn ?? fallbackParentNode.turns.at(-1))
        } else {
          anchorCardId = cardIdForTurn(`loaded:${fallbackParentNode.id}`, fallbackParentNode.turns.at(-1))
        }
      }
      result.set(selected.id, {
        parentId: `loaded:${fallbackParentNode.id}`,
        parentSessionId: fallbackParentNode.id,
        sourceSeedLength: selected.sourceSeedLength,
        anchorCardId,
        matchCount: 0,
      })
    } else {
      const isolated = remaining.shift()
      treeNodes.push(isolated)
      result.set(isolated.id, {
        parentId: null,
        parentSessionId: null,
        sourceSeedLength: null,
        anchorCardId: null,
        matchCount: 0,
      })
    }
  }

  // Cycle guard
  for (const [sessionId, info] of result.entries()) {
    const visited = new Set([sessionId])
    let curr = info
    while (curr?.parentSessionId) {
      if (visited.has(curr.parentSessionId)) {
        info.parentId = null
        info.parentSessionId = null
        info.sourceSeedLength = null
        info.anchorCardId = null
        break
      }
      visited.add(curr.parentSessionId)
      curr = result.get(curr.parentSessionId)
    }
  }

  let changed = false
  // Apply repaired state and branch anchors
  for (const [sessionId, entry] of state.loadedSessions.entries()) {
    const target = result.get(sessionId)
    if (!target) continue

    if (entry.parentId !== target.parentId) {
      entry.parentId = target.parentId
      changed = true
    }

    if (entry.sourceSeedLength !== target.sourceSeedLength) {
      entry.sourceSeedLength = target.sourceSeedLength
      changed = true
    }

    const prevLoadedAnchor = state.branchAnchors.get(`loaded:${sessionId}`)
    if (target.anchorCardId) {
      if (prevLoadedAnchor !== target.anchorCardId) {
        state.branchAnchors.set(`loaded:${sessionId}`, target.anchorCardId)
        state.branchAnchors.set(sessionId, target.anchorCardId)
        changed = true
      }
    } else if (prevLoadedAnchor !== undefined) {
      state.branchAnchors.delete(`loaded:${sessionId}`)
      state.branchAnchors.delete(sessionId)
      changed = true
    }
  }

  try {
    localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors]))
    if (typeof mapStorageKey === 'function') localStorage.setItem(mapStorageKey('dsh-synapse:branch-anchors'), JSON.stringify([...state.branchAnchors]))
  } catch { /* ignore */ }

  if (changed) {
    persistLoadedSessions()
  }
  return changed
}

function persistCardPositions() {
  try { localStorage.setItem(mapStorageKey(CARD_POSITIONS_KEY), JSON.stringify([...state.cardPositions])) } catch { /* Private browsing may disable local storage. */ }
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

function mapStorageKey(name) { return name + ':map:' + state.activeMapId }
function readMapCache(name, fallback) {
  try { return JSON.parse(localStorage.getItem(mapStorageKey(name)) ?? JSON.stringify(fallback)) } catch { return fallback }
}

async function refreshMaps() {
  const body = await api('/synapse/api/maps')
  state.maps = Array.isArray(body.maps) ? body.maps : []
  const active = state.maps.find(map => map.active)
  if (active) state.activeMapId = active.id
}

async function switchMap(id) {
  await api('/synapse/api/maps/' + encodeURIComponent(id) + '/activate', { method: 'POST' })
  state.activeMapId = id
  // Every local-only cache is map-scoped; clear runtime objects before pulling.
  state.loadedSessions = new Map(Object.entries(readMapCache(LOADED_SESSIONS_KEY, {})))
  state.cardPositions = new Map(readMapCache(CARD_POSITIONS_KEY, []))
  state.cardNotes = new Map(readMapCache(CARD_NOTES_KEY, []))
  state.branchAnchors = new Map(readMapCache('dsh-synapse:branch-anchors', []))
  state.activeId = null
  resetCanvasCamera()
  await refreshMaps()
  await loadServerMap()
  render()
}

async function createMap() {
  const title = window.prompt('新地图名称')
  if (title === null || title.trim() === '') return
  const body = await api('/synapse/api/maps', { method: 'POST', body: JSON.stringify({ title: title.trim() }) })
  await switchMap(body.map.id)
}

async function renameCurrentMap() {
  const currentMap = state.maps.find(m => m.id === state.activeMapId)
  const currentTitle = currentMap?.title ?? ''
  const newTitle = window.prompt('修改当前地图名称', currentTitle)
  if (newTitle === null || newTitle.trim() === '' || newTitle.trim() === currentTitle) return
  await api('/synapse/api/maps/' + encodeURIComponent(state.activeMapId), {
    method: 'PATCH',
    body: JSON.stringify({ title: newTitle.trim() })
  })
  await refreshMaps()
  render()
}

async function deleteCurrentMap() {
  if (state.maps.length <= 1) {
    alert('当前只有一张地图，无法删除。')
    return
  }
  const currentMap = state.maps.find(m => m.id === state.activeMapId)
  const title = currentMap?.title ?? state.activeMapId
  if (!window.confirm(`确认删除地图「${title}」？此操作将永久移除该地图及其节点与备注记录（DSH 原会话均保留）。`)) return
  const result = await api('/synapse/api/maps/' + encodeURIComponent(state.activeMapId), {
    method: 'DELETE'
  })
  if (result.activeMapId) {
    await switchMap(result.activeMapId)
  } else {
    await refreshMaps()
    render()
  }
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
function findParentSessionId(sessionId) {
  for (const workspace of state.dshWorkspaces ?? []) {
    const session = (workspace.sessions ?? []).find(item => item.id === sessionId)
    if (typeof session?.parentId === 'string' && session.parentId !== '') return session.parentId
  }
  return null
}

async function loadSessionToMap(sessionId, sessionSummary = null, parentThread = null, force = false, atSeq = undefined) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  if (parentThread === null) {
    const metaParentId = sessionSummary?.parentId ?? findParentSessionId(sessionId)
    if (metaParentId && state.loadedSessions.has(metaParentId)) {
      const pEntry = state.loadedSessions.get(metaParentId)
      parentThread = threadFromLoadedSession(metaParentId, pEntry, sessionSummaryById(metaParentId))
    }
  }
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

  // Also auto-connect any already loaded child sessions that were waiting for this parent
  for (const [childId, childEntry] of state.loadedSessions.entries()) {
    if (childId !== sessionId && childEntry.parentId === null) {
      const childParentId = findParentSessionId(childId)
      if (childParentId === sessionId) {
        const parentUserTexts = new Set(messages.filter(m => m.kind === 'user').map(m => m.text))
        const firstOwnUser = (childEntry.messages ?? []).find(m => m.kind === 'user' && !parentUserTexts.has(m.text))
        const childSeed = (firstOwnUser && Number.isInteger(firstOwnUser.sourceSeq)) ? firstOwnUser.sourceSeq : childEntry.sourceSeedLength
        cacheLoadedSession(childId, childEntry.messages, childEntry.title, `loaded:${sessionId}`, childSeed)
      }
    }
  }

  return threadFromLoadedSession(sessionId, { messages, title, parentId: parentThread?.id ?? null, sourceSeedLength: seed }, sessionSummary)
}

/** All threads currently on the map = the loaded sessions, in load order. */
function mapThreads() {
  return [...state.loadedSessions.entries()].map(([sessionId, entry]) => threadFromLoadedSession(sessionId, entry, sessionSummaryById(sessionId)))
}

function sessionSummaryById(sessionId) {
  for (const workspace of state.dshWorkspaces ?? []) {
    const session = (workspace.sessions ?? []).find(item => item.id === sessionId)
    if (session !== undefined) return { title: session.title ?? null, parentId: session.parentId ?? null }
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
  const cards = conversationCards(mapThreads())
  const position = firstAvailableCardPosition({ x: 86, y: 82 }, cards.map(c => c.position))
  state.draft = { kind: 'new', text: '', sending: false, position }
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

function initialCanvasCamera(cards, preferRoot = false) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  const rootCard = cards.find(card => card.parentId === null) ?? cards[0]
  const active = (preferRoot || state.activeId === null) ? undefined : cards.find(card => card.dshThreadId === state.activeId)
  const focus = draft ?? (preferRoot ? rootCard : (active ?? rootCard))
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  // Desktop leaves room for connector handles and nearby branches. A phone has
  // no persistent sidebar and needs the focused card inside the viewport from
  // the first frame; 14px mirrors the card's CSS edge clearance.
  const mobileCardWidth = Math.min(320, Math.max(0, (globalThis.innerWidth ?? 0) - 28))
  const insetX = globalThis.innerWidth <= 560 ? Math.max(14, (globalThis.innerWidth - mobileCardWidth) / 2) : CAMERA_INSET_X
  return { x: insetX - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
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
        ? parentCards?.filter(candidate => (Number.isInteger(candidate.sourceSeq) ? candidate.sourceSeq < seedLength : true)).at(-1)
        : undefined
      const anchorId = state.branchAnchors.get(card.dshThreadId)
      const validAnchor = (anchorId && (parentCards?.some(c => c.id === anchorId) || cards.some(c => c.id === anchorId))) ? anchorId : null
      // A fork's first card must always connect to its parent thread. Prefer the
      // validated branch anchor, then the durable DSH seed boundary, and finally
      // the parent thread's last card — never fall back to null, which would make
      // the branch a new root and push it onto a separate row.
      card.parentId = validAnchor ?? inheritedTurn?.id ?? parentCards?.at(-1)?.id ?? null
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

function renderContextMenu() {
  if (!state.contextMenu) return ''
  const { x, y, cardId, threadId } = state.contextMenu
  const note = state.cardNotes.get(cardId) ?? ''
  const thread = mapThreads().find(t => t.id === threadId)
  const isLoaded = thread !== undefined
  const posX = Math.max(8, Math.min(x, (window.innerWidth || 800) - 190))
  const posY = Math.max(8, Math.min(y, (window.innerHeight || 600) - 220))
  return `<div class="synapse-context-menu" style="left:${posX}px;top:${posY}px" role="menu">
    <button type="button" class="context-item" data-action="edit-note" data-card="${escapeHtml(cardId)}" role="menuitem">
      <svg class="context-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>
      <span>${note ? '编辑备注' : '添加备注'}</span>
    </button>
    ${note ? `<button type="button" class="context-item danger" data-action="delete-note" data-card="${escapeHtml(cardId)}" role="menuitem">
      <svg class="context-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
      <span>删除备注</span>
    </button>` : ''}
    <div class="context-divider"></div>
    ${isLoaded ? `<button type="button" class="context-item" data-action="open-branch" data-thread="${escapeHtml(threadId)}" data-card="${escapeHtml(cardId)}" role="menuitem">
      <svg class="context-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z"/></svg>
      <span>在此创建分支</span>
    </button>
    <button type="button" class="context-item" data-action="open-dsh" data-thread="${escapeHtml(threadId)}" role="menuitem">
      <svg class="context-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/><path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/></svg>
      <span>在 DSH 中打开</span>
    </button>` : ''}
  </div>`
}

function renderNoteModal() {
  if (!state.editingNoteCardId) return ''
  const cardId = state.editingNoteCardId
  const note = state.cardNotes.get(cardId) ?? ''
  return `<div class="note-modal" role="dialog" aria-modal="true" aria-labelledby="note-modal-title">
    <div class="note-modal-backdrop" data-action="close-note-modal"></div>
    <form class="note-modal-sheet" data-note-form data-note-card="${escapeHtml(cardId)}">
      <header>
        <div class="note-modal-header-title">
          <svg class="note-modal-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.487-.445 2.184a.5.5 0 0 1-.722.146L5.536 10.96 1.854 14.646a.5.5 0 0 1-.708-.708L4.828 10.25 1.42 6.84a.5.5 0 0 1 .146-.722c.697-.413 1.482-.491 2.184-.445.31.02.665.074 1.013.16L7.9 2.7c-.021-.125-.039-.283-.039-.46 0-.43.107-1.023.588-1.503a.5.5 0 0 1 .354-.146z"/></svg>
          <h3 id="note-modal-title">${note ? '编辑卡片备注' : '添加卡片备注'}</h3>
        </div>
        <button type="button" class="note-modal-close" data-action="close-note-modal" aria-label="关闭">×</button>
      </header>
      <div class="note-modal-body">
        <textarea name="noteText" maxlength="1000" placeholder="记录该轮提问的背景、动机或结论总结…" rows="4">${escapeHtml(note)}</textarea>
        <div class="note-modal-hint">
          <span>提示：按 <code>Enter</code> 保存，<code>Shift+Enter</code> 换行</span>
        </div>
      </div>
      <footer>
        <button type="button" class="note-btn-secondary" data-action="close-note-modal">取消</button>
        <button type="submit" class="note-btn-primary">保存备注</button>
      </footer>
    </form>
  </div>`
}

function generateMapSvg(cards, notesMap = new Map()) {
  if (!cards || cards.length === 0) return ''
  const PADDING = 60
  const minX = Math.min(...cards.map(c => c.position.x)) - PADDING
  const maxX = Math.max(...cards.map(c => c.position.x + CARD_WIDTH)) + PADDING
  const minY = Math.min(...cards.map(c => c.position.y)) - PADDING
  const maxY = Math.max(...cards.map(c => c.position.y + CARD_HEIGHT)) + PADDING
  const width = Math.max(400, Math.round(maxX - minX))
  const height = Math.max(300, Math.round(maxY - minY))

  const index = new Map(cards.map(card => [card.id, card]))
  const paths = cards.map(card => {
    const parent = card.parentId === null ? null : index.get(card.parentId)
    if (!parent) return ''
    const pPos = { x: parent.position.x - minX, y: parent.position.y - minY }
    const cPos = { x: card.position.x - minX, y: card.position.y - minY }
    return `<path d="${connectorPath(pPos, cPos)}" fill="none" stroke="#94a3b8" stroke-width="2"/>`
  }).join('')

  const cardElements = cards.map(card => {
    const x = Math.round(card.position.x - minX)
    const y = Math.round(card.position.y - minY)
    const note = notesMap.get(card.id) ?? ''
    const question = escapeHtml(card.question || '对话节点')
    const rawAnswer = card.answer?.text ? card.answer.text.replace(/\s+/g, ' ').trim() : '等待回答...'
    const answer = escapeHtml(rawAnswer.slice(0, 160) + (rawAnswer.length > 160 ? '...' : ''))

    const noteSvg = note ? `<rect x="${x + 12}" y="${y + 44}" width="${CARD_WIDTH - 24}" height="22" rx="4" fill="#fefce8" stroke="#fef08a"/><text x="${x + 20}" y="${y + 59}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#854d0e">📌 ${escapeHtml(note.slice(0, 26))}</text>` : ''

    return `<g class="card-group">
      <rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
      <rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="38" rx="10" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
      <circle cx="${x + 18}" cy="${y + 19}" r="4.5" fill="#3b82f6"/>
      <text x="${x + 32}" y="${y + 24}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#1e293b">${question.slice(0, 22)}</text>
      ${noteSvg}
      <foreignObject x="${x + 12}" y="${y + (note ? 72 : 46)}" width="${CARD_WIDTH - 24}" height="${CARD_HEIGHT - (note ? 80 : 54)}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:system-ui,sans-serif;font-size:12px;color:#475569;line-height:1.5;overflow:hidden;word-break:break-word;">
          ${answer}
        </div>
      </foreignObject>
    </g>`
  }).join('')

  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#f8fafc;">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif; }
  </style>
  <g class="connectors-layer">${paths}</g>
  <g class="cards-layer">${cardElements}</g>
</svg>`
}

function renderExportModal() {
  if (!state.exportModalOpen) return ''
  const threads = mapThreads()
  const cards = conversationCards(threads)
  const sessionCount = state.loadedSessions.size
  const cardCount = cards.length
  const noteCount = state.cardNotes.size
  return `<div class="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
    <div class="export-modal-backdrop" data-action="close-export-modal"></div>
    <div class="export-modal-sheet">
      <header>
        <div class="export-modal-header-title">
          <svg class="export-modal-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V10.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>
          <h3 id="export-modal-title">导出地图资产</h3>
        </div>
        <button type="button" class="export-modal-close" data-action="close-export-modal" aria-label="关闭">×</button>
      </header>
      <div class="export-modal-body">
        <div class="export-summary-badge">
          <span>包含 <strong>${sessionCount}</strong> 个会话 · <strong>${cardCount}</strong> 张卡片 · <strong>${noteCount}</strong> 条备注</span>
        </div>
        <div class="export-options-grid">
          <button type="button" class="export-card-btn primary" data-action="export-synapse-archive">
            <div class="export-btn-icon archive">📦</div>
            <div class="export-btn-content">
              <strong>.synapse 全量自包含地图包</strong>
              <small>包含拓扑、卡片坐标、便签与全量对话日志，可随时在任意设备 100% 导入复原</small>
            </div>
          </button>
          <button type="button" class="export-card-btn" data-action="export-map-svg">
            <div class="export-btn-icon svg">🖼️</div>
            <div class="export-btn-content">
              <strong>.svg 矢量高清全景图</strong>
              <small>清晰矢量图，无限放大不失真，适合文档插入、PPT 演示与工程打印</small>
            </div>
          </button>
          <button type="button" class="export-card-btn" data-action="export-map-png">
            <div class="export-btn-icon png">📸</div>
            <div class="export-btn-content">
              <strong>.png 超清全景长图</strong>
              <small>生成高清位图图片，适合发送至即时通信群聊或进行工作汇报</small>
            </div>
          </button>
        </div>
      </div>
      <footer>
        <button type="button" class="export-btn-close" data-action="close-export-modal">取消</button>
      </footer>
    </div>
  </div>`
}

function exportSynapseArchive() {
  const threads = mapThreads()
  const sessions = [...state.loadedSessions.entries()].map(([sessionId, entry]) => ({
    id: sessionId,
    title: entry?.title ?? null,
    parentId: entry?.parentId ?? null,
    sourceSeedLength: entry?.sourceSeedLength ?? null,
    cachedAt: entry?.cachedAt ?? Date.now(),
    messages: Array.isArray(entry?.messages) ? entry.messages : [],
  }))

  const archive = {
    format: 'dsh-synapse-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    title: threads[0]?.dshSessionTitle ?? threads[0]?.title ?? 'Synapse Conversation Map',
    sessions,
    cardPositions: [...state.cardPositions.entries()],
    cardNotes: [...state.cardNotes.entries()],
    branchAnchors: [...state.branchAnchors.entries()],
    camera: { ...state.canvasCamera, zoom: state.zoom },
  }

  const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const timestamp = new Date().toISOString().slice(0, 10)
  const rawTitle = threads[0]?.dshSessionTitle ?? threads[0]?.title ?? 'map'
  const cleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '-').slice(0, 24)
  a.href = url
  a.download = `${cleanTitle}-${timestamp}.synapse`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  state.exportModalOpen = false
  render()
}

function exportMapAsSvg() {
  const threads = mapThreads()
  const cards = conversationCards(threads)
  if (cards.length === 0) return setError('当前地图没有卡片可导出')
  const svgText = generateMapSvg(cards, state.cardNotes)
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const timestamp = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `synapse-map-${timestamp}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  state.exportModalOpen = false
  render()
}

function exportMapAsPng() {
  const threads = mapThreads()
  const cards = conversationCards(threads)
  if (cards.length === 0) return setError('当前地图没有卡片可导出')
  const svgText = generateMapSvg(cards, state.cardNotes)
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas')
      const scaleFactor = 2
      canvas.width = img.width * scaleFactor
      canvas.height = img.height * scaleFactor
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(scaleFactor, scaleFactor)
        ctx.drawImage(img, 0, 0)
        canvas.toBlob(pngBlob => {
          if (!pngBlob) return
          const pngUrl = URL.createObjectURL(pngBlob)
          const a = document.createElement('a')
          const timestamp = new Date().toISOString().slice(0, 10)
          a.href = pngUrl
          a.download = `synapse-map-${timestamp}.png`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(pngUrl)
        }, 'image/png')
      }
    } finally {
      URL.revokeObjectURL(url)
      state.exportModalOpen = false
      render()
    }
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    exportMapAsSvg()
  }
  img.src = url
}

async function importSynapseArchive(rawContent) {
  try {
    const data = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent
    if (!data || typeof data !== 'object') throw new Error('无效的地图文件格式')

    const sessions = Array.isArray(data.sessions) ? data.sessions : []
    if (sessions.length === 0 && !data.map) throw new Error('地图文件中没有包含任何会话')

    // 1. Restore sessions
    for (const session of sessions) {
      if (session?.id) {
        state.loadedSessions.set(session.id, {
          messages: Array.isArray(session.messages) ? session.messages : [],
          cachedAt: session.cachedAt ?? Date.now(),
          title: session.title ?? null,
          parentId: session.parentId ?? null,
          sourceSeedLength: Number.isSafeInteger(session.sourceSeedLength) ? session.sourceSeedLength : null,
        })
      }
    }

    // 2. Restore positions, notes, anchors
    if (Array.isArray(data.cardPositions)) {
      for (const item of data.cardPositions) {
        if (Array.isArray(item) && typeof item[0] === 'string' && item[1]) {
          state.cardPositions.set(item[0], item[1])
        }
      }
      persistCardPositions()
    }

    if (Array.isArray(data.cardNotes)) {
      for (const item of data.cardNotes) {
        if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') {
          state.cardNotes.set(item[0], item[1].trim())
        }
      }
      persistCardNotes()
    }

    if (Array.isArray(data.branchAnchors)) {
      for (const item of data.branchAnchors) {
        if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') {
          state.branchAnchors.set(item[0], item[1])
        }
      }
      try { localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors])) } catch { /* ignore */ }
    }

    // 3. Persist and push to server
    persistLoadedSessions()

    // 4. Center and layout
    state.activeId = sessions[0] ? `loaded:${sessions[0].id}` : null
    resetCanvasCamera()
    render()
    return true
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
    return false
  }
}

function conversationCard(card) {
  const active = card.dshThreadId === state.activeId ? 'active' : ''
  const source = card.parentId === null ? 'DSH 会话' : card.turnIndex === 0 ? 'DSH 分支' : '追问'
  const branchSequence = Number.isInteger(card.answer?.sourceSeq) ? ` data-seq="${card.answer.sourceSeq}"` : ''
  const continueButton = card.canContinue === true
    ? `<button class="branch-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${card.id}" title="添加追问" aria-label="为 ${escapeHtml(card.question)} 添加追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
    : ''
  const note = state.cardNotes.get(card.id) ?? ''
  const noteHtml = note ? `<div class="thread-card-note" data-action="edit-note" data-card="${escapeHtml(card.id)}" title="${escapeHtml(note)} (点击修改)"><svg class="note-pin-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.487-.445 2.184a.5.5 0 0 1-.722.146L5.536 10.96 1.854 14.646a.5.5 0 0 1-.708-.708L4.828 10.25 1.42 6.84a.5.5 0 0 1 .146-.722c.697-.413 1.482-.491 2.184-.445.31.02.665.074 1.013.16L7.9 2.7c-.021-.125-.039-.283-.039-.46 0-.43.107-1.023.588-1.503a.5.5 0 0 1 .354-.146z"/></svg><span class="note-text">${escapeHtml(note)}</span><button class="note-delete-btn" type="button" data-action="delete-note" data-card="${escapeHtml(card.id)}" title="删除备注" aria-label="删除备注">×</button></div>` : ''
  return `<article class="thread-card ${active}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:#3478f6">
    <button class="node-handle" data-drag-card="${card.id}" aria-label="拖动 ${escapeHtml(card.question)}" title="拖动卡片"></button>
    <div class="thread-card-head"><span class="topic-dot"></span><button class="thread-title" data-action="select-thread" data-thread="${card.dshThreadId}" title="${escapeHtml(card.question)}">${escapeHtml(card.question)}</button>${continueButton}</div>
    ${noteHtml}
    <div class="thread-meta"><span>${source}</span><span>第 ${card.turnIndex + 1} 轮</span></div>
    <div class="thread-answer">${card.answer === null ? '<p class="thread-answer-empty">等待助手回复</p>' : card.answer.pending && card.answer.text === '' ? '<p class="thread-answer-pending">正在回复</p>' : `${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="thread-answer-pending">正在回复</p>' : ''}`}</div>
    <footer><button data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${card.id}"${branchSequence}>创建分支</button><button data-action="open-dsh" data-thread="${card.dshThreadId}">在 DSH 中打开</button><button data-action="archive-thread" data-thread="${card.dshThreadId}">卸载</button></footer>
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
  if (draft?.kind === 'new') {
    const pos = draft.position ?? firstAvailableCardPosition({ x: 86, y: 82 }, cards.map(c => c.position))
    return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:${pos.x}px;top:${pos.y}px;--thread-color:#3478f6">
      <div class="thread-card-head"><span class="topic-dot"></span><strong>新会话</strong></div>
      <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="在地图中输入第一条消息开启新对话…" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
    </article>`
  }
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>${continuing ? '新的追问' : '新的分支'}</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
}

const MINIMAP_WIDTH = 180
const MINIMAP_HEIGHT = 115

function getMinimapDimensions() {
  const isMobile = (globalThis.innerWidth ?? window.innerWidth ?? 0) <= 560
  return {
    width: isMobile ? 145 : MINIMAP_WIDTH,
    height: isMobile ? 96 : MINIMAP_HEIGHT,
  }
}

function getMinimapMetrics(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null
  const { width: minimapW, height: minimapH } = getMinimapDimensions()
  const PADDING = 140
  const minX = Math.min(...cards.map(c => c.position.x)) - PADDING
  const maxX = Math.max(...cards.map(c => c.position.x + CARD_WIDTH)) + PADDING
  const minY = Math.min(...cards.map(c => c.position.y)) - PADDING
  const maxY = Math.max(...cards.map(c => c.position.y + CARD_HEIGHT)) + PADDING
  const worldWidth = Math.max(800, maxX - minX)
  const worldHeight = Math.max(600, maxY - minY)

  const scale = Math.min(minimapW / worldWidth, minimapH / worldHeight)
  const offsetX = (minimapW - worldWidth * scale) / 2
  const offsetY = (minimapH - worldHeight * scale) / 2

  const vp = document.querySelector('.canvas-viewport')
  const vpWidth = vp instanceof HTMLElement ? vp.clientWidth : (window.innerWidth || 1000)
  const vpHeight = vp instanceof HTMLElement ? vp.clientHeight : (window.innerHeight || 800)

  const viewWorldX = (0 - state.canvasCamera.x) / state.zoom
  const viewWorldY = (0 - state.canvasCamera.y) / state.zoom
  const viewWorldWidth = vpWidth / state.zoom
  const viewWorldHeight = vpHeight / state.zoom

  const vx = Math.max(0, Math.min(minimapW - 8, (viewWorldX - minX) * scale + offsetX))
  const vy = Math.max(0, Math.min(minimapH - 8, (viewWorldY - minY) * scale + offsetY))
  const vw = Math.max(8, Math.min(minimapW, viewWorldWidth * scale))
  const vh = Math.max(6, Math.min(minimapH, viewWorldHeight * scale))

  return {
    minX, maxX, minY, maxY, worldWidth, worldHeight,
    minimapW, minimapH,
    scale, offsetX, offsetY,
    viewfinder: { x: vx, y: vy, w: vw, h: vh },
    vpWidth, vpHeight,
  }
}

function renderMinimap(cards) {
  if (!cards || cards.length === 0) return ''
  if (state.minimapCollapsed) {
    return `<div class="synapse-minimap collapsed"><button type="button" class="minimap-toggle" data-action="toggle-minimap" title="展开小地图导航" aria-label="展开小地图"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1.5A1.5 1.5 0 0 0 0 3v10a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V3a1.5 1.5 0 0 0-1.5-1.5h-13zM1 3a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V3zm10 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5V5z"/></svg></button></div>`
  }

  const metrics = getMinimapMetrics(cards)
  if (!metrics) return ''

  const { minX, minY, scale, offsetX, offsetY, viewfinder } = metrics

  const miniNodes = cards.map(card => {
    const mx = (card.position.x - minX) * scale + offsetX
    const my = (card.position.y - minY) * scale + offsetY
    const mw = Math.max(4, CARD_WIDTH * scale)
    const mh = Math.max(3, CARD_HEIGHT * scale)
    const isActive = card.dshThreadId === state.activeId
    const hasNote = state.cardNotes.has(card.id)
    return `<div class="minimap-node${isActive ? ' active' : ''}${hasNote ? ' has-note' : ''}" style="left:${mx.toFixed(1)}px;top:${my.toFixed(1)}px;width:${mw.toFixed(1)}px;height:${mh.toFixed(1)}px;" title="${escapeHtml(card.question)}"></div>`
  }).join('')

  return `<div class="synapse-minimap" role="region" aria-label="画布缩略图导航">
    <div class="minimap-header">
      <span class="minimap-title">缩略图导航</span>
      <button type="button" class="minimap-toggle-close" data-action="toggle-minimap" title="收起缩略图" aria-label="收起缩略图">×</button>
    </div>
    <div class="minimap-stage" data-minimap-stage>
      ${miniNodes}
      <div class="minimap-viewfinder" style="left:${viewfinder.x.toFixed(1)}px;top:${viewfinder.y.toFixed(1)}px;width:${viewfinder.w.toFixed(1)}px;height:${viewfinder.h.toFixed(1)}px;"></div>
    </div>
  </div>`
}

function updateMinimapViewfinder(cards) {
  const vf = document.querySelector('.minimap-viewfinder')
  if (!(vf instanceof HTMLElement)) return
  const currentCards = cards ?? conversationCards(mapThreads())
  const metrics = getMinimapMetrics(currentCards)
  if (!metrics) return
  vf.style.left = `${metrics.viewfinder.x.toFixed(1)}px`
  vf.style.top = `${metrics.viewfinder.y.toFixed(1)}px`
  vf.style.width = `${metrics.viewfinder.w.toFixed(1)}px`
  vf.style.height = `${metrics.viewfinder.h.toFixed(1)}px`
}

function panCameraToMinimapPoint(clientX, clientY, stage) {
  const cards = conversationCards(mapThreads())
  const metrics = getMinimapMetrics(cards)
  if (!metrics) return
  const rect = stage.getBoundingClientRect()
  const ex = clientX - rect.left
  const ey = clientY - rect.top
  const { minX, minY, scale, offsetX, offsetY, vpWidth, vpHeight } = metrics
  const targetWorldX = minX + (ex - offsetX) / scale
  const targetWorldY = minY + (ey - offsetY) / scale

  state.canvasCamera = {
    x: vpWidth / 2 - targetWorldX * state.zoom,
    y: vpHeight / 2 - targetWorldY * state.zoom,
  }
  applyCanvasTransform()
}

function getVisibleCards(cards) {
  // If there are few cards, render all directly.
  if (cards.length <= 25) return cards
  const vp = typeof document !== 'undefined' ? document.querySelector('.canvas-viewport') : null
  const vpWidth = (vp instanceof HTMLElement && vp.clientWidth > 0) ? vp.clientWidth : (globalThis.innerWidth || 1200)
  const vpHeight = (vp instanceof HTMLElement && vp.clientHeight > 0) ? vp.clientHeight : (globalThis.innerHeight || 800)
  const margin = 600 // generous bounding buffer in world pixels
  const viewLeft = (0 - state.canvasCamera.x) / state.zoom - margin
  const viewTop = (0 - state.canvasCamera.y) / state.zoom - margin
  const viewRight = (vpWidth - state.canvasCamera.x) / state.zoom + margin
  const viewBottom = (vpHeight - state.canvasCamera.y) / state.zoom + margin

  return cards.filter(card => {
    // Always render currently active or edited card
    if (card.dshThreadId === state.activeId || card.id === state.editingNoteCardId) return true
    const cx = card.position.x
    const cy = card.position.y
    return (cx + CARD_WIDTH >= viewLeft && cx <= viewRight && cy + CARD_HEIGHT >= viewTop && cy <= viewBottom)
  })
}

function renderCanvas() {
  const threads = mapThreads()
  if (threads.length === 0 && state.draft?.kind !== 'new') return `<section class="empty-canvas"><strong>地图还没有会话。</strong><p>从左侧历史对话区把一个会话拖到地图上，即可展开它的完整路径节点。</p><div><button class="primary" type="button" data-action="create-session">新建会话</button></div></section>`
  const cards = conversationCards(threads)
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(cards)
    state.canvasViewInitialized = true
  }
  return `<section class="canvas-view"><div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><svg class="connectors">${canvasConnectors(cards)}</svg><div class="cards-layer">${cards.map(conversationCard).join('')}${draftCard(cards)}</div></div>${renderMinimap(cards)}</div></section>`
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

/** Mobile replacement for the desktop drag source: a touch-friendly sheet
 * listing every DSH session that can be loaded into the map. */
function renderSessionPicker() {
  const archived = new Set(state.archivedSessionIds)
  const groups = state.dshWorkspaces.map(workspace => {
    const sessions = (workspace.sessions ?? [])
      .filter(session => !archived.has(session.id))
      .slice()
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    if (sessions.length === 0) return ''
    const rows = sessions.map(session => {
      const loaded = state.loadedSessions.has(session.id)
      const loading = state.sessionPickerLoadingId === session.id
      const title = session.title ?? session.id
      return `<button class="session-picker-item${loaded ? ' loaded' : ''}" type="button" data-action="load-session" data-session-id="${escapeHtml(session.id)}" ${loaded || state.sessionPickerLoadingId !== null ? 'disabled' : ''}>
        <span class="session-picker-dot"></span><span class="session-picker-copy"><strong>${escapeHtml(title)}</strong><small>${loaded ? '已在地图中' : loading ? '正在加载完整对话…' : '点击加载到地图'}</small></span><span class="session-picker-state">${loaded ? '已加载' : loading ? '加载中' : '加载'}</span>
      </button>`
    }).join('')
    return `<section class="session-picker-group"><h3>${escapeHtml(workspace.title)}</h3>${rows}</section>`
  }).filter(Boolean).join('')
  const body = groups || '<div class="session-picker-empty">暂无可加载的对话</div>'
  return `<div class="session-picker" role="dialog" aria-modal="true" aria-labelledby="session-picker-title"><button class="session-picker-backdrop" type="button" data-action="close-session-picker" aria-label="关闭加载对话面板"></button><section class="session-picker-sheet"><header><div><span>会话地图</span><h2 id="session-picker-title">加载对话</h2></div><button type="button" data-action="close-session-picker" aria-label="关闭">×</button></header><div class="session-picker-list">${body}</div></section></div>`
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

function render() {
  const cardScrollTops = new Map()
  for (const answer of document.querySelectorAll('.thread-card[data-thread] .thread-answer')) {
    const card = answer.closest('.thread-card')
    if (card instanceof HTMLElement && typeof card.dataset.thread === 'string') cardScrollTops.set(card.dataset.thread, answer.scrollTop)
  }
  const workspace = state.workspace
  const threads = mapThreads()
  const view = renderCanvas()
  const hasCanvasContent = threads.length > 0 || state.draft?.kind === 'new'
  const newSessionBtn = `<button class="canvas-new-session" data-action="create-session" ${state.draft !== null ? 'disabled' : ''} title="在当前地图中开启新会话"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新建对话</span></button>`
  const canvasTools = hasCanvasContent ? `${newSessionBtn}<button data-action="layout" title="整理节点：自动修复分支连接并重排卡片">整理节点</button><button data-action="focus-active" title="定位到当前会话">定位</button><button data-action="zoom-out" aria-label="缩小">-</button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="放大">+</button><button data-action="sync-forks" title="同步：拉取服务端地图并自动加入新分支">同步</button><button data-action="open-export-modal" title="导出地图资产包或高清图片">导出</button><button data-action="trigger-import" title="导入 .synapse 地图资产包">导入</button><button data-action="clear-map" title="卸载所有已载入会话">清空地图</button>` : `${newSessionBtn}<button data-action="trigger-import" title="导入 .synapse 地图资产包">导入地图</button>`
  const canvasControls = `<div class="canvas-controls"><button class="load-session-button" data-action="open-session-picker">加载对话</button>${canvasTools}</div>`
  const canDeleteMap = state.maps.length > 1
  const mapPicker = `<div class="map-picker" role="group" aria-label="地图书架"><span class="map-picker-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4.75A2.75 2.75 0 0 1 7.75 2H19v17.5H7.75A2.75 2.75 0 0 0 5 22V4.75Z"/><path d="M5 18.5A2.75 2.75 0 0 1 7.75 15.75H19"/></svg></span><label class="map-picker-field"><span>地图书架</span><select data-action="select-map" aria-label="选择地图">${state.maps.map(map => `<option value="${escapeHtml(map.id)}" ${map.id === state.activeMapId ? 'selected' : ''}>${escapeHtml(map.title)}</option>`).join('')}</select></label><button class="map-action-btn" data-action="rename-map" title="重命名当前地图" aria-label="重命名当前地图"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg></button>${canDeleteMap ? `<button class="map-action-btn danger" data-action="delete-map" title="删除当前地图" aria-label="删除当前地图"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}<button class="map-create" data-action="create-map" title="新建地图" aria-label="新建地图"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>`
  app.innerHTML = `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-brand-row"><div class="brand" aria-label="Synapse"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>Synapse</strong></div><button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button></div><button class="new-workspace" type="button" data-action="create-session" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新会话</span></button><div class="sidebar-heading"><span>历史对话</span><span class="sidebar-hint">拖到右侧地图加载</span></div>${renderSessionLibrary()}</aside><header class="topbar"><div class="view-switch" role="group" aria-label="视图切换"><button data-action="close" type="button" aria-pressed="false">对话</button><button class="active" type="button" aria-pressed="true">会话地图</button></div>${mapPicker}${canvasControls}</header><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${view}</section>${state.sessionPickerOpen ? renderSessionPicker() : ''}${renderNoteModal()}${renderContextMenu()}${renderExportModal()}<input type="file" class="synapse-file-input" accept=".synapse,.json" data-action="import-file-selected" style="display:none"></main>`
  installDragging()
  for (const [threadId, scrollTop] of cardScrollTops) {
    const answer = app.querySelector(`.thread-card[data-thread="${CSS.escape(threadId)}"] .thread-answer`)
    if (answer instanceof HTMLElement) answer.scrollTop = scrollTop
  }
  if (state.editingNoteCardId) {
    window.requestAnimationFrame(() => {
      const textarea = app.querySelector('.note-modal textarea')
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }
    })
  }
}

function renderPreservingDetailScroll() {
  render()
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
  updateMinimapViewfinder()
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
  const minimapStage = event.target instanceof Element ? event.target.closest('[data-minimap-stage]') : null
  if (minimapStage instanceof HTMLElement) {
    event.preventDefault()
    panCameraToMinimapPoint(event.clientX, event.clientY, minimapStage)
    const move = moveEvent => {
      panCameraToMinimapPoint(moveEvent.clientX, moveEvent.clientY, minimapStage)
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      deferCanvasRefresh(120)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
    return
  }

  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select, .synapse-minimap')) return
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

app.addEventListener('contextmenu', event => {
  const card = event.target instanceof Element ? event.target.closest('.thread-card[data-card-id]:not(.draft-card)') : null
  if (card instanceof HTMLElement && typeof card.dataset.cardId === 'string') {
    event.preventDefault()
    state.contextMenu = {
      x: event.clientX,
      y: event.clientY,
      cardId: card.dataset.cardId,
      threadId: card.dataset.thread,
    }
    render()
  }
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    let changed = false
    if (state.contextMenu !== null) { state.contextMenu = null; changed = true }
    if (state.editingNoteCardId !== null) { state.editingNoteCardId = null; changed = true }
    if (state.exportModalOpen) { state.exportModalOpen = false; changed = true }
    if (state.sessionPickerOpen) { state.sessionPickerOpen = false; state.sessionPickerLoadingId = null; changed = true }
    if (changed) render()
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && state.editingNoteCardId) {
    const form = document.querySelector('[data-note-form]')
    if (form instanceof HTMLFormElement && document.activeElement?.closest('[data-note-form]')) {
      event.preventDefault()
      const cardId = form.dataset.noteCard
      const text = form.querySelector('textarea')?.value ?? ''
      if (cardId) rememberCardNote(cardId, text)
      state.editingNoteCardId = null
      render()
    }
  }
})

app.addEventListener('click', async event => {
  if (state.contextMenu !== null && !event.target.closest('.synapse-context-menu')) {
    state.contextMenu = null
    render()
  }
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
    if (button.dataset.action === 'create-map') await createMap()
    if (button.dataset.action === 'rename-map') await renameCurrentMap()
    if (button.dataset.action === 'delete-map') await deleteCurrentMap()
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'toggle-session-library') { state.sidebarExpanded = !state.sidebarExpanded; render() }
    if (button.dataset.action === 'toggle-workspace-sessions' && button.dataset.workspaceId !== undefined) {
      const id = button.dataset.workspaceId
      state.expandedWorkspaces.has(id) ? state.expandedWorkspaces.delete(id) : state.expandedWorkspaces.add(id)
      render()
    }
    if (button.dataset.action === 'edit-note' && button.dataset.card !== undefined) {
      state.editingNoteCardId = button.dataset.card
      state.contextMenu = null
      render()
    }
    if (button.dataset.action === 'delete-note' && button.dataset.card !== undefined) {
      removeCardNote(button.dataset.card)
      state.contextMenu = null
      render()
    }
    if (button.dataset.action === 'close-note-modal') {
      state.editingNoteCardId = null
      render()
    }
    if (button.dataset.action === 'open-export-modal') {
      state.exportModalOpen = true
      render()
    }
    if (button.dataset.action === 'close-export-modal') {
      state.exportModalOpen = false
      render()
    }
    if (button.dataset.action === 'export-synapse-archive') {
      exportSynapseArchive()
    }
    if (button.dataset.action === 'export-map-svg') {
      exportMapAsSvg()
    }
    if (button.dataset.action === 'export-map-png') {
      exportMapAsPng()
    }
    if (button.dataset.action === 'trigger-import') {
      const input = document.querySelector('.synapse-file-input')
      if (input instanceof HTMLInputElement) {
        input.value = ''
        input.click()
      }
    }
    if (button.dataset.action === 'toggle-minimap') {
      state.minimapCollapsed = !state.minimapCollapsed
      try { localStorage.setItem(MINIMAP_COLLAPSED_KEY, String(state.minimapCollapsed)) } catch { /* ignore */ }
      render()
    }
    if (button.dataset.action === 'open-session-picker') { state.sessionPickerOpen = true; render() }
    if (button.dataset.action === 'close-session-picker') { state.sessionPickerOpen = false; state.sessionPickerLoadingId = null; render() }
    if (button.dataset.action === 'load-session' && button.dataset.sessionId !== undefined) {
      const sessionId = button.dataset.sessionId
      if (state.loadedSessions.has(sessionId) || state.sessionPickerLoadingId !== null) return
      state.sessionPickerLoadingId = sessionId
      render()
      try {
        const thread = await loadSessionToMap(sessionId, sessionSummaryById(sessionId))
        if (thread === null) throw new Error('无法加载此对话')
        state.activeId = thread.id
        state.mode = 'canvas'
        state.sessionPickerOpen = false
        state.sessionPickerLoadingId = null
        state.error = ''
        resetCanvasCamera()
        render()
        if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
      } catch (error) {
        state.sessionPickerLoadingId = null
        state.sessionPickerOpen = false
        throw error
      }
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
      await repairLoadedSessionConnections()
      resetCardPositions()
      resetCanvasCamera()
      const allCards = conversationCards(mapThreads())
      state.canvasCamera = initialCanvasCamera(allCards, false)
      state.canvasViewInitialized = true
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

app.addEventListener('change', async event => {
  const input = event.target
  if (input instanceof HTMLSelectElement && input.dataset.action === 'select-map') {
    try { await switchMap(input.value) } catch (error) { setError(error) }
    return
  }
  if (input instanceof HTMLInputElement && input.dataset.action === 'import-file-selected') {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      await importSynapseArchive(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    input.value = ''
  }
})

app.addEventListener('drop', async event => {
  const stage = event.target instanceof Element ? event.target.closest('.main-stage') : null
  if (!(stage instanceof HTMLElement)) return
  event.preventDefault()
  stage.classList.remove('is-drag-over')
  setDropTarget(false)

  // Direct file drop (.synapse / .json archive)
  const files = event.dataTransfer?.files
  if (files && files.length > 0 && (files[0].name.endsWith('.synapse') || files[0].name.endsWith('.json'))) {
    try {
      const text = await files[0].text()
      await importSynapseArchive(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    return
  }

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
  if (form.matches('[data-note-form]')) {
    event.preventDefault()
    const cardId = form.dataset.noteCard
    const text = form.querySelector('textarea')?.value ?? ''
    if (cardId) rememberCardNote(cardId, text)
    state.editingNoteCardId = null
    render()
    return
  }
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
      // The profile-shared map library selects the active page for every device.
      void refreshMaps().then(() => loadServerMap()).then(() => {
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

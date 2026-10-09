/**
 * Pure helpers shared by the palette and the Ctrl+[ / Ctrl+] cycle gesture:
 * title projection, relative time, turn count, and the sidebar-faithful
 * ordering/grouping derivation. The canonical order mirrors what the web
 * GUI's left sidebar shows (WorkspaceBrowser default view): workspaces in
 * Host display order, sessions inside each workspace by recency (newest
 * first, id tiebreak — the sidebar's default `updated` order), and
 * unaccounted sessions trailing in recency order. Subagent-origin rows are
 * invisible to both surfaces (they live under parent catalogs); forked /
 * branch conversations (parentId set, ordinary origin) are ordinary rows.
 * Archived and non-current blank sessions are hidden as well.
 * @module @suxeca/dsh-client-ui-session-switcher/client/utils
 */

import type {
  DecoratedSession,
  SessionListStateLike,
  SessionSummaryLike,
  WorkspaceListStateLike,
  WorkspaceViewLike,
} from './port.ts'

/** Display title: the persisted projection, or a placeholder before the first prompt. */
export function titleOf(session: SessionSummaryLike): string {
  const title = session.title ?? session.displayTitle
  if (typeof title === 'string' && title.trim() !== '') return title
  return '未命名对话'
}

/** Coarse relative time in Chinese, falling back to a compact date. */
export function relTime(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * Map a workspace identity to a deterministic color palette index (0..7),
 * or -1 for ungrouped sessions.
 */
export function workspaceColorIndex(workspaceId: string | undefined): number {
  if (workspaceId === undefined || workspaceId.trim() === '') return -1
  let hash = 0
  for (let i = 0; i < workspaceId.length; i++) {
    hash = (hash * 31 + workspaceId.charCodeAt(i)) >>> 0
  }
  return hash % 8
}

/** Golden ratio angle in degrees for maximum hue contrast across adjacent nodes. */
export const GOLDEN_ANGLE = 137.508

/**
 * Compute a distinct hue (0..359.9) for a workspace.
 * When colorMap is supplied, the hue is strictly determined by its sequential index,
 * guaranteeing that every distinct workspace receives a completely unique color,
 * and adjacent workspaces in the list/tree receive maximally contrasting hues.
 * Returns null for ungrouped sessions.
 */
export function getWorkspaceHue(
  workspaceId: string | undefined,
  colorMap?: ReadonlyMap<string, number>,
): number | null {
  if (workspaceId === undefined || workspaceId.trim() === '') return null
  let index = colorMap?.get(workspaceId)
  if (index === undefined) {
    let hash = 0
    for (let i = 0; i < workspaceId.length; i++) {
      hash = (hash * 31 + workspaceId.charCodeAt(i)) >>> 0
    }
    index = hash % 360
  }
  return Math.round(((index * GOLDEN_ANGLE) % 360) * 10) / 10
}

/**
 * Compute the recency freshness level for a timestamp:
 * 0: < 15 minutes (emerald vibrant green)
 * 1: < 1 hour (bright green)
 * 2: < 6 hours (fresh green)
 * 3: < 24 hours (lime/yellow-green)
 * 4: < 3 days (pale green / olive)
 * 5: >= 3 days (neutral dim gray)
 */
export function timeRecencyLevel(ts: number | undefined, now = Date.now()): 0 | 1 | 2 | 3 | 4 | 5 {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return 5
  const diff = Math.max(0, now - ts)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < 15 * minute) return 0
  if (diff < hour) return 1
  if (diff < 6 * hour) return 2
  if (diff < day) return 3
  if (diff < 3 * day) return 4
  return 5
}

/** Session turn count from the sessionStats projection, when present. */
export function turnCountOf(session: SessionSummaryLike): number | undefined {
  const turns = session.projectionValues?.sessionStats?.turns
  return typeof turns === 'number' && Number.isFinite(turns) && turns > 0 ? turns : undefined
}

/** The workspace owning a session id, or undefined when unaccounted. */
export function workspaceIdOwning(
  workspaceItems: readonly WorkspaceViewLike[],
  sessionId: string,
): string | undefined {
  return workspaceItems.find((w) => w.sessionIds.includes(sessionId))?.workspaceId
}

/** Sidebar recency comparator: newest first, session id as the tiebreak. */
function byRecency(a: SessionSummaryLike, b: SessionSummaryLike): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Sidebar visibility rule, mirroring the WorkspaceBrowser derivation
 * (`sessionVisible` in ui-workspace/tree.ts): subagent-origin rows, archived
 * rows, and non-current blank rows are hidden. Forked/branch conversations
 * (parentId set, ordinary origin) are ordinary rows — no parentId check.
 */
function sessionVisible(
  session: SessionSummaryLike,
  currentId: string | undefined,
  archivedIds: ReadonlySet<string>,
): boolean {
  return session.origin !== 'subagent'
    && !archivedIds.has(session.id)
    && (!session.blank || session.id === currentId)
}

/**
 * Resolve the currently active / displayed session ID from the session list snapshot.
 * DSH marks the active session by setting `session.retainedBy.mainView > 0`.
 * Also supports checking the DOM sidebar treeitem aria-selected attribute as a live fallback.
 */
export function currentSessionId(
  sessionsSnap: SessionListStateLike,
  hintId?: string,
): string | undefined {
  if (hintId !== undefined && hintId !== '') return hintId
  if (sessionsSnap.current !== undefined && sessionsSnap.current !== '') return sessionsSnap.current

  const byId = sessionsSnap.byId ?? {}
  // 1. DSH official source of truth: session retained by mainView
  for (const s of Object.values(byId)) {
    if (s !== undefined && (s.retainedBy?.mainView ?? 0) > 0) {
      return s.id
    }
  }

  // 2. Browser DOM fallback: check selected sidebar session item
  if (typeof document !== 'undefined') {
    const el = document.querySelector('[data-row-key^="session:"][aria-selected="true"]')
    if (el) {
      const key = el.getAttribute('data-row-key')
      if (key && key.startsWith('session:')) {
        const id = key.slice('session:'.length)
        if (byId[id] !== undefined) return id
      }
    }
  }

  return undefined
}

/** Default inactivity threshold: 7 days. */
export const DEFAULT_HIDE_DAYS = 7
export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const DEFAULT_STALE_MS = DEFAULT_HIDE_DAYS * MS_PER_DAY

/**
 * Determine if a session is inactive / stale (has not been updated within staleMs).
 * The current session, pinned sessions, and any actively running session are NEVER stale.
 */
export function isStaleSession(
  session: SessionSummaryLike,
  options?: {
    now?: number
    staleMs?: number
    currentId?: string
    pinnedIds?: ReadonlySet<string>
  },
): boolean {
  if (options?.currentId !== undefined && session.id === options.currentId) {
    return false
  }
  if (options?.pinnedIds !== undefined && options.pinnedIds.has(session.id)) {
    return false
  }
  if (session.running) {
    return false
  }
  const now = options?.now ?? Date.now()
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS
  if (typeof session.updatedAt !== 'number' || session.updatedAt <= 0) {
    return true
  }
  return now - session.updatedAt > staleMs
}

/**
 * The sidebar-faithful flat order: workspaces in Host display order, their
 * sessions with pinned ones leading followed by recency order (matching WorkspaceBrowser),
 * then unaccounted sessions trailing. This is the exact visual order the left
 * sidebar shows, so Ctrl+[ / Ctrl+] move up/down the list the user sees on the left.
 */
export function sidebarOrder(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
  options?: { currentId?: string },
): DecoratedSession[] {
  const ids = sessionsSnap.ids ?? []
  const byId = sessionsSnap.byId ?? {}
  const workspaceItems = workspacesSnap.items ?? []
  const archivedIds = new Set(workspacesSnap.archivedSessionIds ?? [])
  const pinnedIds = new Set(workspacesSnap.pinnedSessionIds ?? [])
  const currentId = options?.currentId ?? currentSessionId(sessionsSnap)

  const entries: DecoratedSession[] = []
  const accounted = new Set<string>()
  for (const workspace of workspaceItems) {
    const pinnedMembers: DecoratedSession[] = []
    const normalMembers: DecoratedSession[] = []
    for (const id of workspace.sessionIds) {
      const session = byId[id]
      if (session === undefined) continue
      accounted.add(id)
      if (!sessionVisible(session, currentId, archivedIds)) continue
      const item = { session, workspace }
      if (pinnedIds.has(id)) pinnedMembers.push(item)
      else normalMembers.push(item)
    }
    pinnedMembers.sort((a, b) => byRecency(a.session, b.session))
    normalMembers.sort((a, b) => byRecency(a.session, b.session))
    entries.push(...pinnedMembers, ...normalMembers)
  }
  const pinnedStray: DecoratedSession[] = []
  const normalStray: DecoratedSession[] = []
  for (const id of ids) {
    const session = byId[id]
    if (session === undefined || accounted.has(id)) continue
    if (!sessionVisible(session, currentId, archivedIds)) continue
    const item = { session }
    if (pinnedIds.has(id)) pinnedStray.push(item)
    else normalStray.push(item)
  }
  pinnedStray.sort((a, b) => byRecency(a.session, b.session))
  normalStray.sort((a, b) => byRecency(a.session, b.session))
  entries.push(...pinnedStray, ...normalStray)
  return entries
}

/**
 * Return all visible pinned sessions across all workspaces in order.
 */
export function pinnedSessions(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
  options?: { currentId?: string },
): DecoratedSession[] {
  const ids = workspacesSnap.pinnedSessionIds ?? []
  if (ids.length === 0) return []
  const byId = sessionsSnap.byId ?? {}
  const workspaceItems = workspacesSnap.items ?? []
  const archivedIds = new Set(workspacesSnap.archivedSessionIds ?? [])
  const currentId = options?.currentId ?? currentSessionId(sessionsSnap)

  const sessionWorkspaceMap = new Map<string, WorkspaceViewLike>()
  for (const ws of workspaceItems) {
    for (const sid of ws.sessionIds) {
      sessionWorkspaceMap.set(sid, ws)
    }
  }

  const entries: DecoratedSession[] = []
  for (const id of ids) {
    const session = byId[id]
    if (session === undefined) continue
    if (!sessionVisible(session, currentId, archivedIds)) continue
    entries.push({
      session,
      workspace: sessionWorkspaceMap.get(id),
    })
  }
  return entries
}

/**
 * Global recency order (newest first, id tiebreak): lists all visible sessions
 * sorted strictly by their updatedAt timestamp regardless of workspace boundaries.
 * This puts the most recently active sessions right at the top for instant switching.
 */
export function recencyOrder(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
  options?: { currentId?: string },
): DecoratedSession[] {
  const ids = sessionsSnap.ids ?? []
  const byId = sessionsSnap.byId ?? {}
  const workspaceItems = workspacesSnap.items ?? []
  const archivedIds = new Set(workspacesSnap.archivedSessionIds ?? [])
  const currentId = options?.currentId ?? currentSessionId(sessionsSnap)

  const sessionWorkspaceMap = new Map<string, WorkspaceViewLike>()
  for (const ws of workspaceItems) {
    for (const sid of ws.sessionIds) {
      sessionWorkspaceMap.set(sid, ws)
    }
  }

  const entries: DecoratedSession[] = []
  for (const id of ids) {
    const session = byId[id]
    if (session === undefined) continue
    if (!sessionVisible(session, currentId, archivedIds)) continue
    entries.push({
      session,
      workspace: sessionWorkspaceMap.get(id),
    })
  }
  entries.sort((a, b) => byRecency(a.session, b.session))
  return entries
}

/** Key for the ungrouped bucket in the palette item list. */
export const UNGROUPED_KEY = '__ungrouped__'

/** Options controlling palette ordering and inactive session folding. */
export interface PaletteOptions {
  /** Sort strategy: 'sidebar' preserves left-sidebar workspace order; 'recency' sorts globally newest first. */
  sort?: 'sidebar' | 'recency'
  /** Whether to fold stale sessions into collapsible toggle items. */
  hideStale?: boolean
  /** Timestamp considered "now" (defaults to Date.now()). */
  now?: number
  /** Inactivity threshold in ms (defaults to 7 days). */
  staleMs?: number
  /** Current session ID (never folded). */
  currentId?: string
  /** Set of pinned session IDs (never folded). */
  pinnedIds?: ReadonlySet<string>
  /** Set of group keys currently expanded by the user (e.g. '__all__' or workspaceId). */
  expandedGroups?: ReadonlySet<string>
}

/** One palette list item: a workspace section header, a session row, or a folded toggle item. */
export type PaletteItem =
  | { readonly kind: 'header'; readonly key: string; readonly label: string; readonly count: number }
  | { readonly kind: 'row'; readonly session: SessionSummaryLike; readonly workspace?: WorkspaceViewLike; readonly stale?: boolean }
  | {
      readonly kind: 'folded'
      readonly key: string
      readonly groupKey: string
      readonly count: number
      readonly label: string
      readonly expanded: boolean
    }

/** A flattened row item (type-narrowed). */
export type PaletteRow = Extract<PaletteItem, { readonly kind: 'row' }>

/**
 * The row-only index of a session in a palette list (headers and folded rows skipped),
 * or -1 when the session is absent or no id is given. This is the selection
 * position the palette's keyboard navigation uses.
 */
export function rowIndexOf(
  items: readonly PaletteItem[],
  sessionId: string | undefined,
): number {
  if (sessionId === undefined) return -1
  let row = 0
  for (const item of items) {
    if (item.kind !== 'row') continue
    if (item.session.id === sessionId) return row
    row += 1
  }
  return -1
}

/**
 * The palette list: in management mode, sessions grouped under workspace
 * section headers (sidebar layout); empty sections are skipped. The flat
 * form feeds search and the quick switch view. Supports automatic hiding
 * of older/inactive sessions.
 */
export function paletteItems(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
  view: 'grouped' | 'flat',
  options?: PaletteOptions,
): PaletteItem[] {
  const curId = options?.currentId ?? currentSessionId(sessionsSnap)
  const sortStrategy = options?.sort ?? (view === 'flat' ? 'sidebar' : 'sidebar')
  const baseList = sortStrategy === 'recency'
    ? recencyOrder(sessionsSnap, workspacesSnap, { currentId: curId })
    : sidebarOrder(sessionsSnap, workspacesSnap, { currentId: curId })

  const hideStale = options?.hideStale === true
  const expandedGroups = options?.expandedGroups
  const pinnedIds = options?.pinnedIds ?? new Set(workspacesSnap.pinnedSessionIds ?? [])
  const effectiveOptions: PaletteOptions = { ...options, pinnedIds }

  if (view === 'flat') {
    if (!hideStale) {
      return baseList.map((row) => ({ kind: 'row', ...row }))
    }
    const activeRows: PaletteRow[] = []
    const staleRows: PaletteRow[] = []
    for (const row of baseList) {
      if (isStaleSession(row.session, effectiveOptions)) {
        staleRows.push({ kind: 'row', session: row.session, workspace: row.workspace, stale: true })
      } else {
        activeRows.push({ kind: 'row', session: row.session, workspace: row.workspace, stale: false })
      }
    }
    if (staleRows.length === 0) {
      return activeRows
    }
    const isExpanded = expandedGroups?.has('__all__') === true
    if (isExpanded) {
      return [
        ...activeRows,
        ...staleRows,
        {
          kind: 'folded',
          key: 'folded-__all__',
          groupKey: '__all__',
          count: staleRows.length,
          label: `收起已显示的 ${staleRows.length} 个较早对话`,
          expanded: true,
        },
      ]
    }
    return [
      ...activeRows,
      {
        kind: 'folded',
        key: 'folded-__all__',
        groupKey: '__all__',
        count: staleRows.length,
        label: `已自动隐藏 ${staleRows.length} 个较早对话 (点击展开)`,
        expanded: false,
      },
    ]
  }

  const workspaceItems = workspacesSnap.items ?? []
  const byWorkspace = new Map<string, PaletteRow[]>()
  const stray: PaletteRow[] = []
  for (const row of baseList) {
    const key = row.workspace?.workspaceId
    const stale = hideStale ? isStaleSession(row.session, effectiveOptions) : false
    const item: PaletteRow = { kind: 'row', session: row.session, workspace: row.workspace, stale }
    if (key === undefined) {
      stray.push(item)
    } else {
      const bucket = byWorkspace.get(key)
      if (bucket === undefined) byWorkspace.set(key, [item])
      else bucket.push(item)
    }
  }

  const items: PaletteItem[] = []
  const appendSection = (groupKey: string, label: string, rows: PaletteRow[]): void => {
    if (rows.length === 0) return
    if (!hideStale) {
      items.push({ kind: 'header', key: groupKey, label, count: rows.length })
      items.push(...rows)
      return
    }
    const active = rows.filter((r) => !r.stale)
    const stale = rows.filter((r) => r.stale)
    const isExpanded = expandedGroups?.has(groupKey) === true
    items.push({ kind: 'header', key: groupKey, label, count: rows.length })
    if (isExpanded || stale.length === 0) {
      items.push(...rows)
      if (stale.length > 0) {
        items.push({
          kind: 'folded',
          key: `folded-${groupKey}`,
          groupKey,
          count: stale.length,
          label: `收起已显示的 ${stale.length} 个较早对话`,
          expanded: true,
        })
      }
    } else {
      items.push(...active)
      items.push({
        kind: 'folded',
        key: `folded-${groupKey}`,
        groupKey,
        count: stale.length,
        label: `已自动隐藏 ${stale.length} 个较早对话 (点击展开)`,
        expanded: false,
      })
    }
  }

  for (const workspace of workspaceItems) {
    const rows = byWorkspace.get(workspace.workspaceId)
    if (rows !== undefined) {
      appendSection(workspace.workspaceId, workspace.title, rows)
    }
  }
  if (stray.length > 0) {
    appendSection(UNGROUPED_KEY, '未分组', stray)
  }
  return items
}

/**
 * Archived (non-subagent) sessions for the archived view, recency order.
 * The sidebar hides archived rows everywhere, so this list is flat. Each
 * entry carries its owning workspace when one exists: archiving never
 * touches workspace accounting (the host keeps the `sessionIds` slot), so
 * the pre-archive group is still derivable from the workspace items; only
 * sessions no workspace ever claimed stay ungrouped.
 */
export function archivedSessions(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
): DecoratedSession[] {
  const byId = sessionsSnap.byId ?? {}
  const workspaceItems = workspacesSnap.items ?? []
  const archivedIds = new Set(workspacesSnap.archivedSessionIds ?? [])
  const entries: DecoratedSession[] = []
  for (const id of sessionsSnap.ids ?? []) {
    const session = byId[id]
    if (session === undefined || session.origin === 'subagent') continue
    if (!archivedIds.has(id)) continue
    const workspace = workspaceItems.find((w) => w.sessionIds.includes(id))
    entries.push(workspace === undefined ? { session } : { session, workspace })
  }
  entries.sort((a, b) => byRecency(a.session, b.session))
  return entries
}

/**
 * The cycle-gesture anchor: the current session id when it is itself in the
 * list (forked/branch conversations are list rows), otherwise — e.g. a
 * subagent child that lives under its parent's catalog — the nearest
 * ancestor that is in the list, so Ctrl+[ / Ctrl+] move relative to the row
 * the sidebar highlights.
 */
export function cycleAnchor(
  entries: readonly DecoratedSession[],
  currentId: string | undefined,
  byId: SessionListStateLike['byId'],
): string | undefined {
  if (currentId !== undefined && entries.some((entry) => entry.session.id === currentId)) {
    return currentId
  }
  return cycleAnchorId(currentId, byId)
}

/** Walk subagent lineage up to the root ancestor of a session. */
export function cycleAnchorId(
  currentId: string | undefined,
  byId: SessionListStateLike['byId'],
): string | undefined {
  let id = currentId
  while (id !== undefined) {
    const session = byId[id]
    if (session === undefined) break
    if (session.parentId === undefined) return session.id
    id = session.parentId
  }
  return undefined
}

/**
 * The conversation `offset` positions away from the anchor, wrapping around.
 * A missing anchor lands on the first (positive) or last (negative) entry.
 */
export function offsetTarget(
  entries: readonly DecoratedSession[],
  anchorId: string | undefined,
  offset: number,
): DecoratedSession | undefined {
  if (entries.length === 0) return undefined
  const index = entries.findIndex((e) => e.session.id === anchorId)
  if (index === -1) return offset > 0 ? entries[0] : entries[entries.length - 1]
  return entries[(index + offset + entries.length) % entries.length]
}

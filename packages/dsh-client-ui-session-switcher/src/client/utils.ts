/**
 * Pure helpers shared by the palette and the Ctrl+[ / Ctrl+] cycle gesture:
 * title projection, relative time, turn count, and the sidebar-faithful
 * ordering/grouping derivation. The canonical order mirrors what the web
 * GUI's left sidebar shows (WorkspaceBrowser default view): workspaces in
 * Host display order, sessions inside each workspace by recency (newest
 * first, id tiebreak — the sidebar's default `updated` order), and
 * unaccounted sessions trailing in recency order. Archived, subagent, and
 * non-current blank sessions are invisible to both surfaces.
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

/** Sidebar visibility rule: subagent rows, archived rows, and non-current blank rows are hidden. */
function sessionVisible(
  session: SessionSummaryLike,
  currentId: string | undefined,
  archivedIds: ReadonlySet<string>,
): boolean {
  return session.origin !== 'subagent'
    && session.parentId === undefined
    && !archivedIds.has(session.id)
    && (!session.blank || session.id === currentId)
}

/**
 * The sidebar-faithful flat order: workspaces in Host display order, their
 * sessions by recency (the sidebar's default `updated` view), then
 * unaccounted sessions by recency. This is the exact visual order the left
 * sidebar shows by default, so Ctrl+[ / Ctrl+] move up/down the list the
 * user sees. (Manual drag reorders inside the sidebar are browser-local and
 * are not reflected — the recency order is the default state.)
 */
export function sidebarOrder(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
): DecoratedSession[] {
  const ids = sessionsSnap.ids ?? []
  const byId = sessionsSnap.byId ?? {}
  const workspaceItems = workspacesSnap.items ?? []
  const archivedIds = new Set(workspacesSnap.archivedSessionIds ?? [])
  const currentId = sessionsSnap.current

  const entries: DecoratedSession[] = []
  const accounted = new Set<string>()
  for (const workspace of workspaceItems) {
    const members: DecoratedSession[] = []
    for (const id of workspace.sessionIds) {
      const session = byId[id]
      if (session === undefined) continue
      accounted.add(id)
      if (!sessionVisible(session, currentId, archivedIds)) continue
      members.push({ session, workspace })
    }
    members.sort((a, b) => byRecency(a.session, b.session))
    entries.push(...members)
  }
  const stray: DecoratedSession[] = []
  for (const id of ids) {
    const session = byId[id]
    if (session === undefined || accounted.has(id)) continue
    if (!sessionVisible(session, currentId, archivedIds)) continue
    stray.push({ session })
  }
  stray.sort((a, b) => byRecency(a.session, b.session))
  entries.push(...stray)
  return entries
}

/** Key for the ungrouped bucket in the palette item list. */
export const UNGROUPED_KEY = '__ungrouped__'

/** One palette list item: a workspace section header or a session row. */
export type PaletteItem =
  | { readonly kind: 'header'; readonly key: string; readonly label: string; readonly count: number }
  | { readonly kind: 'row'; readonly session: SessionSummaryLike; readonly workspace?: WorkspaceViewLike }

/** A flattened row item (type-narrowed). */
export type PaletteRow = Extract<PaletteItem, { readonly kind: 'row' }>

/**
 * The palette list: in management mode, sessions grouped under workspace
 * section headers (sidebar layout); empty sections are skipped. The flat
 * form feeds search and the archived view.
 */
export function paletteItems(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
  view: 'grouped' | 'flat',
): PaletteItem[] {
  const flat = sidebarOrder(sessionsSnap, workspacesSnap)
  if (view === 'flat') return flat.map((row) => ({ kind: 'row', ...row }))

  const workspaceItems = workspacesSnap.items ?? []
  const byWorkspace = new Map<string, PaletteRow[]>()
  const stray: PaletteRow[] = []
  for (const row of flat) {
    const key = row.workspace?.workspaceId
    if (key === undefined) {
      stray.push({ kind: 'row', session: row.session })
    } else {
      const bucket = byWorkspace.get(key)
      if (bucket === undefined) byWorkspace.set(key, [{ kind: 'row', session: row.session, workspace: row.workspace }])
      else bucket.push({ kind: 'row', session: row.session, workspace: row.workspace })
    }
  }
  const items: PaletteItem[] = []
  for (const workspace of workspaceItems) {
    const rows = byWorkspace.get(workspace.workspaceId)
    if (rows === undefined || rows.length === 0) continue
    items.push({ kind: 'header', key: workspace.workspaceId, label: workspace.title, count: rows.length })
    items.push(...rows)
  }
  if (stray.length > 0) {
    items.push({ kind: 'header', key: UNGROUPED_KEY, label: '未分组', count: stray.length })
    items.push(...stray)
  }
  return items
}

/**
 * Root (non-subagent) archived sessions for the archived view, recency order.
 * The sidebar hides archived rows everywhere, so this list is flat.
 */
export function archivedSessions(
  sessionsSnap: SessionListStateLike,
  workspacesSnap: WorkspaceListStateLike,
): DecoratedSession[] {
  const byId = sessionsSnap.byId ?? {}
  const archivedIds = new Set(workspacesSnap.archivedSessionIds ?? [])
  const entries: DecoratedSession[] = []
  for (const id of sessionsSnap.ids ?? []) {
    const session = byId[id]
    if (session === undefined || session.parentId !== undefined || session.origin === 'subagent') continue
    if (!archivedIds.has(id)) continue
    entries.push({ session })
  }
  entries.sort((a, b) => byRecency(a.session, b.session))
  return entries
}

/**
 * The cycle-gesture anchor: the current session id, or — when a subagent
 * child is current — its root ancestor id, so Ctrl+[ / Ctrl+] move relative
 * to the row the sidebar highlights.
 */
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

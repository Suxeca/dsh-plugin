/**
 * Local structural ports for the two injected services (inject = sessions,
 * workspaces). The switcher reads the snapshot stores plus the small write
 * surface it calls — deliberately narrower than the upstream contracts: the
 * published 0.1.0-rc.6 typings predate `workspace.unarchiveSession` (added in
 * the harness repo, see PLUGIN-HANDOFF §2.2), so the ports document exactly
 * what this plugin may touch. The runtime instances satisfy these faces; the
 * boundary cast lives in src/client/index.ts.
 * @module @suxeca/dsh-client-ui-session-switcher/client/port
 */

/** Session list row projection (mirrors SessionSummary minus unused fields). */
export interface SessionSummaryLike {
  id: string
  title?: string
  displayTitle: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  blank: boolean
  updatedAt: number
  projectionValues?: { sessionStats?: { turns?: number } }
}

/** Session list store shape (ids + byId — no `items` field on this version). */
export interface SessionListStateLike {
  ids: readonly string[]
  byId: Record<string, SessionSummaryLike | undefined>
  current?: string
  phase: string
}

/** Workspace row projection (mirrors WorkspaceView minus unused fields). */
export interface WorkspaceViewLike {
  workspaceId: string
  title: string
  sessionIds: readonly string[]
}

/** Workspace list store shape. */
export interface WorkspaceListStateLike {
  items: readonly WorkspaceViewLike[]
  archivedSessionIds: readonly string[]
  phase: string
  recentWorkspaceId?: string
}

/** Snapshot store face consumed via useSyncExternalStore. */
export interface SnapshotLike<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
}

/** Session rename answer: { ok, error? } — the rpc result envelope. */
export interface RenameResultLike {
  ok: boolean
  error?: { message?: string }
}

/** The stable session binding (only the rename face is used). */
export interface SessionBindingLike {
  sessionId: string
  session: {
    rename(title: string): Promise<RenameResultLike>
  }
}

/** The sessions service face the switcher calls. */
export interface SessionsPort {
  readonly list: SnapshotLike<SessionListStateLike>
  open(id: string): void
  binding(id: string): SessionBindingLike | undefined
}

/** The workspaces service face the switcher calls (incl. unarchiveSession). */
export interface WorkspacesPort {
  readonly list: SnapshotLike<WorkspaceListStateLike>
  startSession(workspaceId?: string): void
  archiveSession(sessionId: string): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

/** The two injected services, as the switcher consumes them (container form, mirroring ctx.sessions / ctx.workspaces). */
export interface SwitcherContext {
  readonly sessions: SessionsPort
  readonly workspaces: WorkspacesPort
}

/** A root session decorated with its owning workspace (undefined = unaccounted). */
export interface DecoratedSession {
  session: SessionSummaryLike
  workspace?: WorkspaceViewLike
}

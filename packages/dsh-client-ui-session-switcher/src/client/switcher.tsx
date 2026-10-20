/**
 * The quick-switch palette. Reads the sessions/workspaces snapshot stores
 * directly via useSyncExternalStore (both are subscription stores with
 * cached snapshots). Modes: management (shortcuts, workspace-grouped list
 * mirroring the left sidebar), search (S, typing filters a flat list),
 * rename (R). Opening the palette selects the current conversation by
 * default. Skins (深色/浅色/高对比) cycle through the header button and
 * persist in localStorage; the `data-skin` attribute drives the CSS
 * variable palette in switcher.module.css.
 * @module @suxeca/dsh-client-ui-session-switcher/client/switcher
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { OpenStore } from './open-store.ts'
import { type SkinName, loadSkin, nextSkin, saveSkin } from './skins.ts'
import {
  UNGROUPED_KEY,
  archivedSessions,
  currentSessionId,
  cycleAnchor,
  getWorkspaceHue,
  paletteItems,
  recencyOrder,
  relTime,
  rowIndexOf,
  sidebarOrder,
  timeRecencyLevel,
  titleOf,
  turnCountOf,
  workspaceColorIndex,
  workspaceIdOwning,
  type PaletteItem,
  type PaletteRow,
} from './utils.ts'
import type { SwitcherContext } from './port.ts'
import { useSwitcherStrings } from './i18n.ts'
import {
  ACTIONS,
  bindingFromEvent,
  formatBinding,
  isModifierKey,
  matchesBinding,
  type ActionId,
  type KeymapStore,
} from './keymap.ts'
import css from './switcher.module.css'

/** localStorage flag recording the one-time readiness-toast dismissal. */
const TOAST_KEY = 'dsh.sessionSwitcher.toastSeen'
/** localStorage flag recording whether older/inactive sessions are hidden by default. */
const HIDE_OLD_KEY = 'dsh.sessionSwitcher.hideInactive'

export interface SwitcherProps {
  readonly ctx: SwitcherContext
  readonly openStore: OpenStore
  readonly keymapStore: KeymapStore
}

/** Inline keyboard hint chip. */
function Kbd({ children }: { readonly children: string }): JSX.Element {
  return <kbd className={css.kbd}>{children}</kbd>
}

/**
 * The palette component. Both render branches carry the skin attribute on
 * their root so the toast (closed) and the card (open) share one variable
 * palette.
 */
export function Switcher({ ctx, openStore, keymapStore }: SwitcherProps): JSX.Element | null {
  const palette = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot)
  const open = palette.open
  // The sessions list is an arrow-bound SnapshotStore, so binding is optional;
  // workspaces.list is a ClientWorkspaceModel whose getSnapshot/subscribe are
  // prototype methods — extracting them bare makes React call them with an
  // undefined `this` (throws "reading 'refreshSnapshot'"). Wrap both
  // symmetrically so neither store leaks its receiver.
  const sessionsSnap = useSyncExternalStore(
    (listener) => ctx.sessions.list.subscribe(listener),
    () => ctx.sessions.list.getSnapshot(),
  )
  const workspacesSnap = useSyncExternalStore(
    (listener) => ctx.workspaces.list.subscribe(listener),
    () => ctx.workspaces.list.getSnapshot(),
  )
  const keymap = useSyncExternalStore(keymapStore.subscribe, keymapStore.getSnapshot)
  const strings = useSwitcherStrings()
  const [query, setQuery] = useState('')
  /** Selection position within the row-only subsequence (headers are skipped). */
  const [index, setIndex] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [searching, setSearching] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showReadyToast, setShowReadyToast] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TOAST_KEY) !== '1'
    } catch {
      return true
    }
  })
  const [skinName, setSkinName] = useState<SkinName>(loadSkin)
  const [configuring, setConfiguring] = useState(false)
  const [captureAction, setCaptureAction] = useState<ActionId | null>(null)
  const [hideOldSessions, setHideOldSessions] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_OLD_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLInputElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const toggleHideOldSessions = (): void => {
    setHideOldSessions((v) => {
      const next = !v
      try {
        localStorage.setItem(HIDE_OLD_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }

  const toggleGroupExpand = (groupKey: string): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const jumpToPinnedRow = (): void => {
    const pinnedIdx = items.findIndex((it) => it.kind === 'row' && pinnedSet.has(it.session.id))
    if (pinnedIdx !== -1) {
      const rowIdx = rowPositions.indexOf(pinnedIdx)
      if (rowIdx !== -1) setIndex(rowIdx)
    }
  }

  // One-time readiness toast (persisted dismissal), auto-hides.
  useEffect(() => {
    if (!showReadyToast) return
    const timer = setTimeout(() => setShowReadyToast(false), 8000)
    return () => clearTimeout(timer)
  }, [showReadyToast])
  const dismissToast = (): void => {
    setShowReadyToast(false)
    try {
      localStorage.setItem(TOAST_KEY, '1')
    } catch {
      /* storage unavailable */
    }
  }

  // Transient operation errors auto-clear after 4s.
  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(timer)
  }, [error])

  // The sessions list store exposes `ids` + `byId` (entries carry
  // `id`/`displayTitle`/`parentId`); it has no `items` field. The workspaces
  // store exposes `items`. Both are fallback-guarded until the baselines land.
  const workspaceItems = workspacesSnap.items ?? []
  const archivedIds = workspacesSnap.archivedSessionIds ?? []
  const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds])
  const pinnedIds = workspacesSnap.pinnedSessionIds ?? []
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const currentId = useMemo(() => currentSessionId(sessionsSnap), [sessionsSnap])

  /** The workspace owning the current session; falls back to the recent-workspace projection. */
  const currentWorkspaceId = useMemo(() => {
    if (currentId !== undefined) {
      const owner = workspaceIdOwning(workspaceItems, currentId)
      if (owner !== undefined) return owner
    }
    return workspacesSnap.recentWorkspaceId
  }, [currentId, workspaceItems, workspacesSnap.recentWorkspaceId])

  /** Sequential index map per workspace to guarantee every distinct workspace has a unique contrasting color. */
  const workspaceColorMap = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const w of workspaceItems) {
      if (!map.has(w.workspaceId)) {
        map.set(w.workspaceId, idx++)
      }
    }
    return map
  }, [workspaceItems])

  /**
   * The palette list.
   * Search mode presents conversations ordered globally by recency so recent
   * items appear immediately at the top without long scrolls. Older/inactive
   * sessions are folded into an expandable item when hideOldSessions is true
   * (non-empty queries automatically bypass folding to search all conversations).
   * Management mode groups conversations by workspace with section folding.
   */
  const items = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase()
      const rows = paletteItems(sessionsSnap, workspacesSnap, 'flat', {
        sort: 'recency',
        hideStale: q === '' ? hideOldSessions : false,
        currentId,
        expandedGroups,
      }).filter((item) => (
        item.kind === 'folded' || (item.kind === 'row' && (q === '' || titleOf(item.session).toLowerCase().includes(q)))
      ))
      return rows
    }
    if (showArchived) {
      return archivedSessions(sessionsSnap, workspacesSnap).map((row) => (
        { kind: 'row', ...row } as const
      ))
    }
    return paletteItems(sessionsSnap, workspacesSnap, 'grouped', {
      hideStale: hideOldSessions,
      currentId,
      expandedGroups,
    })
  }, [sessionsSnap, workspacesSnap, searching, query, showArchived, hideOldSessions, expandedGroups, currentId])

  /** Item positions holding a session row, in list order. */
  const rowPositions = useMemo(
    () => items.reduce<number[]>((acc, item, pos) => {
      if (item.kind === 'row') acc.push(pos)
      return acc
    }, []),
    [items],
  )
  const selected = index < rowPositions.length ? items[rowPositions[index]] as PaletteRow : null

  // Reset transient state each time the palette opens; select the current
  // conversation by default and focus the filter.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setShowArchived(false)
    // Default to search mode: the palette opens with the filter focused so
    // typing immediately filters conversations (search-as-you-type).
    setSearching(true)
    setRenameId(null)
    setError(null)
    setConfiguring(false)
    setCaptureAction(null)
    if (keymapStore.getSnapshot().capturing) keymapStore.endCapture()
    const initialList = paletteItems(sessionsSnap, workspacesSnap, 'flat', {
      sort: 'recency',
      hideStale: hideOldSessions,
      currentId,
      expandedGroups,
    })
    const anchor = cycleAnchor(
      recencyOrder(sessionsSnap, workspacesSnap),
      currentId,
      sessionsSnap.byId,
    )
    const rowIndex = rowIndexOf(initialList, anchor)
    setIndex(rowIndex === -1 ? 0 : rowIndex)
    cardRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate open-transition snapshot read
  }, [open])

  // Entering search focuses the filter; rename focuses its editor.
  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])
  useEffect(() => {
    if (renameId !== null) renameRef.current?.focus()
  }, [renameId])

  // Clamp the selection when the list shrinks.
  useEffect(() => {
    setIndex((i) => (rowPositions.length === 0 ? 0 : Math.min(i, rowPositions.length - 1)))
  }, [rowPositions.length])

  // Keep the selected row visible: keyboard navigation (and the open-time
  // jump to the current conversation) can drive the selection past the
  // list's viewport. `block: nearest` scrolls only the list itself.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, index])

  const openSession = (sessionId: string): void => {
    if (ctx.uiWorkspace?.openSession) {
      ctx.uiWorkspace.openSession(sessionId)
    } else if (ctx.sessions.open) {
      ctx.sessions.open(sessionId)
    }
    openStore.close()
  }
  /** Space-preview the selected conversation: switch to it WITHOUT leaving
   *  the palette interaction — Esc restores the previous session and returns
   *  to the card; Enter confirms the switch. Archived sessions work the same
   *  (sessions.open addresses them; only the sidebar hides them). */
  const startPreview = (): void => {
    if (selected === null) return
    const fromId = currentId
    openStore.enterPreview(selected.session.id, fromId)
    if (ctx.uiWorkspace?.openSession) {
      ctx.uiWorkspace.openSession(selected.session.id)
    } else if (ctx.sessions.open) {
      ctx.sessions.open(selected.session.id)
    }
  }
  const newConversation = (): void => {
    try {
      if (ctx.uiWorkspace?.startSession) {
        ctx.uiWorkspace.startSession(currentWorkspaceId)
      } else if (ctx.workspaces.startSession) {
        ctx.workspaces.startSession(currentWorkspaceId)
      } else {
        throw new Error(strings.noNewSession)
      }
    } catch (err) {
      setError(strings.newSessionFailed(err instanceof Error ? err.message : String(err)))
    }
    openStore.close()
  }
  const archiveSession = (sessionId: string): void => {
    const p = ctx.uiWorkspace?.archiveSession
      ? ctx.uiWorkspace.archiveSession(sessionId)
      : ctx.workspaces.archiveSession(sessionId)
    void p.catch((err) => {
      setError(strings.archiveFailed(err instanceof Error ? err.message : String(err)))
    })
  }
  const unarchiveSession = (sessionId: string): void => {
    const p = ctx.uiWorkspace?.unarchiveSession
      ? ctx.uiWorkspace.unarchiveSession(sessionId)
      : ctx.workspaces.unarchiveSession(sessionId)
    void p.catch((err) => {
      setError(strings.unarchiveFailed(err instanceof Error ? err.message : String(err)))
    })
  }
  const startRename = (sessionId: string): void => {
    const entry = sessionsSnap.byId?.[sessionId]
    setRenameDraft(entry === undefined ? '' : titleOf(entry))
    setRenameId(sessionId)
  }
  const cancelRename = (): void => {
    setRenameId(null)
    setRenameDraft('')
    cardRef.current?.focus()
  }
  const saveRename = async (): Promise<void> => {
    const id = renameId
    const title = renameDraft.trim()
    cancelRename()
    if (id === null || title === '') return
    try {
      if (typeof ctx.sessions.using === 'function') {
        const result = await ctx.sessions.using(
          id,
          { source: 'controllerOperation' },
          (ref) => ref.binding.session.rename(title),
        )
        if (!result.ok) throw new Error(result.error?.message ?? strings.renameRejected)
      } else {
        const binding = ctx.sessions.binding(id)
        const session = binding?.session
        if (session === undefined) throw new Error(strings.renameOffline)
        const result = await session.rename(title)
        if (!result.ok) throw new Error(result.error?.message ?? strings.renameRejected)
      }
    } catch (err) {
      setError(strings.renameFailed(err instanceof Error ? err.message : String(err)))
    }
  }
  const enterSearch = (): void => {
    setQuery('')
    setSearching(true)
  }
  const exitSearch = (): void => {
    setQuery('')
    setSearching(false)
    cardRef.current?.focus()
  }
  const cycleSkin = (): void => {
    const next = nextSkin(skinName)
    setSkinName(next)
    saveSkin(next)
  }
  const openSettings = (): void => {
    setConfiguring(true)
    setSearching(false)
    setQuery('')
    cardRef.current?.focus()
  }
  const closeSettings = (): void => {
    setConfiguring(false)
    setCaptureAction(null)
    cardRef.current?.focus()
  }
  const startCapture = (action: ActionId): void => {
    setCaptureAction(action)
    keymapStore.beginCapture()
    cardRef.current?.focus()
  }
  const cancelCapture = (): void => {
    setCaptureAction(null)
    keymapStore.endCapture()
    cardRef.current?.focus()
  }

  if (!open) {
    // Closed — or mid preview: hide EVERYTHING (the one-time readiness toast
    // would otherwise float over the conversation being previewed). The
    // Esc/Enter key handling for preview lives in the global keydown handler.
    if (palette.preview || !showReadyToast) return null
    return (
      <div className={`${css.root} ${css.wrapper}`} data-skin={skinName}>
        <div className={css.toast} onClick={dismissToast}>
          {strings.toastReady}
        </div>
      </div>
    )
  }

  const hasArchived = archivedIds.length > 0
  const renaming = renameId !== null

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (captureAction !== null) {
      // Rebinding: the next non-modifier chord becomes the new binding.
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelCapture()
      } else if (!isModifierKey(e.key)) {
        e.preventDefault()
        keymapStore.set(captureAction, bindingFromEvent(e))
        setCaptureAction(null)
      }
      return
    }
    if (configuring) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSettings()
      }
      return
    }
    if (renaming) {
      // Rename editor owns the keys: Enter saves, Escape cancels, everything
      // else edits the draft.
      if (e.key === 'Enter') {
        e.preventDefault()
        void saveRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelRename()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, rowPositions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selected !== null) openSession(selected.session.id)
    } else if (!searching && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ' ') {
      // Space previews the selected conversation (suppressed while searching
      // so the filter box can type spaces).
      e.preventDefault()
      startPreview()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (searching) {
        if (query !== '') setQuery('')
        else exitSearch()
      } else if (showArchived) {
        setShowArchived(false)
      } else {
        openStore.close()
      }
    } else if (matchesBinding(keymap.bindings.toggle, e)) {
      e.preventDefault()
      openStore.close()
    } else if (searching) {
      // Search mode chords: quick actions available without leaving the filter.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newConversation()
      } else if (((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') || e.key === 'F2') {
        e.preventDefault()
        if (selected !== null) startRename(selected.session.id)
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (selected !== null) archiveSession(selected.session.id)
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        toggleHideOldSessions()
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        jumpToPinnedRow()
      }
    } else if (!searching && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Management mode: single letters are actions, never input.
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        enterSearch()
      } else if (k === 'n') {
        e.preventDefault()
        newConversation()
      } else if (k === 'p') {
        e.preventDefault()
        jumpToPinnedRow()
      } else if (k === 'a' && !showArchived) {
        e.preventDefault()
        if (selected !== null) archiveSession(selected.session.id)
      } else if (k === 'u' && showArchived) {
        e.preventDefault()
        if (selected !== null) unarchiveSession(selected.session.id)
      } else if (k === 't' && (hasArchived || showArchived)) {
        e.preventDefault()
        setShowArchived((v) => !v)
      } else if (k === 'r') {
        e.preventDefault()
        if (selected !== null) startRename(selected.session.id)
      } else if (k === 'h') {
        e.preventDefault()
        toggleHideOldSessions()
      } else if (k === 'k') {
        e.preventDefault()
        openSettings()
      }
    }
  }

  const renderRow = (row: PaletteRow, rowIndex: number): JSX.Element => {
    const session = row.session
    const wsId = row.workspace?.workspaceId
    const hue = getWorkspaceHue(wsId, workspaceColorMap)
    const isColored = hue !== null
    const wsStyle = isColored ? ({ '--ws-h': hue } as React.CSSProperties) : undefined
    const wsClass = isColored ? `${css.wsTag} ${css.wsTagColored}` : `${css.wsTag} ${css.wsTagUngrouped}`
    const wsLabel = row.workspace === undefined ? strings.ungrouped : row.workspace.title

    const turns = turnCountOf(session)
    const timeLevel = timeRecencyLevel(session.updatedAt)
    const timeClassKey = `timeL${timeLevel}`
    const timeString = relTime(session.updatedAt)

    const isCurrent = session.id === currentId
    const archived = archivedSet.has(session.id)
    const isPinned = pinnedSet.has(session.id)
    return (
      <div
        key={session.id}
        data-row-index={rowIndex}
        className={rowIndex === index ? `${css.row} ${css.rowSelected}` : css.row}
        onMouseEnter={() => setIndex(rowIndex)}
        onClick={() => openSession(session.id)}
      >
        <span className={session.running ? css.dot : `${css.dot} ${css.dotIdle}`} />
        <div className={css.main}>
          <div className={css.rowTitle}>{titleOf(session)}</div>
          <div className={css.rowMeta}>
            <span className={wsClass} style={wsStyle}>
              {wsLabel}
            </span>
            {turns !== undefined && (
              <>
                <span className={css.metaDivider}>·</span>
                <span className={css.metaItem}>{strings.turns(turns)}</span>
              </>
            )}
            {timeString !== '' && (
              <>
                <span className={css.metaDivider}>·</span>
                <span className={`${css.timeBadge} ${css[timeClassKey]}`}>
                  {timeLevel <= 1 && <span className={css.liveDot} />}
                  {timeString}
                </span>
              </>
            )}
          </div>
        </div>
        {isCurrent && <span className={`${css.tag} ${css.tagCurrent}`}>{strings.current}</span>}
        {isPinned && <span className={`${css.tag} ${css.tagPinned}`}>{strings.pinned}</span>}
        {archived && <span className={css.tag}>{strings.archived}</span>}
        <button
          type="button"
          className={css.rowAction}
          onClick={(e) => {
            e.stopPropagation()
            startRename(session.id)
          }}
          title={strings.renameTitle}
        >
          {strings.rowRename}
        </button>
        {archived ? (
          <button
            type="button"
            className={css.rowAction}
            onClick={(e) => {
              e.stopPropagation()
              unarchiveSession(session.id)
            }}
          >
            {strings.rowUnarchive}
          </button>
        ) : (
          <button
            type="button"
            className={`${css.rowAction} ${css.rowActionDanger}`}
            onClick={(e) => {
              e.stopPropagation()
              archiveSession(session.id)
            }}
          >
            {strings.rowArchive}
          </button>
        )}
      </div>
    )
  }

  let body: JSX.Element
  if (configuring) {
    body = (
      <div className={css.settings}>
        <div className={css.officialShortcutsBar}>
          <button
            type="button"
            className={css.officialShortcutsBtn}
            onClick={() => {
              openStore.close()
              ctx.openOfficialShortcuts?.()
            }}
          >
            {strings.officialShortcutsBtn}
          </button>
        </div>
        <div className={css.settingsHint}>
          {strings.settingsHint}
        </div>
        {ACTIONS.map((action) => {
          const binding = keymap.bindings[action]
          const active = captureAction === action
          return (
            <div key={action} className={css.settingsRow}>
              <span className={css.settingsLabel}>{strings.actionLabels[action]}</span>
              {active ? (
                <span className={css.captureHint}>{strings.captureHint}</span>
              ) : (
                <>
                  <kbd className={css.kbd}>{formatBinding(binding)}</kbd>
                  <button
                    type="button"
                    className={css.rowAction}
                    onClick={() => startCapture(action)}
                  >
                    {strings.changeKey}
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  } else if (workspacesSnap.phase !== 'ready' || sessionsSnap.phase !== 'ready') {
    body = <div className={css.empty}>{strings.loading}</div>
  } else if (rowPositions.length === 0) {
    body = (
      <div className={css.empty}>
        {searching
          ? strings.noMatches
          : showArchived
            ? strings.noArchived
            : workspaceItems.length === 0
              ? strings.noWorkspaces
              : strings.noConversations}
      </div>
    )
  } else {
    let rowCursor = 0
    body = (
      <div className={css.list} ref={listRef}>
        {items.map((item) => {
          if (item.kind === 'header') {
            const wsId = item.key === UNGROUPED_KEY ? undefined : item.key
            const hue = getWorkspaceHue(wsId, workspaceColorMap)
            const isColored = hue !== null
            const wsStyle = isColored ? ({ '--ws-h': hue } as React.CSSProperties) : undefined
            const wsClass = isColored ? `${css.wsTag} ${css.wsTagColored}` : `${css.wsTag} ${css.wsTagUngrouped}`
            return (
              <div key={item.key} className={css.groupHeader}>
                <span className={wsClass} style={wsStyle}>{item.label}</span>
                <span className={css.groupCount}>{item.count}</span>
              </div>
            )
          }
          if (item.kind === 'folded') {
            return (
              <div
                key={item.key}
                className={css.foldedRow}
                onClick={() => toggleGroupExpand(item.groupKey)}
                title={item.expanded ? strings.collapseOlderTitle : strings.expandOlderTitle}
              >
                <span className={css.foldedIcon}>{item.expanded ? '▼' : '▶'}</span>
                <span className={css.foldedLabel}>{item.label}</span>
              </div>
            )
          }
          const rowIndex = rowCursor
          rowCursor += 1
          return renderRow(item, rowIndex)
        })}
      </div>
    )
  }

  const toggleLabel = formatBinding(keymap.bindings.toggle)
  const hasPinned = pinnedIds.length > 0
  const hint = configuring ? (
    <div className={css.footer}>
      <span className={css.footerAction}><Kbd>Esc</Kbd>{strings.close}</span>
    </div>
  ) : searching ? (
    <div className={css.footer}>
      <span className={css.footerAction}><Kbd>↑↓</Kbd>{strings.select}<Kbd>Enter</Kbd>{strings.open}</span>
      <span className={css.footerAction}><Kbd>Ctrl+N</Kbd>{strings.newShort}</span>
      <span className={css.footerAction}><Kbd>Ctrl+R</Kbd>{strings.renameShort}</span>
      <span className={css.footerAction}><Kbd>Alt+A</Kbd>{strings.archiveShort}</span>
      {hasPinned && <span className={css.footerAction}><Kbd>Alt+P</Kbd>{strings.pinnedShort}</span>}
      <span className={css.footerAction}><Kbd>Alt+H</Kbd>{hideOldSessions ? strings.showAll : strings.recentOnly}</span>
      <span className={css.footerAction}><Kbd>Esc</Kbd>{query ? strings.clear : strings.manageMode}</span>
    </div>
  ) : (
    <div className={css.footer}>
      <span className={css.footerAction}><Kbd>↑↓</Kbd>{strings.select}<Kbd>Enter</Kbd>{strings.open}</span>
      <span className={css.footerAction}><Kbd>{strings.space}</Kbd>{strings.preview}</span>
      <span className={css.footerAction}><Kbd>S</Kbd>{strings.search}</span>
      <span className={css.footerAction}><Kbd>N</Kbd>{strings.newShort}</span>
      {hasPinned && <span className={css.footerAction}><Kbd>P</Kbd>{strings.pinnedShort}</span>}
      {showArchived ? (
        <>
          <span className={css.footerAction}><Kbd>U</Kbd>{strings.rowUnarchive}</span>
          <span className={css.footerAction}><Kbd>T</Kbd>{strings.backToList}</span>
        </>
      ) : (
        <>
          <span className={css.footerAction}><Kbd>A</Kbd>{strings.archiveShort}</span>
          {hasArchived && <span className={css.footerAction}><Kbd>T</Kbd>{strings.archivedView}</span>}
        </>
      )}
      <span className={css.footerAction}><Kbd>R</Kbd>{strings.renameShort}</span>
      <span className={css.footerAction}><Kbd>H</Kbd>{hideOldSessions ? strings.showAll : strings.recentOnly}</span>
      <span className={css.footerAction}><Kbd>K</Kbd>{strings.shortcuts}</span>
      <span className={css.footerAction}><Kbd>Esc</Kbd>{showArchived ? strings.backToList : strings.close}</span>
      <span className={`${css.footerAction} ${css.footerPush}`}>
        <Kbd>{toggleLabel}</Kbd>{strings.toggle}
      </span>
    </div>
  )

  const strip = configuring ? null : renaming ? (
    <div className={css.renameBar}>
      <input
        ref={renameRef}
        className={css.renameInput}
        value={renameDraft}
        placeholder={strings.renamePlaceholder}
        onChange={(e) => setRenameDraft(e.target.value)}
      />
      <button type="button" className={css.rowAction} onClick={() => void saveRename()}>{strings.save}</button>
      <button type="button" className={css.rowAction} onClick={cancelRename}>{strings.cancel}</button>
    </div>
  ) : searching ? (
    <input
      ref={inputRef}
      className={css.input}
      placeholder={strings.searchPlaceholder}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  ) : (
    <button type="button" className={css.searchStrip} onClick={enterSearch}>
      {strings.searchStrip}
    </button>
  )

  return (
    <div
      className={`${css.root} ${css.overlay}`}
      data-skin={skinName}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) openStore.close()
      }}
    >
      <div ref={cardRef} tabIndex={-1} className={css.card} onKeyDown={onKeyDown}>
        <div className={css.header}>
          <span className={css.title}>{strings.title}</span>
          {showArchived && <span className={css.modeTag}>{strings.modeArchived}</span>}
          {searching && <span className={css.modeTag}>{strings.search}</span>}
          {renaming && <span className={css.modeTag}>{strings.modeRename}</span>}
          {configuring && <span className={css.modeTag}>{strings.modeShortcuts}</span>}
          <button
            type="button"
            className={`${css.skinButton} ${hideOldSessions ? css.activeButton : ''}`}
            onClick={toggleHideOldSessions}
            title={hideOldSessions ? strings.hideOldTitleRecent : strings.hideOldTitleAll}
          >
            {hideOldSessions ? strings.hideOldRecent : strings.hideOldAll}
          </button>
          <button
            type="button"
            className={css.skinButton}
            onClick={configuring ? closeSettings : openSettings}
            title={strings.settingsTitle}
          >
            ⚙
          </button>
          <button
            type="button"
            className={css.skinButton}
            onClick={cycleSkin}
            title={strings.skinTitle}
          >
            {strings.skinLabels[skinName]}
          </button>
          <button type="button" className={css.newButton} onClick={newConversation}>{strings.newConversation}</button>
        </div>
        {strip}
        {body}
        {error !== null && <div className={css.errorLine}>{error}</div>}
        {hint}
      </div>
    </div>
  )
}

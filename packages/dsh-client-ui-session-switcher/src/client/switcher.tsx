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
import { SKIN_LABELS, type SkinName, loadSkin, nextSkin, saveSkin } from './skins.ts'
import {
  archivedSessions,
  cycleAnchor,
  paletteItems,
  relTime,
  rowIndexOf,
  sidebarOrder,
  titleOf,
  turnCountOf,
  workspaceIdOwning,
  type PaletteRow,
} from './utils.ts'
import type { SwitcherContext } from './port.ts'
import {
  ACTIONS,
  ACTION_LABELS,
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
  const sessionsSnap = useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot)
  const workspacesSnap = useSyncExternalStore(ctx.workspaces.list.subscribe, ctx.workspaces.list.getSnapshot)
  const keymap = useSyncExternalStore(keymapStore.subscribe, keymapStore.getSnapshot)
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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

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
  const currentId = sessionsSnap.current

  /** The workspace owning the current session; falls back to the recent-workspace projection. */
  const currentWorkspaceId = useMemo(() => {
    if (currentId !== undefined) {
      const owner = workspaceIdOwning(workspaceItems, currentId)
      if (owner !== undefined) return owner
    }
    return workspacesSnap.recentWorkspaceId
  }, [currentId, workspaceItems, workspacesSnap.recentWorkspaceId])

  /**
   * The palette list. Management mode mirrors the sidebar: workspace section
   * headers with their sessions (recency order). Search and the archived
   * view are flat lists, matching the sidebar's flat surfaces.
   */
  const items = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase()
      const rows = paletteItems(sessionsSnap, workspacesSnap, 'flat').filter((item) => (
        item.kind === 'row' && (q === '' || titleOf(item.session).toLowerCase().includes(q))
      ))
      return rows
    }
    if (showArchived) {
      return archivedSessions(sessionsSnap, workspacesSnap).map((row) => (
        { kind: 'row', ...row } as const
      ))
    }
    return paletteItems(sessionsSnap, workspacesSnap, 'grouped')
  }, [sessionsSnap, workspacesSnap, searching, query, showArchived])

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
  // conversation by default and focus the card so management-mode shortcuts
  // land on the panel. The selection is computed against the RESET
  // management list, never the stale search/archive list still in scope for
  // this render: closing the palette from search or the archived view leaves
  // those flags set, and the pre-reset list would miss the current
  // conversation (landing on row 0) while the reset re-renders the
  // management list with the selection stuck there.
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
    const management = paletteItems(sessionsSnap, workspacesSnap, 'grouped')
    // Anchor on the current session, or its nearest listed ancestor when the
    // current row is palette-invisible (subagent children) — the same anchor
    // the Ctrl+[ / Ctrl+] cycle gesture uses.
    const anchor = cycleAnchor(
      sidebarOrder(sessionsSnap, workspacesSnap),
      currentId,
      sessionsSnap.byId,
    )
    const rowIndex = rowIndexOf(management, anchor)
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
    ctx.sessions.open(sessionId)
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
    ctx.sessions.open(selected.session.id)
  }
  const newConversation = (): void => {
    try {
      ctx.workspaces.startSession(currentWorkspaceId)
    } catch (err) {
      setError(`新建会话失败：${err instanceof Error ? err.message : String(err)}`)
    }
    openStore.close()
  }
  const archiveSession = (sessionId: string): void => {
    void ctx.workspaces.archiveSession(sessionId).catch((err) => {
      setError(`归档失败：${err instanceof Error ? err.message : String(err)}`)
    })
  }
  const unarchiveSession = (sessionId: string): void => {
    void ctx.workspaces.unarchiveSession(sessionId).catch((err) => {
      setError(`取消归档失败：${err instanceof Error ? err.message : String(err)}`)
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
      const binding = ctx.sessions.binding(id)
      const session = binding?.session
      if (session === undefined) throw new Error('会话不在线，无法重命名')
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error?.message ?? '重命名被拒绝')
    } catch (err) {
      setError(`重命名失败：${err instanceof Error ? err.message : String(err)}`)
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
          会话切换器已就绪 — Ctrl+Shift+K（Ctrl+K / Alt+K）打开面板
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
      if (searching) exitSearch()
      else openStore.close()
    } else if (matchesBinding(keymap.bindings.toggle, e)) {
      e.preventDefault()
      openStore.close()
    } else if (!searching && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Management mode: single letters are actions, never input.
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        enterSearch()
      } else if (k === 'n') {
        e.preventDefault()
        newConversation()
      } else if (k === 'a') {
        e.preventDefault()
        if (selected !== null) archiveSession(selected.session.id)
      } else if (k === 'u' && showArchived) {
        e.preventDefault()
        if (selected !== null) unarchiveSession(selected.session.id)
      } else if (k === 't' && hasArchived) {
        e.preventDefault()
        setShowArchived((v) => !v)
      } else if (k === 'r') {
        e.preventDefault()
        if (selected !== null) startRename(selected.session.id)
      } else if (k === 'k') {
        e.preventDefault()
        openSettings()
      }
    }
  }

  const renderRow = (row: PaletteRow, rowIndex: number): JSX.Element => {
    const session = row.session
    const turns = turnCountOf(session)
    const meta = [
      row.workspace === undefined ? '未分组' : row.workspace.title,
      turns === undefined ? null : `${turns} 轮`,
      relTime(session.updatedAt),
    ].filter(Boolean).join(' · ')
    const isCurrent = session.id === currentId
    const archived = archivedSet.has(session.id)
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
          <div className={css.rowMeta}>{meta}</div>
        </div>
        {isCurrent && <span className={`${css.tag} ${css.tagCurrent}`}>当前</span>}
        {archived && <span className={css.tag}>已归档</span>}
        {archived ? (
          <button
            type="button"
            className={css.rowAction}
            onClick={(e) => {
              e.stopPropagation()
              unarchiveSession(session.id)
            }}
          >
            取消归档
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
            归档
          </button>
        )}
      </div>
    )
  }

  let body: JSX.Element
  if (configuring) {
    body = (
      <div className={css.settings}>
        <div className={css.settingsHint}>
          点「改键」后直接按下新组合键即可覆盖，Esc 取消。Alt+K 始终可打开面板（不可改）。
        </div>
        {ACTIONS.map((action) => {
          const binding = keymap.bindings[action]
          const active = captureAction === action
          return (
            <div key={action} className={css.settingsRow}>
              <span className={css.settingsLabel}>{ACTION_LABELS[action]}</span>
              {active ? (
                <span className={css.captureHint}>按下新组合键…（Esc 取消）</span>
              ) : (
                <>
                  <kbd className={css.kbd}>{formatBinding(binding)}</kbd>
                  <button
                    type="button"
                    className={css.rowAction}
                    onClick={() => startCapture(action)}
                  >
                    改键
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  } else if (workspacesSnap.phase !== 'ready' || sessionsSnap.phase !== 'ready') {
    body = <div className={css.empty}>加载中…</div>
  } else if (rowPositions.length === 0) {
    body = (
      <div className={css.empty}>
        {searching
          ? '没有匹配的对话'
          : showArchived
            ? '没有已归档的对话'
            : workspaceItems.length === 0
              ? '还没有工作区 — 按 N 新建，或在侧边栏添加工作区'
              : '还没有对话 — 按 N 新建'}
      </div>
    )
  } else {
    let rowCursor = 0
    body = (
      <div className={css.list} ref={listRef}>
        {items.map((item) => {
          if (item.kind === 'header') {
            return (
              <div key={item.key} className={css.groupHeader}>
                <span className={css.groupLabel}>{item.label}</span>
                <span className={css.groupCount}>{item.count}</span>
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
  const hint = configuring ? (
    <div className={css.footer}>
      <span className={css.footerAction}><Kbd>Esc</Kbd>返回</span>
    </div>
  ) : searching ? (
    <div className={css.footer}>
      <span className={css.footerAction}><Kbd>输入</Kbd>过滤标题</span>
      <span className={css.footerAction}><Kbd>Enter</Kbd>打开</span>
      <span className={css.footerAction}><Kbd>Esc</Kbd>返回管理</span>
    </div>
  ) : (
    <div className={css.footer}>
      <span className={css.footerAction}><Kbd>↑↓</Kbd>选择<Kbd>Enter</Kbd>打开</span>
      <span className={css.footerAction}><Kbd>空格</Kbd>预览</span>
      <span className={css.footerAction}><Kbd>S</Kbd>搜索</span>
      <span className={css.footerAction}><Kbd>N</Kbd>新建</span>
      <span className={css.footerAction}><Kbd>A</Kbd>归档</span>
      <span className={css.footerAction}><Kbd>R</Kbd>重命名</span>
      <span className={css.footerAction}><Kbd>K</Kbd>快捷键</span>
      {hasArchived && <span className={css.footerAction}><Kbd>T</Kbd>归档视图</span>}
      {showArchived && <span className={css.footerAction}><Kbd>U</Kbd>取消归档</span>}
      <span className={css.footerAction}><Kbd>Esc</Kbd>关闭</span>
      <span className={`${css.footerAction} ${css.footerPush}`}>
        <Kbd>{toggleLabel}</Kbd>开关
      </span>
    </div>
  )

  const strip = configuring ? null : renaming ? (
    <div className={css.renameBar}>
      <input
        ref={renameRef}
        className={css.renameInput}
        value={renameDraft}
        placeholder="输入新标题…"
        onChange={(e) => setRenameDraft(e.target.value)}
      />
      <button type="button" className={css.rowAction} onClick={() => void saveRename()}>保存</button>
      <button type="button" className={css.rowAction} onClick={cancelRename}>取消</button>
    </div>
  ) : searching ? (
    <input
      ref={inputRef}
      className={css.input}
      placeholder="输入标题过滤对话…"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  ) : (
    <button type="button" className={css.searchStrip} onClick={enterSearch}>
      按 S 搜索会话…
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
          <span className={css.title}>切换对话</span>
          {searching && <span className={css.modeTag}>搜索</span>}
          {renaming && <span className={css.modeTag}>重命名</span>}
          {configuring && <span className={css.modeTag}>快捷键</span>}
          <button
            type="button"
            className={css.skinButton}
            onClick={configuring ? closeSettings : openSettings}
            title="自定义快捷键"
          >
            ⚙
          </button>
          <button
            type="button"
            className={css.skinButton}
            onClick={cycleSkin}
            title="切换皮肤（深色/浅色/高对比）"
          >
            {SKIN_LABELS[skinName]}
          </button>
          <button type="button" className={css.newButton} onClick={newConversation}>+ 新建对话</button>
        </div>
        {strip}
        {body}
        {error !== null && <div className={css.errorLine}>{error}</div>}
        {hint}
      </div>
    </div>
  )
}

/**
 * Client bundle entry: global shortcut wiring (customizable chords for open /
 * next / previous, the layout chords driving the DSH frame and the
 * better-sidebar workbench, plus the fixed Alt+K fallback and Esc
 * fullscreen-exit) and the palette mount.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 * @module @suxeca/dsh-client-ui-session-switcher/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Context service augmentations (rc.1): the old `dsh-client-runtime/client`
// re-exported these implicitly. Each augmenting module must be imported for its
// `declare module '@deepseek-ai/cordis'` block to apply.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createKeymapStore, matchesBinding } from './keymap.ts'
import { createOpenStore } from './open-store.ts'
import { currentSessionId, cycleAnchor, offsetTarget, pinnedSessions, sidebarOrder } from './utils.ts'
import { Switcher } from './switcher.tsx'
import type { LayoutPort, SessionsPort, SidebarRightPort, SwitcherContext, UiWorkspacePort, WorkspacesPort } from './port.ts'

/** Services the switcher reads from the context (service names, not modules).
 *  `layout` / `sidebarRight` are intentionally NOT injected: the layout
 *  chords must degrade gracefully (log + no-op) when either service is absent
 *  (non-web profiles), so they resolve lazily behind a guard instead. */
export const inject = ['sessions', 'workspaces', 'uiWorkspace']

/** IME-composition guard: while a CJK
 *  input method owns the key, chords must not fire — modifiers like Ctrl+B
 *  would otherwise break candidate selection mid-composition. This handler
 *  runs on window capture, ahead of any document-level guard, so
 *  the check is this plugin's own responsibility. */
function isImeComposition(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** Whether the key event's target is an editable field (input / textarea /
 *  contentEditable). The Ctrl+X prefix sequence is disabled there so a real
 *  cut gesture is never hijacked. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const el = target
  return el instanceof HTMLInputElement
    || el instanceof HTMLTextAreaElement
    || el.isContentEditable === true
}

/** Whether an editable target has a non-empty text selection (a real cut /
 *  copy selection). Outside editable fields there is never a cut selection. */
function hasSelection(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    // contentEditable: fall back to the window selection.
    if (target instanceof HTMLElement && target.isContentEditable) {
      const sel = window.getSelection()
      return sel !== null && !sel.isCollapsed
    }
    return false
  }
  return target.selectionStart !== null && target.selectionEnd !== null
    && target.selectionStart !== target.selectionEnd
}

/** Write a new value into a controlled input/textarea and notify React. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Clear the whole draft of an editable (input/textarea). */
function clearEditable(target: EventTarget | null): void {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
  setNativeValue(target, '')
  target.setSelectionRange(0, 0)
}

/**
 * Claude-Code-CLI-style line deletion: remove the text before the caret on
 * the current line (or the whole previous line when the caret already sits
 * at a line start). Holding the key (auto-repeat) deletes repeatedly.
 * Selection takes priority — a non-empty selection is deleted first, which
 * is the standard editable behavior.
 */
function deleteLineBeforeCaret(target: EventTarget | null): void {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    // contentEditable is intentionally unsupported (DSH composer is a
    // textarea); let the default handling proceed for other editable hosts.
    return
  }
  const el = target
  const value = el.value
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? start
  if (start === 0 && end === 0) return
  if (end > start) {
    // A selection is present: delete the selection (like typing over it).
    setNativeValue(el, value.slice(0, start) + value.slice(end))
    el.setSelectionRange(start, start)
    return
  }
  // Find the current line start (after the previous newline).
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  if (lineStart < start) {
    // Delete [lineStart, start): the current line's prefix before the caret.
    setNativeValue(el, value.slice(0, lineStart) + value.slice(start))
    el.setSelectionRange(lineStart, lineStart)
    return
  }
  // Caret is at a line start: delete the WHOLE previous line including its
  // trailing newline (the "previous line" the user asked for).
  if (start === 0) return
  const prevLineStart = value.lastIndexOf('\n', start - 2) + 1
  setNativeValue(el, value.slice(0, prevLineStart) + value.slice(start))
  el.setSelectionRange(prevLineStart, prevLineStart)
}

/** Toggle dsh-synapse's conversation-map view: click the opposite view
 *  switch button (`data-view="map"` ⇄ `data-view="dialog"`). No-op when the
 *  synapse view switcher is absent. */
function toggleSessionMapView(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-view]'))
  if (buttons.length === 0) return
  const map = buttons.find(button => button.dataset.view === 'map')
  const dialog = buttons.find(button => button.dataset.view === 'dialog')
  if (map === undefined || dialog === undefined) return
  const mapActive = map.getAttribute('aria-pressed') === 'true' || map.classList.contains('active')
  ;(mapActive ? dialog : map).click()
}

/** Find the session composer textarea (the only main input box). */
function findComposerTextarea(): HTMLTextAreaElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'))
    .filter(ta => ta.offsetParent !== null) // visible
  return candidates.find(ta => ta.placeholder.includes('发消息'))
    ?? candidates.find(ta => ta.placeholder.includes('message'))
    ?? candidates[0] ?? null
}

/**
 * "Pull up /model": insert the `/model` command token into the composer and
 * let DSH's slash trigger open the model popupSelect. Uses the native value
 * setter so React's controlled textarea observes the change, preserving any
 * existing draft by appending the token.
 */
function insertModelCommand(): void {
  const ta = findComposerTextarea()
  if (ta === null) return
  const current = ta.value
  const token = current.trim() === '' ? '/model' : `${current.replace(/\s+$/, '')} /model`
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(ta, token)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.focus()
  // Move caret to the end so the slash menu's position follows the token.
  ta.setSelectionRange(token.length, token.length)
}

/**
 * Mount the switcher: one React root hosting the palette, plus the global
 * keydown handler (driven by the customizable keymap). Torn down on dispose.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Boundary cast: the ports document the exact service surface this plugin
  // calls (see port.ts) — the published rc.6 contracts lag the runtime's
  // workspace.unarchiveSession, so the ports are the narrow face here.
  const sessions = ctx.sessions as unknown as SessionsPort
  const workspaces = ctx.workspaces as unknown as WorkspacesPort
  const uiWorkspace = (ctx.get('uiWorkspace') ?? (ctx as unknown as { uiWorkspace?: UiWorkspacePort }).uiWorkspace) as UiWorkspacePort | undefined

  const openOfficialShortcuts = (): void => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  const switcherCtx: SwitcherContext = { sessions, workspaces, uiWorkspace, openOfficialShortcuts }

  const openStore = createOpenStore()
  const keymapStore = createKeymapStore()
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  // Ctrl+X prefix sequence (Ctrl+X then M pulls up /model). Armed only
  // outside editable fields so a real cut gesture is never hijacked.
  let xPrefixArmed = false
  let xPrefixTimer: number | undefined

  let lastToggleTime = 0
  const guardedToggle = (): void => {
    const now = Date.now()
    if (now - lastToggleTime < 180) return
    lastToggleTime = now
    openStore.toggle()
  }

  const disarmXPefix = (): void => {
    xPrefixArmed = false
    if (xPrefixTimer !== undefined) {
      window.clearTimeout(xPrefixTimer)
      xPrefixTimer = undefined
    }
  }

  let lastNavigatedSessionId: string | undefined

  const navigateToSession = (sessionId: string): void => {
    lastNavigatedSessionId = sessionId
    const ui = (ctx.get('uiWorkspace') ?? (ctx as unknown as { uiWorkspace?: UiWorkspacePort }).uiWorkspace) as UiWorkspacePort | undefined
    if (ui?.openSession) {
      ui.openSession(sessionId)
    } else if (sessions.open) {
      sessions.open(sessionId)
    }
  }

  /**
   * Open the conversation `offset` positions away (wraps around), moving
   * through the exact visual order the left sidebar shows. The anchor is the
   * current session itself when it is a list row (forked branches included);
   * a subagent child anchors on its nearest listed ancestor.
   */
  const switchByOffset = (offset: number): void => {
    const sessionsSnap = sessions.list.getSnapshot()
    const workspacesSnap = workspaces.list.getSnapshot()
    const curId = currentSessionId(sessionsSnap, lastNavigatedSessionId)
    const entries = sidebarOrder(sessionsSnap, workspacesSnap, { currentId: curId })
    const anchor = cycleAnchor(entries, curId, sessionsSnap.byId)
    const target = offsetTarget(entries, anchor, offset)
    if (target !== undefined) navigateToSession(target.session.id)
  }

  /**
   * Jump directly to the pinned session, or cycle through pinned sessions
   * if multiple are pinned and one is already active.
   */
  const jumpToPinned = (): void => {
    const sessionsSnap = sessions.list.getSnapshot()
    const workspacesSnap = workspaces.list.getSnapshot()
    const curId = currentSessionId(sessionsSnap, lastNavigatedSessionId)
    const pinnedList = pinnedSessions(sessionsSnap, workspacesSnap, { currentId: curId })
    if (pinnedList.length === 0) return

    const currentIndex = pinnedList.findIndex((item) => item.session.id === curId)
    if (currentIndex !== -1) {
      const nextIndex = (currentIndex + 1) % pinnedList.length
      navigateToSession(pinnedList[nextIndex].session.id)
    } else {
      navigateToSession(pinnedList[0].session.id)
    }
  }

  // Register commands with the official DSH shortcuts catalog so they appear in
  // Settings → Shortcuts and the Ctrl+/ reference panel for uniform management.
  const officialShortcuts = ctx.get('shortcuts') as {
    register(command: {
      id: string
      label: () => string
      aliases: readonly string[]
      defaults: Readonly<Record<string, { code: string; modifiers: readonly string[] }>>
      regions: readonly string[]
      modals: readonly string[]
      resolve: () => { status: 'handled'; run(): void }
    }): () => void
  } | undefined

  if (officialShortcuts !== undefined && typeof officialShortcuts.register === 'function') {
    ctx.effect(() => {
      try {
        const offToggle = officialShortcuts.register({
          id: 'sessionSwitcher.toggle',
          label: () => '会话切换：打开/关闭面板',
          aliases: ['session switcher', 'quick switch', 'ctrl k panel', '切换对话'],
          defaults: {
            'web:linux': { code: 'KeyK', modifiers: ['primary'] },
            'web:windows': { code: 'KeyK', modifiers: ['primary'] },
            'web:macos': { code: 'KeyK', modifiers: ['primary'] },
            'desktop:linux': { code: 'KeyK', modifiers: ['primary'] },
            'desktop:windows': { code: 'KeyK', modifiers: ['primary'] },
            'desktop:macos': { code: 'KeyK', modifiers: ['primary'] },
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: () => ({ status: 'handled', run: guardedToggle }),
        })
        const offNext = officialShortcuts.register({
          id: 'sessionSwitcher.next',
          label: () => '会话切换：下一个会话',
          aliases: ['next session', '下一个对话'],
          defaults: {
            'web:linux': { code: 'BracketRight', modifiers: ['primary'] },
            'web:windows': { code: 'BracketRight', modifiers: ['primary'] },
            'web:macos': { code: 'BracketRight', modifiers: ['primary'] },
            'desktop:linux': { code: 'BracketRight', modifiers: ['primary'] },
            'desktop:windows': { code: 'BracketRight', modifiers: ['primary'] },
            'desktop:macos': { code: 'BracketRight', modifiers: ['primary'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => ({ status: 'handled', run: () => { switchByOffset(1) } }),
        })
        const offPrev = officialShortcuts.register({
          id: 'sessionSwitcher.prev',
          label: () => '会话切换：上一个会话',
          aliases: ['previous session', '上一个对话'],
          defaults: {
            'web:linux': { code: 'BracketLeft', modifiers: ['primary'] },
            'web:windows': { code: 'BracketLeft', modifiers: ['primary'] },
            'web:macos': { code: 'BracketLeft', modifiers: ['primary'] },
            'desktop:linux': { code: 'BracketLeft', modifiers: ['primary'] },
            'desktop:windows': { code: 'BracketLeft', modifiers: ['primary'] },
            'desktop:macos': { code: 'BracketLeft', modifiers: ['primary'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => ({ status: 'handled', run: () => { switchByOffset(-1) } }),
        })
        const offPinned = officialShortcuts.register({
          id: 'sessionSwitcher.jumpToPinned',
          label: () => '会话切换：切换至置顶对话',
          aliases: ['jump to pinned', 'pinned session', '置顶对话'],
          defaults: {
            'web:linux': { code: 'KeyP', modifiers: ['alt'] },
            'web:windows': { code: 'KeyP', modifiers: ['alt'] },
            'web:macos': { code: 'KeyP', modifiers: ['alt'] },
            'desktop:linux': { code: 'KeyP', modifiers: ['alt'] },
            'desktop:windows': { code: 'KeyP', modifiers: ['alt'] },
            'desktop:macos': { code: 'KeyP', modifiers: ['alt'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => ({ status: 'handled', run: jumpToPinned }),
        })
        return () => {
          offToggle()
          offNext()
          offPrev()
          offPinned()
        }
      } catch (err) {
        console.warn('[session-switcher] official shortcuts registration skipped:', err)
        return () => {}
      }
    }, 'session-switcher: official shortcuts')
  }

  const onWindowKeyDown = (e: KeyboardEvent): void => {
    const { bindings, capturing } = keymapStore.getSnapshot()
    // Mid-rebind: the palette's own handler owns every key press; the global
    // handler stands down so a captured chord never re-triggers an action.
    if (capturing) return
    // IME composition owns the key — never treat it as a chord.
    if (isImeComposition(e)) return

    // Lazy layout/right-column faces, resolved PER KEYPRESS: the boot order
    // between this plugin and the service owners is unspecified (neither is
    // injected here), and ctx.get() returns undefined until the provider's
    // apply ran — a one-time capture at apply() would freeze the undefined.
    // ctx.get() is the Cordis optional accessor — a bare ctx.layout read
    // would hit the context proxy and throw "cannot get property without
    // inject".
    const layout = ctx.get('layout') as LayoutPort | undefined
    const sidebarRight = ctx.get('sidebarRight') as SidebarRightPort | undefined

    const paletteState = openStore.getSnapshot()
    const open = paletteState.open
    const previewing = paletteState.preview

    // PREVIEW MODE: the card is hidden and the selected conversation is on
    // screen. Only the three exit gestures are handled here — everything
    // else (scrolling, hovering) falls through to the page so the preview
    // behaves like a lightweight dialog:
    //   Esc  -> restore the pre-preview session, return to the card
    //   Enter -> keep the previewed session, close the interaction
    //   Ctrl+K / Alt+K -> like Esc (restore + close the whole interaction)
    if (previewing) {
      const cancelPreview = (): void => {
        const from = openStore.getSnapshot().previewFromId
        if (from !== undefined) navigateToSession(from)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelPreview()
        openStore.exitPreview()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openStore.confirmPreview()
      } else if (matchesBinding(bindings.toggle, e)) {
        e.preventDefault()
        cancelPreview()
        openStore.close()
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        cancelPreview()
        openStore.close()
      }
      return
    }

    // Ctrl+U (input editing, Claude-Code-CLI style): delete the line before
    // the caret in the focused editable; holding the key auto-repeats, so
    // each repeat deletes another segment/line. Ctrl+U is swallowed page-wide
    // (Chrome's "view source" default is disabled); outside an editable the
    // key only prevents the browser default and does nothing else.
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      if (isEditableTarget(e.target)) {
        deleteLineBeforeCaret(e.target)
      }
      return
    }

    // Ctrl+C in an editable WITHOUT a selection clears the whole draft
    // (Claude-Code-CLI-style cancel-input). With a selection the native copy
    // is preserved; outside editable fields copy is untouched too.
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      if (isEditableTarget(e.target) && !hasSelection(e.target)) {
        e.preventDefault()
        clearEditable(e.target)
      }
      return
    }

    // Ctrl+X prefix sequence: Ctrl+X arms a 1.5s window in which M (no
    // modifiers) pulls up /model. Works BOTH outside and inside editable
    // fields: inside an input/textarea the sequence is only armed when there
    // is NO selected text — a real cut gesture (selection present) always
    // keeps its native behavior, so typing shortcuts never lose Cut.
    if (isEditableTarget(e.target) && hasSelection(e.target)) {
      // A cut with an active selection: let the browser handle Ctrl+X as-is.
      if (xPrefixArmed) disarmXPefix()
    } else {
      if (xPrefixArmed && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        disarmXPefix()
        insertModelCommand()
        return
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'x') {
        xPrefixArmed = true
        if (xPrefixTimer !== undefined) window.clearTimeout(xPrefixTimer)
        xPrefixTimer = window.setTimeout(disarmXPefix, 1500)
        return
      }
      if (xPrefixArmed) disarmXPefix()
    }

    // Customizable toggle chord (default Ctrl+K / Cmd+K).
    if (matchesBinding(bindings.toggle, e)) {
      e.preventDefault()
      guardedToggle()
      return
    }
    // Fixed safety fallback: Alt+K always opens the palette, so a mis-bound
    // toggle chord can never lock the palette out.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      guardedToggle()
      return
    }
    // Customizable cycle chords (default Ctrl+] / Ctrl+[), only while the
    // palette is closed.
    if (!open && matchesBinding(bindings.next, e)) {
      e.preventDefault()
      switchByOffset(1)
      return
    }
    if (!open && matchesBinding(bindings.prev, e)) {
      e.preventDefault()
      switchByOffset(-1)
      return
    }
    if (!open && matchesBinding(bindings.jumpToPinned, e)) {
      e.preventDefault()
      jumpToPinned()
      return
    }
    // Layout chords (defaults: Ctrl+B left / Ctrl+Shift+B right), only while
    // the palette is closed. Each dispatches through the owning plugin's
    // service; a missing service is a silent no-op.
    if (!open) {
      if (matchesBinding(bindings.toggleLeftSidebar, e)) {
        e.preventDefault()
        if (layout !== undefined) layout.toggleSidebar()
        else console.warn('[session-switcher] layout chord: ui-layout service missing')
        return
      }
      if (matchesBinding(bindings.toggleRightSidebar, e)) {
        e.preventDefault()
        if (sidebarRight === undefined) {
          console.warn('[session-switcher] layout chord: ui-sidebar-right service missing')
        } else {
          // toggleExpanded() throws when no session surface is mounted (a write
          // needs a session to write to, unlike isExpanded(), which reads false).
          // Probe with isExpanded() so the chord stays a no-op off-session
          // instead of throwing out of the window keydown handler.
          try {
            sidebarRight.toggleExpanded()
          } catch {
            console.warn('[session-switcher] layout chord: no session mounted for the right column')
          }
        }
        return
      }
      if (matchesBinding(bindings.toggleSessionMap, e)) {
        e.preventDefault()
        toggleSessionMapView()
        return
      }
    }
    // Escape: inside the open panel it is the panel's own concern (search →
    // manage → close); outside it closes the palette. With the palette
    // closed, Escape collapses the right column when it is expanded — fixed,
    // never rebindable. A collapsed column is left alone (toggling blindly
    // would expand it instead).
    if (e.key === 'Escape') {
      if (open) {
        if (container === null || !container.contains(e.target as Node)) {
          e.preventDefault()
          openStore.close()
        }
        return
      }
      if (sidebarRight?.isExpanded() === true) {
        e.preventDefault()
        // No try/catch here on purpose: isExpanded() reports true only from a
        // mounted surface, so toggleExpanded()'s no-session throw cannot fire.
        sidebarRight.toggleExpanded()
      }
    }
  }
  window.addEventListener('keydown', onWindowKeyDown, true)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(createElement(Switcher, { ctx: switcherCtx, openStore, keymapStore }))
  console.log('[session-switcher] ready — shortcuts are customizable from the palette (⚙ 快捷键)')

  ctx.effect(() => () => {
    disarmXPefix()
    window.removeEventListener('keydown', onWindowKeyDown, true)
    if (root !== null) {
      root.unmount()
      root = null
    }
    if (container !== null) {
      container.remove()
      container = null
    }
  }, 'ui-session-switcher: lifecycle')
}

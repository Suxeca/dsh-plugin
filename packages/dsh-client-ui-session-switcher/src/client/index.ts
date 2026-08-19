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

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createKeymapStore, matchesBinding } from './keymap.ts'
import { createOpenStore } from './open-store.ts'
import { cycleAnchor, offsetTarget, sidebarOrder } from './utils.ts'
import { Switcher } from './switcher.tsx'
import type { BetterSidebarPort, LayoutPort, SessionsPort, SwitcherContext, WorkspacesPort } from './port.ts'

/** Services the switcher reads from the context (service names, not modules).
 *  `layout` / `betterSidebar` are intentionally NOT injected: the layout
 *  chords must degrade gracefully (log + no-op) when either service is absent
 *  (non-web profiles), so they resolve lazily behind a guard instead. */
export const inject = ['sessions', 'workspaces']

/** IME-composition guard (mirrors better-sidebar's ime-guard): while a CJK
 *  input method owns the key, chords must not fire — modifiers like Ctrl+B
 *  would otherwise break candidate selection mid-composition. This handler
 *  runs on window capture, BEFORE better-sidebar's document-level guard, so
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
  const switcherCtx: SwitcherContext = { sessions, workspaces }

  const openStore = createOpenStore()
  const keymapStore = createKeymapStore()
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  // Ctrl+X prefix sequence (Ctrl+X then M pulls up /model). Armed only
  // outside editable fields so a real cut gesture is never hijacked.
  let xPrefixArmed = false
  let xPrefixTimer: number | undefined

  const disarmXPefix = (): void => {
    xPrefixArmed = false
    if (xPrefixTimer !== undefined) {
      window.clearTimeout(xPrefixTimer)
      xPrefixTimer = undefined
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
    const entries = sidebarOrder(sessionsSnap, workspacesSnap)
    const anchor = cycleAnchor(entries, sessionsSnap.current, sessionsSnap.byId)
    const target = offsetTarget(entries, anchor, offset)
    if (target !== undefined) sessions.open(target.session.id)
  }

  const onWindowKeyDown = (e: KeyboardEvent): void => {
    const { bindings, capturing } = keymapStore.getSnapshot()
    // Mid-rebind: the palette's own handler owns every key press; the global
    // handler stands down so a captured chord never re-triggers an action.
    if (capturing) return
    // IME composition owns the key — never treat it as a chord.
    if (isImeComposition(e)) return

    // Lazy layout/workbench faces, resolved PER KEYPRESS: the boot order
    // between this plugin and the service owners is unspecified (neither is
    // injected here), and ctx.get() returns undefined until the provider's
    // apply ran — a one-time capture at apply() would freeze the undefined.
    // ctx.get() is the Cordis optional accessor — a bare ctx.layout read
    // would hit the context proxy and throw "cannot get property without
    // inject".
    const layout = ctx.get('layout') as LayoutPort | undefined
    const betterSidebar = ctx.get('betterSidebar') as BetterSidebarPort | undefined

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
        if (from !== undefined) sessions.open(from)
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
      openStore.toggle()
      return
    }
    // Fixed safety fallback: Alt+K always opens the palette, so a mis-bound
    // toggle chord can never lock the palette out.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      openStore.toggle()
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
    // Layout chords (defaults: Ctrl+B left / Ctrl+Shift+B right / Ctrl+J
    // bottom / Alt+Shift+L left fullscreen / Alt+Shift+R right fullscreen),
    // only while the palette is closed. Each dispatches through the owning
    // plugin's service; a missing service is a silent no-op.
    if (!open) {
      if (matchesBinding(bindings.toggleLeftSidebar, e)) {
        e.preventDefault()
        if (layout !== undefined) layout.toggleSidebar()
        else console.warn('[session-switcher] layout chord: ui-layout service missing')
        return
      }
      if (matchesBinding(bindings.toggleRightSidebar, e)) {
        e.preventDefault()
        if (betterSidebar !== undefined) betterSidebar.togglePanel()
        else console.warn('[session-switcher] workbench chord: better-sidebar service missing')
        return
      }
      if (matchesBinding(bindings.toggleBottom, e)) {
        e.preventDefault()
        if (betterSidebar !== undefined) {
          // Toggle the bottom panel, focusing a terminal on open instead of
          // merely calling up the window; a better-sidebar without the newer
          // toggleBottomTerminal degrades to a plain panel toggle.
          if (typeof (betterSidebar as { toggleBottomTerminal?: unknown }).toggleBottomTerminal === 'function') {
            betterSidebar.toggleBottomTerminal()
          } else {
            betterSidebar.toggleBottomPanel()
          }
        } else {
          console.warn('[session-switcher] workbench chord: better-sidebar service missing')
        }
        return
      }
      if (matchesBinding(bindings.fullscreenLeft, e)) {
        e.preventDefault()
        if (layout !== undefined) layout.toggleLeftFullscreen()
        else console.warn('[session-switcher] layout chord: ui-layout service missing')
        return
      }
      if (matchesBinding(bindings.fullscreenRight, e)) {
        e.preventDefault()
        if (betterSidebar !== undefined) betterSidebar.toggleFullscreen()
        else console.warn('[session-switcher] workbench chord: better-sidebar service missing')
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
    // closed, Escape exits any active fullscreen (left frame or right
    // workbench) — fixed, never rebindable.
    if (e.key === 'Escape') {
      if (open) {
        if (container === null || !container.contains(e.target as Node)) {
          e.preventDefault()
          openStore.close()
        }
        return
      }
      const workbenchFullscreen = betterSidebar?.getSnapshot().state?.fullscreen === true
      const frameFullscreen = layout?.isLeftFullscreen() === true
      if (frameFullscreen || workbenchFullscreen) {
        e.preventDefault()
        layout?.setLeftFullscreen(false)
        betterSidebar?.setFullscreen(false)
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

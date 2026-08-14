/**
 * Client bundle entry: global shortcut wiring (customizable chords for open /
 * next / previous, plus a fixed Alt+K fallback) and the palette mount.
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
import { cycleAnchorId, offsetTarget, sidebarOrder } from './utils.ts'
import { Switcher } from './switcher.tsx'
import type { SessionsPort, SwitcherContext, WorkspacesPort } from './port.ts'

/** Services the switcher reads from the context (service names, not modules). */
export const inject = ['sessions', 'workspaces']

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

  /**
   * Open the conversation `offset` positions away (wraps around), moving
   * through the exact visual order the left sidebar shows. A current
   * subagent child anchors on its root parent row.
   */
  const switchByOffset = (offset: number): void => {
    const sessionsSnap = sessions.list.getSnapshot()
    const workspacesSnap = workspaces.list.getSnapshot()
    const entries = sidebarOrder(sessionsSnap, workspacesSnap)
    const anchor = cycleAnchorId(sessionsSnap.current, sessionsSnap.byId)
    const target = offsetTarget(entries, anchor, offset)
    if (target !== undefined) sessions.open(target.session.id)
  }

  const onWindowKeyDown = (e: KeyboardEvent): void => {
    const { bindings, capturing } = keymapStore.getSnapshot()
    // Mid-rebind: the palette's own handler owns every key press; the global
    // handler stands down so a captured chord never re-triggers an action.
    if (capturing) return

    const open = openStore.getSnapshot()

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
    // Escape inside the open panel is the panel's own concern (search →
    // manage → close); only close globally when the key landed outside it.
    if (open && e.key === 'Escape' && (container === null || !container.contains(e.target as Node))) {
      e.preventDefault()
      openStore.close()
    }
  }
  window.addEventListener('keydown', onWindowKeyDown, true)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(createElement(Switcher, { ctx: switcherCtx, openStore, keymapStore }))
  console.log('[session-switcher] ready — shortcuts are customizable from the palette (⚙ 快捷键)')

  ctx.effect(() => () => {
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

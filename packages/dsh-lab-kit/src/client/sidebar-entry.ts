/**
 * Sidebar entry injection.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into
 * (`sidebar.workspaces` / `sidebar.settings` are single-occupant and already
 * taken), so — following the skin precedent of DOM-level extension — the
 * entry row is injected between the shell's New Session button and the
 * workspace browser. The injection self-heals: a MutationObserver watches the
 * sidebar root and re-inserts the row whenever a React re-render displaces it
 * (re-insertion happens in the same frame, before paint, so no flicker).
 *
 * The row is plain DOM (no React tree) so it can never disturb the shell's
 * reconciliation; the cockpit view it toggles is a separate React root
 * mounted in the center column (see cockpit-mount.tsx).
 * @module dsh-lab-kit/client/sidebar-entry
 */

import { t } from './locales.ts'
import css from './cockpit.module.css'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-labkit-entry]'

/**
 * The sidebar shell lives inside the layout's `sidebar` slot. The slot
 * renderer (ui-slots/web-react scoped-slots) wraps every slot occupant in a
 * `<div data-slot="<key>">` — the documented addressable seam — whose
 * firstElementChild is the SidebarRoot itself.
 */
const SIDEBAR_SLOT_SELECTOR = '[data-slot="sidebar"]'

/**
 * Fallback anchor: the sidebar column AppFrame renders (a css-module
 * hash-prefixed class; only the local-name suffix `sidebarCol` is stable).
 */
const SIDEBAR_COLUMN_SELECTOR = '[class*="sidebarCol"]'

/** Inline icon (matches the shell's 16px nav-icon look): a flask. */
const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h4M7 2v4.2L3.6 11.4A1.4 1.4 0 0 0 4.8 13.5h6.4a1.4 1.4 0 0 0 1.2-2.1L9 6.2V2"/><path d="M4.5 9.5h7"/></svg>`

/**
 * Find the sidebar shell root element, or undefined while not yet mounted.
 * Primary: the `data-slot="sidebar"` seam's first child. Fallback: walk down
 * from the sidebar column until an element with a direct BUTTON child (the
 * New Session button) — the shell root, regardless of wrapper depth.
 */
function sidebarRoot(): HTMLElement | undefined {
  const slot = document.querySelector<HTMLElement>(SIDEBAR_SLOT_SELECTOR)
  if (slot?.firstElementChild) return slot.firstElementChild as HTMLElement
  const column = document.querySelector<HTMLElement>(SIDEBAR_COLUMN_SELECTOR)
  if (!column) return undefined
  for (let el: HTMLElement | null = column; el; el = el.firstElementChild as HTMLElement | null) {
    for (const child of el.children) {
      if (child.tagName === 'BUTTON') return el
    }
  }
  return undefined
}

/** The New Session button: the shell's only direct-child button of the root. */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** Build the entry row (a detached button; insert once the shell is up). */
function createEntry(onToggle: () => void): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshLabkitEntry = ''
  entry.className = css.entry
  entry.setAttribute('aria-label', t('entry'))
  entry.innerHTML = `<span class="${css.entryIcon}">${ICON}</span><span class="${css.entryLabel}">${t('entry')}</span>`
  entry.addEventListener('click', onToggle)
  return entry
}

/** Re-insert the entry after the New Session button (before the browser region). */
function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    // Insert after the button: React never manages this node, and the shell
    // keeps its own child order intact around it.
    root.insertBefore(entry, button.nextElementSibling)
  }
  return true
}

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param onToggle - invoked when the entry is clicked.
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(onToggle: () => void): () => void {
  const entry = createEntry(onToggle)
  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = (): void => {
    if (placed) return
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) rootObserver.observe(root, { childList: true, subtree: true })
  }

  // The shell renders after boot settlement; watch for its arrival.
  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  // Self-heal: if a React re-render displaces the row, re-insert it in the
  // same frame (microtask before paint → no visible flicker).
  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry)
    }
  })

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    entry.remove()
  }
}

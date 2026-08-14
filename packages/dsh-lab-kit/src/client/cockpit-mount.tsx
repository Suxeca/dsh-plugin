/**
 * Cockpit view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the cockpit takes over the center column
 * at the DOM level: a container is appended inside the `[class*="centerCol"]`
 * grid item (an extra trailing child React never manages), and a stylesheet
 * rule hides the conversation content while the cockpit is active. Toggling
 * is a data attribute on <html> — no React involvement, so the conversation
 * subtree underneath stays mounted and stateful.
 * @module dsh-lab-kit/client/cockpit-mount
 */

import { createRoot, type Root } from 'react-dom/client'
import { closeCockpit, isCockpitOpen, subscribeCockpit } from './cockpit-state.ts'
import { CockpitPanel } from './CockpitPanel.tsx'
import css from './cockpit.module.css'

/** The injected cockpit container (kept in the DOM, hidden when inactive). */
export const COCKPIT_VIEW_SELECTOR = '[data-dsh-labkit-view]'

/** Center column AppFrame renders (`<div className={css.centerCol}>`); css-module hash-prefixed, so match the stable local-name suffix. */
const CONVERSATION_COLUMN_SELECTOR = '[class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-labkit-active'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount the cockpit React tree into the center column and bind its visibility
 * to the cockpit open state.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountCockpit(): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) return
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshLabkitView = ''
    container.className = css.cockpitView
    column.appendChild(container)
    root = createRoot(container)
    root.render(<CockpitPanel onClose={closeCockpit} />)
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (isCockpitOpen()) {
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const unsubscribe = subscribeCockpit(applyActive)
  applyActive()
  ensure()

  return () => {
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}

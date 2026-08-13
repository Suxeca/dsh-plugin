/**
 * Client bundle entry: wires the framework-free cockpit (state, sidebar
 * entry, center-column view) to the client runtime lifecycle.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 * @module @deepseek-ai/dsh-lab-kit/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { closeCockpit, toggleCockpit } from './cockpit-state.ts'
import { mountCockpit } from './cockpit-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'

/**
 * Mount the lab-kit cockpit: the sidebar entry toggles the center-column
 * cockpit view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers = [
      mountSidebarEntry(() => { toggleCockpit() }),
      mountCockpit(),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      closeCockpit()
    }
  }, 'dsh-lab-kit: ui mount')
}

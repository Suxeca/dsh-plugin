/**
 * Browser half: register `external-dirs` as a right-Sidebar tab type.
 *
 * Follows the public two-stage path the official `ui-sidebar-files` package
 * documents and uses itself:
 *
 *   1. the type into `ctx.sidebarRightTabs`
 *   2. the body into the keyed `sidebar.right.pane.tab` seat, and the chip
 *      title into the keyed `sidebar.right.pane.tab.title` seat,
 *      both under the type's `id`
 *
 * Both registrations live inside `ctx.effect`, so they are removed exactly
 * when this plugin unloads.
 *
 * @module @suxeca/dsh-external-dirs/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ExternalDirsBody } from './Body.tsx'
import { ExternalDirsTitle } from './Title.tsx'
import { EXTERNAL_DIRS_ID, externalDirsDefinition } from './definition.ts'

export type { ExternalDirsBodyProps } from './Body.tsx'

/**
 * Required browser services: the tab-type registry, the keyed seat, and the
 * Remote carrier that supplies the standard tab props.
 */
export const inject = ['slots', 'sidebarRightTabs', 'remote']

/**
 * Register the type, its body, and its chip title.
 * @param ctx - client root context carrying the registry and the seat.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.sidebarRightTabs.register(externalDirsDefinition()),
    '@suxeca/dsh-external-dirs: tab type',
  )
  ctx.effect(
    () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: EXTERNAL_DIRS_ID },
      ExternalDirsBody,
    )),
    '@suxeca/dsh-external-dirs: tab body',
  )
  ctx.effect(
    () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: EXTERNAL_DIRS_ID },
      ExternalDirsTitle,
    )),
    '@suxeca/dsh-external-dirs: tab title',
  )
}

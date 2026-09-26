/**
 * Browser half: register `笔记看板` as a Conversation View.
 *
 * The view reaches the conversation through the same public seat the shipped
 * 对话 and 轨迹 views use:
 *
 *   ctx.slots.register({ name: 'conversation.view', id, order, label }, Body)
 *
 * Nothing here reaches into the conversation's store, its tab strip, or its
 * selection: `order` decides the position and `label` decides the chip text, and
 * the owner renders whichever view is current. The registration lives inside
 * `ctx.effect`, so it is removed exactly when this plugin unloads.
 *
 * `label` is a **thunk** so a language switch re-resolves it: the owner
 * re-projects its tab strip on a locale change, and this board's tab has to move
 * together with the pane below it.
 *
 * @module @suxeca/dsh-note-board/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NoteBoardView } from './Body.tsx'
import { BOARD_VIEW_ID, BOARD_VIEW_ORDER } from './definition.ts'
import { boardStrings, installBoardLocale } from './i18n.ts'

export type { LedgerPayload, AuditsPayload, AuditFile } from '../shared.ts'

/** The slot registry is the only service this view requires; `locale` is optional. */
export const inject = ['slots']

/**
 * Register the view.
 * @param ctx - client root context carrying the slot registry.
 */
export function apply(ctx: ClientContext): void {
  // Optional on purpose: a deployment without the locale service still gets a
  // working board (in the language it was written in) rather than no board.
  ctx.effect(
    () => installBoardLocale(ctx.get('locale')),
    '@suxeca/dsh-note-board: locale',
  )

  ctx.effect(
    () => ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: BOARD_VIEW_ID,
      order: BOARD_VIEW_ORDER,
      // A thunk, so a locale change re-reads it without re-registration —
      // matching how the shipped views declare theirs.
      label: () => boardStrings().view,
    }, NoteBoardView)),
    '@suxeca/dsh-note-board: conversation view',
  )
}

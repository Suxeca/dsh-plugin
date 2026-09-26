/**
 * Identity for this package's Conversation View.
 *
 * The board is registered into `conversation.view` — the same list seat that
 * holds 对话 (order 0) and 轨迹 (order 10) — so it appears as a third tab beside
 * them rather than as a separate right-hand column. `order: 20` puts it last.
 *
 * Copy lives in `./i18n.ts`, not here: the tab label is re-resolved whenever the
 * locale changes, so it cannot be a module constant.
 *
 * @module @suxeca/dsh-note-board/client/definition
 */

/** This view's id in the `conversation.view` seat. */
export const BOARD_VIEW_ID = 'note-board'

/**
 * Where the view lands among its siblings.
 *
 * 对话 is 0 and 轨迹 is 10 upstream, so anything above 10 is "after both
 * shipped views" without hard-coding a position that breaks if one of them is
 * reordered.
 */
export const BOARD_VIEW_ORDER = 20

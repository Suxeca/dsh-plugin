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

/**
 * This package's id in the `conversation.input.dock` seat.
 *
 * Deliberately not `note-board`: a fresh id is added *beside* the shipped docks,
 * while reusing a shipped id would replace that occupant's cell. The seat holds
 * the todo strip, the goal bar and the queue, and this entry is a peer of those,
 * not a replacement for one.
 */
export const INJECTION_DOCK_ID = 'note-board-injection'

/**
 * Where the entry lands in that strip.
 *
 * Above the task-shaped docks (todo 0, goal 10, queue 20) because it answers a
 * question that comes earlier in a session than any of them: whether this
 * conversation reads the note at all.
 */
export const INJECTION_DOCK_ORDER = -10

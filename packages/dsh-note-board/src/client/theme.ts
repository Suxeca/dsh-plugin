/**
 * Shared client chrome: the theme tokens and the layout column every board view
 * uses.
 *
 * Tokens are `--dsw-alias-*` CSS variables rather than literals, so the board
 * follows whatever skin DSH is wearing with no per-theme code here. The literal
 * after each comma is a fallback that only shows if DSH's theme plugin is absent.
 *
 * @module @suxeca/dsh-note-board/client/theme
 */

/** Skin-following colors. */
export const T = {
  surface: 'var(--dsw-alias-bg-base, #1c1c1f)',
  panel: 'var(--dsw-alias-bg-layer-1, #232327)',
  raised: 'var(--dsw-alias-bg-layer-2, #2b2b30)',
  border: 'var(--dsw-alias-border-l1, #35353b)',
  borderStrong: 'var(--dsw-alias-border-l2, #45454d)',
  text: 'var(--dsw-alias-label-primary, #e6e6ea)',
  dim: 'var(--dsw-alias-label-secondary, #9a9aa4)',
  accent: 'var(--dsw-alias-brand-primary, #4a7dbe)',
  warn: 'var(--dsw-alias-state-warn-primary, #d08a4a)',
  error: 'var(--dsw-alias-state-error-primary, #d05a5a)',
  ok: 'var(--dsw-alias-state-success-primary, #4aa06a)',
} as const

/**
 * The conversation's own content column — the width 对话 and 轨迹 render at.
 *
 * Two reasons this is DSH's published column rather than a width of the board's
 * own choosing:
 *
 *  1. **Correctness: nothing here can be covered by a drag strip.** DSH sizes
 *     its column drag strips off this same token and places their *inner* edge
 *     24px outside it (`ui-conversation/…/ConversationRoot.module.css`:
 *     `left: calc(50% + var(--dsh-chat-content-width) / 2 + 24px)`), extending
 *     40px outward. So anything drawn **inside** the column is unreachable by a
 *     resize handle at any pane width, and anything drawn in the margin is not:
 *     the toolbar used to pin 刷新 to the pane's right edge, which put the
 *     button — and its click target — inside the strip, so half a click resized
 *     the column instead of refreshing.
 *  2. **Continuity.** Switching 对话 → 笔记看板 no longer moves the text column.
 *
 * `var(…, 748px)`: the token is inherited from the conversation root this view
 * is rendered inside; the fallback is DSH's own low-end default and the same one
 * first-party plugins use.
 */
export const CONTENT_COLUMN = {
  width: '100%',
  maxWidth: 'var(--dsh-chat-content-width, 748px)',
  margin: '0 auto',
} as const

/** Localized chrome for rendered Markdown lives in `./i18n.ts` (`markdownLabels`). */

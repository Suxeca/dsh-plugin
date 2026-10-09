/**
 * Shared client controls.
 *
 * Extracted when the composer entry needed the same button as the board: two
 * copies of one style would drift, and the board's button already carries the
 * rule that matters (a full border, transparent background, `--dsw-alias-*`
 * colors only, so it follows the active skin).
 *
 * @module @suxeca/dsh-note-board/client/controls
 */
import { createElement as h } from 'react'
import { T } from './theme.ts'

/** A small outlined button. */
export function Button(props: {
  readonly label: string
  readonly title?: string
  readonly onClick: () => void
  readonly tone?: 'plain' | 'accent'
}) {
  return h('button', {
    type: 'button',
    title: props.title ?? props.label,
    onClick: props.onClick,
    style: {
      appearance: 'none',
      border: `1px solid ${props.tone === 'accent' ? T.accent : T.borderStrong}`,
      borderRadius: 6,
      background: 'transparent',
      color: props.tone === 'accent' ? T.accent : T.dim,
      cursor: 'pointer',
      fontSize: 12,
      padding: '4px 11px',
    },
  }, props.label)
}

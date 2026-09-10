/**
 * The `external-dirs` tab's chip title: a folder glyph plus this type's label,
 * registered into the keyed `sidebar.right.pane.tab.title` seat under the same
 * id as the body.
 *
 * @module @suxeca/dsh-external-dirs/client/Title
 */
import { createElement as h } from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import { LABELS } from './definition.ts'

/**
 * Render the chip title.
 * @returns the glyph and label.
 */
export function ExternalDirsTitle() {
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
    h(FileTypeIcon, { kind: 'folder', size: 16 }),
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, LABELS.title))
}

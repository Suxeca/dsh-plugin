/**
 * The composer entry is the earliest surface this plugin can own: the board's
 * tab does not exist on a blank session, so before this the injection decision
 * had no control at the exact moment it is made.
 *
 * Two things these tests pin, both of which fail silently in production:
 *
 *  1. **The seat is shared.** `conversation.input.dock` already holds the todo
 *     strip, the goal bar, the queue and the visualiser. A *fresh* id adds a
 *     cell beside them; reusing one of theirs replaces that occupant's cell, and
 *     the plugin that lost its seat would simply stop appearing.
 *  2. **An unbound session gets no chrome.** The entry is mounted in every
 *     conversation, including ones about something else entirely.
 *
 * @module @suxeca/dsh-note-board/tests/dock
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INJECTION_DOCK_ID, INJECTION_DOCK_ORDER } from '../src/client/definition.ts'
import { injectionBarVisible } from '../src/client/InjectionBar.tsx'
import type { LedgerRef, StatePayload } from '../src/shared.ts'

const packageRoot = join(import.meta.dirname, '..')
const clientIndex = readFileSync(join(packageRoot, 'src/client/index.ts'), 'utf8')
const bundlePath = join(packageRoot, 'lib/client.js')
const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : null

/** Ids the shipped docks already occupy in this seat. */
const SHIPPED_DOCK_IDS = ['skill-review', 'todo', 'goal', 'queue', 'visualize-stream']

/** One state payload for a given source. */
function state(source: LedgerRef['source']): StatePayload {
  return {
    ref: { source, path: source === 'none' ? '' : '/project/notes/ledger.md', title: 'project' },
    exists: true,
    enabled: source !== 'off',
  }
}

describe('the composer entry registers into the shared dock seat', () => {
  it('targets the dock slot and uses its own id constant', () => {
    expect(clientIndex).toContain("slots.inject('conversation.input.dock'")
    expect(clientIndex).toContain('id: INJECTION_DOCK_ID')
    expect(INJECTION_DOCK_ID).toBe('note-board-injection')
  })

  it('does not take a seat a shipped dock already occupies', () => {
    for (const shipped of SHIPPED_DOCK_IDS) expect(INJECTION_DOCK_ID).not.toBe(shipped)
    // Above the task-shaped docks: whether a conversation reads the note comes
    // before any of them.
    for (const order of [0, 10, 20, 30]) expect(INJECTION_DOCK_ORDER).toBeLessThan(order)
  })

  it('ships the entry in the built bundle', () => {
    expect(bundle).not.toBeNull()
    expect(bundle).toContain(INJECTION_DOCK_ID)
  })
})

describe('the entry is quiet unless there is something to switch', () => {
  it('renders nothing before the first read, and nothing when unbound', () => {
    expect(injectionBarVisible(null)).toBe(false)
    expect(injectionBarVisible(state('none'))).toBe(false)
  })

  it('renders for a discovered, attached or switched-off note', () => {
    expect(injectionBarVisible(state('discovered'))).toBe(true)
    expect(injectionBarVisible(state('attached'))).toBe(true)
    // Switched off is precisely when the entry matters: it is the only surface
    // that can switch injection back on before the first message.
    expect(injectionBarVisible(state('off'))).toBe(true)
  })
})

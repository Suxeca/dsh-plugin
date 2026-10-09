/**
 * The note entry above the composer.
 *
 * Why it exists: the session switch already lives in the board's binding bar and
 * in `/note-board`, and both arrive too late for the decision they carry. The
 * board's tab does not exist until the session has a conversation, so a
 * brand-new session — the exact moment a human decides "this conversation should
 * not read my note" — had no visible control at all; and a slash command only
 * helps someone who already knows the command exists. `conversation.input.dock`
 * renders on a blank session too, which makes it the earliest surface this
 * plugin can own.
 *
 * It stays quiet on purpose. Nothing renders when no note resolves, so a session
 * unrelated to any project gains no chrome. It polls a route that returns the
 * binding alone — never the note's text — because this bar is mounted for as
 * long as a conversation is open, and a chip must not make an idle session's
 * cost grow with the size of the note it is showing.
 *
 * @module @suxeca/dsh-note-board/client/InjectionBar
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { Envelope, StatePayload } from '../shared.ts'
import { ROUTE_INJECTION, ROUTE_PREFIX, ROUTE_STATE } from '../shared-routes.ts'
import { Button } from './controls.tsx'
import { useBoardStrings } from './i18n.ts'
import { CONTENT_COLUMN, T } from './theme.ts'

/** How often the entry re-reads the binding. Matches the board's own cadence. */
const POLL_MS = 5000

/** Props the slot hands every occupant; `conversation.input.dock` is session-scoped. */
export interface InjectionBarProps {
  readonly sessionId?: string
}

/** GET the binding state and unwrap the route envelope. */
async function readState(sessionId: string, signal?: AbortSignal): Promise<StatePayload> {
  const response = await fetch(`${ROUTE_PREFIX}${ROUTE_STATE}?sessionId=${encodeURIComponent(sessionId)}`, { signal })
  const body = (await response.json()) as Envelope<StatePayload>
  if (!body.ok || body.data === undefined) throw new Error(body.error ?? `request failed (${response.status})`)
  return body.data
}

/** POST the switch. The host revokes an already-injected body on the way out. */
async function writeSwitch(sessionId: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${ROUTE_PREFIX}${ROUTE_INJECTION}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, enabled }),
  })
  const body = (await response.json()) as Envelope<unknown>
  if (!body.ok) throw new Error(body.error ?? `request failed (${response.status})`)
}

/**
 * Whether the entry has anything to say.
 *
 * Exported because it is the one piece of this component with a rule rather than
 * a layout: an unbound session must gain no chrome, and a switched-off one must
 * still show (it is the only surface that can switch injection back on before
 * the first message). `null` means "not read yet", which is not the same answer.
 * @param state - the last binding state read, or `null` while unknown.
 * @returns `true` when the entry should render (and narrows the argument, so the
 *   component body never re-checks it).
 */
export function injectionBarVisible(state: StatePayload | null): state is StatePayload {
  return state !== null && state.ref.source !== 'none'
}

/**
 * The entry itself.
 * @param props - the slot's standard props, of which only `sessionId` is read.
 * @returns one line naming the note and its switch, or `null` when nothing is bound.
 */
export function InjectionBar(props: InjectionBarProps) {
  const t = useBoardStrings()
  const [state, setState] = useState<StatePayload | null>(null)
  const sessionId = props.sessionId

  const load = useCallback(async (signal?: AbortSignal) => {
    if (sessionId === undefined) return
    try {
      setState(await readState(sessionId, signal))
    } catch {
      // A failed poll keeps the last known state rather than replacing it with
      // an error banner: this entry is an affordance, the board owns diagnosis,
      // and a chip that blinks out on one bad poll is worse than a stale one.
    }
  }, [sessionId])

  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => { void load(controller.signal) }, POLL_MS)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [sessionId, load])

  const toggle = useCallback(async (enabled: boolean) => {
    if (sessionId === undefined) return
    try {
      await writeSwitch(sessionId, enabled)
    } finally {
      // Re-read either way: on failure the truth is whatever the host still
      // says, and showing the pre-click state would be a claim we cannot back.
      await load()
    }
  }, [sessionId, load])

  // Unbound sessions get nothing: there is no switch to offer, and the board's
  // own landing page is where "attach or discover one" is explained.
  if (sessionId === undefined || !injectionBarVisible(state)) return null
  const off = state.ref.source === 'off'
  return h('div', {
    style: {
      // The dock is a full-width strip above the composer card; aligning its
      // content to the conversation's own column keeps it under the text rather
      // than under the pane's edge.
      ...CONTENT_COLUMN,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      fontSize: 12, color: T.dim, padding: '0 4px 6px',
    },
  },
  h('span', { style: { color: off ? T.warn : T.text, fontWeight: 600 } },
    `${t.dockNote} · ${state.ref.title === '' ? t.dockMissing : state.ref.title}`),
  h('span', {
    style: {
      fontSize: 10, borderRadius: 6, padding: '0 6px', lineHeight: '16px',
      color: off ? T.warn : T.dim, border: `1px solid ${off ? T.warn : T.borderStrong}`,
    },
  }, off ? t.dockOff : t.dockOn),
  state.ref.title !== '' && !state.exists
    ? h('span', { style: { color: T.warn, fontSize: 11 } }, t.dockMissing)
    : null,
  h('span', { style: { marginLeft: 'auto' } },
    off
      ? h(Button, { label: t.injectOn, title: t.injectOnTitle, onClick: () => { void toggle(true) }, tone: 'accent' })
      : h(Button, { label: t.injectOff, title: t.injectOffTitle, onClick: () => { void toggle(false) } })))
}

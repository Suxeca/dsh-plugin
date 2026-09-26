/**
 * The 笔记看板 / Note board Conversation View.
 *
 * Three segments over one question — "what is available, what is confirmed, and
 * what did the auditors say":
 *
 *   · 笔记目录       every note on this machine, and which one this session uses
 *   · 笔记正文   the session's bound note, as Markdown with KaTeX math
 *   · 审计判决       that note's adversarial-audit verdicts
 *
 * The binding is **per session** and the board says so. It used to read one
 * globally fixed path, which meant every conversation showed one project’s note whether
 * or not it had anything to do with that project, and nothing in the UI admitted that a
 * choice had been made.
 *
 * A session with no note lands on the catalogue rather than on an error: that is
 * not a broken state, it is the state in which you are supposed to *choose*.
 *
 * Rendering goes through `MarkdownText` from the platform's UI primitives, which
 * teaches this view TeX for free: that package is a shell module-table entry, so
 * its KaTeX pipeline is already loaded and this bundle ships no math renderer of
 * its own.
 *
 * Every string comes from `./i18n.ts`. Nothing that reaches the screen is a
 * literal, and nothing that goes into state is translated text — a problem is
 * stored as its *cause* and rendered in the active language, so switching
 * languages re-translates what is already on screen instead of leaving the old
 * language frozen in a `useState`.
 *
 * @module @suxeca/dsh-note-board/client/Body
 */
import { Component, createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AuditFile, AuditsPayload, CatalogPayload, Envelope, LedgerPayload, LedgerRef,
} from '../shared.ts'
import { ROUTE_ATTACH, ROUTE_AUDITS, ROUTE_CATALOG, ROUTE_DETACH, ROUTE_LEDGER, ROUTE_PREFIX } from '../shared-routes.ts'
import { CatalogView } from './Catalog.tsx'
import { boardStrings, markdownLabels, toggleBoardLocale, useBoardLocale, useBoardStrings, type BoardStrings } from './i18n.ts'
import { CONTENT_COLUMN, T } from './theme.ts'

/**
 * Renders whatever a broken child threw, instead of nothing.
 *
 * A view that throws during render unmounts its whole subtree — including the
 * toolbar — and the human sees an empty panel with no clue why. That is the
 * worst possible failure for a *diagnostic* board: it looks like "the note is
 * empty" rather than "this view is broken". The boundary costs one class and
 * turns a silent blank into a readable error.
 *
 * The heading is read at render time from the current locale rather than passed
 * in: a boundary that catches a throw must not itself depend on props that the
 * failed subtree was responsible for.
 */
class BoardErrorBoundary extends Component<{ readonly children: ReactNode }, { error: Error | null }> {
  constructor(props: { readonly children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override render(): ReactNode {
    const error = this.state.error
    if (error === null) return this.props.children
    const t = boardStrings()
    return h('div', {
      style: {
        padding: '14px 16px', fontSize: 12, lineHeight: '19px', color: T.error,
        background: T.surface, height: '100%', overflow: 'auto', boxSizing: 'border-box',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap',
      },
    }, t.renderFailed(`${String(error.message)}\n\n${String(error.stack ?? '')}`))
  }
}

/** How often the view re-reads its sources, in milliseconds. */
const POLL_MS = 5000

/** Which pane is showing. */
type Segment = 'catalog' | 'ledger' | 'audit'

/**
 * Something went wrong, stored as a **cause** rather than as text.
 *
 * The distinction matters: this state can outlive a language switch, so holding
 * a rendered sentence would leave the previous language on screen until the next
 * poll happened to fail again.
 *
 * `attach` messages are the one exception — they are composed by the host
 * (`routes.ts` / `ledgers.ts`) and arrive as a finished sentence, which the
 * client passes through rather than trying to re-translate.
 */
type Problem =
  | { readonly kind: 'no-session' }
  | { readonly kind: 'read', readonly message: string }
  | { readonly kind: 'empty-path' }
  | { readonly kind: 'attach', readonly message: string }

/** Render a problem in the active language. */
function problemText(problem: Problem, t: BoardStrings): string {
  switch (problem.kind) {
    case 'no-session': return t.noSessionId
    case 'read': return t.readFailed(problem.message)
    case 'empty-path': return t.attachPathEmpty
    case 'attach': return problem.message
  }
}

/** GET one host route and unwrap the envelope. */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, { signal })
  const body = (await response.json()) as Envelope<T>
  if (!body.ok) throw new Error(body.error ?? `request failed (${response.status})`)
  return body.data as T
}

/** POST one host route and unwrap the envelope. */
async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json()) as Envelope<T>
  if (!body.ok) throw new Error(body.error ?? `request failed (${response.status})`)
  return body.data as T
}

/** `HH:MM:SS` for the freshness line. */
function clock(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour12: false })
}

/** How the binding was reached, in the human's words. */
function sourceLabel(ref: LedgerRef, t: BoardStrings): { text: string, color: string } {
  switch (ref.source) {
    case 'attached': return { text: t.sourceAttached, color: T.accent }
    case 'discovered': return { text: t.sourceDiscovered, color: T.dim }
    default: return { text: t.sourceNone, color: T.warn }
  }
}

/** One selectable segment in the toolbar. */
function Segment(props: {
  readonly label: string
  readonly active: boolean
  readonly badge?: string
  readonly onClick: () => void
}) {
  return h('button', {
    type: 'button',
    onClick: props.onClick,
    style: {
      appearance: 'none',
      border: 'none',
      borderRadius: 6,
      padding: '4px 12px',
      cursor: 'pointer',
      fontSize: 13,
      lineHeight: '20px',
      background: props.active ? T.accent : 'transparent',
      color: props.active ? '#fff' : T.dim,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
    },
  },
  props.label,
  props.badge !== undefined && props.badge !== ''
    ? h('span', {
        style: {
          fontSize: 10,
          padding: '0 5px',
          borderRadius: 8,
          background: props.active ? 'rgba(255,255,255,0.24)' : 'rgba(128,128,128,0.22)',
          color: props.active ? '#fff' : T.dim,
        },
      }, props.badge)
    : null)
}

/** A small outlined button. */
function Button(props: {
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

/**
 * The header: which note this session is bound to, and how that was decided.
 *
 * This exists because the previous design's worst property was that its binding
 * was invisible — you could not tell which note you were reading, or that a
 * choice had been made at all.
 *
 * ## The prop is `ledgerRef`, and that name is load-bearing
 *
 * It used to be called `ref`. `ref` and `key` are the two props React *consumes*
 * rather than forwards: `createElement` pulls them out of the config and never
 * places them in `props`. So the caller's `{ ref }` vanished, `props.ref` was
 * `undefined`, the `=== null` guard below did not fire (it guards `null`, not
 * `undefined`), and `sourceLabel(undefined)` threw on `.source`. The whole board
 * unmounted, which read as "this session has no note" — the most misleading
 * possible symptom, and the reason the board looked blank for a whole session of
 * debugging. Renaming the prop is the fix; do not rename it back.
 */
function BindingBar(props: {
  readonly ledgerRef: LedgerRef | null
  readonly onDetach: () => void
  readonly onCatalog: () => void
}) {
  const t = useBoardStrings()
  const ref = props.ledgerRef
  if (ref === null || ref === undefined) {
    return h('div', { style: { fontSize: 12, color: T.dim, padding: '0 2px 8px' } }, t.loading)
  }
  const source = sourceLabel(ref, t)
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      fontSize: 12, padding: '0 2px 8px',
    },
  },
  ref.source === 'none'
    ? h('span', { style: { color: T.warn, fontWeight: 600 } }, t.unboundTitle)
    : h('span', { style: { color: T.text, fontWeight: 600 } }, '∑ ' + ref.title),
  h('span', {
    style: {
      fontSize: 10, color: source.color,
      border: `1px solid ${ref.source === 'attached' ? T.accent : T.borderStrong}`,
      borderRadius: 6, padding: '0 6px', lineHeight: '16px',
    },
  }, source.text),
  ref.source !== 'none'
    ? h('span', { style: { color: T.dim, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 } }, ref.path)
    : null,
  ref.source === 'discovered' && ref.root !== undefined
    ? h('span', { style: { color: T.dim, fontSize: 11 } }, t.discoveryOrigin(ref.root))
    : null,
  h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
    h(Button, { label: t.changeNote, title: t.changeNoteTitle, onClick: props.onCatalog }),
    ref.source === 'attached'
      ? h(Button, { label: t.detach, title: t.detachTitle, onClick: props.onDetach })
      : null))
}

/**
 * The line that answers "is what I am reading the same thing the model gets?".
 *
 * The board shows the whole file; the injector sends only the first
 * `injectBudget` characters each turn. When the file outgrows that, the two
 * silently diverge — so say it here rather than let the human assume.
 */
function AbsorptionLine(props: { readonly ledger: LedgerPayload | null }) {
  const t = useBoardStrings()
  const ledger = props.ledger
  if (ledger === null || !ledger.exists) return null
  const chars = ledger.text.length
  const over = chars > ledger.injectBudget
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, lineHeight: '16px',
      padding: '6px 10px', marginBottom: 8, borderRadius: 6,
      background: T.panel, border: `1px solid ${over ? T.warn : T.border}`,
      color: over ? T.warn : T.dim,
    },
  },
  h('span', { style: { flex: 'none' } }, over ? '⚠' : '✓'),
  h('span', null, over
    ? t.absorbOver(chars, ledger.injectBudget)
    : t.absorbOk(chars, ledger.injectBudget)),
  h('span', { style: { marginLeft: 'auto', flex: 'none', color: T.dim } },
    over ? t.absorbOverHint : t.absorbOkHint))
}

/** One collapsed-by-default audit verdict. */
function Verdict(props: {
  readonly file: AuditFile
  readonly open: boolean
  readonly onToggle: () => void
}) {
  const t = useBoardStrings()
  const title = props.file.name.replace(/\.md(\.consumed)?$/, '')
  return h('div', {
    style: { border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 8, background: T.panel, overflow: 'hidden' },
  },
  h('button', {
    type: 'button',
    onClick: props.onToggle,
    style: {
      appearance: 'none', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
      color: T.text, cursor: 'pointer', padding: '9px 12px',
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
    },
  },
  h('span', { style: { flex: 'none', color: T.dim, width: 10 } }, props.open ? '▾' : '▸'),
  h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
  props.file.consumed
    ? h('span', { style: { flex: 'none', fontSize: 10, color: T.dim, border: `1px solid ${T.borderStrong}`, borderRadius: 6, padding: '1px 6px' } }, t.consumed)
    : h('span', { style: { flex: 'none', fontSize: 10, color: '#fff', background: T.warn, borderRadius: 6, padding: '1px 6px' } }, t.awaitingFeedback),
  h('span', { style: { flex: 'none', color: T.dim, fontSize: 10 } }, clock(props.file.mtime, t.dateLocale)),
  ),
  props.open
    ? h('div', { style: { padding: '6px 14px 12px', borderTop: `1px solid ${T.border}`, background: T.raised } },
        h(MarkdownText, { text: props.file.text, labels: markdownLabels(t) }))
    : null)
}

/** Props this view reads. `conversation.view` supplies `sessionId` directly. */
export interface NoteBoardViewProps {
  readonly sessionId?: string
}

/**
 * The view.
 * @returns the Conversation View body.
 */
function Board({ sessionId }: NoteBoardViewProps) {
  const t = useBoardStrings()
  const locale = useBoardLocale()
  const [segment, setSegment] = useState<Segment>('ledger')
  const [ledger, setLedger] = useState<LedgerPayload | null>(null)
  const [audits, setAudits] = useState<AuditsPayload | null>(null)
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [attachProblem, setAttachProblem] = useState<Problem | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const [openVerdict, setOpenVerdict] = useState<string | null>(null)
  /** Whether the landing pane has been chosen. See the effect below. */
  const landed = useRef(false)

  const sid = sessionId ?? ''

  const load = useCallback(async (signal?: AbortSignal) => {
    if (sid === '') {
      // Without a session id the board cannot know which note is meant, and
      // guessing one is exactly the failure being fixed. Say so.
      setProblem({ kind: 'no-session' })
      return
    }
    try {
      const query = `?sessionId=${encodeURIComponent(sid)}`
      const [nextLedger, nextAudits, nextCatalog] = await Promise.all([
        getJson<LedgerPayload>(ROUTE_LEDGER + query, signal),
        getJson<AuditsPayload>(ROUTE_AUDITS + query, signal),
        getJson<CatalogPayload>(ROUTE_CATALOG + query, signal),
      ])
      setLedger(nextLedger)
      setAudits(nextAudits)
      setCatalog(nextCatalog)
      setProblem(null)
      setAt(Date.now())
      // Land on the catalogue only when there is nothing bound — a session that
      // already has a note should open on it, not make you click past an index
      // every time. Only the FIRST answer decides: after that, the pane is the
      // human's, and silently yanking them out of the note because a poll
      // happened to race an attach would be worse than any default.
      if (!landed.current) {
        landed.current = true
        if (nextLedger.ref.source === 'none') setSegment('catalog')
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return
      setProblem({ kind: 'read', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [sid])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    // The interval deliberately loads WITHOUT the abort signal: sharing it would
    // let the first unmount abort every later poll, and each poll is a fresh
    // request anyway.
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [load])

  const attach = useCallback(async (path: string) => {
    if (path.trim() === '') {
      setAttachProblem({ kind: 'empty-path' })
      return
    }
    setBusyPath(path)
    try {
      await postJson(ROUTE_ATTACH, { sessionId: sid, path: path.trim() })
      setAttachProblem(null)
      // Attaching is a request to *read* this note, so go there. Leaving the
      // human on the index after a successful attach would make the action look
      // like it did nothing.
      setSegment('ledger')
      await load()
    } catch (cause) {
      setAttachProblem({ kind: 'attach', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusyPath(null)
    }
  }, [sid, load])

  const detach = useCallback(async () => {
    try {
      await postJson(ROUTE_DETACH, { sessionId: sid })
      await load()
    } catch (cause) {
      setAttachProblem({ kind: 'attach', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [sid, load])

  const ref = ledger?.ref ?? null
  const unbound = ref !== null && ref.source === 'none'
  const verdicts = audits?.files ?? []
  const pending = verdicts.filter(file => !file.consumed).length

  /** The note pane, which is also what an unbound session shows behind a hint. */
  const ledgerPane = () => {
    if (unbound) {
      return h('div', { style: { color: T.dim, fontSize: 13, padding: '12px 2px', lineHeight: '22px' } },
        t.unboundHintLead,
        h('button', {
          type: 'button',
          onClick: () => setSegment('catalog'),
          style: {
            appearance: 'none', border: 'none', background: 'transparent', color: T.accent,
            cursor: 'pointer', fontSize: 13, padding: '0 4px', textDecoration: 'underline',
          },
        }, t.segmentCatalog),
        t.unboundHintTail)
    }
    if (ledger === null) {
      return h('div', { style: { color: T.dim, fontSize: 13, padding: '12px 2px' } }, t.loading)
    }
    if (!ledger.exists) {
      return h('div', { style: { color: T.dim, fontSize: 13, padding: '12px 2px' } }, t.noteMissing)
    }
    return h('div', null,
      h(AbsorptionLine, { ledger }),
      h(MarkdownText, { text: ledger.text, labels: markdownLabels(t) }))
  }

  const auditPane = () => (unbound
    ? h('div', { style: { color: T.dim, fontSize: 13, padding: '12px 2px' } }, t.auditUnbound)
    : (verdicts.length === 0
        ? h('div', { style: { color: T.dim, fontSize: 13, padding: '12px 2px', lineHeight: '22px' } }, t.auditEmpty)
        : h('div', null,
            pending > 0
              ? h('div', { style: { fontSize: 12, color: T.warn, marginBottom: 10 } }, t.auditPending(pending))
              : null,
            ...verdicts.map(file => h(Verdict, {
              key: file.name,
              file,
              open: openVerdict === file.name,
              onToggle: () => setOpenVerdict(current => (current === file.name ? null : file.name)),
            })))))

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
      minHeight: 0, boxSizing: 'border-box', overflow: 'hidden',
      background: T.surface, color: T.text,
    },
  },
  // ── toolbar ────────────────────────────────────────────────────────────
  // The bar itself spans the pane so its rule and background line up with the
  // conversation chrome, but its *controls* are constrained to the content
  // column: DSH's column drag strip begins 24px outside that column, so a
  // control pinned to the pane's right edge (`刷新` used to be) sits inside the
  // strip and steals the resize gesture. See CONTENT_COLUMN.
  h('div', {
    style: {
      padding: '10px 16px 8px',
      borderBottom: `1px solid ${T.border}`, background: T.panel, flex: 'none',
    },
  },
  h('div', {
    style: {
      ...CONTENT_COLUMN,
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', rowGap: 6,
    },
  },
  h(Segment, {
    label: t.segmentCatalog,
    active: segment === 'catalog',
    badge: catalog !== null && catalog.entries.length > 0 ? String(catalog.entries.length) : '',
    onClick: () => setSegment('catalog'),
  }),
  // A rule, because 目录 is navigation while the other two are views of the
  // note you got to through it.
  h('span', { style: { width: 1, height: 18, background: T.borderStrong, margin: '0 4px' } }),
  h(Segment, {
    label: t.segmentLedger,
    active: segment === 'ledger',
    badge: unbound ? '' : '●',
    onClick: () => setSegment('ledger'),
  }),
  h(Segment, {
    label: t.segmentAudit,
    active: segment === 'audit',
    badge: verdicts.length > 0 ? String(verdicts.length) : '',
    onClick: () => setSegment('audit'),
  }),
  // The language switch sits with the refresh button rather than in a settings
  // page: both are "how this pane presents itself", and the label on the button
  // is the language it will switch *to*, so the current state needs no extra
  // chrome to be legible. It writes the platform's locale preference, so the
  // tab above and the rest of DSH follow — see i18n.ts for why a board-local
  // override cannot work here.
  h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
    h(Button, {
      label: t.languageToggle,
      title: locale === 'zh' ? t.switchToEnglish : t.switchToChinese,
      onClick: toggleBoardLocale,
    }),
    h(Button, { label: t.refresh, onClick: () => { void load() } })),
  )),
  // ── content ────────────────────────────────────────────────────────────
  h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 32px' } },
  h('div', { style: CONTENT_COLUMN },
    segment === 'catalog'
      ? h(CatalogView, {
          catalog,
          problem: problem === null ? null : problemText(problem, t),
          attachProblem: attachProblem === null ? null : problemText(attachProblem, t),
          busyPath,
          onAttach: (path) => { void attach(path) },
          onRefresh: () => { void load() },
        })
      : h('div', null,
          h(BindingBar, { ledgerRef: ref, onDetach: () => { void detach() }, onCatalog: () => setSegment('catalog') }),
          problem !== null
            ? h('div', { style: { color: T.error, fontSize: 12, padding: '0 2px 10px' } }, problemText(problem, t))
            : null,
          // Shown here as well as in the index, because 解附 is pressed from
          // this pane: a failure that reported itself only on a screen the human
          // is not looking at would be silent.
          attachProblem !== null
            ? h('div', { style: { color: T.error, fontSize: 12, padding: '0 2px 10px' } }, problemText(attachProblem, t))
            : null,
          segment === 'ledger' ? ledgerPane() : auditPane()),
    at > 0
      ? h('div', { style: { fontSize: 11, color: T.dim, marginTop: 12, textAlign: 'right' } }, t.refreshedAt(clock(at, t.dateLocale)))
      : null,
  )))
}

/**
 * The registered view: the board inside its error boundary.
 *
 * The boundary must be OUTSIDE the component whose render can throw, so this is
 * the one the slot gets and `Board` is the implementation.
 * @param props - the slot's standard props.
 * @returns the board, or a readable render error instead of a blank panel.
 */
export function NoteBoardView(props: NoteBoardViewProps) {
  return h(BoardErrorBoundary, null, h(Board, props))
}

/**
 * 笔记目录 / Note index — the board's entry screen.
 *
 * The board used to open straight onto whichever note happened to be bound,
 * which assumed the human already knew what existed. They did not: the whole
 * point of per-session binding is that a session may be bound to nothing, and
 * you cannot attach what you cannot see.
 *
 * So this lists every note on the machine with enough information to choose
 * between them — how big, how many frozen definitions, how many verdicts, when
 * it last moved — and attaching one from here is what binds it to this session.
 * The line under the title is deliberate: attaching is not just "show me", it is
 * "inject this into every turn from now on", and a UI that hid that would make
 * the human guess what they had just done.
 *
 * @module @suxeca/dsh-note-board/client/Catalog
 */
import { createElement as h, useState } from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogPayload, LedgerEntry } from '../shared.ts'
import { useBoardStrings, type BoardStrings } from './i18n.ts'
import { T } from './theme.ts'

/** Human-readable size. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** `YYYY-MM-DD HH:MM`, or a relative phrase for recent edits. */
function when(ms: number, t: BoardStrings): string {
  const delta = Date.now() - ms
  if (delta < 60_000) return t.justNow
  if (delta < 3_600_000) return t.minutesAgo(Math.floor(delta / 60_000))
  if (delta < 86_400_000) return t.hoursAgo(Math.floor(delta / 3_600_000))
  return new Date(ms).toLocaleString(t.dateLocale, {
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** A proportional bar showing what a note is made of. */
function Composition(props: { readonly entry: LedgerEntry }) {
  const t = useBoardStrings()
  const e = props.entry
  const other = Math.max(0, e.sections - e.frozen - e.verdicts - e.open)
  const parts: Array<{ n: number, color: string, label: string }> = [
    { n: e.frozen, color: T.accent, label: t.frozen },
    { n: e.verdicts, color: T.ok, label: t.verdictsCount },
    { n: e.open, color: T.warn, label: t.openCount },
    { n: other, color: T.borderStrong, label: t.otherCount },
  ].filter(part => part.n > 0)
  if (e.sections === 0) return null
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
    h('div', {
      style: { display: 'flex', height: 4, flex: 1, borderRadius: 2, overflow: 'hidden', background: T.border },
    }, ...parts.map(part => h('div', {
      key: part.label,
      style: { width: `${(part.n / e.sections) * 100}%`, background: part.color },
    }))),
    h('div', { style: { display: 'flex', gap: 8, fontSize: 10, color: T.dim, flex: 'none' } },
      ...parts.map(part => h('span', { key: part.label },
        h('span', { style: { display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: part.color, marginRight: 3 } }),
        t.compositionLegend(part.label, part.n)))))
}

/** One note card. */
function Card(props: {
  readonly entry: LedgerEntry
  readonly busy: boolean
  readonly onAttach: (path: string) => void
}) {
  const t = useBoardStrings()
  const e = props.entry
  const gone = !e.present
  return h('div', {
    style: {
      border: `1px solid ${e.bound ? T.accent : T.border}`,
      borderRadius: 10,
      background: T.panel,
      padding: '12px 14px',
      opacity: gone ? 0.55 : 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    },
  },
  h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
    // The file-type glyph rather than a custom mark: these are Markdown files,
    // and reusing the platform's icon keeps the board consistent with every
    // other file surface in DSH.
    h('div', {
      style: {
        flex: 'none', width: 34, height: 34, borderRadius: 8, background: T.raised,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text,
      },
    }, h(FileTypeIcon, { path: e.path, size: 20 })),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('span', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, e.title),
        e.bound
          ? h('span', { style: { fontSize: 10, color: '#fff', background: T.accent, borderRadius: 6, padding: '1px 6px' } }, t.currentSession)
          : null,
        e.pendingAudits > 0
          ? h('span', { style: { fontSize: 10, color: '#fff', background: T.warn, borderRadius: 6, padding: '1px 6px' } }, t.pendingAuditsBadge(e.pendingAudits))
          : null,
        gone
          ? h('span', { style: { fontSize: 10, color: T.error, border: `1px solid ${T.error}`, borderRadius: 6, padding: '1px 6px' } }, t.fileGone)
          : null),
      h('div', {
        title: e.path,
        style: { fontSize: 11, color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, e.path)),
    !e.bound && !gone
      ? h('button', {
          type: 'button',
          disabled: props.busy,
          onClick: () => props.onAttach(e.path),
          style: {
            flex: 'none', appearance: 'none', border: `1px solid ${T.accent}`, borderRadius: 6,
            background: 'transparent', color: T.accent, cursor: props.busy ? 'default' : 'pointer',
            fontSize: 12, padding: '4px 11px', opacity: props.busy ? 0.5 : 1,
          },
        }, t.attach)
      : null),
  h('div', { style: { display: 'flex', gap: 12, fontSize: 11, color: T.dim, marginTop: 6, flexWrap: 'wrap' } },
    h('span', null, size(e.bytes)),
    h('span', null, t.sections(e.sections)),
    gone ? null : h('span', null, when(e.mtime, t))),
  h(Composition, { entry: e }),
  )
}

/** The catalogue screen. */
export function CatalogView(props: {
  readonly catalog: CatalogPayload | null
  /** A read failure, already rendered in the active language. */
  readonly problem: string | null
  /** An attach/detach failure, already rendered in the active language. */
  readonly attachProblem: string | null
  readonly busyPath: string | null
  readonly onAttach: (path: string) => void
  readonly onRefresh: () => void
}) {
  const t = useBoardStrings()
  const [draft, setDraft] = useState('')
  const entries = props.catalog?.entries ?? []
  const roots = props.catalog?.roots ?? []

  return h('div', null,
  h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' } },
    h('span', { style: { fontSize: 15, fontWeight: 600, color: T.text } }, t.catalogTitle),
    h('span', { style: { fontSize: 12, color: T.dim } },
      props.catalog === null
        ? t.scanning
        : t.catalogCount(entries.length, roots.join(t.emptyHintOr) || t.noScanRoots)),
    h('span', { style: { marginLeft: 'auto' } },
      h('button', {
        type: 'button',
        onClick: props.onRefresh,
        style: {
          appearance: 'none', border: `1px solid ${T.borderStrong}`, borderRadius: 6,
          background: 'transparent', color: T.dim, cursor: 'pointer', fontSize: 12, padding: '4px 11px',
        },
      }, t.rescan))),
  h('div', { style: { fontSize: 11, color: T.dim, marginBottom: 14, lineHeight: '17px' } },
    t.attachExplain,
    t.attachExplainTail),
  props.problem !== null
    ? h('div', { style: { color: T.error, fontSize: 12, marginBottom: 12 } }, props.problem)
    : null,
  props.attachProblem !== null
    ? h('div', { style: { color: T.error, fontSize: 12, marginBottom: 12 } }, props.attachProblem)
    : null,
  entries.length === 0 && props.catalog !== null
    ? h('div', {
        style: {
          border: `1px solid ${T.border}`, borderRadius: 10, background: T.panel,
          padding: '18px 16px', fontSize: 13, color: T.dim, lineHeight: '21px',
        },
      },
      t.emptyTitle,
      h('div', { style: { marginTop: 6, fontSize: 12 } },
        t.emptyHintLead,
        // Built from what the host actually searched for, not from a literal:
        // a hard-coded hint would contradict an overridden `ledgerFiles`.
        ...props.catalog.files.flatMap((file, index) => (index === 0
          ? [h('code', { key: file }, file)]
          : [t.emptyHintOr, h('code', { key: file }, file)])),
        t.emptyHintTail))
    : h('div', {
        style: {
          display: 'grid',
          // `min(340px, 100%)`, not a bare `340px`: a minimum track wider than
          // the container makes the grid overflow horizontally, which pushes the
          // cards out of the pane and under the column drag strip. With the
          // `min()` the track simply becomes the container width in a narrow
          // pane and the layout degrades instead of escaping.
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))',
          gap: 10,
        },
      }, ...entries.map(entry => h(Card, {
        key: entry.path,
        entry,
        busy: props.busyPath === entry.path,
        onAttach: props.onAttach,
      }))),
  h('div', { style: { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}` } },
    h('div', { style: { fontSize: 11, color: T.dim, marginBottom: 6 } }, t.attachPathLabel),
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      h('input', {
        value: draft,
        placeholder: t.attachPathPlaceholder,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        style: {
          // `minWidth: 0` with a basis, not `minWidth: 260`: a non-shrinkable
          // minimum wider than a narrow pane forces this row — and the 附加
          // button after it — out past the right edge.
          flex: '1 1 200px', minWidth: 0, background: T.raised, color: T.text,
          border: `1px solid ${T.borderStrong}`, borderRadius: 6,
          padding: '5px 9px', fontSize: 12, fontFamily: 'inherit',
        },
      }),
      h('button', {
        type: 'button',
        onClick: () => props.onAttach(draft),
        style: {
          appearance: 'none', border: `1px solid ${T.accent}`, borderRadius: 6,
          background: 'transparent', color: T.accent, cursor: 'pointer', fontSize: 12, padding: '5px 13px',
        },
      }, t.attach))))
}

/**
 * The content-boundary view: which sections are *definitions*, and which read
 * like records of a run.
 *
 * Why this exists, in the user's words: "很多像是记忆的东西都进笔记里面去了…
 * 以后要做发散性的东西，就会被当初有时效的制约或低质量的制约限制住". The note is
 * injected every turn as framework knowledge, so an anecdote written into it does
 * not merely cost characters — it becomes a **constraint** on later work: a
 * device fault or a dead-end algorithm from one session quietly bounds the next.
 * Those records belong in a run log or a session-memory tool (deja / memsearch).
 *
 * The plugin cannot decide that for the human, and must not edit the note. What
 * it can do is make the drift visible where the note is read: flag the section,
 * show the words that triggered the flag, and say where such content belongs.
 *
 * Sizes and "changed" are kept — they are already computed, and "changed" is the
 * second half of the same story (a section that keeps moving is being used as a
 * log) — but they are not the headline. The budget number is not the problem.
 *
 * @module @suxeca/dsh-note-board/client/Budget
 */
import { createElement as h } from 'react'
import type { LedgerPayload, LedgerSectionRow } from '../shared.ts'
import type { BoardStrings } from './i18n.ts'
import { useBoardStrings } from './i18n.ts'
import { T } from './theme.ts'

/** The class chip's words. */
function classLabel(cls: LedgerSectionRow['cls'], t: BoardStrings): string {
  switch (cls) {
    case 'resident': return t.classResident
    case 'onDemand': return t.classOnDemand
    case 'log': return t.classLog
  }
}

/** Suspected run records first, then what moved, then the biggest. */
function order(rows: readonly LedgerSectionRow[]): readonly LedgerSectionRow[] {
  const rank = (row: LedgerSectionRow): number => (row.smell === undefined ? 0 : 2) + (row.changed ? 1 : 0)
  return [...rows].sort((a, b) => (rank(b) - rank(a)) || (b.chars - a.chars))
}

/**
 * One collapsed list of every section, with the boundary signal on top.
 * @param props - the ledger whose sections to list; `null` while loading.
 * @returns the details block, or `null` when there is nothing to report.
 */
export function BudgetDetails(props: { readonly ledger: LedgerPayload | null }) {
  const t = useBoardStrings()
  const ledger = props.ledger
  const rows = ledger?.sections
  if (ledger === null || !ledger.exists || rows === undefined || rows.length === 0) return null
  const suspected = rows.filter(row => row.smell !== undefined)
  const changed = rows.filter(row => row.changed).length
  const summary = [
    t.budgetTitle,
    `${rows.length}`,
    ...(suspected.length === 0 ? [] : [`${t.hygieneSmell} ${suspected.length}`]),
    ...(changed === 0 ? [] : [`${t.budgetChanged} ${changed}`]),
  ].join(' · ')
  return h('details', { style: { marginBottom: 10 } },
    h('summary', {
      style: { cursor: 'pointer', fontSize: 11, color: suspected.length === 0 ? T.dim : T.warn },
    }, summary),
    h('div', { style: { marginTop: 6 } },
      suspected.length === 0
        ? null
        : h('div', {
            style: {
              fontSize: 11, lineHeight: '17px', marginBottom: 8, padding: '6px 8px', borderRadius: 6,
              background: T.panel, border: `1px solid ${T.warn}`, color: T.warn,
            },
          }, t.hygieneSmellHint),
      h('div', { style: { color: T.dim, fontSize: 11, lineHeight: '17px', marginBottom: 6 } }, t.budgetHint),
      ledger.baselineAt === null || ledger.baselineAt === undefined
        ? h('div', { style: { color: T.dim, fontSize: 11, marginBottom: 6 } }, t.budgetNoBaseline)
        : null,
      ...order(rows).map(row => h('div', {
        key: row.id,
        style: {
          display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, lineHeight: '18px',
          color: row.smell === undefined ? (row.changed ? T.warn : T.dim) : T.warn,
        },
      },
      h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, row.id),
      h('span', {
        style: {
          fontSize: 10, borderRadius: 5, padding: '0 5px', lineHeight: '15px',
          border: `1px solid ${row.cls === 'log' ? T.border : T.borderStrong}`,
        },
      }, classLabel(row.cls, t)),
      row.smell === undefined
        ? null
        : h('span', {
            style: { fontSize: 10, borderRadius: 5, padding: '0 5px', lineHeight: '15px', border: `1px solid ${T.warn}` },
          }, `${t.hygieneSmell}${row.markers === undefined || row.markers.length === 0 ? '' : `：${row.markers.join(' ')}`}`),
      h('span', { style: { marginLeft: 'auto' } }, t.budgetChars(row.chars)),
      row.changed ? h('span', { style: { fontWeight: 600 } }, t.budgetChanged) : null)),
    ))
}

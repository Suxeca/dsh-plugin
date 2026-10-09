/**
 * Per-section size, and what has moved since the last **injected** baseline.
 *
 * This is the one signal that separates a note used as knowledge from a note
 * used as a log: frozen definitions do not change between sessions, process
 * notes change every time. Before it, the only symptom of the second usage was a
 * resident total quietly crossing the soft budget — a number with no owner.
 *
 * It lives beside the two callers that need it rather than inside either: the
 * board's ledger route (which renders it) and `/note-board status` (the text
 * channel that still answers when the board's renderer is the thing that broke).
 * Both must report the same thing, so there is one implementation.
 *
 * The hashes and the path guard are shared with the delta notice on purpose: a
 * second implementation that normalised whitespace differently would tell the
 * human a section is stable while the model is being told it changed.
 *
 * @module @suxeca/dsh-note-board/host/budget
 */
import { DEFAULT_RUN_LOG_SECTIONS, type NoteSelection } from '../sections.ts'
import type { LedgerRef, LedgerSectionRow } from '../shared.ts'
import { fingerprintPathFor, readFingerprints, type LedgerFingerprint } from './fingerprints.ts'
import { smellOfSection } from './hygiene.ts'
import { sectionFingerprints } from './inject.ts'
import type { LedgerDeps } from './ledgers.ts'

/** Everything the section census reads. */
export interface BudgetDeps extends LedgerDeps {
  readonly pinnedSections?: readonly string[]
  readonly runLogSections?: readonly string[]
}

/**
 * Size and freshness for every section, in document order.
 * @param deps - registry location and the section classification.
 * @param sessionId - whose baseline to compare against.
 * @param ref - the resolved binding; its path must match the baseline's.
 * @param text - the note as read, for hashing.
 * @param selection - the classified sections.
 * @returns the rows, plus when the baseline was written (`null` when none).
 */
export async function sectionRows(
  deps: BudgetDeps,
  sessionId: string,
  ref: LedgerRef,
  text: string,
  selection: NoteSelection,
): Promise<{ rows: readonly LedgerSectionRow[], baselineAt: number | null }> {
  const logs = deps.runLogSections ?? DEFAULT_RUN_LOG_SECTIONS
  let baseline: LedgerFingerprint | undefined
  try {
    baseline = (await readFingerprints(fingerprintPathFor(deps.registryPath)))[sessionId]
  } catch {
    // An unreadable baseline costs one honest "no baseline" answer, not an error
    // page: this is a diagnostic, and a diagnostic that fails closed when its own
    // bookkeeping is missing is useless exactly when it is needed.
    baseline = undefined
  }
  // A fingerprint for a different path describes a different note. Comparing
  // across the two would report every section as changed at once — the same
  // reason the delta notice only ever compares within one path.
  if (baseline !== undefined && baseline.path !== ref.path) baseline = undefined
  const current = sectionFingerprints(text, logs)
  const rows: LedgerSectionRow[] = []
  const push = (section: { id: string, text: string }, cls: LedgerSectionRow['cls']): void => {
    // Run logs are excluded from the fingerprint store, so "changed" is not a
    // fact about them; they are listed for their size only. They are also the
    // *right* home for run records, so the episodic signal would invert the
    // advice there — it is applied to knowledge sections only.
    const hash = current.get(section.id)
    const changed = cls !== 'log' && baseline !== undefined
      && hash !== undefined && baseline.sections[section.id] !== hash
    const smell = cls === 'log' ? null : smellOfSection(section.id, section.text)
    rows.push({
      id: section.id,
      cls,
      chars: section.text.length,
      changed,
      ...(smell === null ? {} : { smell: smell.smell, markers: smell.markers }),
    })
  }
  for (const section of selection.pinned) push(section, 'resident')
  for (const section of selection.onDemand) push(section, 'onDemand')
  for (const section of selection.logs) push(section, 'log')
  return { rows, baselineAt: baseline?.at ?? null }
}

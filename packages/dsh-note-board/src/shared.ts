/**
 * The wire shapes both halves agree on. Bootstrap-safe: no `node:*` import may
 * appear here, because the client bundle imports this module too.
 *
 * @module @suxeca/dsh-note-board/shared
 */

/** Every route answers this envelope. */
export interface Envelope<T> {
  readonly ok: boolean
  readonly data?: T
  readonly error?: string
}

/** How a session's ledger was decided, mirrored from the host resolver. */
/**
 * Where a session's note came from, or that it was deliberately switched off.
 *
 * `'off'` is distinct from `'none'` on purpose: the note may be perfectly
 * findable, but this session was told not to inject it — and the board has to be
 * able to say so, because a switch the human cannot see is the same defect as a
 * binding the human cannot see.
 */
export type LedgerSource = 'attached' | 'discovered' | 'none' | 'off'

/**
 * The ledger bound to one session.
 *
 * `source` travels to the UI on purpose: the whole defect this replaced was a
 * binding nobody could see, so the board states where its content came from
 * rather than presenting a path as if it were the only possibility.
 */
export interface LedgerRef {
  readonly source: LedgerSource
  /**
   * Absolute path, or `''` when nothing was found.
   *
   * Non-empty for `'off'` when the switch overrides a real binding: whoever
   * switched injection off still has to see *what* they switched off, and a
   * switch that names nothing is a switch nobody can check.
   */
  readonly path: string
  /** Short human label: the owning project's name. */
  readonly title: string
  /** For `'discovered'`: the ancestor directory the ledger was found under. */
  readonly root?: string
  /**
   * For `'off'`: the binding the switch is overriding.
   *
   * `'none'` means there was nothing to switch off — the opt-out is recorded,
   * but it hides nothing right now. Distinguishing the two keeps the board from
   * reporting a binding for a session that never had one.
   */
  readonly underlying?: 'attached' | 'discovered' | 'none'
}

/**
 * The binding state alone, without the note's text.
 *
 * The composer entry is polled while a conversation sits idle, so it must not
 * ask for the note: a twenty-kilobyte body every few seconds to render one chip
 * would make the cost of leaving a session open depend on the note's size. The
 * board's own `/ledger` route still serves the text; this route exists for the
 * caller that only needs to know *which* note and *whether it is injected*.
 */
export interface StatePayload {
  /** Which note, and how it was chosen — including what an `'off'` switch hides. */
  readonly ref: LedgerRef
  /** `true` when the bound file exists right now. */
  readonly exists: boolean
  /** The raw per-session switch, before resolution folds it into `'off'`. */
  readonly enabled: boolean
}

/**
 * What a knowledge section looks like beyond its size.
 *
 * `'episodic'` means the body reads like a record of a *run* rather than a
 * definition — see `host/hygiene.ts` for the calibrated rule. It is a signal for
 * a human, not a verdict, and the board moves nothing on its own.
 */
export type SectionSmell = 'episodic'

/** One section as the budget view lists it. */
export interface LedgerSectionRow {
  readonly id: string
  /** Which rule caught it: resident, on-demand index, or a run log (never injected). */
  readonly cls: 'resident' | 'onDemand' | 'log'
  /** Heading length plus body, in UTF-16 code units — the unit the budget uses. */
  readonly chars: number
  /**
   * `true` when this section differs from the last **injected** baseline.
   *
   * A section that keeps appearing here is the signature of a note being used as
   * a log: process notes change every session, frozen definitions do not. The
   * hashes are the same ones `[LEDGER DELTA]` compares, so the view and the
   * notice cannot disagree.
   */
  readonly changed: boolean
  /**
   * Set when the body reads like a run record rather than a definition.
   *
   * These are the entries that quietly become constraints on later work — a
   * device fault or a dead-end algorithm from one session must not bound the
   * next one. Never set for run-log sections: a log is where such records
   * belong, so flagging them would invert the advice.
   */
  readonly smell?: SectionSmell
  /** The words that triggered {@link smell}: shown to a human, never parsed. */
  readonly markers?: readonly string[]
}

/** The bound ledger's contents, as the board renders them. */
export interface LedgerPayload {
  /** Which ledger, and how it was chosen. */
  readonly ref: LedgerRef
  /** `false` when there is no ledger for this session, or it has no file yet. */
  readonly exists: boolean
  /** Last modification time in epoch milliseconds, or null when absent. */
  readonly mtime: number | null
  readonly bytes: number
  /** Whole file. Truncation, if any, is reported through `truncated`. */
  readonly text: string
  /** `true` when the file was larger than the configured display cap. */
  readonly truncated: boolean
  /**
   * Soft target for resident knowledge. Not actual delivery size: the preamble,
   * whole pinned sections and index are described by `injection`/preview.
   * Kept for compatibility with older clients.
   */
  readonly injectBudget: number
  /** Host-computed policy and preview, not evidence of delivery or model use. */
  readonly injection?: import('./sections.ts').InjectionPlan
  /**
   * Per-section sizes and what moved since the last injected baseline.
   *
   * Absent when the file could not be read. `baselineAt === null` means this
   * session has no baseline yet (nothing was injected), so every `changed` is
   * `false` by construction rather than by observation.
   */
  readonly sections?: readonly LedgerSectionRow[]
  readonly baselineAt?: number | null
  readonly injectionPreview?: string
  readonly knowledgeText?: string
  readonly runLogsText?: string
}

/** One adversarial-audit verdict file from the writer's inbox. */
export interface AuditFile {
  readonly name: string
  /** Epoch milliseconds. */
  readonly mtime: number
  readonly bytes: number
  readonly text: string
  /** `true` once the writer has already fed it back to the parent. */
  readonly consumed: boolean
}

/** The audit inbox listing, newest first. */
export interface AuditsPayload {
  /** The inbox actually read — derived from the bound ledger's directory. */
  readonly dir: string
  readonly exists: boolean
  readonly files: readonly AuditFile[]
}

/** Ledger paths the human has attached before, for the switcher. */
export interface KnownPayload {
  readonly paths: readonly string[]
}

/**
 * One ledger as the catalogue presents it.
 *
 * Defined here rather than in the host scanner because it crosses the wire: the
 * client renders exactly these fields, and a second declaration on the client
 * side would be free to drift from what the route actually sends.
 */
export interface LedgerEntry {
  /** Absolute path. */
  readonly path: string
  /** Short human label — the owning project's name. */
  readonly title: string
  readonly bytes: number
  /** Epoch milliseconds. */
  readonly mtime: number
  /** Total `## ` sections. */
  readonly sections: number
  /** Sections whose id begins with FROZEN. */
  readonly frozen: number
  /** Sections whose id begins with VERDICT. */
  readonly verdicts: number
  /** Sections whose id begins with OPEN. */
  readonly open: number
  /** Verdict files sitting unread in this ledger's audit inbox. */
  readonly pendingAudits: number
  /** Whether this is the session's currently bound ledger. */
  readonly bound: boolean
  /** `false` when the registry remembers it but the file is gone. */
  readonly present: boolean
}

/** The catalogue, plus where it was scanned. */
export interface CatalogPayload {
  /** Roots the scan covered, so the UI can explain an empty result. */
  readonly roots: readonly string[]
  /**
   * The relative paths a note was looked for at, in priority order.
   *
   * Travelling to the UI for the same reason `roots` does: the empty state has
   * to tell the human where a note *would* be found, and a hint hard-coded in
   * the client would silently contradict `ledgerFiles` the moment a deployment
   * overrides it.
   */
  readonly files: readonly string[]
  readonly entries: readonly LedgerEntry[]
}

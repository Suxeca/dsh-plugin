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
export type LedgerSource = 'attached' | 'discovered' | 'none'

/**
 * The ledger bound to one session.
 *
 * `source` travels to the UI on purpose: the whole defect this replaced was a
 * binding nobody could see, so the board states where its content came from
 * rather than presenting a path as if it were the only possibility.
 */
export interface LedgerRef {
  readonly source: LedgerSource
  /** Absolute path, or `''` when `source` is `'none'`. */
  readonly path: string
  /** Short human label: the owning project's name. */
  readonly title: string
  /** For `'discovered'`: the ancestor directory the ledger was found under. */
  readonly root?: string
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
   * How many characters this plugin actually injects into the conversation each
   * turn. The board compares the file against this so the human can see, without
   * guessing, whether what they are looking at is the same set of definitions
   * the model is being handed.
   */
  readonly injectBudget: number
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

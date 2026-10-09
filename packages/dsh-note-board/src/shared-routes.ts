/**
 * The strings both halves must agree on: the host route paths the client
 * fetches. Kept in a browser-safe module so importing them never drags
 * `node:*` types into the client bundle (the host module imports `node:fs`).
 *
 * @module @suxeca/dsh-note-board/shared-routes
 */

/** Route prefix owned by this plugin, mounted by the host half. */
export const ROUTE_PREFIX = '/note-board/api'

/** GET the session's bound ledger. */
export const ROUTE_LEDGER = '/ledger'

/**
 * GET the session's binding state alone — no note text.
 *
 * Separate from {@link ROUTE_LEDGER} because the composer entry polls it: see
 * `StatePayload` for why a chip must not pull the whole note.
 */
export const ROUTE_STATE = '/state'

/** GET the bound ledger's adversarial-audit inbox. */
export const ROUTE_AUDITS = '/audits'

/** GET ledger paths attached before. */
export const ROUTE_KNOWN = '/known'

/** GET the catalogue of ledgers on this machine. */
export const ROUTE_CATALOG = '/catalog'

/** POST an explicit session → ledger attachment. */
export const ROUTE_ATTACH = '/attach'

/** POST a detach, returning the session to discovery. */
export const ROUTE_DETACH = '/detach'

/** POST the per-session injection switch. */
export const ROUTE_INJECTION = '/injection'

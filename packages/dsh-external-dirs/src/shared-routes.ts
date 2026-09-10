/**
 * The one string both halves must agree on: the host route prefix the client
 * fetches. Kept in its own browser-safe module so importing it never drags
 * `node:*` types into the client bundle (the host module imports `node:fs`).
 *
 * @module @suxeca/dsh-external-dirs/shared-routes
 */

/** Route prefix owned by this plugin, mounted by the host half. */
export const ROUTE_PREFIX = '/external-dirs/api'

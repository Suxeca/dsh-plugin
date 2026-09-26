/**
 * Per-session ledger fingerprints, on disk.
 *
 * ## Why this file exists
 *
 * The `[LEDGER DELTA]` notice — "VERDICT-1 被替换" — is produced by diffing the
 * ledger against what was last injected. That baseline used to live in a plain
 * in-memory `Map`, so it died with the process. The consequence was invisible
 * and one-sided: **edits made while DSH was down were never announced**. The
 * ledger body still refreshed (it is read fresh every turn), so the model would
 * silently be reasoning from a newer ledger while its own history still held the
 * older one — exactly the divergence the delta notice exists to prevent. It read
 * as "nothing changed" precisely when something had.
 *
 * So the baseline is persisted, and a resumed session compares against the
 * fingerprint from before the restart.
 *
 * ## Why a separate file, and not the attachment registry
 *
 * `note-boards.json` already has a writer (attach/detach, on a human's click).
 * This file has a different writer on a different schedule (every turn in which
 * the ledger moved). Sharing one file would mean a read-modify-write per turn
 * racing the attachment path, where losing the race costs a *binding* — a human
 * action — in exchange for a nicety. Separate files keep the failure domains
 * apart: losing a fingerprint costs one missed announcement, and nothing else.
 *
 * ## What is stored
 *
 * Section id → a short hash of its normalised body, not the body itself. The
 * delta message names sections, so a hash is sufficient; storing the text would
 * duplicate the ledger once per session that has ever read it and would put
 * document contents in a file whose whole purpose is metadata.
 *
 * @module @suxeca/dsh-note-board/host/fingerprints
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { usableSessionId } from './ledgers.ts'
import { readBoundedFile } from './read.ts'

/** One session's last-injected ledger shape. */
export interface LedgerFingerprint {
  /**
   * The ledger this fingerprint describes.
   *
   * Load-bearing: two different ledgers share almost no section ids, so a diff
   * across a changed binding reports every section as added *and* removed at
   * once. Comparing only within one path is what keeps a rebind from being
   * announced as a rewrite of the whole document.
   */
  readonly path: string
  /** Section id → hash of its normalised body. */
  readonly sections: Record<string, string>
  /** Epoch milliseconds of the last write; used only to bound the file. */
  readonly at: number
}

/** sessionId → fingerprint. */
export type FingerprintMap = Record<string, LedgerFingerprint>

/**
 * How many sessions the store keeps.
 *
 * A bound rather than a policy: the file is written per ledger change and lives
 * forever, so without one it would grow with every session the machine ever
 * runs. This is far more sessions than resolve to a ledger at once, and an
 * evicted entry costs exactly one re-baselining (no delta on the next turn).
 */
export const MAX_FINGERPRINTS = 512

/** Distinguishes concurrent writers' temp files within one process. */
let tempSeq = 0

/** The store's on-disk shape. `version` so a future change can migrate rather than misread. */
interface StoreFile {
  version: number
  sessions: FingerprintMap
}

const STORE_VERSION = 1

/**
 * Where a plugin's fingerprint store lives: beside its attachment registry.
 *
 * Derived rather than configured, so the two paths cannot drift apart in a
 * composition that overrides only one of them.
 * @param registryPath - the configured attachment registry path.
 * @returns the fingerprint store path.
 */
export function fingerprintPathFor(registryPath: string): string {
  return join(dirname(registryPath), 'note-board-fingerprints.json')
}

/**
 * How much of the store is read, and how large one legitimate entry may be.
 *
 * The store is read on **every** assemble turn, so this is the one reader where
 * an unbounded `readFile` is a standing per-turn cost rather than a one-off: a
 * replaced or older-build file of a few hundred megabytes was measured to cost
 * several times its size in resident memory, every turn, forever. The registry
 * reader is bounded for the same reason — these two are siblings and must be
 * treated identically.
 */
export const MAX_STORE_CHARS = 4 * 1024 * 1024

/** Longest path or section hash a well-formed fingerprint can contain. */
const MAX_FIELD_CHARS = 4096

/** Most sections one fingerprint may describe. */
const MAX_SECTIONS = 4096

/**
 * True for a value shaped like a fingerprint this module wrote.
 *
 * Field lengths and counts are bounded as well as typed: a "valid" entry with a
 * million sections would otherwise be accepted and then copied into memory and
 * back out to disk on every turn.
 */
function isFingerprint(value: unknown): value is LedgerFingerprint {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { path?: unknown, sections?: unknown, at?: unknown }
  if (typeof candidate.path !== 'string' || candidate.path === '' || candidate.path.length > MAX_FIELD_CHARS) return false
  // `at` is compared and sorted on, so a non-number here is a type error waiting
  // to happen rather than something to silently keep.
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return false
  if (typeof candidate.sections !== 'object' || candidate.sections === null || Array.isArray(candidate.sections)) return false
  const entries = Object.entries(candidate.sections as Record<string, unknown>)
  if (entries.length > MAX_SECTIONS) return false
  return entries.every(([id, body]) =>
    id !== '' && id.length <= MAX_FIELD_CHARS && typeof body === 'string' && body.length <= MAX_FIELD_CHARS)
}

/**
 * Read the store.
 *
 * Every failure is "empty", for the same reason `readRegistry` does it: a
 * missing file is the normal first run, and a corrupt one must cost a delta
 * notice rather than a turn. Entries that do not typecheck are dropped
 * individually, so one bad row cannot poison the rest of the file — and the keys
 * go through the same session-id validation the registry applies, because this
 * file is an equally independent trust path.
 * @param path - store path.
 * @returns the known fingerprints; empty when absent or unreadable.
 */
export async function readFingerprints(path: string): Promise<FingerprintMap> {
  try {
    const parsed = JSON.parse((await readBoundedFile(path, MAX_STORE_CHARS)).text) as { sessions?: unknown }
    const sessions = parsed.sessions
    if (typeof sessions !== 'object' || sessions === null || Array.isArray(sessions)) return {}
    // Null-prototype, like the registry's `sessions`: a `__proto__` key in the
    // file must not be able to become this map's prototype.
    const out = Object.create(null) as FingerprintMap
    for (const [sessionId, value] of Object.entries(sessions as Record<string, unknown>)) {
      if (usableSessionId(sessionId) && isFingerprint(value)) out[sessionId] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Write the store, keeping only the newest {@link MAX_FINGERPRINTS} sessions.
 *
 * Temp file + rename, so a crash mid-write leaves the previous store intact
 * rather than a truncated one — and the temp name is **unique per call**,
 * because two overlapping writes sharing `${path}.tmp` rename each other's
 * half-written file away, and the loser's `rename` then fails with ENOENT.
 * Two sessions assembling at once is the normal case here, not a corner case.
 * @param path - store path.
 * @param sessions - the full set to persist.
 */
export async function writeFingerprints(path: string, sessions: FingerprintMap): Promise<void> {
  const kept = Object.entries(sessions)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_FINGERPRINTS)
  const file: StoreFile = { version: STORE_VERSION, sessions: Object.fromEntries(kept) }
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${tempSeq++}.tmp`
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * Record one session's fingerprint, merging with whatever is on disk.
 *
 * The merge re-reads at write time on purpose. Two sessions can assemble
 * concurrently, and a plain "write my map" would let the second clobber the
 * first; reading immediately before writing narrows that window to other
 * *processes* rather than closing a self-inflicted one. A whole-file atomic
 * rename means the worst case is a lost update, never a corrupt store.
 * @param path - store path.
 * @param sessionId - the session being recorded.
 * @param fingerprint - its current shape.
 */
export async function rememberFingerprint(
  path: string,
  sessionId: string,
  fingerprint: LedgerFingerprint,
): Promise<void> {
  const merged = await readFingerprints(path)
  const existing = merged[sessionId]
  // A fingerprint written by another process at a later moment describes a
  // newer read of the ledger than ours, so it is the better baseline.
  if (existing !== undefined && existing.at > fingerprint.at) return
  merged[sessionId] = fingerprint
  await writeFingerprints(path, merged)
}

/**
 * Which ledger belongs to which session — the one place that decides.
 *
 * ## Why this module exists
 *
 * Before it, "the ledger" was a globally fixed path baked into two separate
 * configs: this board's profile row, and the row of whatever plugin writes the
 * ledger. Nothing expressed any relationship between them; they agreed only by
 * both happening to name the same file. So there was nowhere to answer "does
 * *this* conversation need *that* ledger?" — the board showed one project's
 * ledger in every session, including sessions about something else.
 *
 * Now a ledger is resolved **per session**, in a fixed order:
 *
 *   1. **explicit attachment** — the session was pointed at a specific file
 *   2. **discovery** — walk up from the session's working directory looking for
 *      a ledger in a conventional place (the same way `.git` is found)
 *   3. **none** — no ledger at all
 *
 * Step 3 is load-bearing and must not be softened into "reuse the last one".
 * If absence silently fell back to some other ledger, sessions would keep
 * bleeding into each other and the isolation would be a lie.
 *
 * ## Both planes must call this
 *
 * The board and a companion writer run in different compositions, so if each grew its own
 * copy of this logic they would eventually disagree — and a board showing
 * ledger A while the system prompt injects ledger B is *worse* than the old
 * fixed path, because the divergence is invisible. The companion therefore reaches
 * this through the `noteLedgers` service rather than reimplementing it.
 *
 * @module @suxeca/dsh-note-board/host/ledgers
 */
import { existsSync } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { readBoundedFile } from './read.ts'

/**
 * Where a note may live, relative to a candidate root, in priority order.
 *
 * More than one entry because a note does not necessarily sit at a project root:
 * the layout this was written against is `<project>/notes/ledger.md`. A
 * single-candidate rule would find nothing in that layout and quietly report "no
 * note", which looks identical to "this project has no note" — the good failure
 * and the bad one would be indistinguishable.
 *
 * These are only the **defaults**. A deployment whose notes live elsewhere (or
 * under a different file name) overrides them through the `ledgerFiles` config,
 * which is why nothing here is a hard-coded fact about anyone's layout.
 */
export const DEFAULT_LEDGER_FILES = ['notes/ledger.md', '.notes/ledger.md', 'ledger.md'] as const

/** Where a note's audit inbox sits, beside the note, unless configured otherwise. */
export const DEFAULT_AUDIT_INBOX = '.note-audit-inbox'

/**
 * How many previously attached paths the registry remembers.
 *
 * A bound rather than a policy, for the same reason the fingerprint store has
 * one: the file is rewritten whole on every attach and lives forever, so without
 * a cap it grows with every path ever attached — and `/known` would return all of
 * them. This is far more than a switcher can usefully show.
 */
export const MAX_KNOWN_LEDGERS = 256

/** How a session's ledger was decided. */
/**
 * Where a session's note came from.
 *
 * `'off'` is not `'none'`: the note may be perfectly findable, but this session
 * was explicitly told not to inject it. Keeping them distinct is what lets the
 * board say "关闭注入" instead of the misleading "未绑定".
 */
export type LedgerSource = 'attached' | 'discovered' | 'none' | 'off'

/** The resolved ledger for one session. */
export interface LedgerRef {
  /** How this answer was reached — surfaced in the UI so the binding is never invisible. */
  readonly source: LedgerSource
  /**
   * Absolute path, or `''` when nothing was found.
   *
   * Non-empty for `'off'` when the switch overrides a real binding, so the
   * human can see what they switched off. Injection never reads it: it returns
   * on the source. `writableRef` strips it for companions, which must not start
   * writing into a note this session was told not to read.
   */
  readonly path: string
  /** Short human label: the owning directory's name. */
  readonly title: string
  /** For `'discovered'`: the ancestor directory the ledger was found under. */
  readonly root?: string
  /**
   * For `'off'`: the binding the switch is overriding; `'none'` when the opt-out
   * currently hides nothing.
   */
  readonly underlying?: 'attached' | 'discovered' | 'none'
}

/** The ledger that a session is explicitly pointed at. */
export interface BoardRegistry {
  /** sessionId → absolute ledger path. */
  sessions: Record<string, string>
  /**
   * Sessions explicitly told not to inject.
   *
   * A list rather than a sentinel path inside `sessions`, so no real path can
   * ever collide with the opt-out, and so re-enabling restores whatever the
   * session was bound to (an attachment survives being switched off).
   */
  off: string[]
  /** Ledgers the human has attached before, offered by the switcher. */
  known: string[]
}

/** Services this module reads through, injected so the logic stays testable. */
export interface LedgerDeps {
  /**
   * The session's working directory, or undefined when unknown.
   *
   * May answer asynchronously: the in-memory session store only holds the
   * sessions that are currently live, so the real implementation falls back to
   * persisted session metadata for a session that has been swapped out. A sync
   * implementation stays valid — `resolveLedger` awaits either shape.
   */
  cwdOf(sessionId: string): string | undefined | Promise<string | undefined>
  /** Where the attachment registry lives. */
  registryPath: string
  /** Relative paths searched while walking up from a session's cwd. */
  ledgerFiles: readonly string[]
  /** Audit-inbox directory name, created beside a note. */
  auditInboxName: string
}

/** A ledger with no session binding — returned instead of throwing. */
const NONE: LedgerRef = { source: 'none', path: '', title: '' }

/**
 * The explicit opt-out: this session keeps its note, but injects nothing.
 *
 * The path is filled in by {@link resolveLedger} when the switch is actually
 * hiding something, so the UI can name it. Injection does not read the path of
 * an `'off'` ref — {@link import('./inject.ts')} returns early on the source —
 * so carrying it changes what the human can see and nothing about what the
 * model receives.
 */
const OFF: LedgerRef = { source: 'off', path: '', title: '', underlying: 'none' }

/** Bound on how many opt-outs one registry remembers. */
export const MAX_OFF_SESSIONS = 256

/**
 * Directory names that are containers rather than identities.
 *
 * `<project>/notes/ledger.md` is the layout this was written against, and a
 * label of "notes" tells the human nothing — every project's note would be
 * called "notes". The label has to name the *project*, so these are skipped
 * while walking up.
 */
const CONTAINER_DIRS = new Set(['notes', 'note', '.notes', 'docs', 'doc', 'ledger', 'ledgers'])

/** Short label for a ledger: the nearest enclosing directory that is not a container. */
export function ledgerTitle(path: string): string {
  const parts = resolvePath(path).split(sep).filter(part => part !== '')
  parts.pop()
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!CONTAINER_DIRS.has(parts[i].toLowerCase())) return parts[i]
  }
  return parts[0] ?? ''
}

/**
 * Walk up from `cwd` looking for a ledger, closest ancestor first.
 * @param cwd - absolute starting directory.
 * @param candidates - relative paths to try at each level; defaults to
 *   {@link DEFAULT_LEDGER_FILES}.
 * @returns the match, or null when no ancestor holds one.
 */
export function discoverLedger(
  cwd: string,
  candidates: readonly string[] = DEFAULT_LEDGER_FILES,
): { path: string, root: string } | null {
  let dir = resolvePath(cwd)
  for (;;) {
    for (const relative of candidates) {
      const candidate = join(dir, relative)
      if (existsSync(candidate)) return { path: candidate, root: dir }
    }
    const parent = dirname(dir)
    // Reaching the filesystem root: `dirname('/')` is `'/'`, so this is the
    // loop's only exit. Walking past it would spin forever.
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Session ids are opaque tokens, so this only rejects shapes that cannot be one.
 *
 * It matters beyond tidiness: the id becomes an object key in the attachment
 * registry, so a caller-supplied 4 MB string is something the registry should
 * never be asked to store, and the three reserved names stop being *data* the
 * moment they are used as a key on a plain object.
 */
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/

/** Object-protocol names that must never become a registry key. */
const RESERVED_SESSION_IDS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * True when `raw` may be used as a session id.
 *
 * Applied on the way in (routes) **and** on the way out of the persisted file,
 * because the file is a second, independent trust path: it can be edited, or
 * written by an older build.
 */
export function usableSessionId(raw: string): boolean {
  return SESSION_ID.test(raw) && !RESERVED_SESSION_IDS.has(raw)
}

/**
 * How much of the registry file is read.
 *
 * The registry is a small JSON document the plugin itself writes; this bound
 * exists so a corrupt or replaced file cannot turn into an unbounded allocation
 * on a path that runs on every poll.
 */
export const MAX_REGISTRY_CHARS = 1024 * 1024

/**
 * Read the attachment registry, treating every failure as "empty".
 *
 * The parsed document is re-validated key by key rather than trusted: it is JSON
 * from disk, so `sessions` may be an array, `__proto__` may arrive as an own
 * property, and any entry may be of the wrong type. Only own, well-formed,
 * usable entries survive.
 */
export async function readRegistry(registryPath: string): Promise<BoardRegistry> {
  try {
    const parsed = JSON.parse((await readBoundedFile(registryPath, MAX_REGISTRY_CHARS)).text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return emptyRegistry()
    const raw = parsed as { sessions?: unknown, off?: unknown, known?: unknown }
    // Null-prototype: a key inherited from `Object.prototype` must not be
    // reachable as a session binding.
    const sessions: Record<string, string> = Object.create(null) as Record<string, string>
    if (typeof raw.sessions === 'object' && raw.sessions !== null && !Array.isArray(raw.sessions)) {
      for (const [id, path] of Object.entries(raw.sessions as Record<string, unknown>)) {
        if (usableSessionId(id) && typeof path === 'string' && path !== '') sessions[id] = path
      }
    }
    const off = Array.isArray(raw.off)
      ? [...new Set(raw.off.filter((entry): entry is string => typeof entry === 'string' && usableSessionId(entry)))]
        .slice(-MAX_OFF_SESSIONS)
      : []
    const known = Array.isArray(raw.known)
      ? raw.known.filter((entry): entry is string => typeof entry === 'string' && entry !== '').slice(-MAX_KNOWN_LEDGERS)
      : []
    return { sessions, off, known }
  } catch {
    // A missing file is the normal first-run state, and a corrupt one must not
    // take the board down — losing attachments is recoverable, a dead view is
    // not. Starting empty is the right failure for both.
    return emptyRegistry()
  }
}

/** The registry as it reads with nothing on disk: valid, and empty. */
function emptyRegistry(): BoardRegistry {
  return { sessions: Object.create(null) as Record<string, string>, off: [], known: [] }
}

/** Distinguishes concurrent writers' temp files within one process. */
let tempSeq = 0

/** Write the registry via a temp file + rename, so a crash cannot truncate it. */
export async function writeRegistry(registryPath: string, registry: BoardRegistry): Promise<void> {
  await mkdir(dirname(registryPath), { recursive: true })
  // A per-call temp name: two writers sharing `${path}.tmp` would rename each
  // other's half-written file into place.
  const temp = `${registryPath}.${process.pid}.${tempSeq++}.tmp`
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  await rename(temp, registryPath)
}

/**
 * Decide which ledger a session uses.
 * @param deps - session cwd lookup and registry location.
 * @param sessionId - the session asking.
 * @param options - `ignoreOff` resolves the binding the switch is overriding, so
 *   a switched-off session can still be told what it switched off. Injection
 *   never passes it.
 * @returns the resolved reference; `source: 'none'` when there is no ledger.
 */
export async function resolveLedger(
  deps: LedgerDeps,
  sessionId: string,
  options?: { readonly ignoreOff?: boolean },
): Promise<LedgerRef> {
  const registry = await readRegistry(deps.registryPath)
  // The opt-out is checked first, and beats both an attachment and discovery:
  // otherwise "关闭" would be undone by the next assembly re-discovering the
  // very note the human just switched off.
  if (registry.off.includes(sessionId) && options?.ignoreOff !== true) {
    // Resolve what the switch is hiding, but keep `source: 'off'` so every
    // consumer that gates on the source (injection, the on-demand reader) is
    // unaffected. A switched-off session that cannot name its note is a switch
    // the human has no way to verify.
    const hidden = await resolveLedger(deps, sessionId, { ignoreOff: true })
    // `'off'` cannot come back from the recursive call, but the type still
    // admits it: excluding it here is what narrows `underlying` to a real
    // binding rather than a second switch.
    return hidden.source === 'none' || hidden.source === 'off'
      ? OFF
      : {
          source: 'off',
          path: hidden.path,
          title: hidden.title,
          underlying: hidden.source,
          ...(hidden.root !== undefined ? { root: hidden.root } : {}),
        }
  }
  const attached = registry.sessions[sessionId]
  if (typeof attached === 'string' && attached !== '' && existsSync(attached)) {
    return { source: 'attached', path: attached, title: ledgerTitle(attached) }
  }
  // An attachment whose file has since been deleted falls through to discovery
  // rather than failing: the human moved or renamed a ledger, and reporting
  // "none" while a perfectly good one sits under the project root would be
  // actively unhelpful.
  const cwd = await deps.cwdOf(sessionId)
  if (typeof cwd === 'string' && cwd !== '') {
    const found = discoverLedger(cwd, deps.ledgerFiles)
    if (found !== null) return { source: 'discovered', path: found.path, title: ledgerTitle(found.path), root: found.root }
  }
  return NONE
}

/**
 * The companion-writer view of a resolution.
 *
 * `resolveLedger` now names what an `'off'` switch is hiding, because the UI has
 * to be able to show it. A writer must not inherit that: a session that was told
 * not to read a note must not silently start writing *into* it, and before this
 * the empty path was what refused it. Injection itself is already unaffected —
 * it returns on the source, not on the path.
 * @param ref - a resolved reference.
 * @returns the same reference, with an `'off'` payload stripped.
 */
export function writableRef(ref: LedgerRef): LedgerRef {
  return ref.source === 'off' ? { source: 'off', path: '', title: '', underlying: ref.underlying } : ref
}

/**
 * Point a session at a specific ledger.
 *
 * The path must already exist **and be a regular file**: attaching to a typo
 * would produce a session that silently injects nothing, which is the failure
 * mode this whole module exists to make impossible to reach by accident — and
 * a directory, FIFO or device node is the same accident with a worse ending,
 * because every reader downstream assumes it can read a note out of the path it
 * was handed.
 * @returns the new reference, or an error string.
 */
export async function attachLedger(
  registryPath: string,
  sessionId: string,
  path: string,
): Promise<{ ok: true, ref: LedgerRef } | { ok: false, error: string }> {
  const absolute = resolvePath(path)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(absolute)
  } catch {
    return { ok: false, error: `笔记不存在：${absolute}` }
  }
  if (!info.isFile()) return { ok: false, error: `不是普通文件：${absolute}` }
  const registry = await readRegistry(registryPath)
  registry.sessions[sessionId] = absolute
  if (!registry.known.includes(absolute)) {
    // Newest last, then bounded: `known` backs a switcher, and an unbounded list
    // would grow the registry (rewritten whole on every attach) and the /known
    // response without limit. The fingerprint store is bounded for the same
    // reason; an evicted entry costs one re-attach.
    registry.known = [...registry.known, absolute].slice(-MAX_KNOWN_LEDGERS)
  }
  await writeRegistry(registryPath, registry)
  return { ok: true, ref: { source: 'attached', path: absolute, title: ledgerTitle(absolute) } }
}

/** Drop a session's explicit attachment, returning it to discovery. */
/**
 * Turn injection on or off for one session.
 *
 * Off is remembered rather than expressed by removing the binding, so switching
 * back on restores what the session had — an explicit attachment if there was
 * one, discovery otherwise.
 * @param registryPath - the board registry file.
 * @param sessionId - the session being switched.
 * @param enabled - false to stop injecting, true to resume.
 * @returns whether the stored state actually changed.
 */
export async function setInjection(
  registryPath: string,
  sessionId: string,
  enabled: boolean,
): Promise<boolean> {
  const registry = await readRegistry(registryPath)
  const wasOff = registry.off.includes(sessionId)
  if (enabled === !wasOff) return false
  registry.off = enabled
    ? registry.off.filter(id => id !== sessionId)
    : [...registry.off, sessionId].slice(-MAX_OFF_SESSIONS)
  await writeRegistry(registryPath, registry)
  return true
}

/** Whether a session is currently switched off, for a caller that only reads. */
export async function injectionEnabled(registryPath: string, sessionId: string): Promise<boolean> {
  return !(await readRegistry(registryPath)).off.includes(sessionId)
}

export async function detachLedger(registryPath: string, sessionId: string): Promise<void> {
  const registry = await readRegistry(registryPath)
  if (registry.sessions[sessionId] === undefined) return
  delete registry.sessions[sessionId]
  await writeRegistry(registryPath, registry)
}

/**
 * Where a note's adversarial-audit inbox lives.
 *
 * Derived from the note rather than configured as an absolute path, because the
 * two must move together: with per-project notes, a fixed inbox would collect
 * one project's audit verdicts and show them in every other project's board.
 * Same directory, so attaching a note carries its audits with it.
 *
 * The *name* is configurable (`auditInboxName`) while the *location* is not:
 * a deployment that already has an inbox under its own name keeps its history,
 * and still cannot accidentally point the board at another project's inbox.
 */
export function auditInboxFor(ledgerPath: string, inboxName: string = DEFAULT_AUDIT_INBOX): string {
  return join(dirname(ledgerPath), inboxName)
}

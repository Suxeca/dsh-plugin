/**
 * @suxeca/dsh-note-board — host half.
 *
 * Two jobs:
 *
 *  1. Mount the board's session-addressed routes.
 *  2. **Own ledger resolution and publish it as `noteLedgers`.**
 *
 * The second is the one that matters. The board runs in every session, so it
 * cannot use a fixed ledger; and any companion writer has to inject the *same*
 * ledger the board is displaying. If that writer carried its own copy of the
 * resolution rules the two would eventually disagree, and a board showing
 * ledger A while the system prompt injects ledger B is worse than the old fixed
 * path — the divergence is invisible. So resolution lives here once and a
 * companion reads it through the service.
 *
 * @module @suxeca/dsh-note-board
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_AUDIT_INBOX, DEFAULT_LEDGER_FILES, auditInboxFor, resolveLedger, type LedgerDeps } from './host/ledgers.ts'
import { registerLedgerInjection } from './host/inject.ts'
import { MAX_READ_CHARS, readBoundedFile } from './host/read.ts'
import { registerBoardCommand } from './host/command.ts'
import { registerBoardRoutes } from './host/routes.ts'
import type { LedgerRef } from './shared.ts'

export const name = '@suxeca/dsh-note-board'

/**
 * Sections the injected body always carries whole.
 *
 * These are the ones whose absence changes what the model is allowed to
 * conclude — frozen definitions, the bookkeeping discipline, adjudications —
 * rather than the running state a note also tends to accumulate. Everything
 * else is named in the body and readable on demand, which is what keeps the
 * injected text stable while a log grows underneath it. A stable body is also
 * what stops a growing note from re-injecting itself every turn.
 */
export const DEFAULT_PINNED_SECTIONS = ['FROZEN*', 'RULES', 'VERDICT*']

/**
 * `webServer` is what the route module reads through a Cordis accessor, so it
 * must be declared here — an accessor only resolves on a context that declared
 * it. `systemPrompt` is declared because this plugin now owns ledger injection
 * (see `host/inject.ts`): without it the board would display a ledger that never
 * reaches the conversation, which is the exact failure this ownership move fixed.
 * `connection` is declared because every route serves file contents and rewrites
 * a session binding, and a **named route is not automatically behind the web
 * app's auth gate** — that gate belongs to the frontend-static fallback, which a
 * registered route is matched before. Without the trust check the board would be
 * an unauthenticated arbitrary-file-read, reachable from any local process and
 * from a browser on another origin via DNS rebinding. This mirrors what DSH's
 * own file-touching routes (`open-in-app`, the api gateway) declare.
 *
 * `sessions` is read through `ctx.get` instead, because a deployment without it
 * should still get a working board (one that simply cannot read a session's
 * working directory) rather than an unmounted plugin.
 */
export const inject = ['webServer', 'systemPrompt', 'connection']

/** Composition-time configuration for this plugin's row. */
export interface Config {
  /**
   * Attachment registry path. Empty means `${DSH_HOME:-~/.dsh}/note-boards.json`.
   * Empty rather than a literal default because the home directory is not known
   * when the schema is built.
   */
  registryPath: string
  /** Per-file read cap, in bytes. A larger file is truncated and says so. */
  maxBytes: number
  /** How many verdict files the audit view offers, newest first. */
  auditLimit: number
  /**
   * Directories the ledger catalogue scans. Defaults to `${DSH_HOME:-~/.dsh}`
   * siblings is wrong — these are the human's *projects*, so the default is the
   * workspace root they keep them under. Empty means `~/Workspace`.
   */
  scanRoots: string[]
  /** How many levels below each scan root to descend. */
  scanDepth: number
  /** How long a catalogue scan is reused, in milliseconds. */
  catalogTtlMs: number
  /**
   * Characters injected into the conversation each turn.
   *
   * This plugin is what injects, so the value is its own; it is configurable
   * because a deployment may also run a companion writer that injects the same
   * note with its own budget. The two live in different compositions and neither
   * can read the other's config, so the board's job is to make a mismatch
   * *visible* (see the absorption line) rather than to guess it away.
   */
  injectBudget: number
  /**
   * Relative paths that identify a note, tried in order while walking up from a
   * session's working directory. Empty means
   * {@link DEFAULT_LEDGER_FILES} — the conventional layout. Overriding this is
   * how a deployment whose notes are named differently keeps discovery working.
   */
  ledgerFiles: string[]
  /**
   * Section ids the injected body always carries whole, as exact ids or
   * `PREFIX*` patterns (case-insensitive). Empty means
   * {@link DEFAULT_PINNED_SECTIONS}; `['*']` pins everything, restoring the
   * pre-pinning behaviour where the body was the whole note, clamped.
   */
  pinnedSections: string[]
  /**
   * Name of the audit-inbox directory, created beside a note. Empty means
   * {@link DEFAULT_AUDIT_INBOX}.
   */
  auditInboxName: string
  /**
   * Where the injected sections land in the assembled system prompt.
   *
   * `'last'` (default) keeps the operating contract ahead of imported data;
   * `'first'` establishes the frozen definitions before anything else. The
   * sections carry no rank, so this is presentation order only.
   */
  placement: 'first' | 'last'
  /**
   * How the ledger body reaches the model.
   *
   * `'section'` (default) renders it into the system prompt, which the agent
   * loop replaces in place whenever the rendered text changes — so an edit to
   * the note rewrites the head of the conversation.
   *
   * `'snapshot'` delivers it as a durable user-role snapshot instead, appended
   * after the retained history: an edit then costs the snapshot rather than the
   * conversation behind it, and a copy dropped by compaction is re-added on the
   * next assembly. The delivered text is identical either way.
   */
  delivery: 'section' | 'snapshot'
}

export const Config: Schema<Config> = Schema.object({
  registryPath: Schema.string().default(''),
  // Bounded, not merely defaulted: these caps are operator input, and an
  // unbounded allocation driven by config is still an unbounded allocation.
  maxBytes: Schema.number().step(1).min(0).max(MAX_READ_CHARS).default(262144),
  auditLimit: Schema.number().step(1).min(0).max(500).default(20),
  injectBudget: Schema.number().step(1).min(0).max(MAX_READ_CHARS).default(6000),
  scanRoots: Schema.array(Schema.string()).default([]),
  // Three levels reaches `<workspace>/<project>/notes/ledger.md` without
  // walking into every nested source tree under a project. Capped because a
  // deep walk of a home directory is the classic "works until it does not".
  scanDepth: Schema.number().step(1).min(0).max(8).default(3),
  // Long enough that polling the view does not re-walk the tree, short enough
  // that a ledger created a moment ago shows up without a restart.
  catalogTtlMs: Schema.number().step(1).min(0).max(600_000).default(30000),
  // Empty rather than the literal list, so the defaults stay a single source of
  // truth in `host/ledgers.ts` instead of being spelled out twice.
  ledgerFiles: Schema.array(Schema.string()).default([]),
  pinnedSections: Schema.array(Schema.string()).default([...DEFAULT_PINNED_SECTIONS]),
  auditInboxName: Schema.string().default(''),
  // Default `last`: the contract frames the data. See host/inject.ts.
  placement: Schema.union(['first', 'last']).default('last'),
  // Default `section` keeps the long-standing every-turn guarantee; `snapshot`
  // is opt-in until a deployment has measured it. See host/inject.ts.
  delivery: Schema.union(['section', 'snapshot']).default('section'),
})

/** One ledger, as handed to a companion writer. */
export interface BoundLedger {
  readonly ref: LedgerRef
  /** The ledger text, or `''` when there is no ledger or no file yet. */
  readonly text: string
  /** Where this ledger's audit verdicts belong. */
  readonly inboxDir: string
}

/**
 * The service a companion writer calls.
 *
 * `cwd` is accepted as a hint because a companion writer already holds the Agent and can
 * read its session header directly; requiring the service to look the session up
 * would make that writer's answer depend on a service that may not be mounted.
 */
export interface NoteLedgersService {
  /** Decide which ledger a session uses. */
  resolve(sessionId: string, cwd?: string): Promise<LedgerRef>
  /** Resolve and read, in one call. */
  read(sessionId: string, cwd?: string): Promise<BoundLedger>
}

/**
 * Mount the board and publish ledger resolution.
 * @param ctx - host context carrying `webServer`.
 * @param config - the plugin row's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const registryPath = config.registryPath !== '' ? config.registryPath : join(dshHome, 'note-boards.json')

  /**
   * Working directories already resolved, so the persistence fallback is read
   * once per session rather than on every five-second poll.
   *
   * A session's `cwd` lives in its **immutable** header, so a hit can never go
   * stale and is cached forever. A *miss* is deliberately not cached: an id may
   * be unknown simply because its session has not been persisted yet, and
   * freezing that answer would make a session that appears a moment later look
   * permanently unbound.
   */
  const cwdCache = new Map<string, string>()

  /**
   * The session's working directory.
   *
   * `sessions` is an in-memory store that only holds the sessions currently
   * live — on this machine, about a dozen. A session that has been swapped out
   * is simply absent from it, so a memory-only lookup reports "no ledger" for a
   * conversation that genuinely has one, and the board silently shows the
   * catalogue instead of the ledger. `sessionPersistence` still knows the
   * session's `cwd` because it survives the session being unloaded, so it is the
   * fallback rather than a second source of truth.
   */
  const cwdOf = async (sessionId: string): Promise<string | undefined> => {
    const cached = cwdCache.get(sessionId)
    if (cached !== undefined) return cached
    const live = ((): string | undefined => {
      try {
        const sessions = ctx.get('sessions') as { get(id: string): { header?: { cwd?: string } } | undefined } | undefined
        return sessions?.get(sessionId)?.header?.cwd
      } catch {
        return undefined
      }
    })()
    if (typeof live === 'string' && live !== '') {
      cwdCache.set(sessionId, live)
      return live
    }
    try {
      const persistence = ctx.get('sessionPersistence') as
        | { stat(id: string): Promise<{ header?: { cwd?: string } } | undefined> }
        | undefined
      const cwd = (await persistence?.stat(sessionId))?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') {
        cwdCache.set(sessionId, cwd)
        return cwd
      }
    } catch {
      // A service that throws must not take the board down; it degrades to
      // "cwd unknown", which resolution already handles as `source: 'none'`.
    }
    return undefined
  }

  const deps = {
    cwdOf,
    registryPath,
    maxBytes: config.maxBytes,
    auditLimit: config.auditLimit,
    injectBudget: config.injectBudget,
    scanRoots: config.scanRoots.length > 0 ? config.scanRoots : [join(homedir(), 'Workspace')],
    maxDepth: config.scanDepth,
    cacheTtlMs: config.catalogTtlMs,
    ledgerFiles: config.ledgerFiles.length > 0 ? config.ledgerFiles : DEFAULT_LEDGER_FILES,
    pinnedSections: config.pinnedSections,
    auditInboxName: config.auditInboxName !== '' ? config.auditInboxName : DEFAULT_AUDIT_INBOX,
    placement: config.placement,
    delivery: config.delivery,
    // One bound for both the route's payload and the per-turn injection read:
    // the turn path must never pull in more of a note than the view shows.
    readBudget: config.maxBytes,
  }

  // Routes come from the OUTER context, matching `dsh-external-dirs` and the
  // official `dsh-host-open-in-app`: `webServer` is an accessor that only
  // resolves on a context whose own injection set declared it.
  ctx.effect(() => registerBoardRoutes(ctx, deps), '@suxeca/dsh-note-board: routes')

  // Injection lives here, beside resolution, so that "the board displays what
  // gets injected" is true by construction rather than by two modules agreeing.
  ctx.effect(() => registerLedgerInjection(ctx, deps), '@suxeca/dsh-note-board: ledger injection')
  // The switch has two entry points on purpose: the board's binding bar (where
  // the binding is visible) and `/note-board` (the only one reachable from a
  // composer that has no session yet). Registered through a scoped
  // late-injection callback rather than read once at apply: the command service
  // may mount after this plugin, and a one-shot lookup would silently leave the
  // deployment with no command at all.
  ctx.inject(['commands'], (scope) => {
    scope.effect(() => registerBoardCommand(scope, deps), '@suxeca/dsh-note-board: /note-board command')
  })

  const service: NoteLedgersService = {
    resolve: (sessionId, cwd) => resolveLedger(
      // A caller-supplied cwd wins, so the caller's own view of the session is
      // authoritative for its injection even if the sessions service disagrees.
      cwd === undefined ? deps : { ...deps, cwdOf: async () => cwd },
      sessionId,
    ),
    async read(sessionId, cwd) {
      const ref = await service.resolve(sessionId, cwd)
      if (ref.source === 'none') return { ref, text: '', inboxDir: '' }
      let text = ''
      try {
        // The same bounded, type-checked primitive the routes use. This service
        // is the shared resolver a companion writer calls, so leaving an
        // unbounded `readFile` here would hand every consumer the very read the
        // routes were hardened against — the fix has to cover every reader, not
        // just the ones on the HTTP path.
        text = (await readBoundedFile(ref.path, deps.readBudget)).text
      } catch {
        // Attachment or discovery pointed at something unreadable. Report the
        // binding but no text, so a caller injects nothing rather than a
        // partial or stale ledger.
        return { ref, text: '', inboxDir: auditInboxFor(ref.path, deps.auditInboxName) }
      }
      return { ref, text, inboxDir: auditInboxFor(ref.path, deps.auditInboxName) }
    },
  }

  try {
    ctx.provide('noteLedgers', service)
  } catch (error) {
    // Losing the service costs a companion writer its shared resolver; the board
    // itself still works, and that writer falls back to its own configured path.
    // Say it out loud rather than let the two planes silently diverge.
    console.error(
      '[dsh-note-board] ctx.provide("noteLedgers") failed — a companion writer will fall back to its own ledgerPath:',
      error instanceof Error ? error.message : String(error),
    )
  }
}

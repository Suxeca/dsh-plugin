/**
 * Ledger injection: putting the bound ledger into the system prompt every turn.
 *
 * ## Why this is here and not in a companion plugin
 *
 * It used to live in a separate writer plugin, mounted by a particular agent
 * preset. That made the board's attach button a lie in every other
 * conversation: you could attach a ledger, watch the board display it, and
 * nothing would ever be injected, because that writer was not mounted. The
 * feature and its owner were in different planes.
 *
 * Injection and display are one concern — "the board shows the ledger that gets
 * injected" has to be true *by construction*, not by two modules agreeing. So
 * resolution, display and injection all live in this one plugin, and a
 * companion writer keeps only its own domain work.
 *
 * ## Why a delta, and not just fresh text
 *
 * Two conversations can be bound to the same ledger. When one edits it, the
 * other's next turn re-reads the file and injects the new text — but the other
 * conversation's *history* still holds the old version, and the model will
 * happily keep reasoning from it. File synchronisation is automatic; semantic
 * synchronisation is not. So a change is announced and named, and the model is
 * told its earlier reading is void.
 *
 * "Since when" is the whole question, so the baseline the delta is taken against
 * is **persisted** (`host/fingerprints.ts`): an edit made while DSH was down is
 * still a change relative to what the model last read, and an in-memory baseline
 * would have made exactly that case silent.
 *
 * @module @suxeca/dsh-note-board/host/inject
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { readBoundedFile } from './read.ts'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the `system-prompt/assemble` waterfall this module joins,
// and the `agent` field dsh-agent merges into that context. Without these the
// event name is not in `keyof Events` and the handler's arguments are `unknown`.
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { fingerprintPathFor, readFingerprints, rememberFingerprint } from './fingerprints.ts'
import type { LedgerDeps, LedgerRef } from './ledgers.ts'
import { resolveLedger } from './ledgers.ts'

/** Section name for the ledger body, kept stable for the human reading the prompt. */
export const S_LEDGER = 'note-ledger'

/**
 * The `plugin` value that labels this plugin's context injections.
 *
 * The durable source's `kind` must be `'plugin'` — the persisted session format
 * validates `kind` against a closed set, so a producer cannot invent its own.
 * This string is what the client reads for the row's label, which is why it is
 * a stable, readable name rather than a package id.
 */
export const INJECTION_PLUGIN = 'note-ledger'

/**
 * Longest one-line account a collapsed context row shows.
 *
 * Mirrors the platform's own bound (`CONTEXT_SUMMARY_MAX_CHARS`): the summary
 * rides the collapsed row *and* is committed to the durable log, so it is kept
 * to something a reader can take in without expanding anything.
 */
const DELTA_SUMMARY_MAX = 120

/**
 * Total characters of changed section text a change notice may carry.
 *
 * The notice is not decoration: it is the only place a non-pinned section's new
 * content reaches the model, because the injected body holds the pinned sections
 * only (see `ledgerBody`). Naming a section without its new text would leave the
 * model holding the old one — an announcement it cannot act on.
 */
const DELTA_BODY_MAX = 1200

/**
 * Section id → normalised body.
 *
 * `MUTATION-LOG` is excluded on purpose: every single edit appends a line to it,
 * so including it would make every edit announce "the log changed" — noise that
 * buries the one thing worth reporting, which is which *definition* moved.
 */
const MUTATION_LOG_ID = 'MUTATION-LOG'

/** Injection inputs. */
export interface InjectDeps extends LedgerDeps {
  /**
   * Section ids the injected body must always carry whole, as exact ids or
   * `PREFIX*` patterns.
   *
   * This is the fix for a note that outgrew the budget: the old body clamped by
   * slicing, so growing a *log* section pushed the adjudications out of the
   * prompt while the log stayed in it — the selection inverted exactly where it
   * mattered. Pinning decides inclusion by what a section *is*, and the sections
   * left out are named in the body instead of being silently dropped.
   *
   * `['*']` restores the pre-pinning behaviour: everything is pinned and the
   * body is clamped only when it has no `## <ID>` headings to split on.
   */
  pinnedSections: readonly string[]
  /** Character cap on the injected body. */
  injectBudget: number
  /**
   * Character cap on the *read* behind it.
   *
   * Separate from `injectBudget` on purpose: the body is what reaches the model,
   * while this bounds how much of a large note is pulled into memory at all.
   * This runs every turn, so an unbounded read here is a per-turn cost that
   * nothing else in the request path would notice.
   */
  readBudget: number
  /**
   * Where the injected sections land in the assembled prompt.
   *
   * Optional, defaulting to `last`. It exists because the choice is a real
   * trade-off rather than a detail: `last` keeps the operating contract ahead of
   * imported data, `first` establishes the definitions before anything else.
   */
  placement?: 'first' | 'last'
  /**
   * How the ledger body reaches the model.
   *
   * `'section'` (default) renders it into the system prompt. The agent loop
   * keeps that prompt as surface node 0 and **replaces it in place** whenever
   * the rendered text changes, so every edit to the note rewrites the head of
   * the conversation: the provider prefix from the edit onward is recomputed,
   * and everything after the system message — the whole conversation — sits in
   * that recomputed region.
   *
   * `'snapshot'` delivers the same text as a durable user-role snapshot, the
   * shape the platform's own runtime contexts use. It is re-appended when it
   * changes, and again when compaction drops it, and appends land *after* the
   * retained history — so an edit costs the snapshot itself rather than the
   * conversation behind it.
   */
  delivery?: 'section' | 'snapshot'
}

/**
 * Read the model-visible text out of one of our own snapshots.
 *
 * Returns null for anything that is not this plugin's snapshot, so a caller can
 * compare cheaply and can never mistake another producer's context for ours.
 * @param message - candidate inbox item or `user/message` payload.
 * @returns the snapshot text, or null when the message is not ours.
 */
function snapshotTextOf(message: unknown): string | null {
  const record = message as {
    readonly source?: { readonly plugin?: unknown, readonly form?: unknown }
    readonly content?: readonly { readonly type?: unknown, readonly text?: unknown }[]
  } | null
  if (record?.source?.plugin !== INJECTION_PLUGIN || record.source.form !== 'snapshot') return null
  if (!Array.isArray(record.content)) return null
  return record.content.map(part => (part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
}

/** One `## <ID>` section, kept whole. */
interface LedgerSection {
  /** The id token following `##`, exactly as `fingerprint` reads it. */
  readonly id: string
  /** Heading line and body, verbatim. */
  readonly text: string
}

/**
 * Split a note into its preamble and its whole sections.
 *
 * Whole sections are the unit of selection because half a section is worse than
 * none: contract terms are read as a set, so a truncated one reads as a complete
 * but *different* statement.
 * @param text - full note text.
 * @returns the text before the first heading, and every `## <ID>` section.
 */
function sectionsOf(text: string): { preamble: string, sections: LedgerSection[] } {
  const preamble: string[] = []
  const sections: LedgerSection[] = []
  let id: string | null = null
  let current: string[] | null = null
  const flush = (): void => {
    if (id === null || current === null) return
    sections.push({ id, text: current.join('\n').trimEnd() })
    id = null
    current = null
  }
  for (const line of text.split('\n')) {
    const match = /^##\s+(\S+)/.exec(line)
    if (match !== null) {
      flush()
      id = match[1]
      // The heading is kept verbatim: whatever follows the id is documentation
      // the model should still read.
      current = [line]
      continue
    }
    if (current === null) preamble.push(line)
    else current.push(line)
  }
  flush()
  return { preamble: preamble.join('\n').trim(), sections }
}

/**
 * Whether one section id is pinned.
 * @param id - section id as read from its heading.
 * @param patterns - exact ids, or `PREFIX*` patterns; case-insensitive.
 * @returns whether any pattern matches.
 */
function isPinned(id: string, patterns: readonly string[]): boolean {
  const upper = id.trim().toUpperCase()
  for (const pattern of patterns) {
    const value = pattern.trim().toUpperCase()
    if (value === '') continue
    if (value.endsWith('*')) {
      if (upper.startsWith(value.slice(0, -1))) return true
    } else if (upper === value) return true
  }
  return false
}

/** Split `## <ID> ...` sections out of ledger text, hashing each body. */
function fingerprint(text: string): Map<string, string> {
  const map = new Map<string, string>()
  let id: string | null = null
  let body: string[] = []
  const flush = (): void => {
    // A hash rather than the body: the delta message names sections, so this is
    // all the comparison needs, and it keeps the persisted baseline small and
    // free of document contents. `MUTATION-LOG` stays excluded for the reason
    // given above.
    if (id !== null && id.toUpperCase() !== MUTATION_LOG_ID) {
      map.set(id, createHash('sha1').update(body.join('\n').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16))
    }
  }
  for (const line of text.split('\n')) {
    const match = /^##\s+(\S+)/.exec(line)
    if (match !== null) {
      flush()
      id = match[1]
      body = []
    } else if (id !== null) {
      body.push(line)
    }
  }
  flush()
  return map
}

/**
 * Compare two fingerprints.
 * @param previous - the last injected shape, or `null` when there is nothing
 *   comparable: a session that has never been read, or one whose binding moved
 *   to a different ledger (diffing across two ledgers would report every section
 *   as added and removed at once).
 * @param next - the shape read this turn.
 * @returns the per-section changes, or `null` when nothing moved.
 */
function delta(previous: Map<string, string> | null, next: Map<string, string>) {
  if (previous === null) return null
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  for (const [id, body] of next) {
    if (!previous.has(id)) added.push(id)
    else if (previous.get(id) !== body) changed.push(id)
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) removed.push(id)
  }
  if (added.length === 0 && changed.length === 0 && removed.length === 0) return null
  return { added, changed, removed }
}

/**
 * Mount ledger injection.
 * @param ctx - host context carrying `systemPrompt`.
 * @param deps - resolution inputs and the injection budget.
 * @returns disposer removing the listener.
 */
export function registerLedgerInjection(ctx: Context, deps: InjectDeps): () => void {
  /**
   * Where the last-injected baseline is persisted.
   *
   * Read per turn rather than cached in memory: an in-memory copy would be the
   * same bug one level down — a second process (or a restart) editing or
   * re-baselining the ledger would leave this process diffing against a stale
   * baseline, and the notice would be wrong in the direction that matters least
   * visibly. The file is small and `resolveLedger` already reads one per turn.
   */
  const storePath = fingerprintPathFor(deps.registryPath)

  /** Serialises the read-merge-write so concurrent turns cannot drop each other's entry. */
  let writing: Promise<void> = Promise.resolve()
  const remember = (sessionId: string, path: string, sections: Map<string, string>): Promise<void> => {
    writing = writing
      .then(() => rememberFingerprint(storePath, sessionId, {
        path,
        sections: Object.fromEntries(sections),
        at: Date.now(),
      }))
      .catch((error: unknown) => {
        // A baseline that cannot be saved costs one missed announcement on the
        // next turn. It must not fail the turn that is assembling right now —
        // which is also why the caller awaits this chain rather than the write:
        // awaiting makes "this turn assembled" imply "the baseline is durable",
        // so a crash immediately afterwards cannot lose the notice. A write is
        // only issued when the ledger or the binding actually moved.
        console.error(
          '[dsh-note-board] could not persist a ledger fingerprint:',
          error instanceof Error ? error.message : String(error),
        )
      })
    return writing
  }

  /**
   * The snapshot most recently queued per session, until the loop commits it.
   *
   * The loop claims the inbox *before* assembly and commits the claimed message
   * *after* it, so a body queued one step ago is momentarily neither pending nor
   * visible. Without remembering it, every change would be delivered twice: once
   * when it was detected, once when the copy went looking for itself during that
   * window and could not find the copy still in flight.
   */
  const inFlight = new Map<string, { id: string, text: string }>()

  /**
   * Resolve this agent's ledger and read its text.
   *
   * Shared by both entry points so the two deliveries can never disagree about
   * which file a session is bound to or how much of it is read.
   * @param agent - the agent whose session and cwd decide the binding.
   * @returns the resolved note and its raw text, or null when there is none.
   */
  const loadLedger = async (agent: Agent): Promise<{ ref: LedgerRef, text: string } | null> => {
    const session = agent.session
    if (session.id === undefined) return null
    const ref = await resolveLedger(
      // The agent's own view of its working directory is authoritative here;
      // the sessions service may not even be mounted in a given deployment.
      // Falling through (`??`) rather than returning early matters: a header
      // without a cwd is not "this session has no directory", and giving up
      // there would inject nothing for a session that does have a ledger.
      { ...deps, cwdOf: (id) => (id === session.id ? (session.header?.cwd ?? deps.cwdOf(id)) : deps.cwdOf(id)) },
      session.id,
    )
    // No ledger for this session means inject NOTHING. Falling back to some
    // other ledger here is precisely how a session about something else would
    // end up silently carrying another project's frozen definitions.
    // Both mean "inject nothing": `none` found no note, `off` was told not to.
    if (ref.source === 'none' || ref.source === 'off') return null
    try {
      // Bounded and type-checked, like every other read of a note: this runs
      // every turn, so an unbounded read here would be a standing cost, and a
      // FIFO or device in the attachment would hang the turn itself.
      return { ref, text: (await readBoundedFile(ref.path, deps.readBudget)).text }
    } catch {
      return null
    }
  }

  /**
   * Make sure the session holds exactly one current copy of the ledger body.
   *
   * This mirrors how the platform delivers its own file-backed context: the
   * message is built here, deduplicated against what is already pending or
   * already in the retained history, and prepended to the agent's inbox, which
   * the loop claims at the next step boundary. Because presence is decided by
   * looking at the *surface*, a copy dropped by compaction is re-added on the
   * next assembly without any bookkeeping of our own.
   */
  const ensureSnapshot = (agent: Agent | undefined, text: string): void => {
    if (agent === undefined) return
    if (agent.inbox.nextStep.some(message => snapshotTextOf(message) === text)) return
    const session = agent.session
    const retained = session.surface.nodes.some((seq) => {
      const event = session.eventAt(seq)
      return event?.type === 'user/message' && snapshotTextOf(event.data) === text
    })
    // Queued and not yet committed: the loop claims before assembling and
    // commits afterwards, so this is a copy still in flight rather than a
    // missing one. The marker is dropped by the commit event, not by looking
    // around, so a body that is committed and *then* compacted away is still
    // re-sent — which is the whole point of holding a marker at all.
    if (inFlight.get(session.id)?.text === text) return
    if (retained) return
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: INJECTION_PLUGIN,
          form: 'snapshot',
          sections: [{ name: S_LEDGER, text }],
        },
      })
      agent.inbox.prepend('next-step', message)
      inFlight.set(session.id, { id: message.id, text })
    } catch (error) {
      console.error(
        '[dsh-note-board] could not queue the ledger snapshot:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Deliver the body into the inbox *before* the first step claims it.
   *
   * The inbox is claimed at the start of a step, before the prompt is assembled
   * (`agent-loop/src/agent.ts`), so anything queued while assembling can only
   * reach the model one step later. The first step of a session is exactly where
   * the ledger has to be, and delivery is supported from this extension point —
   * which fires while the agent is published, before any turn runs.
   */
  const primeOnStart = deps.delivery === 'snapshot'
    ? ctx.on('agent/session-start', (payload: { agent?: Agent }) => {
      const agent = payload.agent
      if (agent === undefined || agent.session?.id === undefined) return
      void (async () => {
        const loaded = await loadLedger(agent)
        if (loaded === null) return
        const text = ledgerBody(loaded.ref, loaded.text, deps.injectBudget, deps.pinnedSections)
        if (text !== null) ensureSnapshot(agent, text)
      })().catch((error: unknown) => {
        console.error(
          '[dsh-note-board] could not prime the ledger snapshot:',
          error instanceof Error ? error.message : String(error),
        )
      })
    })
    : undefined

  /**
   * Queue the ledger-change notice as an injected context row.
   *
   * This used to be a second system-prompt section. It is a context injection
   * now because the notice is the one part of this feature that is worth
   * *seeing*: it lands in the transcript as a collapsed `上下文注入 · note-ledger`
   * row, so a reader can tell when the note moved and open it to see what
   * moved, instead of having to diff the system prompt across two requests.
   *
   * `kind` is `'plugin'` because the persisted session format validates `kind`
   * against a closed set — a producer cannot invent one — and `form: 'notice'`
   * is what gives the collapsed row its one-line account.
   *
   * Failure here must never break the turn: the body is already assembled and
   * authoritative, and a notice that could not be queued costs one missing
   * announcement, not a lost request.
   */
  const notifyChange = (
    agent: Agent | undefined,
    lines: readonly string[],
    changedSections: readonly LedgerSection[],
  ): void => {
    if (agent === undefined) return
    const account = lines.map(line => line.replace(/^[-\s]+/, '')).join('；')
    // The injected body carries only pinned sections, so for everything else this
    // notice *is* the delivery: naming a section without its new text would leave
    // the model holding the old one and no way to notice.
    const carried: string[] = []
    let carriedChars = 0
    if (changedSections.length > 0) {
      carried.push('', '以下节未随注入正文提供，这里附上它们的当前内容：')
      for (const section of changedSections) {
        const room = DELTA_BODY_MAX - carriedChars
        if (room <= 0) {
          carried.push(`- ${section.id}（超过通知上限，请读取文件）`)
          continue
        }
        const slice = section.text.length > room
          ? `${section.text.slice(0, room)}\n…（本节被截断，其余请读取文件）`
          : section.text
        carried.push('', slice)
        carriedChars += slice.length
      }
    }
    try {
      agent.inject(createUserMessage({
        content: [{
          type: 'text',
          text: [
            '[LEDGER DELTA] 笔记在你上次读到它之后发生了变化——可能来自另一个会话，也可能来自你自己本轮的写入。',
            ...lines,
            ...carried,
            '',
            // The channel differs per deployment, and saying "system prompt" while
            // the body travels as a user-role snapshot is simply false.
            deps.delivery === 'snapshot'
              ? '本轮注入的 [FROZEN LEDGER] 快照是**最新版本，以它为准**。'
              : '系统提示里的 [FROZEN LEDGER] 正文是**最新版本，以它为准**。',
            '你上下文里这些条目的旧副本**已经作废**：不要引用它、不要沿用它的写法或约定；',
            '若你前面的结论依赖旧版本，先按新版本把那一步重做，而不是在旧结论上继续叠加。',
          ].join('\n'),
        }],
        source: {
          kind: 'plugin',
          plugin: INJECTION_PLUGIN,
          form: 'notice',
          summary: `笔记已更新：${account}`.slice(0, DELTA_SUMMARY_MAX),
        },
      }))
    } catch (error) {
      console.error(
        '[dsh-note-board] could not queue a ledger-change notice:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  const disposeAssemble = ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    // `context.agent` is merged in by @deepseek-ai/dsh-agent; the type-only
    // import above is what makes it visible here.
    const agent = context.agent
    // `context.agent` is merged in by @deepseek-ai/dsh-agent; the type-only
    // import above is what makes it visible here.
    if (agent === undefined || agent.session?.id === undefined) return assembled
    const session = agent.session

    const loaded = await loadLedger(agent)
    if (loaded === null) return assembled
    const { ref, text } = loaded

    const current = fingerprint(text)
    // The baseline read here is the one written before the last restart, so an
    // edit made while DSH was down is announced on the resumed session's first
    // turn instead of being swallowed as "first read".
    const persisted = (await readFingerprints(storePath))[session.id]
    const previous = persisted !== undefined && persisted.path === ref.path
      ? new Map(Object.entries(persisted.sections))
      : null
    const change = delta(previous, current)
    // Two cases need the baseline written: a body that moved, and a fresh or
    // re-bound session, which has no comparable baseline yet. An unchanged turn
    // writes nothing — this runs every turn, and rewriting an identical file
    // would be pure churn.
    if (previous === null || change !== null) await remember(session.id, ref.path, current)

    // Where the sections land is decided at the end of this handler, because
    // order is presentation only — see the note there.
    const injected: PromptAssembly['sections'] = []

    if (change !== null) {
      const lines: string[] = []
      if (change.added.length > 0) lines.push(`- 新增：${change.added.join('、')}`)
      if (change.changed.length > 0) lines.push(`- 被替换：${change.changed.join('、')}`)
      if (change.removed.length > 0) lines.push(`- 被删除：${change.removed.join('、')}`)
      const changedIds = [...change.added, ...change.changed]
      notifyChange(
        agent,
        lines,
        sectionsOf(text).sections.filter(section => changedIds.includes(section.id)),
      )
    }

    const ledgerText = ledgerBody(ref, text, deps.injectBudget, deps.pinnedSections)
    if (ledgerText !== null) {
      // Two deliveries, one text. See `InjectDeps.delivery` for the trade-off.
      if (deps.delivery === 'snapshot') ensureSnapshot(agent, ledgerText)
      else injected.push({ name: S_LEDGER, text: ledgerText })
    }
    if (injected.length === 0) return assembled
    const names = new Set(injected.map(section => section.name))
    const rest = assembled.sections.filter(section => !names.has(section.name))
    return deps.placement === 'first'
      ? { ...assembled, sections: [...injected, ...rest] }
      : { ...assembled, sections: [...rest, ...injected] }
  })

  /**
   * Drop the in-flight marker as soon as the loop commits the message.
   *
   * This is the same signal the platform's own runtime-context projection uses
   * to learn where its snapshot landed. Observation alone would be wrong: a body
   * can be committed and compacted away before any assembly ever sees it, and
   * that body has to be sent again.
   */
  const forgetCommitted = ctx.on('session/event', (subject: { id?: string }, event: unknown) => {
    const record = event as { type?: unknown, data?: { id?: unknown } } | null
    if (record?.type !== 'user/message') return
    const id = record.data?.id
    const sessionId = subject?.id
    if (typeof id !== 'string' || typeof sessionId !== 'string') return
    if (inFlight.get(sessionId)?.id === id) inFlight.delete(sessionId)
  })

  const forgetOnDispose = ctx.on('agent/disposed', (payload: { agent?: Agent }) => {
    const id = payload.agent?.session?.id
    if (id !== undefined) inFlight.delete(id)
  })

  return () => {
    disposeAssemble()
    primeOnStart?.()
    forgetOnDispose()
    forgetCommitted()
  }
}

/**
 * The notice that revokes a body this session already received.
 *
 * Switching injection off cannot unwrite the snapshot that is already committed
 * to the session's history — history is append-only — so the honest move is to
 * say so, in the same shape as any other change: an injected row that names the
 * old copy as void. Without it the model would keep using a note the human
 * believes they just switched off.
 * @returns the message to inject.
 */
export function injectionOffNotice(): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '[FROZEN LEDGER] 本会话的笔记注入**已关闭**。',
        '此前注入的笔记副本**已作废**：不要再引用它、不要沿用它的写法或约定；',
        '若你前面的结论依赖它，先说明这一限制，而不是继续按它推进。',
        '需要继续使用时，请重新开启注入。',
      ].join('\n'),
    }],
    source: {
      kind: 'plugin',
      plugin: INJECTION_PLUGIN,
      form: 'notice',
      summary: '笔记注入已关闭（旧副本作废）',
    },
  })
}

/**
 * The model-visible text for one note: a contract header plus the body, clamped
 * to the injection budget.
 *
 * Shared by both deliveries, because the text the model reads must not depend on
 * which channel carried it.
 * @param ref - resolved note, whose source decides whether the header names it.
 * @param text - full note text read under the read budget.
 * @param budget - character cap on the body.
 * @returns the assembled text, or null when the note has no visible text.
 */
function ledgerBody(ref: LedgerRef, text: string, budget: number, pinned: readonly string[]): string | null {
  if (text.trim() === '') return null
  const { preamble, sections } = sectionsOf(text)
  const kept = sections.filter(section => isPinned(section.id, pinned))
  const elided = sections.filter(section => !isPinned(section.id, pinned))
  const pinnedChars = kept.reduce((total, section) => total + section.text.length, 0)
  // A note with no headings cannot be split, so it stays a single clamped body.
  const body = sections.length === 0 && text.length > budget
    ? `${text.slice(0, budget)}\n\n[... 笔记已截断；需要后续条目时请另行读取该文件 ...]`
    : text
  const head = [
    '[FROZEN LEDGER] 以下定义已冻结。**不得**在未显式声明 `[SYMBOL MUTATION]` 的情况下改写它们，',
    '也不得在推理中悄悄换用别的写法；引用时直接沿用这里的定义与约定。',
    // The change notice is claimed at a *later* step boundary than the body, so
    // the authority claim has to live in the body itself, which is present for
    // the step in between.
    // Scoped to *this message*, not to "the note": the body may hold only the
    // pinned sections, and a claim about the whole note would read as if the
    // omitted ones had been seen (or had never existed).
    '本消息列出的条目即最新版本：若你上下文里的副本与它们不一致，**以本消息为准**。',
    // Presence is not use, and citation is not transcription. Measured twice:
    // with the definitions merely present, a model asked to "first understand
    // this topic" read the repository's own derivation notes and never cited an
    // entry; told to cite entry ids, it named its entry twice while presenting
    // the repository's older expression instead. A label attached to a different
    // formula reads as compliance, which makes it worse than silence. So the
    // text demands the transcription itself, before anything is derived from it.
    '本轮讨论若涉及下列已冻结的对象，**先逐字抄录**相关条目的表达式与分量定义，再在其基础上推进；',
    '只贴条目编号不算完成这一步。若你要给出的式子与条目不逐项一致',
    '（前置系数、实部还是模方、相位、求和变量与上下界都要逐项比），**先停下来说明冲突**，',
    '而不是另给一个式子、或改用你自己的推导与仓库代码里的另一种写法。',
  ]
  // State the source only for discovery. An explicit attachment is the human's
  // own act and needs no reminder; an automatic binding must say which project
  // it came from, or the binding is invisible again.
  if (ref.source === 'discovered') head.push(`（本会话的笔记按其工作目录自动发现：${ref.path}）`)
  const parts = [...head, '']
  if (preamble !== '') parts.push(preamble, '')
  parts.push(body.trim())
  if (sections.length > 0) {
    parts.length = 0
    parts.push(...head, '')
    if (preamble !== '') parts.push(preamble, '')
    parts.push(kept.map(section => section.text).join('\n\n'))
    if (elided.length > 0) {
      // Named, not hidden: an omission a reader can see is a pointer to read the
      // file, while a silent one is indistinguishable from "there was nothing
      // else". Ids only, so that growth inside an elided section does not change
      // this text and therefore does not force a re-injection.
      parts.push(
        '',
        '[未注入的节] 下列节存在，但未随本消息提供——**未列出不等于已被删除**，也不能据其名推断其内容：',
        `- ${elided.map(section => section.id).join('、')}`,
        `需要时请读取：${ref.path}`,
      )
    }
    if (pinnedChars > budget) {
      parts.push(
        '',
        `[!] 固定节合计 ${pinnedChars} 字，已超出注入预算 ${budget}：为不丢定义仍完整注入，省略的节如上。`,
      )
    }
  }
  return parts.join('\n').trim()
}

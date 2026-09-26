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
import { readBoundedFile } from './read.ts'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the `system-prompt/assemble` waterfall this module joins,
// and the `agent` field dsh-agent merges into that context. Without these the
// event name is not in `keyof Events` and the handler's arguments are `unknown`.
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import { fingerprintPathFor, readFingerprints, rememberFingerprint } from './fingerprints.ts'
import type { LedgerDeps } from './ledgers.ts'
import { resolveLedger } from './ledgers.ts'

/** Section name for the ledger body, kept stable for the human reading the prompt. */
export const S_LEDGER = 'note-ledger'

/** Section name for the change notice. */
export const S_LEDGER_DELTA = 'note-ledger-delta'

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

  const dispose = ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    // `context.agent` is merged in by @deepseek-ai/dsh-agent; the type-only
    // import above is what makes it visible here.
    const session = context.agent?.session
    if (session?.id === undefined) return assembled

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
    if (ref.source === 'none') return assembled

    let text = ''
    try {
      // Bounded and type-checked, like every other read of a note: this runs
      // every turn, so an unbounded read here would be a standing cost, and a
      // FIFO or device in the attachment would hang the turn itself.
      text = (await readBoundedFile(ref.path, deps.readBudget)).text
    } catch {
      return assembled
    }

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

    // Order is the array's order: assembled sections carry no rank, so
    // prepending is how a contribution gets ahead of the persona.
    const injected: PromptAssembly['sections'] = []

    if (change !== null) {
      const lines: string[] = []
      if (change.added.length > 0) lines.push(`- 新增：${change.added.join('、')}`)
      if (change.changed.length > 0) lines.push(`- 被替换：${change.changed.join('、')}`)
      if (change.removed.length > 0) lines.push(`- 被删除：${change.removed.join('、')}`)
      injected.push({
        name: S_LEDGER_DELTA,
        text: [
          '[LEDGER DELTA] 笔记在你上次读到它之后发生了变化——可能来自另一个会话，也可能来自你自己本轮的写入。',
          ...lines,
          '',
          '下面 [FROZEN LEDGER] 的正文是**最新版本，以它为准**。',
          '你上下文里这些条目的旧版本**已经作废**：不要引用它、不要沿用它的写法或约定；',
          '若你前面的结论依赖旧版本，先按新版本把那一步重做，而不是在旧结论上继续叠加。',
        ].join('\n'),
      })
    }

    if (text.trim() !== '') {
      const body = text.length > deps.injectBudget
        ? `${text.slice(0, deps.injectBudget)}\n\n[... 笔记已截断；需要后续条目时请另行读取该文件 ...]`
        : text
      const head = [
        '[FROZEN LEDGER] 以下定义已冻结。**不得**在未显式声明 `[SYMBOL MUTATION]` 的情况下改写它们，',
        '也不得在推理中悄悄换用别的写法；引用时直接沿用这里的定义与约定。',
      ]
      // State the source only for discovery. An explicit attachment is the
      // human's own act and needs no reminder; an automatic binding must say
      // which project it came from, or the binding is invisible again.
      if (ref.source === 'discovered') head.push(`（本会话的笔记按其工作目录自动发现：${ref.path}）`)
      injected.push({ name: S_LEDGER, text: [...head, '', body.trim()].join('\n') })
    }

    if (injected.length === 0) return assembled
    const names = new Set(injected.map(section => section.name))
    const rest = assembled.sections.filter(section => !names.has(section.name))
    return { ...assembled, sections: [...injected, ...rest] }
  })

  return dispose
}

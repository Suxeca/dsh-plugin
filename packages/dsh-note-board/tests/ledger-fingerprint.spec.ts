/**
 * The `[LEDGER DELTA]` baseline survives a restart.
 *
 * ## The defect these tests pin down
 *
 * The baseline was a plain in-memory `Map`. Everything about the delta notice
 * worked while the process lived, and one case failed silently: **an edit made
 * while DSH was down was never announced.** The ledger body still refreshed (it
 * is read fresh every turn), so the resumed session reasoned from the new text
 * while its own history held the old one — and the notice that exists precisely
 * to break that assumption said nothing. The failure is one-sided, which is why
 * it survived a whole session of testing: nothing looks broken, the delta is
 * just absent.
 *
 * So the assertion that matters is "a fresh process, a ledger edited in between,
 * a delta on the first turn". `mount()` is called twice to model the restart,
 * and the two harnesses share only the store path on disk.
 *
 * The second defect is quieter and was found while writing this: a session that
 * changed binding used to be diffed against the *other* ledger's fingerprint,
 * which reports every section as added and removed at once — a false "the whole
 * document was rewritten" instead of the truth ("you are reading a different
 * ledger now").
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  MAX_FINGERPRINTS, MAX_STORE_CHARS, fingerprintPathFor, readFingerprints, rememberFingerprint, writeFingerprints,
} from '../src/host/fingerprints.ts'
import { INJECTION_PLUGIN, S_LEDGER, registerLedgerInjection } from '../src/host/inject.ts'
import { attachLedger } from '../src/host/ledgers.ts'

/** The ledger shape the whole feature is about: numbered, named sections. */
function ledgerText(frozenBody: string): string {
  return [
    '# Test note',
    '',
    '> 前导说明。',
    '',
    '## FROZEN-1 · 定义',
    '',
    frozenBody,
    '',
    '## VERDICT-1 · 非负性',
    '',
    'V1–V5 成立。',
    '',
  ].join('\n')
}

let base = ''
let project = ''
let ledger = ''
let registryPath = ''
let storePath = ''

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'note-fp-'))
  project = join(base, 'project')
  mkdirSync(join(project, 'notes'), { recursive: true })
  ledger = join(project, 'notes', 'ledger.md')
  writeFileSync(ledger, ledgerText('BODY-ONE'), 'utf8')
  registryPath = join(base, 'note-boards.json')
  storePath = fingerprintPathFor(registryPath)
})

afterEach(() => { rmSync(base, { recursive: true, force: true }) })

interface Section { readonly name: string, readonly text: string }

/**
 * Mount injection on a throwaway context and expose one turn.
 *
 * Deliberately not `apply`: this is the injection contract, and mounting routes
 * too would make the test depend on the web server for no gain. A fresh
 * `mount()` sharing the same `registryPath` **is** a process restart — the only
 * state that crosses is the file.
 */
function mount(placement?: 'first' | 'last', delivery?: 'section' | 'snapshot'): {
  turn: (sessionId: string) => Promise<readonly Section[]>
  /** Fire the session-start extension point the way the loop does. */
  start: (sessionId: string) => Promise<void>
  /** Context-injection messages this mount queued, in order. */
  readonly notices: readonly InjectedNotice[]
  /** Everything the session's surface currently retains, oldest first. */
  readonly surface: readonly InjectedNotice[]
  /** Drop the retained surface, the way compaction does. */
  compact: () => void
} {
  const byEvent = new Map<string, ((...args: never[]) => unknown)[]>()
  const ctx = {
    on: (event: string, listener: (...args: never[]) => unknown) => {
      const list = byEvent.get(event) ?? []
      list.push(listener)
      byEvent.set(event, list)
      return () => {}
    },
  } as unknown as Context
  const notices: InjectedNotice[] = []
  /**
   * Pending inbox items, and what the surface retains.
   *
   * The loop claims the inbox *before* it assembles each step
   * (`agent-loop/src/agent.ts`), so the harness claims first too: a message
   * queued during one turn is visible from the next one onward. Modelling that
   * order is the whole point — it is what the delivery trade-off turns on.
   */
  const pending: InjectedNotice[] = []
  const surface: InjectedNotice[] = []

  const agentFor = (id: string): unknown => ({
    session: {
      id,
      header: { cwd: project },
      surface: { nodes: surface.map((_, index) => index) },
      eventAt: (seq: number) => (surface[seq] === undefined
        ? undefined
        : { type: 'user/message', data: surface[seq] }),
    },
    inbox: {
      get nextStep(): readonly InjectedNotice[] { return pending },
      prepend: (_target: string, message: InjectedNotice) => {
        notices.push(message)
        pending.push(message)
      },
    },
    // `inject` queues to the same pending list the loop claims from, so both
    // channels are modelled the way the loop actually treats them.
    inject: (message: InjectedNotice) => {
      notices.push(message)
      pending.push(message)
    },
  })

  registerLedgerInjection(ctx, {
    cwdOf: () => project,
    registryPath,
    injectBudget: 6000,
    pinnedSections: ['FROZEN*', 'RULES', 'VERDICT*'],
    // The injection read is bounded like every other read; the fixtures are tiny.
    readBudget: 262144,
    placement,
    delivery,
  })
  return {
    notices,
    surface,
    compact: (): void => { surface.length = 0 },
    start: async (id: string): Promise<void> => {
      for (const listener of byEvent.get('agent/session-start') ?? []) listener({ agent: agentFor(id) })
      // The extension point is a synchronous emit, so the delivery it kicks off
      // is fire-and-forget; wait for the read behind it instead of guessing.
      const deadline = Date.now() + 1000
      while (notices.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    },
    turn: async (id: string): Promise<readonly Section[]> => {
      // The loop's real order, which is what makes this interesting: the inbox
      // is claimed *before* assembly, and the claimed message is committed to
      // the surface only *after* it. So during this assembly the previous
      // turn's body is neither pending nor visible — the window in which a
      // naive presence check queues a duplicate.
      const claimed = pending.splice(0, pending.length)
      const listener = (byEvent.get('system-prompt/assemble') ?? [])[0]
      if (listener === undefined) throw new Error('injection did not register a listener')
      const assembled = await listener(
        null,
        { agent: agentFor(id) },
        async () => ({ sections: [{ name: 'persona', text: 'PERSONA' }] }),
      ) as { sections: readonly Section[] }
      surface.push(...claimed)
      // The loop commits the claimed messages after the assembly, and the
      // session announces each commit.
      for (const message of claimed) {
        for (const listener of byEvent.get('session/event') ?? []) {
          listener({ id }, { type: 'user/message', data: message })
        }
      }
      return assembled.sections
    },
  }
}

/** One context-injection message, narrowed to the fields these tests read. */
interface InjectedNotice {
  readonly content: readonly { readonly type: string, readonly text: string }[]
  readonly source: { readonly kind: string, readonly plugin: string, readonly form?: string, readonly summary?: string }
}

/** Names of the system-prompt sections the ledger feature contributed, in order. */
const injectedNames = (sections: readonly Section[]): string[] =>
  sections.filter(section => section.name === S_LEDGER).map(section => section.name)

/**
 * The text of the single change notice a mount queued, or null when it queued
 * none.
 *
 * The notice is a context injection now, not a section: it is the visible half
 * of the feature (a `上下文注入 · note-ledger` row in the transcript), so these
 * assertions moved from the assembled sections to the injected message.
 */
const noticeText = (mount: { readonly notices: readonly InjectedNotice[] }): string | null =>
  mount.notices[0]?.content.map(part => part.text).join('\n') ?? null

describe('the delta baseline survives a restart', () => {
  it('announces nothing on a session never read before', async () => {
    const sections = await mount().turn('session-new')
    expect(injectedNames(sections)).toEqual([S_LEDGER])
    // A baseline is still recorded, or the *next* turn would have nothing to
    // compare against and would announce nothing again, forever.
    expect(Object.keys(await readFingerprints(storePath))).toEqual(['session-new'])
  })

  it('announces a change made while the process lived', async () => {
    const process = mount()
    await process.turn('session-live')
    writeFileSync(ledger, ledgerText('BODY-TWO'), 'utf8')
    const sections = await process.turn('session-live')
    // The body stays a section (guaranteed every turn); the notice is injected.
    expect(injectedNames(sections)).toEqual([S_LEDGER])
    expect(process.notices).toHaveLength(1)
    expect(noticeText(process)).toContain('FROZEN-1')
    // The row the UI renders is labelled from the durable source.
    expect(process.notices[0]?.source).toMatchObject({ kind: 'plugin', plugin: INJECTION_PLUGIN, form: 'notice' })
    expect(process.notices[0]?.source.summary).toContain('FROZEN-1')
  })

  it('announces a change made while DSH was down, on the resumed first turn', async () => {
    // Process A reads the ledger, then "DSH stops".
    await mount().turn('session-resumed')
    // The human edits the ledger with no DSH running.
    writeFileSync(ledger, ledgerText('BODY-EDITED-WHILE-DOWN'), 'utf8')
    // Process B, sharing only the store file.
    const process = mount()
    await process.turn('session-resumed')
    // Before the fix this announced nothing — silent, and the model keeps
    // reasoning from the pre-restart text in its history.
    expect(noticeText(process)).toContain('被替换：FROZEN-1')
  })

  it('still announces nothing when the ledger did not move across the restart', async () => {
    await mount().turn('session-quiet')
    const sections = await mount().turn('session-quiet')
    expect(injectedNames(sections)).toEqual([S_LEDGER])
  })

  it('does not diff a newly bound ledger against the previous one', async () => {
    const other = join(base, 'Other')
    mkdirSync(join(other, 'notes'), { recursive: true })
    const otherLedger = join(other, 'notes', 'ledger.md')
    writeFileSync(otherLedger, '# 另一本\n\n## OPEN-9 · 别的\n\n别的正文\n', 'utf8')

    const process = mount()
    await process.turn('session-rebound')
    const attached = await attachLedger(registryPath, 'session-rebound', otherLedger)
    expect(attached.ok).toBe(true)

    // A cross-ledger diff would say every section was added and removed at once.
    await process.turn('session-rebound')
    expect(noticeText(process)).toBeNull()
    // ...and the rebind re-baselines, so the NEXT edit of the new ledger *is*
    // announced rather than being swallowed as a second first-read.
    writeFileSync(otherLedger, '# 另一本\n\n## OPEN-9 · 别的\n\n改过的正文\n', 'utf8')
    await process.turn('session-rebound')
    expect(noticeText(process)).toContain('OPEN-9')
  })
})

describe('the store is a baseline, not a second copy of the ledger', () => {
  it('holds hashes rather than the ledger text', async () => {
    await mount().turn('session-hash')
    const raw = readFileSync(storePath, 'utf8')
    expect(raw).not.toContain('BODY-ONE')
    expect(raw).not.toContain('前导说明')
    expect(Object.values((await readFingerprints(storePath))['session-hash'].sections)).toHaveLength(2)
  })

  it('is not rewritten by a turn that changed nothing', async () => {
    const process = mount()
    await process.turn('session-stable')
    const before = statSync(storePath).mtimeMs
    await new Promise(resolve => setTimeout(resolve, 10))
    await process.turn('session-stable')
    expect(statSync(storePath).mtimeMs).toBe(before)
  })

  it('costs a delta, not a turn, when the file is corrupt', async () => {
    writeFileSync(storePath, '{ this is not json', 'utf8')
    const sections = await mount().turn('session-corrupt')
    expect(injectedNames(sections)).toEqual([S_LEDGER])
    // The corrupt file is replaced by a valid one on the next write.
    expect(Object.keys(await readFingerprints(storePath))).toEqual(['session-corrupt'])
  })

  it('drops rows that do not typecheck instead of the whole file', async () => {
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      sessions: {
        good: { path: ledger, sections: { 'FROZEN-1': 'abc' }, at: 1 },
        bad: { path: 42, sections: null, at: 2 },
      },
    }), 'utf8')
    const loaded = await readFingerprints(storePath)
    expect(Object.keys(loaded)).toEqual(['good'])
  })

  it('stays bounded, keeping the newest sessions', async () => {
    const many = Object.fromEntries(Array.from({ length: MAX_FINGERPRINTS + 20 }, (_, i) => [
      `s-${i}`,
      { path: ledger, sections: { 'FROZEN-1': `h${i}` }, at: i },
    ]))
    await writeFingerprints(storePath, many)
    const kept = await readFingerprints(storePath)
    expect(Object.keys(kept)).toHaveLength(MAX_FINGERPRINTS)
    expect(kept[`s-${MAX_FINGERPRINTS + 19}`]).toBeDefined()
    expect(kept['s-0']).toBeUndefined()
    expect(existsSync(storePath)).toBe(true)
  })
})

describe('the store is a bounded, independently validated input', () => {
  it('reads at most the store cap, so a replaced huge file is not parsed', async () => {
    // The cap counts characters, so the read may pull up to four bytes each; the
    // padding therefore has to exceed that byte budget AND sit inside the JSON
    // structure, so that truncation produces unparseable text. A valid entry
    // would otherwise come back and the test would prove nothing.
    const oversized = join(base, 'oversized-store.json')
    const valid = JSON.stringify({ version: 1, sessions: { s1: { path: ledger, sections: { FROZEN: 'h' }, at: 1 } } })
    const padded = `${valid.slice(0, -1)},"pad":"${'x'.repeat(MAX_STORE_CHARS * 4 + 1024)}"}`
    writeFileSync(oversized, padded, 'utf8')
    expect(await readFingerprints(oversized)).toEqual({})
  })

  it('drops entries whose `at` is not a number', async () => {
    const store = join(base, 'bad-at.json')
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { 's1': { path: ledger, sections: {}, at: 'soon' } },
    }), 'utf8')
    expect(await readFingerprints(store)).toEqual({})
  })

  it('refuses a __proto__ key instead of adopting it as the map prototype', async () => {
    const store = join(base, 'polluted-store.json')
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { '__proto__': { path: '/tmp/evil', sections: {}, at: 99 } },
    }), 'utf8')
    const parsed = await readFingerprints(store)
    expect(Object.keys(parsed)).toEqual([])
    expect((parsed as { at?: unknown }).at).toBeUndefined()
    expect(Object.getPrototypeOf(parsed)).toBeNull()
  })

  it('survives concurrent writers instead of racing on one temp file', async () => {
    // Overlapping assembles are the normal case, and a shared `.tmp` name makes
    // the loser's rename fail with ENOENT.
    const store = join(base, 'concurrent-store.json')
    const writers = Array.from({ length: 24 }, (_, index) => rememberFingerprint(store, `s${index}`, {
      path: ledger,
      sections: { FROZEN: 'h' },
      at: Date.now() + index,
    }))
    await expect(Promise.all(writers)).resolves.toBeDefined()
    expect(Object.keys(await readFingerprints(store)).length).toBeGreaterThan(0)
  })
})

describe('the injected sections land after the contract by default', () => {
  it('appends, so the persona comes first', async () => {
    const sections = await mount().turn('session-order-default')
    expect(sections.map(section => section.name)).toEqual(['persona', S_LEDGER])
  })

  it('prepends only when the deployment asks for it', async () => {
    const sections = await mount('first').turn('session-order-first')
    expect(sections.map(section => section.name)).toEqual([S_LEDGER, 'persona'])
  })
})

describe('the section states a duty to consult, not only an authority', () => {
  it('demands transcription, not just a citation', async () => {
    // Presence is not use, and citation is not transcription: measured, a model
    // named its entry twice while presenting the repository's older expression.
    // A label on a different formula reads as compliance, so the wording has to
    // ask for the transcription itself. This is the regression guard for it.
    const sections = await mount().turn('session-duty')
    const ledger = sections.find(section => section.name === S_LEDGER)
    expect(ledger?.text).toContain('先逐字抄录')
    expect(ledger?.text).toContain('只贴条目编号不算完成这一步')
    expect(ledger?.text).toContain('先停下来说明冲突')
  })
})

describe('snapshot delivery moves the body off the system prompt', () => {
  it('sends the same text by either channel', async () => {
    const viaSection = await mount(undefined, 'section').turn('session-cmp-section')
    const sectionText = viaSection.find(section => section.name === S_LEDGER)?.text
    const snapshots = mount(undefined, 'snapshot')
    const sections = await snapshots.turn('session-cmp-snapshot')
    // The text the model reads must not depend on which channel carried it.
    expect(snapshots.notices.at(-1)?.content[0]?.text).toBe(sectionText)
    expect(sections.find(section => section.name === S_LEDGER)).toBeUndefined()
  })

  it('queues the body as a durable snapshot of our own', async () => {
    const mounted = mount(undefined, 'snapshot')
    await mounted.turn('session-snapshot')
    const queued = mounted.notices.at(-1)
    expect(queued?.source).toMatchObject({ kind: 'plugin', plugin: INJECTION_PLUGIN, form: 'snapshot' })
    expect(queued?.source.sections?.[0]?.name).toBe(S_LEDGER)
  })

  it('does not re-queue a body that is still in flight', async () => {
    // Turn 2 assembles while turn 1's copy has been claimed but not yet
    // committed, so the surface cannot show it. Queuing again here is exactly
    // how a change used to cost two copies of the body instead of one.
    const mounted = mount(undefined, 'snapshot')
    await mounted.turn('session-stable-snapshot')
    const afterFirst = mounted.notices.length
    // The next turn is where the loop claims what the first one queued.
    await mounted.turn('session-stable-snapshot')
    expect(mounted.surface).toHaveLength(1)
    expect(mounted.notices.length).toBe(afterFirst)
  })

  it('re-adds the body after compaction drops it', async () => {
    const mounted = mount(undefined, 'snapshot')
    await mounted.turn('session-compacted')
    // Claimed on the next turn, then dropped by compaction.
    await mounted.turn('session-compacted')
    mounted.compact()
    await mounted.turn('session-compacted')
    // Nothing changed on disk, so the only reason to send it again is that the
    // retained copy is gone.
    expect(mounted.notices).toHaveLength(2)
  })

  it('queues a fresh snapshot when the note changes', async () => {
    const mounted = mount(undefined, 'snapshot')
    await mounted.turn('session-changed-snapshot')
    writeFileSync(ledger, ledgerText('BODY-SNAPSHOT-TWO'), 'utf8')
    await mounted.turn('session-changed-snapshot')
    // One change notice plus the new body.
    expect(mounted.notices.some(message => message.source.form === 'notice')).toBe(true)
    expect(mounted.notices.some(message => message.content[0]?.text.includes('BODY-SNAPSHOT-TWO'))).toBe(true)
  })

  it('primes the inbox at session start, before the first step claims it', async () => {
    // The loop claims the inbox before assembling, so a body first queued while
    // assembling would only reach the model one step late — and the first step
    // of a session is exactly where it has to be.
    const mounted = mount(undefined, 'snapshot')
    await mounted.start('session-primed')
    expect(mounted.notices).toHaveLength(1)
    expect(mounted.notices[0]?.source.form).toBe('snapshot')
  })
})

describe('a session switched off injects nothing', () => {
  it('sends neither a section nor a snapshot', async () => {
    // The switch is stored, not inferred: the note is right there under the
    // session's cwd, so discovery would bind it on the next assembly unless the
    // opt-out is checked first.
    writeFileSync(registryPath, `${JSON.stringify({ sessions: {}, off: ['session-off'], known: [] }, null, 2)}\n`, 'utf8')
    const viaSection = mount(undefined, 'section')
    const sectionTurn = await viaSection.turn('session-off')
    expect(sectionTurn.some(section => section.name === S_LEDGER)).toBe(false)
    expect(viaSection.notices).toHaveLength(0)

    const viaSnapshot = mount(undefined, 'snapshot')
    await viaSnapshot.turn('session-off')
    expect(viaSnapshot.notices).toHaveLength(0)
    await viaSnapshot.start('session-off')
    expect(viaSnapshot.notices).toHaveLength(0)
  })

  it('resumes when the opt-out is cleared', async () => {
    writeFileSync(registryPath, `${JSON.stringify({ sessions: {}, off: ['session-back'], known: [] }, null, 2)}\n`, 'utf8')
    const mounted = mount(undefined, 'section')
    await mounted.turn('session-back')
    expect(mounted.notices).toHaveLength(0)
    writeFileSync(registryPath, `${JSON.stringify({ sessions: {}, off: [], known: [] }, null, 2)}\n`, 'utf8')
    const resumed = await mounted.turn('session-back')
    expect(resumed.some(section => section.name === S_LEDGER)).toBe(true)
  })
})

/**
 * What the injected body *contains* is a decision, not an accident.
 *
 * The body used to be the note clamped by `slice`, which meant a growing log
 * section pushed the adjudications out of the prompt while the log stayed in it.
 * These tests pin the replacement: selection by section, omissions named, and —
 * because the snapshot channel re-delivers exactly when the body text changes —
 * a body that stays stable while a log grows underneath it.
 */
describe('the injected body is selected by section, not by prefix length', () => {
  /** A note with one pinned section, one volatile section, one adjudication. */
  const withTask = (frozen: string, task: string): string => [
    '# Test note',
    '',
    '## FROZEN-1 · 定义',
    '',
    frozen,
    '',
    '## TASK-1 · 当前任务',
    '',
    task,
    '',
    '## VERDICT-1 · 非负性',
    '',
    'V1 成立。',
    '',
  ].join('\n')

  /** The ledger text one turn contributed. */
  const bodyOf = async (process: ReturnType<typeof mount>, id: string): Promise<string> => {
    const sections = await process.turn(id)
    return sections.find(section => section.name === S_LEDGER)?.text ?? ''
  }

  it('carries the pinned sections whole and names the ones it left out', async () => {
    writeFileSync(ledger, withTask('BODY-ONE', 'LOG-ONE'), 'utf8')
    const body = await bodyOf(mount('last', 'section'), 'session-selection')
    expect(body).toContain('BODY-ONE')
    expect(body).toContain('V1 成立。')
    // Not injected, but named: an omission a reader can see is a pointer to read
    // the file, while a silent one is indistinguishable from "nothing else".
    expect(body).not.toContain('LOG-ONE')
    expect(body).toContain('TASK-1')
    expect(body).toContain('未列出不等于已被删除')
    // And the authority claim is scoped to what the message actually carries.
    expect(body).toContain('本消息列出的条目即最新版本')
    expect(body).not.toContain('本节即最新版本')
  })

  it('does not re-send the body when only an elided section grew', async () => {
    writeFileSync(ledger, withTask('BODY-ONE', 'LOG-ONE'), 'utf8')
    const process = mount('last', 'snapshot')
    await process.turn('session-stable')
    expect(process.notices.filter(message => message.source.form === 'snapshot')).toHaveLength(1)

    writeFileSync(ledger, withTask('BODY-ONE', 'LOG-ONE plus a whole new stage of conclusions'), 'utf8')
    await process.turn('session-stable')
    // The body is unchanged, so the snapshot channel delivers nothing — this is
    // what stops a note that grows every stage from costing a fresh body each
    // stage, and it is also what stops those bodies from competing with the
    // human's question for "the newest user message".
    expect(process.notices.filter(message => message.source.form === 'snapshot')).toHaveLength(1)

    // The new content still reaches the model: the change notice carries it,
    // because for an elided section the notice *is* the delivery.
    const notice = process.notices.filter(message => message.source.form === 'notice').at(-1)
    const text = notice?.content.map(part => part.text).join('\n') ?? ''
    expect(text).toContain('TASK-1')
    expect(text).toContain('a whole new stage of conclusions')
  })

  it('keeps a pinned section whole even when it alone exceeds the budget', async () => {
    const huge = 'X'.repeat(7000)
    writeFileSync(ledger, withTask(huge, 'LOG-ONE'), 'utf8')
    const body = await bodyOf(mount('last', 'section'), 'session-overbudget')
    expect(body).toContain(huge)
    expect(body).toContain('已超出注入预算')
  })

  it('re-sends the body, and only then, when a pinned section changes', async () => {
    writeFileSync(ledger, withTask('BODY-ONE', 'LOG-ONE'), 'utf8')
    const process = mount('last', 'snapshot')
    await process.turn('session-pinned')
    writeFileSync(ledger, withTask('BODY-TWO', 'LOG-ONE'), 'utf8')
    await process.turn('session-pinned')
    const snapshots = process.notices.filter(message => message.source.form === 'snapshot')
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1]?.content.map(part => part.text).join('\n')).toContain('BODY-TWO')
  })
})

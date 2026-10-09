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
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  MAX_FINGERPRINTS, MAX_STORE_CHARS, fingerprintPathFor, readFingerprints, rememberFingerprint, writeFingerprints,
} from '../src/host/fingerprints.ts'
import { INJECTION_PLUGIN, S_LEDGER, injectionOffNotice, registerLedgerInjection } from '../src/host/inject.ts'
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
interface StepOptions {
  reject?: boolean
  empty?: boolean
  aborted?: boolean
  commit?: boolean
  human?: string | null
  step?: number
  afterAssemble?: () => Promise<void>
}

function mount(placement?: 'first' | 'last', delivery?: 'section' | 'snapshot', options: { readBudget?: number, pinnedSections?: readonly string[], runLogSections?: readonly string[] } = {}) {
  const byEvent = new Map<string, ((...args: any[]) => any)[]>()
  const ctx = {
    on: (event: string, listener: (...args: any[]) => any) => {
      const list = byEvent.get(event) ?? []
      list.push(listener)
      byEvent.set(event, list)
      return () => { byEvent.set(event, (byEvent.get(event) ?? []).filter(item => item !== listener)) }
    },
  } as unknown as Context
  const notices: InjectedNotice[] = []
  const surfaces = new Map<string, UserMessage[]>()
  const pending: UserMessage[] = []
  let lastId = ''
  const surfaceFor = (id: string) => {
    if (!surfaces.has(id)) surfaces.set(id, [])
    return surfaces.get(id)!
  }
  const agentFor = (id: string): unknown => ({
    session: {
      id, header: { cwd: project },
      surface: { nodes: surfaceFor(id).map((_, index) => index) },
      eventAt: (seq: number) => surfaceFor(id)[seq] === undefined ? undefined : { type: 'user/message', data: surfaceFor(id)[seq] },
    },
    inbox: { get nextStep() { return pending }, prepend: (_target: string, message: UserMessage) => { pending.push(message) } },
    inject: (message: UserMessage) => { pending.push(message) },
  })
  const dispose = registerLedgerInjection(ctx, {
    cwdOf: () => project, registryPath, injectBudget: 6000,
    pinnedSections: options.pinnedSections ?? ['FROZEN*', 'RULES', 'VERDICT*'],
    runLogSections: options.runLogSections, readBudget: options.readBudget ?? 262144,
    placement, delivery,
  })
  const step = async (id: string, settings: StepOptions = {}) => {
    lastId = id
    // Real ordering: claim → assemble → awaited pre-step → commit → model.
    const claimed = pending.splice(0, pending.length)
    if (settings.human !== null) claimed.push(createUserMessage({
      content: [{ type: 'text', text: settings.human ?? 'CURRENT-QUESTION' }], source: { kind: 'user' },
    }))
    const agent = agentFor(id)
    const assembly = byEvent.get('system-prompt/assemble')?.[0]
    if (!assembly) throw new Error('assembly listener missing')
    const assembled = await assembly(null, { agent }, async () => ({ sections: [{ name: 'persona', text: 'PERSONA' }] }))
    await settings.afterAssemble?.()
    const controller = new AbortController()
    if (settings.aborted) controller.abort()
    const handler = byEvent.get('agent/pre-step')?.[0]
    if (!handler) throw new Error('pre-step listener missing')
    const decision = await handler({ agent, messages: claimed, turn: 1, step: settings.step ?? 1, signal: controller.signal }, async () => (
      settings.reject ? { kind: 'reject' } : { kind: 'enter', messages: settings.empty ? [] : claimed, startsRequestSeries: true }
    ))
    if (decision.kind === 'enter' && settings.commit !== false && !settings.aborted) {
      for (const message of decision.messages as UserMessage[]) {
        surfaceFor(id).push(message)
        if ((message.source?.kind === INJECTION_PLUGIN || (message.source?.kind === 'plugin' && message.source.plugin === INJECTION_PLUGIN))) notices.push(message as InjectedNotice)
        // The runtime emits synchronously; waiting here only drains the plugin's
        // async persistence callback before tests assert its on-disk baseline.
        for (const listener of byEvent.get('session/event') ?? []) await listener({ id }, { type: 'user/message', data: message })
      }
    }
    return { sections: assembled.sections as readonly Section[], decision, pendingCount: pending.length }
  }
  return {
    notices,
    get surface() { return surfaceFor(lastId) },
    compact: () => { surfaceFor(lastId).length = 0 },
    seed: (message: UserMessage) => { pending.push(message) },
    start: async (id: string) => {
      for (const listener of byEvent.get('agent/session-start') ?? []) await listener({ agent: agentFor(id) })
    },
    finish: async (id: string) => {
      for (const listener of byEvent.get('session/event') ?? []) await listener({ id }, { type: 'turn/end', data: {} })
    },
    turn: async (id: string) => (await step(id)).sections,
    step, dispose,
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
    expect(process.notices[0]?.source).toMatchObject({ kind: INJECTION_PLUGIN, plugin: INJECTION_PLUGIN, form: 'notice' })
    expect(process.notices[0]?.source.summary).toContain('FROZEN-1')
  })

  it('warns the writer when the changed section reads like one run record', async () => {
    // The content-boundary rule has to reach the *writer* at the moment of
    // writing; by the time the board shows a flag, the entry is already being
    // injected as knowledge on every later turn.
    const process = mount()
    writeFileSync(ledger, '# Ledger\n\n## FROZEN-1 · frozen\n\n原始定义。\n', 'utf8')
    await process.turn('session-smell')
    writeFileSync(ledger, '# Ledger\n\n## FROZEN-1 · frozen\n\n'
      + '本次跑了 K=32 的作业，提交后发现显存不够、报错内存墙；后来试了另一种写法仍然走不通，实测失败三次。\n', 'utf8')
    await process.turn('session-smell')
    const text = noticeText(process) ?? ''
    expect(text).toContain('内容边界')
    expect(text).toContain('RUN-LOG')
    expect(text).toContain('FROZEN-1')
  })

  it('stays quiet about the boundary when the changed section is a definition', async () => {
    const process = mount()
    writeFileSync(ledger, '# Ledger\n\n## FROZEN-1 · frozen\n\n旧定义。\n', 'utf8')
    await process.turn('session-clean')
    writeFileSync(ledger, '# Ledger\n\n## FROZEN-1 · frozen\n\n新定义：$\\Phi_{\\rm raw}$ 的两分量写法。\n', 'utf8')
    await process.turn('session-clean')
    const text = noticeText(process) ?? ''
    expect(text).toContain('被替换：FROZEN-1')
    expect(text).not.toContain('内容边界')
  })

  it('announces a change made while DSH was down, on the resumed first turn', async () => {    // Process A reads the ledger, then "DSH stops".
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
    expect(queued?.source).toMatchObject({ kind: INJECTION_PLUGIN, plugin: INJECTION_PLUGIN, form: 'snapshot' })
    expect(queued?.source.sections?.[0]?.name).toBe(S_LEDGER)
  })

  it('does not repeat the current retained body on the next step', async () => {
    // The first step now commits its snapshot immediately; the next step must
    // reuse that retained version rather than enqueueing another copy.
    const mounted = mount(undefined, 'snapshot')
    await mounted.turn('session-stable-snapshot')
    const afterFirst = mounted.notices.length
    // No plugin message should be queued for that next turn.
    await mounted.turn('session-stable-snapshot')
    expect(mounted.surface.filter(message => (message.source?.kind === INJECTION_PLUGIN || (message.source?.kind === 'plugin' && message.source.plugin === INJECTION_PLUGIN)))).toHaveLength(1)
    expect(mounted.notices.length).toBe(afterFirst)
  })

  it('re-adds the body after compaction drops it', async () => {
    const mounted = mount(undefined, 'snapshot')
    await mounted.turn('session-compacted')
    // Reuse once, then drop the committed body through compaction.
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

  it('delivers on the first awaited step without a fire-and-forget priming race', async () => {
    const mounted = mount(undefined, 'snapshot')
    await mounted.start('session-primed')
    expect(mounted.notices).toHaveLength(0)
    const entered = await mounted.step('session-primed')
    expect(entered.decision.messages[0].source.form).toBe('snapshot')
    expect(entered.decision.messages.at(-1).content[0].text).toBe('CURRENT-QUESTION')
    expect(entered.pendingCount).toBe(0)
  })
})

describe('pre-step admission is the snapshot delivery boundary', () => {
  it('delivers a changed large core and its notice before the question in the SAME step', async () => {
    const mounted = mount('last', 'snapshot')
    await mounted.turn('same-step')
    writeFileSync(ledger, ledgerText('X'.repeat(7300) + 'CORE-TAIL'), 'utf8')
    const entered = await mounted.step('same-step', { human: 'REPORT-THE-TAIL' })
    expect(entered.decision.kind).toBe('enter')
    expect(entered.decision.startsRequestSeries).toBe(true)
    expect(entered.decision.messages.map((m: UserMessage) => (m.source?.kind === 'plugin' || m.source?.kind === INJECTION_PLUGIN) ? m.source.form : m.source?.kind)).toEqual(['snapshot', 'notice', 'user'])
    expect(entered.decision.messages[0].content[0].text).toContain('CORE-TAIL')
    expect(entered.decision.messages.at(-1).content[0].text).toBe('REPORT-THE-TAIL')
    expect(entered.pendingCount).toBe(0)
  })

  it('reads snapshot data after assembly, so an edit before pre-step is visible immediately', async () => {
    const mounted = mount('last', 'snapshot')
    const entered = await mounted.step('between-phases', {
      afterAssemble: async () => { writeFileSync(ledger, ledgerText('BETWEEN-PHASES'), 'utf8') },
    })
    expect(entered.decision.messages[0].content[0].text).toContain('BETWEEN-PHASES')
  })

  it.each([{ reject: true }, { empty: true }, { aborted: true }])('does not resurrect a refused/cancelled/empty step: %j', async settings => {
    const mounted = mount('last', 'snapshot')
    await mounted.step('refused', settings)
    expect(mounted.notices).toHaveLength(0)
    expect(existsSync(storePath)).toBe(false)
    const accepted = await mounted.step('refused')
    expect(accepted.decision.messages[0].source.form).toBe('snapshot')
  })

  it('does not resurrect a cleared continuation or an empty initial step', async () => {
    const mounted = mount('last', 'snapshot')
    expect((await mounted.step('empty', { human: null })).decision.messages).toEqual([])
    expect((await mounted.step('empty', { empty: true, step: 2 })).decision.messages).toEqual([])
    expect(mounted.notices).toHaveLength(0)
    expect(existsSync(storePath)).toBe(false)
  })

  it('records the baseline only after admission actually commits', async () => {
    const mounted = mount('last', 'snapshot')
    await mounted.turn('abandoned')
    const before = readFileSync(storePath, 'utf8')
    writeFileSync(ledger, ledgerText('AFTER-ABORT'), 'utf8')
    const abandoned = await mounted.step('abandoned', { commit: false })
    expect(abandoned.decision.messages[0].content[0].text).toContain('AFTER-ABORT')
    expect(readFileSync(storePath, 'utf8')).toBe(before)
    await mounted.finish('abandoned')
    const retry = await mounted.step('abandoned')
    expect(retry.decision.messages[1].source.form).toBe('notice')
    expect(retry.decision.messages[1].content[0].text).toContain('被替换：FROZEN-1')
    expect(readFileSync(storePath, 'utf8')).not.toBe(before)
  })

  it('reuses an uncommitted candidate without mistaking it for a delivered copy', async () => {
    const mounted = mount('last', 'snapshot')
    const offered = await mounted.step('candidate', { commit: false })
    const entered = await mounted.step('candidate')
    expect(entered.decision.messages[0].id).toBe(offered.decision.messages[0].id)
    expect(mounted.notices.filter(m => m.source.form === 'snapshot')).toHaveLength(1)
  })

  it('compares the latest retained version rather than any earlier matching A', async () => {
    const mounted = mount('last', 'snapshot')
    await mounted.turn('aba')
    writeFileSync(ledger, ledgerText('BODY-B'), 'utf8')
    await mounted.turn('aba')
    writeFileSync(ledger, ledgerText('BODY-ONE'), 'utf8')
    const last = await mounted.step('aba')
    expect(last.decision.messages[0].content[0].text).toContain('BODY-ONE')
    expect(mounted.notices.filter(m => m.source.form === 'snapshot')).toHaveLength(3)
  })

  it('replaces a stale claimed legacy snapshot but preserves other producers and the question', async () => {
    const mounted = mount('last', 'snapshot')
    mounted.seed(createUserMessage({ content: [{ type: 'text', text: 'STALE-SNAPSHOT' }], source: { kind: 'plugin', plugin: INJECTION_PLUGIN, form: 'snapshot' } }))
    const foreign = createUserMessage({ content: [{ type: 'text', text: 'OTHER-CONTEXT' }], source: { kind: 'plugin', plugin: 'another-plugin', form: 'snapshot' } })
    mounted.seed(foreign)
    const result = await mounted.step('legacy')
    expect(result.decision.messages).toContain(foreign)
    expect(JSON.stringify(result.decision.messages)).not.toContain('STALE-SNAPSHOT')
    expect(result.decision.messages.at(-1).content[0].text).toBe('CURRENT-QUESTION')
    expect(result.pendingCount).toBe(0)
  })

  it('puts a fresh snapshot AFTER a queued off notice when re-enabled before the next claim', async () => {
    const mounted = mount('last', 'snapshot')
    await mounted.turn('quick-toggle')
    // Both button actions happened while idle; only the off action queues data.
    mounted.seed(injectionOffNotice())
    const entered = await mounted.step('quick-toggle')
    expect(entered.decision.messages.map((m: UserMessage) => (m.source?.kind === 'plugin' || m.source?.kind === INJECTION_PLUGIN) ? m.source.form : m.source?.kind)).toEqual(['notice', 'snapshot', 'user'])
    expect(entered.decision.messages[1].content[0].text).toContain('BODY-ONE')
    const steady = await mounted.step('quick-toggle')
    expect(steady.decision.messages).toHaveLength(1)
    expect(mounted.notices.filter(m => m.source.form === 'snapshot')).toHaveLength(2)
  })

  it('does not let an obsolete queued off notice revoke newly enabled section context', async () => {
    const mounted = mount('last', 'section')
    await mounted.turn('section-toggle')
    mounted.seed(injectionOffNotice())
    const entered = await mounted.step('section-toggle')
    expect(entered.sections.find(s => s.name === S_LEDGER)?.text).toContain('BODY-ONE')
    expect(entered.decision.messages).toHaveLength(1)
    expect(entered.decision.messages[0].source.kind).toBe('user')
  })

  it.each(['attached', 'discovered'])('revokes an old snapshot when the %s note disappears and re-delivers on recovery', async binding => {
    if (binding === 'attached') await attachLedger(registryPath, 'missing', ledger)
    const mounted = mount('last', 'snapshot')
    await mounted.turn('missing')
    const original = readFileSync(ledger, 'utf8')
    const baseline = readFileSync(storePath, 'utf8')
    rmSync(ledger)
    const unavailable = await mounted.step('missing')
    expect(unavailable.decision.messages[0].source.form).toBe('notice')
    expect(unavailable.decision.messages[0].content[0].text).toContain('知识库当前不可用')
    expect(unavailable.decision.messages[0].content[0].text).toContain('已作废')
    expect(readFileSync(storePath, 'utf8')).toBe(baseline)
    const stillMissing = await mounted.step('missing')
    expect(stillMissing.decision.messages).toHaveLength(1)
    writeFileSync(ledger, original, 'utf8')
    const recovered = await mounted.step('missing')
    expect(recovered.decision.messages[0].source.form).toBe('snapshot')
    expect(recovered.decision.messages[0].content[0].text).toContain('BODY-ONE')
  })

  it('does not deliver a claimed snapshot after injection was switched off', async () => {
    const mounted = mount('last', 'snapshot')
    mounted.seed(createUserMessage({ content: [{ type: 'text', text: 'STALE-SNAPSHOT' }], source: { kind: 'plugin', plugin: INJECTION_PLUGIN, form: 'snapshot' } }))
    writeFileSync(registryPath, JSON.stringify({ sessions: {}, known: [], off: ['off-before-claim'] }), 'utf8')
    const result = await mounted.step('off-before-claim')
    expect(result.decision.messages).toHaveLength(1)
    expect(result.decision.messages[0].source.kind).toBe('user')
    expect(mounted.notices).toHaveLength(0)
  })

  it('re-delivers after an off notice revoked an otherwise matching retained copy', async () => {
    const mounted = mount('last', 'snapshot')
    await mounted.turn('off-on')
    writeFileSync(registryPath, JSON.stringify({ sessions: {}, known: [], off: ['off-on'] }), 'utf8')
    mounted.seed(injectionOffNotice())
    await mounted.turn('off-on')
    writeFileSync(registryPath, JSON.stringify({ sessions: {}, known: [], off: [] }), 'utf8')
    const enabled = await mounted.step('off-on')
    expect(enabled.decision.messages[0].source.form).toBe('snapshot')
    expect(mounted.notices.filter(m => m.source.form === 'snapshot')).toHaveLength(2)
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

  it('injects nothing even when the switch is hiding a real attachment', async () => {
    // The resolver now names what an opt-out hides, so the reference it returns
    // for a switched-off session carries a path. Injection must keep refusing on
    // the *source*: a non-empty path is what a writer sees, not a licence to
    // inject a note this session was told to leave alone.
    const note = join(base, 'discovered', 'notes', 'ledger.md')
    mkdirSync(join(base, 'discovered', 'notes'), { recursive: true })
    writeFileSync(note, '# Note\n\n## FROZEN-1 · x\n\nbody\n', 'utf8')
    writeFileSync(registryPath, `${JSON.stringify({
      sessions: { 'session-off-attached': note }, off: ['session-off-attached'], known: [],
    }, null, 2)}\n`, 'utf8')
    const viaSection = mount(undefined, 'section')
    const turn = await viaSection.turn('session-off-attached')
    expect(turn.some(section => section.name === S_LEDGER)).toBe(false)

    const viaSnapshot = mount(undefined, 'snapshot')
    await viaSnapshot.turn('session-off-attached')
    expect(viaSnapshot.notices).toHaveLength(0)
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
    expect(body).toContain('本消息实际提供正文的条目即最新版本')
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

    // On-demand knowledge changes invalidate old copies without copying the
    // whole process back into context; complete entry reads are required.
    const notice = process.notices.filter(message => message.source.form === 'notice').at(-1)
    const text = notice?.content.map(part => part.text).join('\n') ?? ''
    expect(text).toContain('TASK-1')
    expect(text).not.toContain('a whole new stage of conclusions')
    expect(text).toContain('完整最新内容')
    expect(text).toContain(ledger)
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

describe('run logs are browsing-only, not another automatic delivery channel', () => {
  it.each(['section', 'snapshot'] as const)('does not deliver additions, growth or removal of logs via %s', async delivery => {
    const core = ledgerText('BODY-ONE')
    writeFileSync(ledger, core + '\n## RUN-LOG-1\nRAW-ONE', 'utf8')
    const process = mount('last', delivery, { pinnedSections: ['*'] })
    const first = await process.turn('session-log')
    const baseline = readFileSync(storePath, 'utf8')
    for (const text of [
      core + '\n## RUN-LOG-1\nRAW-TWO\n## JOURNAL-2\nMORE-OUTPUT',
      core + '\n## MUTATION-LOG\nLEGACY-OUTPUT',
      core,
    ]) {
      writeFileSync(ledger, text, 'utf8')
      const next = await process.turn('session-log')
      if (delivery === 'section') expect(next).toEqual(first)
    }
    expect(readFileSync(storePath, 'utf8')).toBe(baseline)
    expect(process.notices.filter(message => message.source.form === 'notice')).toHaveLength(0)
    expect(process.notices.filter(message => message.source.form === 'snapshot')).toHaveLength(delivery === 'snapshot' ? 1 : 0)
    expect(JSON.stringify([first, process.notices])).not.toContain('RAW-ONE')
  })

  it('filters legacy persisted log ids without announcing that knowledge was deleted', async () => {
    await mount().turn('session-upgrade')
    const store = await readFingerprints(storePath)
    await rememberFingerprint(storePath, 'session-upgrade', {
      ...store['session-upgrade'],
      sections: { ...store['session-upgrade'].sections, 'RUN-LOG-OLD': 'oldhash' },
    })
    const process = mount()
    await process.turn('session-upgrade')
    expect(process.notices).toHaveLength(0)
  })

  it('does not reintroduce log bodies through fenced fake knowledge headings', async () => {
    writeFileSync(ledger, ledgerText('BODY-ONE') + '\n## RUN-LOG\n```md\n## OPEN-FAKE\nRAW-SECRET\n```', 'utf8')
    const process = mount()
    await process.turn('session-fence')
    writeFileSync(ledger, readFileSync(ledger, 'utf8').replace('RAW-SECRET', 'NEW-SECRET'), 'utf8')
    const next = await process.turn('session-fence')
    expect(process.notices).toHaveLength(0)
    expect(JSON.stringify(next)).not.toContain('SECRET')
  })

  it('never sends a sliced formula in a knowledge change notice', async () => {
    writeFileSync(ledger, ledgerText('BODY-ONE') + '\n## OPEN-1\nold', 'utf8')
    const process = mount()
    await process.turn('session-demand')
    writeFileSync(ledger, ledgerText('BODY-ONE') + '\n## OPEN-1\n' + 'FORMULA'.repeat(1000), 'utf8')
    await process.turn('session-demand')
    expect(noticeText(process)).toContain('OPEN-1')
    expect(noticeText(process)).toContain('完整最新内容')
    expect(noticeText(process)).not.toContain('FORMULA')
  })

  it('warns on a capped read without recording false deletions or a partial baseline', async () => {
    await mount().turn('session-cap')
    const baseline = readFileSync(storePath, 'utf8')
    const process = mount('last', 'snapshot', { readBudget: 40 })
    await process.turn('session-cap')
    expect(readFileSync(storePath, 'utf8')).toBe(baseline)
    expect(process.notices.filter(message => message.source.form === 'notice')).toHaveLength(0)
    expect(noticeText(process)).toContain('文件读取上限')
    expect(noticeText(process)).not.toContain('BODY-ONE')
    const recovered = mount()
    const sections = await recovered.turn('session-cap')
    expect(JSON.stringify(sections)).toContain('BODY-ONE')
    expect(recovered.notices).toHaveLength(0)
  })
})

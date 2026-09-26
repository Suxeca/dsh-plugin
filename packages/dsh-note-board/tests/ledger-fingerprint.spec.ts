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
import { S_LEDGER, S_LEDGER_DELTA, registerLedgerInjection } from '../src/host/inject.ts'
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
function mount(): { turn: (sessionId: string) => Promise<readonly Section[]> } {
  const listeners: Array<(a: unknown, c: unknown, n: () => Promise<unknown>) => Promise<unknown>> = []
  const ctx = {
    on: (_event: string, listener: (a: unknown, c: unknown, n: () => Promise<unknown>) => Promise<unknown>) => {
      listeners.push(listener)
      return () => {}
    },
  } as unknown as Context
  registerLedgerInjection(ctx, {
    cwdOf: () => project,
    registryPath,
    injectBudget: 6000,
    // The injection read is bounded like every other read; the fixtures are tiny.
    readBudget: 262144,
  })
  return {
    turn: async (sessionId: string): Promise<readonly Section[]> => {
      const listener = listeners[0]
      if (listener === undefined) throw new Error('injection did not register a listener')
      const assembled = await listener(
        null,
        { agent: { session: { id: sessionId, header: { cwd: project } } } },
        async () => ({ sections: [{ name: 'persona', text: 'PERSONA' }] }),
      ) as { sections: readonly Section[] }
      return assembled.sections
    },
  }
}

/** Names of the sections the ledger feature injected, in order. */
const injectedNames = (sections: readonly Section[]): string[] =>
  sections.filter(section => section.name === S_LEDGER || section.name === S_LEDGER_DELTA).map(section => section.name)

/** The delta notice's text, or null when no notice was injected. */
const deltaText = (sections: readonly Section[]): string | null =>
  sections.find(section => section.name === S_LEDGER_DELTA)?.text ?? null

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
    expect(injectedNames(sections)).toEqual([S_LEDGER_DELTA, S_LEDGER])
    expect(deltaText(sections)).toContain('FROZEN-1')
  })

  it('announces a change made while DSH was down, on the resumed first turn', async () => {
    // Process A reads the ledger, then "DSH stops".
    await mount().turn('session-resumed')
    // The human edits the ledger with no DSH running.
    writeFileSync(ledger, ledgerText('BODY-EDITED-WHILE-DOWN'), 'utf8')
    // Process B, sharing only the store file.
    const sections = await mount().turn('session-resumed')
    // Before the fix this was `[S_LEDGER]` — silent, and the model keeps
    // reasoning from the pre-restart text in its history.
    expect(injectedNames(sections)).toEqual([S_LEDGER_DELTA, S_LEDGER])
    expect(deltaText(sections)).toContain('被替换：FROZEN-1')
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
    const rebound = await process.turn('session-rebound')
    expect(deltaText(rebound)).toBeNull()
    // ...and the rebind re-baselines, so the NEXT edit of the new ledger *is*
    // announced rather than being swallowed as a second first-read.
    writeFileSync(otherLedger, '# 另一本\n\n## OPEN-9 · 别的\n\n改过的正文\n', 'utf8')
    const edited = await process.turn('session-rebound')
    expect(deltaText(edited)).toContain('OPEN-9')
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

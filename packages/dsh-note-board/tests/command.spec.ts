/**
 * The `/note-board` command is a second door onto the same switch the board's
 * binding bar owns, so what these tests pin is that it writes the *same* state —
 * and that switching off says so, because a copy already committed to the
 * session's history cannot be unwritten.
 *
 * @module @suxeca/dsh-note-board/tests/command
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerBoardCommand } from '../src/host/command.ts'
import { readRegistry } from '../src/host/ledgers.ts'

/** The definition the module registered, narrowed to what these tests drive. */
interface CapturedDefinition {
  readonly name: string
  readonly handler: (invocation: unknown) => Promise<{ kind: string, text?: string }>
}

let base = ''
let registryPath = ''

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'note-board-command-'))
  registryPath = join(base, 'boards.json')
  writeFileSync(registryPath, JSON.stringify({ sessions: {}, off: [], known: [] }), 'utf8')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

/** Mount the command against a fake registry and return its definition. */
function mount(options: { withService?: boolean } = {}): {
  readonly definition: CapturedDefinition | null
  readonly injected: { source?: { form?: string } }[]
  readonly run: (rawInput: string, sessionId?: string) => Promise<{ kind: string, text?: string }>
} {
  let definition: CapturedDefinition | null = null
  const injected: { source?: { form?: string } }[] = []
  const ctx = {
    get: (name: string) => (name !== 'commands' || options.withService === false
      ? undefined
      : {
          register: (registered: CapturedDefinition) => {
            definition = registered
            return () => { definition = null }
          },
        }),
  } as unknown as Context
  registerBoardCommand(ctx, {
    registryPath,
    // `status` now resolves the binding, so the deps it reads are the resolver's
    // own. An empty cwd is the honest "this session discovers nothing" case.
    cwdOf: async () => '',
    ledgerFiles: ['notes/ledger.md'],
    auditInboxName: '.note-audit-inbox',
    maxBytes: 262144,
    injectBudget: 6000,
  })
  return {
    get definition() { return definition },
    injected,
    run: async (rawInput: string, sessionId = 'session-one') => {
      const captured = definition
      if (captured === null) throw new Error('the command was not registered')
      return captured.handler({
        agent: {
          session: { id: sessionId },
          inject: (message: { source?: { form?: string } }) => { injected.push(message) },
        },
        rawInput,
      })
    },
  }
}

describe('the /note-board command drives the same switch as the board', () => {
  it('turns injection off, reports it, and revokes the copy already sent', async () => {
    const mounted = mount()
    const off = await mounted.run(' off')
    expect(off.kind).toBe('success')
    expect((await readRegistry(registryPath)).off).toEqual(['session-one'])
    // The body may already be in this session's history, and history is
    // append-only, so switching off has to say so rather than stay silent.
    expect(mounted.injected).toHaveLength(1)
    expect(mounted.injected[0]?.source?.form).toBe('notice')

    const status = await mounted.run('')
    expect(status.text).toContain('关')
  })

  it('turns injection back on without revoking anything', async () => {
    const mounted = mount()
    await mounted.run('off')
    const on = await mounted.run('on')
    expect(on.kind).toBe('success')
    expect((await readRegistry(registryPath)).off).toEqual([])
    // Resuming sends nothing: there is no new copy to announce, and the old one
    // was never revoked by resuming.
    expect(mounted.injected).toHaveLength(1)
  })

  it('reports the state without touching it', async () => {
    const mounted = mount()
    const status = await mounted.run('status')
    expect(status.kind).toBe('success')
    expect(status.text).toContain('开')
    expect((await readRegistry(registryPath)).off).toEqual([])
  })

  it('rejects an argument it does not know, with usage', async () => {
    const mounted = mount()
    const bad = await mounted.run('maybe')
    expect(bad.kind).toBe('error')
    expect(bad.text).toContain('/note-board off | on | status')
  })

  it('stays absent, and harmless, without a command service', () => {
    const mounted = mount({ withService: false })
    expect(mounted.definition).toBeNull()
  })

  it('keeps the switch per session', async () => {
    const mounted = mount()
    await mounted.run('off', 'session-one')
    expect((await readRegistry(registryPath)).off).toEqual(['session-one'])
    await mounted.run('off', 'session-two')
    expect((await readRegistry(registryPath)).off).toEqual(['session-one', 'session-two'])
  })

  it('names the note, the binding and the section census in status', async () => {
    // A note whose two sections land in different classes: one resident, one a
    // run log. Status has to report the split, because "注入：开" alone cannot
    // tell a human what a turn is actually going to carry.
    const note = join(base, 'notes', 'ledger.md')
    mkdirSync(join(base, 'notes'), { recursive: true })
    writeFileSync(note, [
      '# Ledger',
      '',
      '## FROZEN-1 · frozen',
      // Over the 6000-character soft budget on purpose: the status line has to
      // report the overshoot, and "still provided whole" is the part a human
      // cannot guess from a character count.
      'x'.repeat(6500),
      '',
      '## RUN-LOG · a run',
      '- path: runs/1',
      '',
    ].join('\n'), 'utf8')
    writeFileSync(registryPath, JSON.stringify({ sessions: { 'session-one': note }, off: [], known: [] }), 'utf8')
    const mounted = mount()
    const status = await mounted.run('status')
    expect(status.kind).toBe('success')
    expect(status.text).toContain('手动附加')
    expect(status.text).toContain(note)
    expect(status.text).toContain('常驻 1 节')
    expect(status.text).toContain('运行日志 1 节')
    expect(status.text).toContain('超预算')
    // The census is per section, not just a total: the reply has to name which
    // section is costing the budget — that is the part a human can act on.
    expect(status.text).toContain('最大常驻：FROZEN-1 6521')
    // No delivery has committed in this fixture, so there is no baseline, and the
    // reply says so rather than implying the note is stable.
    expect(status.text).toContain('尚无注入基线')
  })

  it('still names what a switched-off session switched off', async () => {
    const note = join(base, 'notes', 'ledger.md')
    mkdirSync(join(base, 'notes'), { recursive: true })
    writeFileSync(note, '## FROZEN-1 · frozen\nbody\n', 'utf8')
    writeFileSync(registryPath, JSON.stringify({ sessions: { 'session-one': note }, off: ['session-one'], known: [] }), 'utf8')
    const mounted = mount()
    const status = await mounted.run('status')
    // A switch that cannot name its target is a switch nobody can verify, so
    // the off state reports the path as well as the state.
    expect(status.text).toContain('关')
    expect(status.text).toContain(note)
    expect(status.text).toContain('已被开关覆盖')
  })
})

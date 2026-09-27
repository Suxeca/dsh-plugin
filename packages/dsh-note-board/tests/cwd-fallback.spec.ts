/**
 * The session→ledger resolution chain, driven through the real plugin entry.
 *
 * ## What this guards
 *
 * `sessions` is an **in-memory** store: it holds the sessions currently loaded,
 * and nothing else. In a long-lived instance that is a handful of live sessions
 * against many more persisted ones — so a board that consulted only the memory
 * store reports "本会话未绑定笔记" for every conversation that has been swapped
 * out, and shows the catalogue instead of the note. The persistence fallback is
 * what closes that gap, and it is invisible from the outside: both the broken and
 * the fixed build return a well-formed 200 envelope, differing only in
 * `ref.source`.
 *
 * So these tests assert the *binding*, not the plumbing. The one that matters is
 * "a session the memory store has dropped but persistence still knows resolves
 * to its ledger" — before the fallback it answered `none`.
 *
 * The routes are exercised rather than `resolveLedger` directly, because the
 * defect being guarded lived in how the entry wired `cwdOf` into resolution: a
 * unit test of the resolver with a hand-supplied `cwdOf` would have passed both
 * before and after the fix.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, type Config } from '../src/index.ts'
import { ROUTE_LEDGER, ROUTE_PREFIX } from '../src/shared-routes.ts'

// ── a throwaway project with a ledger where discovery expects it ───────────
const base = mkdtempSync(join(tmpdir(), 'note-cwd-'))
const project = join(base, 'project')
mkdirSync(join(project, 'notes'), { recursive: true })
const ledger = join(project, 'notes', 'ledger.md')
writeFileSync(ledger, '# ledger\n\n## FROZEN-1 · x\n\nbody\n', 'utf8')

afterAll(() => { rmSync(base, { recursive: true, force: true }) })

/** A persisted-session snapshot, narrowed to the one field resolution reads. */
interface Snapshot { readonly header?: { readonly cwd?: string } }

/** Optional services this plugin reaches through `ctx.get`, made to lie or vanish. */
interface FakeServices {
  sessions?: unknown
  sessionPersistence?: unknown
  /**
   * The connection service's trust verdict for one request.
   *
   * `undefined` means "trusted"; `401`/`403` means the route must refuse. The
   * default below trusts everything so the resolution tests read as resolution
   * tests; the trust tests pass a rejection explicitly.
   */
  rejection?: 401 | 403
  /** Omit the connection service entirely, to prove the routes fail closed. */
  omitConnection?: boolean
}

interface FakeCtx {
  readonly ctx: Context
  /** Registered routes by path, so a test can invoke one the way the web server does. */
  readonly routes: Map<string, (req: unknown, res: unknown) => Promise<void>>
}

/**
 * A host context carrying only what this plugin reads.
 *
 * Deliberately not Cordis: the plugin reaches every optional service through
 * `ctx.get`, so a plain object is the honest description of its contract, and
 * `sessions`/`sessionPersistence` can be made to lie, throw, or go missing.
 */
function fakeCtx(services: FakeServices): FakeCtx {
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  const registry: Record<string, unknown> = {
    // `undefined` here is the whole point: a session the memory store has
    // dropped must still resolve. It is also how a deployment with no sessions
    // service looks, which must not be fatal either.
    sessions: services.sessions,
    sessionPersistence: services.sessionPersistence,
    // Every route is behind this check, so a fake context that omitted it would
    // exercise the fail-closed branch instead of the behaviour under test.
    connection: services.omitConnection === true
      ? undefined
      : { requestRejection: () => services.rejection },
  }
  const ctx = {
    get: (name: string) => registry[name],
    on: () => () => {},
    effect: (callback: () => unknown) => {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') (dispose as () => void)() }
    },
    provide: (name: string, value: unknown) => {
      registry[name] = value
      return () => { delete registry[name] }
    },
    // Scoped late injection, as the real context spells it: run the callback
    // now so a mount that waits for a service is still exercised here. This
    // fixture registers neither commands nor the services it would read, so the
    // callback finds nothing and the board mounts unchanged.
    inject: (_names: readonly string[], callback: (scope: unknown) => unknown) => callback(ctx),
    webServer: {
      register: (route: { path: string, handler: (req: unknown, res: unknown) => Promise<void> }) => {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  }
  return { ctx: ctx as unknown as Context, routes }
}

const config: Config = {
  registryPath: join(base, 'note-boards.json'),
  maxBytes: 262144,
  auditLimit: 20,
  injectBudget: 6000,
  pinnedSections: ['FROZEN*', 'RULES', 'VERDICT*'],
  scanRoots: [base],
  scanDepth: 3,
  catalogTtlMs: 30000,
  // Empty means "the built-in candidates", which is what this test exercises.
  ledgerFiles: [],
  auditInboxName: '',
}

/** Mount the plugin and ask its ledger route about one session, as the UI does. */
async function resolveVia(services: FakeServices, sessionId: string) {
  const fake = fakeCtx(services)
  apply(fake.ctx, config)
  const route = fake.routes.get(`${ROUTE_PREFIX}${ROUTE_LEDGER}`)
  if (route === undefined) throw new Error('the ledger route was not registered')
  return ask(route, sessionId)
}

async function ask(
  route: (req: unknown, res: unknown) => Promise<void>,
  sessionId: string,
): Promise<{ status: number, envelope: { ok: boolean, data: { ref: { source: string, path: string } } } }> {
  let status = 0
  let body = ''
  await route(
    { method: 'GET', url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=${encodeURIComponent(sessionId)}` },
    { writeHead: (code: number) => { status = code }, end: (chunk: string) => { body = chunk } },
  )
  return { status, envelope: JSON.parse(body) }
}

describe('ledger binding follows the session, not the memory store', () => {
  it('resolves a live session through the in-memory store', async () => {
    const { envelope } = await resolveVia(
      { sessions: { get: () => ({ header: { cwd: project } }) } },
      'session-live',
    )
    expect(envelope.data.ref.source).toBe('discovered')
    expect(envelope.data.ref.path).toBe(ledger)
  })

  it('resolves a session the memory store has dropped, via persistence', async () => {
    // The regression: before the fallback this answered `source: 'none'`, which
    // the board renders as "本会话未绑定笔记" for a session that has a ledger.
    const stat = vi.fn(async () => ({ header: { cwd: project } }) as Snapshot)
    const { envelope } = await resolveVia(
      { sessions: { get: () => undefined }, sessionPersistence: { stat } },
      'session-evicted',
    )
    expect(envelope.data.ref.source).toBe('discovered')
    expect(envelope.data.ref.path).toBe(ledger)
    expect(stat).toHaveBeenCalledWith('session-evicted')
  })

  it('falls back to persistence when the memory store itself throws', async () => {
    const { envelope } = await resolveVia(
      {
        sessions: { get: () => { throw new Error('memory store exploded') } },
        sessionPersistence: { stat: async () => ({ header: { cwd: project } }) },
      },
      'session-throwy-store',
    )
    expect(envelope.data.ref.source).toBe('discovered')
  })

  it('answers "unbound" as data, not as an error', async () => {
    const { status, envelope } = await resolveVia({}, 'session-unknown')
    expect(status).toBe(200)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.ref.source).toBe('none')
  })

  it('degrades to "unbound" when persistence throws, without failing the route', async () => {
    const { status, envelope } = await resolveVia(
      { sessionPersistence: { stat: async () => { throw new Error('backend down') } } },
      'session-persistence-down',
    )
    expect(status).toBe(200)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.ref.source).toBe('none')
  })

  it('treats a snapshot without a cwd as unknown rather than as a binding', async () => {
    const { envelope } = await resolveVia(
      { sessionPersistence: { stat: async () => ({ header: {} }) } },
      'session-no-cwd',
    )
    expect(envelope.data.ref.source).toBe('none')
  })

  it('reads a session cwd from persistence at most once', async () => {
    // The board polls every few seconds; a durable read per poll would be waste.
    const stat = vi.fn(async () => ({ header: { cwd: project } }) as Snapshot)
    const fake = fakeCtx({ sessions: { get: () => undefined }, sessionPersistence: { stat } })
    apply(fake.ctx, config)
    const route = fake.routes.get(`${ROUTE_PREFIX}${ROUTE_LEDGER}`)!
    await ask(route, 'session-polled')
    await ask(route, 'session-polled')
    await ask(route, 'session-polled')
    expect(stat).toHaveBeenCalledTimes(1)
  })

  it('does not remember a miss as if it were an answer', async () => {
    // A session that becomes known later must not stay permanently unbound: the
    // negative answer is deliberately not cached, only the positive one is.
    const stat = vi.fn(async () => undefined as Snapshot | undefined)
    const fake = fakeCtx({ sessions: { get: () => undefined }, sessionPersistence: { stat } })
    apply(fake.ctx, config)
    const route = fake.routes.get(`${ROUTE_PREFIX}${ROUTE_LEDGER}`)!
    await ask(route, 'session-late')
    await ask(route, 'session-late')
    expect(stat).toHaveBeenCalledTimes(2)
  })
})

describe('an explicitly supplied cwd still wins', () => {
  it('resolves a ledger from the caller-supplied cwd, ignoring the stores', async () => {
    // A companion writer holds the Agent and reads the session header itself;
    // its view must be authoritative or the board and the prompt can diverge.
    const fake = fakeCtx({})
    apply(fake.ctx, config)
    const service = (fake.ctx as unknown as { get(name: string): unknown }).get('noteLedgers') as
      { resolve(id: string, cwd?: string): Promise<{ source: string, path: string }> }
    const ref = await service.resolve('session-from-caller', project)
    expect(ref.source).toBe('discovered')
    expect(ref.path).toBe(ledger)
  })
})

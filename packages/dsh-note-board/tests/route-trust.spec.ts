/**
 * The route trust gate and the read primitive — the two things that keep
 * "read a file the client named" from being an unauthenticated file-read.
 *
 * ## What this guards
 *
 * A named route registered on DSH's web server is matched **before** the
 * frontend-static fallback that owns the web app's auth gate, so a plugin route
 * is not authenticated by virtue of being served by the same server. Before this
 * gate existed, `POST /attach {path: "/etc/passwd"}` followed by `GET /ledger`
 * returned the file verbatim to any caller that could reach the port — no
 * credential, no confinement, no file-type check.
 *
 * Three properties are asserted here, because each one alone is not enough:
 *
 *   1. an untrusted request is refused **before** any filesystem work;
 *   2. a missing trust surface fails **closed** (503, not the file);
 *   3. the read itself refuses anything that is not a regular file — a directory,
 *      a device, or a FIFO, which `existsSync` happily accepts and which would
 *      otherwise block the read forever.
 *
 * @module @suxeca/dsh-note-board/tests/route-trust
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, type Config } from '../src/index.ts'
import { MAX_READ_CHARS, readBoundedFile } from '../src/host/read.ts'
import { fingerprintPathFor, rememberFingerprint } from '../src/host/fingerprints.ts'
import { sectionFingerprints } from '../src/host/inject.ts'
import { DEFAULT_RUN_LOG_SECTIONS } from '../src/sections.ts'
import { readRegistry } from '../src/host/ledgers.ts'
import {
  ROUTE_ATTACH, ROUTE_AUDITS, ROUTE_CATALOG, ROUTE_DETACH, ROUTE_INJECTION, ROUTE_KNOWN, ROUTE_LEDGER, ROUTE_PREFIX,
  ROUTE_STATE,
} from '../src/shared-routes.ts'

const base = mkdtempSync(join(tmpdir(), 'note-trust-'))
const project = join(base, 'project')
mkdirSync(join(project, 'notes'), { recursive: true })
const note = join(project, 'notes', 'ledger.md')
writeFileSync(note, '# note\n\n## FROZEN-1 · x\n\nbody\n', 'utf8')

afterAll(() => { rmSync(base, { recursive: true, force: true }) })

/** Distinguishes one mount's registry from the next. */
let mounts = 0

/** Counts web-server registrations within one mount, for the rollback test. */
let registrations = 0

/** One received response, captured the way the web server would send it. */
interface Captured { status: number, body: string }

/**
 * Mount the plugin over a context carrying only what it reads.
 *
 * @param options - trust verdict, whether the connection service exists, the
 *   character cap, and whether the Nth route registration should throw.
 * @returns the registered routes and the service registry the entry filled in.
 */
function mount(options: {
  rejection?: 401 | 403
  omitConnection?: boolean
  throwOnTrustCheck?: boolean
  maxBytes?: number
  failRegistrationAt?: number
  /** A caller-owned route table, so a failed mount and its retry share one. */
  table?: Map<string, (req: unknown, res: unknown) => Promise<void>>
  /** Stands in for the agent registry the injection switch revokes through. */
  agents?: { get: (id: string) => unknown }
} = {}) {
  const routes = options.table ?? new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  // A fresh registry per mount: sharing one would let an attach in one test
  // decide what another test reads.
  const registryPath = join(base, `note-boards-${mounts++}.json`)
  const services: Record<string, unknown> = {
    ...(options.agents === undefined ? {} : { agents: options.agents }),
    connection: options.omitConnection === true
      ? undefined
      : {
          requestRejection: () => {
            if (options.throwOnTrustCheck === true) throw new Error('trust check exploded')
            return options.rejection
          },
        },
  }
  const ctx: Record<string, unknown> = {
    get: (name: string) => services[name],
    on: () => () => {},
    // Scoped late injection as the real context spells it: run the callback now,
    // so a mount that waits for a service is still exercised. This fixture
    // registers no command service, so the callback finds nothing to register.
    inject: (_names: readonly string[], callback: (scope: unknown) => unknown) => callback(ctx),
    effect: (callback: () => unknown) => {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') (dispose as () => void)() }
    },
    provide: (name: string, value: unknown) => {
      services[name] = value
      return () => { delete services[name] }
    },
    webServer: {
      register: (route: { path: string, handler: (req: unknown, res: unknown) => Promise<void> }) => {
        registrations += 1
        if (options.failRegistrationAt === registrations) throw new Error('registration refused')
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  }
  const config: Config = {
    registryPath,
    maxBytes: options.maxBytes ?? 262144,
    auditLimit: 20,
    injectBudget: 6000,
    pinnedSections: ['FROZEN*', 'RULES', 'VERDICT*'],
    scanRoots: [base],
    scanDepth: 3,
    catalogTtlMs: 30000,
    ledgerFiles: [],
    auditInboxName: '',
  }
  registrations = 0
  apply(ctx as unknown as Context, config)
  return { routes, services, registryPath }
}

/** Drive one route with a request, returning what it answered. */
async function call(
  routes: Map<string, (req: unknown, res: unknown) => Promise<void>>,
  path: string,
  req: { method: string, url?: string, body?: unknown },
): Promise<Captured> {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`route not registered: ${path}`)
  let status = 0
  let body = ''
  const res = {
    writeHead: (code: number) => { status = code; return res },
    end: (chunk?: string) => { body = chunk ?? '' },
  }
  // A request body is an async iterable of buffers, which is the only shape
  // `readJsonBody` reads.
  const request: Record<string, unknown> = { method: req.method, url: req.url ?? path, headers: {} }
  if (req.body !== undefined) {
    const payload = Buffer.from(JSON.stringify(req.body), 'utf8')
    request[Symbol.asyncIterator] = async function * () { yield payload }
  }
  await handler(request, res)
  return { status, body }
}

describe('a route refuses an untrusted request before touching the filesystem', () => {
  it('answers 401 on GET /ledger without returning the note', async () => {
    const { routes } = mount({ rejection: 401 })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    expect(captured.status).toBe(401)
    // The point is the absence of content, not the presence of a status.
    expect(captured.body).toBe('')
  })

  it('answers 403 on POST /attach, so a session cannot be rebound', async () => {
    const { routes } = mount({ rejection: 403 })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    expect(captured.status).toBe(403)
    expect(captured.body).toBe('')
  })

  it('serves the note when the request is trusted', async () => {
    const { routes } = mount()
    const attached = await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    expect(attached.status).toBe(200)
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body).data.text).toContain('FROZEN-1')
  })

  it('returns exact injection preview and separates logs from browsable knowledge', async () => {
    const { routes } = mount()
    const mixed = join(project, 'mixed.md')
    writeFileSync(mixed, '# Preamble\n## FROZEN-1\nCORE\n## OPEN-1\nDETAIL\n## RUN-LOG\n' + 'RAW-OUTPUT'.repeat(1000), 'utf8')
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, { method: 'POST', body: { sessionId: 'mixed', path: mixed } })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET', url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=mixed`,
    })
    const data = JSON.parse(captured.body).data
    expect(data.knowledgeText).toContain('DETAIL')
    expect(data.knowledgeText).not.toContain('RAW-OUTPUT')
    expect(data.runLogsText).toContain('RAW-OUTPUT')
    expect(data.injection.overBudget).toBe(false)
    expect(data.injection.pinnedIds).toEqual(['FROZEN-1'])
    expect(data.injection.onDemandIds).toEqual(['OPEN-1'])
    expect(data.injection.logIds).toEqual(['RUN-LOG'])
    expect(data.injectionPreview).toContain('CORE')
    expect(data.injectionPreview).not.toContain('DETAIL')
    expect(data.injectionPreview).not.toContain('RAW-OUTPUT')
    const { ledgerBody } = await import('../src/host/inject.ts')
    expect(data.injectionPreview).toBe(ledgerBody(data.ref, data.text, 6000, ['FROZEN*', 'RULES', 'VERDICT*']))
  })

  it('reports the independent read cap rather than pretending a partial body is authoritative', async () => {
    const { routes } = mount({ maxBytes: 10 })
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, { method: 'POST', body: { sessionId: 'cap', path: note } })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET', url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=cap`,
    })
    const data = JSON.parse(captured.body).data
    expect(data.truncated).toBe(true)
    expect(data.injection.blocked).toBe(true)
    expect(data.injection.residentChars).toBe(0)
    expect(data.injectionPreview).toContain('文件读取上限')
    expect(data.injectionPreview).not.toContain('## FROZEN')
  })

  it('fails closed with 503 when the trust surface is missing entirely', async () => {
    const { routes } = mount({ omitConnection: true })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    expect(captured.status).toBe(503)
    expect(captured.body).not.toContain('FROZEN-1')
  })
})

describe('attach refuses anything that is not a regular file', () => {
  it('rejects a directory', async () => {
    const { routes } = mount()
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: project },
    })
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body).error).toContain('不是普通文件')
  })

  it('rejects an unusable session id instead of storing it as a key', async () => {
    const { routes } = mount()
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: '__proto__', path: note },
    })
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body).error).toContain('sessionId')
  })

  it('accepts a regular file', async () => {
    const { routes } = mount()
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body).data.source).toBe('attached')
  })
})

describe('the read is bounded and typed', () => {
  it('caps the text at the character limit and reports the true size', async () => {
    const big = join(base, 'big.md')
    writeFileSync(big, 'x'.repeat(10_000), 'utf8')
    const read = await readBoundedFile(big, 256)
    expect(read.text).toHaveLength(256)
    expect(read.truncated).toBe(true)
    expect(read.bytes).toBe(10_000)
  })

  it('reports no truncation for a file inside the cap', async () => {
    const read = await readBoundedFile(note, 4096)
    expect(read.truncated).toBe(false)
    expect(read.text).toContain('FROZEN-1')
  })

  it('refuses a directory', async () => {
    await expect(readBoundedFile(project, 4096)).rejects.toThrow(/not a regular file/)
  })

  it('refuses a FIFO instead of blocking on it forever', async () => {
    const fifo = join(base, 'pipe')
    try {
      execFileSync('mkfifo', [fifo])
    } catch {
      return // no mkfifo on this platform: nothing to assert
    }
    // Without O_NONBLOCK this open never returns, so the timeout is the test.
    const outcome = await Promise.race([
      readBoundedFile(fifo, 4096).then(() => 'resolved', (error: Error) => error.message),
      new Promise<string>(resolve => setTimeout(() => resolve('blocked'), 2000)),
    ])
    expect(outcome).not.toBe('blocked')
    expect(String(outcome)).toMatch(/not a regular file/)
  })
})

describe('the trust check fails closed when it throws', () => {
  it('answers 503 rather than letting the exception escape the handler', async () => {
    const { routes } = mount({ throwOnTrustCheck: true })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    expect(captured.status).toBe(503)
    expect(captured.body).not.toContain('FROZEN-1')
  })
})

describe('a failed mount leaves nothing registered', () => {
  it('disposes the routes registered before the failure and rethrows', async () => {
    // The table is owned by the test, not by the failed mount, so the assertion
    // is about what the web server still holds. Deleting the `undo()` call in
    // the catch makes this fail with size 2 — which is the point: an assertion
    // that a *fresh* table is empty after a failed mount proves nothing, and an
    // earlier version of this test did exactly that and passed with the rollback
    // removed.
    const table = new Map<string, (req: unknown, res: unknown) => Promise<void>>()
    expect(() => mount({ failRegistrationAt: 3, table })).toThrow(/registration refused/)
    expect(table.size).toBe(0)
    // Re-registering against the SAME table proves the failure did not block the
    // paths it had already taken (a leftover handler makes the retry collide).
    const { routes } = mount({ table })
    // Derived from the route constants, so adding a route cannot leave this
    // assertion quietly wrong.
    const owned = new Set([
      ROUTE_LEDGER, ROUTE_STATE, ROUTE_AUDITS, ROUTE_KNOWN, ROUTE_CATALOG, ROUTE_ATTACH, ROUTE_DETACH, ROUTE_INJECTION,
    ])
    expect(routes.size).toBe(owned.size)
    expect(table.size).toBe(owned.size)
  })
})

describe('the shared service reads like the routes do', () => {
  it('bounds the text a companion writer receives', async () => {
    const big = join(base, 'service-big.md')
    writeFileSync(big, 'y'.repeat(5_000), 'utf8')
    const { routes, services } = mount({ maxBytes: 128 })
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: big },
    })
    const service = services.noteLedgers as {
      read: (id: string, cwd?: string) => Promise<{ text: string }>
    }
    const bound = await service.read('s1')
    expect(bound.text).toHaveLength(128)
  })

  it('reports no text when a binding stopped being a regular file', async () => {
    // Attach validates the type, but a path can be replaced afterwards (a
    // directory, a FIFO, a device), so the reader re-checks instead of trusting
    // the validation done at attach time. Writing the registry directly is how
    // that state is reached without racing the filesystem.
    const { services, registryPath } = mount()
    writeFileSync(
      registryPath,
      JSON.stringify({ sessions: { 's-dir': project }, known: [] }),
      'utf8',
    )
    const service = services.noteLedgers as {
      read: (id: string, cwd?: string) => Promise<{ text: string }>
    }
    const bound = await service.read('s-dir')
    expect(bound.text).toBe('')
  })
})

describe('reads and registry state are bounded by construction', () => {
  it('clamps an absurd configured cap instead of allocating it', async () => {
    const read = await readBoundedFile(note, 1e12)
    expect(read.text).toContain('FROZEN-1')
    expect(read.text.length).toBeLessThanOrEqual(MAX_READ_CHARS)
  })

  it('counts the cap in UTF-16 code units, like the injection budget', async () => {
    const multibyte = join(base, 'cjk.md')
    writeFileSync(multibyte, '公'.repeat(500), 'utf8')
    const read = await readBoundedFile(multibyte, 100)
    expect(read.text).toHaveLength(100)
    expect(read.truncated).toBe(true)
  })

  it('never emits half a surrogate pair when the cap splits one', async () => {
    const astral = join(base, 'astral.md')
    // Nine BMP characters, then a supplementary one, so the cap lands exactly
    // between its two code units.
    writeFileSync(astral, `${'x'.repeat(9)}\u{1F409}tail`, 'utf8')
    const read = await readBoundedFile(astral, 10)
    expect(read.text).toBe('xxxxxxxxx')
    expect(read.truncated).toBe(true)
    // A lone surrogate would survive JSON.stringify but not a well-formed string.
    expect(read.text).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('ignores polluted or malformed persisted registry entries', async () => {
    const registryPath = join(base, 'polluted.json')
    writeFileSync(registryPath, JSON.stringify({
      sessions: { '__proto__': note, 'ok-id': note, 'bad id': note, 'x': 42 },
      known: [note, 7, ''],
    }), 'utf8')
    const registry = await readRegistry(registryPath)
    expect(Object.keys(registry.sessions)).toEqual(['ok-id'])
    expect(registry.known).toEqual([note])
    // The binding must be absent, not inherited from Object.prototype.
    expect(registry.sessions['__proto__']).toBeUndefined()
  })
})

describe('the injection switch is per session and revokes what was sent', () => {
  it('stops injecting, says so, and can be resumed', async () => {
    const injected: { source?: { form?: string } }[] = []
    const agents = { get: () => ({ inject: (message: { source?: { form?: string } }) => { injected.push(message) } }) }
    const { routes } = mount({ agents })

    const off = await call(routes, `${ROUTE_PREFIX}${ROUTE_INJECTION}`, {
      method: 'POST',
      body: { sessionId: 's1', enabled: false },
    })
    expect(off.status).toBe(200)
    // The board has to be able to distinguish "switched off" from "no note".
    // Responses ride an envelope: `{ok, data}`.
    expect((JSON.parse(off.body) as { data: { source?: string } }).data.source).toBe('off')
    // Switching off cannot unwrite the copy already in the session's history, so
    // it revokes it instead of leaving the model to keep using it.
    expect(injected).toHaveLength(1)
    expect(injected[0]?.source?.form).toBe('notice')

    const stillOff = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    expect((JSON.parse(stillOff.body) as { data: { ref?: { source?: string } } }).data.ref?.source).toBe('off')

    const on = await call(routes, `${ROUTE_PREFIX}${ROUTE_INJECTION}`, {
      method: 'POST',
      body: { sessionId: 's1', enabled: true },
    })
    expect((JSON.parse(on.body) as { data: { source?: string } }).data.source).not.toBe('off')
    // Resuming does not revoke anything — nothing was sent, so nothing to void.
    expect(injected).toHaveLength(1)
  })

  it('leaves other sessions alone', async () => {
    const { routes } = mount()
    await call(routes, `${ROUTE_PREFIX}${ROUTE_INJECTION}`, {
      method: 'POST',
      body: { sessionId: 's1', enabled: false },
    })
    const other = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s2`,
    })
    expect((JSON.parse(other.body) as { data: { ref?: { source?: string } } }).data.ref?.source).not.toBe('off')
  })
})

/**
 * The budget view's data: size per section, and — against the last *injected*
 * baseline — which sections have been moving. That second signal is the whole
 * point: a note used as a log changes every session, frozen definitions do not,
 * and before this the only symptom was a total quietly crossing the soft budget.
 */
describe('GET /ledger reports per-section size and what moved', () => {
  it('classifies every section and has no baseline before the first injection', async () => {
    const { routes } = mount()
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    const data = (JSON.parse(captured.body) as {
      data: { sections?: readonly { id: string, cls: string, chars: number, changed: boolean }[], baselineAt?: number | null }
    }).data
    const frozen = data.sections?.find(row => row.id === 'FROZEN-1')
    expect(frozen?.cls).toBe('resident')
    expect(frozen?.chars).toBeGreaterThan(0)
    // No baseline means every flag is false by construction, not by observation.
    expect(data.baselineAt).toBeNull()
    expect(data.sections?.every(row => !row.changed)).toBe(true)
  })

  it('marks a section changed only after it diverges from the injected baseline', async () => {
    const { routes, registryPath } = mount()
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    const before = readFileSync(note, 'utf8')
    // A baseline is what a *committed* delivery would have recorded: the same
    // hashes the delta notice compares, written through the same store.
    await rememberFingerprint(fingerprintPathFor(registryPath), 's1', {
      path: note,
      sections: Object.fromEntries(sectionFingerprints(before, DEFAULT_RUN_LOG_SECTIONS)),
      at: Date.now(),
    })
    const stable = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    const stableRows = (JSON.parse(stable.body) as {
      data: { sections?: readonly { id: string, changed: boolean }[], baselineAt?: number | null }
    }).data
    expect(stableRows.baselineAt).toBeGreaterThan(0)
    expect(stableRows.sections?.every(row => !row.changed)).toBe(true)

    // The failure this view exists to surface: a resident section is appended
    // to, exactly as a log would be written.
    writeFileSync(note, `${before}\nmore process notes\n`, 'utf8')
    const moved = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    const movedRows = (JSON.parse(moved.body) as {
      data: { sections?: readonly { id: string, cls: string, changed: boolean }[] }
    }).data
    expect(movedRows.sections?.find(row => row.id === 'FROZEN-1')?.changed).toBe(true)
    writeFileSync(note, before, 'utf8')
  })

  it('lists a run log with its size but does not claim to track its changes', async () => {
    const { routes } = mount()
    const withLog = join(base, 'ledger-with-log.md')
    writeFileSync(withLog, '# note\n\n## FROZEN-1 · x\n\nbody\n\n## RUN-LOG · a run\n- path: runs/1\n', 'utf8')
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: withLog },
    })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    const data = (JSON.parse(captured.body) as {
      data: { sections?: readonly { id: string, cls: string, changed: boolean }[] }
    }).data
    const log = data.sections?.find(row => row.id === 'RUN-LOG')
    expect(log?.cls).toBe('log')
    expect(log?.changed).toBe(false)
  })

  it('flags a knowledge section that reads like a run record, and never a log', async () => {
    const { routes } = mount()
    const mixed = join(base, 'ledger-mixed.md')
    writeFileSync(mixed, [
      '# note',
      '',
      '## FROZEN-1 · frozen',
      'definition only',
      '',
      '## VERDICT-9 · 设备与算法问题记录',
      '本次跑了 K=32 的作业，提交后发现显存不够、报错内存墙；当时怀疑算法写错，后来试了另一种写法仍然走不通，实测失败三次。',
      '',
      '## RUN-LOG · a run',
      '本次跑了 K=32，报错显存不够，失败三次，设备故障。',
      '',
    ].join('\n'), 'utf8')
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: mixed },
    })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    const data = (JSON.parse(captured.body) as {
      data: { sections?: readonly { id: string, cls: string, smell?: string, markers?: readonly string[] }[] }
    }).data
    expect(data.sections?.find(row => row.id === 'FROZEN-1')?.smell).toBeUndefined()
    expect(data.sections?.find(row => row.id === 'VERDICT-9')?.smell).toBe('episodic')
    expect((data.sections?.find(row => row.id === 'VERDICT-9')?.markers ?? []).length).toBeGreaterThan(0)
    // A run log is where such records belong: flagging it would invert the advice.
    expect(data.sections?.find(row => row.id === 'RUN-LOG')?.smell).toBeUndefined()
  })
})

/**
 * `GET /state` exists for the composer entry, which is mounted for as long as a
 * conversation is open. What it must never do is carry the note: a chip that
 * pulled a twenty-kilobyte body every few seconds would make an idle session's
 * cost grow with the note it happens to be showing.
 */
describe('GET /state answers the binding alone', () => {
  it('reports the binding, existence and switch, and never the text', async () => {
    const { routes } = mount()
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_STATE}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_STATE}?sessionId=s1`,
    })
    expect(captured.status).toBe(200)
    const data = (JSON.parse(captured.body) as { data: Record<string, unknown> }).data
    const ref = data.ref as { source?: string, path?: string }
    expect(ref.source).toBe('attached')
    expect(ref.path).toBe(note)
    expect(data.exists).toBe(true)
    expect(data.enabled).toBe(true)
    expect(Object.hasOwn(data, 'text')).toBe(false)
    // Belt and braces: the body of the note must not appear anywhere in the reply.
    expect(captured.body).not.toContain('## FROZEN-1')
  })

  it('names what an off switch hides while still reporting the switch as off', async () => {
    const { routes } = mount()
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    await call(routes, `${ROUTE_PREFIX}${ROUTE_INJECTION}`, {
      method: 'POST',
      body: { sessionId: 's1', enabled: false },
    })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_STATE}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_STATE}?sessionId=s1`,
    })
    const data = (JSON.parse(captured.body) as {
      data: { ref: { source?: string, underlying?: string, path?: string }, enabled?: boolean }
    }).data
    expect(data.ref.source).toBe('off')
    expect(data.ref.underlying).toBe('attached')
    expect(data.ref.path).toBe(note)
    expect(data.enabled).toBe(false)
  })

  it('is behind the same trust gate as every other route', async () => {
    const { routes } = mount({ rejection: 403 })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_STATE}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_STATE}?sessionId=s1`,
    })
    expect(captured.status).toBe(403)
    expect(captured.body).toBe('')
  })

  it('still serves the note to the board while injection is off', async () => {
    // Display is not delivery: the switch stops the note reaching the model, not
    // the human reading their own definitions. Blanking the pane is what made
    // "关闭" look like the note had been deleted.
    const { routes } = mount()
    await call(routes, `${ROUTE_PREFIX}${ROUTE_ATTACH}`, {
      method: 'POST',
      body: { sessionId: 's1', path: note },
    })
    await call(routes, `${ROUTE_PREFIX}${ROUTE_INJECTION}`, {
      method: 'POST',
      body: { sessionId: 's1', enabled: false },
    })
    const captured = await call(routes, `${ROUTE_PREFIX}${ROUTE_LEDGER}`, {
      method: 'GET',
      url: `${ROUTE_PREFIX}${ROUTE_LEDGER}?sessionId=s1`,
    })
    const data = (JSON.parse(captured.body) as {
      data: { ref: { source?: string }, exists?: boolean, text?: string }
    }).data
    expect(data.ref.source).toBe('off')
    expect(data.exists).toBe(true)
    expect(data.text).toContain('## FROZEN-1')
  })
})

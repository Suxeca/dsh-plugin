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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, type Config } from '../src/index.ts'
import { MAX_READ_CHARS, readBoundedFile } from '../src/host/read.ts'
import { readRegistry } from '../src/host/ledgers.ts'
import { ROUTE_ATTACH, ROUTE_LEDGER, ROUTE_PREFIX } from '../src/shared-routes.ts'

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
} = {}) {
  const routes = options.table ?? new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  // A fresh registry per mount: sharing one would let an attach in one test
  // decide what another test reads.
  const registryPath = join(base, `note-boards-${mounts++}.json`)
  const services: Record<string, unknown> = {
    connection: options.omitConnection === true
      ? undefined
      : {
          requestRejection: () => {
            if (options.throwOnTrustCheck === true) throw new Error('trust check exploded')
            return options.rejection
          },
        },
  }
  const ctx = {
    get: (name: string) => services[name],
    on: () => () => {},
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
    expect(routes.size).toBe(6)
    expect(table.size).toBe(6)
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

import { createServer, request } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerRoutes } from '../src/host/routes.ts'
import { ROUTE_STATE } from '../src/shared.ts'
import type { ExpressionState, ModeStore } from '../src/shared.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close(error => error ? reject(error) : resolve())
  })))
})

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
async function mount(options: {
  rejection?: 401 | 403; omitConnection?: boolean; throwTrust?: boolean;
  omitSessionQuery?: boolean; missingSession?: boolean; queryError?: boolean;
  mismatchedHeader?: boolean; storageError?: 'get' | 'update';
} = {}) {
  const routes = new Map<string, Handler>()
  const disposedLease = vi.fn()
  let state: ExpressionState = { sessionId: 's1', mode: 'default', language: 'auto', revision: 0, updatedAt: null, ruleVersion: 'v1' }
  const store: ModeStore = {
    get: vi.fn(async () => {
      if (options.storageError === 'get') throw new Error('/private/secret/store.json EACCES')
      return state
    }),
    set: vi.fn(async () => { throw new Error('Legacy setter must not be used by routes') }),
    update: vi.fn(async (sessionId, patch) => {
      if (options.storageError === 'update') throw new Error('/private/secret/store.json EACCES')
      state = { ...state, ...patch, sessionId, revision: state.revision + 1, updatedAt: 1234, ruleVersion: 'v1' }
      return state
    }),
  }
  const observeSession = vi.fn(async (id: string) => {
    if (options.missingSession) throw Object.assign(new Error('/private/session missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    if (options.queryError) throw new Error('/private/session inaccessible')
    return {
      header: { id: options.mismatchedHeader ? 'other' : id }, [Symbol.dispose]: disposedLease,
      get events(): never { throw new Error('must not read live events') },
      toJSON(): never { throw new Error('must not serialize a live lease') },
    }
  })
  const trust = vi.fn(() => {
    if (options.throwTrust) throw new Error('/private/trust failure')
    return options.rejection
  })
  const services: Record<string, unknown> = {
    connection: options.omitConnection ? undefined : { requestRejection: trust },
    sessionQuery: options.omitSessionQuery ? undefined : { observeSession },
    webServer: {
      register: (route: { kind: string; path: string; handler: Handler }) => {
        expect(route.kind).toBe('exact')
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  }
  const ctx = { get: (name: string) => services[name] } as unknown as Context
  const dispose = registerRoutes(ctx, store)
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url ?? '/', 'http://test.invalid').pathname)
    if (handler === undefined) { res.writeHead(404); res.end(); return }
    void Promise.resolve(handler(req, res)).catch(() => { res.writeHead(599); res.end('uncaught') })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address() as AddressInfo
  const authority = `127.0.0.1:${address.port}`
  async function call(options: {
    method?: string; query?: string; body?: unknown; raw?: string; chunks?: string[];
    headers?: Record<string, string>; noContentType?: boolean;
  } = {}) {
    const method = options.method ?? 'GET'
    const raw = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    return new Promise<{ status: number; headers: IncomingMessage['headers']; text: string }>((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port: address.port,
        path: `${ROUTE_STATE}${options.query ?? '?sessionId=s1'}`, method,
        headers: {
          ...(method === 'POST' && !options.noContentType ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
      }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      req.on('error', reject)
      if (options.chunks) for (const chunk of options.chunks) req.write(chunk)
      req.end(raw)
    })
  }
  return { call, store, observeSession, disposedLease, trust, dispose, routes, authority }
}

describe('expression routes on a real HTTP server', () => {
  it.each([401, 403] as const)('auth %s is checked before query, validation or store', async rejection => {
    const h = await mount({ rejection })
    const response = await h.call({ method: 'POST', raw: 'invalid' })
    expect(response.status).toBe(rejection)
    expect(h.observeSession).not.toHaveBeenCalled()
    expect(h.store.get).not.toHaveBeenCalled()
    expect(h.store.update).not.toHaveBeenCalled()
  })
  it.each([{ omitConnection: true }, { throwTrust: true }])('fails closed when trust is unavailable: %j', async options => {
    const h = await mount(options)
    expect((await h.call()).status).toBe(503)
    expect(h.observeSession).not.toHaveBeenCalled()
    expect(h.store.get).not.toHaveBeenCalled()
  })
  it('returns confirmed state, saves, then reads durable host state', async () => {
    const h = await mount()
    const first = await h.call()
    expect(first.status).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(first.text)).toEqual({ ok: true, data: {
      sessionId: 's1', mode: 'default', language: 'auto', revision: 0, updatedAt: null, ruleVersion: 'v1',
    } })
    const saved = await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'ste' }, headers: { origin: `http://${h.authority}` } })
    expect(saved.status).toBe(200)
    expect(JSON.parse(saved.text).data.mode).toBe('ste')
    expect(JSON.parse((await h.call()).text).data.revision).toBe(1)
    expect(h.observeSession).toHaveBeenCalledWith('s1', { projectionMode: 'none' })
    expect(h.disposedLease).toHaveBeenCalledTimes(3)
  })
  it('patches language without enabling style, then switches style without resetting language', async () => {
    const h = await mount()
    const chinese = await h.call({ method: 'POST', body: { sessionId: 's1', language: 'zh' } })
    expect(JSON.parse(chinese.text).data).toMatchObject({ language: 'zh', mode: 'default', revision: 1 })
    expect(h.store.update).toHaveBeenLastCalledWith('s1', { language: 'zh' })
    const simple = await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'ste' } })
    expect(JSON.parse(simple.text).data).toMatchObject({ language: 'zh', mode: 'ste', revision: 2 })
    const off = await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'default' } })
    expect(JSON.parse(off.text).data).toMatchObject({ language: 'zh', mode: 'default', revision: 3 })
    const english = await h.call({ method: 'POST', body: { sessionId: 's1', language: 'en' } })
    expect(JSON.parse(english.text).data).toMatchObject({ language: 'en', mode: 'default', revision: 4 })
    expect(h.store.get).not.toHaveBeenCalled()
    expect(h.store.set).not.toHaveBeenCalled()
  })
  it('accepts a combined patch through one atomic update and supports auto language', async () => {
    const h = await mount()
    const both = await h.call({ method: 'POST', body: { sessionId: 's1', language: 'en', mode: 'ste' } })
    expect(both.status).toBe(200)
    expect(JSON.parse(both.text).data).toMatchObject({ language: 'en', mode: 'ste', revision: 1 })
    expect(h.store.update).toHaveBeenCalledExactlyOnceWith('s1', { language: 'en', mode: 'ste' })
    const automatic = await h.call({ method: 'POST', body: { sessionId: 's1', language: 'auto' } })
    expect(JSON.parse(automatic.text).data).toMatchObject({ language: 'auto', mode: 'ste', revision: 2 })
    expect(h.store.get).not.toHaveBeenCalled()
    expect(h.store.set).not.toHaveBeenCalled()
  })
  it('allows an authenticated nonbrowser POST without Origin', async () => {
    const h = await mount()
    expect((await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'ste' } })).status).toBe(200)
  })
  it.each([
    { origin: 'https://evil.invalid' }, { origin: 'null' }, { origin: 'http://[malformed' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ])('rejects cross-origin writes before touching state: %j', async headers => {
    const h = await mount()
    expect((await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'ste' }, headers })).status).toBe(403)
    expect(h.observeSession).not.toHaveBeenCalled()
    expect(h.store.update).not.toHaveBeenCalled()
  })
  it('rejects cross-site even when Origin matches Host', async () => {
    const h = await mount()
    expect((await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'ste' },
      headers: { origin: `http://${h.authority}`, 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  })
  it('refuses unsupported methods and advertises Allow', async () => {
    const h = await mount()
    const response = await h.call({ method: 'DELETE' })
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET, POST')
    expect(h.observeSession).not.toHaveBeenCalled()
  })
  it.each(['', '?sessionId=', '?sessionId=__proto__', '?sessionId=../etc', '?sessionId=s1&sessionId=s2', '?sessionId=s1&path=/private'])('rejects invalid GET query %s', async query => {
    const h = await mount()
    expect((await h.call({ query })).status).toBe(400)
    expect(h.store.get).not.toHaveBeenCalled()
  })
  it.each([
    null, [], 'text', {}, { sessionId: 's1' }, { sessionId: 's1', mode: 'wrong' },
    { sessionId: '__proto__', mode: 'ste' }, { sessionId: 42, mode: 'ste' },
    { sessionId: 's1', mode: 'ste', path: '/etc/passwd' },
    { sessionId: 's1', language: 'fr' }, { sessionId: 's1', language: null },
    { sessionId: 's1', language: '' }, { sessionId: 's1', language: 'zh', mode: 'wrong' },
    { sessionId: 's1', language: 'zh', path: '/etc/passwd' },
    { language: 'zh' }, { sessionId: '__proto__', language: 'zh' },
  ])('rejects invalid POST JSON %j', async body => {
    const h = await mount()
    expect((await h.call({ method: 'POST', body })).status).toBe(400)
    expect(h.observeSession).not.toHaveBeenCalled()
    expect(h.store.update).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and non-JSON content types', async () => {
    const h = await mount()
    expect((await h.call({ method: 'POST', raw: '{broken' })).status).toBe(400)
    expect((await h.call({ method: 'POST', raw: '{}', noContentType: true })).status).toBe(415)
    expect((await h.call({ method: 'POST', raw: '{}', headers: { 'content-type': 'text/plain' } })).status).toBe(415)
  })
  it('bounds both declared and streamed request bodies by bytes', async () => {
    const h = await mount()
    expect((await h.call({ method: 'POST', raw: 'x'.repeat(4097), headers: { 'content-length': '4097' } })).status).toBe(413)
    expect((await h.call({ method: 'POST', chunks: [' '.repeat(2000), '界'.repeat(1000)] })).status).toBe(413)
    expect(h.store.update).not.toHaveBeenCalled()
  })
  it('returns 503 without the session query service', async () => {
    const h = await mount({ omitSessionQuery: true })
    expect((await h.call()).status).toBe(503)
    expect(h.store.get).not.toHaveBeenCalled()
  })
  it('returns 404 for unknown sessions without creating state', async () => {
    const h = await mount({ missingSession: true })
    expect((await h.call()).status).toBe(404)
    expect((await h.call({ method: 'POST', body: { sessionId: 's1', mode: 'ste' } })).status).toBe(404)
    expect(h.store.get).not.toHaveBeenCalled()
    expect(h.store.update).not.toHaveBeenCalled()
  })
  it('disposes a lease even when its header identity is rejected', async () => {
    const h = await mount({ mismatchedHeader: true })
    expect((await h.call()).status).toBe(404)
    expect(h.disposedLease).toHaveBeenCalledTimes(1)
    expect(h.store.get).not.toHaveBeenCalled()
  })
  it.each(['get', 'update'] as const)('sanitizes %s storage failures and releases leases', async storageError => {
    const h = await mount({ storageError })
    const response = await h.call(storageError === 'update' ? { method: 'POST', body: { sessionId: 's1', mode: 'ste' } } : {})
    expect(response.status).toBe(500)
    expect(response.text).not.toContain('/private')
    expect(response.text).not.toContain('EACCES')
    expect(JSON.parse(response.text).ok).toBe(false)
    expect(h.disposedLease).toHaveBeenCalledTimes(1)
  })
  it('sanitizes session observation failures', async () => {
    const h = await mount({ queryError: true })
    const response = await h.call()
    expect(response.status).toBe(500)
    expect(response.text).not.toContain('/private')
    expect(h.store.get).not.toHaveBeenCalled()
  })
  it('unregisters its exact route on disposal', async () => {
    const h = await mount()
    h.dispose()
    expect(h.routes.size).toBe(0)
    expect((await h.call()).status).toBe(404)
  })
})

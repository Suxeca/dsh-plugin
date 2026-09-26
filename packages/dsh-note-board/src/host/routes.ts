/**
 * Host routes for @suxeca/dsh-note-board.
 *
 *   GET  /note-board/api/ledger?sessionId=X   the session's bound ledger
 *   GET  /note-board/api/audits?sessionId=X   its adversarial-audit inbox
 *   GET  /note-board/api/known                ledgers attached before
 *   POST /note-board/api/attach               point a session at a ledger
 *   POST /note-board/api/detach               return it to discovery
 *
 * Every read route is session-addressed. That is the whole point of the
 * refactor: "the ledger" is not a global fact, so a route that returned one
 * fixed file could not express which session was asking.
 *
 * "No ledger for this session" is a normal 200 answer carrying
 * `ref.source === 'none'`, never an error. A session working on something else
 * is not a broken session, and a board that showed red for it would be lying
 * about the system's health.
 *
 * ## Every route runs behind the connection's trust check first
 *
 * These routes hand out file contents and rewrite a session binding, so the
 * first thing each handler does is ask the `connection` service whether the
 * request is trusted at all ({@link rejectUntrusted}). DSH's own file-touching
 * routes (`open-in-app`, the api gateway) do exactly this, and the reason is
 * that **a named route is not automatically behind the web app's auth gate**:
 * the gate belongs to the frontend-static fallback, and a route registered here
 * is matched before it. Without this check the board would be an unauthenticated
 * arbitrary-file-read reachable from any local process and from any peer that
 * can reach the port — including a browser on another origin via DNS rebinding.
 *
 * Refusing is deliberately *fail-closed*: an untrusted or unverifiable request
 * gets a rejection, never the file.
 *
 * @module @suxeca/dsh-note-board/host/routes
 */
import { readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { AuditFile, AuditsPayload, CatalogPayload, Envelope, KnownPayload, LedgerPayload } from '../shared.ts'
import { buildCatalog, type CatalogDeps } from './catalog.ts'
import {
  attachLedger, auditInboxFor, detachLedger, readRegistry, resolveLedger, usableSessionId, type LedgerDeps,
  setInjection,
} from './ledgers.ts'
import { injectionOffNotice } from './inject.ts'
import { readBoundedFile } from './read.ts'
import { ROUTE_ATTACH, ROUTE_AUDITS, ROUTE_CATALOG, ROUTE_DETACH, ROUTE_INJECTION, ROUTE_KNOWN, ROUTE_LEDGER, ROUTE_PREFIX } from '../shared-routes.ts'

/** Everything the routes need, supplied by the plugin entry. */
export interface BoardRouteDeps extends LedgerDeps, CatalogDeps {
  /** Character cap on a single file read, and on the text returned for it. */
  maxBytes: number
  /** How many verdict files the audit view offers, newest first. */
  auditLimit: number
  /** Characters a companion writer injects each turn. */
  injectBudget: number
}

/**
 * The trust surface this plugin consumes, typed locally.
 *
 * Declared structurally rather than imported: the `connection` package is a
 * browser-side entry, and the host half only ever reads this one method.
 */
interface BoardConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Refuse a request that the composition's connection service does not trust.
 *
 * @param ctx - host context; `connection` is declared in this plugin's `inject`
 *   list, so it is present whenever these routes are mounted.
 * @param req - the request being answered.
 * @param res - the response, ended here when the request is rejected.
 * @returns `true` when the request was rejected and the handler must stop.
 */
function rejectUntrusted(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const connection = ctx.get('connection') as BoardConnection | undefined
  if (connection === undefined || typeof connection.requestRejection !== 'function') {
    // Fail closed. Serving note contents to a caller we cannot vet would be the
    // whole vulnerability this check exists to close, so an unknown trust
    // surface is a refusal, not a pass.
    send(res, { ok: false, error: 'connection service unavailable' }, 503)
    return true
  }
  let rejection: 401 | 403 | undefined
  try {
    rejection = connection.requestRejection(req)
  } catch {
    // A trust check that *throws* must not become a trust check that passes —
    // and, since this call sits outside the handlers' own try/catch, letting the
    // exception escape would leave the request unanswered entirely.
    send(res, { ok: false, error: 'connection trust check failed' }, 503)
    return true
  }
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end()
  return true
}

/**
 * Read the session id from a query string, or `''` when it is not usable.
 *
 * Validation lives in `host/ledgers.ts` rather than here, because the persisted
 * registry is a second trust path that must apply the **same** rule.
 */
function sessionIdFrom(url: URL): string {
  const raw = url.searchParams.get('sessionId') ?? ''
  return usableSessionId(raw) ? raw : ''
}

/** Read the session id from a request body, or `''` when it is not usable. */
function sessionIdFromBody(body: Record<string, unknown>): string {
  const raw = typeof body.sessionId === 'string' ? body.sessionId : ''
  return usableSessionId(raw) ? raw : ''
}

/** Write one JSON envelope. */
function send<T>(res: ServerResponse, body: Envelope<T>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Read and parse a small JSON request body. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    // A board request body is a session id and a path. Anything larger is not
    // ours, and buffering it would be a free memory sink.
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  // The parser's own message is host-side detail; the caller gets a stable code.
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('invalid JSON body')
  }
}

/** Read the bound ledger, treating absence as data rather than failure. */
async function readLedger(deps: BoardRouteDeps, sessionId: string): Promise<LedgerPayload> {
  const ref = await resolveLedger(deps, sessionId)
  if (ref.source === 'none') {
    return { ref, exists: false, mtime: null, bytes: 0, text: '', truncated: false, injectBudget: deps.injectBudget }
  }
  try {
    // One bounded, type-checked read: the cap is a property of the read rather
    // than a slice applied to something already fully in memory.
    const read = await readBoundedFile(ref.path, deps.maxBytes)
    return {
      ref,
      exists: true,
      mtime: read.mtimeMs,
      bytes: read.bytes,
      text: read.text,
      truncated: read.truncated,
      // Character count, not byte count: a writer slices the JS string, and a
      // ledger full of CJK and TeX has far fewer characters than bytes.
      injectBudget: deps.injectBudget,
    }
  } catch {
    return { ref, exists: false, mtime: null, bytes: 0, text: '', truncated: false, injectBudget: deps.injectBudget }
  }
}

/**
 * List the audit inbox beside the bound ledger, newest first.
 *
 * Consumed verdicts (the writer renames them to `*.consumed` once it has fed them
 * back) are listed too, and marked — the board is for *reviewing* what the
 * auditors said, and a verdict the parent has already seen is exactly the one
 * worth re-reading.
 *
 * Only the newest `auditLimit` files are *read*: an inbox is append-only and
 * unbounded, so reading every verdict to then discard all but twenty would make
 * the cost of the view grow forever with the history it is meant to summarise.
 */
async function readAudits(deps: BoardRouteDeps, sessionId: string): Promise<AuditsPayload> {
  const ref = await resolveLedger(deps, sessionId)
  if (ref.source === 'none') return { dir: '', exists: false, files: [] }
  const dir = auditInboxFor(ref.path, deps.auditInboxName)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return { dir, exists: false, files: [] }
  }
  const candidates: Array<{ name: string, mtime: number }> = []
  for (const name of names) {
    if (!name.endsWith('.md') && !name.endsWith('.md.consumed')) continue
    try {
      const info = await stat(`${dir}/${name}`)
      candidates.push({ name, mtime: info.mtimeMs })
    } catch {
      // A file that vanished between readdir and stat is simply not listed.
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  const files: AuditFile[] = []
  for (const candidate of candidates.slice(0, deps.auditLimit)) {
    try {
      const read = await readBoundedFile(`${dir}/${candidate.name}`, deps.maxBytes)
      files.push({
        name: candidate.name,
        mtime: read.mtimeMs,
        bytes: read.bytes,
        text: read.text,
        consumed: candidate.name.endsWith('.consumed'),
      })
    } catch {
      // Unreadable or not a regular file: not listed.
    }
  }
  return { dir, exists: true, files }
}

/**
 * Bind the board's routes.
 * @param ctx - host context carrying `webServer`.
 * @param deps - resolution inputs and display limits.
 * @returns disposer removing every route.
 */
export function registerBoardRoutes(ctx: Context, deps: BoardRouteDeps): () => void {
  const disposers: Array<() => void> = []

  /**
   * Remove every route registered so far.
   *
   * Idempotent, and it swallows an individual undo failure: this runs both as
   * the plugin's disposer and as the rollback of a failed mount, and in the
   * second case an undo error must not replace the error being reported.
   */
  const undo = (): void => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // Documented above: never mask the original failure.
      }
    }
  }

  /** GET routes share the shape: vet the caller, refuse non-GET, run one handler. */
  const get = (path: string, handler: (url: URL, req: IncomingMessage) => Promise<unknown>): void => {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}${path}`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (rejectUntrusted(ctx, req, res)) return
        if (req.method !== 'GET') return send(res, { ok: false, error: 'only GET is supported' }, 405)
        try {
          send(res, { ok: true, data: await handler(new URL(req.url ?? '/', 'http://localhost'), req) })
        } catch (error) {
          // Detail host-side only. An fs failure names the syscall, the errno and
          // the absolute path (EACCES: ... '<path>'), and the caller has no use
          // for the host's filesystem layout — the *deliberate* refusals above
          // already answer with a message written for a human.
          console.error(`[dsh-note-board] GET ${path} failed:`, error instanceof Error ? error.message : String(error))
          send(res, { ok: false, error: 'request failed' }, 500)
        }
      },
    }))
  }

  const post = (path: string, handler: (body: Record<string, unknown>) => Promise<unknown>): void => {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}${path}`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (rejectUntrusted(ctx, req, res)) return
        if (req.method !== 'POST') return send(res, { ok: false, error: 'only POST is supported' }, 405)
        try {
          const body = await readJsonBody(req)
          const result = await handler(body)
          // Handlers report refusal as `{ error }` rather than by throwing, so a
          // rejected attach reads as a normal answer the UI can show inline.
          if (typeof result === 'object' && result !== null && 'error' in result) {
            return send(res, { ok: false, error: String((result as { error: unknown }).error) }, 400)
          }
          send(res, { ok: true, data: result })
        } catch (error) {
          // Same reasoning as the GET catch: the caller gets a stable code, the
          // host log gets the syscall, errno and path.
          console.error(`[dsh-note-board] POST ${path} failed:`, error instanceof Error ? error.message : String(error))
          send(res, { ok: false, error: 'request failed' }, 400)
        }
      },
    }))
  }

  try {
    get(ROUTE_LEDGER, (url) => readLedger(deps, sessionIdFrom(url)))
    get(ROUTE_AUDITS, (url) => readAudits(deps, sessionIdFrom(url)))
    get(ROUTE_KNOWN, async (): Promise<KnownPayload> => ({ paths: (await readRegistry(deps.registryPath)).known }))

    get(ROUTE_CATALOG, async (url): Promise<CatalogPayload> => {
      const ref = await resolveLedger(deps, sessionIdFrom(url))
      return {
        roots: deps.scanRoots,
        files: deps.ledgerFiles,
        entries: await buildCatalog(deps, ref.source === 'none' ? '' : ref.path),
      }
    })

    post(ROUTE_ATTACH, async (body) => {
      const sessionId = sessionIdFromBody(body)
      const path = String(body.path ?? '')
      if (sessionId === '') return { error: 'attach 需要合法的 sessionId' }
      if (path === '') return { error: 'attach 需要 path' }
      const result = await attachLedger(deps.registryPath, sessionId, path)
      return result.ok ? result.ref : { error: result.error }
    })

    post(ROUTE_DETACH, async (body) => {
      const sessionId = sessionIdFromBody(body)
      if (sessionId === '') return { error: 'detach 需要合法的 sessionId' }
      await detachLedger(deps.registryPath, sessionId)
      return resolveLedger(deps, sessionId)
    })

    post(ROUTE_INJECTION, async (body) => {
      const sessionId = sessionIdFromBody(body)
      if (sessionId === '') return { error: 'injection 需要合法的 sessionId' }
      const enabled = body['enabled'] !== false
      const changed = await setInjection(deps.registryPath, sessionId, enabled)
      // Switching off cannot unwrite a body already committed to the session's
      // history, so it says so rather than leaving the model to keep using a
      // note the human believes they just switched off. A live session with no
      // agent simply had nothing in context to revoke.
      if (changed && !enabled) {
        // The registry brands its session ids, and this one crossed a JSON
        // boundary: it is an id the host itself handed the client, so the brand
        // is true in fact and only needs saying again for the compiler here.
        const agents = ctx.get('agents') as unknown as {
          get(id: string): { inject(message: UserMessage): void } | undefined
        } | undefined
        agents?.get(sessionId)?.inject(injectionOffNotice())
      }
      return resolveLedger(deps, sessionId)
    })
  } catch (error) {
    // All-or-nothing: a route that failed to register must not leave the routes
    // registered before it bound to the web server, where they would keep
    // serving (and keep their closures alive) with no disposer left to remove
    // them — and would make the retry collide on the same path.
    undo()
    throw error
  }

  return undo
}

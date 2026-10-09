import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ROUTE_STATE, isExpressionMode, isExpressionLanguage, isExpressionPatch, usableSessionId } from '../shared.ts'
import type { ExpressionPatch, ExpressionState, ModeStore } from '../shared.ts'

const MAX_BODY_BYTES = 4096
interface Connection {
  requestRejection(req: IncomingMessage): 401 | 403 | undefined
}
interface SessionLease {
  readonly header: { readonly id: string }
  [Symbol.dispose](): void
}
interface SessionQuery {
  observeSession(id: string, options: { projectionMode: 'none' }): Promise<SessionLease>
}
class RouteError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** Named plugin routes precede the shell auth gate; never infer trust from URL. */
function rejected(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  try {
    const connection = ctx.get('connection') as Connection | undefined
    if (connection === undefined || typeof connection.requestRejection !== 'function') {
      send(res, 503, { ok: false, error: '认证服务暂不可用' })
      return true
    }
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    if (rejection !== 401 && rejection !== 403) throw new Error('invalid trust verdict')
    send(res, rejection, { ok: false, error: rejection === 401 ? '请先登录' : '请求来源不受信任' })
  } catch {
    send(res, 503, { ok: false, error: '无法确认请求身份' })
  }
  return true
}

/** Additional write fence; authenticated non-browser callers may omit Origin. */
function assertWriteOrigin(req: IncomingMessage): void {
  const site = req.headers['sec-fetch-site']
  if (site === 'cross-site') throw new RouteError(403, '拒绝跨站写入')
  const origin = req.headers.origin
  if (origin === undefined) {
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      throw new RouteError(403, '请求来源不受信任')
    }
    return
  }
  try {
    const parsed = new URL(origin)
    const authority = req.headers.host
    if (authority === undefined || !['http:', 'https:'].includes(parsed.protocol)
      || parsed.origin !== origin || parsed.host !== new URL(`${parsed.protocol}//${authority}`).host) {
      throw new Error('origin mismatch')
    }
  } catch {
    throw new RouteError(403, '请求来源不受信任')
  }
}

/** Bound retained bytes even for chunked input; drain oversized input without storing it. */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new RouteError(415, '请使用 application/json')
  const length = req.headers['content-length']
  if (length !== undefined && Number(length) > MAX_BODY_BYTES) {
    req.resume()
    throw new RouteError(413, '请求正文过大')
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = (): void => {
      req.off('data', data)
      req.off('end', end)
      req.off('error', failure)
      req.off('aborted', failure)
    }
    const fail = (error: RouteError): void => { cleanup(); reject(error) }
    const failure = (): void => fail(new RouteError(400, '请求正文未完整接收'))
    const data = (chunk: Buffer | string): void => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.byteLength
      if (size > MAX_BODY_BYTES) {
        fail(new RouteError(413, '请求正文过大'))
        req.resume()
        return
      }
      chunks.push(buffer)
    }
    const end = (): void => {
      cleanup()
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('not object')
        }
        resolve(value as Record<string, unknown>)
      } catch { reject(new RouteError(400, '请求正文必须是 JSON 对象')) }
    }
    req.on('data', data)
    req.once('end', end)
    req.once('error', failure)
    req.once('aborted', failure)
  })
}

async function assertSession(ctx: Context, sessionId: string): Promise<void> {
  const query = ctx.get('sessionQuery') as SessionQuery | undefined
  if (query === undefined || typeof query.observeSession !== 'function') {
    throw new RouteError(503, '会话查询服务暂不可用')
  }
  let lease: SessionLease | undefined
  try {
    lease = await query.observeSession(sessionId, { projectionMode: 'none' })
    if (lease.header.id !== sessionId) throw new RouteError(404, '会话不存在')
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error
      && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      throw new RouteError(404, '会话不存在')
    }
    throw error
  } finally {
    lease?.[Symbol.dispose]()
  }
}

/** Explicit owned leaves only: never send a Session, lease, or service to JSON. */
function responseState(state: ExpressionState, sessionId: string): ExpressionState {
  if (state.sessionId !== sessionId || !isExpressionMode(state.mode) || !isExpressionLanguage(state.language)
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !(state.updatedAt === null || (Number.isFinite(state.updatedAt) && state.updatedAt >= 0))
    || typeof state.ruleVersion !== 'string' || state.ruleVersion.length === 0) {
    throw new Error('invalid stored state')
  }
  return {
    sessionId: state.sessionId, mode: state.mode, language: state.language, revision: state.revision,
    updatedAt: state.updatedAt, ruleVersion: state.ruleVersion,
  }
}

export function registerRoutes(ctx: Context, store: ModeStore): () => void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) throw new Error('expression-mode: webServer unavailable')
  return webServer.register({
    kind: 'exact', path: ROUTE_STATE,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      try {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.setHeader('allow', 'GET, POST')
          throw new RouteError(405, '仅支持 GET 和 POST')
        }
        let sessionId: unknown
        let patch: ExpressionPatch | undefined
        if (req.method === 'GET') {
          const url = new URL(req.url ?? ROUTE_STATE, 'http://expression-mode.invalid')
          if (url.searchParams.getAll('sessionId').length !== 1
            || [...url.searchParams.keys()].some(key => key !== 'sessionId')) {
            throw new RouteError(400, '查询仅允许一个 sessionId')
          }
          sessionId = url.searchParams.get('sessionId')
        } else {
          assertWriteOrigin(req)
          const body = await readBody(req)
          if (!Object.hasOwn(body, 'sessionId')
            || Object.keys(body).some(key => key !== 'sessionId' && key !== 'mode' && key !== 'language')) {
            throw new RouteError(400, '正文仅允许 sessionId、mode 和 language')
          }
          sessionId = body.sessionId
          const settings: Record<string, unknown> = {}
          if (Object.hasOwn(body, 'mode')) settings.mode = body.mode
          if (Object.hasOwn(body, 'language')) settings.language = body.language
          if (!isExpressionPatch(settings)) throw new RouteError(400, '至少提供一个有效的语言或风格设置')
          patch = settings
        }
        if (!usableSessionId(sessionId)) throw new RouteError(400, '无效的 sessionId')
        await assertSession(ctx, sessionId)
        const state = req.method === 'GET'
          ? await store.get(sessionId)
          : await store.update(sessionId, patch!)
        send(res, 200, { ok: true, data: responseState(state, sessionId) })
      } catch (error) {
        send(res, error instanceof RouteError ? error.status : 500, {
          ok: false, error: error instanceof RouteError ? error.message : '表达方式服务暂时失败，请重试',
        })
      }
    },
  })
}

/**
 * @suxeca/dsh-typesafe — host HTTP 路由（设置页与外部工具的入口）。
 *
 * 设计取舍：**只有浏览器半与本地脚本需要的东西才走 HTTP**。Agent 直接吃
 * `ctx.typesafe` 服务，不经这里；这里是「设置页按一下按钮」和
 * 「agent_memory.py 这类宿主外工具按需调用」的通道。
 *
 * 两道网关：
 * 1. 信任围栏（与 /api 网关同源的 DNS-rebinding / 跨站防御，不是身份认证）；
 * 2. 统一信封 + 错误码映射，客户端永远拿到 `{ ok, value | error }`。
 *
 * 密钥只进不出：`POST /key` 收值，任何响应都不回显值，只回来源与可写性。
 *
 * @module @suxeca/dsh-typesafe/host/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Envelope, KeyState, ProbeResult, TypesafeSettings, TypesafeStatus } from '../shared.ts'
import { API_PREFIX, clampText, redactSecrets } from '../shared.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import type { EvalOutcome, TypesafeService } from './service.ts'
import type { Keyring } from './keyring.ts'
import { TypesafeError } from './transport.ts'

/** 路由只需要 webServer 的注册面（结构类型，不 import 官方包的值）。 */
export interface RouteContext {
  readonly webServer: {
    register(route: {
      readonly kind: 'prefix'
      readonly path: string
      readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

/** 装配层提供给路由的依赖。 */
export interface RouteDeps {
  readonly service: TypesafeService
  readonly keyring: Keyring
  /** 本部署的非回环 authority（`webRuntime?.trustedHosts`）。 */
  readonly getTrustedHosts: () => readonly string[]
  /** 把 patch 合并进设置命名空间，返回合并后的解析值。 */
  readonly updateSettings: (patch: Record<string, unknown>) => Promise<TypesafeSettings>
  readonly logger?: { warn(message: string): void }
}

/** 请求体上限：设置页与本地脚本都不需要更大。 */
const MAX_BODY_BYTES = 256 * 1024

/** 错误码 → HTTP 状态码。 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  'no-key': 401,
  auth: 401,
  'invalid-request': 400,
  'invalid-json': 400,
  malformed: 502,
  'rate-limit': 429,
  overloaded: 503,
  server: 502,
  timeout: 504,
  network: 502,
  aborted: 499,
  disabled: 409,
}

/** 写一个 JSON 响应（永不缓存）。 */
function send(res: ServerResponse, body: Envelope<unknown>, status: number): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 统一的失败出口：错误码映射状态码，消息脱敏后回给客户端。 */
function fail(res: ServerResponse, code: string, message: string, logger?: { warn(message: string): void }): void {
  const safe = clampText(redactSecrets(message), 400)
  logger?.warn(`typesafe: ${code}: ${safe}`)
  send(res, { ok: false, error: { code, message: safe } }, STATUS_BY_CODE[code] ?? 500)
}

/** 读并解析请求体；超限或非法 JSON 抛 `TypesafeError`。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new TypesafeError('invalid-request', `请求体超过 ${String(MAX_BODY_BYTES)} 字节`, { retryable: false })
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TypesafeError('invalid-json', '请求体不是合法 JSON', { retryable: false })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypesafeError('invalid-json', '请求体必须是 JSON 对象', { retryable: false })
  }
  return parsed as Record<string, unknown>
}

/** 状态响应（status 已经脱敏与聚合）。 */
async function handleStatus(deps: RouteDeps): Promise<TypesafeStatus> {
  return deps.service.status()
}

/** 判断请求：`{ state, questions, model? }`。 */
async function handleEval(deps: RouteDeps, req: IncomingMessage): Promise<EvalOutcome> {
  const body = await readJson(req)
  if (body.questions === undefined || typeof body.questions !== 'object' || body.questions === null) {
    throw new TypesafeError('invalid-request', '缺少 questions（问题表）', { retryable: false })
  }
  if (!('state' in body)) throw new TypesafeError('invalid-request', '缺少 state（待判断的内容）', { retryable: false })
  return deps.service.evaluate({
    state: body.state as never,
    questions: body.questions as never,
    ...typeof body.model === 'string' && body.model !== '' ? { model: body.model } : {},
  }, { label: 'http:eval' })
}

/** 保存密钥：只回状态，不回显值。 */
async function handleSaveKey(deps: RouteDeps, req: IncomingMessage): Promise<KeyState> {
  const body = await readJson(req)
  const value = body.value
  if (typeof value !== 'string') throw new TypesafeError('invalid-request', '缺少 value（密钥字符串）', { retryable: false })
  await deps.keyring.save(value)
  return (await deps.keyring.read()).state
}

/** 清除密钥。 */
async function handleClearKey(deps: RouteDeps): Promise<KeyState> {
  await deps.keyring.clear()
  return (await deps.keyring.read()).state
}

/** 写设置：`{ patch }` 浅合并进本插件的 settings 命名空间。 */
async function handleSettings(deps: RouteDeps, req: IncomingMessage): Promise<TypesafeSettings> {
  const body = await readJson(req)
  const patch = body.patch
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new TypesafeError('invalid-request', '缺少 patch（设置补丁对象）', { retryable: false })
  }
  return deps.updateSettings(patch as Record<string, unknown>)
}

/** 探测：只读 /v1/models，验证密钥当下可用。 */
async function handleProbe(deps: RouteDeps): Promise<ProbeResult> {
  return deps.service.probe()
}

/**
 * 挂载 `/typesafe` 前缀路由。
 *
 * @param ctx - 带 webServer 的 host 上下文（必须从注入了 webServer 的外层上下文调用）。
 * @param deps - 服务、密钥环、信任 authority 与设置写入函数。
 * @returns 注销器（随插件 fiber dispose 自动调用）。
 */
export function registerTypesafeRoutes(ctx: RouteContext, deps: RouteDeps): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      // 围栏先于一切：跨站 / DNS-rebinding 请求连路由表都不该看见。
      if (!isTrustedApiRequest(req, deps.getTrustedHosts())) {
        send(res, { ok: false, error: { code: 'forbidden', message: 'forbidden' } }, 403)
        return
      }
      const method = req.method ?? 'GET'
      const path = new URL(req.url ?? '/', 'http://dsh.internal').pathname.replace(/\/+$/, '')
      try {
        if (method === 'GET' && path === `${API_PREFIX}/status`) {
          send(res, { ok: true, value: await handleStatus(deps) }, 200)
          return
        }
        if (method === 'POST' && path === `${API_PREFIX}/eval`) {
          send(res, { ok: true, value: await handleEval(deps, req) }, 200)
          return
        }
        if (method === 'POST' && path === `${API_PREFIX}/key`) {
          send(res, { ok: true, value: await handleSaveKey(deps, req) }, 200)
          return
        }
        if (method === 'DELETE' && path === `${API_PREFIX}/key`) {
          send(res, { ok: true, value: await handleClearKey(deps) }, 200)
          return
        }
        if (method === 'POST' && path === `${API_PREFIX}/settings`) {
          send(res, { ok: true, value: await handleSettings(deps, req) }, 200)
          return
        }
        if (method === 'POST' && path === `${API_PREFIX}/probe`) {
          send(res, { ok: true, value: await handleProbe(deps) }, 200)
          return
        }
        send(res, { ok: false, error: { code: 'not-found', message: `未知路由 ${method} ${path}` } }, 404)
      } catch (error) {
        const code = error instanceof TypesafeError ? error.code : 'internal'
        fail(res, code, error instanceof Error ? error.message : String(error), deps.logger)
      }
    },
  })
}

/**
 * @suxeca/dsh-typesafe — 传输层单元测试（契约 E / transport）。
 *
 * 为什么这样测：传输层是本插件唯一碰网络的地方，它的价值全在「失败怎么分类、重试几次、
 * 退避多少毫秒、密钥会不会漏进消息」这些**确定性**问题上。真网络既慢又不稳，没法断言
 * 尝试次数与毫秒数，所以 fetch / now / sleep / logger 四个 seam 全换成记录型桩：脚本决定
 * 第 N 次调用返回什么，断言只看调用序列、退避值与错误分类。全程离线、零等待，
 * 退避抖动只按契约给出的区间断言，不依赖随机数。
 *
 * @module @suxeca/dsh-typesafe/tests/transport.spec
 */

import { describe, expect, it, vi } from 'vitest'

import type { EvalPayload, SystemOneResponse } from '../src/shared.ts'
import { TypesafeError, TypesafeTransport } from '../src/host/transport.ts'

/** 哨兵密钥：形如 apikey_，专门用来验证它绝不会出现在错误消息或日志里。 */
const SENTINEL_KEY = 'apikey_ts_sentinel_0001'

/** 一次被记录下来的 fetch 调用（只保留断言需要的字段）。 */
interface FetchCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
  readonly signal: AbortSignal | undefined
}

/** 脚本化应答：按 fetch 调用下标决定返回什么、或抛什么。 */
type Responder = (call: FetchCall, index: number) => Response | Promise<Response>

/** 测试夹具装配参数：所有副作用 seam 都在这里被替换。 */
interface HarnessOptions {
  readonly responses: readonly Responder[]
  readonly key?: string
  readonly timeoutMs?: number
  readonly maxRetries?: number
  readonly baseUrl?: string
  readonly advanceMs?: number
  /** 重试总预算覆盖；不传则用传输层默认（30s）。 */
  readonly totalBudgetMs?: number
}

/** 测试夹具：注入 seam 之后暴露调用记录，供断言使用。 */
interface Harness {
  readonly transport: TypesafeTransport
  readonly calls: FetchCall[]
  readonly sleeps: number[]
  readonly warnings: string[]
  readonly debugs: string[]
  readonly getKeyCalls: () => number
}

/** 把任意 header 容器归一成小写键的表，断言不受 Headers / 字面量形态影响。 */
function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  if (headers === undefined) return record
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { record[key.toLowerCase()] = value })
  } else if (Array.isArray(headers)) {
    for (const entry of headers) record[String(entry[0]).toLowerCase()] = String(entry[1])
  } else {
    for (const [key, value] of Object.entries(headers)) record[key.toLowerCase()] = value
  }
  return record
}

/** 构造完全脱网的传输层夹具；@returns 实例与调用记录（fetch / sleep / 日志 / getKey 次数）。 */
function createHarness(options: HarnessOptions): Harness {
  const calls: FetchCall[] = []
  const sleeps: number[] = []
  const warnings: string[] = []
  const debugs: string[] = []
  let current = 1_000

  const getKey = vi.fn(async (): Promise<string | undefined> => options.key)
  const fetchImpl: typeof fetch = async (input, init) => {
    const index = calls.length
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: headerRecord(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
    }
    calls.push(call)
    if (options.advanceMs !== undefined) current += options.advanceMs
    const responder = options.responses[index]
    if (responder === undefined) throw new Error(`unscripted fetch call #${index + 1}`)
    return responder(call, index)
  }

  const transport = new TypesafeTransport({
    baseUrl: options.baseUrl ?? 'https://api.typesafe.ai',
    timeoutMs: options.timeoutMs ?? 1_000,
    maxRetries: options.maxRetries ?? 0,
    ...options.totalBudgetMs === undefined ? {} : { totalBudgetMs: options.totalBudgetMs },
    getKey,
    fetchImpl,
    logger: {
      warn: (message: string) => { warnings.push(message) },
      debug: (message: string) => { debugs.push(message) },
    },
    now: () => current,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds) },
  })

  return { transport, calls, sleeps, warnings, debugs, getKeyCalls: () => getKey.mock.calls.length }
}

/** JSON 应答。 */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** 文本应答（错误体摘录路径用）。 */
function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
}

/** 造一个指定 name 的 Error，用来模拟运行时抛出的 TimeoutError / AbortError。 */
function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

/** 断言调用以 TypesafeError 失败，并把它取出来检查分类字段。 */
async function rejection(call: Promise<unknown>): Promise<TypesafeError> {
  try {
    await call
  } catch (error) {
    if (error instanceof TypesafeError) return error
    throw error
  }
  throw new Error('expected the call to reject with TypesafeError')
}

/** 取请求体并保证它是一个 JSON 对象。 */
function parseBody(text: string | undefined): Record<string, unknown> {
  if (text === undefined) throw new Error('expected a request body')
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object body')
  return parsed as Record<string, unknown>
}

const PAYLOAD: EvalPayload = {
  state: 'the user asked to delete a directory',
  questions: { dangerous: { type: 'noul', instructions: 'Is this dangerous?' } },
}

const RESPONSE_BODY: SystemOneResponse = {
  model: 'jev-1.13.0',
  answers: { dangerous: { type: 'noul', noul: 0.92 } },
  usage: { input_tokens: 17, output_tokens: 4 },
}

describe('typesafe transport', () => {
  it('POSTs once and returns the response with its usage and latency', async () => {
    const harness = createHarness({ key: SENTINEL_KEY, advanceMs: 42, responses: [() => jsonResponse(RESPONSE_BODY)] })

    const { response, latencyMs } = await harness.transport.systemOne(PAYLOAD)

    expect(response).toEqual(RESPONSE_BODY)
    expect(response.usage).toEqual({ input_tokens: 17, output_tokens: 4 })
    expect(latencyMs).toBe(42)

    expect(harness.calls).toHaveLength(1)
    const call = harness.calls[0]!
    expect(call.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(call.method).toBe('POST')
    expect(call.headers.authorization).toBe(`Bearer ${SENTINEL_KEY}`)
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.headers.accept).toBe('application/json')
    expect(call.signal).toBeInstanceOf(AbortSignal)

    const body = parseBody(call.body)
    expect(body.state).toEqual(PAYLOAD.state)
    expect(body.questions).toEqual(PAYLOAD.questions)
    expect('model' in body).toBe(false)
  })

  it('honours options.model without mutating the payload', async () => {
    const payload: EvalPayload = { ...PAYLOAD, model: 'jev-latest' }
    const harness = createHarness({ key: SENTINEL_KEY, responses: [() => jsonResponse(RESPONSE_BODY)] })

    await harness.transport.systemOne(payload, { model: 'jev-override' })

    expect(parseBody(harness.calls[0]!.body).model).toBe('jev-override')
    expect(payload.model).toBe('jev-latest')
  })

  it('resolves the key on every call instead of caching it', async () => {
    const harness = createHarness({
      key: SENTINEL_KEY,
      responses: [() => jsonResponse(RESPONSE_BODY), () => jsonResponse(RESPONSE_BODY)],
    })

    await harness.transport.systemOne(PAYLOAD)
    await harness.transport.systemOne(PAYLOAD)

    expect(harness.getKeyCalls()).toBe(2)
    expect(harness.calls).toHaveLength(2)
  })

  it('fails fast with no-key and never touches the network', async () => {
    const harness = createHarness({ key: undefined, maxRetries: 3, responses: [] })

    const error = await rejection(harness.transport.systemOne(PAYLOAD))

    expect(error.code).toBe('no-key')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('TYPESAFE_API_KEY')
    expect(harness.calls).toHaveLength(0)
    expect(harness.sleeps).toHaveLength(0)
  })

  it('maps 401 to auth and does not retry', async () => {
    const harness = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 3,
      responses: [() => textResponse('{"error":{"message":"bad key"}}', 401)],
    })

    const error = await rejection(harness.transport.systemOne(PAYLOAD))

    expect(error.code).toBe('auth')
    expect(error.status).toBe(401)
    expect(error.retryable).toBe(false)
    expect(harness.calls).toHaveLength(1)
    expect(harness.sleeps).toHaveLength(0)
  })

  it('classifies the documented status set (403/408/422/429/529/5xx) with the right retryability', async () => {
    const cases = [
      { status: 403, code: 'auth', retryable: false },
      { status: 408, code: 'timeout', retryable: true },
      { status: 422, code: 'invalid-request', retryable: false },
      { status: 429, code: 'rate-limit', retryable: true },
      { status: 529, code: 'overloaded', retryable: true },
      { status: 500, code: 'server', retryable: true },
      { status: 503, code: 'server', retryable: true },
    ] as const

    for (const item of cases) {
      // 非可重试状态只需要一次应答；可重试状态给足次数让它走到放弃。
      const harness = createHarness({
        key: SENTINEL_KEY,
        maxRetries: 1,
        responses: [() => textResponse('nope', item.status), () => textResponse('nope', item.status)],
      })
      const error = await rejection(harness.transport.systemOne(PAYLOAD))
      expect(error.code, `HTTP ${String(item.status)}`).toBe(item.code)
      expect(error.retryable, `HTTP ${String(item.status)}`).toBe(item.retryable)
      expect(harness.calls, `HTTP ${String(item.status)}`).toHaveLength(item.retryable ? 2 : 1)
      expect(harness.sleeps, `HTTP ${String(item.status)}`).toHaveLength(item.retryable ? 1 : 0)
    }
  })

  it('treats a response without a usable status as a retryable network failure', async () => {
    // 自建网关/桩对象可能既不正 ok、status 又是 0：那是一次没拿到应答的网络失败，
    // 不是「请求非法」。分类错会让调用方以为要改代码，其实只需要重试。
    const bogus = { ok: false, status: 0, headers: new Headers(), text: async () => 'gateway' } as unknown as Response
    const harness = createHarness({ key: SENTINEL_KEY, maxRetries: 0, responses: [() => bogus] })

    const error = await rejection(harness.transport.systemOne(PAYLOAD))

    expect(error.code).toBe('network')
    expect(error.retryable).toBe(true)
  })

  it('stops retrying once the total budget cannot cover the next wait', async () => {
    const harness = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 5,
      totalBudgetMs: 1_000,
      // 时钟每次请求前进 900ms：第二次退避（约 1s）就超出 1s 预算。
      advanceMs: 900,
      responses: [() => textResponse('boom', 500), () => textResponse('boom', 500), () => textResponse('boom', 500)],
    })

    const error = await rejection(harness.transport.systemOne(PAYLOAD))

    expect(error.code).toBe('server')
    expect(harness.calls.length).toBeLessThanOrEqual(2)
    expect(harness.sleeps).toEqual([])
    expect(harness.warnings.some(line => line.includes('总预算'))).toBe(true)
  })

  it('waits for the retry-after hint, in seconds or ms, capped at 60s', async () => {
    const seconds = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 1,
      responses: [() => textResponse('rate limited', 429, { 'retry-after': '2' }), () => jsonResponse(RESPONSE_BODY)],
    })
    const { response } = await seconds.transport.systemOne(PAYLOAD)
    expect(response).toEqual(RESPONSE_BODY)
    expect(seconds.calls).toHaveLength(2)
    expect(seconds.sleeps).toEqual([2000])

    // 服务端让等 1 小时 → 封顶 60s；但默认总预算只有 30s，于是不再白等，直接把 429 抛出。
    const capped = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 1,
      responses: [() => textResponse('rate limited', 429, { 'retry-after': '3600' })],
    })
    const cappedError = await rejection(capped.transport.systemOne(PAYLOAD))
    expect(cappedError.code).toBe('rate-limit')
    expect(capped.calls).toHaveLength(1)
    expect(capped.sleeps).toEqual([])

    // 预算放宽到 2 分钟后，同样的 retry-after 就被尊重，且封顶在 60s。
    const patient = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 1,
      totalBudgetMs: 120_000,
      responses: [() => textResponse('rate limited', 429, { 'retry-after': '3600' }), () => jsonResponse(RESPONSE_BODY)],
    })
    await patient.transport.systemOne(PAYLOAD)
    expect(patient.sleeps).toEqual([60_000])

    const millis = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 1,
      responses: [() => textResponse('slow down', 429, { 'retry-after-ms': '250' }), () => jsonResponse(RESPONSE_BODY)],
    })
    await millis.transport.systemOne(PAYLOAD)
    expect(millis.sleeps).toEqual([250])
  })

  it('gives up after 1 + maxRetries attempts and classifies 5xx as server', async () => {
    const harness = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 2,
      responses: [() => textResponse('boom', 500), () => textResponse('boom', 500), () => textResponse('boom', 500)],
    })

    const error = await rejection(harness.transport.systemOne(PAYLOAD))

    expect(error.code).toBe('server')
    expect(error.retryable).toBe(true)
    expect(harness.calls).toHaveLength(3)
    expect(harness.sleeps).toHaveLength(2)
    // 退避 = min(500 * 2^(attempt-1), 5000) × [0.75, 1.25)：抖动只按契约区间断言。
    expect(harness.sleeps[0]).toBeGreaterThanOrEqual(375)
    expect(harness.sleeps[0]).toBeLessThan(625)
    expect(harness.sleeps[1]).toBeGreaterThanOrEqual(750)
    expect(harness.sleeps[1]).toBeLessThan(1_250)
    expect(harness.warnings).toHaveLength(2)
  })

  it('classifies timeouts and network rejections as retryable', async () => {
    const timedOut = createHarness({
      key: SENTINEL_KEY,
      responses: [() => { throw namedError('TimeoutError', 'request timed out') }],
    })
    const timeout = await rejection(timedOut.transport.systemOne(PAYLOAD))
    expect(timeout.code).toBe('timeout')
    expect(timeout.retryable).toBe(true)
    expect(timedOut.calls).toHaveLength(1)

    const offline = createHarness({ key: SENTINEL_KEY, responses: [() => { throw new Error('socket hang up') }] })
    const network = await rejection(offline.transport.systemOne(PAYLOAD))
    expect(network.code).toBe('network')
    expect(network.retryable).toBe(true)
    expect(offline.calls).toHaveLength(1)
  })

  it('classifies caller cancellation as aborted and stops retrying', async () => {
    const controller = new AbortController()
    const harness = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 3,
      responses: [() => {
        controller.abort()
        throw namedError('AbortError', 'The operation was aborted')
      }],
    })

    const error = await rejection(harness.transport.systemOne(PAYLOAD, { signal: controller.signal }))

    expect(error.code).toBe('aborted')
    expect(error.retryable).toBe(false)
    expect(harness.calls).toHaveLength(1)
    expect(harness.sleeps).toHaveLength(0)
  })

  it('rejects malformed payloads as non-retryable without retrying', async () => {
    const notJson = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 3,
      responses: [() => textResponse('<html>not json</html>')],
    })
    const unparsable = await rejection(notJson.transport.systemOne(PAYLOAD))
    expect(unparsable.code).toBe('malformed')
    expect(unparsable.retryable).toBe(false)
    expect(notJson.calls).toHaveLength(1)

    const wrongShape = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 3,
      responses: [() => jsonResponse({ model: 'jev-1.13.0', answers: {} })],
    })
    const missingUsage = await rejection(wrongShape.transport.systemOne(PAYLOAD))
    expect(missingUsage.code).toBe('malformed')
    expect(missingUsage.retryable).toBe(false)
    expect(wrongShape.calls).toHaveLength(1)
  })

  it('never lets the key reach an error message or a log line', async () => {
    const harness = createHarness({
      key: SENTINEL_KEY,
      maxRetries: 1,
      responses: [() => textResponse(
        JSON.stringify({ error: { message: `upstream rejected ${SENTINEL_KEY} (Bearer ${SENTINEL_KEY})` } }),
        500,
      )],
    })

    const error = await rejection(harness.transport.systemOne(PAYLOAD))

    expect(error.message).not.toContain(SENTINEL_KEY)
    expect(error.message.length).toBeLessThanOrEqual(241)
    for (const line of [...harness.warnings, ...harness.debugs]) expect(line).not.toContain(SENTINEL_KEY)
  })

  it('probe() GETs /v1/models and reports the models with latency', async () => {
    const harness = createHarness({
      key: SENTINEL_KEY,
      advanceMs: 7,
      responses: [() => jsonResponse({ models: [{ name: 'jev-1.13.0', release_date: '2025-01-01' }] })],
    })

    const result = await harness.transport.probe()

    expect(result.models).toEqual([{ name: 'jev-1.13.0', release_date: '2025-01-01' }])
    expect(result.latencyMs).toBe(7)
    expect(harness.calls[0]!.url).toBe('https://api.typesafe.ai/v1/models')
    expect(harness.calls[0]!.method).toBe('GET')
  })

  it('probe() rejects a non-array models payload as malformed', async () => {
    const harness = createHarness({ key: SENTINEL_KEY, maxRetries: 2, responses: [() => jsonResponse({ models: 'nope' })] })

    const error = await rejection(harness.transport.probe())

    expect(error.code).toBe('malformed')
    expect(harness.calls).toHaveLength(1)
  })

  it('reports a baseUrl without a trailing slash', () => {
    const harness = createHarness({ baseUrl: 'https://api.typesafe.ai/', responses: [] })

    expect(harness.transport.baseUrl).toBe('https://api.typesafe.ai')
  })
})

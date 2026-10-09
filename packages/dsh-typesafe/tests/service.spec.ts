/**
 * 服务层测试：用注入的 fetch 桩离线驱动真实请求路径。
 *
 * 这里专门覆盖「失败时的行为」——单元测试最容易漏、线上最贵的那部分：
 * ① rerank 一块失败不能把别的块已经付费算出的结果丢掉；
 * ② 服务端返回 200 但答案缺失/类型不符时，观测面必须记成失败而不是成功；
 * ③ 缓存命中不能把 token 总量算成真实花费。
 *
 * @module @suxeca/dsh-typesafe/tests/service
 */
import { describe, expect, it } from 'vitest'
import { Keyring } from '../src/host/keyring.ts'
import { createTypesafeService } from '../src/host/service.ts'
import { TYPESAFE_SETTINGS_DEFAULTS } from '../src/shared.ts'
import type { TypesafeSettings } from '../src/shared.ts'

/** 记录下来的请求体（断言只关心这几项）。 */
interface SentBody {
  readonly model?: string
  readonly questionIds: readonly string[]
  readonly candidateCount: number
}

/** 造一个只认 URL 与 body 的 fetch 桩。 */
function stubFetch(handler: (body: SentBody, index: number) => Response): { fetchImpl: typeof fetch; sent: SentBody[] } {
  const sent: SentBody[] = []
  const fetchImpl: typeof fetch = async (_input, init) => {
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    const parsed = JSON.parse(raw) as { model?: string; questions?: Record<string, unknown>; state?: { candidates?: unknown[] } }
    const body: SentBody = {
      model: parsed.model,
      questionIds: Object.keys(parsed.questions ?? {}),
      candidateCount: Array.isArray(parsed.state?.candidates) ? parsed.state.candidates.length : 0,
    }
    const index = sent.length
    sent.push(body)
    return handler(body, index)
  }
  return { fetchImpl, sent }
}

/** 造一个 noul 应答。 */
function noulAnswer(ids: readonly string[], value: number): Response {
  const answers: Record<string, unknown> = {}
  for (const id of ids) answers[id] = { type: 'noul', noul: value }
  return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 10, output_tokens: 5 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** 造一个服务实例：env 提供密钥，fetch 与时钟都是桩，设置可覆盖。 */
function createService(fetchImpl: typeof fetch, overrides: Partial<TypesafeSettings> = {}, seams: {
  logger?: { warn(message: string): void }
  now?: () => number
  healthWarnIntervalMs?: number
} = {}) {
  let settings: TypesafeSettings = { ...TYPESAFE_SETTINGS_DEFAULTS, cacheTtlMs: 0, maxRetries: 0, ...overrides }
  const service = createTypesafeService({
    getSettings: () => settings,
    keyring: new Keyring(undefined, 'TYPESAFE_API_KEY', { TYPESAFE_API_KEY: 'apikey_test_sentinel' }),
    fetchImpl,
    ...seams,
  })
  return { service, setSettings: (next: Partial<TypesafeSettings>) => {
    settings = { ...settings, ...next }
    // 真实装配里由 settings 的 watcher 调 reconfigure；这里同样必须调，
    // 否则服务仍按旧快照工作（这正是「设置热生效」的契约）。
    service.reconfigure(settings)
  } }
}

describe('rerank 的分块失败降级', () => {
  it('一块失败时保留其它块已算出的结果，并记录一条失败', async () => {
    const { fetchImpl, sent } = stubFetch((body, index) => {
      if (index === 1) return new Response('rate limited', { status: 429 })
      return noulAnswer(body.questionIds, index === 0 ? 0.9 : 0.2)
    })
    const { service } = createService(fetchImpl)
    const items = [
      { id: 'a', text: 'alpha' },
      { id: 'b', text: 'beta' },
      { id: 'c', text: 'gamma' },
    ]

    const results = await service.rerank({ query: 'q' }, items, '是否相关？', { chunkSize: 1, concurrency: 1 })

    expect(sent).toHaveLength(3)
    expect(results.map(entry => entry.id)).toEqual(['a', 'c'])
    expect(results.map(entry => entry.relevance)).toEqual([0.9, 0.2])

    const recent = service.recent()
    expect(recent.some(entry => entry.ok === false && entry.errorCode === 'rate-limit')).toBe(true)
    const status = await service.status()
    expect(status.totals.failures).toBe(1)
    expect(status.totals.calls).toBe(3)
    // 部分失败不该是静默的：状态里必须留下原因。
    expect(status.lastError).toContain('rerank')
  })

  it('所有块都失败时如实抛错（不返回空排序假装成功）', async () => {
    const { fetchImpl } = stubFetch(() => new Response('boom', { status: 500 }))
    const { service } = createService(fetchImpl)

    await expect(service.rerank({ query: 'q' }, [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }], '是否相关？', { chunkSize: 1, concurrency: 1 }))
      .rejects.toMatchObject({ code: 'server' })
  })

  it('候选答案缺失时该块失败，而不是把候选静默记 0 分', async () => {
    // 服务端 200，但一个答案都不给：缺失必须当成畸形应答，而不是 0 分。
    const { fetchImpl } = stubFetch(() => noulAnswer([], 0.7))
    const { service } = createService(fetchImpl)

    await expect(service.rerank({ query: 'q' }, [{ id: 'a', text: 'alpha' }], '是否相关？', { chunkSize: 1, concurrency: 1 }))
      .rejects.toMatchObject({ code: 'malformed' })
    expect((await service.status()).lastError).toContain('rerank')
  })
})

describe('畸形应答记成失败而不是成功', () => {
  it('choice 答案类型不符时：抛 malformed，并把这条记进失败', async () => {
    const { fetchImpl } = stubFetch(() => new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { q: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { service } = createService(fetchImpl)

    await expect(service.choice('x', 'y', { a: 'A', b: 'B' })).rejects.toMatchObject({ code: 'malformed' })

    const status = await service.status()
    expect(status.totals.calls).toBe(2) // evaluate 记的成功 + single 补记的失败
    expect(status.totals.failures).toBe(1)
    expect(status.recent.some(entry => entry.ok === false && entry.errorCode === 'malformed')).toBe(true)
    expect(status.lastError).toContain('malformed')
  })

  it('noul 答案缺 confidence 是正常的（协议如此），不当失败', async () => {
    const { fetchImpl } = stubFetch((body) => noulAnswer(body.questionIds, 0.26))
    const { service } = createService(fetchImpl)

    const judged = await service.noul('文本', '是否紧急？')

    expect(judged.answer).toEqual({ type: 'noul', noul: 0.26 })
    expect((await service.status()).totals.failures).toBe(0)
  })
})

describe('缓存与计量', () => {
  it('命中缓存时不再累加 token（那是上一次的真实花费）', async () => {
    const { fetchImpl, sent } = stubFetch((body) => noulAnswer(body.questionIds, 0.5))
    const { service } = createService(fetchImpl, { cacheTtlMs: 60_000 })

    await service.noul('同一段文本', '是否紧急？')
    const cached = await service.noul('同一段文本', '是否紧急？')

    expect(cached.cached).toBe(true)
    expect(sent).toHaveLength(1)
    const status = await service.status()
    expect(status.totals.calls).toBe(2)
    expect(status.totals.cacheHits).toBe(1)
    // 只算一次真实花费：输入 10 / 输出 5，而不是 20 / 10。
    expect(status.totals.inputTokens).toBe(10)
    expect(status.totals.outputTokens).toBe(5)
  })

  it('换端点后旧缓存不再命中（端点进了缓存键）', async () => {
    const { fetchImpl, sent } = stubFetch((body) => noulAnswer(body.questionIds, 0.5))
    const { service, setSettings } = createService(fetchImpl, { cacheTtlMs: 60_000, baseUrl: 'https://api.typesafe.ai' })

    await service.noul('同一段文本', '是否紧急？')
    setSettings({ baseUrl: 'https://proxy.local' })
    const second = await service.noul('同一段文本', '是否紧急？')

    expect(second.cached).toBe(false)
    expect(sent).toHaveLength(2)
  })

  it('本地校验先于网络：非法载荷一次请求都不发', async () => {
    const { fetchImpl, sent } = stubFetch((body) => noulAnswer(body.questionIds, 0.5))
    const { service } = createService(fetchImpl)

    await expect(service.evaluate({ state: 'x', questions: {} })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(service.score('x', 'y', ['only-one'])).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(service.evaluate({ state: 42 as never, questions: { q: { type: 'noul', instructions: 'y' } } }))
      .rejects.toMatchObject({ code: 'invalid-request' })
    expect(sent).toHaveLength(0)
  })
})

/**
 * 健康观测：本插件的失败路径全是 fail-soft 的，所以它可以在完全不可用的状态下
 * 静默运行很久（真实发生过：credentials 引用在装配期被缓存成 undefined，语义工具
 * 与任务分流全部失效，日志里一行都没有）。这组测试锁住那个对冲措施——失败必须
 * 留下日志与状态，且节流不能让计数失真。
 */
describe('健康观测：失败不再静默', () => {
  it('失败的调用进日志一次，并在 status.health 上留痕', async () => {
    const warnings: string[] = []
    const { fetchImpl } = stubFetch(() => new Response('rate limited', { status: 429 }))
    const { service } = createService(fetchImpl, {}, { logger: { warn: (message: string) => { warnings.push(message) } } })

    await expect(service.noul('x', '是否紧急？')).rejects.toThrow()
    const first = await service.status()

    expect(first.health.degraded).toBe(true)
    expect(first.health.consecutiveFailures).toBe(1)
    expect(first.health.lastErrorCode).toBe('rate-limit')
    expect(first.health.lastErrorAt).toBeTypeOf('number')
    expect(first.lastError).toContain('rate-limit')

    const healthLines = (): string[] => warnings.filter(line => line.includes('typesafe 判断失败'))
    expect(healthLines()).toHaveLength(1)

    // 再失败一次：计数必须涨，但节流窗口内不该再喊——门禁与分流是高频内环路径。
    await expect(service.noul('y', '是否紧急？')).rejects.toThrow()
    expect((await service.status()).health.consecutiveFailures).toBe(2)
    expect(healthLines()).toHaveLength(1)
  })

  it('成功一次即恢复，缓存命中同样算成功', async () => {
    let broken = true
    const { fetchImpl } = stubFetch(body => broken
      ? new Response('rate limited', { status: 429 })
      : noulAnswer(body.questionIds, 0.5))
    const { service } = createService(fetchImpl, { cacheTtlMs: 60_000 })

    await expect(service.noul('同一段文本', '是否紧急？')).rejects.toThrow()
    expect((await service.status()).health.degraded).toBe(true)

    broken = false
    const ok = await service.noul('同一段文本', '是否紧急？')
    expect(ok.cached).toBe(false)

    const recovered = await service.status()
    expect(recovered.health.degraded).toBe(false)
    expect(recovered.health.consecutiveFailures).toBe(0)
    expect(recovered.health.lastSuccessAt).toBeTypeOf('number')
    // 恢复不清除「上次为什么坏」：排障时最需要的正是这段历史。
    expect(recovered.health.lastErrorCode).toBe('rate-limit')

    const hit = await service.noul('同一段文本', '是否紧急？')
    expect(hit.cached).toBe(true)
    expect((await service.status()).health.degraded).toBe(false)
  })

  it('200 但答案不合形状时同样标脏（错误被记成成功是最难查的观测污染）', async () => {
    const { fetchImpl } = stubFetch(() => new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const { service } = createService(fetchImpl)

    await expect(service.noul('x', '是否紧急？')).rejects.toThrow()

    const status = await service.status()
    expect(status.health.degraded).toBe(true)
    expect(status.health.lastErrorCode).toBe('malformed')
  })

  it('时间戳来自注入的时钟：观测面只有一个时间轴', async () => {
    const now = 5_000
    const { fetchImpl } = stubFetch(() => new Response('rate limited', { status: 429 }))
    const { service } = createService(fetchImpl, {}, { now: () => now })

    await expect(service.noul('x', '是否紧急？')).rejects.toThrow()

    expect((await service.status()).health.lastErrorAt).toBe(now)
  })
})

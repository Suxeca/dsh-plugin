/**
 * 分流服务的测试（`ctx.typesafeRouter`）。
 *
 * 为什么值得单独测：分流器是**别的 preset 会依赖的契约**，而它最容易错的地方
 * 不是「判断准不准」（那是模型的事），而是**管道**：调用方给的档位有没有真的
 * 走到线上请求里、失败是不是真的降级、服务端冒出档位外的模式 key 会不会被塞进结果。
 * 这些都不是模型质量问题，而是接线问题——所以用注入 fetch 的方式断言
 * **发出去的请求体**，而不是断言模型的答案。
 *
 * @module @suxeca/dsh-typesafe/tests/router
 */
import { describe, expect, it } from 'vitest'
import { Keyring } from '../src/host/keyring.ts'
import { createTypesafeService } from '../src/host/service.ts'
import { createRouterService, CODING_PROFILE } from '../src/host/router.ts'
import type { RouterProfile } from '../src/host/router.ts'
import { TYPESAFE_SETTINGS_DEFAULTS } from '../src/shared.ts'
import type { TypesafeSettings } from '../src/shared.ts'

/** 一次被记录下来的请求体（只留断言需要的字段）。 */
interface SentChoice {
  readonly state: string
  readonly question: { type: string; instructions: string; criteria: Record<string, unknown> }
}

/** 造一个会记录请求体、并按脚本作答的 fetch 桩。 */
function stubFetch(answer: (sent: SentChoice, index: number) => Response | Promise<Response>) {
  const sent: SentChoice[] = []
  const fetchImpl: typeof fetch = async (_input, init) => {
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    const parsed = JSON.parse(raw) as { state: string; questions: Record<string, { type: string; instructions: string; criteria: Record<string, unknown> }> }
    const entry = Object.values(parsed.questions ?? {})[0]
    const record: SentChoice = { state: parsed.state, question: entry as SentChoice['question'] }
    const index = sent.length
    sent.push(record)
    return answer(record, index)
  }
  return { fetchImpl, sent }
}

/** 造一个 choice 应答。 */
function choiceResponse(choice: string, probabilities: Record<string, number>, confidence: number): Response {
  return new Response(JSON.stringify({
    model: 'jev-1.13.0',
    answers: { q: { type: 'choice', choice, probabilities, confidence } },
    usage: { input_tokens: 12, output_tokens: 4 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** 装配一个真实服务 + 分流器。 */
function createRouter(fetchImpl: typeof fetch, overrides: Partial<TypesafeSettings> = {}) {
  let settings: TypesafeSettings = { ...TYPESAFE_SETTINGS_DEFAULTS, cacheTtlMs: 0, maxRetries: 0, ...overrides }
  const service = createTypesafeService({
    getSettings: () => settings,
    keyring: new Keyring(undefined, 'TYPESAFE_API_KEY', { TYPESAFE_API_KEY: 'apikey_test_sentinel' }),
    fetchImpl,
  })
  return createRouterService({ service, getSettings: () => settings })
}

/** z3 那样的自定义档位：模式轴与编码档完全不同。 */
const Z3_LIKE: RouterProfile = {
  id: 'z3-ab',
  instructions: '你是调度器。判断这条消息应当按哪种模式处理。\n\n用户消息：\n```text',
  criteria: {
    agile: '例行执行或例行改动',
    audit: '形式审计：定义或重释可观测量、断言物理结论、写账本',
  },
}

describe('内置编码档位', () => {
  it('默认档位把 react/spec/chat 判据发给线上请求', async () => {
    const { fetchImpl, sent } = stubFetch(() => choiceResponse('spec', { react: 0.05, spec: 0.9, chat: 0.05 }, 0.9))
    const router = createRouter(fetchImpl)

    const verdict = await router.classify('支付回调偶发失败，帮我定位')

    expect(verdict).toMatchObject({ mode: 'spec', profile: 'coding', cached: false, model: 'jev-1.13.0' })
    expect(Object.keys(sent[0]?.question.criteria ?? {})).toEqual(['react', 'spec', 'chat'])
    expect(sent[0]?.state).toContain('支付回调偶发失败')
    expect(router.profiles).toContain('coding')
  })

  it('概率表按档位的 key 归一：档位里没有的 key 不会漏进来', async () => {
    // 服务端多回了一个档位外的 key：必须被丢掉，而不是混进结果。
    const { fetchImpl } = stubFetch(() => choiceResponse('spec', { react: 0, spec: 1, chat: 0, bogus: 0.5 }, 1))
    const router = createRouter(fetchImpl)

    const verdict = await router.classify('x')

    expect(Object.keys(verdict?.probabilities ?? {}).sort()).toEqual(['chat', 'react', 'spec'])
  })
})

describe('自定义档位', () => {
  it('调用方给的档位（判据与提问）真的进入请求体', async () => {
    const { fetchImpl, sent } = stubFetch(() => choiceResponse('audit', { agile: 0.02, audit: 0.98 }, 0.96))
    const router = createRouter(fetchImpl)

    const verdict = await router.classify('把这次 fit 的 gap 写进 verified.csv 并晋级这个 run', { profile: Z3_LIKE })

    expect(verdict).toMatchObject({ mode: 'audit', profile: 'z3-ab' })
    expect(Object.keys(sent[0]?.question.criteria ?? {})).toEqual(['agile', 'audit'])
    // 提问正文用的是档位自带的那段，而不是内置的「用户发给编程 agent 的请求」。
    expect(sent[0]?.state).toContain('你是调度器')
    expect(sent[0]?.state).not.toContain('编程 agent')
    expect(sent[0]?.question.instructions).toBe('这条请求属于哪种工作模式？')
  })

  it('服务端回一个档位外的模式 key 时返回 undefined（不猜、不硬塞）', async () => {
    const { fetchImpl } = stubFetch(() => choiceResponse('chat', { agile: 0.3, audit: 0.3, chat: 0.4 }, 0.4))
    const router = createRouter(fetchImpl)

    expect(await router.classify('x', { profile: Z3_LIKE })).toBeUndefined()
  })

  it('档位不合法（少于两个选项 / 空提问）时直接返回 undefined，不发请求', async () => {
    const { fetchImpl, sent } = stubFetch(() => choiceResponse('a', { a: 1, b: 0 }, 1))
    const router = createRouter(fetchImpl)

    expect(await router.classify('x', { profile: { id: 'broken', instructions: 'x', criteria: { only: '一个选项' } } })).toBeUndefined()
    expect(await router.classify('x', { profile: { id: 'broken', instructions: '  ', criteria: { a: 'A', b: 'B' } } })).toBeUndefined()
    expect(sent).toHaveLength(0)
  })
})

describe('降级路径', () => {
  it('空消息不发请求', async () => {
    const { fetchImpl, sent } = stubFetch(() => choiceResponse('spec', { react: 0, spec: 1, chat: 0 }, 1))
    const router = createRouter(fetchImpl)

    expect(await router.classify('   ')).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  it('网络失败返回 undefined（preset 用回自己的降级路径）', async () => {
    const { fetchImpl } = stubFetch(() => new Response('nope', { status: 500 }))
    const router = createRouter(fetchImpl)

    expect(await router.classify('x')).toBeUndefined()
  })

  it('无密钥时返回 undefined，且一次请求都不发', async () => {
    const settings: TypesafeSettings = { ...TYPESAFE_SETTINGS_DEFAULTS }
    const service = createTypesafeService({
      getSettings: () => settings,
      keyring: new Keyring(undefined, 'TYPESAFE_API_KEY', {}),
      fetchImpl: (async () => { throw new Error('不该被调用') }) as unknown as typeof fetch,
    })
    const router = createRouterService({ service, getSettings: () => settings })

    expect(await router.classify('x')).toBeUndefined()
  })

  it('超预算返回 undefined（预算来自设置里的 router.timeoutMs）', async () => {
    // fetch 永远挂起：预算到点必须自己退出，而不是把装配拖死。
    const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal == null) return
      signal.addEventListener('abort', () => { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }, { once: true })
    })
    const router = createRouter(hanging, { router: { enabled: true, timeoutMs: 50 } })

    expect(await router.classify('x')).toBeUndefined()
  })
})

describe('缓存', () => {
  it('同一条消息第二次命中缓存，不再付费', async () => {
    const { fetchImpl, sent } = stubFetch(() => choiceResponse('react', { react: 0.9, spec: 0.1, chat: 0 }, 0.9))
    const router = createRouter(fetchImpl, { cacheTtlMs: 60_000 })

    const first = await router.classify('加一个导出 CSV 的按钮')
    const second = await router.classify('加一个导出 CSV 的按钮')

    expect(first?.cached).toBe(false)
    expect(second?.cached).toBe(true)
    expect(second?.mode).toBe('react')
    expect(sent).toHaveLength(1)
  })

  it('不同档位的同一条消息不互相命中（判据不同 → 结论不可复用）', async () => {
    const { fetchImpl, sent } = stubFetch(() => choiceResponse('spec', { react: 0, spec: 1, chat: 0 }, 1))
    const router = createRouter(fetchImpl, { cacheTtlMs: 60_000 })

    await router.classify('同一段文本')
    await router.classify('同一段文本', { profile: Z3_LIKE })

    // 档位不同 → 提问不同 → 缓存键不同（缓存键含完整 questions）
    expect(sent).toHaveLength(2)
    expect(Object.keys(sent[0]?.question.criteria ?? {})).toEqual(['react', 'spec', 'chat'])
    expect(Object.keys(sent[1]?.question.criteria ?? {})).toEqual(['agile', 'audit'])
  })
})

describe('内置档位常量', () => {
  it('CODING_PROFILE 的 id 与判据稳定（preset 与文档都引用它）', () => {
    expect(CODING_PROFILE.id).toBe('coding')
    expect(Object.keys(CODING_PROFILE.criteria)).toEqual(['react', 'spec', 'chat'])
  })
})

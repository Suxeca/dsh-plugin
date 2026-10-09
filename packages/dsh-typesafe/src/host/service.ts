/**
 * @suxeca/dsh-typesafe — 语义判断服务（`ctx.typesafe`）。
 *
 * 这一层是插件对 DSH 总线暴露的门面：把 TypeSafe System One（Jev）的三条原语
 * （choice / noul / score）包装成强类型方法，并在前面加三道本地护栏——
 * **先校验**（不合法的载荷一次网络都不发）、**再查缓存**（同样的判断不重复付费）、
 * **最后记账**（每次调用的 token / 延迟 / 命中都进 CallLog，设置页看得到）。
 *
 * 它不持有任何全局状态：设置、密钥、传输、缓存全部由外部注入，
 * 因此设置一变（`reconfigure`）就能整体换挡，且可以在测试里完全离线驱动。
 *
 * @module @suxeca/dsh-typesafe/host/service
 */
import type {
  Answer, ChoiceAnswer, EntryType, EvalPayload, Judged, KeyState,
  NoulAnswer, ProbeResult, Question, Questions, RecentCall, ScoreAnswer, SystemOneResponse,
  TypesafeSettings, TypesafeStatus,
} from '../shared.ts'
import { DEFAULT_MODEL, PLUGIN_VERSION, TYPESAFE_SETTINGS_DEFAULTS } from '../shared.ts'
import { ResponseCache } from './cache.ts'
import { HealthTracker } from './health.ts'
import { CallLog } from './stats.ts'
import type { Keyring } from './keyring.ts'
import { TypesafeError, TypesafeTransport } from './transport.ts'
import type { TransportLogger } from './transport.ts'

/** 一次调用的可选项；`label` 会进观测记录（便于区分工具 / 门禁 / HTTP 来源）。 */
export interface ServiceCallOptions {
  /** 覆盖设置里的模型。 */
  readonly model?: string
  readonly signal?: AbortSignal
  /** 覆盖单次尝试超时。 */
  readonly timeoutMs?: number
  /** 覆盖额外重试次数。 */
  readonly maxRetries?: number
  /** 置 false 跳过本地缓存（例如门禁要看到真实的当前判断）。 */
  readonly cache?: boolean
  readonly label?: string
}

/** 批量判断的结果：整包应答 + 本地观测。 */
export interface EvalOutcome {
  readonly response: SystemOneResponse
  readonly cached: boolean
  readonly latencyMs: number
}

/** rerank 的候选项。 */
export interface RerankItem {
  readonly id: string
  readonly text: string
}

/** rerank 的一条结果。 */
export interface RerankResult {
  readonly id: string
  /** 判为相关的概率（0..1），降序排列的依据。 */
  readonly relevance: number
  readonly text: string
}

/** rerank 的调参面。 */
export interface RerankOptions extends ServiceCallOptions {
  /** 一次请求放多少个候选（同一 state 里一个候选一个问题）。 */
  readonly chunkSize?: number
  /** 同时进行的请求数上限。 */
  readonly concurrency?: number
}

/** 构造服务需要的注入面。 */
export interface TypesafeServiceOptions {
  /** 现读设置（设置变更后立刻生效，不需要重建服务）。 */
  readonly getSettings: () => TypesafeSettings
  readonly keyring: Keyring
  readonly logger?: TransportLogger
  readonly now?: () => number
  /** 传输层 fetch 注入（测试与自建网关）；缺省用全局 fetch。 */
  readonly fetchImpl?: typeof fetch
  /** 观测明细容量。 */
  readonly recentLimit?: number
  /** 持续失败时重复告警的最小间隔（毫秒）；缺省 60s。测试用它把节流调快。 */
  readonly healthWarnIntervalMs?: number
}

/** `ctx.typesafe` 的服务面。 */
export interface TypesafeService {
  /** 原语批量：一次请求问多个问题（TypeSafe 官方推荐用法，比逐个问便宜一个数量级）。 */
  evaluate(payload: EvalPayload, options?: ServiceCallOptions): Promise<EvalOutcome>
  /** 从固定选项集里选一个。 */
  choice(state: EntryType, instructions: EntryType, criteria: Readonly<Record<string, EntryType>>, options?: ServiceCallOptions): Promise<Judged<ChoiceAnswer>>
  /** 一个 yes/no 判断，返回 yes 的概率（没有 confidence）。 */
  noul(state: EntryType, instructions: EntryType, criteria?: { readonly true: EntryType; readonly false: EntryType }, options?: ServiceCallOptions): Promise<Judged<NoulAnswer>>
  /** 沿有序等级打分。 */
  score(state: EntryType, instructions: EntryType, levels: readonly EntryType[], options?: ServiceCallOptions): Promise<Judged<ScoreAnswer>>
  /** 只要答案（丢掉计量）。 */
  judge(state: EntryType, questions: Questions, options?: ServiceCallOptions): Promise<Readonly<Record<string, Answer>>>
  /** 语义重排：把候选项切块，一块一次请求，按相关概率降序返回。 */
  rerank(state: EntryType, items: readonly RerankItem[], instruction: string, options?: RerankOptions): Promise<readonly RerankResult[]>
  /** 用只读 /models 验证「这把 key 现在能不能用」。 */
  probe(options?: ServiceCallOptions): Promise<ProbeResult>
  /** 设置页 / 健康检查的状态快照（密钥只报来源与可写性，绝不回显值）。 */
  status(): Promise<TypesafeStatus>
  /** 最近的调用明细（最新在前）。 */
  recent(limit?: number): readonly RecentCall[]
  /** 设置变更后由装配层调用：换挡预算、重建缓存、清空传输。 */
  reconfigure(settings: TypesafeSettings): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** TypeSafe System One（Jev）语义判断服务；由 @suxeca/dsh-typesafe 提供。 */
    typesafe: TypesafeService
  }
}

/**
 * 一次请求里允许的最大问题数。
 *
 * TypeSafe 官方鼓励「需要的问题一次问完」（fan-out 模式），真正的约束是 64k
 * 上下文而不是题数；这里只挡明显失控的输入（例如程序 bug 生成几千个问题）。
 */
const MAX_QUESTIONS = 256

/** rerank 的默认分块与并发，以及硬上限（防止调用方把候选数乘成一场费用事故）。 */
const RERANK_CHUNK = 40
const RERANK_CONCURRENCY = 4
const MAX_RERANK_ITEMS = 1_000
const RERANK_CHUNK_CAP = 200
const RERANK_CONCURRENCY_CAP = 16

/** 空串与纯空白等同「没给」：协议里 `model` 必填，宁可回落到设置里的默认模型。 */
function normaliseModel(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 校验载荷：宁可在本地失败，也不要发一次注定 422 的请求（既花钱又慢）。
 *
 * @param payload - 待发送的载荷。
 * @param model - 解析后真正会发出去的模型名（空串同样是非法请求）。
 * @throws TypesafeError 载荷不合法（`code: 'invalid-request'`，不触发网络）。
 */
function assertPayload(payload: EvalPayload, model: string): void {
  if (model.trim() === '') throw new TypesafeError('invalid-request', 'model 不能为空：在设置页填一个模型名（例如 jev-latest）', { retryable: false })
  const state: unknown = payload.state
  if (typeof state === 'number' || typeof state === 'boolean') {
    throw new TypesafeError('invalid-request', 'state 必须是字符串、JSON 对象/数组或 null（裸数字/布尔不是合法条目）', { retryable: false })
  }
  const entries = Object.entries(payload.questions ?? {})
  if (entries.length === 0) throw new TypesafeError('invalid-request', 'questions 不能为空：至少问一个判断', { retryable: false })
  if (entries.length > MAX_QUESTIONS) throw new TypesafeError('invalid-request', `一次最多问 ${String(MAX_QUESTIONS)} 个问题（收到 ${String(entries.length)} 个）`, { retryable: false })
  for (const [id, question] of entries) {
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria ?? {})
      if (options.length === 0) throw new TypesafeError('invalid-request', `choice 问题 "${id}" 的 criteria 不能为空`, { retryable: false })
      if (options.length > 255) throw new TypesafeError('invalid-request', `choice 问题 "${id}" 最多 255 个选项`, { retryable: false })
      continue
    }
    if (question.type === 'score') {
      const levels = Array.isArray(question.criteria) ? question.criteria : []
      if (levels.length < 2) throw new TypesafeError('invalid-request', `score 问题 "${id}" 至少需要 2 个等级`, { retryable: false })
      if (levels.length > 10) throw new TypesafeError('invalid-request', `score 问题 "${id}" 最多 10 个等级`, { retryable: false })
      continue
    }
    if (question.type !== 'noul') throw new TypesafeError('invalid-request', `问题 "${id}" 的 type 不是 choice / noul / score`, { retryable: false })
  }
}

/** 从答案表里取出唯一答案，并断言它的原语类型。 */
function singleAnswer<A extends Answer>(answers: Readonly<Record<string, Answer>>, expectations: A['type'], id: string): A {
  const answer = answers[id]
  if (answer === undefined) throw new TypesafeError('malformed', `服务端未返回问题 "${id}" 的答案`)
  if (answer.type !== expectations) throw new TypesafeError('malformed', `问题 "${id}" 期望 ${expectations} 答案，收到 ${answer.type}`)
  return answer as A
}

/** 语义判断服务的默认实现。 */
export class DefaultTypesafeService implements TypesafeService {
  private readonly options: TypesafeServiceOptions
  private readonly log: CallLog
  private settings: TypesafeSettings
  private cache: ResponseCache
  private transport: TypesafeTransport
  private readonly health: HealthTracker

  /**
   * @param options - 设置读取器、密钥环、日志与时钟注入。
   */
  constructor(options: TypesafeServiceOptions) {
    this.options = options
    this.settings = options.getSettings()
    this.log = new CallLog({ maxEntries: options.recentLimit ?? 50 })
    this.cache = new ResponseCache({ ttlMs: this.settings.cacheTtlMs, maxEntries: this.settings.cacheMaxEntries, now: options.now })
    this.transport = this.buildTransport(this.settings)
    // 健康记账与传输层共用同一个日志出口与时钟：观测面必须只有一个时间轴。
    this.health = new HealthTracker({
      ...options.logger === undefined ? {} : { logger: options.logger },
      now: () => this.now(),
      ...options.healthWarnIntervalMs === undefined ? {} : { warnIntervalMs: options.healthWarnIntervalMs },
    })
  }

  /** 传输层是纯配置对象，随设置整体替换即可。 */
  private buildTransport(settings: TypesafeSettings): TypesafeTransport {
    return new TypesafeTransport({
      baseUrl: settings.baseUrl,
      timeoutMs: settings.timeoutMs,
      maxRetries: settings.maxRetries,
      // 每次调用现取密钥：credentials 的 seam 契约要求 per-call 解析。
      getKey: async () => (await this.options.keyring.read()).key,
      logger: this.options.logger,
      now: this.options.now,
      ...this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl },
    })
  }

  /** {@inheritDoc TypesafeService.reconfigure} */
  reconfigure(settings: TypesafeSettings): void {
    const budgetChanged = settings.baseUrl !== this.settings.baseUrl
      || settings.timeoutMs !== this.settings.timeoutMs
      || settings.maxRetries !== this.settings.maxRetries
    // 端点也是「能改变答案的输入」：从自建代理切到官方端点后，旧条目必须作废，
    // 而且键里也要带 baseUrl，否则同样的 state/questions 会永远命中旧端点的答案。
    const cacheChanged = settings.cacheTtlMs !== this.settings.cacheTtlMs
      || settings.cacheMaxEntries !== this.settings.cacheMaxEntries
      || settings.baseUrl !== this.settings.baseUrl
    this.settings = settings
    if (budgetChanged) this.transport = this.buildTransport(settings)
    if (cacheChanged) this.cache = new ResponseCache({ ttlMs: settings.cacheTtlMs, maxEntries: settings.cacheMaxEntries, now: this.options.now })
  }

  /** {@inheritDoc TypesafeService.evaluate} */
  async evaluate(payload: EvalPayload, options?: ServiceCallOptions): Promise<EvalOutcome> {
    const settings = this.settings
    // 空串 / 纯空白等同「没给」，否则会发一个不带 model 的请求体（线上 model 是必填）。
    const override = normaliseModel(options?.model) ?? normaliseModel(payload.model)
    const model = override ?? normaliseModel(settings.model) ?? DEFAULT_MODEL
    assertPayload(payload, model)
    const request: EvalPayload = { state: payload.state, questions: payload.questions, model }
    const started = this.now()
    const cacheable = options?.cache !== false && settings.cacheTtlMs > 0
    const key = ResponseCache.keyOf(model, { state: request.state, questions: request.questions }, settings.baseUrl)
    if (cacheable) {
      const hit = this.cache.get(key)
      if (hit !== undefined) {
        const latencyMs = this.now() - started
        // 记作答版本号（与网络路径一致），而不是请求时用的别名。
        this.record(options?.label ?? 'ctx.typesafe', hit.model, Object.keys(request.questions).length, hit.usage, latencyMs, true, true)
        return { response: hit, cached: true, latencyMs }
      }
    }
    try {
      const outcome = await this.transport.systemOne(request, {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        retries: options?.maxRetries,
      })
      const latencyMs = this.now() - started
      if (cacheable) this.cache.set(key, outcome.response)
      this.record(options?.label ?? 'ctx.typesafe', outcome.response.model, Object.keys(request.questions).length, outcome.response.usage, latencyMs, true, false)
      return { response: outcome.response, cached: false, latencyMs }
    } catch (error) {
      const latencyMs = this.now() - started
      const code = error instanceof TypesafeError ? error.code : 'network'
      this.record(options?.label ?? 'ctx.typesafe', model, Object.keys(request.questions).length, undefined, latencyMs, false, false, code)
      this.health.fail(code, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /** {@inheritDoc TypesafeService.choice} */
  async choice(state: EntryType, instructions: EntryType, criteria: Readonly<Record<string, EntryType>>, options?: ServiceCallOptions): Promise<Judged<ChoiceAnswer>> {
    const question: Question = { type: 'choice', instructions, criteria }
    return this.single('choice', state, question, options)
  }

  /** {@inheritDoc TypesafeService.noul} */
  async noul(state: EntryType, instructions: EntryType, criteria?: { readonly true: EntryType; readonly false: EntryType }, options?: ServiceCallOptions): Promise<Judged<NoulAnswer>> {
    const question: Question = criteria === undefined ? { type: 'noul', instructions } : { type: 'noul', instructions, criteria }
    return this.single('noul', state, question, options)
  }

  /** {@inheritDoc TypesafeService.score} */
  async score(state: EntryType, instructions: EntryType, levels: readonly EntryType[], options?: ServiceCallOptions): Promise<Judged<ScoreAnswer>> {
    const question: Question = { type: 'score', instructions, criteria: levels }
    return this.single('score', state, question, options)
  }

  /** {@inheritDoc TypesafeService.judge} */
  async judge(state: EntryType, questions: Questions, options?: ServiceCallOptions): Promise<Readonly<Record<string, Answer>>> {
    const outcome = await this.evaluate({ state, questions }, options)
    return outcome.response.answers
  }

  /** {@inheritDoc TypesafeService.rerank} */
  async rerank(state: EntryType, items: readonly RerankItem[], instruction: string, options?: RerankOptions): Promise<readonly RerankResult[]> {
    if (items.length === 0) return []
    if (items.length > MAX_RERANK_ITEMS) {
      throw new TypesafeError('invalid-request', `一次最多重排 ${String(MAX_RERANK_ITEMS)} 个候选（收到 ${String(items.length)} 个）`, { retryable: false })
    }
    const chunkSize = Math.min(Math.max(1, options?.chunkSize ?? RERANK_CHUNK), RERANK_CHUNK_CAP)
    const chunks: RerankItem[][] = []
    for (let index = 0; index < items.length; index += chunkSize) chunks.push(items.slice(index, index + chunkSize))
    const concurrency = Math.min(Math.max(1, options?.concurrency ?? RERANK_CONCURRENCY), RERANK_CONCURRENCY_CAP)
    const scored: RerankResult[] = []
    const failures: unknown[] = []
    // 记下开工前的连续失败数：收尾时用它判断「分块自己记过账没有」，
    // 从而决定补记一次失败还是只更新摘要（见下方 failures 分支）。
    const failuresBefore = this.health.snapshot().consecutiveFailures
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor
        cursor += 1
        const chunk = chunks[index]
        if (chunk === undefined) return
        try {
          scored.push(...await this.rerankChunk(state, chunk, instruction, options))
        } catch (error) {
          // 一块失败不该让已经付费算出来的别的块作废：记下来，跑完所有块再决定。
          // （这里必须自己 catch：否则 reject 的 worker 会连带丢弃 scored 里的结果。）
          failures.push(error)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))
    if (failures.length > 0) {
      const first = failures[0]
      const detail = first instanceof Error ? first.message : String(first)
      // 摘要沿用改版前的 `rerank: ...` 形态，排障时一眼能认出这是分块降级而不是单次调用失败。
      const summary = scored.length === 0
        ? `${String(failures.length)}/${String(chunks.length)} 块失败：${detail}`
        : `${String(failures.length)}/${String(chunks.length)} 块失败，返回其余 ${String(scored.length)} 个候选：${detail}`
      // 分块若已经各自记过账（网络层失败走 evaluate），这里只补摘要；否则说明这次失败
      // 发生在 evaluate 之外（例如形状校验），必须由这里补记，否则健康面会说「一切正常」。
      if (this.health.snapshot().consecutiveFailures > failuresBefore) this.health.note('rerank', summary)
      else this.health.fail('rerank', summary)
      // 全失败 = 没有可用结果，如实抛错；部分失败 = 返回已成功的部分（降级，不静默）。
      if (scored.length === 0) throw first instanceof Error ? first : new TypesafeError('network', detail)
    }
    return scored.sort((left, right) => right.relevance - left.relevance)
  }

  /** 一块候选 = 一次请求，一块里一个候选一个问题。 */
  private async rerankChunk(state: EntryType, chunk: readonly RerankItem[], instruction: string, options?: RerankOptions): Promise<readonly RerankResult[]> {
    const questions: Record<string, Question> = {}
    chunk.forEach((item, index) => {
      questions[`c${String(index)}`] = {
        type: 'noul',
        instructions: `${instruction}\n只针对候选片段 \`candidates[${String(index)}]\` 判断，不要参考其它候选。`,
        criteria: { true: '这个候选确实符合上面的要求', false: '这个候选不符合，或信息不足以判断' },
      }
    })
    const outcome = await this.evaluate({
      state: { context: state, candidates: chunk.map(item => ({ id: item.id, text: item.text })) },
      questions,
    }, { ...options, label: options?.label ?? 'ctx.typesafe.rerank' })
    return chunk.map((item, index) => {
      const answer = outcome.response.answers[`c${String(index)}`]
      // 缺答案或类型不符**不能**当 0 分：0 分与「模型明确判为不相关」在排序里无法区分，
      // 候选会被静默沉底。宁可让这一块失败（上层会保留其它块的结果）。
      if (answer === undefined || answer.type !== 'noul') {
        throw new TypesafeError('malformed', `rerank 未返回候选 candidates[${String(index)}] 的 noul 答案`)
      }
      return { id: item.id, text: item.text, relevance: answer.noul }
    })
  }

  /** {@inheritDoc TypesafeService.probe} */
  async probe(options?: ServiceCallOptions): Promise<ProbeResult> {
    return this.transport.probe({ signal: options?.signal, timeoutMs: options?.timeoutMs, retries: options?.maxRetries })
  }

  /** {@inheritDoc TypesafeService.status} */
  async status(): Promise<TypesafeStatus> {
    const settings = this.settings
    const read = await this.options.keyring.read()
    const key: KeyState = read.state
    const snapshot = this.log.snapshot()
    const health = this.health.snapshot()
    // 摘要优先取健康记账（它带 code 与脱敏消息），退回到观测缓冲的粗摘要。
    const lastError = this.health.summary() ?? snapshot.lastError
    return {
      version: PLUGIN_VERSION,
      key,
      model: settings.model,
      baseUrl: this.transport.baseUrl,
      settings,
      totals: snapshot.totals,
      cache: this.cache.stats(),
      recent: snapshot.recent,
      health,
      ...lastError === undefined ? {} : { lastError },
    }
  }

  /** {@inheritDoc TypesafeService.recent} */
  recent(limit?: number): readonly RecentCall[] {
    return this.log.recent(limit)
  }

  /** 单问题原语的公共路径。 */
  private async single<A extends Answer>(expectation: A['type'], state: EntryType, question: Question, options?: ServiceCallOptions): Promise<Judged<A>> {
    const outcome = await this.evaluate({ state, questions: { q: question } }, options)
    let answer: A
    try {
      answer = singleAnswer<A>(outcome.response.answers, expectation, 'q')
    } catch (error) {
      // 网络成功了但应答不合形状：这条必须记成失败，否则观测面显示「一切正常」
      // 而调用方拿到的是异常——错误被记成成功是最难查的一类观测污染。
      const code = error instanceof TypesafeError ? error.code : 'malformed'
      this.record(options?.label ?? 'ctx.typesafe', outcome.response.model, 1, undefined, outcome.latencyMs, false, outcome.cached, code)
      this.health.fail(code, error instanceof Error ? error.message : String(error))
      throw error
    }
    return {
      answer,
      model: outcome.response.model,
      usage: outcome.response.usage,
      cached: outcome.cached,
      latencyMs: outcome.latencyMs,
    }
  }

  /** 记一条观测（不含任何 state / 问题原文）。 */
  private record(label: string, model: string, questionCount: number, usage: SystemOneResponse['usage'] | undefined, latencyMs: number, ok: boolean, cached: boolean, errorCode?: RecentCall['errorCode']): void {
    this.log.record({
      at: this.now(),
      label,
      model,
      questionCount,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      latencyMs,
      cached,
      ok,
      ...errorCode === undefined ? {} : { errorCode },
    })
    // 成功在这里收口（失败在各自的 catch 里记账，那里才有 code 与消息原文）。
    // 放在 record() 而不是各调用点：这是所有观测的唯一必经之处，新增路径不会漏掉它。
    if (ok) this.health.succeed()
  }

  /** 时钟 seam：默认 Date.now，测试可注入。 */
  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

/**
 * 建一个默认服务实例。
 *
 * @param options - 注入面。
 * @returns 可直接挂到 `ctx.provide('typesafe', ...)` 的服务。
 */
export function createTypesafeService(options: TypesafeServiceOptions): TypesafeService {
  return new DefaultTypesafeService(options)
}

/** 设置缺省值导出一次，方便装配层在 settings 服务缺席时兜底。 */
export const FALLBACK_SETTINGS: TypesafeSettings = TYPESAFE_SETTINGS_DEFAULTS

/**
 * @suxeca/dsh-typesafe — host 侧 HTTP 传输层（契约 A）。
 *
 * 为什么单独抽一层：System One 只有一条网络路径，但这条路径承载了全部可靠性语义——
 * 密钥只允许出现在 header、单次尝试要有独立预算、429/529/5xx 与网络错误要分辨并退避、
 * 调用方取消与超时必须给调用方不同的决策依据。这些逻辑散进服务/工具/路由会变成几份
 * 互相漂移的副本，所以集中成一个只负责「发一次请求 + 分类失败」的类，并把
 * fetch / now / sleep / logger 全做成可注入的 seam：生产零装配即可跑，测试可脱网
 * 精确断言尝试次数与退避毫秒数。
 *
 * 安全：任何进入日志或 Error message 的字符串都先擦掉密钥再截断，服务端把密钥回显在
 * 响应体里也不会漏出去；密钥永远只存在于一次 fetch 的 header 中。
 *
 * @module @suxeca/dsh-typesafe/host/transport
 */

import type { EvalPayload, ProbeResult, SystemOneResponse, TypesafeErrorCode } from '../shared.ts'
import { CREDENTIAL_REF, EVAL_PATH, MODELS_PATH, clampText, isSystemOneResponse, redactSecrets } from '../shared.ts'

/** 传输层日志出口：只接脱敏后的单行文本，不要传 payload 本体。 */
export interface TransportLogger {
  warn(message: string): void // 需要运维注意的事件（重试决策、退避时长）
  debug?(message: string): void // 可选的低噪声细节（发送了哪次尝试）
}

/** 传输层装配参数：端点与预算之外，全是可替换的副作用 seam。 */
export interface TransportConfig {
  readonly baseUrl: string // 服务端根地址；尾部斜杠会被裁掉
  readonly timeoutMs: number // 单次尝试的默认超时（毫秒）；<= 0 表示不设超时
  readonly maxRetries: number // 可重试错误之外的额外尝试次数；总尝试次数 = 1 + maxRetries
  readonly totalBudgetMs?: number // 重试总预算（含退避等待）；缺省 30s，<= 0 表示不限
  readonly getKey: () => Promise<string | undefined> // 每次调用现取，禁止缓存；undefined 或空白 = 未配置
  readonly fetchImpl?: typeof fetch // 测试注入；缺省用全局 fetch
  readonly logger?: TransportLogger // 测试注入；缺省为空实现
  readonly now?: () => number // 测试注入；缺省用 Date.now
  readonly sleep?: (ms: number) => Promise<void> // 测试注入；缺省的 sleep 是真等待
}

/** 单次调用的覆盖项：不改变 config 里的默认预算。 */
export interface TransportCallOptions {
  readonly signal?: AbortSignal // 调用方取消信号；与单次尝试超时合并，取消不重试
  readonly timeoutMs?: number // 覆盖本次调用的单次尝试超时
  readonly retries?: number // 覆盖本次调用的额外重试次数
  readonly totalBudgetMs?: number // 覆盖本次调用的重试总预算（含退避等待）
  readonly model?: string // 覆盖 payload.model（不修改传入的 payload 本体）
}

// transient = 429 rate-limit / 529 overloaded / 5xx server / 网络 / 超时；其余都不可重试。
const RETRYABLE_CODES: readonly TypesafeErrorCode[] = ['rate-limit', 'overloaded', 'server', 'timeout', 'network']
const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 5_000
const RETRY_AFTER_CAP_MS = 60_000
const DEFAULT_TOTAL_BUDGET_MS = 30_000
const EXCERPT_MAX = 200
const MESSAGE_MAX = 240
const MIN_SCRUB_LENGTH = 6 // 短于这个长度的「密钥」不做逐字擦除，否则会把普通文本打碎

/**
 * 传输层统一错误：调用方只按 code 决策（重试 / 换模型 / 报错给用户）。
 * message 由构造方负责先脱敏截断——擦除需要密钥明文，而那只在调用生命周期内存在。
 */
export class TypesafeError extends Error {
  /** 失败分类。 */
  readonly code: TypesafeErrorCode
  /** HTTP 状态码；网络层失败（超时 / 取消 / 连接错误）没有状态码。 */
  readonly status?: number
  /** 是否属于 transient；true 表示这次调用链里已按策略重试过或仍值得重试。 */
  readonly retryable: boolean

  /** @param options - 可选 HTTP 状态码、retryable 覆盖与底层 cause。 */
  constructor(code: TypesafeErrorCode, message: string, options: { status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TypesafeError'
    this.code = code
    this.retryable = options.retryable ?? RETRYABLE_CODES.includes(code)
    if (options.status !== undefined) this.status = options.status
  }
}

interface AttemptContext { readonly key: string; readonly signal: AbortSignal | undefined; readonly timeoutMs: number; readonly attempt: number }
type Sanitizer = (raw: string) => string
type AttemptOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TypesafeError; readonly retryAfterMs?: number }
type ProbeModel = ProbeResult['models'][number]
interface MergedSignal { readonly signal: AbortSignal; readonly dispose: () => void; readonly timedOut: () => boolean }

const defaultFetch: typeof fetch = (input, init) => fetch(input, init)
const defaultNow = (): number => Date.now()
const defaultSleep = (milliseconds: number): Promise<void> => new Promise<void>(resolve => { setTimeout(resolve, milliseconds) })
const NOOP_LOGGER: TransportLogger = { warn: () => {} }
// AbortSignal 的静态工厂在不同运行时/打包形态下可能缺项，先描述再探测。
const abortSignalStatics = AbortSignal as unknown as {
  timeout?: (milliseconds: number) => AbortSignal
  any?: (signals: AbortSignal[]) => AbortSignal
}

/** 单次尝试超时：可重试（下一次尝试可能就赶上服务端恢复）。 */
function timeoutError(timeoutMs: number): TypesafeError {
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? `（超过 ${timeoutMs}ms）` : ''
  return new TypesafeError('timeout', `请求超时${budget}`, { retryable: true })
}

/** 合并调用方信号与单次尝试超时；返回的 dispose 必须调用，否则重试链会累积监听。 */
function mergeSignals(timeoutMs: number, caller: AbortSignal | undefined): MergedSignal {
  const timeout = abortSignalStatics.timeout
  const combine = abortSignalStatics.any
  const timeoutSignal = Number.isFinite(timeoutMs) && timeoutMs > 0 && timeout !== undefined ? timeout(timeoutMs) : undefined
  if (timeoutSignal === undefined) return { signal: caller ?? new AbortController().signal, dispose: () => {}, timedOut: () => false }
  if (caller === undefined) return { signal: timeoutSignal, dispose: () => {}, timedOut: () => timeoutSignal.aborted }
  const callerSignal: AbortSignal = caller
  if (combine !== undefined) return { signal: combine([callerSignal, timeoutSignal]), dispose: () => {}, timedOut: () => timeoutSignal.aborted }
  // 运行时没有 AbortSignal.any：手工转发任一来源的 abort 到自己的 controller。
  const controller = new AbortController()
  const forwardCaller = (): void => { const reason: unknown = callerSignal.reason; controller.abort(reason) }
  const forwardTimeout = (): void => { const reason: unknown = timeoutSignal.reason; controller.abort(reason) }
  if (callerSignal.aborted) forwardCaller()
  else callerSignal.addEventListener('abort', forwardCaller, { once: true })
  if (timeoutSignal.aborted) forwardTimeout()
  else timeoutSignal.addEventListener('abort', forwardTimeout, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timeoutSignal.aborted,
    dispose: () => { callerSignal.removeEventListener('abort', forwardCaller); timeoutSignal.removeEventListener('abort', forwardTimeout) },
  }
}
/**
 * 区分「调用方取消」与「单次尝试超时」。
 * 判定顺序：调用方信号是否 abort（意图优先）→ 预算探针 → 抛出物 name 兜底，这样桩对象
 * 无论「真 abort 后拒绝」还是「伪造 AbortError / TimeoutError」都能落到正确的 code 上。
 * @param cause - 触发分类的抛出物（可选）。
 * @returns 分类错误；三者都没触发则为 undefined。
 */
function abortFailure(merged: MergedSignal, caller: AbortSignal | undefined, timeoutMs: number, cause?: unknown): TypesafeError | undefined {
  if (caller !== undefined && caller.aborted) return new TypesafeError('aborted', '调用方已取消请求', { retryable: false })
  if (merged.signal.aborted || merged.timedOut()) return timeoutError(timeoutMs)
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'TimeoutError') return timeoutError(timeoutMs)
  if (name === 'AbortError') return new TypesafeError('aborted', '调用方已取消请求', { retryable: false })
  return undefined
}
function describeThrown(cause: unknown): string {
  return cause instanceof Error ? (cause.message === '' ? cause.name : cause.message) : typeof cause === 'string' ? cause : String(cause)
}
/** HTTP 状态码 → 失败分类；408 与 429 与 5xx（含 529）算 transient，无状态码按网络错误处理。 */
function classifyStatus(status: number): { readonly code: TypesafeErrorCode; readonly retryable: boolean } {
  // 桩对象 / 自建网关可能不带 status：那是一次没拿到应答的网络失败，不是「请求非法」。
  if (status === 0) return { code: 'network', retryable: true }
  if (status === 401 || status === 403) return { code: 'auth', retryable: false }
  // 408 在 TypeSafe 官方 SDK 的重试状态集里（{408, 429, 5xx}），这里对齐。
  if (status === 408) return { code: 'timeout', retryable: true }
  if (status === 429) return { code: 'rate-limit', retryable: true }
  if (status === 529) return { code: 'overloaded', retryable: true }
  if (status >= 500) return { code: 'server', retryable: true }
  return { code: 'invalid-request', retryable: false }
}
// 2xx 视为成功；优先信任 ok，桩对象漏写 ok 时按状态码兜底。
function isSuccess(response: Response): boolean {
  return response.ok === true || (typeof response.status === 'number' && response.status >= 200 && response.status < 300)
}
// 读响应头；桩对象没有 headers 时当作没有提示，退回指数退避。
function headerOf(response: Response, name: string): string | null {
  const candidate = response.headers as { get?: (key: string) => unknown } | undefined
  const get = candidate?.get
  if (candidate === undefined || get === undefined) return null
  try { const value = get.call(candidate, name); return typeof value === 'string' ? value : null } catch { return null }
}
/** 解析服务端退避提示：retry-after-ms 优先于 retry-after，两者都封顶 60s。 */
function retryAfterMsFrom(response: Response): number | undefined {
  return headerDelay(response, 'retry-after-ms', 1) ?? headerDelay(response, 'retry-after', 1000)
}

// 单个退避头的解析：非法或负数当没有；scale 用来把秒换算成毫秒。
function headerDelay(response: Response, name: string, scale: number): number | undefined {
  const parsed = Number.parseFloat(headerOf(response, name) ?? '')
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.min(Math.round(parsed * scale), RETRY_AFTER_CAP_MS)
}

// 错误响应体摘录：优先 error.message / message / detail，否则原文前 200 字符。
function errorExcerptFrom(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  let payload: unknown
  try { payload = JSON.parse(trimmed) } catch { payload = undefined }
  const record = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined
  const nested = record?.error
  const inner = nested !== null && typeof nested === 'object' ? (nested as Record<string, unknown>).message : undefined
  for (const candidate of [typeof nested === 'string' ? nested : undefined, inner, record?.message, record?.detail]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return clampText(candidate.trim(), EXCERPT_MAX)
  }
  return clampText(trimmed, EXCERPT_MAX)
}

// 正数归一化：非有限或 <= 0 一律当 0（超时 0 = 不超时，重试 0 = 不重试）。
function normalisePositive(value: number | undefined, fallback: number): number {
  const raw = value ?? fallback
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0
}

// 空串和纯空白等同「没给」，避免发 `Bearer ` 或空 model。
function normaliseModel(value: string | undefined): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined }

/** 指数退避 + 抖动：先按契约封顶再乘 [0.75, 1.0) 抖动（与官方 SDK 的 backoff_jitter=0.25 同口径）。 */
function backoffMs(attempt: number, random: number): number {
  return Math.round(Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS) * (0.75 + random * 0.25))
}

/** 组装请求体：options.model 优先于 payload.model，但不改动调用方的 payload。 */
function buildRequestBody(request: EvalPayload, override: string | undefined, sanitize: Sanitizer): string {
  const model = normaliseModel(override) ?? normaliseModel(request.model)
  const payload: EvalPayload = model === undefined
    ? { state: request.state, questions: request.questions }
    : { state: request.state, questions: request.questions, model }
  try {
    return JSON.stringify(payload)
  } catch (cause) {
    throw new TypesafeError('invalid-request', sanitize(`请求体无法序列化为 JSON：${describeThrown(cause)}`), { retryable: false, cause })
  }
}

// 解析 JSON；失败即 malformed（不可重试），且不回显响应体正文。
function parseJson(text: string, sanitize: Sanitizer, label: string): unknown {
  try { return JSON.parse(text) as unknown } catch (cause) {
    throw new TypesafeError('malformed', sanitize(`${label}不是合法 JSON：${describeThrown(cause)}`), { retryable: false, cause })
  }
}

// 校验 System One 应答形状：缺 model / answers / usage 一律 malformed。
function parseSystemOneBody(text: string, sanitize: Sanitizer): SystemOneResponse {
  const payload = parseJson(text, sanitize, '应答')
  if (!isSystemOneResponse(payload)) throw new TypesafeError('malformed', sanitize('应答结构不合法：缺少 model / answers / usage'), { retryable: false })
  return payload
}

// 校验探测应答形状（models 必须是数组），且只保留契约声明的字段。
function parseModelsBody(text: string, sanitize: Sanitizer): readonly ProbeModel[] {
  const payload = parseJson(text, sanitize, '探测应答')
  const raw = payload !== null && typeof payload === 'object' ? (payload as { models?: unknown }).models : undefined
  if (!Array.isArray(raw)) throw new TypesafeError('malformed', sanitize('探测应答结构不合法：缺少 models 数组'), { retryable: false })
  const models: ProbeModel[] = []
  for (const entry of raw) {
    const record = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined
    const name = typeof entry === 'string' ? entry : typeof record?.name === 'string' ? record.name : ''
    if (name.trim() === '') continue
    const release = typeof record?.release_date === 'string' ? record.release_date : undefined
    const description = typeof record?.description === 'string' ? record.description : undefined
    models.push({ name, ...(release === undefined ? {} : { release_date: release }), ...(description === undefined ? {} : { description }) })
  }
  return models
}

// 网络层抛出物 → 分类错误（先判取消/超时，再落到 network）。
function thrownError(cause: unknown, merged: MergedSignal, caller: AbortSignal | undefined, timeoutMs: number, sanitize: Sanitizer): TypesafeError {
  const abort = abortFailure(merged, caller, timeoutMs, cause)
  if (abort !== undefined) return abort
  return new TypesafeError('network', sanitize(`网络请求失败：${describeThrown(cause)}`), { retryable: true, cause })
}

/**
 * System One 的纯 HTTP 传输层：独占 fetch、超时、重试、退避、错误分类与结构校验。
 * 本类不缓存、不解析业务语义、不碰密钥来源；它只保证「一次调用 = 若干次尝试，
 * 失败被分类成调用方可决策的 code」。
 */
export class TypesafeTransport {
  private readonly endpointBase: string; private readonly timeoutMs: number; private readonly maxRetries: number
  private readonly totalBudgetMs: number
  private readonly getKey: () => Promise<string | undefined>; private readonly fetchImpl: typeof fetch
  private readonly logger: TransportLogger; private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>

  /** @param config - 端点、预算与可注入 seam。 */
  constructor(config: TransportConfig) {
    this.endpointBase = config.baseUrl.trim().replace(/\/+$/, '')
    this.timeoutMs = normalisePositive(config.timeoutMs, 0)
    this.maxRetries = normalisePositive(config.maxRetries, 0)
    // 未显式关闭时给一个总预算：单次超时 × 尝试次数 + retry-after 可能叠加出几分钟。
    this.totalBudgetMs = config.totalBudgetMs === undefined ? DEFAULT_TOTAL_BUDGET_MS : normalisePositive(config.totalBudgetMs, 0)
    // 全部包一层箭头：注入的函数被单独解构出来也不会丢 this。
    const fetchImpl = config.fetchImpl ?? defaultFetch
    this.fetchImpl = (input, init) => fetchImpl(input, init)
    const now = config.now ?? defaultNow
    this.now = () => now()
    const sleep = config.sleep ?? defaultSleep
    this.sleep = milliseconds => sleep(milliseconds)
    const getKey = config.getKey
    this.getKey = () => getKey()
    this.logger = config.logger ?? NOOP_LOGGER
  }

  /** 脱敏并去掉尾部斜杠后的 base URL（日志与状态快照用）。 */
  get baseUrl(): string {
    return redactSecrets(this.endpointBase)
  }

  /** POST {baseUrl}/v1/systemone：@param request 载荷本体（不改动）；@param options signal/超时/重试/模型覆盖；@returns 应答与端到端毫秒数。 */
  async systemOne(request: EvalPayload, options?: TransportCallOptions): Promise<{ response: SystemOneResponse; latencyMs: number }> {
    const key = await this.resolveKey()
    const body = buildRequestBody(request, options?.model, (raw: string) => this.sanitize(raw, key))
    const outcome = await this.call<SystemOneResponse>(key, options, context => this.send(context, 'POST', EVAL_PATH, body), parseSystemOneBody)
    return { response: outcome.value, latencyMs: outcome.latencyMs }
  }

  /** GET {baseUrl}/v1/models（「这把 key 现在能用吗」）：@param options signal/超时/重试覆盖；@returns 模型清单与本次调用耗时。 */
  async probe(options?: TransportCallOptions): Promise<ProbeResult> {
    const key = await this.resolveKey()
    const outcome = await this.call<readonly ProbeModel[]>(key, options, context => this.send(context, 'GET', MODELS_PATH, undefined), parseModelsBody)
    return { models: outcome.value, latencyMs: outcome.latencyMs }
  }

  /** 现取密钥；未配置时立刻失败，且一次请求都不发。 */
  private async resolveKey(): Promise<string> {
    let resolved: string | undefined
    try { resolved = await this.getKey() } catch (cause) {
      const why = `读取 ${CREDENTIAL_REF} 失败：${describeThrown(cause)}；请检查环境变量 ${CREDENTIAL_REF} 或设置页保存的密钥`
      this.log('debug', `no-key ${why}`)
      throw new TypesafeError('no-key', clampText(redactSecrets(why), MESSAGE_MAX), { retryable: false, cause })
    }
    const key = typeof resolved === 'string' ? resolved.trim() : ''
    if (key !== '') return key
    const why = `未配置 ${CREDENTIAL_REF}：请设置环境变量 ${CREDENTIAL_REF}，或在 DSH 设置页的 TypeSafe 区块保存密钥`
    this.log('debug', `no-key ${why}`)
    throw new TypesafeError('no-key', clampText(redactSecrets(why), MESSAGE_MAX), { retryable: false })
  }

  /** 密钥零明文：先逐字擦除本次密钥，再走通用脱敏与截断。 */
  private sanitize(raw: string, key: string): string {
    return clampText(redactSecrets(key.length >= MIN_SCRUB_LENGTH ? raw.split(key).join('<redacted>') : raw), MESSAGE_MAX)
  }
  /** 日志只接受脱敏后的一行文本；永远不记录 header 或 payload。 */
  private log(level: 'debug' | 'warn', message: string): void {
    const line = clampText(redactSecrets(`typesafe transport: ${message}`), MESSAGE_MAX * 2)
    if (level === 'warn') { this.logger.warn(line); return }
    this.logger.debug?.(line)
  }
  /** 发一次请求：此处是唯一写 authorization header 的地方。 */
  private send(context: AttemptContext, method: 'GET' | 'POST', path: string, body: string | undefined): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${context.key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    }
    this.log('debug', `${method} ${this.baseUrl}${path}（第 ${context.attempt} 次尝试）`)
    const init: RequestInit = { method, headers, signal: context.signal }
    if (body !== undefined) init.body = body
    return this.fetchImpl(`${this.endpointBase}${path}`, init)
  }

  /** 重试循环：总尝试次数 = 1 + (options.retries ?? config.maxRetries)，只有 transient 才继续。 */
  private async call<T>(
    key: string,
    options: TransportCallOptions | undefined,
    send: (context: AttemptContext) => Promise<Response>,
    parse: (text: string, sanitize: Sanitizer) => T,
  ): Promise<{ value: T; latencyMs: number }> {
    const caller = options?.signal
    const cancelled = (): TypesafeError => new TypesafeError('aborted', '调用方已取消请求', { retryable: false })
    if (caller !== undefined && caller.aborted) throw cancelled() // 发起前就取消了：不发请求
    const startedAt = this.now()
    const sanitize = (raw: string): string => this.sanitize(raw, key)
    const totalAttempts = normalisePositive(options?.retries, this.maxRetries) + 1
    const timeoutMs = normalisePositive(options?.timeoutMs, this.timeoutMs)
    // 总预算：单次超时 × 尝试次数 + retry-after 可能叠加出几分钟，这里给它一个上限。
    const budgetMs = normalisePositive(options?.totalBudgetMs, this.totalBudgetMs)
    const deadline = budgetMs > 0 ? startedAt + budgetMs : Number.POSITIVE_INFINITY
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.attempt(send, parse, { key, signal: caller, timeoutMs, attempt }, sanitize)
      if (outcome.ok) return { value: outcome.value, latencyMs: this.now() - startedAt }
      if (attempt >= totalAttempts || !outcome.error.retryable) throw outcome.error
      // 取消发生在失败与退避之间：不再白等一次，也不该把 code 说成 rate-limit。
      if (caller !== undefined && caller.aborted) throw cancelled()
      const delayMs = outcome.retryAfterMs ?? backoffMs(attempt, Math.random())
      // 预算不够下一次尝试就不等了：把最后一次失败原样抛出，让调用方立刻决策。
      if (this.now() + delayMs > deadline) {
        this.log('warn', `${outcome.error.code}：第 ${attempt}/${totalAttempts} 次尝试失败，剩余总预算不足以再等 ${delayMs}ms，停止重试`)
        throw outcome.error
      }
      this.log('warn', `${outcome.error.code}：第 ${attempt}/${totalAttempts} 次尝试失败，${delayMs}ms 后重试`)
      await this.sleep(delayMs)
    }
  }

  /** 单次尝试：合并信号 → 发请求 → 读响应 → 按状态或解析结果分类。 */
  private async attempt<T>(
    send: (context: AttemptContext) => Promise<Response>,
    parse: (text: string, sanitize: Sanitizer) => T,
    context: AttemptContext,
    sanitize: Sanitizer,
  ): Promise<AttemptOutcome<T>> {
    const merged = mergeSignals(context.timeoutMs, context.signal)
    try {
      let response: Response
      try { response = await send({ ...context, signal: merged.signal }) } catch (cause) {
        return { ok: false, error: thrownError(cause, merged, context.signal, context.timeoutMs, sanitize) }
      }
      if (!isSuccess(response)) {
        const status = typeof response.status === 'number' ? response.status : 0
        const classified = classifyStatus(status)
        let excerpt = ''
        try { excerpt = errorExcerptFrom(await response.text()) } catch { excerpt = '' }
        const detail = excerpt === '' ? `HTTP ${status}` : `HTTP ${status}: ${excerpt}`
        const error = new TypesafeError(classified.code, sanitize(detail), { status, retryable: classified.retryable })
        return { ok: false, error, retryAfterMs: retryAfterMsFrom(response) }
      }
      let text: string
      try { text = await response.text() } catch (cause) {
        return { ok: false, error: thrownError(cause, merged, context.signal, context.timeoutMs, sanitize) }
      }
      try {
        return { ok: true, value: parse(text, sanitize) }
      } catch (cause) {
        const abort = abortFailure(merged, context.signal, context.timeoutMs, cause)
        if (abort !== undefined) return { ok: false, error: abort }
        if (cause instanceof TypesafeError) return { ok: false, error: cause }
        return { ok: false, error: new TypesafeError('malformed', sanitize(`应答解析失败：${describeThrown(cause)}`), { retryable: false, cause }) }
      }
    } finally { merged.dispose() }
  }
}

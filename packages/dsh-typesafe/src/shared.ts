/**
 * @suxeca/dsh-typesafe — 共享契约层。
 *
 * 这里只放**线上协议形状**与**纯函数**：TypeSafe System One 的请求/应答、
 * 本插件设置面的形状、host 与 client 之间的 JSON 信封、密钥脱敏。
 * 浏览器半可以安全内联这一层（无服务身份、无 @deepseek-ai/* 值导入），
 * 所以设置区块与 host 路由看到的是同一套类型。
 *
 * @module @suxeca/dsh-typesafe/shared
 */

/** System One 接受的条目值：字符串、JSON 对象/数组、或 null。 */
export type EntryValue =
  | string
  | number
  | boolean
  | null
  | readonly EntryValue[]
  | { readonly [key: string]: EntryValue }

/**
 * `state` / `instructions` / `criteria` 的统一类型。
 *
 * 与线上协议同宽：字符串、JSON 对象、JSON 数组、或 null。**裸 number / boolean
 * 不是合法条目**——那种内容要放进字符串或对象里，否则服务端会按 422 拒掉。
 * 嵌套值（数组元素、对象字段）则用 {@link EntryValue}，可以是任意 JSON 标量。
 */
export type EntryType = string | readonly EntryValue[] | { readonly [key: string]: EntryValue } | null

/** 一个是非判断（yes 概率，无 confidence）。 */
export interface NoulQuestion {
  readonly type: 'noul'
  readonly instructions: EntryType
  readonly criteria?: { readonly true: EntryType; readonly false: EntryType }
}

/** 一个从固定选项集中选一的判断。 */
export interface ChoiceQuestion {
  readonly type: 'choice'
  readonly instructions: EntryType
  /** 选项 key → 判据描述；没有额外细节时用 null。至少 1 个，最多 255 个。 */
  readonly criteria: Readonly<Record<string, EntryType>>
}

/** 一个沿有序等级打分的判断（2–10 级）。 */
export interface ScoreQuestion {
  readonly type: 'score'
  readonly instructions: EntryType
  readonly criteria: readonly EntryType[]
}

/** 三种原语之一。 */
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion

/** 一次请求里的问题表：key 由调用方自取，答案按同一个 key 返回（key 不送给模型）。 */
export type Questions = Readonly<Record<string, Question>>

/** Noul 的答案。 */
export interface NoulAnswer {
  readonly type: 'noul'
  /** 答案为 yes 的概率，0..1。 */
  readonly noul: number
}

/** Choice 的答案。 */
export interface ChoiceAnswer {
  readonly type: 'choice'
  /** 概率最高的选项 key。 */
  readonly choice: string
  /** 每个选项的概率，sum = 1。 */
  readonly probabilities: Readonly<Record<string, number>>
  /** 分布集中度，0..1。 */
  readonly confidence: number
}

/** Score 的答案。 */
export interface ScoreAnswer {
  readonly type: 'score'
  /** 概率加权位置，可能落在整数级之间。 */
  readonly score: number
  /**
   * 等级序号（字符串 key）→ 等级描述。
   *
   * 值是 `EntryType` 而不是 `string`：等级描述可以是结构化对象
   * （例如 `{ what: "...", examples: [...] }`），这时服务端原样回传。
   */
  readonly legend: Readonly<Record<string, EntryType>>
  /** 每个等级的概率，sum = 1。 */
  readonly probabilities: Readonly<Record<string, number>>
  /** 分布集中度，0..1。 */
  readonly confidence: number
}

/** 三种原语之一的答案。 */
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer

/** 服务端返回的 token 计量。 */
export interface Usage {
  readonly input_tokens: number
  readonly output_tokens: number
}

/** 一次 System One 请求体。 */
export interface SystemOneRequest {
  readonly state: EntryType
  readonly questions: Questions
  /** 缺省用设置里的 model。 */
  readonly model?: string
}

/** 一次 System One 应答体。`model` 是真正作答的版本号（例如 jev-1.13.0）。 */
export interface SystemOneResponse {
  readonly model: string
  readonly answers: Readonly<Record<string, Answer>>
  readonly usage: Usage
}

/** 带上本地观测信息的判断结果。 */
export interface Judged<A extends Answer = Answer> {
  readonly answer: A
  readonly model: string
  readonly usage: Usage
  /** 命中本地缓存（未产生网络请求与费用）。 */
  readonly cached: boolean
  /** 端到端耗时（含缓存查询）。 */
  readonly latencyMs: number
}

/** 服务端载荷，`state` 与 `criteria` 用同一套条目类型。 */
export interface EvalPayload {
  readonly state: EntryType
  readonly questions: Questions
  readonly model?: string
}

/** 一次判断的观测记录（不含 state / instructions 原文）。 */
export interface RecentCall {
  readonly at: number
  /** 调用方给的标签（例如 'tool:typesafe_eval'、'preflight:bash'）。 */
  readonly label: string
  readonly model: string
  readonly questionCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
  readonly cached: boolean
  readonly ok: boolean
  readonly errorCode?: TypesafeErrorCode
}

/** 累计计量。 */
export interface TypesafeTotals {
  readonly calls: number
  readonly failures: number
  readonly cacheHits: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** 密钥解析结果：来自哪个源、能不能写。 */
export interface KeyState {
  readonly configured: boolean
  readonly source: 'env' | 'credential' | 'none'
  /** 可写才允许在设置页保存；env 提供时是只读的（会被 set 拒绝）。 */
  readonly writable: boolean
}

/** 危险命令语义预审（tools/pre-execute 门禁）的配置。 */
export interface PreflightSettings {
  /** 默认关：这是唯一会往每一次 bash 调用上加网络往返的功能。 */
  readonly enabled: boolean
  /** 门禁自己的预算；超时一律放行（fail-open）。 */
  readonly timeoutMs: number
  /** 判为危险所需的最低 confidence。 */
  readonly minConfidence: number
}

/** 任务模式分流（router-standard 适配器）的配置。 */
export interface RouterSettings {
  /** 默认关：只有把它接进 preset 之后才有意义。 */
  readonly enabled: boolean
  readonly timeoutMs: number
}

/** 本插件设置命名空间的解析后形状。 */
export interface TypesafeSettings {
  readonly model: string
  readonly baseUrl: string
  /** 单次尝试的超时。 */
  readonly timeoutMs: number
  /** 可重试错误的额外尝试次数（429 / 529 / 5xx / 网络 / 超时）。 */
  readonly maxRetries: number
  /** 本地缓存 TTL；0 关闭缓存。 */
  readonly cacheTtlMs: number
  readonly cacheMaxEntries: number
  /** 是否把 state / 问题原文写进日志。默认关：那些内容常常含用户数据。 */
  readonly logState: boolean
  /** 是否向 Agent 暴露 typesafe_eval 工具。 */
  readonly tool: boolean
  readonly preflight: PreflightSettings
  readonly router: RouterSettings
}

/** 设置默认值（host 的 schema 与 client 的初始草稿共用一份）。 */
export const TYPESAFE_SETTINGS_DEFAULTS: TypesafeSettings = {
  model: 'jev-latest',
  baseUrl: 'https://api.typesafe.ai',
  timeoutMs: 10_000,
  maxRetries: 2,
  cacheTtlMs: 300_000,
  cacheMaxEntries: 256,
  logState: false,
  tool: true,
  preflight: { enabled: false, timeoutMs: 1_500, minConfidence: 0.9 },
  router: { enabled: false, timeoutMs: 2_000 },
}

/** 当前状态快照：设置页与健康检查的单一事实源。 */
export interface TypesafeStatus {
  readonly version: string
  readonly key: KeyState
  readonly model: string
  readonly baseUrl: string
  readonly settings: TypesafeSettings
  readonly totals: TypesafeTotals
  readonly cache: { readonly entries: number; readonly hits: number; readonly misses: number }
  readonly recent: readonly RecentCall[]
  /** 最近一次失败的脱敏摘要，没有则为 undefined。 */
  readonly lastError?: string
  /** 当下的健康事实（是否正在失败、连续几次、何时）。 */
  readonly health: TypesafeHealth
}

/**
 * 健康观测：把「这个插件其实已经不能用了」变成可读事实。
 *
 * 为什么需要它：本插件的失败路径**全部**是刻意不打断主流程的——工具只返回
 * `no-key`，分流 fail-open 返回 `undefined`，门禁一律放行。这个设计本身是对的
 * （一次网络抖动不该让 agent 无法执行任何命令），但它有一个真实代价：插件可以在
 * 完全不可用的状态下运行很久而**没有任何人知道**。这个字段是那个代价的对冲。
 */
export interface TypesafeHealth {
  /** 最近一次判断是否失败；成功一次即回到 false。 */
  readonly degraded: boolean
  /** 当前连续失败次数；任一成功即归零。 */
  readonly consecutiveFailures: number
  /** 最近一次失败的时间戳（epoch ms）。 */
  readonly lastErrorAt?: number
  /** 最近一次失败的分类，与 `TypesafeErrorCode` 同域。 */
  readonly lastErrorCode?: string
  /** 最近一次失败的脱敏消息（绝不含密钥）。 */
  readonly lastErrorMessage?: string
  /** 最近一次成功的时间戳（epoch ms）；从未成功过则 undefined。 */
  readonly lastSuccessAt?: number
}

/** 失败分类：调用方按 code 决策（重试 / 换模型 / 报错给用户）。 */
export type TypesafeErrorCode =
  | 'no-key'
  | 'auth'
  | 'invalid-request'
  | 'invalid-json'
  | 'rate-limit'
  | 'overloaded'
  | 'server'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'malformed'
  | 'disabled'

/** 探测结果：只读 /v1/models，用来回答「这把 key 现在能用吗」。 */
export interface ProbeResult {
  readonly models: readonly { readonly name: string; readonly release_date?: string; readonly description?: string }[]
  readonly latencyMs: number
}

/** host → client 的统一信封（与仓库其它插件一致）。 */
export type Envelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 设置命名空间与其校验规则（settings provider 要求 kebab-case）。 */
export const SETTINGS_NS = 'typesafe'

/** 密钥引用的名字（credentials / env 同名，符合 POSIX 标识符规则）。 */
export const CREDENTIAL_REF = 'TYPESAFE_API_KEY'

/** host 路由前缀。 */
export const API_PREFIX = '/typesafe'

/** 服务端默认地址与探测端点。 */
export const DEFAULT_BASE_URL = 'https://api.typesafe.ai'
export const EVAL_PATH = '/v1/systemone'
export const MODELS_PATH = '/v1/models'

/** 默认模型别名（服务端会解析成版本号）。 */
export const DEFAULT_MODEL = 'jev-latest'

/** 本插件对外暴露的版本，用于状态快照与文档对齐。 */
export const PLUGIN_VERSION = '0.1.0'

/**
 * 抹掉文本里可能出现的密钥。
 *
 * 三层，从精确到兜底：
 * 1. 已知前缀形状（`apikey_`、`Bearer`、`sk-`）——覆盖 TypeSafe 与主流厂商；
 * 2. 任何 ≥24 字符的连续 token（`[A-Za-z0-9_-]`）——上游 provider 在错误里回显
 *    一把我们**从未见过**的密钥时，我们没有明文可逐字替换，只能按熵兜底。
 *    代价是长会话 id / 长文件名也会被抹掉，这是可接受的取舍。
 *
 * 任何会落到日志、错误消息或 HTTP 响应里的字符串都必须先过这一层：
 * 密钥只应该存在于一次 fetch 的 header 里。
 *
 * @param text - 原始文本。
 * @returns 脱敏后的文本。
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bapikey_[A-Za-z0-9_]+/g, 'apikey_<redacted>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<redacted-token>')
}

/**
 * 截断长文本，避免错误消息里带上整段 state。
 *
 * 返回值的长度**保证不超过 `max`**（省略号算在额度内）：调用方拿它当长度预算用，
 * 多出一个字符就会让「≤ max」的断言与日志切片出现 off-by-one。
 *
 * @param text - 原始文本。
 * @param max - 上限字符数。
 * @returns 不超过 max 的文本（超出部分以省略号结尾）。
 */
export function clampText(text: string, max = 240): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** 判断一个应答是否符合形状（host 在信任服务端之前做一次结构检查）。 */
export function isSystemOneResponse(value: unknown): value is SystemOneResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { model?: unknown; answers?: unknown; usage?: unknown }
  if (typeof candidate.model !== 'string') return false
  if (typeof candidate.answers !== 'object' || candidate.answers === null) return false
  const usage = candidate.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
  return typeof usage?.input_tokens === 'number' && typeof usage?.output_tokens === 'number'
}

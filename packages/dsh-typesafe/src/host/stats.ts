/**
 * @suxeca/dsh-typesafe — host 侧调用观测（契约 B / stats）。
 *
 * 为什么要有这一层：这个插件对外是「一次判断一次钱」的服务，出问题时对方想问的是
 * 「刚才那次失败是什么分类」「这周的缓存命中率多少」「token 花在哪」，而不是让 agent
 * 去翻宿主日志。所以需要一个进程内、零依赖的观测点：累计计量 + 一小段最近调用。
 *
 * 两条设计红线：
 * 1. **只留 `RecentCall` 字段**。state / instructions / criteria 原文常常是用户数据，
 *    绝不允许进这里——一旦进了，就会顺着 status 路由出现在浏览器上。调用方给不出
 *    原文，本模块也没有存它的字段。
 * 2. **容量封顶**：宿主进程长驻，最近调用必须是环形缓冲（默认 50 条），超限丢最旧；
 *    但总量计数器不清零（环形丢弃的是明细，不是计量）。
 *
 * 纯内存、无 I/O、无模块级可变全局状态；每个实例的计数器与环形缓冲都在字段上。
 *
 * @module @suxeca/dsh-typesafe/host/stats
 */

import type { RecentCall, TypesafeTotals } from '../shared.ts'
import { clampText, redactSecrets } from '../shared.ts'

/** 调用日志装配参数。 */
export interface CallLogOptions {
  /** 明细环形缓冲容量；缺省 50，最小 1。 */
  readonly maxEntries?: number
}

/** 明细默认容量：够看清最近一轮交互，又不至于让 status 响应变胖。 */
const DEFAULT_MAX_ENTRIES = 50

/** 标签截断上限：标签是调用方拼的来源串，长了也没有信息量。 */
const LABEL_MAX = 200

/** 最近失败摘要的截断上限，与全局错误消息口径一致。 */
const ERROR_MAX = 240

/** 失败摘要里拿不到 errorCode 时的兜底分类。 */
const UNKNOWN_CODE = 'unknown'

/**
 * 环形调用日志：累计计量 + 最近 N 条明细。
 *
 * 用固定长度数组 + 游标实现真环形，避免数组 `shift()` 在每条记录上做整体搬移。
 */
export class CallLog {
  /** 环形缓冲容量，保证 >= 1。 */
  private readonly maxEntries: number
  /** 固定长度缓冲；未占用的槽位是 `undefined`。 */
  private readonly buffer: Array<RecentCall | undefined>
  /** 下一个写入槽位。 */
  private cursor = 0
  /** 当前有效条目数（<= maxEntries）。 */
  private size = 0
  /** 累计调用数（含已被环形丢弃的明细）。 */
  private calls = 0
  /** 累计失败数（`ok === false`）。 */
  private failures = 0
  /** 累计缓存命中数（`cached === true`）。 */
  private cacheHits = 0
  /** 累计输入 token。 */
  private inputTokens = 0
  /** 累计输出 token。 */
  private outputTokens = 0
  /** 最近一次失败记录的脱敏摘要；失败明细被环形丢弃后仍然保留。 */
  private lastFailure: string | undefined

  /**
   * @param options - 可选容量配置；缺省 50 条明细。
   */
  constructor(options: CallLogOptions = {}) {
    const requested = options.maxEntries
    // `typeof` 守卫让窄化对编译器可见（Number.isFinite 本身不是类型谓词）。
    const capacity = typeof requested === 'number' && Number.isFinite(requested) ? requested : DEFAULT_MAX_ENTRIES
    this.maxEntries = Math.max(1, Math.floor(capacity))
    this.buffer = new Array<RecentCall | undefined>(this.maxEntries)
  }

  /**
   * 追加一条调用记录（环形：超出容量丢最旧）。
   *
   * 记录会被规整成只含 `RecentCall` 字段的副本：标签先脱敏再截断（它会随 status
   * 响应回到浏览器），数值字段做有限性兜底，避免一个 NaN 永久污染累计计量。
   *
   * @param entry - 调用方构造的观测记录（不得包含 state / instructions 原文）。
   */
  record(entry: RecentCall): void {
    const stored = toStoredCall(entry)

    this.buffer[this.cursor] = stored
    this.cursor = (this.cursor + 1) % this.maxEntries
    if (this.size < this.maxEntries) this.size += 1

    this.calls += 1
    if (stored.ok === false) this.failures += 1
    // 严格按契约口径计数：只有显式 true 才算缓存命中。
    if (stored.cached === true) this.cacheHits += 1
    // 缓存命中没有真实花费：把它算进 token 总量会让「钱花在哪」随命中率系统性虚高
    // （命中 10 次会把一次真实调用记成 11 次的量）。命中率由 cacheHits 单独表达。
    if (stored.cached !== true) {
      this.inputTokens += stored.inputTokens
      this.outputTokens += stored.outputTokens
    }

    if (stored.ok === false) {
      const code = stored.errorCode ?? UNKNOWN_CODE
      this.lastFailure = clampText(redactSecrets(`${code}: ${stored.label}`), ERROR_MAX)
    }
  }

  /**
   * 最近调用明细，最新在前。
   *
   * @param limit - 最多返回条数；省略或非有限值时返回全部保留明细，超出按当前条数截断。
   * @returns 只读明细数组（元素是内部记录的引用，请勿改写）。
   */
  recent(limit?: number): readonly RecentCall[] {
    const count = this.resolveCount(limit)
    const out: RecentCall[] = []
    for (let offset = 0; offset < count; offset += 1) {
      const item = this.buffer[this.indexAt(offset)]
      if (item !== undefined) out.push(item)
    }
    return out
  }

  /**
   * 累计计量（不随环形丢弃而减少）。
   *
   * @returns 调用数、失败数、缓存命中数与 token 总量。
   */
  totals(): TypesafeTotals {
    return {
      calls: this.calls,
      failures: this.failures,
      cacheHits: this.cacheHits,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    }
  }

  /**
   * 最近一次失败记录的脱敏摘要，格式 `code: label`。
   *
   * 摘要保留到下一次失败为止，即使那条明细已经被环形缓冲丢弃——排障时最需要的是
   * 「上次为什么失败」，而不是「上次失败还在不在最近 50 条里」。
   *
   * @returns 摘要文本；从未失败过则返回 `undefined`。
   */
  lastError(): string | undefined {
    return this.lastFailure
  }

  /**
   * 一次性取出状态路由需要的全部观测数据。
   *
   * @returns 累计计量、最近明细，以及（若发生过失败）脱敏后的最近失败摘要。
   */
  snapshot(): { readonly totals: TypesafeTotals; readonly recent: readonly RecentCall[]; readonly lastError?: string } {
    const totals = this.totals()
    const recent = this.recent()
    const lastError = this.lastError()
    // 没有失败时不下发 lastError 键：信封是给浏览器直接渲染的，缺键比 undefined 更干净。
    return lastError === undefined ? { totals, recent } : { totals, recent, lastError }
  }

  /**
   * 把「距最新一条的偏移」换算成环形缓冲下标。
   *
   * @param offset - 0 表示最新一条。
   * @returns 缓冲下标（始终落在 `[0, maxEntries)`）。
   */
  private indexAt(offset: number): number {
    const raw = this.cursor - 1 - offset
    return ((raw % this.maxEntries) + this.maxEntries) % this.maxEntries
  }

  /**
   * 归一化 `recent(limit)` 的条数。
   *
   * @param limit - 调用方给的上限。
   * @returns 实际可取条数（`0..size`）。
   */
  private resolveCount(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) return this.size
    const floored = Math.floor(limit)
    if (floored <= 0) return 0
    return Math.min(floored, this.size)
  }
}

/**
 * 构造内部记录副本：脱敏 + 数值兜底。
 *
 * 副本而不是引用，是为了让调用方在 `record()` 之后改写自己那个对象也不会污染观测面；
 * `at` 只在调用方给出非有限值时才回落到墙上时钟（正常情况下就是调用方传入的时刻）。
 *
 * @param entry - 调用方记录。
 * @returns 只含 `RecentCall` 字段的规整记录。
 */
function toStoredCall(entry: RecentCall): RecentCall {
  const at = finiteOr(entry.at, Date.now())
  const label = clampText(redactSecrets(entry.label), LABEL_MAX)
  const questionCount = finiteOr(entry.questionCount, 0)
  const inputTokens = finiteOr(entry.inputTokens, 0)
  const outputTokens = finiteOr(entry.outputTokens, 0)
  const latencyMs = finiteOr(entry.latencyMs, 0)
  const cached = entry.cached
  const ok = entry.ok

  if (entry.errorCode === undefined) {
    return { at, label, model: entry.model, questionCount, inputTokens, outputTokens, latencyMs, cached, ok }
  }
  return {
    at,
    label,
    model: entry.model,
    questionCount,
    inputTokens,
    outputTokens,
    latencyMs,
    cached,
    ok,
    errorCode: entry.errorCode,
  }
}

/**
 * 数值兜底：非有限值换成缺省，防止 NaN 渗进累计计量与浏览器展示。
 *
 * @param value - 候选数值。
 * @param fallback - 非有限时的替代值。
 * @returns 有限的数值。
 */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

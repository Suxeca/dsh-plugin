/**
 * 健康观测：把「判断正在失败」从静默事实变成一条日志 + 一个状态字段。
 *
 * 为什么单独一层：本插件所有失败路径都是刻意 fail-soft 的——工具只返回
 * `no-key`、分流 fail-open 返回 `undefined`、门禁一律放行。设计本身正确（一次
 * 网络抖动不该让 agent 无法执行任何命令），代价是插件可以在完全不可用的状态下
 * 运行很久而没人发现。真实发生过一次：credentials 服务的引用在装配期被缓存成
 * `undefined`，语义工具与任务分流全部失效，日志里一行都没有——最后是靠人工
 * 逐层翻代码才定位到的。
 *
 * 这一层**不改变任何失败语义**：调用方照旧拿到异常、照旧 fail-open。它只做两件事：
 * ① 在单一收口点记下最近失败、连续次数与时刻；② 按节流规则往日志吐一行。
 *
 * @module @suxeca/dsh-typesafe/host/health
 */
import { clampText, redactSecrets } from '../shared.ts'
import type { TypesafeHealth } from '../shared.ts'

/** 日志出口：只接脱敏后的单行文本（与传输层同一个约束，禁止传 payload 本体）。 */
export interface HealthLogger {
  warn(message: string): void
}

/** 装配参数：全是可替换的副作用 seam，便于离线测试。 */
export interface HealthOptions {
  readonly logger?: HealthLogger
  /** 时钟注入；缺省 `Date.now`。 */
  readonly now?: () => number
  /** 持续失败时重复告警的最小间隔（毫秒）。首次失败与错误类型变化不受此限。 */
  readonly warnIntervalMs?: number
  /** 单条告警的正文长度上限，避免把上游整段 HTML 错误页灌进日志。 */
  readonly messageMax?: number
}

/** 缺省重复告警间隔：一分钟一条，足够定位问题又不会淹掉日志。 */
const DEFAULT_WARN_INTERVAL_MS = 60_000

/** 缺省正文上限：够看清原因，又不至于把日志变成转储。 */
const DEFAULT_MESSAGE_MAX = 300

/**
 * 连续失败与节流告警的记账器。
 *
 * 语义边界（刻意如此）：只统计**判断工作路径**（evaluate 及其派生原语）的成败。
 * 设置页的手动探测 `probe()` **不计入**——探测是人在看结果的操作，它失败时
 * 当场就有人看见；反过来，若让探测成功去清零计数，一次「探测通、判断全废」
 * 的状态会被掩盖。
 */
export class HealthTracker {
  private readonly logger: HealthLogger | undefined

  private readonly now: () => number

  private readonly warnIntervalMs: number

  private readonly messageMax: number

  private consecutive = 0

  private lastErrorAt: number | undefined

  private lastErrorCode: string | undefined

  private lastErrorMessage: string | undefined

  private lastSuccessAt: number | undefined

  /** 上次告警的时刻：决定重复告警的节流窗口。 */
  private lastWarnAt: number | undefined

  /**
   * @param options - 日志出口、时钟与节流参数；全部可省（省了就是「只记账不喊」）。
   */
  constructor(options: HealthOptions = {}) {
    this.logger = options.logger
    this.now = options.now ?? (() => Date.now())
    this.warnIntervalMs = options.warnIntervalMs ?? DEFAULT_WARN_INTERVAL_MS
    this.messageMax = options.messageMax ?? DEFAULT_MESSAGE_MAX
  }

  /**
   * 记一次失败，并按节流规则决定要不要喊。
   *
   * 三条喊话条件：这是本轮第一次失败；失败分类变了（换了种坏法是新信息）；
   * 距上次告警已过一个间隔（问题还在，提醒别忘）。其余情况只累加计数——这正是
   * 门禁「每条危险命令问一次」与分流「每条消息问一次」不会淹掉日志的原因。
   *
   * @param code - 失败分类（`TypesafeErrorCode` 或 `unknown`）。
   * @param message - 原始消息；本方法内部脱敏并截断，**调用方不必先处理**。
   */
  fail(code: string, message: string): void {
    const at = this.now()
    const text = clampText(redactSecrets(message), this.messageMax)
    const previousCode = this.lastErrorCode
    const firstOfStreak = this.consecutive === 0

    this.consecutive += 1
    this.lastErrorAt = at
    this.lastErrorCode = code
    this.lastErrorMessage = text

    const codeChanged = previousCode !== undefined && previousCode !== code
    const intervalElapsed = this.lastWarnAt === undefined || at - this.lastWarnAt >= this.warnIntervalMs
    if (!firstOfStreak && !codeChanged && !intervalElapsed) return

    this.lastWarnAt = at
    const streak = this.consecutive > 1 ? `（连续失败 ${String(this.consecutive)} 次）` : ''
    this.logger?.warn(`typesafe 判断失败 [${code}]${streak}：${text}`)
  }

  /**
   * 记一次成功：连续计数归零，下次失败重新立刻告警。
   *
   * 恢复**不写日志**：warn 通道的含义是「有东西不对」，恢复不是。恢复这一事实由
   * `snapshot().degraded === false` 表达，设置页与健康检查直接读它。
   * 最近一次失败的信息也**刻意保留**——排障时最需要的正是「上次为什么坏」。
   */
  succeed(): void {
    this.consecutive = 0
    this.lastSuccessAt = this.now()
    this.lastWarnAt = undefined
  }

  /**
   * 取当前健康事实。
   *
   * @returns 不可变快照；可选字段在无值时**不出现**（信封直接给浏览器渲染，缺键比 undefined 干净）。
   */
  snapshot(): TypesafeHealth {
    return {
      degraded: this.consecutive > 0,
      consecutiveFailures: this.consecutive,
      ...this.lastErrorAt === undefined ? {} : { lastErrorAt: this.lastErrorAt },
      ...this.lastErrorCode === undefined ? {} : { lastErrorCode: this.lastErrorCode },
      ...this.lastErrorMessage === undefined ? {} : { lastErrorMessage: this.lastErrorMessage },
      ...this.lastSuccessAt === undefined ? {} : { lastSuccessAt: this.lastSuccessAt },
    }
  }

  /**
   * 只更新摘要，不动连续计数，也不告警。
   *
   * 用途：一次逻辑操作由多次子调用组成时（例如 rerank 的分块），子调用已经各自
   * 记过账并各自有机会告警，这里补一条更完整的摘要即可——若在这里再 `fail()` 一次，
   * 「连续失败 N 次」会被注水，而那个数字是给人看的诊断量，不该虚高。
   *
   * @param code - 摘要使用的分类。
   * @param message - 原始消息；本方法内部脱敏并截断。
   */
  note(code: string, message: string): void {
    this.lastErrorAt = this.now()
    this.lastErrorCode = code
    this.lastErrorMessage = clampText(redactSecrets(message), this.messageMax)
  }

  /**
   * 单行摘要，格式 `code: message`——与设置页既有的 `lastError` 文案同形。
   *
   * @returns 摘要文本；从未失败过则 undefined。
   */
  summary(): string | undefined {
    if (this.lastErrorCode === undefined || this.lastErrorMessage === undefined) return undefined
    return `${this.lastErrorCode}: ${this.lastErrorMessage}`
  }
}

/**
 * @suxeca/dsh-typesafe — host 侧本地应答缓存（契约 B / cache）。
 *
 * 为什么要这一层：System One 是按 token 计费且带网络往返的语义判断，而实际调用里
 * 有大量**语义完全相同、只是对象字面量键序不同**的 payload（同一段 state、同一组
 * 问题）。直接把 payload 交给 JSON.stringify 会生成不同字符串，缓存永远打不中，
 * 于是钱和延迟都白花。所以键必须经过「递归排序 object key」的稳定序列化再取 sha256：
 * 数组顺序有意义（问题顺序、判据顺序都是语义的一部分）必须保留，object 键序无意义
 * 必须归一。
 *
 * 另外两个边界：TTL（判断结果会随服务端模型版本漂移，不能无限期复用）与
 * maxEntries（宿主进程常驻，缓存必须封顶，用 Map 插入序做 LRU 淘汰）。
 *
 * 本模块是纯内存的：无网络、无磁盘、无模块级可变全局状态；时间通过 `now` 注入，
 * 让 TTL 与 LRU 次序能在测试里被精确推进而不是真的等。
 *
 * @module @suxeca/dsh-typesafe/host/cache
 */

import { createHash } from 'node:crypto'

import type { EvalPayload, SystemOneResponse } from '../shared.ts'

/** 缓存装配参数：预算 + 可注入时钟。 */
export interface CacheOptions {
  /** 条目存活毫秒数；`<= 0` 表示关闭缓存（`set` 整体 no-op）。 */
  readonly ttlMs: number
  /** 条目数上限；构造时取 `Math.max(1, ...)`，至少为 1。 */
  readonly maxEntries: number
  /** 取当前时间的 seam；缺省 `Date.now`。测试注入即可精确推进 TTL。 */
  readonly now?: () => number
}

/** 内部条目：应答本体 + 写入时刻（用于 TTL 判定）。不对外导出。 */
interface CacheEntry {
  readonly value: SystemOneResponse
  readonly storedAt: number
}

/**
 * 键顺序无关的规范化 JSON（递归排序 object key）；数组顺序有意义，不改。
 *
 * 与 `JSON.stringify` 保持一致的取舍：对象里值为 `undefined` 的键直接省略，
 * 数组里的 `undefined` 写成 `null`，非有限数字写成 `null`。循环引用会抛
 * `TypeError`——静默产出不确定字符串会让缓存键发生碰撞，宁可响亮地失败。
 *
 * @param value - 任意待规范化值。
 * @returns 稳定的紧凑 JSON 文本。
 * @throws {TypeError} 输入包含循环引用时抛出。
 */
export function stableStringify(value: unknown): string {
  return canonicalize(value, new Set<object>())
}

/**
 * 递归规范化实现。
 *
 * @param value - 当前节点。
 * @param seen - 当前递归路径上的对象集合（只用于查环，允许 DAG 共享引用）。
 * @returns 规范化后的文本。
 */
function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      // 与 JSON 一致：NaN / ±Infinity 都是 null，避免 "NaN" 这种非法 JSON 片段。
      return Number.isFinite(value) ? JSON.stringify(value) : 'null'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'bigint':
      return JSON.stringify(value.toString())
    case 'undefined':
      // 数组元素位置的 undefined 与 JSON 一致写成 null；对象属性位置由调用方省略。
      return 'null'
    case 'symbol':
    case 'function':
      return 'null'
    default:
      break
  }

  const object = value as object
  if (object instanceof Date) return JSON.stringify(object.toISOString())

  if (seen.has(object)) throw new TypeError('stableStringify: 循环引用无法规范化')
  seen.add(object)

  try {
    if (Array.isArray(object)) {
      const items = object.map((item) => canonicalize(item, seen))
      return `[${items.join(',')}]`
    }

    const record = object as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      // 与 JSON.stringify 一致：对象里 undefined 值的键不出现，保证 {a:undefined} 与 {} 同键。
      if (item === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalize(item, seen)}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(object)
  }
}

/**
 * 单进程内存 LRU 应答缓存。
 *
 * 语义要点：
 * - `get` 命中且未过期才计入 hits，并把该键移到 Map 末尾（最近使用）；过期条目
 *   视为未命中并当场删除，避免过期数据继续占内存。
 * - `set` 在 `ttlMs <= 0` 时整体 no-op（关闭缓存不是「存了但立刻过期」）。
 * - 超出 `maxEntries` 从 Map 头部（最久未用）淘汰，直到不超限。
 *
 * 实例状态全部在字段上，没有模块级可变全局状态。
 */
export class ResponseCache {
  /** 条目存活毫秒数；`<= 0` 时 `set` 为空操作。 */
  private readonly ttlMs: number
  /** 条目数上限，保证 >= 1。 */
  private readonly maxEntries: number
  /** 取当前时间的 seam。 */
  private readonly now: () => number
  /** 键 → 条目；Map 迭代序即插入序，用于 LRU。 */
  private readonly entries = new Map<string, CacheEntry>()
  /** 未过期命中次数（累计，`clear()` 不重置）。 */
  private hitCount = 0
  /** 未命中次数（含过期条目，累计，`clear()` 不重置）。 */
  private missCount = 0

  /**
   * @param options - TTL、容量与可选时钟注入。
   */
  constructor(options: CacheOptions) {
    // 非有限 TTL 会让 `age >= ttl` 恒为 false（永不过期），按关闭缓存处理更安全。
    this.ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 0
    const requested = Number.isFinite(options.maxEntries) ? Math.floor(options.maxEntries) : 1
    this.maxEntries = Math.max(1, requested)
    this.now = options.now ?? Date.now
  }

  /**
   * 计算缓存键：`sha256(endpoint + '\n' + model + '\n' + stableStringify(payload 去掉 model 字段))`。
   *
   * `model` 单独入键而不是随 payload 序列化，是因为调用方常用 `options.model`
   * 覆盖模型（payload 本体不变），两者必须落到不同键上；同时 payload 里残留的
   * `model` 字段被剥掉，避免同一请求因字段有无而分成两个键。
   *
   * `endpoint`（baseUrl）同样入键：切到自建代理或换端点后，答案的来源变了，
   * 键里不带端点就会一直命中旧端点的结论。
   *
   * @param model - 本次实际请求的模型名。
   * @param payload - System One 请求体。
   * @param endpoint - 本次请求的端点（缺省空串，调用方不传时退化为纯 model+payload 键）。
   * @returns 十六进制 sha256 摘要。
   */
  static keyOf(model: string, payload: EvalPayload, endpoint = ''): string {
    const canonical = stableStringify({ state: payload.state, questions: payload.questions })
    return createHash('sha256').update(`${endpoint}\n${model}\n${canonical}`, 'utf8').digest('hex')
  }

  /**
   * 读取缓存；命中则刷新 LRU 次序。
   *
   * 返回的是**副本**：服务实例是总线上的共享单例，任何消费方（`judge()` 的调用方、
   * 工具、门禁）如果就地把 answers 改掉，会连缓存里那份一起改掉，
   * 之后所有命中者都拿到被污染的数据。深拷贝一次的成本远低于这种静默错误。
   *
   * @param key - `keyOf` 产出的键（或任意自定义键）。
   * @returns 未过期则返回应答副本；缺失或已过期返回 `undefined`（过期条目被删除）。
   */
  get(key: string): SystemOneResponse | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      this.missCount += 1
      return undefined
    }

    if (this.now() - entry.storedAt >= this.ttlMs) {
      this.entries.delete(key)
      this.missCount += 1
      return undefined
    }

    // Map 对已存在的键 set 不会改变插入位置，必须先删再插才能把它移到「最近使用」端。
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.hitCount += 1
    return structuredClone(entry.value)
  }

  /**
   * 写入缓存；`ttlMs <= 0` 时整体 no-op。
   *
   * @param key - 缓存键。
   * @param value - 服务端应答本体（按引用保存：写入方在 `set` 之后不再改它；
   *   读取方通过 `get` 拿到副本，因此缓存内容不会被下游改写）。
   */
  set(key: string, value: SystemOneResponse): void {
    if (this.ttlMs <= 0) return

    // 覆盖写也要先删再插：否则键会保留旧插入位置，LRU 会把「刚更新过的热点」先淘汰。
    this.entries.delete(key)
    this.entries.set(key, { value, storedAt: this.now() })
    this.evictOverflow()
  }

  /**
   * 当前缓存观测计数。
   *
   * `entries` 是实时条目数，`hits` / `misses` 是实例生命周期内的累计值；
   * `clear()` 只清条目，不清计数（设置页需要看到「缓存到底有没有用」的长期比率）。
   *
   * @returns 条目数与累计命中/未命中次数。
   */
  stats(): { readonly entries: number; readonly hits: number; readonly misses: number } {
    return { entries: this.entries.size, hits: this.hitCount, misses: this.missCount }
  }

  /**
   * 清空全部条目（例如设置变更后放弃旧 TTL 下的判断结果）。
   *
   * 只清条目，不重置 `hits` / `misses`：计数是对外观测口径，清缓存不该让历史归零。
   */
  clear(): void {
    this.entries.clear()
  }

  /**
   * 从最久未用端淘汰，直到条目数不超过 `maxEntries`。
   */
  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) return
      this.entries.delete(oldest.value)
    }
  }
}

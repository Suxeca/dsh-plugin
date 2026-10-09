/**
 * 观测层单元测试（CallLog）。
 *
 * 这一层不碰网络，但决定「设置页看到的数字是不是真的」：环形缓冲回绕后明细是否错位、
 * 累计计量是否随丢旧明细而回退、缓存命中是否把 token 总量算成真实花费。
 * 这些错误不会让任何请求失败，只会让人做出错误的判断，所以必须钉住。
 *
 * @module @suxeca/dsh-typesafe/tests/stats
 */
import { describe, expect, it } from 'vitest'
import { CallLog } from '../src/host/stats.ts'
import type { RecentCall } from '../src/shared.ts'

/** 造一条记录；默认是一次成功的非缓存调用。 */
function call(overrides: Partial<RecentCall> = {}): RecentCall {
  return {
    at: 1_000,
    label: 'ctx.typesafe',
    model: 'jev-1.13.0',
    questionCount: 1,
    inputTokens: 10,
    outputTokens: 5,
    latencyMs: 12,
    cached: false,
    ok: true,
    ...overrides,
  }
}

describe('环形明细', () => {
  it('回绕后仍按最新在前返回，且不重复不丢位', () => {
    const log = new CallLog({ maxEntries: 3 })
    for (let index = 1; index <= 5; index += 1) log.record(call({ at: index, label: `l${String(index)}` }))

    expect(log.recent().map(entry => entry.label)).toEqual(['l5', 'l4', 'l3'])
    expect(log.recent(2).map(entry => entry.label)).toEqual(['l5', 'l4'])
    expect(log.snapshot().recent).toHaveLength(3)
  })

  it('未填满时只返回已写入的条数，limit 超出不报错', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call({ label: 'only' }))

    expect(log.recent().map(entry => entry.label)).toEqual(['only'])
    expect(log.recent(50).map(entry => entry.label)).toEqual(['only'])
    expect(log.recent(0)).toEqual([])
  })
})

describe('累计计量', () => {
  it('明细被环形丢弃后，累计数不回退', () => {
    const log = new CallLog({ maxEntries: 2 })
    for (let index = 0; index < 5; index += 1) log.record(call())

    const totals = log.totals()
    expect(totals.calls).toBe(5)
    expect(totals.inputTokens).toBe(50)
    expect(totals.outputTokens).toBe(25)
  })

  it('缓存命中不加 token（那不是这次的花费），但计入命中率与调用数', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call({ cached: false, inputTokens: 10, outputTokens: 5 }))
    log.record(call({ cached: true, inputTokens: 10, outputTokens: 5 }))

    const totals = log.totals()
    expect(totals.calls).toBe(2)
    expect(totals.cacheHits).toBe(1)
    expect(totals.inputTokens).toBe(10)
    expect(totals.outputTokens).toBe(5)
  })

  it('失败计数与最近失败摘要都只认 ok === false', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call())
    log.record(call({ ok: false, errorCode: 'rate-limit', label: 'preflight:bash' }))
    log.record(call({ ok: false, errorCode: 'timeout', label: 'tool:typesafe_eval' }))

    expect(log.totals().failures).toBe(2)
    expect(log.lastError()).toBe('timeout: tool:typesafe_eval')
    expect(log.snapshot().lastError).toBe('timeout: tool:typesafe_eval')
  })

  it('没有失败时没有失败摘要', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call())
    expect(log.lastError()).toBeUndefined()
    expect(log.snapshot().lastError).toBeUndefined()
  })
})

describe('记录净化', () => {
  it('标签先脱敏再截断，密钥形状的文本不会进入观测面', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call({ label: `Bearer apikey_live_should_not_survive ${'x'.repeat(400)}` }))

    const stored = log.recent()[0]
    expect(stored?.label).not.toContain('apikey_live_should_not_survive')
    // LABEL_MAX = 200：防止一个失控的标签把状态响应撑大。
    expect(stored?.label.length).toBeLessThanOrEqual(200)
  })

  it('NaN / Infinity 被兜成 0，不会永久污染累计计量', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call({ inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY, latencyMs: Number.NaN }))

    expect(log.totals().inputTokens).toBe(0)
    expect(log.totals().outputTokens).toBe(0)
    expect(log.recent()[0]?.latencyMs).toBe(0)
  })

  it('明细里只有 RecentCall 字段，绝不保存 state / instructions 原文', () => {
    const log = new CallLog({ maxEntries: 10 })
    log.record(call({ label: 'ctx.typesafe' }))

    expect(Object.keys(log.recent()[0] ?? {}).sort()).toEqual([
      'at', 'cached', 'inputTokens', 'label', 'latencyMs', 'model', 'ok', 'outputTokens', 'questionCount',
    ])
  })
})

/**
 * 健康记账单元测试：节流规则与快照语义。
 *
 * 为什么值得单测：这一层是「插件悄悄挂掉」的唯一对冲，它自己如果坏了会以两种方式
 * 骗人——**太吵**（门禁每条命令、分流每条消息都喊一次，日志被淹，于是没人再看）
 * 或**太哑**（该喊的时候没喊，于是又回到今天这种「坏了很久没人知道」）。
 * 所以测试围绕三件事：什么时候喊、喊几次、快照说什么。时钟全程注入，不睡真时间。
 *
 * @module @suxeca/dsh-typesafe/tests/health
 */
import { describe, expect, it } from 'vitest'

import { HealthTracker } from '../src/host/health.ts'

/** 记录型日志桩 + 可控时钟。 */
function harness(options: { warnIntervalMs?: number } = {}) {
  const warnings: string[] = []
  let now = 1_000_000
  const tracker = new HealthTracker({
    logger: { warn: (message: string) => { warnings.push(message) } },
    now: () => now,
    ...options.warnIntervalMs === undefined ? {} : { warnIntervalMs: options.warnIntervalMs },
  })
  return {
    tracker,
    warnings,
    /** 推进注入的时钟。 */
    advance(ms: number) { now += ms },
    /** 当前注入时钟读数。 */
    get now() { return now },
  }
}

describe('HealthTracker.fail', () => {
  it('首次失败立刻告警，并在消息里带上分类与正文', () => {
    const { tracker, warnings } = harness()

    tracker.fail('no-key', '未配置 TYPESAFE_API_KEY')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no-key')
    expect(warnings[0]).toContain('未配置 TYPESAFE_API_KEY')
    expect(tracker.snapshot().consecutiveFailures).toBe(1)
    expect(tracker.snapshot().degraded).toBe(true)
  })

  it('节流窗口内持续失败只累加计数，不重复喊', () => {
    const { tracker, warnings } = harness({ warnIntervalMs: 60_000 })

    tracker.fail('rate-limit', '429')
    tracker.fail('rate-limit', '429')
    tracker.fail('rate-limit', '429')

    expect(warnings).toHaveLength(1)
    expect(tracker.snapshot().consecutiveFailures).toBe(3)
  })

  it('窗口过去后重新告警，并说明已经连续失败几次', () => {
    const { tracker, warnings, advance } = harness({ warnIntervalMs: 60_000 })

    tracker.fail('network', '连接被重置')
    advance(60_000)
    tracker.fail('network', '连接被重置')

    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('连续失败 2 次')
  })

  it('失败分类变了立刻告警——换了种坏法是新信息，不该被上一类的节流压住', () => {
    const { tracker, warnings } = harness({ warnIntervalMs: 60_000 })

    tracker.fail('timeout', '首次超时')
    tracker.fail('auth', '401')

    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('auth')
  })

  it('消息里的密钥被脱敏，且长消息被截断', () => {
    const { tracker, warnings } = harness()

    tracker.fail('auth', `401 unauthorized: Bearer apikey_deadbeefdeadbeefdeadbeef ${'x'.repeat(5000)}`)

    expect(warnings[0]).not.toContain('apikey_deadbeefdeadbeefdeadbeef')
    expect(warnings[0]!.length).toBeLessThan(600)
  })

  it('没有日志出口时只记账、不抛错', () => {
    const tracker = new HealthTracker()
    expect(() => { tracker.fail('network', 'x') }).not.toThrow()
    expect(tracker.snapshot().degraded).toBe(true)
  })
})

describe('HealthTracker.succeed', () => {
  it('成功一次即恢复，并让下一次失败重新立刻告警', () => {
    const { tracker, warnings } = harness({ warnIntervalMs: 60_000 })

    tracker.fail('network', '断了')
    tracker.succeed()
    expect(tracker.snapshot().degraded).toBe(false)
    expect(tracker.snapshot().consecutiveFailures).toBe(0)

    // 刚恢复就又失败：不应被上一次的节流窗口压住。
    tracker.fail('network', '又断了')
    expect(warnings).toHaveLength(2)
    expect(tracker.snapshot().consecutiveFailures).toBe(1)
  })

  it('保留「上次为什么失败」——恢复不代表那段历史没有排障价值', () => {
    const { tracker } = harness()

    tracker.fail('no-key', '未配置密钥')
    tracker.succeed()

    const snapshot = tracker.snapshot()
    expect(snapshot.degraded).toBe(false)
    expect(snapshot.lastErrorCode).toBe('no-key')
    expect(snapshot.lastErrorMessage).toBe('未配置密钥')
  })
})

describe('HealthTracker.note', () => {
  it('只更新摘要：不涨连续计数，也不告警', () => {
    const { tracker, warnings } = harness()
    tracker.fail('network', '分块失败')
    const before = tracker.snapshot().consecutiveFailures

    tracker.note('rerank', '1/3 块失败，返回其余 2 个候选')

    // 子调用已经记过账，聚合摘要不该把它再算一遍（那个数字是给人看的诊断量）。
    expect(tracker.snapshot().consecutiveFailures).toBe(before)
    expect(warnings).toHaveLength(1)
    expect(tracker.summary()).toBe('rerank: 1/3 块失败，返回其余 2 个候选')
  })

  it('摘要同样脱敏并截断', () => {
    const { tracker } = harness()

    tracker.note('auth', `Bearer apikey_secretsecretsecret ${'y'.repeat(1_000)}`)

    expect(tracker.summary()).not.toContain('apikey_secretsecretsecret')
    expect(tracker.summary()!.length).toBeLessThan(400)
  })
})

describe('HealthTracker.snapshot / summary', () => {
  it('从未失败过时不出现任何失败键，degraded 为 false', () => {
    const { tracker } = harness()

    const snapshot = tracker.snapshot()

    expect(snapshot.degraded).toBe(false)
    expect(snapshot.consecutiveFailures).toBe(0)
    expect('lastErrorCode' in snapshot).toBe(false)
    expect('lastErrorMessage' in snapshot).toBe(false)
    expect('lastErrorAt' in snapshot).toBe(false)
    expect(tracker.summary()).toBeUndefined()
  })

  it('记录成功时刻，summary 与设置页既有格式同形', () => {
    const { tracker } = harness()

    tracker.succeed()
    tracker.fail('malformed', 'answers 缺失')

    expect(tracker.snapshot().lastSuccessAt).toBe(1_000_000)
    expect(tracker.summary()).toBe('malformed: answers 缺失')
  })
})

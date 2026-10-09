/**
 * @suxeca/dsh-typesafe — 本地应答缓存单元测试（契约 E / cache）。
 *
 * 为什么这样测：缓存的三条语义都只能靠**推进时钟**和**观察访问次序**来验证——
 * 键是否与字段书写顺序无关（否则永远打不中，白花钱）、TTL 到点是否真的失效、
 * 超过容量淘汰的是不是最久未用的那一条。这些都不该靠真实时间或真实网络，
 * 所以时钟用 `now` seam 注入并在断言中精确步进，缓存实例每次新建、互不污染。
 *
 * @module @suxeca/dsh-typesafe/tests/cache.spec
 */

import { describe, expect, it } from 'vitest'

import type { EvalPayload, SystemOneResponse } from '../src/shared.ts'
import { ResponseCache, stableStringify } from '../src/host/cache.ts'

/** 可精确推进的注入时钟。 */
interface Clock {
  readonly now: () => number
  readonly advance: (ms: number) => void
}

/**
 * 造一个从 `start` 开始的假时钟。
 *
 * @param start - 起始毫秒时间戳。
 * @returns 读时间与推进时间两个操作。
 */
function fakeClock(start = 0): Clock {
  let current = start
  return { now: () => current, advance: (ms: number) => { current += ms } }
}

/**
 * 造一个形状合法的应答，`model` 用来在断言里区分条目。
 *
 * @param model - 应答里的模型名。
 * @returns System One 应答。
 */
function responseOf(model: string): SystemOneResponse {
  return {
    model,
    answers: { q: { type: 'noul', noul: 0.5 } },
    usage: { input_tokens: 3, output_tokens: 1 },
  }
}

const PAYLOAD: EvalPayload = {
  state: { text: 'delete /tmp/x', nested: { b: 2, a: 1 } },
  questions: { q: { type: 'noul', instructions: 'dangerous?' } },
}

/** 与 PAYLOAD 语义相同，但对象字面量的键序全部颠倒。 */
const PAYLOAD_REORDERED: EvalPayload = {
  questions: { q: { instructions: 'dangerous?', type: 'noul' } },
  state: { nested: { a: 1, b: 2 }, text: 'delete /tmp/x' },
}

/** 只改了 state 内容的 payload：必须落到不同的键上。 */
const PAYLOAD_OTHER_STATE: EvalPayload = {
  state: { text: 'rm -rf /', nested: { b: 2, a: 1 } },
  questions: { q: { type: 'noul', instructions: 'dangerous?' } },
}

describe('stableStringify', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const value = { b: 1, a: { d: 2, c: [3, { f: 6, e: 5 }] } }

    expect(stableStringify(value)).toBe('{"a":{"c":[3,{"e":5,"f":6}],"d":2},"b":1}')
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('keeps array order meaningful', () => {
    expect(stableStringify([1, 2, 3])).toBe('[1,2,3]')
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]))
  })
})

describe('ResponseCache.keyOf', () => {
  it('is independent of object key order', () => {
    const ordered = ResponseCache.keyOf('jev-latest', PAYLOAD)
    const reordered = ResponseCache.keyOf('jev-latest', PAYLOAD_REORDERED)

    expect(ordered).toBe(reordered)
    expect(ordered).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes with the state and with the model', () => {
    const base = ResponseCache.keyOf('jev-latest', PAYLOAD)

    expect(ResponseCache.keyOf('jev-latest', PAYLOAD_OTHER_STATE)).not.toBe(base)
    expect(ResponseCache.keyOf('jev-other', PAYLOAD)).not.toBe(base)
  })

  it('strips a payload-level model in favour of the explicit one', () => {
    const withoutModel = ResponseCache.keyOf('jev-latest', PAYLOAD)
    const withModel = ResponseCache.keyOf('jev-latest', { ...PAYLOAD, model: 'ignored-model' })

    expect(withModel).toBe(withoutModel)
  })
})

describe('ResponseCache', () => {
  it('returns a fresh entry and expires it after the ttl', () => {
    const clock = fakeClock(0)
    const cache = new ResponseCache({ ttlMs: 100, maxEntries: 4, now: clock.now })
    const stored = responseOf('jev-1.13.0')
    const key = ResponseCache.keyOf('jev-latest', PAYLOAD)

    cache.set(key, stored)
    clock.advance(50)
    expect(cache.get(key)).toEqual(stored)

    clock.advance(51)
    expect(cache.get(key)).toBeUndefined()
    expect(cache.stats().entries).toBe(0)
  })

  it('counts hits only while fresh and misses otherwise', () => {
    const clock = fakeClock(0)
    const cache = new ResponseCache({ ttlMs: 100, maxEntries: 4, now: clock.now })

    expect(cache.get('absent')).toBeUndefined()
    cache.set('k', responseOf('jev-1.13.0'))
    expect(cache.get('k')).toEqual(responseOf('jev-1.13.0'))

    clock.advance(101)
    expect(cache.get('k')).toBeUndefined()

    expect(cache.stats()).toEqual({ entries: 0, hits: 1, misses: 2 })
  })

  it('stores nothing when the ttl is not positive', () => {
    const clock = fakeClock(0)

    for (const ttlMs of [0, -5]) {
      const cache = new ResponseCache({ ttlMs, maxEntries: 4, now: clock.now })
      cache.set('k', responseOf('jev-1.13.0'))

      expect(cache.get('k')).toBeUndefined()
      expect(cache.stats().entries).toBe(0)
    }
  })

  it('evicts the least recently used entry first', () => {
    const clock = fakeClock(0)
    const cache = new ResponseCache({ ttlMs: 1_000, maxEntries: 2, now: clock.now })

    cache.set('a', responseOf('a'))
    cache.set('b', responseOf('b'))
    // 读一次 a：它成为最近使用，b 变成最久未用。
    expect(cache.get('a')?.model).toBe('a')

    cache.set('c', responseOf('c'))

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')?.model).toBe('a')
    expect(cache.get('c')?.model).toBe('c')
    expect(cache.stats().entries).toBe(2)
  })

  it('never holds fewer than one entry', () => {
    const clock = fakeClock(0)
    const cache = new ResponseCache({ ttlMs: 1_000, maxEntries: 0, now: clock.now })

    cache.set('a', responseOf('a'))
    cache.set('b', responseOf('b'))

    expect(cache.stats().entries).toBe(1)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')?.model).toBe('b')
  })

  it('drops every entry on clear', () => {
    const clock = fakeClock(0)
    const cache = new ResponseCache({ ttlMs: 1_000, maxEntries: 4, now: clock.now })

    cache.set('a', responseOf('a'))
    cache.set('b', responseOf('b'))
    cache.clear()

    expect(cache.stats().entries).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('hands out a copy, so a consumer cannot poison the cache by mutating an answer', () => {
    const clock = fakeClock(0)
    const cache = new ResponseCache({ ttlMs: 1_000, maxEntries: 4, now: clock.now })
    const original = responseOf('jev-1.13.0')
    cache.set('k', original)

    const first = cache.get('k')
    expect(first).toBeDefined()
    // 就地改写一个答案（模拟下游插件对 judge() 结果的加工）。
    ;(first?.answers as Record<string, unknown>).q = { type: 'noul', noul: 0 }

    const second = cache.get('k')
    expect(second?.answers.q).toEqual({ type: 'noul', noul: 0.5 })
    // 写入方持有的那份也不该被影响。
    expect(original.answers.q).toEqual({ type: 'noul', noul: 0.5 })
  })

  it('separates keys per endpoint, so switching baseUrl cannot reuse the old endpoint answers', () => {
    const official = ResponseCache.keyOf('jev-latest', PAYLOAD, 'https://api.typesafe.ai')
    const proxy = ResponseCache.keyOf('jev-latest', PAYLOAD, 'https://proxy.local')
    const legacy = ResponseCache.keyOf('jev-latest', PAYLOAD)

    expect(official).not.toBe(proxy)
    expect(legacy).not.toBe(official)
    // 同一端点 + 同一载荷必须稳定落到同一个键上。
    expect(ResponseCache.keyOf('jev-latest', PAYLOAD_REORDERED, 'https://api.typesafe.ai')).toBe(official)
  })
})

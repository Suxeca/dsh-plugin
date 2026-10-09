import { describe, expect, it, vi } from 'vitest'
import { readExpressionState, writeExpressionMode, writeExpressionSettings, parseExpressionState } from '../src/client/transport.ts'
import type { RequestFetch } from '../src/client/transport.ts'
import { ROUTE_STATE } from '../src/shared.ts'

const state = { sessionId: 's1', mode: 'ste', language: 'en', revision: 1, updatedAt: 1234, ruleVersion: 'v1' }
function mockFetch(body: unknown, status = 200) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }))
  return { mock, fetch: mock as RequestFetch }
}

describe('expression transport', () => {
  it('GET uses exact route, no cache, same-origin credentials, and cancellation', async () => {
    const fixture = mockFetch({ ok: true, data: state })
    const controller = new AbortController()
    expect(await readExpressionState('s1', controller.signal, fixture.fetch)).toEqual(state)
    expect(fixture.mock).toHaveBeenCalledWith(`${ROUTE_STATE}?sessionId=s1`, expect.objectContaining({
      method: 'GET', signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
    }))
  })
  it('POST returns only host-confirmed state and transmits only sessionId/mode', async () => {
    const fixture = mockFetch({ ok: true, data: state })
    const controller = new AbortController()
    expect(await writeExpressionMode('s1', 'ste', controller.signal, fixture.fetch)).toEqual(state)
    expect(fixture.mock).toHaveBeenCalledWith(ROUTE_STATE, expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ sessionId: 's1', mode: 'ste' }), credentials: 'same-origin', cache: 'no-store',
    }))
  })
  it.each([
    ['default', 'auto'], ['default', 'zh'], ['default', 'en'],
    ['ste', 'auto'], ['ste', 'zh'], ['ste', 'en'],
  ])('accepts independent style/language combination %s + %s', (mode, language) => {
    const data = { ...state, mode, language }
    expect(parseExpressionState(data, 's1')).toEqual(data)
  })
  it.each([{ language: 'zh' as const }, { mode: 'default' as const }, { language: 'auto' as const, mode: 'ste' as const }])('sends only changed setting dimensions: %j', async patch => {
    const fixture = mockFetch({ ok: true, data: state })
    const controller = new AbortController()
    expect(await writeExpressionSettings('s1', patch, controller.signal, fixture.fetch)).toEqual(state)
    expect(fixture.mock).toHaveBeenCalledWith(ROUTE_STATE, expect.objectContaining({
      method: 'POST', signal: controller.signal, body: JSON.stringify({ sessionId: 's1', ...patch }),
      headers: { 'content-type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
    }))
  })
  it.each([null, [], {}, { mode: 'wrong' }, { language: 'fr' }, { language: 'zh', mode: null },
    { language: 'zh', mode: undefined }, { language: 'zh', extra: true }, { sessionId: 's1' }])('rejects invalid local patch before fetching: %j', async patch => {
    const fixture = mockFetch({ ok: true, data: state })
    await expect(writeExpressionSettings('s1', patch as never, undefined, fixture.fetch)).rejects.toThrow('表达设置无效')
    expect(fixture.mock).not.toHaveBeenCalled()
  })
  it('refuses a legacy state lacking language and instructs refreshing the page', () => {
    const { language: _unused, ...legacy } = state
    expect(() => parseExpressionState(legacy, 's1')).toThrow('刷新页面')
  })
  it('rejects HTTP errors even when their envelope says success', async () => {
    const fixture = mockFetch({ ok: true, data: state }, 500)
    await expect(readExpressionState('s1', undefined, fixture.fetch)).rejects.toThrow('HTTP 500')
  })
  it('shows a bounded host error without claiming it saved', async () => {
    const fixture = mockFetch({ ok: false, error: '保存暂不可用' }, 500)
    await expect(writeExpressionMode('s1', 'ste', undefined, fixture.fetch)).rejects.toThrow('保存暂不可用')
  })
  it.each([null, [], 'text', {}, { ok: 'true', data: state }, { ok: false }, { ok: true }])('rejects malformed envelope %j', async body => {
    const fixture = mockFetch(body)
    await expect(readExpressionState('s1', undefined, fixture.fetch)).rejects.toThrow()
  })
  it.each([
    null, [], { ...state, sessionId: 's2' }, { ...state, mode: 'unknown' },
    { ...state, revision: -1 }, { ...state, revision: 1.2 }, { ...state, revision: '1' },
    { ...state, updatedAt: -1 }, { ...state, updatedAt: 'now' }, { ...state, ruleVersion: '' },
    { ...state, ruleVersion: 1 }, { ...state, unexpected: '/local/path' },
    { sessionId: 's1', mode: 'ste' }, { ...state, language: 'fr' }, { ...state, language: null },
    { ...state, language: '' }, { ...state, language: 1 },
  ])('rejects incomplete, invalid or wrong-session state %j', async data => {
    const fixture = mockFetch({ ok: true, data })
    await expect(readExpressionState('s1', undefined, fixture.fetch)).rejects.toThrow('状态无效')
  })
  it('allows an unmodified default state with null timestamp', () => {
    const initial = { ...state, mode: 'default', revision: 0, updatedAt: null }
    expect(parseExpressionState(initial, 's1')).toEqual(initial)
  })
  it('rejects non-finite numbers and whitespace rule version', () => {
    expect(() => parseExpressionState({ ...state, revision: Infinity }, 's1')).toThrow()
    expect(() => parseExpressionState({ ...state, updatedAt: NaN }, 's1')).toThrow()
    expect(() => parseExpressionState({ ...state, ruleVersion: '   ' }, 's1')).toThrow()
  })
  it('rejects invalid local session identifiers before fetching', async () => {
    const fixture = mockFetch({ ok: true, data: state })
    await expect(readExpressionState('../private', undefined, fixture.fetch)).rejects.toThrow('会话标识无效')
    expect(fixture.mock).not.toHaveBeenCalled()
  })
  it('reports invalid JSON instead of accepting an HTTP 200', async () => {
    const fetchImpl = vi.fn(async () => new Response('not JSON', { status: 200 })) as RequestFetch
    await expect(readExpressionState('s1', undefined, fetchImpl)).rejects.toThrow('有效 JSON')
  })
  it('preserves cancellation and network failures', async () => {
    const controller = new AbortController()
    controller.abort()
    const abort = new DOMException('cancelled', 'AbortError')
    const fetchImpl = vi.fn(async () => { throw abort }) as RequestFetch
    await expect(readExpressionState('s1', controller.signal, fetchImpl)).rejects.toBe(abort)
    const network = new Error('network unavailable')
    const failing = vi.fn(async () => { throw network }) as RequestFetch
    await expect(writeExpressionMode('s1', 'ste', undefined, failing)).rejects.toBe(network)
  })
})

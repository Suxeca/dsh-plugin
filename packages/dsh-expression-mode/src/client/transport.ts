import { ROUTE_STATE, isExpressionMode, isExpressionLanguage, isExpressionPatch, usableSessionId } from '../shared.ts'
import type { ExpressionMode, ExpressionPatch, ExpressionState } from '../shared.ts'

export type RequestFetch = typeof fetch
const STATE_KEYS = ['sessionId', 'mode', 'language', 'revision', 'updatedAt', 'ruleVersion']

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Server confirmation must be complete and belong to the requested session. */
export function parseExpressionState(value: unknown, sessionId: string): ExpressionState {
  if (!object(value) || Object.keys(value).length !== STATE_KEYS.length
    || STATE_KEYS.some(key => !Object.hasOwn(value, key))
    || value.sessionId !== sessionId || !usableSessionId(value.sessionId)
    || !isExpressionMode(value.mode) || !isExpressionLanguage(value.language)
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !(value.updatedAt === null || (typeof value.updatedAt === 'number'
      && Number.isFinite(value.updatedAt) && value.updatedAt >= 0))
    || typeof value.ruleVersion !== 'string' || value.ruleVersion.trim() === '') {
    throw new Error('服务器返回的表达方式状态无效，请刷新页面后重试')
  }
  return {
    sessionId: value.sessionId, mode: value.mode, language: value.language, revision: value.revision,
    updatedAt: value.updatedAt, ruleVersion: value.ruleVersion,
  }
}

async function request(
  sessionId: string, init: RequestInit, fetchImpl: RequestFetch, url: string,
): Promise<ExpressionState> {
  if (!usableSessionId(sessionId)) throw new Error('会话标识无效')
  const response = await fetchImpl(url, { ...init, credentials: 'same-origin', cache: 'no-store' })
  let body: unknown
  try { body = await response.json() } catch {
    throw new Error(response.ok ? '服务器未返回有效 JSON，请重试' : `请求失败（HTTP ${response.status}），请重试`)
  }
  if (!response.ok || !object(body) || body.ok !== true) {
    const detail = object(body) && body.ok === false && typeof body.error === 'string'
      && body.error.length <= 200 ? body.error : `请求失败（HTTP ${response.status}）`
    throw new Error(detail)
  }
  return parseExpressionState(body.data, sessionId)
}

export function readExpressionState(
  sessionId: string, signal?: AbortSignal, fetchImpl: RequestFetch = fetch,
): Promise<ExpressionState> {
  return request(sessionId, { method: 'GET', signal }, fetchImpl,
    `${ROUTE_STATE}?sessionId=${encodeURIComponent(sessionId)}`)
}

/** Send only changed dimensions; the host atomically preserves omitted settings. */
export function writeExpressionSettings(
  sessionId: string, patch: ExpressionPatch, signal?: AbortSignal, fetchImpl: RequestFetch = fetch,
): Promise<ExpressionState> {
  if (!isExpressionPatch(patch)) return Promise.reject(new Error('表达设置无效'))
  return request(sessionId, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, ...patch }),
  }, fetchImpl, ROUTE_STATE)
}

/** Style-only convenience. Unlike the legacy command shortcut, this does not select a language. */
export function writeExpressionMode(
  sessionId: string, mode: ExpressionMode, signal?: AbortSignal, fetchImpl: RequestFetch = fetch,
): Promise<ExpressionState> {
  if (!isExpressionMode(mode)) return Promise.reject(new Error('表达方式无效'))
  return writeExpressionSettings(sessionId, { mode }, signal, fetchImpl)
}


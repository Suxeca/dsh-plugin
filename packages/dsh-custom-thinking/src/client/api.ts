/**
 * /custom-thinking 客户端 fetch 封装（与 better-sidebar 的 /sidebar/api 同款信封）。
 * @module dsh-custom-thinking/client/api
 */
import type { ApplyOp, Envelope, ThinkingState } from '../shared/types.ts'

/** 一个 wire 失败。 */
export class ThinkingApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, body === undefined
      ? { headers: { accept: 'application/json' }, signal }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
  } catch (error) {
    throw new ThinkingApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed = await response.json().catch(() => null) as Envelope<T> | null
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new ThinkingApiError(
      parsed !== null && parsed.ok === false ? parsed.error.code : 'http',
      parsed !== null && parsed.ok === false ? parsed.error.message : `HTTP ${response.status}`,
    )
  }
  return parsed.value
}

/** 读取设置页状态。 */
export function fetchThinkingState(signal?: AbortSignal): Promise<ThinkingState> {
  return call<ThinkingState>('/custom-thinking/state', undefined, signal)
}

/** 应用一撮操作并返回刷新后的状态。 */
export function applyThinkingOps(ops: readonly ApplyOp[], signal?: AbortSignal): Promise<ThinkingState> {
  return call<ThinkingState>('/custom-thinking/apply', { ops }, signal)
}

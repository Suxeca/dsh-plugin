export type ExpressionMode = 'default' | 'ste'
export type ExpressionLanguage = 'auto' | 'zh' | 'en'
export interface ExpressionPatch { mode?: ExpressionMode; language?: ExpressionLanguage }

export interface ExpressionState {
  sessionId: string
  mode: ExpressionMode
  language: ExpressionLanguage
  revision: number
  updatedAt: number | null
  ruleVersion: string
}

export interface ModeStore {
  get(sessionId: string): Promise<ExpressionState>
  /** Compatibility shortcut: ste selects English + simple; default resets both. */
  set(sessionId: string, mode: ExpressionMode): Promise<ExpressionState>
  /** Atomic partial change. Unspecified language/style retains the current value. */
  update(sessionId: string, patch: ExpressionPatch): Promise<ExpressionState>
}

export const ROUTE_STATE = '/expression-mode/api/state'
export const PLUGIN_NAME = '@suxeca/dsh-expression-mode'
export const MESSAGE_PLUGIN = 'expression-mode'

export function usableSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value)
}
export function isExpressionMode(value: unknown): value is ExpressionMode {
  return value === 'default' || value === 'ste'
}
export function isExpressionLanguage(value: unknown): value is ExpressionLanguage {
  return value === 'auto' || value === 'zh' || value === 'en'
}
export function isExpressionPatch(value: unknown): value is ExpressionPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.length > 0 && keys.every(key => key === 'mode' || key === 'language')
    && (!Object.hasOwn(record, 'mode') || isExpressionMode(record.mode))
    && (!Object.hasOwn(record, 'language') || isExpressionLanguage(record.language))
}

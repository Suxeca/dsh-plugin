/**
 * 共享 DTO：host 与 client 各自内联（无运行时共享身份，仅纯类型/常量）。
 * @module dsh-custom-thinking/shared
 */

/** pi-ai 的全部思考等级（THINKING_LEVELS），按递进顺序。 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 可声明/展示的思考等级顺序（pi-ai canonical 顺序）。 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]

/** 等级 → 展示名。 */
export const LEVEL_NAMES: Record<ThinkingLevel, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '较高',
  max: '最高',
}

/** 等级 → wire 值；`null` 表示"支持，但不发送参数"（仅 off 允许）。 */
export type WireSpellings = Partial<Record<ThinkingLevel, string | null>>

/** 已配置状态：false = 显式禁用思考；null = 未配置（继承，手写模型默认不可思考）。 */
export type ConfiguredEfforts = false | null | WireSpellings

/** 设置页上一行模型的状态。 */
export interface ModelRow {
  /** provider 侧模型 id（settings 的 models[].id）。 */
  id: string
  /** 展示名（models[].name ?? id）。 */
  name: string
  /** 已存储的 reasoningEfforts 配置。 */
  configured: ConfiguredEfforts
  /** 适配器当前实际支持的等级（来自 llm.resolveModelInfo，仅供参考）。 */
  offered: string[]
  /** 适配器当前默认等级（route 级 reasoning 解析到该模型后的结果）。 */
  defaultEffort?: string
  /** 该模型当前是否可路由（解析失败为 false）。 */
  available: boolean
}

/** 设置页上一行 provider 的状态。 */
export interface ProviderRow {
  /** route key（settings providers 的键）。 */
  id: string
  /** 展示名（profile.displayName ?? id）。 */
  name: string
  /** wire 协议（profile.api，如 openai-completions）。 */
  api?: string
  /** 端点（profile.baseURL）。 */
  baseURL?: string
  /** 该路由是否可作为思考等级编辑（要求 profile 用 models 数组声明模型）。 */
  editable: boolean
  /** 路由级默认思考等级（profile.reasoning）；缺省表示提供方默认。 */
  reasoning?: ThinkingLevel
  /** profile.compat.supportsReasoningEffort（OpenAI 兼容格式才会提示）。 */
  compatReasoningEffort?: boolean
  /** 不可编辑的原因（如 catalog 路由用 modelOverrides）。 */
  note?: string
  /** 该路由声明的模型。 */
  models: ModelRow[]
}

/** GET /custom-thinking/state 的返回值。 */
export interface ThinkingState {
  providers: ProviderRow[]
  /** llm-pi-ai 用户区 revision（本次快照；写时可不带）。 */
  revision?: number
}

/** apply 里的单个操作。 */
export type ApplyOp =
  | { kind: 'route-default'; provider: string; reasoning?: ThinkingLevel }
  | { kind: 'compat'; provider: string; enableReasoningEffort: boolean }
  | { kind: 'enable-standard'; provider: string; levels?: WireSpellings }
  | { kind: 'disable-all'; provider: string }
  /** 模型级：levels 为 UI 草稿（level → wire 输入），宿主负责折叠校验。 */
  | { kind: 'model'; provider: string; modelId: string; levels: Record<string, string> }

/** POST /custom-thinking/apply 的请求体。 */
export interface ApplyRequest {
  ops: readonly ApplyOp[]
}

/** 统一 JSON 信封。 */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

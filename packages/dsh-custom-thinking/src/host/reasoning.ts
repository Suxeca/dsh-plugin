/**
 * 纯数据变换：把 UI 草稿折叠成 pi-ai `reasoningEfforts`（或 false），以及
 * 重建 provider 的 models 数组（保留既有字段，只改目标模型的思考配置）。
 * 不碰 settings I/O（那是 api.ts 的职责）。
 * @module dsh-custom-thinking/host/reasoning
 */
import { THINKING_LEVELS, type ThinkingLevel, type WireSpellings } from '../shared/types.ts'

/** OpenAI 兼容格式（reasoning_effort wire）。 */
export const OPENAI_FORMATS: readonly string[] = ['openai-completions', 'openai-responses']

/** Anthropic Messages 格式（thinking budget wire）。 */
export const ANTHROPIC_FORMAT = 'anthropic-messages'

/**
 * 标准思考等级集：off（不发送参数）+ 低/中/高（reasoning_effort 常用价）。
 * 这是 OpenAI 兼容网关最常接受的档位；非 OpenAI 风格端点仍可逐档改写 wire 值。
 */
export function standardEfforts(): WireSpellings {
  return { off: null, low: 'low', medium: 'medium', high: 'high' }
}

/** 逐件克隆（纯 JSON 数据，无宿主引用）。 */
export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 把 UI 勾选的等级 + wire 输入折叠为合法 `reasoningEfforts`。
 * 规则对齐 llm-pi-ai 的校验：
 *  - 只保留已知等级；off 允许空值（转 null，表示"支持但不发送"）；
 *  - 非 off 等级必须给出非空 wire，否则丢弃该档；
 *  - 没有任何非 off 思考档 → 返回 false（禁用作 infer 面，符合"offers no
 *    level beyond off"的拒绝语义——与其写一个被拒的配置，不如折叠为禁用）。
 * @param draft - level → wire 字符串（UI 输入，允许空串）。
 * @returns 合法配置：false（禁用）或 map；空输入 → false。
 */
export function collapseEfforts(draft: Record<string, string>): WireSpellings | false {
  const map: WireSpellings = {}
  let hasThinking = false
  for (const level of THINKING_LEVELS) {
    const raw = draft[level]
    if (raw === undefined) continue
    const value = raw.trim()
    if (level === 'off') {
      map.off = value.length === 0 ? null : value
      continue
    }
    if (value.length === 0) continue
    map[level] = value
    hasThinking = true
  }
  if (!hasThinking) return false
  return map
}

/** 是否为可思考配置（含至少一个非 off 档）。 */
export function isThinkingConfig(value: WireSpellings | false | null): value is WireSpellings {
  return value !== false && value !== null
    && Object.entries(value).some(([level, wire]) => level !== 'off' && wire !== null && String(wire).length > 0)
}

/** 重建 provider 的 models 数组：把目标模型的思考配置写入（或移除）。 */
export interface ModelLike {
  id: string
  [key: string]: unknown
}

/**
 * 把 `reasoningEfforts` 设置到目标模型上。在已有模型对象上复制其余字段，
 * 再设置/移除 reasoningEfforts；目标模型不存在时返回原数组。
 * @param models - 现有模型数组（resolved 快照）。
 * @param modelId - 目标模型 id。
 * @param efforts - WireSpellings（设置）/ false（禁用）/ null（移除 → 继承）。
 * @returns 新数组（未找到目标时与原数组同引用）。
 */
export function withModelEfforts(
  models: readonly ModelLike[],
  modelId: string,
  efforts: WireSpellings | false | null,
): ModelLike[] {
  let changed = false
  const next = models.map((entry) => {
    if (entry.id !== modelId) return entry
    changed = true
    if (efforts === null) {
      // 移除字段；若无该字段则保持原条目
      if (!('reasoningEfforts' in entry)) return entry
      const copy: ModelLike = { ...entry }
      delete copy.reasoningEfforts
      return copy
    }
    return { ...entry, reasoningEfforts: efforts }
  })
  return changed ? next : next
}

/**
 * 把同一套思考配置（或禁用）应用到 provider 的全部模型。
 * @param models - 现有模型数组。
 * @param efforts - 每档 wire（标准档通常来自 {@link standardEfforts}）。
 * @returns 新数组。
 */
export function withAllModelEfforts(models: readonly ModelLike[], efforts: WireSpellings | false): ModelLike[] {
  return models.map(entry => ({ ...entry, reasoningEfforts: efforts }))
}

/**
 * 修正一个模型条目以便写入：去掉会触发 pi-ai 拒绝的空 `{}` reasoningEfforts
 * （schemastery 会把缺失字段物化成 `{}`，而空 dict 是明确的"空配置"非法值；
 * 未配置态应表现为字段缺失）。其余字段原样保留。
 */
export function normalizedModel(entry: ModelLike): ModelLike {
  const out: ModelLike = { ...entry }
  const efforts = out.reasoningEfforts
  if (efforts !== undefined && efforts !== false
    && typeof efforts === 'object' && Object.keys(efforts as object).length === 0) {
    delete out.reasoningEfforts
  }
  return out
}

/**
 * 写入前准备整套模型数组：逐条 {@link normalizedModel}。
 * @param models - 现有模型数组（resolved 快照或先前重建的结果）。
 * @returns 可安全写入 settings 的新数组。
 */
export function preparedModels(models: readonly ModelLike[]): Record<string, unknown>[] {
  return models.map(normalizedModel)
}

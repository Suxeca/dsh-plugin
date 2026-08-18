/**
 * 「思考强度」设置区块：为自定义提供商（hand-declared pi-ai 路由）的每个模型
 * 声明可选思考档位 + wire 拼写，写入 llm-pi-ai settings 的模型条目 `reasoningEfforts`。
 * 保存后，编曲器模型选择器（conversation.input.model）就会为该模型原生显示
 * 「思考强度」下拉，请求按各档 wire 值发送——无需改动官方 UI 或适配器。
 *
 * 状态为本地草稿：进入页面时从 /custom-thinking/state 拉取，任何保存后重新拉取
 * 以反映适配器实际暴露的等级。资源挂组件生命周期，无全局副作用。
 * @module dsh-custom-thinking/client/ThinkingSection
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  LEVEL_NAMES, THINKING_LEVELS,
  type ApplyOp, type ModelRow, type ProviderRow, type ThinkingLevel,
  type ThinkingState, type WireSpellings,
} from '../shared/types.ts'
import { applyThinkingOps, fetchThinkingState } from './api.ts'

/** 区块 owner 注入面：settings.section 只给 close。 */
interface SectionProps {
  close: () => void
}

/** 一个等级的草稿行。 */
interface LevelDraft {
  checked: boolean
  wire: string
}

/** 一个模型的草稿。 */
interface ModelDraft {
  enabled: boolean
  levels: Record<ThinkingLevel, LevelDraft>
}

/** 一个 provider 的草稿（模型 + 路由默认 + 高级开关）。 */
interface ProviderDraft {
  models: Record<string, ModelDraft>
  reasoning: ThinkingLevel | undefined
  compat: boolean
}

const STYLES: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10 },
  banner: { color: '#8a93a5', fontSize: 12.5, lineHeight: 1.6 },
  card: { border: '1px solid #3a4256', borderRadius: 8, padding: '10px 12px' },
  cardHeader: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  cardTitle: { fontSize: 14, fontWeight: 600, color: '#e8ecf4' },
  cardSub: { fontSize: 12, color: '#8a93a5' },
  note: { fontSize: 12, color: '#b0883c', margin: '4px 0' },
  error: { fontSize: 12, color: '#e06c6c', margin: '6px 0' },
  hint: { fontSize: 12, color: '#8a93a5', margin: '4px 0' },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px dashed #2c3342' },
  modelName: { fontSize: 13, fontWeight: 500, color: '#d7dde8', minWidth: 180 },
  meta: { fontSize: 11, color: '#8a93a5' },
  button: {
    background: 'transparent', border: '1px solid #4a5470', borderRadius: 6, color: '#c9d2e2',
    padding: '3px 10px', fontSize: 12, cursor: 'pointer',
  },
  buttonDanger: { borderColor: '#6b3a3a', color: '#e08a8a' },
  buttonPrimary: { borderColor: '#3d6bb0', color: '#9cc0f2' },
  buttonDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  select: {
    background: '#171d2a', border: '1px solid #3a4256', borderRadius: 6, color: '#d7dde8',
    padding: '3px 6px', fontSize: 12,
  },
  input: {
    background: '#171d2a', border: '1px solid #3a4256', borderRadius: 6, color: '#d7dde8',
    padding: '2px 6px', fontSize: 12, width: 90,
  },
  levels: { display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 },
  level: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#aeb8c9' },
  label: { fontSize: 12, color: '#8a93a5', marginRight: 6 },
  spacer: { flex: 1 },
}

/** 折叠 ConfiguredEfforts → 草稿（false/null = 未启用；map = 逐档勾选 + wire）。 */
function seedModel(row: ModelRow): ModelDraft {
  const levels = {} as Record<ThinkingLevel, LevelDraft>
  for (const level of THINKING_LEVELS) levels[level] = { checked: false, wire: '' }
  if (row.configured !== false && row.configured !== null) {
    const map = row.configured as WireSpellings
    for (const [level, wire] of Object.entries(map)) {
      if (level in levels) {
        levels[level as ThinkingLevel] = { checked: true, wire: wire === null ? '' : String(wire) }
      }
    }
    return { enabled: true, levels }
  }
  return { enabled: false, levels }
}

/** 标准档位草稿（off + 低/中/高，wire 按 OpenAI reasoning_effort 拼写）。 */
function standardModelDraft(): ModelDraft {
  const levels = {} as Record<ThinkingLevel, LevelDraft>
  for (const level of THINKING_LEVELS) levels[level] = { checked: false, wire: '' }
  levels.off = { checked: true, wire: '' }
  levels.low = { checked: true, wire: 'low' }
  levels.medium = { checked: true, wire: 'medium' }
  levels.high = { checked: true, wire: 'high' }
  return { enabled: true, levels }
}

/** 勾选等级 → 提交草稿（host 负责折叠校验）。 */
function draftLevels(draft: ModelDraft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const level of THINKING_LEVELS) {
    if (draft.levels[level].checked) out[level] = draft.levels[level].wire
  }
  return out
}

/** 仅 openai-completions 协议存在 route 级 compat 开关（pi-ai 校验拒绝其余协议）。 */
function supportsCompatSwitch(api: string | undefined): boolean {
  return api === 'openai-completions'
}

/**
 * 渲染思考强度设置区块。
 * @param props - owner props（settings.section：close）。
 * @returns 设置页内容。
 */
export function ThinkingSection(props: SectionProps): JSX.Element {
  const [state, setState] = useState<ThinkingState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  const [busy, setBusy] = useState<Record<string, string | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  void props

  const refresh = (): void => {
    fetchThinkingState().then(
      (next) => {
        setState(next)
        const seeded: Record<string, ProviderDraft> = {}
        for (const provider of next.providers) {
          const models: Record<string, ModelDraft> = {}
          for (const model of provider.models) models[model.id] = seedModel(model)
          seeded[provider.id] = {
            models,
            reasoning: provider.reasoning,
            compat: provider.compatReasoningEffort === true,
          }
        }
        setDrafts(seeded)
        setLoadError(null)
      },
      (error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error))
      },
    )
  }

  useEffect(() => {
    refresh()
    // 挂载时拉一次即可；保存后手动 refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = (providerId: string, label: string, ops: readonly ApplyOp[]): void => {
    setBusy(current => ({ ...current, [providerId]: label }))
    setErrors(current => ({ ...current, [providerId]: null }))
    applyThinkingOps(ops).then(
      (next) => {
        setBusy(current => ({ ...current, [providerId]: null }))
        setState(next)
        const seeded: Record<string, ProviderDraft> = {}
        for (const provider of next.providers) {
          const models: Record<string, ModelDraft> = {}
          for (const model of provider.models) models[model.id] = seedModel(model)
          seeded[provider.id] = {
            models,
            reasoning: provider.reasoning,
            compat: provider.compatReasoningEffort === true,
          }
        }
        setDrafts(seeded)
      },
      (error: unknown) => {
        setBusy(current => ({ ...current, [providerId]: null }))
        setErrors(current => ({
          ...current,
          [providerId]: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  }

  const setModel = (providerId: string, modelId: string, patch: Partial<ModelDraft>): void => {
    setDrafts(current => {
      const provider = current[providerId]
      if (provider === undefined) return current
      return {
        ...current,
        [providerId]: {
          ...provider,
          models: {
            ...provider.models,
            [modelId]: { ...provider.models[modelId], ...patch },
          },
        },
      }
    })
  }

  const setLevel = (providerId: string, modelId: string, level: ThinkingLevel, patch: Partial<LevelDraft>): void => {
    setDrafts(current => {
      const provider = current[providerId]
      const model = provider?.models[modelId]
      if (provider === undefined || model === undefined) return current
      return {
        ...current,
        [providerId]: {
          ...provider,
          models: {
            ...provider.models,
            [modelId]: { ...model, levels: { ...model.levels, [level]: { ...model.levels[level], ...patch } } },
          },
        },
      }
    })
  }

  const setRouteDefault = (providerId: string, reasoning: ThinkingLevel | undefined): void => {
    setDrafts(current => ({ ...current, [providerId]: { ...current[providerId], reasoning } }))
  }

  const setCompat = (providerId: string, compat: boolean): void => {
    setDrafts(current => ({ ...current, [providerId]: { ...current[providerId], compat } }))
  }

  if (loadError !== null) {
    return <div style={STYLES.root}><p style={STYLES.error}>{`思考强度状态读取失败：${loadError}`}</p></div>
  }
  if (state === null) {
    return <div style={STYLES.root}><p style={STYLES.hint}>加载中…</p></div>
  }
  const editable = state.providers.filter(provider => provider.editable)
  if (editable.length === 0) {
    return (
      <div style={STYLES.root}>
        <p style={STYLES.banner}>
          此页为「自定义提供商」（在 设置 → 模型 中手写声明的 OpenAI 兼容路由等）的模型
          开启思考强度。当前没有可编辑的自定义提供商——先添加一个（路由需声明 models 列表）。
        </p>
        {state.providers.length === 0
          ? <p style={STYLES.hint}>尚未配置任何第三方提供商。</p>
          : null}
      </div>
    )
  }

  return (
    <div style={STYLES.root}>
      <p style={STYLES.banner}>
        为自定义提供商的模型声明「思考等级」。保存后，对话输入框的模型选择器会为这些模型
        显示思考强度选项；各档的 wire 值按你的网关实际接受的拼写填写（OpenAI 兼容网关通常为
        reasoning_effort 的 low / medium / high）。这是 pi-ai 适配器的原生配置通道，官方设置页
        刻意不提供此控件，本插件补上。
      </p>
      {state.providers.map(provider => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          draft={drafts[provider.id]}
          busy={busy[provider.id] ?? null}
          error={errors[provider.id] ?? null}
          onRefresh={refresh}
          onRun={run}
          onSetModel={setModel}
          onSetLevel={setLevel}
          onSetRouteDefault={setRouteDefault}
          onSetCompat={setCompat}
        />
      ))}
    </div>
  )
}

/** 一个 provider 的卡片。 */
function ProviderCard(props: {
  provider: ProviderRow
  draft: ProviderDraft | undefined
  busy: string | null
  error: string | null
  onRefresh: () => void
  onRun: (providerId: string, label: string, ops: readonly ApplyOp[]) => void
  onSetModel: (providerId: string, modelId: string, patch: Partial<ModelDraft>) => void
  onSetLevel: (providerId: string, modelId: string, level: ThinkingLevel, patch: Partial<LevelDraft>) => void
  onSetRouteDefault: (providerId: string, reasoning: ThinkingLevel | undefined) => void
  onSetCompat: (providerId: string, compat: boolean) => void
}): JSX.Element {
  const { provider, draft } = props
  const busy = props.busy !== null
  const providerId = provider.id
  const openai = supportsCompatSwitch(provider.api)

  if (!provider.editable) {
    return (
      <div style={STYLES.card}>
        <div style={STYLES.cardHeader}>
          <span style={STYLES.cardTitle}>{provider.name}</span>
          <span style={STYLES.cardSub}>{provider.id}</span>
        </div>
        {provider.note !== undefined ? <p style={STYLES.note}>{provider.note}</p> : null}
      </div>
    )
  }
  if (draft === undefined) return <div style={STYLES.card}><p style={STYLES.hint}>加载中…</p></div>

  const hasThinking = provider.models.some(model => {
    const configured = model.configured
    return configured !== false && configured !== null
  })

  return (
    <div style={STYLES.card}>
      <div style={STYLES.cardHeader}>
        <span style={STYLES.cardTitle}>{provider.name}</span>
        <span style={STYLES.cardSub}>
          {provider.id}
          {provider.api !== undefined ? ` · ${provider.api}` : ''}
          {provider.baseURL !== undefined && provider.baseURL.length > 0 ? ` · ${provider.baseURL}` : ''}
        </span>
      </div>

      {/* 路由级默认思考等级 */}
      <div style={STYLES.row}>
        <span style={STYLES.label}>路由默认思考等级</span>
        <select
          style={STYLES.select}
          value={draft.reasoning ?? ''}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value
            props.onSetRouteDefault(providerId, value === '' ? undefined : value as ThinkingLevel)
          }}
        >
          <option value="">提供方默认</option>
          {THINKING_LEVELS.map(level => (
            <option key={level} value={level}>{LEVEL_NAMES[level]}</option>
          ))}
        </select>
        <span style={STYLES.spacer} />
        <button
          style={{ ...STYLES.button, ...STYLES.buttonPrimary, ...(busy ? STYLES.buttonDisabled : {}) }}
          disabled={busy}
          onClick={() => props.onRun(providerId, 'route', [{ kind: 'route-default', provider: providerId, reasoning: draft.reasoning }])}
        >
          {busy && props.busy === 'route' ? '保存中…' : '保存默认'}
        </button>
      </div>

      {/* 批量操作 */}
      <div style={STYLES.row}>
        <button
          style={{ ...STYLES.button, ...STYLES.buttonPrimary, ...(busy ? STYLES.buttonDisabled : {}) }}
          disabled={busy}
          onClick={() => props.onRun(providerId, 'enable-all', [{ kind: 'enable-standard', provider: providerId }])}
        >
          {busy && props.busy === 'enable-all' ? '应用中…' : '为全部模型启用标准思考（低/中/高）'}
        </button>
        <button
          style={{ ...STYLES.button, ...STYLES.buttonDanger, ...(busy ? STYLES.buttonDisabled : {}) }}
          disabled={busy}
          onClick={() => props.onRun(providerId, 'disable-all', [{ kind: 'disable-all', provider: providerId }])}
        >
          {busy && props.busy === 'disable-all' ? '应用中…' : '全部禁用'}
        </button>
      </div>

      {/* 高级：reasoning_effort 开关（OpenAI 兼容格式） */}
      {openai
        ? (
          <div style={STYLES.row}>
            <label style={{ ...STYLES.label, display: 'flex', alignItems: 'center', gap: 6, marginRight: 0, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={draft.compat}
                disabled={busy}
                onChange={(event) => props.onSetCompat(providerId, event.target.checked)}
              />
              强制请求携带 reasoning_effort（OpenAI 兼容；默认按 baseURL 自动探测）
            </label>
            <span style={STYLES.spacer} />
            <button
              style={{ ...STYLES.button, ...(busy ? STYLES.buttonDisabled : {}) }}
              disabled={busy}
              onClick={() => props.onRun(providerId, 'compat', [{ kind: 'compat', provider: providerId, enableReasoningEffort: draft.compat }])}
            >
              {busy && props.busy === 'compat' ? '保存中…' : '保存'}
            </button>
          </div>
        )
        : null}

      {hasThinking
        ? <p style={STYLES.hint}>已有模型开启思考：编曲器模型选择器现在会显示思考强度下拉。</p>
        : null}
      {props.error !== null ? <p style={STYLES.error}>{props.error}</p> : null}

      {/* 每个模型一行 */}
      {provider.models.map(model => (
        <ModelRowView
          key={model.id}
          providerId={providerId}
          model={model}
          draft={draft.models[model.id]}
          busy={busy}
          busyLabel={props.busy}
          onSetModel={props.onSetModel}
          onSetLevel={props.onSetLevel}
          onRun={props.onRun}
        />
      ))}
    </div>
  )
}

/** 单个模型行的编辑 UI。 */
function ModelRowView(props: {
  providerId: string
  model: ModelRow
  draft: ModelDraft | undefined
  busy: boolean
  busyLabel: string | null
  onSetModel: (providerId: string, modelId: string, patch: Partial<ModelDraft>) => void
  onSetLevel: (providerId: string, modelId: string, level: ThinkingLevel, patch: Partial<LevelDraft>) => void
  onRun: (providerId: string, label: string, ops: readonly ApplyOp[]) => void
}): JSX.Element {
  const { model, draft } = props
  const providerId = props.providerId
  if (draft === undefined) return <div style={STYLES.row}><span style={STYLES.modelName}>{model.id}</span></div>
  const saving = props.busy && props.busyLabel === `model:${model.id}`

  const toggle = (): void => {
    props.onSetModel(providerId, model.id, draft.enabled
      ? { enabled: false }
      : standardModelDraft())
  }

  const save = (): void => {
    const levels = draft.enabled ? draftLevels(draft) : { off: '' }
    props.onRun(providerId, `model:${model.id}`, [{ kind: 'model', provider: providerId, modelId: model.id, levels }])
  }

  return (
    <div style={STYLES.row}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={props.busy}
          onChange={toggle}
        />
        <span style={STYLES.modelName}>{model.name}</span>
      </label>
      {model.offered.length > 0
        ? <span style={STYLES.meta}>{`当前可选项：${model.offered.join(' / ')}`}</span>
        : <span style={STYLES.meta}>{model.available ? '未开启思考（保存后生效）' : '模型当前不可路由'}</span>}
      <span style={STYLES.spacer} />
      <button
        style={{ ...STYLES.button, ...STYLES.buttonPrimary, ...((props.busy) ? STYLES.buttonDisabled : {}) }}
        disabled={props.busy}
        onClick={save}
      >
        {saving ? '保存中…' : '保存本模型'}
      </button>
      {draft.enabled
        ? (
          <div style={STYLES.levels}>
            {THINKING_LEVELS.map(level => (
              <label key={level} style={STYLES.level}>
                <input
                  type="checkbox"
                  checked={draft.levels[level].checked}
                  disabled={props.busy}
                  onChange={(event) => props.onSetLevel(providerId, model.id, level, { checked: event.target.checked })}
                />
                {LEVEL_NAMES[level]}
                <input
                  style={STYLES.input}
                  value={draft.levels[level].wire}
                  disabled={props.busy}
                  placeholder={level === 'off' ? '留空=不发送' : 'wire 值'}
                  onChange={(event) => props.onSetLevel(providerId, model.id, level, { wire: event.target.value })}
                />
              </label>
            ))}
          </div>
        )
        : null}
    </div>
  )
}

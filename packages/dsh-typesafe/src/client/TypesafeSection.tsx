/**
 * 「TypeSafe / Jev」设置区块（设置面板 → TypeSafe）。
 *
 * 为什么全部自己画：槽位只注入 `{ close }`，且本包不允许新增第三方依赖（浏览器半
 * 只有 react），所以表单 / 徽标 / 表格一律是原生元素 + CSS module。
 *
 * 为什么每个请求都包起来：设置面板是宿主渲染的一棵树，任何 render 期抛出都会连带
 * 打掉整块面板；因此所有 API 失败都收敛成可关闭横幅（`code: message`），不向外抛。
 *
 * 为什么不缓存密钥：输入框受控、保存成功即清空、不回显，也不写 localStorage /
 * sessionStorage；密钥值只出现在那一次 POST 的请求体里。组件无全局副作用（无 document
 * 级监听、无定时器），在途请求由 AbortController 持有，卸载时 abort。
 *
 * @module @suxeca/dsh-typesafe/client/TypesafeSection
 */
import { useEffect, useRef, useState } from 'react'
import { clampText, redactSecrets } from '../shared.ts'
import type { KeyState, ProbeResult, RecentCall, TypesafeSettings, TypesafeStatus } from '../shared.ts'
import { TypesafeApiError, clearKey, fetchStatus, probeKey, saveKey, saveSettings } from './api.ts'
import css from './TypesafeSection.module.css'

/** settings.section 槽位注入面：只给 close。 */
interface SectionProps { close: () => void }

/** 可关闭的错误横幅内容（已脱敏）。 */
interface Banner { readonly code: string; readonly message: string }

/** 同一时刻只允许一个在途操作：新操作会先 abort 上一个。 */
type BusyOp = 'status' | 'key-save' | 'key-clear' | 'probe' | 'settings'

/** 设置区的本地草稿：数值以字符串保存，提交时才 Number() + 校验。 */
interface Draft {
  model: string; timeoutMs: string; maxRetries: string; cacheTtlMs: string
  tool: boolean; preflightEnabled: boolean; routerEnabled: boolean
  preflightTimeoutMs: string; preflightMinConfidence: string
}

/** 草稿里以字符串保存的数值字段。 */
type NumericKey = 'timeoutMs' | 'maxRetries' | 'cacheTtlMs' | 'preflightTimeoutMs' | 'preflightMinConfidence'

/** 草稿里的布尔开关字段。 */
type ToggleKey = 'tool' | 'preflightEnabled' | 'routerEnabled'

/** 数值校验结果。 */
type Parsed = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string }

/** 设置区展示的数值字段：键、标签、下界、上界、是否必须为整数。 */
const NUMERIC_FIELDS: readonly { readonly key: NumericKey; readonly label: string; readonly min: number; readonly max?: number; readonly integer: boolean }[] = [
  { key: 'timeoutMs', label: 'timeoutMs（单次尝试超时，毫秒）', min: 1, integer: true },
  { key: 'maxRetries', label: 'maxRetries（可重试错误的额外尝试次数）', min: 0, integer: true },
  { key: 'cacheTtlMs', label: 'cacheTtlMs（本地缓存 TTL，0 = 关闭缓存）', min: 0, integer: true },
  { key: 'preflightTimeoutMs', label: 'preflight.timeoutMs（门禁预算，超时放行）', min: 1, integer: true },
  { key: 'preflightMinConfidence', label: 'preflight.minConfidence（判危险的最低置信度）', min: 0, max: 1, integer: false },
]

/** 任何要展示的文本都先脱敏 + 截断（服务端本该做过，这里是最后一道防线）。 */
function safeText(text: string): string {
  return clampText(redactSecrets(text), 200)
}

/** wire 失败或本地校验失败 → 横幅内容。 */
function bannerOf(reason: unknown, fallbackCode = 'client'): Banner {
  if (reason instanceof TypesafeApiError) return { code: reason.code, message: reason.message }
  return { code: fallbackCode, message: safeText(reason instanceof Error ? reason.message : String(reason)) }
}

/** 解析一个受控数字字段（正数 / 非负 / 整数 / 上界）。 */
function parseNumber(raw: string, label: string, min: number, options?: { readonly max?: number; readonly integer?: boolean }): Parsed {
  const text = raw.trim(); const value = Number(text)
  if (text === '' || !Number.isFinite(value)) return { ok: false, message: `${label} 需要数字` }
  if (options?.integer === true && !Number.isInteger(value)) return { ok: false, message: `${label} 需要整数` }
  if (value < min) return { ok: false, message: `${label} 不能小于 ${min}` }
  if (options?.max !== undefined && value > options.max) return { ok: false, message: `${label} 不能大于 ${options.max}` }
  return { ok: true, value }
}

/** 设置 → 草稿。 */
function draftFrom(settings: TypesafeSettings): Draft {
  return {
    model: settings.model, timeoutMs: String(settings.timeoutMs), maxRetries: String(settings.maxRetries),
    cacheTtlMs: String(settings.cacheTtlMs), tool: settings.tool, routerEnabled: settings.router.enabled,
    preflightEnabled: settings.preflight.enabled, preflightTimeoutMs: String(settings.preflight.timeoutMs),
    preflightMinConfidence: String(settings.preflight.minConfidence),
  }
}

/** 密钥状态的徽标文案与色调。 */
function keyBadge(key: KeyState): { readonly label: string; readonly tone: string } {
  if (!key.configured) return { label: '未配置', tone: css.badgeMissing }
  if (key.source === 'env') return { label: '已配置 · env（只读）', tone: css.badgeReadonly }
  return { label: '已配置 · credentials', tone: css.badgeReady }
}

/** 密钥区：状态徽标 + 密码输入 + 保存 / 清除。 */
function KeyPanel(props: {
  keyState: KeyState; draft: string; busy: boolean
  onChange: (next: string) => void; onSave: () => void; onClear: () => void
}): JSX.Element {
  const badge = keyBadge(props.keyState)
  const locked = props.busy || !props.keyState.writable
  return (
    <section className={css.section}>
      <h4 className={css.sectionTitle}>密钥</h4>
      <p className={css.sectionNote}>密钥只写入 DSH credentials（env 提供的密钥只读）；保存后不回显，本页不写浏览器存储。</p>
      <div className={css.keyRow}>
        <span className={`${css.badge} ${badge.tone}`}>{badge.label}</span>
        <input
          className={css.inputPassword} type="password" autoComplete="off" spellCheck={false} placeholder="粘贴 TYPESAFE_API_KEY"
          value={props.draft} disabled={locked} onChange={(event) => { props.onChange(event.target.value) }}
        />
        <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={locked} onClick={props.onSave}>{props.busy ? '保存中…' : '保存'}</button>
        <button type="button" className={`${css.button} ${css.buttonDanger}`} disabled={locked} onClick={props.onClear}>清除</button>
      </div>
      {props.keyState.writable ? null : (
        <p className={css.hint}>
          {props.keyState.source === 'env'
            ? '密钥由启动环境 TYPESAFE_API_KEY 提供（只读）：请改用环境变量管理，设置页无法覆盖。'
            : '当前不可写入：DSH 未挂载 credentials 服务，或该引用被标记为只读。'}
        </p>
      )}
    </section>
  )
}

/** 探测区：只读上游 /v1/models，回答「这把 key 现在能用吗」。 */
function ProbePanel(props: { result: ProbeResult | null; error: Banner | null; busy: boolean; onProbe: () => void }): JSX.Element {
  const reading = props.result === null ? <span className={css.hint}>尚未探测。</span> : (
    <span className={css.meta}>
      {`模型 ${props.result.models.length} 个 · 耗时 ${props.result.latencyMs}ms`}
      {props.result.models.length > 0 ? ` · 例如 ${props.result.models[0].name}` : ''}
    </span>
  )
  return (
    <section className={css.section}>
      <h4 className={css.sectionTitle}>探测</h4>
      <div className={css.rowActions}>
        <button type="button" className={css.button} disabled={props.busy} onClick={props.onProbe}>{props.busy ? '探测中…' : '探测'}</button>
        {reading}
      </div>
      {props.error !== null ? <p className={css.errorLine}>{`${props.error.code}: ${props.error.message}`}</p> : null}
    </section>
  )
}

/** 设置区：模型、超时/重试/缓存、工具与门禁开关。 */
function SettingsPanel(props: {
  draft: Draft; busy: boolean
  onModel: (next: string) => void; onNumeric: (key: NumericKey, next: string) => void
  onToggle: (key: ToggleKey, next: boolean) => void; onSave: () => void
}): JSX.Element {
  const draft = props.draft
  const toggle = (key: ToggleKey, label: string): JSX.Element => (
    <label className={css.toggle}>
      <input type="checkbox" checked={draft[key]} disabled={props.busy} onChange={(event) => { props.onToggle(key, event.target.checked) }} />
      <span>{label}</span>
    </label>
  )
  return (
    <section className={css.section}>
      <h4 className={css.sectionTitle}>设置</h4>
      <label className={css.field}>
        <span className={css.fieldLabel}>model（服务端别名或版本号）</span>
        <input
          className={css.inputWide} type="text" spellCheck={false} placeholder="jev-latest" value={draft.model}
          disabled={props.busy} onChange={(event) => { props.onModel(event.target.value) }}
        />
      </label>
      <div className={css.grid}>
        {NUMERIC_FIELDS.map(field => (
          <label key={field.key} className={css.field}>
            <span className={css.fieldLabel}>{field.label}</span>
            <input className={css.input} type="text" inputMode="decimal" value={draft[field.key]} disabled={props.busy} onChange={(event) => { props.onNumeric(field.key, event.target.value) }} />
          </label>
        ))}
      </div>
      {toggle('tool', 'tool：向 Agent 暴露 typesafe_eval 工具')}
      {toggle('preflightEnabled', 'preflight.enabled：危险命令语义预审门禁（默认关；每次 bash 多一次网络往返，超时放行）')}
      {toggle('routerEnabled', 'router.enabled：任务模式分流适配器（只有接进 preset 副本后才有意义）')}
      <div className={css.rowActions}>
        <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={props.busy} onClick={props.onSave}>{props.busy ? '保存中…' : '保存设置'}</button>
      </div>
    </section>
  )
}

/** 近期调用表（host 只发观测字段，不含 state / instructions 原文）。 */
function RecentTable(props: { rows: readonly RecentCall[] }): JSX.Element {
  if (props.rows.length === 0) return <p className={css.hint}>还没有调用记录。</p>
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead><tr><th>时间</th><th>label</th><th>model</th><th>问题数</th><th>tokens</th><th>耗时</th><th>缓存</th><th>结果</th></tr></thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={`${row.at}-${index}`}>
              <td>{new Date(row.at).toLocaleTimeString()}</td><td className={css.mono}>{row.label}</td><td className={css.mono}>{row.model}</td>
              <td>{row.questionCount}</td><td className={css.mono}>{`${row.inputTokens}+${row.outputTokens}`}</td><td className={css.mono}>{`${row.latencyMs}ms`}</td>
              <td>{row.cached ? '命中' : '—'}</td><td className={row.ok ? css.ok : css.fail}>{row.ok ? 'ok' : `失败 · ${row.errorCode ?? 'unknown'}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 状态区：计量、缓存、最近错误与调用表。 */
function StatusPanel(props: { status: TypesafeStatus }): JSX.Element {
  const status = props.status
  const stats: readonly { readonly label: string; readonly value: string }[] = [
    { label: '调用', value: String(status.totals.calls) }, { label: '失败', value: String(status.totals.failures) },
    { label: '缓存命中', value: String(status.totals.cacheHits) }, { label: '缓存条目', value: String(status.cache.entries) },
    { label: '输入 tokens', value: String(status.totals.inputTokens) }, { label: '输出 tokens', value: String(status.totals.outputTokens) },
  ]
  return (
    <section className={css.section}>
      <h4 className={css.sectionTitle}>状态</h4>
      <p className={css.sectionNote}>{`版本 ${status.version} · 模型 ${status.model} · 上游 ${status.baseUrl} · 缓存命中 ${status.cache.hits} / 未命中 ${status.cache.misses}`}</p>
      <div className={css.stats}>
        {stats.map(item => (
          <div key={item.label} className={css.stat}>
            <span className={css.statValue}>{item.value}</span>
            <span className={css.statLabel}>{item.label}</span>
          </div>
        ))}
      </div>
      {status.lastError !== undefined ? <p className={css.errorLine}>{describeFailure(status)}</p> : null}
      <RecentTable rows={status.recent} />
    </section>
  )
}

/**
 * 把「最近一次失败」渲染成一行可读文本。
 *
 * 为什么在分类与消息之外还要补连续次数与时刻：只有消息时无法判断这是刚刚发生的、
 * 还是三天前的残留——而这个区别决定了要不要现在动手。health 是后加的字段，
 * 这里按可选读取，老载荷（缺该键）照旧渲染成原来那句话。
 *
 * @param status - host 的状态快照。
 * @returns 单行文案。
 */
function describeFailure(status: TypesafeStatus): string {
  const health: TypesafeStatus['health'] | undefined = status.health
  const when = health?.lastErrorAt === undefined ? undefined : new Date(health.lastErrorAt).toLocaleTimeString()
  const streak = health !== undefined && health.consecutiveFailures > 1 ? `连续 ${String(health.consecutiveFailures)} 次` : undefined
  const meta = [streak, when].filter((part): part is string => part !== undefined).join(' · ')
  return meta === '' ? `最近一次失败：${status.lastError ?? ''}` : `最近一次失败（${meta}）：${status.lastError ?? ''}`
}

/**
 * 渲染 TypeSafe 设置区块。
 * @param props - 槽位注入面（`close`：关闭设置面板）。
 * @returns 设置页内容；任何失败都以横幅呈现，不抛出。
 */
export function TypesafeSection(props: SectionProps): JSX.Element {
  const [status, setStatus] = useState<TypesafeStatus | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<BusyOp | null>(null)
  const [error, setError] = useState<Banner | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [probeError, setProbeError] = useState<Banner | null>(null)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)

  /** 开一次新操作：中断上一个在途请求（面板不需要并发）。 */
  const begin = (): { readonly id: number; readonly signal: AbortSignal } => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    generation.current += 1
    return { id: generation.current, signal: next.signal }
  }

  const applyStatus = (next: TypesafeStatus): void => {
    setStatus(next)
    setDraft(draftFrom(next.settings))
  }

  /** 统一执行：busy 标记、失败横幅、陈旧响应丢弃（generation 比对）。 */
  const run = (op: BusyOp, action: (signal: AbortSignal, alive: () => boolean) => Promise<void>): void => {
    const { id, signal } = begin()
    const alive = (): boolean => id === generation.current
    setBusy(op); setNotice(null); setError(null)
    action(signal, alive).then(
      () => { if (alive()) setBusy(null) },
      (reason: unknown) => {
        if (!alive()) return
        const banner = bannerOf(reason)
        setBusy(null); setError(banner)
        if (op === 'probe') { setProbe(null); setProbeError(banner) }
      },
    )
  }

  const patchDraft = (mutate: (next: Draft) => void): void => {
    setDraft(current => {
      if (current === null) return current
      const next: Draft = { ...current }
      mutate(next)
      return next
    })
  }

  const refresh = (): void => {
    run('status', async (signal, alive) => {
      const next = await fetchStatus(signal)
      if (alive()) applyStatus(next)
    })
  }

  /** 写密钥之后统一重拉状态：成功才清空输入框并提示（值不回显）。 */
  const afterKeyWrite = async (signal: AbortSignal, alive: () => boolean, done: string): Promise<void> => {
    const next = await fetchStatus(signal)
    if (!alive()) return
    setKeyDraft(''); applyStatus(next); setNotice(done)
  }

  const submitKey = (): void => {
    const value = keyDraft.trim()
    if (value === '') { setError({ code: 'input', message: '请先填写密钥再保存' }); return }
    run('key-save', async (signal, alive) => {
      await saveKey(value, signal)
      await afterKeyWrite(signal, alive, '已保存（值不会回显）')
    })
  }

  const removeKey = (): void => {
    run('key-clear', async (signal, alive) => {
      await clearKey(signal)
      await afterKeyWrite(signal, alive, '已清除 credentials 中的密钥')
    })
  }

  const runProbe = (): void => {
    setProbeError(null)
    run('probe', async (signal, alive) => {
      const result = await probeKey(signal)
      if (alive()) setProbe(result)
    })
  }

  const submitSettings = (): void => {
    if (draft === null || status === null) return
    const model = draft.model.trim()
    if (model === '') { setError({ code: 'input', message: 'model 不能为空' }); return }
    const values: number[] = []
    for (const field of NUMERIC_FIELDS) {
      const parsed = parseNumber(draft[field.key], field.label, field.min, { integer: field.integer, max: field.max })
      if (!parsed.ok) { setError({ code: 'input', message: parsed.message }); return }
      values.push(parsed.value)
    }
    const patch: Partial<TypesafeSettings> = {
      model, timeoutMs: values[0], maxRetries: values[1], cacheTtlMs: values[2], tool: draft.tool,
      preflight: { enabled: draft.preflightEnabled, timeoutMs: values[3], minConfidence: values[4] },
      router: { enabled: draft.routerEnabled, timeoutMs: status.settings.router.timeoutMs },
    }
    run('settings', async (signal, alive) => {
      await saveSettings(patch, signal)
      const next = await fetchStatus(signal)
      if (!alive()) return
      applyStatus(next); setNotice('设置已保存')
    })
  }

  useEffect(() => {
    refresh()
    return () => {
      // 卸载后到达的响应一律丢弃（generation 失效 + 在途请求中断）。
      generation.current += 1
      controller.current?.abort()
    }
    // 挂载时拉一次；之后由「刷新」按钮驱动，不轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={css.root}>
      <header className={css.header}>
        <div>
          <h3 className={css.title}>TypeSafe / Jev 语义判断</h3>
          <p className={css.subtitle}>Jev 是「类型保证的语义判断」接口，不是生成模型：它返回概率与分布，不保证真相；阈值请在自己的数据上验证。</p>
        </div>
        <div className={css.toolbar}>
          <button type="button" className={css.button} disabled={busy !== null} onClick={refresh}>{busy === 'status' ? '刷新中…' : '刷新'}</button>
          <button type="button" className={css.button} onClick={props.close}>关闭</button>
        </div>
      </header>
      {error !== null ? (
        <div className={css.banner} role="alert">
          <span className={css.bannerText}>{`${error.code}: ${error.message}`}</span>
          <button type="button" className={css.bannerClose} onClick={() => { setError(null) }}>关闭</button>
        </div>
      ) : null}
      {notice !== null ? <p className={css.notice}>{notice}</p> : null}
      {status === null || draft === null ? (
        <p className={css.hint}>{busy === 'status' ? '加载中…' : '还没有读到状态，请点「刷新」重试。'}</p>
      ) : (
        <>
          <KeyPanel keyState={status.key} draft={keyDraft} busy={busy !== null} onChange={setKeyDraft} onSave={submitKey} onClear={removeKey} />
          <ProbePanel result={probe} error={probeError} busy={busy === 'probe'} onProbe={runProbe} />
          <SettingsPanel
            draft={draft} busy={busy !== null} onSave={submitSettings}
            onModel={(next) => { patchDraft(current => { current.model = next }) }}
            onNumeric={(key, next) => { patchDraft(current => { current[key] = next }) }}
            onToggle={(key, next) => { patchDraft(current => { current[key] = next }) }}
          />
          <StatusPanel status={status} />
        </>
      )}
    </div>
  )
}

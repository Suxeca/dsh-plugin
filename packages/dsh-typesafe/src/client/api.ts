/**
 * @suxeca/dsh-typesafe — client 半的统一 HTTP 封装。
 *
 * 为什么全部走同源相对路径：设置区块跑在宿主页面里，host 已经把路由挂在
 * `${API_PREFIX}` 下；浏览器侧既没有 base URL 也没有任何 token 可带——
 * 密钥只存在于 host 进程，这一半只发指令、不持有凭据。
 *
 * 为什么所有失败收敛成同一个错误类型：调用方（设置区块）只关心
 * 「失败了、code 是什么、能展示什么」，不该在 UI 里解析 HTTP 细节。
 * 服务端返回的错误文本可能意外带上请求里的敏感串，因此任何要进入
 * Error message（进而在界面上显示）的字符串都先过 redactSecrets() +
 * clampText()——服务端本该脱敏，这里是浏览器侧最后一道防线。
 *
 * @module @suxeca/dsh-typesafe/client/api
 */
import { API_PREFIX, clampText, redactSecrets } from '../shared.ts'
import type { Envelope, KeyState, ProbeResult, TypesafeSettings, TypesafeStatus, Usage } from '../shared.ts'

/** 单条错误消息允许进入界面或日志的最大长度。 */
const MAX_MESSAGE = 240

/** 一个 wire 层失败：非 2xx / 解析失败 / 信封 `ok !== true` / 网络异常。 */
export class TypesafeApiError extends Error {
  /** 分类码：优先取信封里的 `error.code`，否则 `'http'` / `'network'` / `'aborted'`。 */
  readonly code: string

  /**
   * @param code - 分类码，调用方按它决定提示文案（不用于重试决策）。
   * @param message - 已脱敏、已截断的展示消息；不含密钥。
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'TypesafeApiError'
    this.code = code
  }
}

/** 脱敏 + 截断；凡是会离开本模块的文本（Error message）都必须过这一层。 */
function safe(text: string): string {
  return clampText(redactSecrets(text), MAX_MESSAGE)
}

/** fetch 的取消既可能是 DOMException，也可能是普通 Error，一律按 name 判断。 */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** 把 fetch 抛出的异常翻译成 wire 错误（网络故障与主动取消分开）。 */
function transportFailure(error: unknown): TypesafeApiError {
  if (isAbortError(error)) return new TypesafeApiError('aborted', '请求已取消')
  return new TypesafeApiError('network', safe(error instanceof Error ? error.message : String(error)))
}

/** 信封失败分支 → `{ code, message }`；形状不对（或 ok 为 true）返回 undefined。 */
function failureOf(parsed: unknown): { readonly code: string; readonly message: string } | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const envelope = parsed as Envelope<unknown>
  if (envelope.ok !== false) return undefined
  const code = envelope.error.code
  const message = envelope.error.message
  return {
    code: typeof code === 'string' && code.length > 0 ? safe(code) : 'http',
    message: typeof message === 'string' && message.length > 0 ? safe(message) : '',
  }
}

/** 信封成功分支 → value；`ok !== true` 或 value 缺失返回 undefined。 */
function valueOf<T>(parsed: unknown): T | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const envelope = parsed as Envelope<T>
  return envelope.ok === true ? envelope.value : undefined
}

/** GET / POST / DELETE 的统一实现（同源、no-store、信封解包、失败归一）。 */
async function call<T>(options: {
  readonly path: string
  readonly method: 'GET' | 'POST' | 'DELETE'
  readonly body?: unknown
  readonly signal?: AbortSignal
}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${options.path}`, {
      method: options.method,
      // 设置页读的是实时状态，任何中间层缓存都会让「刷新」撒谎。
      cache: 'no-store',
      headers: options.body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    throw transportFailure(error)
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }

  const failure = failureOf(parsed)
  const code = failure?.code ?? 'http'
  const message = failure !== undefined && failure.message !== '' ? failure.message : `HTTP ${response.status}`
  if (!response.ok) throw new TypesafeApiError(code, message)

  const value = valueOf<T>(parsed)
  // 2xx 但拿不到信封值：解析失败或 ok 不是 true，同样按 wire 失败处理。
  if (value === undefined) throw new TypesafeApiError(code, message)
  return value
}

/**
 * 读取设置页状态快照（版本、密钥来源、设置、计量、缓存、近期调用）。
 * @param signal - 可选取消信号；组件卸载时用来中断在途请求。
 * @returns host 当前的 `TypesafeStatus`。
 * @throws TypesafeApiError 任何 wire 层失败（code 见类字段）。
 */
export function fetchStatus(signal?: AbortSignal): Promise<TypesafeStatus> {
  return call<TypesafeStatus>({ path: '/status', method: 'GET', signal })
}

/**
 * 把密钥写入 DSH credentials（只写 credentials；env 提供的密钥是只读的）。
 * 密钥只出现在这一次请求体里；host 不回显，本函数也不保留任何副本。
 * @param value - 用户输入的密钥原文（host 侧负责 trim 与形状校验）。
 * @param signal - 可选取消信号。
 * @returns 写入后的密钥状态。
 * @throws TypesafeApiError 任何 wire 层失败。
 */
export function saveKey(value: string, signal?: AbortSignal): Promise<KeyState> {
  return call<KeyState>({ path: '/key', method: 'POST', body: { value }, signal })
}

/**
 * 从 DSH credentials 删除密钥（env 遮蔽时 host 会拒绝并返回只读错误）。
 * @param signal - 可选取消信号。
 * @returns 清除后的密钥状态。
 * @throws TypesafeApiError 任何 wire 层失败。
 */
export function clearKey(signal?: AbortSignal): Promise<KeyState> {
  return call<KeyState>({ path: '/key', method: 'DELETE', signal })
}

/**
 * 提交设置补丁（host 按命名空间合并、校验并返回解析后的完整设置）。
 * @param patch - 要改写的字段；未出现的字段保持原值。
 * @param signal - 可选取消信号。
 * @returns 合并后的完整设置。
 * @throws TypesafeApiError 任何 wire 层失败（含 host 的校验拒绝）。
 */
export function saveSettings(patch: Partial<TypesafeSettings>, signal?: AbortSignal): Promise<TypesafeSettings> {
  return call<TypesafeSettings>({ path: '/settings', method: 'POST', body: { patch }, signal })
}

/**
 * 探测密钥当前是否可用（host 侧转发到上游 /v1/models）。
 * 只读：不写入设置、不改动 credentials，结论只用于展示与排查。
 * @param signal - 可选取消信号。
 * @returns 上游模型列表与本次耗时。
 * @throws TypesafeApiError 任何 wire 层失败（含上游 401）。
 */
export function probeKey(signal?: AbortSignal): Promise<ProbeResult> {
  return call<ProbeResult>({ path: '/probe', method: 'POST', signal })
}

/**
 * 直接调用一次语义判断（HTTP 形态，等价于 `typesafe_eval` 工具与
 * `ctx.typesafe.eval`，供非 DSH 调用方与集成文档使用）。
 * @param payload - `{ state, questions }`；`questions` 的 key 由调用方自取。
 * @param signal - 可选取消信号。
 * @returns 真正的作答版本、按 key 的答案、token 计量、端到端耗时与缓存命中标记。
 * @throws TypesafeApiError 任何 wire 层失败。
 */
export function evaluate(
  payload: { readonly state: string; readonly questions: unknown },
  signal?: AbortSignal,
): Promise<{ readonly model: string; readonly answers: unknown; readonly usage: Usage; readonly latencyMs: number; readonly cached: boolean }> {
  return call<{ readonly model: string; readonly answers: unknown; readonly usage: Usage; readonly latencyMs: number; readonly cached: boolean }>({
    path: '/eval',
    method: 'POST',
    body: payload,
    signal,
  })
}

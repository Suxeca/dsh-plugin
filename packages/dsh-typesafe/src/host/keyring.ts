/**
 * @suxeca/dsh-typesafe — host 侧密钥解析与写入（契约 C）。
 *
 * 为什么单独抽一层：一把密钥有三个可能的来源（启动环境、DSH credentials 服务、
 * 根本没有），而「谁提供、能不能写」直接决定设置页该不该给保存/清除按钮。
 * 把这三态判断收进一个类，传输层只拿一个字符串、路由只拿一个 `KeyState`，
 * 没有任何一方需要知道 credentials 服务的具体实现。
 *
 * 为什么只用结构类型：本包不 import `@deepseek-ai/dsh-credentials` 的值，
 * 只描述用到的四个方法（`describe` / `resolve` / `set` / `unset`）。
 * 于是 host 装配可以传真实服务、测试可以传桩对象，而 `shared.ts` 依旧保持
 * 「浏览器半能安全内联」的纯度（无服务身份、无 @deepseek-ai/* 值导入）。
 *
 * 安全约定：
 * - `read()` 从不抛错——服务不可用时降级为「未配置 + 脱敏后的 error 描述」，
 *   这样状态页与传输层永远拿得到一个可展示的结果，而不是一次未处理 rejection。
 * - `save()` / `clear()` 的错误消息是设置页**原样展示**给用户的文案，因此全部是
 *   短句中文，并且绝不可能包含密钥值：provider 抛出的原文一律先按已知明文逐字擦除、
 *   再 `redactSecrets()`、最后 `clampText()`；且密钥只以参数形式交给 provider，不进消息。
 * - 任何一次解析都现场读，不做缓存——credentials 的 seam 要求 per-call 解析，
 *   缓存会让「刚在设置页保存的密钥」在下一次调用里仍然读到旧值。
 *
 * @module @suxeca/dsh-typesafe/host/keyring
 */

import type { KeyState } from '../shared.ts'
import { CREDENTIAL_REF, clampText, redactSecrets } from '../shared.ts'

/**
 * credentials 服务的结构视图：只描述本模块用到的四个方法。
 *
 * 不 import 真值类型是为了让本文件在「服务未挂载」「单元测试传桩」两种情况下
 * 行为一致；真实 `CredentialProvider` 在结构上满足这个接口。
 */
export interface CredentialProviderLike {
  /** 只报告存在性与可写性，不返回值（配置面安全）。 */
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
  /** 现场解析出当前值；未配置（或存的是空值）时返回 undefined。 */
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  /** 写入 provider 管理的可写源；被只读源遮蔽时应当 reject。 */
  set(ref: string, value: string): Promise<void>
  /** 从 provider 管理的可写源删除；删除不存在的引用是 no-op。 */
  unset(ref: string): Promise<void>
}

/**
 * `Keyring` 的凭据来源：服务本体，或**返回它的取值函数**。
 *
 * 取值函数是生产路径的正确形态（见 `Keyring#credentials`）；服务本体保留，
 * 是为了让「已经拿到稳定引用」的调用方与既有测试不必改写。
 */
export type CredentialSource = CredentialProviderLike | (() => CredentialProviderLike | undefined) | undefined

/** 一次解析的结果：拿到值时给 `key`，以及永远给得出的事实描述。 */
export interface KeyReadResult {
  /** 解析到的密钥；`undefined` 表示当前未配置（或服务不可用）。 */
  readonly key?: string
  /** 给设置页的公开事实：是否配置、来源、能不能写。 */
  readonly state: KeyState
  /** 读过程出错时的脱敏描述（例如 credentials 服务不可用）；正常路径为 undefined。 */
  readonly error?: string
}

/** env 遮蔽时的只读文案：设置页原样展示，所以短、中文、且不含任何密钥。 */
const READONLY_MESSAGE = `${CREDENTIAL_REF} 由启动环境提供（只读），请改用环境变量管理`

/** 无 credentials 服务时保存失败的文案（契约固定措辞）。 */
const NO_PROVIDER_SAVE = 'DSH 未挂载 credentials 服务，无法保存密钥'

/** 无 credentials 服务时清除失败的文案：与保存保持同构，便于用户理解。 */
const NO_PROVIDER_CLEAR = 'DSH 未挂载 credentials 服务，无法清除密钥'

/** 形状检查失败的文案：说明失败原因，不回显用户输入。 */
const INVALID_KEY = '密钥为空或含空白字符'

/**
 * 把任意抛出物压成一行可展示文案。
 *
 * 这是「密钥零明文」的最后一道关卡：provider 的错误里可能夹带它收到的东西，
 * 所以先按已知明文逐字擦除（哨兵式密钥未必长得像 `sk-…`，正则兜不住），
 * 再过 `redactSecrets()`，最后截断——只有过完这三步才允许它进入 Error message
 * 或 HTTP 响应。
 *
 * @param error - catch 到的任意值。
 * @param fallback - 拿不到可用文本时的兜底中文文案。
 * @param secret - 本次操作涉及的密钥明文；给出时在文本中逐字抹掉。
 * @returns 不含密钥、长度受限的单行文本。
 */
function safeMessage(error: unknown, fallback: string, secret?: string): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''
  const scrubbed = secret === undefined || secret === '' ? raw : raw.replaceAll(secret, '<redacted>')
  const text = clampText(redactSecrets(scrubbed), 240).trim()
  return text === '' ? fallback : text
}

/**
 * 密钥解析器：env 优先（只读），其次 DSH credentials；写入只走 credentials。
 *
 * 实例只持有注入进来的依赖引用，没有模块级可变状态，因此多个插件实例
 * 或多次构造互不干扰。
 */
export class Keyring {
  private readonly source: CredentialSource

  private readonly ref: string

  private readonly env: Record<string, string | undefined>

  /**
   * @param source - credentials 服务（或桩），**或返回它的取值函数**；`undefined` 表示未挂载（env 仍可用）。
   * @param ref - 密钥引用名；env 变量名与 credentials 引用同名，缺省用 `CREDENTIAL_REF`。
   * @param env - 环境变量表；缺省 `process.env`（生产路径），测试可注入受控表。
   */
  constructor(
    source: CredentialSource,
    ref: string = CREDENTIAL_REF,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.source = source
    this.ref = ref
    this.env = env
  }

  /**
   * 当前 credentials 服务：来源是取值函数时**每次现取**。
   *
   * 为什么必须现取：`credentials` 对本插件是软依赖，而软依赖何时挂载不由本插件决定。
   * 在 `apply()` 里读一次就把结果缓存下来，一旦那次读到 `undefined`（挂载顺序在后，
   * 或本插件是运行期注入的），插件就被**永久**钉在「未挂载 credentials 服务」上：
   * env 里也没有该变量时，工具、门禁与分流会全部静默降级，而状态页只显示「未配置」，
   * 看不出真因。现取把这一失效模式从「永久」缩回「那一次调用」。
   */
  private get credentials(): CredentialProviderLike | undefined {
    return typeof this.source === 'function' ? this.source() : this.source
  }

  /**
   * 现场解析当前密钥，不做任何缓存。
   *
   * 优先级与降级：env 非空（trim 后）→ 直接用，且标为只读；否则问 credentials；
   * credentials 未挂载或读取失败 → 返回「未配置」并把脱敏原因放进 `error`。
   * 本方法不抛错：调用方（状态页 / 传输层）要的是一个总能展示的结果。
   *
   * @returns 解析结果；未配置时 `key` 为 undefined。
   */
  async read(): Promise<KeyReadResult> {
    const fromEnv = this.readEnv()
    if (fromEnv !== undefined) {
      return { key: fromEnv, state: { configured: true, source: 'env', writable: false } }
    }

    const credentials = this.credentials
    if (credentials === undefined) {
      return {
        state: { configured: false, source: 'none', writable: false },
        error: '未挂载 credentials 服务',
      }
    }

    let resolved: { value: string; source: string } | undefined
    try {
      resolved = await credentials.resolve(this.ref)
    } catch (error) {
      return {
        state: { configured: false, source: 'none', writable: false },
        error: safeMessage(error, 'credentials 服务读取失败'),
      }
    }

    // 空值等同于未配置：provider 自身也遵守「空值处处视为不存在」，两边判断一致。
    const value = resolved === undefined ? '' : resolved.value.trim()
    const described = await this.describeWritable()

    if (value === '') {
      return {
        state: { configured: false, source: 'none', writable: described.writable },
        ...(described.error === undefined ? {} : { error: described.error }),
      }
    }

    return {
      key: value,
      state: { configured: true, source: 'credential', writable: described.writable },
      ...(described.error === undefined ? {} : { error: described.error }),
    }
  }

  /**
   * 把密钥写进 credentials 服务（trim 后），供设置页调用。
   *
   * 失败即抛中文短句 Error，设置页原样展示；消息里不会有密钥值。
   * 被 env 遮蔽（本进程环境已有该变量，或 provider 报告不可写）时拒绝写入——
   * 否则写入会「看起来成功」，而解析仍然返回 env 里那份旧值。
   *
   * @param value - 用户输入的密钥原文；允许首尾空白，内部空白会被拒绝。
   * @throws Error 未挂载 credentials 服务 / 形状不合法 / 只读遮蔽 / provider 写入失败。
   */
  async save(value: string): Promise<void> {
    const credentials = this.credentials
    if (credentials === undefined) throw new Error(NO_PROVIDER_SAVE)
    if (!Keyring.looksValid(value)) throw new Error(INVALID_KEY)
    if (this.readEnv() !== undefined) throw new Error(READONLY_MESSAGE)

    const described = await this.describeWritable()
    if (!described.writable) throw new Error(READONLY_MESSAGE)

    try {
      await credentials.set(this.ref, value.trim())
    } catch (error) {
      throw new Error(safeMessage(error, '保存密钥失败', value.trim()))
    }

    // 成功后再解析一次：确认写入已生效（结果丢弃，调用方随后的状态查询会看到新值）。
    await this.read()
  }

  /**
   * 从 credentials 服务删除密钥，供设置页调用。
   *
   * 与 `save()` 同一套遮蔽规则：env 提供时不允许「清除」，因为清掉存储层
   * 并不会改变解析结果，只会让界面与实际来源不一致。
   *
   * @throws Error 未挂载 credentials 服务 / 只读遮蔽 / provider 删除失败。
   */
  async clear(): Promise<void> {
    const credentials = this.credentials
    if (credentials === undefined) throw new Error(NO_PROVIDER_CLEAR)
    if (this.readEnv() !== undefined) throw new Error(READONLY_MESSAGE)

    const described = await this.describeWritable()
    if (!described.writable) throw new Error(READONLY_MESSAGE)

    try {
      await credentials.unset(this.ref)
    } catch (error) {
      throw new Error(safeMessage(error, '清除密钥失败'))
    }
  }

  /**
   * 形状检查：非空且内部没有空白字符。
   *
   * 只做本地启发式，不做网络校验——「这把 key 现在能用吗」是 `probe()` 的职责，
   * 这里挡的是把空串或复制粘贴带进来的换行空格写进凭据存储。
   *
   * @param value - 待检查的密钥原文。
   * @returns 合法返回 true；空白串或含内部空白返回 false。
   */
  static looksValid(value: string): boolean {
    const trimmed = value.trim()
    return trimmed !== '' && !/\s/.test(trimmed)
  }

  /**
   * 取 env 里那份密钥（trim 后），空白视为未配置。
   *
   * @returns 非空的 env 值；没有或只有空白时返回 undefined。
   */
  private readEnv(): string | undefined {
    const raw = this.env[this.ref]
    if (typeof raw !== 'string') return undefined
    const value = raw.trim()
    return value === '' ? undefined : value
  }

  /**
   * 问 provider 这个引用能不能写；失败一律按「不能写」处理并带上脱敏原因。
   *
   * @returns 可写性；`error` 仅在 describe 调用失败时出现。
   */
  private async describeWritable(): Promise<{ writable: boolean; error?: string }> {
    const credentials = this.credentials
    if (credentials === undefined) return { writable: false }
    try {
      const info = await credentials.describe(this.ref)
      return { writable: info.writable }
    } catch (error) {
      return { writable: false, error: safeMessage(error, 'credentials 服务不可用') }
    }
  }
}

/**
 * @suxeca/dsh-typesafe — host 半装配层。
 *
 * 这个插件解决的问题：Jev（TypeSafe System One）能把自然语言与应用状态变成
 * **带概率的类型化判断**，但 DSH 里没有任何一处能拿到它——每个想用语义判断的
 * 插件都得自己管密钥、自己拼 HTTP、自己重试、自己缓存、自己记账。这里把它做成
 * 总线上的一个单例服务，其余插件/preset 只写 `inject: ['typesafe']`。
 *
 * 装配顺序（每步都可缺席降级）：
 * 1. `ctx.provide('typesafe', service)` —— 服务先上总线；
 * 2. `/typesafe` 路由 —— 设置页与宿主外脚本的入口；
 * 3. `settings` 命名空间 —— 预算（模型 / 超时 / 缓存 / 开关）热生效；
 * 4. `tools` —— 按设置暴露 `typesafe_eval`；
 * 5. `tools/pre-execute` —— 默认关闭的语义预审门禁；
 * 6. `ctx.provide('typesafeRouter', ...)` —— 默认关闭的分流适配器。
 *
 * 密钥不进设置：设置文档是明文 YAML，credentials 文档是 0600 且远端永不回值。
 *
 * @module @suxeca/dsh-typesafe
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { CREDENTIAL_REF, PLUGIN_VERSION, SETTINGS_NS, TYPESAFE_SETTINGS_DEFAULTS } from './shared.ts'
import type { TypesafeSettings } from './shared.ts'
import { Keyring } from './host/keyring.ts'
import type { CredentialProviderLike } from './host/keyring.ts'
import { createTypesafeService } from './host/service.ts'
import type { TypesafeService } from './host/service.ts'
import { registerTypesafeRoutes } from './host/routes.ts'
import type { RouteContext } from './host/routes.ts'
import { createTypesafeEvalTool } from './host/tool.ts'
import { registerPreflightGate } from './host/preflight.ts'
import type { GateContext } from './host/preflight.ts'
import { createRouterService } from './host/router.ts'

export const name = '@suxeca/dsh-typesafe'

/**
 * 硬依赖只有两个：路由表与设置服务。
 *
 * `credentials` 与 `tools` 都用 `ctx.get` / `ctx.inject` 软读取——
 * 少了 credentials 插件仍可只靠 env 工作，少了 tools 就没有 agent 工具，
 * 但服务与设置页照常。**不要让可选能力把整个插件卡在 waiting 状态。**
 */
export const inject = ['webServer', 'settings']

/** 本插件的设置命名空间 schema（settings provider 要求 kebab-case 命名空间）。 */
const SettingsSchema = Schema.object({
  model: Schema.string().default(TYPESAFE_SETTINGS_DEFAULTS.model),
  baseUrl: Schema.string().default(TYPESAFE_SETTINGS_DEFAULTS.baseUrl),
  timeoutMs: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.timeoutMs),
  maxRetries: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.maxRetries),
  cacheTtlMs: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.cacheTtlMs),
  cacheMaxEntries: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.cacheMaxEntries),
  logState: Schema.boolean().default(TYPESAFE_SETTINGS_DEFAULTS.logState),
  tool: Schema.boolean().default(TYPESAFE_SETTINGS_DEFAULTS.tool),
  preflight: Schema.object({
    enabled: Schema.boolean().default(TYPESAFE_SETTINGS_DEFAULTS.preflight.enabled),
    timeoutMs: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.preflight.timeoutMs),
    minConfidence: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.preflight.minConfidence),
  }).default(TYPESAFE_SETTINGS_DEFAULTS.preflight),
  router: Schema.object({
    enabled: Schema.boolean().default(TYPESAFE_SETTINGS_DEFAULTS.router.enabled),
    timeoutMs: Schema.number().default(TYPESAFE_SETTINGS_DEFAULTS.router.timeoutMs),
  }).default(TYPESAFE_SETTINGS_DEFAULTS.router),
})

/** settings 服务面上本插件用到的部分（结构类型：只写一次，编译期从运行库解析）。 */
interface SettingsScopeLike {
  get(): TypesafeSettings
  update(patch: object): Promise<void>
  watch(callback: (next: TypesafeSettings, prev: TypesafeSettings) => void | Promise<void>): () => void
}

/** 工具注册面。 */
interface ToolRegistryLike {
  register(tool: unknown): () => void
}

/** 日志面（cordis 的 logger 是可选的）。 */
interface LoggerLike { warn(message: string): void }

/**
 * 装配插件。
 *
 * @param ctx - host 上下文（已注入 webServer 与 settings）。
 */
export function apply(ctx: Context): void {
  const logger: LoggerLike = { warn: (message: string) => ctx.logger?.warn(message) }
  const loggerLike = ctx.logger === undefined ? undefined : logger

  // ── 密钥环：env 优先（只读），credentials 次之（可写）。不缓存，每次现读。 ──
  // 传**取值函数**而非服务本体：credentials 是软依赖，其挂载顺序不由本插件决定。
  // 在 apply() 里读一次并缓存，一旦那次读到 undefined（挂载在后，或本插件是运行期
  // 注入的），密钥环就永久停在「未挂载 credentials 服务」——而失败是静默的：工具只
  // 返回 no-key、分流 fail-open、状态页只显示「未配置」。现取把漏挂缩回那一次调用。
  const keyring = new Keyring(() => ctx.get('credentials') as CredentialProviderLike | undefined, CREDENTIAL_REF)

  // ── 设置快照：服务每次调用现读，所以设置一变立刻换挡。 ──
  let settings: TypesafeSettings = TYPESAFE_SETTINGS_DEFAULTS
  let scope: SettingsScopeLike | undefined

  const service: TypesafeService = createTypesafeService({
    getSettings: () => settings,
    keyring,
    logger: loggerLike,
  })

  // ── 可选能力的开关函数：两个注入槽（tools / settings）谁先就绪都能推进。 ──
  let enableTool: ((on: boolean) => void) | undefined
  let enableRouter: ((on: boolean) => void) | undefined

  /** 按当前设置同步可选能力（工具注册 / 分流服务 provide）。 */
  const syncOptional = (next: TypesafeSettings): void => {
    enableTool?.(next.tool)
    enableRouter?.(next.router.enabled)
  }

  // ── 1. 服务上总线。 ──
  // 注意：ctx.provide 自己**会**在名字已被活跃实例占用时抛 "has been registered at"；
  // 这里安全是因为它每次 apply 只调用一次，且 fiber 卸载时会先释放上一个实例。
  // 可变次数的 provide（下面的 typesafeRouter）必须自己用 disposer 守卫。
  ctx.provide('typesafe', service)

  // ── 2. HTTP 路由（从注入了 webServer 的外层上下文注册，accessor 才会解析）。 ──
  ctx.effect(() => registerTypesafeRoutes(ctx as unknown as RouteContext, {
    service,
    keyring,
    getTrustedHosts: () => {
      const webRuntime = ctx.get('webRuntime') as { trustedHosts?: readonly string[] } | undefined
      return webRuntime?.trustedHosts ?? []
    },
    updateSettings: async (patch: Record<string, unknown>) => {
      if (scope === undefined) throw new Error('settings 服务未挂载：无法保存设置')
      await scope.update(patch)
      return scope.get()
    },
    logger: loggerLike,
  }), '@suxeca/dsh-typesafe: /typesafe routes')

  // ── 3. 设置命名空间：register 与 watch 都挂在 fiber effect 上，卸载即净。 ──
  ctx.inject(['settings'], (settingsCtx) => {
    const settingsService = (settingsCtx as unknown as {
      settings: { register(ns: string, schema: unknown, options?: object): SettingsScopeLike }
    }).settings
    scope = settingsService.register(SETTINGS_NS, SettingsSchema, { applies: 'live' })
    settings = scope.get()
    service.reconfigure(settings)
    syncOptional(settings)
    // watch 的注销器必须接进 fiber：否则插件卸载/热重载后回调仍在跑，
    // 会往一个已 dispose 的上下文里重新 register 工具、重新 provide 服务。
    ctx.effect(() => scope?.watch((next) => {
      settings = next
      service.reconfigure(next)
      syncOptional(next)
    }) ?? (() => {}), '@suxeca/dsh-typesafe: settings watch')
  })

  // ── 4. Agent 工具：默认开；关掉后立刻从工具表消失。 ──
  ctx.inject(['tools'], (toolsCtx) => {
    const registry = (toolsCtx as unknown as { tools: ToolRegistryLike }).tools
    let disposer: (() => void) | undefined
    enableTool = (on: boolean) => {
      if (on && disposer === undefined) disposer = registry.register(createTypesafeEvalTool(service))
      if (!on && disposer !== undefined) {
        disposer()
        disposer = undefined
      }
    }
    // 两个注入槽（settings / tools）谁先就绪都可能发生，所以各自就绪时都按当前设置同步一次。
    enableTool(settings.tool)
  })

  // ── 5. 语义预审门禁：常挂监听，内部按设置判定（默认关）。 ──
  ctx.effect(() => registerPreflightGate(ctx as unknown as GateContext, {
    service,
    getSettings: () => settings,
    logger: loggerLike,
  }), '@suxeca/dsh-typesafe: bash preflight gate')

  // ── 6. 分流适配器：只在开启时 provide，preset 的副本用 ctx.get 软探测。 ──
  let routerDisposer: (() => void) | undefined
  enableRouter = (on: boolean) => {
    if (on) {
      if (routerDisposer === undefined) {
        routerDisposer = ctx.provide('typesafeRouter', createRouterService({ service, getSettings: () => settings }))
      }
      return
    }
    routerDisposer?.()
    routerDisposer = undefined
  }
  enableRouter(settings.router.enabled)

  ctx.logger?.info?.(`[typesafe] v${PLUGIN_VERSION} 就绪：ctx.typesafe 服务 + /typesafe 路由${settings.tool ? ' + typesafe_eval 工具' : ''}`)
}

/**
 * 装配级集成测试：不启动 DSH，也不联网，用一套最小的假上下文驱动真实的 `apply()`。
 *
 * 为什么值得写：单元测试覆盖了 transport / cache / keyring，但插件真正会翻车的地方在
 * **装配**——服务有没有上总线、路由有没有挂在注入了 webServer 的那个上下文上、
 * 工具是否按设置出现、门禁在判断失败时是否真的 fail-open、设置写入是否回到命名空间。
 * 这里逐条钉住这些行为，顺带证明「没有 credentials 服务时插件仍能加载」。
 *
 * @module @suxeca/dsh-typesafe/tests/plugin
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apply, inject, name } from '../src/index.ts'
import { TYPESAFE_SETTINGS_DEFAULTS } from '../src/shared.ts'
import type { Envelope, TypesafeSettings, TypesafeStatus } from '../src/shared.ts'

/** 被记录的 webServer 路由。 */
interface RecordedRoute {
  readonly kind: string
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** 一次 HTTP 往返的观测结果。 */
interface HttpResult { readonly status: number; readonly body: string }

/** 收集到的假上下文各面。 */
interface Harness {
  readonly ctx: unknown
  readonly providers: Map<string, unknown>
  readonly routes: RecordedRoute[]
  readonly tools: { name?: unknown }[]
  readonly events: Map<string, unknown[]>
  readonly credentialWrites: { ref: string; value: string }[]
  readonly credentialUnsets: string[]
  readonly settingsPatches: Record<string, unknown>[]
  readonly warnings: string[]
  /** 修改当前设置并触发 watch（模拟设置页写盘）。 */
  updateSettings(patch: Partial<TypesafeSettings>): Promise<void>
  /** 当前解析后的设置。 */
  currentSettings(): TypesafeSettings
  /** 模拟 credentials 服务在 `apply()` **之后**才挂载（软依赖的真实时序）。 */
  mountCredentials(): void
}

/** 造一个足够真、但完全离线的 DSH 上下文。 */
function createHarness(options: { credentials?: boolean } = {}): Harness {
  const providers = new Map<string, unknown>()
  const routes: RecordedRoute[] = []
  const tools: { name?: unknown }[] = []
  const events = new Map<string, unknown[]>()
  const credentialWrites: { ref: string; value: string }[] = []
  const credentialUnsets: string[] = []
  const settingsPatches: Record<string, unknown>[] = []
  const warnings: string[] = []
  const watchers: ((next: TypesafeSettings, prev: TypesafeSettings) => void | Promise<void>)[] = []

  let settings: TypesafeSettings = structuredClone(TYPESAFE_SETTINGS_DEFAULTS)

  // 可变的挂载状态：默认按选项定稿，`mountCredentials()` 可以把它翻成「已挂载」，
  // 用来复现「apply() 那一刻服务还没上来」这一真实时序。
  let credentialsMounted = options.credentials !== false

  const stored = new Map<string, string>()
  const credentials = {
    describe: async (ref: string) => ({ configured: stored.has(ref), source: 'file', writable: ref === 'TYPESAFE_API_KEY' }),
    resolve: async (ref: string) => {
      const value = stored.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    },
    set: async (ref: string, value: string) => { credentialWrites.push({ ref, value }); stored.set(ref, value) },
    unset: async (ref: string) => { credentialUnsets.push(ref); stored.delete(ref) },
  }

  const scope = {
    get: () => settings,
    update: async (patch: object) => {
      const next = { ...settings, ...patch as Partial<TypesafeSettings> }
      const prev = settings
      settings = next
      settingsPatches.push(patch as Record<string, unknown>)
      for (const watcher of watchers) await watcher(next, prev)
    },
    watch: (callback: (next: TypesafeSettings, prev: TypesafeSettings) => void | Promise<void>) => {
      watchers.push(callback)
      return () => { watchers.splice(watchers.indexOf(callback), 1) }
    },
  }

  const settingsService = {
    register: (ns: string, _schema: unknown, _options?: object) => {
      registeredNamespaces.push(ns)
      return scope
    },
  }
  const registeredNamespaces: string[] = []

  const ctx = {
    logger: { info: () => {}, warn: (message: string) => { warnings.push(message) } },
    provide: (serviceName: string, value: unknown) => {
      providers.set(serviceName, value)
      return () => { providers.delete(serviceName) }
    },
    get: (serviceName: string) => {
      if (serviceName === 'credentials') return credentialsMounted ? credentials : undefined
      if (serviceName === 'webRuntime') return { trustedHosts: [] }
      return providers.get(serviceName)
    },
    effect: (callback: () => unknown) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject: (names: readonly string[], callback: (scoped: unknown) => void) => {
      if (names.includes('settings')) callback({ settings: settingsService })
      if (names.includes('tools')) {
        callback({ tools: { register: (tool: { name?: unknown }) => { tools.push(tool); return () => { tools.splice(tools.indexOf(tool), 1) } } } })
      }
    },
    on: (event: string, handler: unknown) => {
      const list = events.get(event) ?? []
      list.push(handler)
      events.set(event, list)
      return () => { list.splice(list.indexOf(handler), 1) }
    },
    webServer: { register: (route: RecordedRoute) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } } },
  }

  return {
    ctx,
    providers,
    routes,
    tools,
    events,
    credentialWrites,
    credentialUnsets,
    settingsPatches,
    warnings,
    updateSettings: async (patch) => { await scope.update(patch) },
    currentSettings: () => settings,
    mountCredentials: () => { credentialsMounted = true },
  }
}

/** 走一遍插件的 HTTP 路由，拿回状态码与响应体。 */
async function callRoute(harness: Harness, method: string, url: string, body?: unknown): Promise<HttpResult> {
  const route = harness.routes.find(candidate => candidate.path === '/typesafe')
  expect(route, '应挂载 /typesafe 路由').toBeDefined()
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const request = {
    method,
    url,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage

  let status = 0
  let payload = ''
  const response = {
    writeHead: (code: number) => { status = code },
    end: (value: string) => { payload = value },
  } as unknown as ServerResponse
  await route?.handler(request, response)
  return { status, body: payload }
}

/** 解信封，断言成功。 */
function unwrap<T>(result: HttpResult): T {
  expect(result.status, result.body).toBe(200)
  const envelope = JSON.parse(result.body) as Envelope<T>
  expect(envelope.ok, result.body).toBe(true)
  if (!envelope.ok) throw new Error('信封为失败')
  return envelope.value
}

describe('插件元数据', () => {
  it('name 与 inject 面向 host composition', () => {
    expect(name).toBe('@suxeca/dsh-typesafe')
    expect(inject).toContain('webServer')
    expect(inject).toContain('settings')
  })
})

describe('装配', () => {
  it('把服务挂上总线、注册设置命名空间、挂路由、暴露工具', () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)

    const service = harness.providers.get('typesafe') as { evaluate?: unknown; status?: unknown; rerank?: unknown }
    expect(typeof service?.evaluate).toBe('function')
    expect(typeof service?.rerank).toBe('function')
    expect(typeof service?.status).toBe('function')

    expect(harness.routes.map(route => route.path)).toEqual(['/typesafe'])
    expect(harness.tools.map(tool => tool.name)).toEqual(['typesafe_eval'])
    expect(harness.events.get('tools/pre-execute')).toHaveLength(1)
    // 默认设置里 router 是关的：不应该多挂一个服务出来。
    expect(harness.providers.has('typesafeRouter')).toBe(false)
  })

  it('没有 credentials 服务时仍然加载（只靠 env）', () => {
    const harness = createHarness({ credentials: false })
    expect(() => { apply(harness.ctx as never, undefined as never) }).not.toThrow()
    expect(harness.providers.has('typesafe')).toBe(true)
  })

  it('关掉 tool 后工具从注册表消失，打开后回来', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    expect(harness.tools).toHaveLength(1)

    await harness.updateSettings({ tool: false })
    expect(harness.tools).toHaveLength(0)

    await harness.updateSettings({ tool: true })
    expect(harness.tools).toHaveLength(1)
  })

  it('打开 router 后多 provide 一个 typesafeRouter 服务', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    await harness.updateSettings({ router: { enabled: true, timeoutMs: 2000 } })
    const router = harness.providers.get('typesafeRouter') as { classify?: unknown }
    expect(typeof router?.classify).toBe('function')

    await harness.updateSettings({ router: { enabled: false, timeoutMs: 2000 } })
    expect(harness.providers.has('typesafeRouter')).toBe(false)
  })
})

describe('HTTP 路由', () => {
  it('GET /typesafe/status 返回未配置密钥的状态', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    const status = unwrap<{ key: { configured: boolean; source: string; writable: boolean }; totals: { calls: number } }>(
      await callRoute(harness, 'GET', '/typesafe/status'),
    )
    expect(status.key.configured).toBe(false)
    expect(status.key.source).toBe('none')
    expect(status.totals.calls).toBe(0)
  })

  it('POST /typesafe/key 写入凭据，但响应里绝不回显密钥', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    const secret = 'apikey_test_sentinel_value_do_not_leak'
    const value = unwrap<{ configured: boolean }>(await callRoute(harness, 'POST', '/typesafe/key', { value: secret }))

    expect(harness.credentialWrites).toEqual([{ ref: 'TYPESAFE_API_KEY', value: secret }])
    expect(value.configured).toBe(true)
    expect(JSON.stringify(value)).not.toContain(secret)
  })

  it('DELETE /typesafe/key 走 unset', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    unwrap(await callRoute(harness, 'DELETE', '/typesafe/key'))
    expect(harness.credentialUnsets).toEqual(['TYPESAFE_API_KEY'])
  })

  /**
   * 软依赖的时序回归：credentials 是 `ctx.get` 软取的，挂载时刻不由本插件决定
   * （宿主服务启动顺序、以及本插件被运行期注入的情形都会晚于 apply()）。
   *
   * 为什么这条测试是装配级的而不是单元级的：真正的失效点不在密钥环内部，而在
   * **接线**——只要有人在 `apply()` 里把服务本体读一次并缓存下来，密钥保存、
   * 语义工具、分流就会一起永久失效，而表现是静默的（no-key / fail-open /
   * 「未配置」）。所以这里从 HTTP 路由进，走一遍用户真正会点的那条路。
   */
  it('credentials 晚于 apply() 挂载时，密钥保存立刻可用（不得在装配期定稿）', async () => {
    const harness = createHarness({ credentials: false })
    apply(harness.ctx as never, undefined as never)
    const secret = 'apikey_test_late_mount_sentinel'

    // 装配时没有 credentials：如实报「未挂载」，且不产生任何写入。
    const before = await callRoute(harness, 'POST', '/typesafe/key', { value: secret })
    expect(before.status).not.toBe(200)
    expect(harness.credentialWrites).toEqual([])

    // 服务随后挂载：同一个插件实例必须立刻能用，不需要重载或重启。
    harness.mountCredentials()
    const after = unwrap<{ configured: boolean }>(await callRoute(harness, 'POST', '/typesafe/key', { value: secret }))

    expect(after.configured).toBe(true)
    expect(harness.credentialWrites).toEqual([{ ref: 'TYPESAFE_API_KEY', value: secret }])
  })

  it('POST /typesafe/settings 合并补丁并回读解析值', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    const next = unwrap<TypesafeSettings>(await callRoute(harness, 'POST', '/typesafe/settings', { patch: { timeoutMs: 1234 } }))
    expect(next.timeoutMs).toBe(1234)
    expect(harness.currentSettings().timeoutMs).toBe(1234)
  })

  /**
   * 端到端可见性：这正是今天真实踩到的那个坑。
   *
   * 没有密钥时，语义工具只回 `no-key`、分流 fail-open 返回 undefined、门禁一律放行——
   * 三者都刻意不打断主流程，于是插件可以在完全不可用的状态下运行很久而**没人知道**。
   * 所以这条测试断言的不是「失败会抛错」（那早就成立），而是「失败会留下痕迹」：
   * 日志里有一条脱敏告警，状态里能读出降级与原因。
   */
  it.skipIf((process.env.TYPESAFE_API_KEY ?? '').trim() !== '')('无密钥时失败会在日志与状态里留下痕迹', async () => {
    const harness = createHarness({ credentials: false })
    apply(harness.ctx as never, undefined as never)
    const payload = { state: '任意文本', questions: { q: { type: 'noul', instructions: '是？' } } }

    const first = await callRoute(harness, 'POST', '/typesafe/eval', payload)
    const second = await callRoute(harness, 'POST', '/typesafe/eval', payload)
    expect(first.status).not.toBe(200)
    expect(second.status).not.toBe(200)

    // 日志：一条脱敏告警（第二次被节流，不重复刷），且带上分类。
    const healthLines = harness.warnings.filter(line => line.includes('typesafe 判断失败'))
    expect(healthLines).toHaveLength(1)
    expect(healthLines[0]).toContain('no-key')

    // 状态：降级、连续次数与原因都可读。
    const status = unwrap<TypesafeStatus>(await callRoute(harness, 'GET', '/typesafe/status'))
    expect(status.health.degraded).toBe(true)
    expect(status.health.consecutiveFailures).toBe(2)
    expect(status.health.lastErrorCode).toBe('no-key')
    expect(status.health.lastErrorAt).toBeTypeOf('number')
    expect(status.lastError).toContain('no-key')
  })

  it('POST /typesafe/eval 缺 questions 时是 400，且一次网络都不发', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    const result = await callRoute(harness, 'POST', '/typesafe/eval', { state: 'x' })
    expect(result.status).toBe(400)
    expect(result.body).toContain('questions')
  })

  it('跨站标记被围栏挡在 403', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    const route = harness.routes[0]
    let status = 0
    await route?.handler({
      method: 'GET',
      url: '/typesafe/status',
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    } as unknown as IncomingMessage, { writeHead: (code: number) => { status = code }, end: () => {} } as unknown as ServerResponse)
    expect(status).toBe(403)
  })

  it('未知路由是 404', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    expect((await callRoute(harness, 'GET', '/typesafe/nope')).status).toBe(404)
  })
})

describe('危险命令预审门禁', () => {
  /** 取出注册的 pre-execute 处理器。 */
  function gateOf(harness: Harness): (exec: unknown, next: () => Promise<unknown>) => Promise<unknown> {
    return (harness.events.get('tools/pre-execute') as ((exec: unknown, next: () => Promise<unknown>) => Promise<unknown>)[])[0]
  }

  it('默认关闭时直接委托 next，不做任何判断', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    const next = vi.fn(async () => ({ kind: 'allow' }))
    const decision = await gateOf(harness)({ name: 'bash', arguments: { command: 'rm -rf /data' } }, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('开启后无害命令仍走零开销路径（正则不命中，不看模型）', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    await harness.updateSettings({ preflight: { enabled: true, timeoutMs: 500, minConfidence: 0.9 } })
    const next = vi.fn(async () => ({ kind: 'allow' }))
    const decision = await gateOf(harness)({ name: 'bash', arguments: { command: 'ls -la' } }, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ kind: 'allow' })
    // 没配密钥 → 没有真实判断发生，也就没有观测记录。
    const service = harness.providers.get('typesafe') as { recent: () => readonly unknown[] }
    expect(service.recent()).toHaveLength(0)
  })

  it('开启后危险命令判断失败（无密钥）仍 fail-open 放行，并留下日志', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    await harness.updateSettings({ preflight: { enabled: true, timeoutMs: 500, minConfidence: 0.9 } })
    const next = vi.fn(async () => ({ kind: 'allow' }))
    const decision = await gateOf(harness)({ name: 'bash', arguments: { command: 'rm -rf /home/suxeca/Workspace/data' } }, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ kind: 'allow' })
    expect(harness.warnings.some(line => line.includes('preflight'))).toBe(true)
  })

  it('非 bash 工具不看', async () => {
    const harness = createHarness()
    apply(harness.ctx as never, undefined as never)
    await harness.updateSettings({ preflight: { enabled: true, timeoutMs: 500, minConfidence: 0.9 } })
    const next = vi.fn(async () => ({ kind: 'allow' }))
    await gateOf(harness)({ name: 'read', arguments: { file_path: '/tmp/rm -rf x' } }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('判断成功但下游抛错时，next 只被调用一次（回归：next() 绝不在 try 内）', async () => {
    // V4 审查发现的高危回归：若 `return next()` 留在 try 里，下游链抛错会被 catch
    // 当成「判断失败」再调一次 next()，一条 bash 命令就有了被执行两次的路径。
    process.env.TYPESAFE_API_KEY = 'apikey_regression_sentinel'
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { q: { type: 'choice', choice: 'safe', probabilities: { safe: 1, risky: 0, destructive: 0 }, confidence: 1 } },
      usage: { input_tokens: 7, output_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const harness = createHarness()
      apply(harness.ctx as never, undefined as never)
      await harness.updateSettings({ preflight: { enabled: true, timeoutMs: 500, minConfidence: 0.9 } })
      const next = vi.fn(async (): Promise<{ kind: 'allow' }> => { throw new Error('downstream exploded') })

      await expect(gateOf(harness)({ name: 'bash', arguments: { command: 'rm -rf /data/x' } }, next))
        .rejects.toThrow('downstream exploded')

      expect(next).toHaveBeenCalledTimes(1)
      // 判断本身成功了，底层错误不该被误报成「判断失败」。
      expect(harness.warnings.some(line => line.includes('判断失败'))).toBe(false)
    } finally {
      delete process.env.TYPESAFE_API_KEY
      vi.unstubAllGlobals()
    }
  })

  it('判为不可逆破坏且置信度够高时拒绝执行', async () => {
    process.env.TYPESAFE_API_KEY = 'apikey_regression_sentinel'
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { q: { type: 'choice', choice: 'destructive', probabilities: { safe: 0, risky: 0.05, destructive: 0.95 }, confidence: 0.95 } },
      usage: { input_tokens: 7, output_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const harness = createHarness()
      apply(harness.ctx as never, undefined as never)
      await harness.updateSettings({ preflight: { enabled: true, timeoutMs: 500, minConfidence: 0.9 } })
      const next = vi.fn(async () => ({ kind: 'allow' }))

      const decision = await gateOf(harness)({ name: 'bash', arguments: { command: 'rm -rf /home/suxeca/Workspace/data' } }, next) as { kind: string; reason?: string }

      expect(decision.kind).toBe('deny')
      expect(decision.reason).toContain('不可逆破坏')
      expect(next).not.toHaveBeenCalled()
    } finally {
      delete process.env.TYPESAFE_API_KEY
      vi.unstubAllGlobals()
    }
  })
})

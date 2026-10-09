/**
 * @suxeca/dsh-dev-probes — 开发期验证探针。
 *
 * 三个探针各自解决一个「没法用常规手段验证」的问题。它们的存在理由不是方便，
 * 而是**没有它们就只能拿会话去试错**——而会话试错的代价是一次 DSH 起不来。
 *
 * 1. `dsh_preset_probe`
 *    用 Python 的 YAML loader 只能证明「YAML 语法没写错」，证明不了「DSH 的
 *    loader 认可这份 composition」。后者才是决定下次开新会话能不能起来的那件事。
 *
 * 2. `dsh_preset_parse_check`
 *    `compositionInventory()` 有个关键语义：**有活跃挂载的 preset 回答的是「已装配
 *    的那一代」，不是磁盘上现在的文件**。所以直接查一个正在用的 preset，拿到的
 *    永远是旧答案。这个探针把 preset 复制成临时 id——副本「从没被装配过」，于是
 *    registry 会**读盘回答**——看完判决再把副本删掉。`PARSES` 因此是对磁盘真实
 *    字节的判决。
 *
 * 3. `dsh_client_graph_probe`
 *    `/plugins/<id>/client.js` 在 web 鉴权门后面，curl 对它给不出任何信息（确定
 *    能用的插件同样 404）。host 自己的 `clientModules.graph()` 才是权威答案。
 *
 * 4. `dsh_profile_preflight`
 *    前三个都不覆盖「**下次 profile 能不能起来**」：preset 检查只验 agent preset，
 *    client graph 只在**已经起来之后**才有答案。而 profile 层最贵的失败恰恰是
 *    自举失败——loader 对 `bundles` 里每一项都要求 `dsh.bundle.patch`，缺了就在
 *    启动路径上 throw，于是**关掉就再也起不来**，只能手改 JSON 把自己捞出来。
 *    这个探针复刻 loader 自己的判定，所以它答的就是启动路径会问的那个问题。
 *
 * 服务全部走 `ctx.get()` 可选访问：探针本身永远不会因为某个服务缺席而装不上，
 * 缺席时它的工具返回「服务不可用」，而不是让插件停在 parked 状态。
 *
 * 规范：资源注册必须挂 ctx.effect（热重载/卸载自动清理）。
 *
 * @module @suxeca/dsh-dev-probes
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import vm from 'node:vm'
import { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = '@suxeca/dsh-dev-probes'

/** `tools` 是硬依赖（注册工具）；`agentPresets` / `clientModules` 走可选访问。 */
export const inject = ['tools']

export interface Config {
  /** 解析体检默认检查的 preset id。 */
  defaultPreset: string
}

export const Config = z.object({
  defaultPreset: z.string().default('z3-theory-research'),
})

/** 临时注册用的 id 前缀；实际 id 每次调用再拼时间戳，避免撞上上次崩溃留下的残留。 */
const PROBE_ID = 'zz-parse-probe'

/** 工具统一返回 JSON 文本。 */
const output = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

/** 从任意行对象里挑出能显示身份的字段（row 形状随版本变，不硬编码）。 */
function rowLabel(entry: unknown): Record<string, unknown> {
  if (entry === null || typeof entry !== 'object') return { raw: String(entry) }
  const record = entry as Record<string, unknown>
  return {
    entryId: record.entryId ?? record.id ?? record.rowId ?? record.key,
    module: record.moduleName ?? record.name ?? record.plugin ?? record.module,
    enabled: record.enabled,
    condition: record.condition,
  }
}

/** 错误信息取字符串，避免 `[object Object]`。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * dsh 应用目录 —— `resolveBundleDir` 的**第一个**锚点。
 *
 * 在 DSH 进程内 `process.argv[1]` 就是 `<appDir>/lib/bin.js`，这是最可靠的来源：
 * 不必猜 PATH 上的 shim，也不必依赖环境变量。
 */
function installAnchor(): string | undefined {
  const argv1 = process.argv[1]
  if (argv1 !== undefined && argv1 !== '') {
    let dir = dirname(argv1)
    while (dir !== '/' && dir !== '.') {
      if (existsSync(join(dir, 'package.json'))) return dir
      dir = dirname(dir)
    }
  }
  const checkout = process.env.DSH_CHECKOUT
  if (checkout !== undefined && checkout !== '') {
    const candidate = join(checkout, 'apps', 'cli')
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * 复刻 `resolveBundleDir`：**安装锚点优先，profile 兜底**。
 *
 * 顺序是契约，不是实现细节：`@deepseek-ai/dsh-base` 这类 in-box bundle 永远来自
 * 运行中的 dsh 安装，而不是 profile 本地副本。所以它们**不在** profile 的
 * `node_modules` 里，只查 profile 会把它们全判成坏的。
 */
function resolveBundleDir(
  packageName: string, anchor: string | undefined, profileDir: string,
): string | undefined {
  const anchors: string[] = []
  if (anchor !== undefined) anchors.push(join(anchor, 'package.json'))
  anchors.push(join(profileDir, 'package.json'))
  for (const from of anchors) {
    let paths: string[] | null
    try {
      // `resolve.paths` 不在 @types/node 里，但它是 node 的稳定 API。
      const resolver = createRequire(from) as unknown as { resolve: { paths(name: string): string[] | null } }
      paths = resolver.resolve.paths(packageName)
    } catch {
      continue
    }
    for (const searchPath of paths ?? []) {
      const candidate = join(searchPath, packageName)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  return undefined
}

export function apply(ctx: Context, config: Config): void {
  // ── 1. composition 体检 ─────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_preset_probe',
    description: [
      'Read-only health report on an agent preset composition, from the REAL registry.',
      'CALL THIS BEFORE RESTARTING DSH after editing any preset agent.cordis.yml: it is the',
      'only way to know the loader accepts the composition, since a YAML parser only proves',
      'the syntax is valid, not that DSH will mount it. Returns parse brokenness, row count,',
      'row identities and the preset roster. Note: for a preset with a live session this',
      'answers from the already-composed generation, so use dsh_preset_parse_check to judge',
      'the bytes on disk instead.',
    ].join(' '),
    parameters: {
      id: { type: 'string', description: 'Preset id; omit for the configured default.' },
    },
    output,
    async execute(args: { id?: string }) {
      const presets = ctx.get('agentPresets') as {
        compositionInventory(): Promise<unknown[]>
      } | undefined
      if (presets === undefined) return JSON.stringify({ ok: false, error: 'agentPresets service unavailable' })
      const wanted = args?.id ?? config.defaultPreset
      const inventory = await presets.compositionInventory()
      const found = inventory.find((row) => (row as { id?: string })?.id === wanted)
      if (found === undefined) {
        return JSON.stringify({
          ok: true,
          found: false,
          wanted,
          available: inventory.map((row) => (row as { id?: string })?.id),
        }, null, 2)
      }
      const record = found as Record<string, unknown>
      const raw = (record.rows ?? record.plugins ?? record.entries ?? []) as unknown[]
      return JSON.stringify({
        ok: true,
        found: true,
        id: record.id,
        // `null` here is the good outcome: the loader parsed the composition.
        broken: record.broken ?? null,
        rowCount: Array.isArray(raw) ? raw.length : 0,
        rows: Array.isArray(raw) ? raw.map(rowLabel) : [],
      }, null, 2)
    },
  })), '@suxeca/dsh-dev-probes: preset probe')

  // ── 2. 磁盘字节级解析判决 ───────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_preset_parse_check',
    description: [
      'The DECISIVE test that an edited preset composition will mount, and the one to use',
      'whenever the preset has a live session. A mount failure is FINAL for the process, so a',
      'preset that failed once never re-tests itself — this registers the preset\'s declared',
      'composition under a throwaway id, which forces a FRESH mount and a fresh verdict, then',
      'unregisters it in a finally block so it cannot leak even on failure.',
      'A verdict of PARSES means the composition the registry holds is mountable.',
      'Note: it re-mounts the declaration the registry has loaded (the Loader hot-reloads',
      'profile-patch edits, so that normally tracks the file), not raw bytes off disk.',
    ].join(' '),
    parameters: {
      from: { type: 'string', description: 'Source preset id; omit for the configured default.' },
    },
    output,
    async execute(args: { from?: string }) {
      const presets = ctx.get('agentPresets') as {
        compositionInventory(): Promise<unknown[]>
        readDocument(id: string): Promise<{ agentPreset: string, content: string, name?: string, description?: string }>
        register(definition: {
          id: string, name?: string, description?: string, plugins: unknown[]
        }): Promise<() => Promise<void>>
      } | undefined
      if (presets === undefined) return JSON.stringify({ ok: false, error: 'agentPresets service unavailable' })
      const from = args?.from ?? config.defaultPreset
      // 每次调用一个全新 id：新 registry 没有 remove()，固定 id 一旦撞上上次崩溃的残留，
      // register() 会直接以 duplicate 抛错。
      const probeId = `${PROBE_ID}-${Date.now().toString(36)}`
      const report: Record<string, unknown> = {
        from, probeId, declaredRows: null, registered: false, verdict: null, removed: false, error: null,
      }
      let unregister: (() => Promise<void>) | undefined
      try {
        // 动态 import：解析依赖只影响这一个工具，缺了也不会拖垮另外三个探针。
        const yaml = await import('js-yaml')
        const { entryListSchema } = await import('@deepseek-ai/cordis-plugin-include')
        // readDocument 是 registry 的公开读口（Web 端读同一份），返回 Loader 自己的 YAML
        // 方言：`!!js` 行能原样往返成表达式节点，而不是退化成普通字符串。
        const document = await presets.readDocument(from)
        const plugins = yaml.load(document.content, { schema: entryListSchema })
        if (!Array.isArray(plugins)) throw new Error('readDocument returned a non-list composition')
        report.declaredRows = plugins.length
        unregister = await presets.register({
          id: probeId,
          ...(document.name === undefined ? {} : { name: document.name }),
          ...(document.description === undefined ? {} : { description: document.description }),
          plugins,
        })
        report.registered = true
        // 全新 id 是从零组合的，所以这份判决是新鲜的 —— 哪怕源 preset 自己的 `broken`
        // 在本进程里已经是终局（mount 失败不可翻转）。
        const inventory = await presets.compositionInventory()
        const row = inventory.find((entry) => (entry as { id?: string })?.id === probeId)
        if (row === undefined) {
          report.error = 'registered probe did not appear in the inventory'
        } else {
          const record = row as Record<string, unknown>
          report.verdict = record.broken ?? 'PARSES'
          const raw = (record.rows ?? record.plugins ?? record.entries ?? plugins) as unknown[]
          report.rowCount = Array.isArray(raw) ? raw.length : 0
        }
      } catch (error) {
        report.error = messageOf(error)
      } finally {
        if (unregister !== undefined) {
          try {
            await unregister()
            report.removed = true
          } catch (error) {
            report.error = `${String(report.error ?? '')} | cleanup failed: ${messageOf(error)}`
          }
        }
      }
      report.ok = report.error === null
      return JSON.stringify(report, null, 2)
    },
  })), '@suxeca/dsh-dev-probes: preset parse check')

  // ── 3. 客户端 boot graph 存在性与启动沙箱冒烟 ─────────────────────────────
  function smokeTestClientBundle(clientPath: string): { pass: boolean; verdict: string; error?: string } {
    try {
      if (!existsSync(clientPath)) {
        return { pass: false, verdict: 'FAIL', error: `Bundle file not found: ${clientPath}` }
      }
      const code = readFileSync(clientPath, 'utf8')
      let factory: ((req: (spec: string) => any) => any) | null = null
      const sandbox: Record<string, any> = {
        window: {
          __ModuleLoader__: {
            load: (reg: any) => { factory = reg?.factory ?? null },
          },
        },
        console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
        setTimeout: (fn: any) => setTimeout(fn, 0),
        clearTimeout: (id: any) => clearTimeout(id),
        URL,
        Blob,
      }
      vm.createContext(sandbox)
      vm.runInContext(code, sandbox, { timeout: 3000 })
      if (!factory) {
        return { pass: false, verdict: 'FAIL', error: 'Bundle executed but did not register via window.__ModuleLoader__.load' }
      }
      const mockRequire = (spec: string): any => {
        if (spec === 'react') {
          return {
            useEffect: () => {},
            useState: (init: any) => [typeof init === 'function' ? init() : init, () => {}],
            useMemo: (fn: any) => fn(),
            useCallback: (fn: any) => fn(),
            useRef: (init: any) => ({ current: init }),
          }
        }
        if (spec === 'react/jsx-runtime') {
          return { jsx: () => null, jsxs: () => null, Fragment: Symbol.for('react.fragment') }
        }
        if (spec === 'react-dom') {
          return { createPortal: (children: any) => children }
        }
        return {}
      }
      const pluginExports = (factory as any)(mockRequire)
      if (!pluginExports || typeof pluginExports.apply !== 'function') {
        return { pass: false, verdict: 'FAIL', error: 'Module exports no valid apply function' }
      }
      const mockCtx = new Context()
      mockCtx.provide('slots', {
        inject: (name: string, cb: () => any) => {
          try { return cb() } catch {}
        },
        register: () => () => {},
        registerFactory: () => () => {},
      })
      const fiber = mockCtx.plugin(pluginExports)
      if ((fiber as any)._error) {
        const err = (fiber as any)._error
        return { pass: false, verdict: 'FAIL', error: messageOf(err) }
      }
      return { pass: true, verdict: 'PASS' }
    } catch (err: any) {
      return { pass: false, verdict: 'FAIL', error: messageOf(err) }
    }
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_client_graph_probe',
    description: [
      'Report whether one client (UI) plugin id is in the browser BOOT GRAPH, with its load phase,',
      'and perform an in-sandbox client boot execution test to verify fiber activation without throwing.',
      'CALL THIS after installing, injecting or reloading any client plugin. Omit id to list all.',
    ].join(' '),
    parameters: {
      id: { type: 'string', description: 'Client plugin package id to look for; omit to list all.' },
      smoke: { type: 'boolean', description: 'Run simulated browser fiber execution smoke test. Defaults to true when id is specified.' },
    },
    output,
    async execute(args: { id?: string; smoke?: boolean }) {
      const modules = ctx.get('clientModules') as { graph(): unknown; clientPath?(id: string): string | undefined } | undefined
      if (modules === undefined) return JSON.stringify({ ok: false, error: 'clientModules service unavailable' })
      const graph = modules.graph() as Record<string, unknown>
      const raw = (graph.entries ?? graph.modules ?? []) as unknown[]
      const rows = (Array.isArray(raw) ? raw : []).map((entry) => {
        const outer = entry as Record<string, unknown>
        const inner = ((outer?.entry ?? outer) ?? {}) as Record<string, unknown>
        const bundle = outer?.bundle ?? inner?.bundle
        return {
          id: inner?.id,
          phase: outer?.phase,
          bytes: bundle instanceof Uint8Array ? bundle.length : undefined,
        }
      })
      const ids = rows.map(row => row.id)
      if (args?.id === undefined) {
        return JSON.stringify({ ok: true, total: rows.length, ids }, null, 2)
      }
      const hit = rows.find(row => row.id === args.id)
      let smokeResult: { pass: boolean; verdict: string; error?: string } | undefined
      const doSmoke = args.smoke ?? (hit !== undefined)
      if (hit !== undefined && doSmoke) {
        const clientPath = typeof modules.clientPath === 'function' ? modules.clientPath(args.id) : undefined
        if (clientPath !== undefined) {
          smokeResult = smokeTestClientBundle(clientPath)
        }
      }
      return JSON.stringify({
        ok: smokeResult !== undefined ? smokeResult.pass : hit !== undefined,
        wanted: args.id,
        present: hit !== undefined,
        hit: hit ?? null,
        smoke: smokeResult ?? null,
        total: rows.length,
        ids,
      }, null, 2)
    },
  })), '@suxeca/dsh-dev-probes: client graph probe')

  // ── 4. profile 启动预检 ─────────────────────────────────────────────────
  //
  // 这是唯一一个「在重启**之前**回答下次能不能起来」的检查。它的存在理由来自
  // 一次真实事故：一个包被加进 `dsh.profile.bundles`，但它没有 `dsh.bundle.patch`，
  // 于是 DSH 关掉之后再也起不来 —— 只能手改 profile 的 JSON 才能自救。
  //
  // 判定逻辑是**复刻 loader 自己的**（app-boot/src/profile.ts 的 resolveBundleDir
  // 与那句 `declares no dsh.bundle` 的检查），不是另写一套近似规则：近似规则会
  // 给出与真实启动路径不同的答案，而一个和真相不一致的检查比没有检查更糟。
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_profile_preflight',
    description: [
      'Predict whether the NEXT DSH start will survive the profile bundle layer, before you',
      'restart. CALL THIS after adding any package to dsh.profile.bundles, and before every',
      'restart that follows a profile edit. The loader requires every bundled package to declare',
      'dsh.bundle.patch and throws on startup when one does not — which turns a bad edit into a',
      'DSH that will not come back up, recoverable only by hand-editing the profile JSON.',
      'This mirrors the loader\'s own two-anchor resolution (installation first, profile second),',
      'so in-box bundles such as @deepseek-ai/dsh-base are judged correctly rather than reported',
      'as missing. Pass `with` to preview a package you are about to add.',
    ].join(' '),
    parameters: {
      profile: { type: 'string', description: 'Profile name to check. Defaults to "web".' },
      with: { type: 'string', description: 'A package name to check as if it were already in bundles, without editing anything.' },
    },
    output,
    async execute(args: { profile?: string, with?: string }) {
      const profileName = args?.profile ?? 'web'
      const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
      const profileDir = join(home, 'profiles', profileName)
      const manifestPath = join(profileDir, 'package.json')
      if (!existsSync(manifestPath)) {
        return JSON.stringify({ ok: false, error: `profile 不存在: ${profileDir}` })
      }
      let bundles: string[]
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          dsh?: { profile?: { bundles?: string[] } }
        }
        bundles = manifest.dsh?.profile?.bundles ?? []
      } catch (error) {
        return JSON.stringify({ ok: false, error: `profile package.json 解析失败: ${messageOf(error)}` })
      }

      const preview = args?.with !== undefined && args.with !== '' && !bundles.includes(args.with)
        ? args.with
        : undefined
      const list = preview === undefined ? bundles : [...bundles, preview]
      const anchor = installAnchor()

      const failures: Array<{ package: string, reason: string }> = []
      const passed: string[] = []
      for (const packageName of list) {
        const dir = resolveBundleDir(packageName, anchor, profileDir)
        if (dir === undefined) {
          failures.push({ package: packageName, reason: '两个锚点都解析不到 —— loader 会 throw' })
          continue
        }
        let declared: string | string[] | undefined
        try {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
            dsh?: { bundle?: { patch?: string | string[] } }
          }
          declared = pkg.dsh?.bundle?.patch
        } catch (error) {
          failures.push({ package: packageName, reason: `package.json 解析失败: ${messageOf(error)}` })
          continue
        }
        if (declared === undefined) {
          failures.push({ package: packageName, reason: '缺 dsh.bundle.patch —— loader 会 throw，DSH 起不来' })
          continue
        }
        // 复刻 app-boot 的 bundlePatchFiles：string 是单文件，array 是「有序文件列表」，
        // 其它类型是硬 throw。0.2.0-rc.2 起 @deepseek-ai/dsh-web-app 正是用数组声明
        // presets/*.patch.yml，所以只看第一个文件会把其余 patch 的缺失/空文件漏判。
        const files = typeof declared === 'string' ? [declared] : declared
        if (!Array.isArray(files) || !files.every(file => typeof file === 'string')) {
          failures.push({ package: packageName, reason: 'dsh.bundle.patch 既不是路径也不是路径列表 —— loader 会 throw' })
          continue
        }
        const broken: string[] = []
        for (const file of files) {
          const patchPath = join(dir, file)
          if (!existsSync(patchPath)) {
            broken.push(`${file}（文件不存在）`)
            continue
          }
          if (readFileSync(patchPath, 'utf8').trim() === '') broken.push(`${file}（空文件）`)
        }
        if (broken.length > 0) {
          failures.push({ package: packageName, reason: `声明了 dsh.bundle.patch 但有问题: ${broken.join('; ')}` })
          continue
        }
        passed.push(packageName)
      }

      return JSON.stringify({
        ok: true,
        profile: profileName,
        profileDir,
        installAnchor: anchor ?? '（未找到，可能漏判 in-box bundle）',
        checked: list.length,
        previewed: preview ?? null,
        // FAIL 是判决，不是错误：ok:true + verdict:FAIL 表示探针工作正常，
        // 而 profile 现在这一层会让 DSH 起不来。
        verdict: failures.length === 0 ? 'PASS' : 'FAIL',
        failures,
        passed,
      }, null, 2)
    },
  })), '@suxeca/dsh-dev-probes: profile preflight')
}

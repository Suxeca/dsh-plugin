# 契约规格（SPEC）

本文件是 `@suxeca/dsh-typesafe` 的实现契约：线上协议形状、本地各组件的语义边界、
装配顺序与不变量。所有签名与默认值与 `src/` 对齐；与代码冲突时以代码为准。

## 1. 线上协议

### 1.1 端点与常量

| 常量 | 值 |
| --- | --- |
| `DEFAULT_BASE_URL` | `https://api.typesafe.ai` |
| `EVAL_PATH` | `/v1/systemone` |
| `MODELS_PATH` | `/v1/models` |
| `DEFAULT_MODEL` | `jev-latest` |
| `API_PREFIX` | `/typesafe` |
| `SETTINGS_NS` | `typesafe` |
| `CREDENTIAL_REF` | `TYPESAFE_API_KEY` |
| `PLUGIN_VERSION` | `0.1.0` |

### 1.2 条目类型

```
EntryValue = string | number | boolean | null | EntryValue[] | { [key: string]: EntryValue }
EntryType  = string | EntryValue[] | { [key: string]: EntryValue } | null
```

`state` / `instructions` / `criteria` 统一用 `EntryType`：与线上协议同宽，但
**裸 number / boolean 不是合法条目**（嵌套值里可以）。违反会在本地被
`assertPayload` 以 `invalid-request` 拒绝。

### 1.3 请求与应答

- `SystemOneRequest`：`{ state: EntryType, questions: Questions, model?: string }`
- `SystemOneResponse`：`{ model: string, answers: Record<string, Answer>, usage: Usage }`
  - `model` 是真正作答的版本号（例如 `jev-1.13.0`）
  - `Usage`：`{ input_tokens: number, output_tokens: number }`
  - host 信任服务端之前先跑 `isSystemOneResponse()`

问题（`Questions` 的 key 由调用方自取，不送给模型）：

| 原语 | 形状 | 约束 |
| --- | --- | --- |
| `noul` | `{ type: 'noul', instructions, criteria?: { true, false } }` | `criteria` 可选 |
| `choice` | `{ type: 'choice', instructions, criteria: Record<string, EntryType> }` | 至少 1 个、最多 255 个选项 |
| `score` | `{ type: 'score', instructions, criteria: EntryType[] }` | 2–10 级 |

答案：

| 原语 | 形状 |
| --- | --- |
| `noul` | `{ type: 'noul', noul: number }`（yes 概率，0..1，无 confidence） |
| `choice` | `{ type: 'choice', choice: string, probabilities: Record<string, number>, confidence: number }` |
| `score` | `{ type: 'score', score: number, legend: Record<string, EntryType>, probabilities: Record<string, number>, confidence: number }` |

`ScoreAnswer.legend` 的值是 `EntryType` 而**不是** `string`：等级描述可以是结构化对象
（例如 `{ what: "...", examples: [...] }`），服务端原样回传，本地不做窄化。

`ProbeResult`：`{ models: { name, release_date?, description? }[], latencyMs }`。

## 2. 本地契约

### 2.1 `ResponseCache`（`src/host/cache.ts`）

- 键：`keyOf(model, payload, endpoint = '')` =
  `sha256(endpoint + '\n' + model + '\n' + stableStringify({ state, questions }))`。
  - `model` 单独入键（调用方常用 `options.model` 覆盖模型，payload 本体不变）；
  - payload 里残留的 `model` 字段被剥掉，避免同一请求因字段有无分成两个键；
  - **`endpoint`（`baseUrl`）入键**：换端点后答案来源变了，不带端点就会一直命中旧结论。
- `stableStringify`：递归排序 object key（键序无语义），保留数组顺序（问题顺序、
  判据顺序有语义）。与 `JSON.stringify` 一致：对象里 `undefined` 值的键省略，
  数组里的 `undefined` 与非有限数字写成 `null`；循环引用抛 `TypeError`（宁可响亮失败，
  也不静默产出会碰撞的键）。
- `get(key)`：命中且未过期才计 `hits`，并把键移到 Map 末尾（最近使用）；
  过期条目视为未命中并当场删除。**返回值是深拷贝**（`structuredClone`）——
  服务是总线上的共享单例，消费方就地改 `answers` 不得污染缓存。
- `set(key, value)`：`ttlMs <= 0` 时整体 no-op（关闭缓存不是「存了但立刻过期」）；
  覆盖写先删再插，避免热点条目保留旧插入位置而被优先淘汰。
- 容量：`maxEntries` 构造时取 `Math.max(1, ...)`，超出从最久未用端淘汰。
- `stats()`：`{ entries, hits, misses }`，其中 `hits` / `misses` 是实例生命周期累计值，
  `clear()` 只清条目、不清计数。

### 2.2 `DefaultTypesafeService`（`src/host/service.ts`）

公开面 `TypesafeService`：`evaluate` / `choice` / `noul` / `score` / `judge` /
`rerank` / `probe` / `status` / `recent` / `reconfigure`。

- `MAX_QUESTIONS = 256`：`assertPayload` 在校验阶段拦截明显失控的输入
  （真正的约束是 64k 上下文而不是题数）。超限是 `invalid-request`，**不发网络**。
- `assertPayload` 其它规则：`model` 非空、`state` 不能是裸 number/boolean、
  `questions` 非空、`choice` 的 `criteria` 1–255 项、`score` 的等级 2–10 级、
  `type` 必须是 `choice` / `noul` / `score`。
- 记账：每次调用都进 `CallLog`（label / model / questionCount / tokens / latency /
  cached / ok / errorCode）。**缓存命中时 `usage` 记 0**，`calls` 与 `cacheHits`
  照常各加一；`totals.inputTokens` / `outputTokens` 只累计真实网络请求。
- 网络成功但应答不合形状（缺答案、答案类型不符）时，`single()` 会补记一条
  `malformed` 失败再抛出——错误被记成成功是最难查的一类观测污染。
- `rerank(state, items, instruction, options?)`：默认 `RERANK_CHUNK = 40`、
  `RERANK_CONCURRENCY = 4`。每块发一次 `evaluate`，问题 id 是 `c0`、`c1`…，
  每个问题都是「只针对 `candidates[i]` 判断」的 `noul`。
  - 某块里答案缺失或类型不是 `noul` → **这一块抛 `malformed`，不当作 0 分**
    （0 分与「明确判为不相关」在排序里无法区分，静默沉底比报错更糟）；
  - 成功的块照常保留，返回值是各成功块结果的并集；
  - **全部块都失败时才抛出**（抛第一个错误）；部分失败会被记入观测。
- `reconfigure(settings)`：先比设置再换挡。`baseUrl` / `timeoutMs` / `maxRetries`
  变化 → 重建 transport；`cacheTtlMs` / `cacheMaxEntries` / **`baseUrl`** 变化 →
  重建 `ResponseCache`（端点变了，旧条目必须作废）。
- `status()`：`{ version, key, model, baseUrl, settings, totals, cache, recent, lastError? }`。
  `baseUrl` 取自 transport 实况；`lastError` 是最近一次失败的脱敏摘要。
- 密钥每次调用现取（`getKey: async () => (await keyring.read()).key`），
  credentials 的 seam 契约要求 per-call 解析。

### 2.3 传输层（`src/host/transport.ts`）

- 构造面：`{ baseUrl, timeoutMs, maxRetries, getKey, logger?, now?, fetchImpl? }`。
- 可重试错误码：`rate-limit` / `overloaded` / `server` / `timeout` / `network`。
- 状态码映射：`0`（缺失状态）→ `network`（可重试）；`408` → `timeout`（可重试，
  与 TypeSafe 官方 SDK 的重试状态集 `{408, 429, 5xx}` 对齐）；`429` → `rate-limit`；
  `5xx`（含 `529`）→ `server`；其余按 `auth` / `invalid-request` 等不可重试分类。
- 退避：指数退避，先按契约封顶再乘 `[0.75, 1.0)` 的抖动（与官方 SDK
  `backoff_jitter = 0.25` 同口径）。
- **重试总预算默认 30 秒**（`totalBudgetMs`，含退避等待；`<= 0` 表示不限），
  可按每次调用用 `options.totalBudgetMs` 覆盖。预算用尽即停止重试。
- `probe()` 只读 `/v1/models`，对应 `TypesafeService.probe`。

### 2.4 `CallLog` 与计量（`src/host/stats.ts`）

- `TypesafeTotals`：`{ calls, failures, cacheHits, inputTokens, outputTokens }`。
- `RecentCall`：`{ at, label, model, questionCount, inputTokens, outputTokens, latencyMs, cached, ok, errorCode? }`，
  **不含 `state` / `instructions` 原文**。`recentLimit` 默认 50。
- 非有限数值一律兜底成 0，防止 `NaN` 渗进累计计量与浏览器展示。

### 2.5 `Keyring`（`src/host/keyring.ts`）

- `read(): Promise<{ key?, state: KeyState, error? }>`；
  `save(value)` / `clear()`。
- 解析顺序：env `TYPESAFE_API_KEY` 优先于 credentials 文档。env 提供时
  `KeyState.writable` 为 `false`，保存请求会被拒。
- 只用结构类型描述 credentials provider，不 import 官方包的值——
  保持「浏览器半可安全内联」的纯度。

### 2.6 路由（`src/host/routes.ts`）

`registerTypesafeRoutes(ctx, deps)` 注册 `kind: 'prefix'`、`path: '/typesafe'`，
带信任围栏（`isTrustedApiRequest`）与统一信封；请求体上限 `256 * 1024` 字节。

错误码 → HTTP 状态码：

| code | 状态码 |
| --- | --- |
| `no-key` / `auth` | 401 |
| `invalid-request` / `invalid-json` | 400 |
| `malformed` / `server` / `network` | 502 |
| `rate-limit` | 429 |
| `overloaded` | 503 |
| `timeout` | 504 |
| `aborted` | 499 |
| `disabled` | 409 |
| 其它（含 `internal`） | 500 |

围栏不过关直接 403 `forbidden`；未知路径 404 `not-found`。失败出口先
`clampText(redactSecrets(message), 400)` 再回给客户端。

**信任围栏不是授权（明确的设计取舍）。** 围栏（`src/host/trust-fence.ts`）只拒绝
带 `sec-fetch-site: cross-site` 的浏览器请求，以及非回环/非受信 `Host`；无 `Origin`
的请求按同源放行，这是为了让本机脚本（例如记忆预筛的 `curl`）能用。因此本机任何
进程都能调 `POST /typesafe/settings`（含关掉预审门禁）与 `POST /typesafe/key`。
这不是漏洞而是边界声明：预审门禁防的是**模型判断失误**，不防有 shell 权限的对手
——那种对手本来就能直接改 `~/.dsh/settings.yaml`。要引入真正的授权，得由 DSH 的
`/api` 网关层做（本插件不持有任何身份概念），不在本模块职责内。

### 2.7 `typesafe_eval` 工具（`src/host/tool.ts`）

- 参数 schema 刻意做浅：`criteria` 用 `type: 'json'`（工具目录进首轮 prefill，
  深嵌套 schema 只换来更早的类型报错；真正校验在服务层 `assertPayload`）。
- `questions` 的参数描述写明 **max 256**。
- 入参 `{ state, questions: { id, type, instructions, criteria? }[], model? }`；
  逐行翻成 `Question`，形状不对的报错指到具体那一行，重复 `id` 直接拒绝。
- 返回值是 JSON 字符串：成功 `{ model, cached, latencyMs, usage, answers }`；
  失败 `{ ok: false, error: { code, message } }`（消息先脱敏再截到 300 字符），
  工具本身不抛异常。

### 2.8 门禁与分流

- `registerPreflightGate(ctx, deps)` 监听 `tools/pre-execute`：默认关、只介入 `bash`、
  先过 `RISKY_COMMAND` 粗筛（`rm` / `mkfs` / `dd` / `truncate` / `shred` /
  `DROP TABLE` / `DELETE FROM` / `git reset --hard` / `git clean -f` / `git push -f` /
  `docker rm` / `kubectl delete` / `terraform destroy` / `chmod -R` / `sudo` /
  `curl | sh` / `rsync --delete` / `pkill` / `kill -9` 等）。
  判据三档：`safe` / `risky` / `destructive`；只有 `destructive` **且**
  `confidence >= preflight.minConfidence` 才 `deny`。调用用 `cache: false`、
  `maxRetries: 0`、`timeoutMs = preflight.timeoutMs`；**任何失败或超时都放行**
  （`next()`）并记 warn。
- `createRouterService({ service, getSettings })` 提供
  `classify(text, { signal?, profile? }): Promise<RouterVerdict | undefined>`。
  **模式轴由调用方定义**：`RouterProfile = { id, instructions, criteria }`，
  内置只有 `coding` 档（`CODING_PROFILE`，react / spec / chat 三条判据）；
  调用方（preset 行）可以带自己的档位进来（例如理论物理的 agile / audit）。
  `text` 截到 4000 字符，空串返回 `undefined`；预算 `router.timeoutMs`、
  `maxRetries: 0`、label `router:<档位 id>`；档位不合法（选项少于 2 个或提问为空）、
  答案不在档位选项内、或任何异常，一律返回 `undefined`（分流是可选增强，
  不阻断主流程）。`probabilities` 严格按档位的 key 归一——服务端冒出的档位外
  key 被丢弃。
  设计取舍：`confidence` 是分布集中度，所以调用方**不能**把低 `confidence`
  的倾向值当成硬指令；参考实现（`z3-theory-research` 的 `mode-router.mjs`）
  在 `p < 0.5` 时只发「倾向」指令并要求模型一行自陈后自定，且偏差方向倾向
  更保守的一侧。

## 3. 装配顺序（`src/index.ts`）

`inject = ['webServer', 'settings']` 是仅有的硬依赖；`credentials` 与 `tools`
走软读取（`ctx.get` / `ctx.inject`），缺席时降级而不把插件卡在 waiting。

1. `ctx.provide('typesafe', service)` —— 服务先上总线；
2. `/typesafe` 路由，在 `ctx.effect(...)` 里注册（随 fiber dispose 注销）；
3. `settings` 命名空间：`settingsService.register(SETTINGS_NS, SettingsSchema, { applies: 'live' })`
   —— **热生效**，保存后立即重算；
4. 设置 watcher 同样包在 `ctx.effect(...)` 内：设置变更时依次
   `service.reconfigure(next)`、按 `tool` 开关 `enableTool(...)`、按 `router.enabled`
   开关 `enableRouter(...)`；
5. `tools` —— 按设置暴露 `typesafe_eval`；
6. `tools/pre-execute` —— 在 `ctx.effect(...)` 里挂默认关闭的语义预审门禁；
7. `ctx.provide('typesafeRouter', ...)` —— 默认关闭的分流适配器，
   只在开启时 provide，preset 侧用 `ctx.get('typesafeRouter')` 软探测。

密钥不进设置：设置文档是明文 YAML，credentials 文档是 0600 且远端永不回值。

## 4. 不变量

1. 本地能判定的非法载荷一次网络都不发（先校验，再查缓存，最后记账）。
2. 缓存键包含 `endpoint`、`model` 与键序无关的 payload 摘要；数组顺序参与键。
3. `ResponseCache.get()` 只返回副本，任何消费方无法改写缓存内容。
4. 缓存命中不计 token，但计入 `calls` 与 `cacheHits`。
5. `MAX_QUESTIONS = 256`（`choice` 选项上限 255，`score` 等级 2–10）。
6. `rerank` 绝不把缺失答案当 0 分；部分失败保留成功块，全失败才抛。
7. `clampText(text, max)` 的返回值长度不超过 `max`，省略号计入额度。
8. 任何对外文本（日志、错误消息、HTTP 响应）先 `redactSecrets` 再 `clampText`。
9. 密钥只进不出：请求可写，任何响应都不回显值。
10. 门禁与分流都是概率判断：门禁失败放行、分流失败返回 `undefined`，不得阻断主流程。

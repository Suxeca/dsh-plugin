# @suxeca/dsh-typesafe

TypeSafe System One（Jev）语义判断服务。它把 Jev 的三条原语（`choice` / `noul` / `score`）
封装成 DSH 总线上的一个单例服务 `ctx.typesafe`，并附带 `typesafe_eval` 工具、
`/typesafe` HTTP 路由与设置页区块（密钥零明文、离线可测）。

没有这一层时，每个想用语义判断的插件都要自己管密钥、自己拼 HTTP、自己重试、
自己缓存、自己记账。有了它，其它插件与 preset 只写 `inject: ['typesafe']`。

## 安装与依赖链接（必须步骤）

本包在 DSH checkout 内开发，构建前必须先建立 checkout 依赖链接：

```bash
npm run link:deps   # node scripts/link-checkout-deps.mjs
```

这一步是**必需**的，不是可选的便利脚本。原因是两条依赖的生命周期不同：

- `@deepseek-ai/schemastery` 在构建期被**打包进产物**（`src/index.ts` 直接
  `import Schema from '@deepseek-ai/schemastery'`），所以它只需要在构建时可见；
- `@deepseek-ai/dsh-tools` 保持 **external**（`typesafe_eval` 工具用它的
  `defineTool`，运行期由宿主提供），因此它**必须解析到 DSH checkout 里的那一份**。
  仓库根目录下的同名副本是不完整的，解析到它会让类型与运行期行为同时错位。

`scripts/link-checkout-deps.mjs` 做的就是把这几个 DSH 侧依赖链接到 checkout 的副本。
跳过它直接构建，典型症状是 `defineTool` 的类型对不上或运行期找不到模块。

常用脚本：

| 命令 | 作用 |
| --- | --- |
| `npm run link:deps` | 建立 checkout 依赖链接（构建前必须先跑） |
| `npm run build` | `tsc -b && tsdown`：先编译 host 类型，再打包 host 与 client |
| `npm run build:client` | 只跑 `tsdown`（改 UI 后重建 `lib/client.js`） |
| `npm run typecheck` | `tsc -b --pretty false` |
| `npm run test` | `vitest run` |

## 快速使用

服务（其它插件 / preset）：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['typesafe']

export function apply(ctx: Context) {
  // 一个 yes/no 判断：返回 yes 的概率
  const judged = await ctx.typesafe.noul(
    '用户要删除生产库里的整张表',
    '这条请求是否属于不可逆的数据销毁操作？',
    { true: '会不可逆地销毁数据', false: '可逆或只影响临时数据' },
    { label: 'my-plugin' },
  )
  ctx.logger?.info?.(`noul=${judged.answer.noul} cached=${judged.cached}`)
}
```

Agent 工具（设置里 `tool: true` 时注册）：

```jsonc
// typesafe_eval 的参数；questions 最多 256 条，一次请求问完比逐个问便宜一个数量级
{
  "state": "候选片段或应用状态（字符串，需要引用多个部分时用 JSON 字符串）",
  "questions": [
    { "id": "a", "type": "noul", "instructions": "这条候选是否与意图相关？",
      "criteria": { "true": "相关", "false": "不相关" } },
    { "id": "b", "type": "choice", "instructions": "这条候选属于哪一类？",
      "criteria": { "bug": "缺陷报告", "feat": "功能请求", "noise": "噪声" } }
  ]
}
```

HTTP（设置页与宿主外脚本，例如 `agent_memory.py` 这类工具）：

```bash
curl -sS http://127.0.0.1:3080/typesafe/status
```

## 设置项

命名空间 `typesafe`，注册时带 `applies: 'live'`：保存后立即生效，无需重启 DSH。
密钥**不进设置**：设置文档是明文 YAML，密钥走 credentials / env（见下）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `model` | `jev-latest` | 服务端解析成版本号的模型别名 |
| `baseUrl` | `https://api.typesafe.ai` | 端点；**参与缓存键**，换端点即换答案来源 |
| `timeoutMs` | `10000` | 单次尝试超时 |
| `maxRetries` | `2` | 可重试错误的额外尝试次数 |
| `cacheTtlMs` | `300000` | 本地缓存 TTL，`0` 关闭缓存 |
| `cacheMaxEntries` | `256` | 缓存条目上限（LRU 淘汰） |
| `logState` | `false` | 是否把 `state` / 问题原文写进日志（常含用户数据，默认关） |
| `tool` | `true` | 是否向 Agent 暴露 `typesafe_eval` |
| `preflight.enabled` | `false` | 危险命令语义预审门禁（唯一会给每次 bash 加网络往返的功能） |
| `preflight.timeoutMs` | `1500` | 门禁预算，超时一律放行 |
| `preflight.minConfidence` | `0.9` | 判为危险所需的最低 confidence |
| `router.enabled` | `false` | 是否 `provide('typesafeRouter')` 分流适配器（服务本身不发请求，只有被调用才花钱） |
| `router.timeoutMs` | `2000` | 分流分类预算 |

## HTTP 路由

前缀 `/typesafe`。所有响应都是统一信封 `{ ok: true, value }` 或
`{ ok: false, error: { code, message } }`，且带 `cache-control: no-store`。
请求先过信任围栏（与 `/api` 网关同源的 DNS-rebinding / 跨站防御），不过关直接 403。

> **信任围栏不是授权。** 围栏只做两件事：拒绝带 `sec-fetch-site: cross-site`
> 的浏览器请求，以及只接受回环/受信 authority 的 `Host`——它防的是恶意网页把
> 本机服务当跳板，**不是**身份认证。本机任何进程（包括被门禁盯着的那个 agent
> 自己的 `bash`）都能直接调这些路由，包括 `POST /typesafe/settings` 关掉预审门禁、
> `POST /typesafe/key` 覆盖密钥。所以：
>
> - 预审门禁是**防模型犯错**的护栏，不是防对手的边界；有 shell 权限的对手本来
>   就能直接改 `~/.dsh/settings.yaml`。
> - 路由只绑回环（由 DSH webServer 决定），不要把它暴露到公网。

| 方法 | 路径 | 请求体 | 成功响应 |
| --- | --- | --- | --- |
| `GET` | `/typesafe/status` | 无 | `TypesafeStatus` |
| `POST` | `/typesafe/eval` | `{ state, questions, model? }` | `EvalOutcome`（`{ response, cached, latencyMs }`） |
| `POST` | `/typesafe/key` | `{ value }` | `KeyState`（**不回显值**） |
| `DELETE` | `/typesafe/key` | 无 | `KeyState` |
| `POST` | `/typesafe/settings` | `{ patch }`（浅合并） | 合并后的 `TypesafeSettings` |
| `POST` | `/typesafe/probe` | 无 | `ProbeResult`（只读 `/v1/models`） |

未知路径返回 404 + `code: 'not-found'`；请求体上限 256 KiB，超过或不是 JSON 对象
按 `invalid-request` / `invalid-json` 拒绝。

## 服务 API（`ctx.typesafe`）

| 方法 | 说明 |
| --- | --- |
| `evaluate(payload, options?)` | 原语批量：一次请求问多个问题，返回 `EvalOutcome` |
| `choice(state, instructions, criteria, options?)` | 从固定选项集中选一个 |
| `noul(state, instructions, criteria?, options?)` | 一个是非判断，返回 yes 的概率（无 confidence） |
| `score(state, instructions, levels, options?)` | 沿有序等级打分（2–10 级） |
| `judge(state, questions, options?)` | 只要答案表，丢掉计量 |
| `rerank(state, items, instruction, options?)` | 语义重排：切块并发（默认 40/块、并发 4），按相关概率降序 |
| `probe(options?)` | 用 `/v1/models` 验证「这把 key 现在能不能用」 |
| `status()` | 状态快照（密钥只报来源与可写性） |
| `recent(limit?)` | 最近的调用明细（最新在前） |
| `reconfigure(settings)` | 装配层在设置变更后调用：换挡预算、重建缓存 |

`ServiceCallOptions`：`model?` / `signal?` / `timeoutMs?` / `maxRetries?` / `cache?` / `label?`；
`RerankOptions` 另外支持 `chunkSize?` / `concurrency?`。

## 关键语义（容易踩的边界）

- **缓存键带端点**：`ResponseCache.keyOf(model, payload, endpoint?)` 的键是
  `sha256(endpoint + '\n' + model + '\n' + stableStringify({state, questions}))`。
  `endpoint`（即 `baseUrl`）入键，切到自建代理后不会继续命中旧端点的结论；
  `reconfigure()` 在 `baseUrl` 变化时重建缓存。
- **命中返回深拷贝**：`get()` 用 `structuredClone` 返回副本。服务是总线上的共享单例，
  消费方就地改 `answers` 不再能污染缓存里那一份。
- **缓存命中不计 token**：命中仍让 `calls` 与 `cacheHits` 各加一，但
  `totals.inputTokens` / `outputTokens` 只累计真实网络请求。
- **rerank 不把缺答案当 0 分**：某一块的答案缺失或类型不符会让这一块失败，
  成功的块照常保留；只要有块成功就返回其并集，**全部失败才抛错**。
  0 分与「模型明确判为不相关」在排序里无法区分，静默沉底比报错更糟。
- **`clampText(text, max = 240)` 返回不超过 `max` 个字符**，省略号算在额度内
  （`slice(0, max - 1) + '…'`）。调用方拿它当长度预算用，不会 off-by-one。
- **`EntryType` 不含裸 number / boolean**：`state`、`instructions`、`criteria` 只能是
  字符串、JSON 对象、JSON 数组或 `null`。裸标量要放进字符串或对象里，
  否则会在本地 `assertPayload` 阶段被拒（不会发一次注定 422 的请求）。
- **`ScoreAnswer.legend` 的值是 `EntryType`**（不是 `string`）：等级描述可以是结构化对象，
  服务端原样回传。

## 失败分类与重试

`TypesafeErrorCode`：`no-key` / `auth` / `invalid-request` / `invalid-json` /
`rate-limit` / `overloaded` / `server` / `timeout` / `aborted` / `network` /
`malformed` / `disabled`。

可重试集合是 `rate-limit` / `overloaded` / `server` / `timeout` / `network`。
HTTP 映射：`408 → timeout`（可重试）、缺失状态码按 `network`（可重试）、
`429 → rate-limit`、`5xx`（含 `529`）`→ server`。重试采用指数退避，
先按契约封顶再乘 `[0.75, 1.0)` 的抖动；**重试总预算默认 30 秒**
（`totalBudgetMs`，可按每次调用覆盖），预算用尽即停止重试，不再等待。

## 安全

- 密钥引用名是 `TYPESAFE_API_KEY`（credentials 文档与 env 同名）。env 提供时是只读的，
  保存请求会被拒；credentials 文档 0600 且远端永不回值。
- 任何会落到日志、错误消息或 HTTP 响应的文本都先过 `redactSecrets()`
  （`apikey_…`、`Bearer …`、`sk-…` 三类模式）与 `clampText()`。
- 密钥只存在于一次 fetch 的 header 里：`POST /typesafe/key` 收值，
  任何响应都只回来源与可写性。

## 测试

`tests/` 下共 **84** 个用例，全部离线（`fetch` 注入，无真实网络）：

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/transport.spec.ts` | 17 | 重试预算、状态码映射、退避抖动、密钥注入 |
| `tests/cache.spec.ts` | 13 | 键规范化（含端点）、TTL/LRU、深拷贝 |
| `tests/stats.spec.ts` | 9 | 观测明细与累计计量 |
| `tests/keyring.spec.ts` | 19 | env / credentials 解析、可写性、脱敏 |
| `tests/service.spec.ts` | 8 | 校验、缓存命中记账、rerank 分块与部分失败 |
| `tests/plugin.spec.ts` | 18 | 装配顺序、设置热更新、路由与工具注册 |

## 文档

- `docs/SPEC.md` — 契约细节（线上协议、本地契约、装配顺序、错误码、不变量）
- `docs/integrations/router-standard.md` — 任务模式分流：`ctx.typesafeRouter` 的档位契约、降级面，以及 `z3-theory-research` A/B 分流的实测参考实现
- `docs/integrations/preflight-gate.md` — 危险命令语义预审门禁
- `docs/integrations/memory-staging.md` — 记忆候选的 advisory 预筛（非插件形态）

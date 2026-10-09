# dsh-agy 403 "not eligible / valid license" 诊断报告

时间：2026-09-15 13:0x CST

## 结论（一句话）

`agy account not eligible (403): You do not have a valid license of this product...` **不是账号问题，也不是登录失效**。
它是 **dsh-agy 的 endpoint 兜底链**在 daily 主端点返回 429（配额耗尽）后，继续打到 Google 的
**企业专用 sandbox 端点 `autopush-cloudcode-pa`**，该端点对个人（free-tier）账号固定回 403
`SUBSCRIPTION_REQUIRED (#3501)`；插件把这个**端点级的错误**误记成了**账号级资格问题**并冷却了整个账号。

## 证据 1：所有凭据自身健康，账号 tier = free-tier

对 3 个账号分别做 OAuth refresh + userinfo + loadCodeAssist（只读探测）：

| 账号 | refresh | userinfo | loadCodeAssist tier | 结论 |
|---|---|---|---|---|
| weijiescnu@gmail.com | OK | 200 | free-tier | 凭据健康 |
| suxeca123@gmail.com | OK | 200 | free-tier | 凭据健康 |
| lishifuua@gmail.com | OK | 200 | free-tier | 凭据健康 |

`subscriptionInfo: null`、`allowedTiers: [free-tier "Antigravity"]` —— 与"企业 license"无关。

## 证据 2：按端点逐一定位（同一请求体）

```
== weijiescnu@gmail.com
   daily          -> 429  Individual quota reached. Please upgrade your subscription ... (reset 2026-09-15T07:47:13Z)
   prod           -> 429  Resource has been exhausted (e.g. check quota).
   daily-sandbox  -> 429  Individual quota reached. ...
   autopush       -> 403  You do not have a valid license of this product. ...  <-- 用户看到的那条

== suxeca123@gmail.com        （配额未耗尽的对照账号）
   daily          -> 200 / prod 429 / daily-sandbox 200 / autopush 200

== lishifuua@gmail.com
   daily          -> 200 / prod 429 / daily-sandbox 200 / autopush 403（同一 license 文案）
```

- `autopush-cloudcode-pa.sandbox.googleapis.com` 对 **两个个人账号**都回同一条 403 → 端点属性，不是账号属性。
- 同一个账号在 daily / daily-sandbox 上**正常流式返回 200** → 账号没被封、配额也只对 Gemini 族耗尽。

## 证据 3：配额范围是"模型族"，不是整个账号

| 模型 | weijiescnu | suxeca123 | lishifuua |
|---|---|---|---|
| gemini-3.8-flash-tiered | **429**（reset 15:47 CST） | 200 | 200 |
| gemini-3.7-flash-tiered | **429** | 200 | 200 |
| claude-opus-4-6-thinking | 200 | 200 | 200 |
| gpt-oss-120b-medium | 200 | 200 | 200 |

账号 1 只是 **Gemini 族**当日额度用尽（Claude 模型仍可用），但插件把整个账号冷却 10 分钟。

## 代码路径

1. `src/oauth/constants.ts`
   - `AGY_ENDPOINT_FALLBACKS = [daily, prod, daily-sandbox, autopush]`
   - `AGY_ENDPOINT_SKIP_STATUSES = new Set([429, 403])`
   - `fetchAgyFirstOk()`：状态属于 skip 集合就"这个端点不可用"→ 试下一个；**全链都 skip 时返回最后一个响应**（= autopush 的 403）。
2. 后果：daily 的 429（含精确的 `quotaResetTimeStamp`）被丢弃，最终交给分类器/用户的是 autopush 的 403。
3. `src/runtime/classify.ts`：403 + `PERMISSION_DENIED` → `project-error`；`rotation.ts` 对 `project-error`
   给 `PROJECT_ERROR_COOLDOWN_MS = 10min` 的**账号级**冷却。
4. `src/adapter/adapter.ts:295`：报 `agy account not eligible (403): …`，harness 侧降级为 `RATE_LIMIT`。

## 为什么"所有账号都不可用"

- `agy-events.json` 显示 11:26 / 11:46 / 12:20 / 12:23 / 12:52 连续 5 次 `project-error 403` → 每次把命中的账号冷却 10 分钟；
- 3 个账号都因 daily 429 走进同一条 autopush 兜底 → 相继被冷却；
- 12:52:46 这次是最后一个可用账号也被冷却，池子空了 → 你的对话直接失败并弹出这条 403。

## 与 Google 侧已知问题的吻合

论坛上同类帖子明确写到个人账号被 CLI 误路由到企业端点：
["Error #3501 (SUBSCRIPTION_REQUIRED) on Personal Account"](https://discuss.ai.google.dev/t/error-3501-subscription-required-on-personal-account-persistent-across-multiple-accounts-and-networks/178957/2)
（"The CLI is incorrectly hitting the enterprise endpoint and blocking me with Error #3501"）、
["Error #3501: You do not have a valid license – Personal account wrongly flagged as enterprise"](https://discuss.ai.google.dev/t/error-3501-you-do-not-have-a-valid-license-personal-account-wrongly-flagged-as-enterprise/172211)。
本项目 `docs/ANTIGRAVITY-API.md` 也早已记录：prod 端点对 consumer 账号 429、autopush 对 consumer 账户 403(no license)，
且 `autopush` 是"tail fallback"。

## 客户端侧可修的 3 个点

1. **配额 429 终止兜底**：daily/`*` 返回带 `QUOTA_EXHAUSTED`/quota 字样的 429 时，它是**账号+模型族的确定状态**，
   不是"端点不可用"。应立刻返回该 429（或直接判定 quota-exhausted 冷却到 `quotaResetTimeStamp`），
   不要继续向 prod/sandbox/autopush 探测 —— 用户会直接看到"额度用尽，15:47 重置"而不是 license 403。
2. **兜底链移除企业端点**：`autopush-cloudcode-pa.sandbox`（以及 `cloudcode-pa` 对 consumer）不应作为 consumer 请求的兜底；
   它的 403 `SUBSCRIPTION_REQUIRED` 对个人账号是恒定噪声，会污染分类与冷却状态。
3. **冷却按模型族 + 区分来源**：`project-error` 不应做账号级 10 分钟冷却（当前会让 Claude/其它模型一起不可用）；
   endpoint 来源的 403 不应写 `cooldownReason=project-error`，以免掩盖真实的 quota 状态。

## 立即可用的规避（无需改代码）

- 账号 1 的 Gemini 额度 **15:47（CST）重置**；此前可改用 **Claude / gpt-oss 系模型**（实测 200）。
- 或把 subagent 模型从 `agy/gemini-3.8-flash-tiered` 换成配额未耗尽的账号可用模型；`suxeca123@gmail.com` 目前 Gemini 仍可用。
- 纯规避：暂时避开 `agy` provider。

---

# 修复实施（2026-09-15 13:1x）

## 改了什么

### 1. `src/oauth/constants.ts` — 硬配额墙不再走兜底链

新增导出 `isHardQuotaWall(response)`：
- 仅对 **429** 生效；
- 先 `response.clone()`（绝不消费调用方还要分类/上报的响应）；
- 判定条件：body 命中 `/quota|quota_exhausted|individual quota/` **且** `classifyRateLimit` 判为 `quota_exhausted`；
- `fetchAgyFirstOk` 在 `lastSkipped = response` 之前加一行：命中硬配额墙 → **立即返回该 429**。

关键取舍：**只对"明确配额证据"终止**。裸 `RESOURCE_EXHAUSTED`（无 quota 字样）仍视为端点级突发，
继续走 `prod → daily-sandbox → autopush` 兜底 —— 第一版实现把裸 429 也终止，被测试当场驳回
（`keeps descending while the limit is endpoint-shaped`），已按此收紧。

企业端点 `autopush` 保留在链上不动：`AGENTS.md` 把兜底顺序列为 load-bearing invariant，
真正的问题不是链的存在，而是**配额墙被当成端点故障**。

### 2. `src/runtime/classify.ts` — 解析真实的配额重置时间

Google 把重置时间放在嵌套结构里，原来的扁平查找完全漏掉：
- `details[].metadata.quotaResetTimeStamp`（绝对时间，`ErrorInfo`）；
- `RetryInfo.retryDelay`（protobuf Duration，如 `10008.596508820s`）。

新增 `coerceResetValue` / `parseDurationReset` / `findResetHint`（深度受限的深度优先搜索，depth ≤ 4），
在保留原有顶层字段与 `quotaInfo.resetTime` 行为的前提下补上嵌套形状。

后果对比：修复前配额墙 → `cooldownMs = FULL_QUOTA_COOLDOWN_MS`（**24h**，账号整天不可用）；
修复后 → 用真实重置时间（本次约 2h47m）。

## 测试

`tests/oauth.test.ts` 新增 `fetchAgyFirstOk endpoint fallback`（3 例）与 `isHardQuotaWall`（1 例），
`tests/runtime.test.ts` 新增 `classifyHttpError reset-time extraction`（4 例）；测试体使用
2026-09-15 实测记录的响应原文，零网络。

```
 Test Files  9 passed (9)
      Tests  210 passed (210)
```

`pnpm run typecheck` 通过；`pnpm run build` 通过；**CLI bundle 仍然零 `@deepseek-ai/*` 依赖**（已 grep 校验，
这是 AGENTS.md 的硬约束——`constants.ts` 新增的是 `runtime/classify.ts` 的静态依赖，classify 本身不引 harness）。

## 实测验证（走插件真实代码路径）

热重载 `dsh-agy`（`dev_reload_package`：清 15 模块、重建 1 fiber，`active → active`）后，
用构建产物 `AgySessionManager` 直接跑真实生成调用（`testCall` → `getSession` → `fetchAgyFirstOk`）：

```
=== model: gemini-3.8-flash-tiered
  picked: weijiescnu@gmail.com | index 0
  ok: false | elapsed 1385 ms
  surfaced error: HTTP 429: { "error": { "code": 429, "message": "Individual quota reached. ... Resets in 2h38m14s.",
                   "status": "RESOURCE_EXHAUSTED", "details": [ { ... "reason": "QUOTA ...   <-- 修复前这里是 403 license

=== model: claude-opus-4-6-thinking
  picked: weijiescnu@gmail.com | index 0
  ok: true | elapsed 2636 ms
  text: "OK"                                                       <-- 同一账号的 Claude 族仍然可用
```

- 修复前该账号在 Gemini 上必然产出 `403 valid license`；修复后同一路径产出**带真实重置时间的 429**。
- 验证过程只读：`agy-events.json` 无新增失败事件，账号冷却状态未被改写（仅剩修复前遗留的、已过期的条目）。

## 仍然保留的已知行为（未改，避免越界）

- `autopush` 仍在链尾（AGENTS.md invariant）；当**所有**端点都返回非配额型 403 时它仍可能成为返回值。
- `project-error` 仍是账号级 10 分钟冷却（AGENTS.md 明确"cool + rotate"）。
  但配额墙现在不再落到该分支（429 → `rate-limit` → `quota-exhausted`），
  且冷却时长改为真实重置时间，所以"坏 reason + 整天不可用"这两个实际危害都已消除。

---

# 额度面板修正（2026-09-15 13:3x）

复核 `packages/dsh-quota-meter`（面板）后确认：**数字来源可靠（直连 `fetchAvailableModels`），坏在渲染语义**。

## 改了三处

1. **删除编造的"周额度 / 周重置"**（`src/host/parsers.ts`）
   上游每个模型只上报一个滚动窗口（`remainingFraction` + `resetTime`），**没有任何 weekly 字段**。
   旧代码在 `diffMs <= 6h` 时无条件填 `weeklyUsedPercent: 0 / weeklyRemainingPercent: 100 / weeklyResetAt: null`，
   在 `> 6h` 时把同一份 5 小时数据复制成"周额度"——两种情况都不是测量值。
   现在只输出真实窗口，并把窗口命名交给 `windowLabel`：距重置 ≤6h → `5 小时窗口`，更远 → `额度窗口`
   （名称跟随重置距离，不再冒充一个不存在的周维度）。客户端对应地只在 `weekly*` 字段存在时才渲染那两行。

2. **"生效账号"改为池子的真实选择**
   新增 dsh-agy 侧的只读内省服务 `agy`（`third-party/dsh-agy/src/service.ts`）：
   `poolSize()` / `selectAccount(model)` / `describeModel(model)`，由主插件在构建 runtime 时 `attach()`。
   `selectAccount` 走的正是适配器的 `getSession` 选号（冷却/排名/会话亲和），
   所以面板显示的就是"此刻真会拿这个模型去请求的账号"。面板经 `ctx.get('agy')` 结构化调用；
   服务不存在（未装/未加载 dsh-agy）时回退到旧的 snapshot 选号。
   服务返回的对象**不含 refresh token / access token**（有测试钉住这一点）。

3. **上下文规格从写死改为读真目录**
   旧的 `modelContextWindowOf('agy', …)` 对 agy 下所有非 gpt-oss 模型一律返回 `1M / 64k`。
   现在优先用 `describeModel()` 的真值（`gpt-oss-120b-medium` 正确显示 `128k 上下文 · 32k 输出`），
   取不到才回退启发式。`方案` 字段不再编造（`plan` 留空即不渲染），也不再声称读不到的 Google 订阅类型。

## 实测（重载后打真实接口）

```
GET /quota-meter/query?provider=agy&model=gemini-3.8-flash-tiered&refresh=1
  account: suxeca123@gmail.com 池内 #2 | pool: 3          <- 真实选号（旧逻辑显示 lishifuua，非池子会选的号）
  window : 额度窗口 | used 87.5% | reset 2026-09-18T02:52:40Z
  weekly : 全部缺失（不再渲染）                              <- 旧逻辑固定显示"已用 0% · 剩余 100%"
  context: 1M 上下文 · 64k 输出

claude-opus-4-6-thinking -> 5 小时窗口, used 0%, reset 10:02:24Z, pool 3
gpt-oss-120b-medium      -> context 128k 上下文 · 32k 输出   <- 真目录值，旧逻辑同样对但属巧合
```

测试：dsh-agy `215 passed (10 files)`（新增 `tests/service.test.ts` 4 例 + 既有 210）；dsh-quota-meter
`20 passed (2 files)`（parser 用例按新语义改写）。typecheck 双通过；dsh-agy CLI bundle 仍零 `@deepseek-ai/*`。

## 面板现在的已知边界

- `selectAccount` 给的是"此刻"的选择；会话亲和性会在 10 分钟窗口内保持上次账号，
  因此面板读数与随后真正的请求账号理论上仍可能瞬时不一致（快照语义，无法完全消除）。
- Gemini 的 12.5% 仍是"低于插件 15% 软阈值"的那份额度：面板现在会如实显示它，
  但 dsh-agy 发请求前仍会把该账号判为 drained（`SOFT_QUOTA_THRESHOLD`，见上一节待决项）。

---

# 三账号重置时间实测（2026-09-15 13:32）

| 账号 | 账号级冷却 | Gemini 族剩余 / 重置 | Claude+gpt-oss 剩余 / 重置 |
|---|---|---|---|
| weijiescnu | **冷却中 → 15:47**（quota-exhausted，与 Google 报的重置同刻） | 0% / 09-15 **15:47**（2h15m） | 99.4% / 09-15 18:02（4h30m） |
| lishifuua | 无（12:33 的 project-error 已过期） | 0.6% / 09-15 **15:46**（2h13m） | 100% / 09-15 17:21（3h48m） |
| suxeca123 | 无（09-14 23:05 network-error 已过期） | 12.5% / 09-18 **10:52**（**69h**） | 99.7% / 09-15 18:02（4h30m） |

要点：

- **重置时间是错开的，不是一个共享池**：#1/#3 的 Gemini 在 ~15:46–15:47 回满，而 #2 要等到 09-18 10:52（69 小时后）。
- #2 那条 69h 的重置与另外两个号的 2h 完全不是一回事；它的 `remainingFraction` 在整段会话里冻在 12.5%
  （12:16 → 13:31 多次快照都是 0.1251x），说明这个桶的回填周期明显更长，不能按 5 小时窗口理解。
- **账号级冷却会连坐模型族**：#1 冷却到 15:47 是账号级的，所以它那 99.4% 的 Claude/gpt-oss 在此期间同样选不到
  （`isCoolingDown` 不看族），要等 15:47 冷却过期。
- 族级限流表里 `suxeca123.rateLimitResetTimes.google = 09-11 16:41` 是**已过期的陈旧残留**，
  没有任何 Google 族墙在拦它；`weijiescnu` 那条 15:47:13 才是真实墙（与 Google 上报的 `quotaResetTimeStamp` 同刻）。
- 探测口径提醒：0.6% / 12.5% 的极小 probe 请求仍能拿到 200，但 11:26–12:23 的真实尺寸请求在 0.6% 上是失败的，
  所以这点残量不足以支撑真实回合。

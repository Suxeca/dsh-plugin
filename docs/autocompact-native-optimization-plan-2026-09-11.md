# DSH 自动压缩（autocompact）原生优化计划 — 2026-09-11

> **范围（本轮唯一目标）**：只优化 DSH 的**自动上下文压缩（autocompact / compaction）**。
> SoL-Pi 的另外三项（Action Fusion / ObservationPack / Evidence-Preserving Reducer）**本轮不做**，仅在附录 C 留档，不进实现队列。
>
> **约束**：完美原生适配 —— 只用 DSH 已声明的扩展面（preset 行、插件服务、公开 API、已声明导出），不修改 `~/Workspace/deepseek-harness/packages/**` 里上游拥有的文件，不 fork 上游逻辑，不新增封闭联合成员。
>
> 取证方式：直接读本地 checkout 源码与运行中 profile 配置（只读），关键结论均带 `文件:行` 索引（见附录 A）。

---

## 0. 结论摘要

**一句话**：当前自动压缩的触发点被算成了 **800,000 token**（1,000,000 窗口 × 默认 0.8），实际几乎永不触发；即便触发，也会一次性产生一个 80 万 token 级的摘要请求，并因保留尾部过大而让压缩后的缓存重写代价极高。优化主线是**把触发点搬到可支付的区间、把保留量从"窗口比例"改成"绝对预算"、用真实数据而不是猜测定档**。

| 阶段 | 做什么 | 是否写代码 | 预期收益 | 风险 |
|---|---|---|---|---|
| **P0** | 挂 staging 探针，测出真实压力曲线 / tokenizer 偏差 / 缓存命中结构 | 用 `dev_stage_add` 挂临时探针（不落盘、不进 schema） | 让 P1 的参数有依据 | 无（只读） |
| **P1** | 复制 `standard` → 用户 preset，改 `compaction-basic` 配置 | 零代码，只改 YAML | 触发点从 800k 降到 200k–350k；保留量从 160k 降到 32k–64k | 低（可一键切回 `standard`） |
| **P2** | 子类化 `BasicCompactionEngine`，做"任务边界 + 缓存经济学"触发 | 一个插件包 | 压缩发生在语义干净的断点，而非半途 | 中（依赖 `./src/*` 导出，见 §5.3） |

**建议节奏**：先做 P0（半天），据数据定 P1 档位并观察一周，再决定 P2 是否值得。

---

## 1. 已核实的现状（含证据）

### 1.1 生效链路

```
~/.dsh/settings.yaml
  agent-presets.default: standard                    ← 用户层默认（第 7–8 行）
        ↓
packages/preset/agent-presets/presets/standard/agent.cordis.yml   ← 随包 system 根
  - id: compaction
    name: cordis:group
    isolate: { compaction: true, toolResultPruner: true }
    config:
      - id: compaction-basic            ← 无 config ⇒ 全部走默认值
      - id: command-compact
      - id: tool-result-pruner           config: {thresholdChars: 8192, headChars: 4096, tailChars: 1024}
```

会话日志头亦证实：`"agentPreset":"standard"`（`~/.dsh/sessions/--home-suxeca-Workspace-dsh-plugin--/session-c1d9e3f3-.../session.v3.jsonl.zstd`）。

> 注：`~/.dsh/.agent-presets/router-standard/` 确实存在，但**未被设为默认**，本轮不涉及。

### 1.2 默认参数换算成实际 token

`compaction-basic` 的默认值（`packages/compaction/compaction-basic/src/config.ts:20-23,89-95`）：

| 参数 | 默认 | 本机实际含义 |
|---|---|---|
| `thresholdRatio` | `0.8` | 路由模型 `cmdcode/deepseek/deepseek-v4.1-flash` 声明 `contextWindow: 1000000` → **阈值 800,000 token** |
| `retainRatio` | `0.16` | **逐字保留 160,000 token**（压缩后要重写的部分） |
| `maxTokens` | `8192` | 摘要输出上限 |
| `compactionRetries` | `1` | 压完还超阈值再试 1 次 |
| `maxOverflowRetries` | `1` | 溢出后重试 1 次 |
| `auto` | `true` | 自动压缩开启 |

`contextWindow` 取值见 `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.cmdcode.models`（`deepseek/deepseek-v4.1-flash: ctx=1000000`）。

**推论**：800k 阈值意味着日常会话（几万到十几万 token）永远不会触发自动压缩；而一旦触发，摘要请求本身就是 80 万 token 级输入，且压缩后仍有 16 万 token 需要重新写入缓存。

### 1.3 token meter 是启发式，且对中文低估（会进一步推迟触发）

- `measure()` 返回的 `totalTokens` 是**路由定价后的估算**，非精确 tokenization（`packages/llm/token-meter/src/types.ts:22-35`）。
- 上游 README 自述限制：默认 4 chars/token 的启发式**对 CJK 与 JSON schema 定价偏低**（`packages/compaction/compaction-basic/README.zh.md:255`）。
- 因此本机（大量中文会话）**实际压力高于读数**，触发点比 0.8 还要晚。
- 但 provider 回传的用量是**精确的**：`TokenUsage.cacheReadTokens / cacheWriteTokens / inputTokens`（`packages/llm/llm/src/types.ts:149-163`，deepseek 适配器从 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` 映射，`packages/llm/llm-deepseek/src/types.ts:163-176`）。

→ **P0 必须用"估算 vs 精确"的比值，标定出本机的中文修正系数**，否则所有比例参数都是盲调。

### 1.4 为什么"在 profile 里改配置"行不通（关键，决定了 §4 的部署形态）

- 宿主面那一行 `compaction-basic` 被 web-app bundle **显式禁用**（`packages/bundle/web-app/cordis.patch.yml:420-434`，理由注释：token meter 留宿主、压缩后端下放到 preset）。
- profile 的 `cordis.patch.yml` 只能覆盖 **profile 组装树的顶层行**；preset 的 `agent.cordis.yml` 是**另一棵 include 子树**（每会话挂载），patch 不跨 include 边界（`docs/architecture.zh.md:27`）。
- preset 之间**没有继承/patch 机制**：preset 目录里只有 `agent.cordis.yml` + `preset.yml`，创作方式就是"复制整份"（`packages/preset/agent-presets/src/authoring.ts:127 copyComposition`；`README.zh.md:75` "创作即复制"）。

→ **改自动压缩配置只有两条路**：(a) 改随包 `standard`（动上游文件，升级冲突）；(b) **复制成用户 preset**（原生路径）。本轮取 (b)。

### 1.5 触发面与恢复面（决定 P2 能挂在哪）

| 入口 | 位置 | 语义 |
|---|---|---|
| `agent/pre-step` | `compaction-basic/src/index.ts:148-166` | 每步派生前检查压力；**抛配置错只警告一次并继续**（`:156-163`） |
| `agent/request-error` | `:180-224` | 收到 `CONTEXT_WINDOW_EXCEEDED` 时**绕过阈值与保留策略**，强制一次平衡缩减，且仅在表层 generation 前进后才授权重试 |
| `/compact` | `command-compact` | 手动；要求 agent idle（`compactNow` 走 `runMaintenance`，`:376`） |

`CompactionTrigger` 是**封闭联合** `'pressure' | 'context-overflow'`（`packages/compaction/compaction/src/index.ts:25`），且每个 realm 只能挂**一个** `ctx.compaction` 实现。

### 1.6 修剪器（pruner）只在压缩触发后才跑

`toolResultPruner` 由 compaction-basic 在**压力或溢出确认之后**调用，不是逐次观察衰减；修剪本身不发模型调用（`compaction-tool-result-pruner/README.zh.md:60`；调用点 `compaction-basic/src/index.ts:282-312`）。

→ 修剪是**免费的**：把修剪做狠一点，可以完全免掉一次付费摘要。这是 P1 里性价比最高的一档。

### 1.7 摘要契约当前不可配置

`COMPACTION_INSTRUCTION`（压缩指令全文）与 `CHECKPOINT_PREAMBLE`（检查点前导）是 `summarizer.ts` 的**模块私有常量**（`compaction-basic/src/summarizer.ts:31,69`），没有配置项。唯一文档化的定制点是 `protected async summarize()`（`compaction-basic/src/index.ts:231` 注释："Override this sole hook"）。

→ **想改摘要格式必须写代码（P2）**，配置层做不到。当前契约本身已经相当好（含 Pending Jobs / Next Step / Critical Context 等结构化小节），P1 不动它。

---

## 2. 目标函数与硬约束

### 2.1 目标函数（按影响排序）

设某轮会话的存活上下文为 `C`，本轮新增 `Δ`，压缩释放量为 `F`，保留尾部为 `R`：

```
总成本 ≈ Σ_轮次 [ 未命中输入 × miss价 + 缓存命中输入 × hit价 ]
        + Σ_压缩 [ 摘要请求输入(≈被压缩区) × 价 + 摘要输出 × 价 ]
        + Σ_压缩后 [ (R + 系统/工具前缀) 缓存重写 × write溢价 ]
```

三个可调杠杆：

1. **降低 `C` 的稳态值** → 每轮重放成本线性下降（主收益，来自 `thresholdRatio`）。
2. **降低 `R`** → 每次压缩后的重写成本下降，且摘要请求更小（来自 `retainTokens`）。
3. **让免费修剪先吃掉可剪部分** → 减少付费摘要次数（来自 pruner 预算）。

### 2.2 硬约束（Capability Floor，不可交易）

1. **不得以减少验证、跳过测试、隐藏证据换取 token 下降**。压力路径的 `compactionRetries` 与溢出恢复 `maxOverflowRetries` 不得下调到 0。
2. **不得让 `auto: false`**：那只是把成本转嫁给溢出错误。
3. **不得修改 `retainTokens`/`retainRatio` 至 `≥ thresholdTokens`**（加载期即拒绝：`config.ts:148-154`）。
4. **不得触碰系统提示词/工具 schema 的稳定前缀**（会让每轮缓存全部失效，与目标相反）。

---

## 3. 阶段 P0：基线测量（零改动，半天）

**目的**：把 §1.2/§1.3 的推算换成实测，产出定档依据。

### 3.1 手段

用 `dev_stage_add` 挂一个**只读 staging 探针**（不进 tools schema、不污染缓存前缀、不落盘）：

- `ctx.get('sessions').list()` / `.get(id)` — 枚举会话（`packages/core/session/src/index.ts:1129,1137`）
- `ctx.get('tokenMeter').measure(session)` — 压力估算（`measure(session)` 返回 `totalTokens/surfaceTokens/nodes`）
- `session.ownEvents()` — 扫 `assistant/message` 的 provider usage 与 `compaction/*` 事件（`packages/core/session/src/index.ts:203`）

### 3.2 探针要产出的 6 个数

| # | 指标 | 用途 |
|---|---|---|
| 1 | `measure().totalTokens` | 当前压力读数 |
| 2 | 最近一次 `usage.inputTokens + cacheReadTokens + cacheWriteTokens` | **精确** prompt 大小 |
| 3 | `2 / 1` 比值 | **本机中文 tokenizer 修正系数** |
| 4 | `cacheReadTokens / 精确prompt` | 缓存命中率 → 决定压缩收益大小 |
| 5 | 距上次 `compaction/summary` 的轮次数与该事件 `shadowedTokenCount` | 压缩间隔与释放量 |
| 6 | 压力 / 候选阈值（0.2/0.25/0.35/0.5） | 三档方案的命中频率对比 |

### 3.3 明确不做

不改任何配置、不重启、不写文件；探针用完即 `dev_stage_demote`。

---

## 4. 阶段 P1：配置层优化（零代码，唯一立即生效的原生手段）

### 4.1 部署形态（决策 D1，已定）

**复制随包 `standard` → 用户 preset `dsh-compact`**，并把默认切过去：

```bash
# 1) 原生"创作即复制"：整目录复制到用户根
cp -r ~/Workspace/deepseek-harness/packages/preset/agent-presets/presets/standard \
      ~/.dsh/.agent-presets/dsh-compact

# 2) 改展示元数据（id = 目录名，须匹配 [a-z0-9][a-z0-9-]*）
#    ~/.dsh/.agent-presets/dsh-compact/preset.yml
#    name: 标准模式（压缩调优）
#    description: 标准模式 + 自动压缩阈值/保留预算调优
#    order: 10

# 3) 只改 compaction 组里 compaction-basic 的 config（见 §4.2）

# 4) 切换默认（用户层，随时可切回 standard）
#    ~/.dsh/settings.yaml → agent-presets.default: dsh-compact
```

**理由**：preset patch 不跨 include 边界（§1.4），用户 preset 是唯一"既原生又不碰上游"的载体；`standard` 保持只读，回滚 = 把 `default` 改回 `standard`。

**副作用提示**：preset 组装文件带 stamp 代际（`README.zh.md:100`），改文件后**新会话**用新代际，运行中会话不受影响。

### 4.2 参数方案（三档，待 P0 数据选一）

只改这一段：

```yaml
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
      config:
        thresholdRatio: 0.35        # ← 档位变量
        retainTokens: 48000         # ← 档位变量（与 retainRatio 互斥）
        maxTokens: 8192
        compactionRetries: 1
        maxOverflowRetries: 1
        auto: true

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 6144        # ← 更早开剪（免费）
        headChars: 3072
        tailChars: 1024             # 约束：head + marker + tail ≤ thresholdChars
```

| 档位 | `thresholdRatio` | 实际阈值 | `retainTokens` | 适配场景 |
|---|---|---|---|---|
| 保守 | `0.50` | 500k | `64000` | 先观察，只解决"永不触发" |
| **平衡（建议起点）** | **`0.35`** | **350k** | **`48000`** | 长任务 + 大窗口模型的折中 |
| 激进 | `0.20` | 200k | `32000` | 中文重负载、成本敏感；若 P0 显示缓存命中率高可再放开 |

**每项的取舍依据**：

- `thresholdRatio` **0.8 → 0.35**：这是主杠杆。存活上下文减半，每轮重放成本大致同比例下降；代价是压缩次数变多（每次一次摘要调用）。0.8 在 1M 窗口上实质等于"关闭自动压缩"。
- `retainRatio` **→ `retainTokens`**：比例会随窗口放大（16% × 1M = 16 万 token 逐字保留），既抬高了摘要请求，又抬高了压缩后的缓存重写量。绝对预算让"保留多少"与模型的窗口上限**解耦**，按人的工作记忆而非模型容量来定。
- `maxTokens` 保持 **8192**：检查点是结构化摘要，8k 足够；调大只会增加输出成本。
- `compactionRetries` / `maxOverflowRetries` 保持 **1**：属 §2.2 硬约束。
- pruner `thresholdChars` **8192 → 6144**：修剪免费（不发模型调用），更早开剪能直接把一部分压力吃掉，**跳过整次摘要**。注意 `head + marker + tail ≤ thresholdChars` 是加载期校验（`compaction-tool-result-pruner/src/config.ts:56-62`）。

### 4.3 若 P0 显示 tokenizer 严重低估中文

三种应对（按优先级）：
1. 在 §4.2 选**更激进一档**（用比例补偿读数偏差）；
2. 若偏差稳定且大，进入 P2，在策略里引入 P0 测出的修正系数；
3. 不为此改上游 `token-meter`（属上游路线图项："tokenizer 精确测量，暂缓"）。

### 4.4 P1 验收

| 指标 | 期望 |
|---|---|
| 长会话中出现 `compaction/start…summary…end` 事件 | 从"几乎没有"变为**按预期频率出现** |
| 压缩时 `shadowedTokenCount` | 与阈值同量级（而非一次性 80 万） |
| 任务质量 | 不出现"压缩后丢失关键决策/待办"的退化 |
| `/compact` 手动路径 | 仍可用且不报 busy（未动 `compactNow` 语义） |
| 回滚 | 改回 `agent-presets.default: standard`，新会话即恢复 |

---

## 5. 阶段 P2：引擎层优化（可选，需写代码；**仅在 P0/P1 数据证明必要时启动**）

### 5.1 要解决的两个残留问题

1. **触发时机是纯压力驱动**：可能在一次多步任务中途压缩，打断工作记忆（SoL-Pi 的 Online Context Compact 正是针对此）。
2. **完全不看缓存经济学**：压力高但缓存命中率也高时，早压缩反而亏。

### 5.2 原生实现骨架

```ts
// 插件包：@suxeca/dsh-compaction-occ（名字待定）
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
// ↓ 上游 package.json 显式声明了 "./src/*": "./src/*" 导出（已核实）
import { selectCompactableRange } from '@deepseek-ai/dsh-compaction-basic/src/region.ts'

export class BoundaryAwareEngine extends BasicCompactionEngine {
  // 1) 监听 session/event 的 `todo/write`，捕获 in_progress → completed 跃迁，
  //    置一个"边界候选"标记（todo 事件由 tool-todo 持久化追加，是原生信号）
  // 2) override compactIfNeeded(agent, trigger, signal)：
  //    - trigger === 'context-overflow' → 完全交给 super（§2.2 不允许削弱恢复）
  //    - trigger === 'pressure' → 自行判定：
  //        effectiveThreshold = base × f(边界标记, 观测到的 cacheRead/Write 结构)
  //        · 无边界标记且压力 < base 阈值        → return null（保持现状）
  //        · 有边界标记且压力 ≥ 经济阈值          → 用 selectCompactableRange 选范围后 compactRegion
  //        · 每次真实压缩后清标记，并设冷却步数（防止连续压缩打穿缓存）
  // 3) 不新增 CompactionTrigger 成员：仍以 'pressure' 调用，语义在子类内部细化
}
```

挂载方式（仍是纯配置，写在 `dsh-compact/agent.cordis.yml` 的同一 group 内）：

```yaml
      - id: compaction-basic
        name: '@suxeca/dsh-compaction-occ'     # 替换引擎实现（realm 内仍只有一个 ctx.compaction）
```

插件包以**包名**被 preset 行引用 —— 这是原生解析路径（`classifyRowSpecifier` 把非相对/非绝对名归为 `package`，从 profile 的 `node_modules` 解析；见 `packages/preset/agent-presets/src/specifier.ts:50-58`）。用现有工具链：`dev_scaffold_plugin` → `dev_build_plugin` → `dev_install_package`（装进 `web` profile）。

### 5.3 风险与备选（必须写清，否则不做）

| 风险 | 说明 | 缓解 |
|---|---|---|
| 依赖 `./src/*` 导出 | `selectCompactableRange` 只从源码路径可达（构建产物 `lib/types/region.js` 未进 exports map）。本 checkout 的 Loader 本来就以 `src/*.ts` 加载这些包（loader 入口即 `packages/**/src/index.ts`），所以可用；但**上游若重排 src 布局会破** | 只用这一个导入；封装在单文件适配层里；升级时先跑一次冒烟 |
| 与上游策略分叉 | 自实现阈值判定＝复制了上游的策略分支，可能随版本漂移 | 主路径仍调 `super.compactIfNeeded`；仅"低于阈值但已到边界"这一支自实现 |
| 双引擎冲突 | realm 内只能有一个 `ctx.compaction` | 替换而非并存（同一行改 name） |
| 压缩抖动 | 边界触发过密会反复重写缓存，反向变贵 | 冷却窗口 + 经济门槛 + P0 的命中率数据 |

**更保守的备选（若上面任一条不可接受）**：P2 只做 §1.7 的 `summarize()` 契约升级（改检查点小节与措辞），它只依赖**文档化钩子**，不碰 `src/*` 深导入；边界触发与缓存经济学则放弃，退回"纯 P1 配置调优 + 手动 `/compact`"。

---

## 6. 交付物与时间盒

| 阶段 | 交付物 | 时间盒 |
|---|---|---|
| P0 | 探针脚本片段 + 一份实测报告（6 项指标） | 0.5 天 |
| P1 | `~/.dsh/.agent-presets/dsh-compact/`（preset.yml + agent.cordis.yml）+ settings 默认切换 + 验收记录 | 0.5 天 |
| P2（可选） | 插件包 `dsh-compaction-occ`（build 产物 + profile 装配）+ 对照实验数据 | 2–3 天 |

---

## 7. 风险登记（整体）

| # | 风险 | 等级 | 处理 |
|---|---|---|---|
| R1 | 阈值降太狠导致压缩过频，摘要调用反而更贵 | 中 | 三档 + P0 实测；从"平衡档"起步，观察一周 |
| R2 | token meter 低估中文 → 实际压力高于读数 | 中 | P0 标定修正系数；必要时选更激进一档 |
| R3 | 压缩后质量退化（丢待办/丢决策） | 中 | 验收项含质量回归；`retainTokens` 不从 48k 起再往下砍 |
| R4 | 用户 preset 复制体随上游 `standard` 演进而过期 | 低 | 记一个"上游 standard 变更时同步"的检查项 |
| R5 | P2 的上游 `src/*` 布局变更 | 低 | 单点适配层 + 升级冒烟 |

---

## 8. 明确不做（本轮边界）

1. ❌ 不改 `~/Workspace/deepseek-harness/packages/**` 任何文件（含随包 `standard` preset）。
2. ❌ 不动 SoL-Pi 的另外三项（Action Fusion / ObservationPack / EPR）。
3. ❌ 不改 `spill-policy.maxInlineBytes`（属"逐观察衰减"杠杆，不在 autocompact 范围；若要一并做，另开计划）。
4. ❌ 不新增 `CompactionTrigger` 成员、不与 `compaction-basic` 并存第二个引擎。
5. ❌ 不为了"降本"削弱溢出恢复与重试（§2.2）。

---

## 附录 A：证据索引

| 结论 | 出处 |
|---|---|
| 默认阈值/保留/重试 | `packages/compaction/compaction-basic/src/config.ts:20-23,89-95` |
| 参数校验（retain < threshold、互斥） | 同上 `:148-154,240-242` |
| 自动触发监听器 | `packages/compaction/compaction-basic/src/index.ts:138-166` |
| 溢出恢复 | 同上 `:180-224` |
| 修剪调用点（触发后） | 同上 `:282-312` |
| 唯一定制钩子 `summarize()` | 同上 `:231`；`src/summarizer.ts:31,69,186` |
| 封闭 `CompactionTrigger` | `packages/compaction/compaction/src/index.ts:25` |
| 宿主行被禁用 | `packages/bundle/web-app/cordis.patch.yml:420-434` |
| 生效 preset 无 config | `packages/preset/agent-presets/presets/standard/agent.cordis.yml:138-157` |
| 本机默认 preset | `~/.dsh/settings.yaml:7-8`；会话日志头 `agentPreset: standard` |
| 路由模型窗口 | `~/.dsh/settings.yaml` → `llm-pi-ai.providers.cmdcode.models` |
| 中文启发式低估 | `packages/compaction/compaction-basic/README.zh.md:255` |
| 精确缓存用量字段 | `packages/llm/llm/src/types.ts:149-163`；`packages/llm/llm-deepseek/src/types.ts:163-176` |
| preset 行解析规则 | `packages/preset/agent-presets/src/specifier.ts:50-58` |
| 创作即复制 | `packages/preset/agent-presets/src/authoring.ts:127`；`README.zh.md:75` |
| preset 无 patch 继承 | `packages/preset/agent-presets/presets/standard/`（仅 `agent.cordis.yml` + `preset.yml`） |
| patch 不跨 include 边界 | `docs/architecture.zh.md:27` |
| 会话/计量 API | `packages/core/session/src/index.ts:203,1129,1137`；`packages/llm/token-meter/src/types.ts:22-35` |

## 附录 B：回滚手册

```bash
# 完全回滚 P1
sed -i 's/^  default: dsh-compact$/  default: standard/' ~/.dsh/settings.yaml
# （或直接在设置界面把默认 preset 切回 standard）
# 彻底移除用户 preset
rm -rf ~/.dsh/.agent-presets/dsh-compact
```

P2 回滚：把 `dsh-compact/agent.cordis.yml` 里那一行的 `name` 改回 `@deepseek-ai/dsh-compaction-basic`，或 `dev_uninject_plugin dsh-compaction-occ`。

## 附录 C：本轮不做、留档备查

SoL-Pi 另外三项与 DSH 的对应关系（**不在本计划实现队列**）：Action Fusion ↔ 可用 `ctx.tools.execute()` 做复合工具（原生嵌套派发，穿过审批与沙箱）；ObservationPack ↔ DSH 已有 `spill-policy`（50KB + head/tail + locator）与 `read offset/limit` 分页召回，缺的只是阈值与召回动作；Evidence-Preserving Reducer ↔ 需引入第二模型路由 + 字面校验屏障（涉及隐私决策）。

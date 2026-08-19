# 上下文 / 预设层兼容性审计（dsh-plugin 生态）

- 审计人：context-auditor（team plugin-compat-review，task t3）
- 日期：2026-08-19
- 范围：router presets / sage-mem / dsh-custom-thinking / dsh-agent-teams / dsh-super-injector 的上下文与预设层交互；另核验 synapse / smooth-stream / secure-context-polyfill 无上下文面
- 基线：deepseek-harness 本机 checkout（web 运行时 rc.6+），live profile 装配清单（dev_plugin_status 实测）

## 0. 审计对象（上下文/预设层清单）

| 组件 | 版本/位置 | 上下文面 | 结论 |
|---|---|---|---|
| router 预设（repo） | `presets/router-standard`（routing-suite 范式，v2 bootstrap + near-field 引导） | system-prompt/assemble 改写 + session/event 引导 + dev_router_* 工具 | ⚠️ 见 R1/R2 |
| router 预设（live 安装） | `~/.dsh/.agent-presets/router-spec` + `router-standard`（bootstrap-v1，routerMode=standard / spec，RL 接口还原） | 同上（routing-suite：保留 near-field 引导） | ⚠️ 见 R3 |
| sage-mem（live） | `~/Workspace/sage-mem` v0.1.1（**/mem 拉取模式**） | `/mem` 命令 + `agent.inject`（plugin 源）+ 只记录 `source.kind==='user'` | ✅ 兼容 |
| sage-mem（repo 收录） | `third-party/sage-mem` v0.1.3（**自动注入**模式） | `agent/session-start` 自动注入 + 记录全部 user/message | ⚠️ 文档漂移 R4 |
| dsh-custom-thinking | `packages/dsh-custom-thinking` 0.0.1（运行时注入 entry 5d360ef9） | 仅 settings path ops + `/custom-thinking` API；无 prompt/事件钩子 | ✅ 兼容 |
| dsh-agent-teams | `third-party/dsh-agent-teams` 0.1.7 | `systemPrompt.section('agent-teams:usage', 117)` + followup 投递（plugin 源）+ 成员 persona（deployment:persona） | ⚠️ 见 R1/R2 |
| dsh-super-injector | `third-party/dsh-super-injector` 0.3.3 | loader.create 运行时装配 + `llm/stream` 被动观察 + startIngest 播种会话 | ✅ 兼容（R5/R6 备注） |
| dsh-synapse | `third-party/dsh-synapse` 0.3.0 | 仅 session/created + session/event 投影（被动） | ✅ |
| dsh-smooth-stream | npm 0.3.2 | host 仅 tapIndex HTML + settings；无上下文面 | ✅ |
| dsh-secure-context-polyfill | `packages/dsh-secure-context-polyfill` | host apply() 为空，纯 client | ✅ |

## 1. 关键机制事实（代码级验证）

- **成员 persona 注入点**：`subagent/subagent/src/child-agent.ts:168-173` — `applyChildComposition` 先 `composeFrom`（继承父会话的 standing preset），再 `systemPrompt.section({ name: 'deployment:persona', order: 0, text: memberPersona })`。
- **router 的 persona 改写点**：`presets/router-standard/router-core.mjs` `applyPersona` — 丢弃所有 `/persona/i` 命名的 section（含 `deployment:persona`），换成 `router-persona`；bootstrap 每次 assembly 同时返回 `contexts: []`（**清空全部运行时上下文**，含 host 平面注册的 `sandbox:policy`(110) / `approval:policy`(115) 与 `subagent:delegation`(120)）。
- **v1 standard（RL）模式**：sections 只保留 plan 段 + router-persona，其余全部丢弃（连 `agent-teams:usage`(117) 也丢）。
- **sage-mem 注入形态**（live）：`source: { kind: 'plugin', plugin: 'sage-mem' }`，role=user，文本带「背景参考、非任务」框定；只把 `source.kind==='user'` 的消息写入 worker。
- **agent-teams 投递形态**：`followup(..., { source: { kind: 'plugin', plugin: 'dsh-agent-teams' } })`（members.ts:381）→ 成员 inbox 消息全部为 plugin 源；文件邮箱 `.agent-teams/<team>/inbox/*.jsonl`。
- **router 的会话分类过滤**：`sessionModeUser` 只分类 `source.kind==='user'`（live core 同款，含防御性 `data.message` 解包）——正是为 sage-mem 自动注入打的补丁。
- **startIngest 播种**：super-injector `startIngest` 用 `source: { kind: 'user' }` 直接播种新会话（data 即消息本体，不套 `message:` 层——曾因嵌套形状误判 weak，两侧已联动修复）。

## 2. 兼容性矩阵（上下文/预设层）

| A ＼ B | router 预设 | sage-mem | custom-thinking | agent-teams | super-injector |
|---|---|---|---|---|---|
| **router 预设** | — | ✅ 过滤兼容（plugin 源跳过分类/引导） | ✅ 正交（无钩子） | ⚠️ **R1 条件性冲突**（persona/contexts 被替换清空） | ✅ 工具名零碰撞（dev_router_* vs dev_*）；startIngest 任务分类为预期 |
| **sage-mem** | ✅（过滤后互不污染） | — | ✅ | ✅（team 消息 plugin 源不入记忆；welcome 噪音见 R4） | ✅（ingest 提示词入记忆=噪音 R5） |
| **custom-thinking** | ✅ | ✅ | — | ✅（reasoningEfforts 同源，resolveCallConfig 一致） | ✅（运行时注入共存正常） |
| **agent-teams** | ⚠️ **R1/R2**（激活时成员 persona 丢失） | ✅ | ✅ | — | ✅（patch bundle 与 loader.create 双通道共存） |
| **super-injector** | ✅ | ✅ | ✅ | ✅ | — |

## 3. 风险清单

### R1（高·条件性）router 预设 ↔ agent-teams：成员 persona 与全部 contexts 被替换/清空

- 触发条件：队长会话**实际运行** router 预设（Router Standard / Router Spec），且在其下 `agent_teams_add_member`。
- 链路：成员 spawn → `deployment:persona`（成员身份/工作规则）→ 首请求 assembly 时 router `applyPersona` 匹配 `/persona/i` 将其替换为 `router-persona`；同时 `contexts: []` 清掉 `subagent:delegation`、`sandbox:policy`、`approval:policy` 语句。v1-standard（RL）模式连 `agent-teams:usage` 协议段也丢弃。
- 影响：成员不知道自己是谁/该 claim 任务/如何汇报 → 团队协议整体失效；模型看不到当前沙箱/审批策略陈述（仅信息性，host 侧强制不失效）。
- 修复方向（任选）：① router `applyPersona` 保留 `deployment:persona`（按 name 精确匹配 `persona`/`deployment:persona` 之外才替换）；② agent-teams 把成员 persona 改注册为 context（`systemPrompt.context`，如 order 5）而非 section；③ 文档明示：router 预设下不要开 AgentTeams。
- 现状：**未激活**。本团队 captain 会话 header 记 `agentPreset: router-standard`，但 live `agent-preset/selected` 事件为 `standard`，成员全部继承 `standard`（实测首轮工具面完整、无 dev_router_*、成员 persona 完好）→ 当前运行无冲突。

### R2（中）router 预设的 contexts 清空是全局副作用

- 除 persona 外，router 在每次 assembly 都 `contexts: []`，会抹掉任何 context 形态的贡献（委派声明、策略陈述、以及未来插件新增的 context 贡献）。v1-standard 还丢弃全部非 persona sections。任何依赖 context/section 注入的插件（如未来记忆型 context 插件）与 router 预设天然冲突。

### R3（中）live router 层当前惰性 + header/live 选择不一致

- 实测：会话 header `agentPreset: router-standard`，但 `agent-preset/selected` 事件为 `standard`；首轮工具裁剪与 dev_router_* 工具均未出现（首调用为 dev_plugin_status/agent_teams_create，均不在 router core 集）。
- 诊断误导：读 header 会以为 router 在跑。建议把「live selection」作为权威并让 header 跟随，或在 UI 明确显示所选预设。
- 附带：安装目录残留旧 `router-bootstrap.mjs`（与现行 `router-bootstrap-v1.mjs` 并存）——按 OPERATIONS.md §3 ESM 缓存规则，升级预设必须换名/删旧目录，否则新会话加载旧代码。

### R4（低·文档漂移）sage-mem 双版本：README/收录版 ≠ live 版

- live（`~/Workspace/sage-mem` v0.1.1）：`/mem` 手动拉取 + 「背景参考、非任务」框定 + 只记录真实用户消息 → 与 router 过滤、agent-teams 消息流完全兼容，且无自污染。
- 收录版（`third-party/sage-mem` v0.1.3）：`agent/session-start` 自动注入 + 记录**全部** user/message（含自身注入块 → 自反馈污染）；router 的 `sessionModeUser` 过滤正是为它而加。
- 建议：README §6 以 /mem 版为准（或收录版同步升级）；两版并存易误导。
- 附注：成员 welcome 消息（`source.kind==='user'`，如 "You have joined the team..."）会被 live sage-mem 记入全局记忆库 → 轻量噪音；团队消息本身（plugin 源）不入记忆 ✓。

### R5（低）super-injector startIngest 的种子消息会进入 router 分类与 sage-mem 记忆

- 播种以 `source.kind==='user'` 创建会话：router（若激活）会将其按任务分类（预期内）；sage-mem live 会将其录入记忆库（自动化 ingest 提示词 = 记忆噪音）。历史嵌套 `data.message` 形状 bug 已在 injector 端（直写 data）+ router-core `extractText` 防御解包双修。

### R6（信息）无碰撞面核对

- 工具名：`agent_teams_*`(10) / `dev_router_status`·`dev_router_mode`·`dev_mode_subagent` / `dev_*`(18) 全零重叠。
- 事件监听：`system-prompt/assemble` 仅 router 独占改写；`session/event` 消费者（sage-mem、synapse、router 引导）互不写冲突（synapse 仅投影）；`llm/stream` 仅 injector 被动观察（next() 委托）。
- 命令：`/mem` 唯一，无内置冲突；`commands` 服务 live 已装配 ✓。
- 设置写入：custom-thinking 写 `llm-pi-ai.providers.<route>.models[].reasoningEfforts`，与 agent-teams `resolveMemberLlmSelection`→`ctx.llm.resolveCallConfig` 同源一致；未声明 reasoningEfforts 的路由被请求显式 effort 时会 loud 失败（agent-teams 在路由变更时主动省略 effort）。
- loader 装配：sage-mem/agent-teams/synapse/smooth-stream/super-injector 均 patch-insert 单行、id 唯一；注入器 `hasActiveEntry` 按包名防双实例；`dev_fix_patch` 可清重复 entry。

## 4. 交叉验证提示（给 reviewer）

- host 侧：injector 的 loader.create「幽灵 entry」可与官方 bundle entry 并存冲突（自愈优先官方装配）——与 plugin-manager 双写 profile package.json 的风险同源（duplicate loader entry id）。
- client 侧：custom-thinking 设置区块（client-auditor 已验）与本文 R6 的 settings 写入链路闭合。
- 当前团队会话本身即「agent-teams + standard 预设」组合的活体样本：成员 persona / 委派声明 / 全量工具均完好 → 佐证 R1 未激活。

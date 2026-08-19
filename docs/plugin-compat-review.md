# DSH 插件生态兼容性评审报告（最终版）

- 评审人：reviewer（team plugin-compat-review，task t4 综合评审）
- 日期：2026-08-19
- 输入：host-auditor（t1）/ client-auditor（t2）/ context-auditor（t3）三份审计报告 + 我方的交叉验证（只读代码/路由探针，未修改任何文件）
- 配套报告：`docs/client-ui-compat-audit.md`（t2）、`docs/context-preset-compat-audit.md`（t3）
- 基线：deepseek-harness 本机 checkout（rc.6+），web profile 实时装配（dev_plugin_status 实测 + HTTP 路由探针）

---

## 一、结论总览

**整体兼容性健康**：13 个已装配插件的 host 路由/ctx 注入/工具注册、client 的 slot/快捷键/命令/样式命名空间均无冲突，唯一**已确认的崩溃级高风险是 super-injector 设置页的单参 legacy register（H1）**；另有一个**条件性高风险**（H2，router 预设 × agent-teams，当前未激活）；t1 报告的最高危项「synapse 装配静默失败」经实测为**假阳性**（路由与 API 全活，已降级为工具可见性缺口 L11）。

## 二、已确认高风险项

### H1（高·已激活）dsh-super-injector 设置页渲染即崩

- **现象**：设置面板「插件管理（dsh-super-injector）」区块渲染崩溃，页面显示错误条；导航行「插件」入口仍在（label 单独解析），点击进入是错误页。
- **影响**：注入器 GUI 管理面不可用（工具/命令不受影响）；用户无法从设置页卸载/管理插件。
- **根因**：`third-party/dsh-super-injector/lib/client.js:44-47` 用**单参 legacy 形态** `ctx.slots.register({ name, id, order, label, component: () => ({ render() {...} }) })`；当前运行时 `packages/client/runtime/src/client/slots.ts:356-370` 的 `_register(options, component)` 只取第二参 component，**不读 `options.component`** → entry.component = undefined → 渲染期 `React.createElement(undefined)` 抛错 → scoped-slots 边界捕获并 abdicate。全 harness 无 legacy 适配层（api-catalog / runtime slots.ts 已确认）。
- **建议修法**：改为现代双参 `register(opts, Component)`（或 `slots.inject` + 函数组件）；单点改动，重载即愈。
- **涉及插件**：dsh-super-injector（唯一 legacy 注册者；其余 4 个 settings.section 注册者均为现代双参，id/order 唯一无冲突）。

### H2（高·条件性，当前未激活）router 预设 × agent-teams：成员 persona 与全部 contexts 被替换/清空

- **现象/触发条件**：队长会话**实际运行** router 预设（Router Standard/Spec/Opencode-Go/Command Code）时 `agent_teams_add_member`，成员 persona 与协议上下文全部丢失。
- **影响**：成员不知道自己是谁、不 claim 任务、不汇报 → 团队协议整体失效；沙箱/审批策略陈述（仅信息性）丢失；v1-standard（RL）模式连 `agent-teams:usage` 协议段也丢弃。
- **根因**（代码级验证）：
  - `~/.dsh/.agent-presets/router-standard/router-core.mjs:182-184` — `applyPersona` 过滤所有 `/persona/i` 命名的 section，成员 persona（`subagent/.../child-agent.ts:168-173` 的 `deployment:persona`）被替换为 `router-persona`；
  - `router-bootstrap-v1.mjs:116,129`（repo v2 同款 :67,81）— 每次 assembly `contexts: []`，清掉 `subagent:delegation` / `sandbox:policy` / `approval:policy`。
- **现状佐证（未激活）**：本团队 captain header 记 `router-standard` 但 live `agent-preset/selected` 为 `standard`，成员继承 standard，实测成员 persona/全量工具完好 → 当前会话无冲突。
- **建议修法**（任选）：① router `applyPersona` 精确匹配（仅替换名为 `persona` 的段，保留 `deployment:persona`）；② agent-teams 把成员 persona 改注册为 context（如 order 5）而非 section；③ 文档明示该组合不支持。
- **涉及插件**：dsh-agent-teams × router presets（dsh-agent-presets 层）。

## 三、中风险与低风险清单

### 中风险（M1–M7）

| # | 风险 | 影响 | 证据（可追溯） | 涉及插件 | 建议修法 |
|---|---|---|---|---|---|
| M1 | 装配清单双写无锁：plugin-manager 与 super-injector 双写同一 profile package.json（dependencies+bundles），注入器另写 cordis.patch.yml disabled 条目，dev_fix_patch 共编辑同文件 | 并发/交替操作可产生重复 loader entry id、装配态撕裂；loader.create 幽灵 entry 与官方 bundle entry 并存 | plugin-manager `lib/index.js:21-24,74-109` 写 `dsh.profile.bundles`；super-injector `lib/index.js:8628-8652` 自愈读同列表、7417-7419 对账防双实例（可自愈但无协调） | plugin-manager × super-injector | 引入单一写者/文件锁，或接受现状并保留对账自愈；`dev_fix_patch` 保持为兜底 |
| M2 | SDK 多实例：进程树 ≥4 份物理 @deepseek-ai 拷贝，super-injector 源 checkout 自带 `dsh-tools/dsh-system-prompt 0.1.0-rc.5`（唯一版本偏移） | rc.5 与 rc.6 同 rc 线内基本兼容，但跨版本行为差异不可控；升级 SDK 时容易漏更新 | 实测：agent-teams/better-sidebar 自有 nm 全 rc.6；super-injector nm 仅 rc.5；harness rc.6；profile nm rc.6 | super-injector（+全部自带 nm 插件） | 同步 super-injector 源 checkout 的 node_modules 到 rc.6；长期：peer 依赖上移宿主 |
| M3 | vision-toolkit peer 声明失真 + 双源漂移：装载 `~/Workspace/dsh-vision-toolkit` v0.1.2（peerDeps dsh-tools `^0.0.1`，运行时 SDK rc.6）；repo submodule @anionex v0.1.6（声明 `^0.1.0-rc.6` 匹配） | loader 不校验 peer 故当前可加载；一旦宿主校验 peer 或 API 漂移即断 | package.json 实测 | vision-toolkit | 修正 peerDeps 范围；统一装载源与仓库收录源 |
| M4 | smooth-stream 直接改写他人 `conversation.chat.node` entry 的 entry.component（除 assistant-step/user/steering/command-input 外全包装） | 非声明 API；HMR 重载叠加包装（WeakSet 每次激活新建）；与 agent-teams 卡片/未来渲染器变更强耦合 | t2 报告 §1.2/§2 R2 | smooth-stream | 改「chain/list 槽」或包装渲染层（如 conversation.view 链） |
| M5 | better-sidebar layout.css 硬编码 `#root > div[data-slot="root"] > div > div:nth-child(2)` 结构选择器 | web 壳 DOM 结构变更即静默失效（面板从推挤布局退化为悬浮覆盖） | t2 报告 §1.5 R3 | better-sidebar | 用 data 属性/槽位替代 nth-child 路径 |
| M6 | router 预设 `contexts: []` 清空是全局副作用 | 任何以 context 形态贡献的插件（委派声明、策略、未来记忆型 context 插件）与 router 预设天然冲突 | `router-bootstrap-v1.mjs:116,129` | router presets × 所有 context 贡献者 | router 改为增量保留/白名单策略 |
| M7 | live router 层惰性：header `router-standard` 与 live selected `standard` 不一致；首轮工具裁剪与 dev_router_* 均未出现；残留旧 `router-bootstrap.mjs`（ESM 缓存陷阱） | 读 header 会误判 router 在跑；升级预设不换名会加载旧代码 | `~/.dsh/.agent-presets/router-standard/` 目录实测（bootstrap 与 bootstrap-v1 并存，agent.cordis.yml:57-58 引用 v1） | router presets（live 安装层） | header 跟随 live selection；删除旧 bootstrap 文件；预设升级遵守 OPERATIONS.md §3 换名规则 |

### 低风险（L1–L11）

| # | 风险 | 影响 | 涉及插件 |
|---|---|---|---|
| L1 | 设置页导航 label 重名「插件」×2（内置 ui-settings-plugins vs super-injector `label: () => "插件"`，client.js:47） | UX 混淆，不崩溃 | super-injector |
| L2 | 右上角视觉重叠：agent-teams floater 与 better-sidebar 折叠 toggle cluster；lab-kit cockpit 打开时对话子树隐藏 → better-sidebar 几何探测 0 尺寸 | 视觉级错位，无功能破坏 | agent-teams × better-sidebar × lab-kit |
| L3 | vision-toolkit `--dsw-alias-*` var() 无 fallback；lab-kit selector 依赖 css-module 后缀 | design-platform.css 改名/移除或模块哈希变化即静默样式丢失 | vision-toolkit / lab-kit |
| L4 | 4 个 body 级 MutationObserver 全树 subtree 观测 + 多 body portal | 大 DOM 下轻微性能开销 | lab-kit / conversation-share |
| L5 | custom-thinking ↔ `llm-pi-ai` settings schema 跨插件数据契约（`providers.<route>.models[].reasoningEfforts`） | schema 演化需双方同步，无版本协商 | custom-thinking × llm-pi-ai |
| L6 | webserver 路由命名空间约定（/_dsh vs /plugins vs 顶级前缀）仅靠惯例 | 未来插件可能撞前缀（当前 16 处注册全部 distinct，host 对重复会 throw） | 生态整体 |
| L7 | systemPrompt 重载残留模式不统一：super-injector 的 context 注册非 effect 包裹（try/catch 容忍重复），lab-kit/agent-teams 均 effect 包裹 | 热重载残留行为不一致 | super-injector |
| L8 | smooth-stream peer 全 `*` 通配 + dependencies 钉死 `@deepseek-ai/dsh-settings 0.1.0-rc.6` | 当前版本一致；SDK 升级即断 | smooth-stream |
| L9 | sage-mem 双版本文档漂移：live `~/Workspace/sage-mem` v0.1.1（/mem 拉取+只记 user+「背景参考」框定，与 router/agent-teams 完全兼容）vs repo `third-party/sage-mem` v0.1.3（自动注入+记录全部 user/message → 自反馈污染；router 的 sessionModeUser 过滤正是为它打的补丁） | 读 README/收录版会得到错误行为预期 | sage-mem（双源） |
| L10 | super-injector `startIngest` 种子（kind=user）进入 router 分类（预期）且被 sage-mem 记入记忆库；成员 welcome 消息（kind=user）同样入记忆 | 自动化/系统消息 = 记忆轻噪音；嵌套 data.message 形状 bug 两侧已双修 | super-injector × sage-mem |
| L11 | **dev_plugin_status 未列出 dsh-synapse（工具可见性缺口）** — 由 t1 的 HIGH 降级而来 | 仅清单显示缺失；功能全活（见裁决 §六.2） | super-injector（清单工具） |

## 四、推荐动作（按可执行性排序）

**可直接做（改一处源码/删一个文件，重载/重启即愈）：**
1. **H1**：super-injector `lib/client.js:44` 改现代双参 `register(opts, Component)` —— 最高 ROI，一处小改消除唯一崩溃级问题。
2. **H2**：router `applyPersona` 精确匹配（保留 `deployment:persona`），或 agent-teams persona 改注册为 context —— 消除条件性高危；改前在文档标注「router 预设下勿开 AgentTeams」作临时护栏。
3. **M7**：删除 `~/.dsh/.agent-presets/router-standard/router-bootstrap.mjs` 残留；header 与 live `agent-preset/selected` 对齐。
4. **M3**：vision-toolkit peerDeps 修正为 `^0.1.0-rc.6`；统一装载源与 submodule 版本。
5. **M5**：better-sidebar layout.css 换 data-slot 属性选择器（已有 `body[data-dsh-sidebar-collapsed]` 替代方案可扩展）。
6. **M4**：smooth-stream 改为 chain/list 槽或 conversation.view 链，停止篡改他人 entry.component。
7. **L1**：super-injector 设置页 label 改名（如「注入器」）或并入内置 plugins tab。
8. **L3**：vision-toolkit 关键 var() 补 fallback；lab-kit selector 优先 data-slot seam。

**需人工决策（涉及设计取舍/多方协调）：**
9. **M1**：plugin-manager × super-injector 双写协调 —— 选择「单一写者 + 文件锁」还是「接受现状 + 对账自愈兜底」。
10. **M2**：SDK 多实例版本策略 —— 是否统一为 rc.6（至少同步 super-injector 源 checkout）。
11. **M6**：router contexts 清空策略 —— 白名单/增量保留是设计决策，影响所有 context 贡献插件。
12. **L9**：sage-mem 双版本取舍 —— 以 /mem 版为准并同步收录版，或反向。
13. **L11**：dev_plugin_status 是否补显 synapse（低价值，功能正常，仅工具可见性）。

## 五、未发现问题的插件组合（防假阳性，明确列出）

以下组合经三方审计 + 我方复核，**确认无冲突**：

- **webserver 路由**：16 处注册全部 distinct（host 对重复 (kind,path) 会 throw），`/plugins/*` 与 host client-modules 的 `/plugins/@deepseek-ai/*` 前缀共存无遮蔽（asset 200 image/png 实测）；lab-kit `/lab-kit`、plugin-manager `/plugin-manager`、custom-thinking `/custom-thinking`、agent-teams `/plugins/dsh-agent-teams/*` 等命名空间互不重叠。
- **ctx 注入**：生态插件依赖的服务（webServer/settings/workspaceRegistry/systemPrompt/tools/commands/sessions/subagents/agents/llm/credentials/skills/subprocess/webRuntime/timer/loader/connection）host 全部存在；生态自提供服务无同名；agent-teams 双名回退有韧性。
- **systemPrompt 区块名**：lab-kit `plugin:lab-kit`(115)、agent-teams `agent-teams:usage`(117)、super-injector `dsh-super-injector`(-90) 无撞名；`system-prompt/assemble` 仅 router 独占改写。
- **工具注册**：`agent_teams_*`(10) / `terminal_*`(8) / `dev_*`(20+) / `dev_router_*` / `vision_*`(10) 与内置工具零重名。
- **client slots**：`conversation.chat.node` key（agent-teams 唯一）、`tool.call.toolview` key（vision_* 与内置零重叠）、`conversation.input.dock` id（vision-toolkit-pasted-images 唯一）、`settings.plugin.item` id 唯一；settings.section 的 id/order 全部唯一（除 H1 的 API 形态问题）。
- **快捷键**：session-switcher 全局 chords（Ctrl+K/Alt+K/Ctrl+[ ]/Ctrl+B 等）与壳层无冲突，IME 双守卫（capture + keyCode229）无互相干扰。
- **命令**：仅 `/plugin`（plugin-manager）与 `/mem`（sage-mem），与内置零重名。
- **样式命名空间**：`--dsw-alias-*`（web base.css → design-platform.css，158 tokens）运行期必然存在；super-injector legacy `--theme-*` 全部带 fallback。
- **插件组合**：lab-kit × session-switcher × plugin-manager × secure-context-polyfill × custom-thinking 五者相互之间无功能冲突（唯一交集 settings.section，id/order 唯一）；secure-context-polyfill 与全部插件无交互面（纯 client Web API polyfill，host apply 为空）。
- **活体验证**：当前团队会话 =「agent-teams × standard 预设」组合，成员 persona/委派声明/全量工具完好 → H2 未激活的最直接佐证；sage-mem worker 在线（activeSessions:1），agent-teams 消息以 plugin 源投递不入记忆。

## 六、交叉验证与裁决记录（去重/假阳性处置）

1. **去重合并**：t1「sage-mem 双源漂移」与 t3「R4 文档漂移」合并为 L9；t1「plugin-manager/super-injector 双写」与 t3 交叉提示「幽灵 entry × 官方 bundle entry 同源（duplicate loader entry id）」合并为 M1；t1「systemPrompt 区块名」与 t3「R6 事件/命令零碰撞」互为印证，归入 §五。
2. **【裁决】t1 HIGH「synapse 装配静默失败」= 假阳性，降级为 L11**。实测驳斥：`/synapse/` 返回 synapse 自身 HTML（非 SPA fallback）；`/synapse/app.js` HTTP 200 且字节数 61162 与磁盘文件完全一致；`/synapse/api/workspaces` 返回真实 JSON（workspaces 含 threadCount:16，createdAt 2026-08-19）；`/synapse/api/threads/<uuid>` 返回 synapse 源码 `index.js:756` 的 404 文案「接口不存在」；数据文件 `~/.dsh/synapse/workspaces.json` 于 2026-08-19 11:23（本次评审进行中）持续写入。synapse 已装配且全功能运行；t1 观察到的「loader roster 无此 entry / dev_plugin_status 不显示」确为事实，但结论方向错误——真实残留问题是**清单工具可见性缺口**，非功能失效。根因推测（未实锤）：dev_plugin_status 的清单来源（super-injector inventory）对该 entry 的归属/分组判定与 include 组不一致。
3. **【裁决】H1（t2 R1）成立**：源码 + 运行时双端核验（`lib/client.js:44-47` 单参调用 vs `slots.ts:356-370` 忽略 options.component），无 legacy 适配层。
4. **【裁决】H2（t3 R1）成立但限缩**：机制代码级核验无误；严重度维持高但明确标注「条件性、当前未激活」，避免与 H1 并列造成误读。
5. **分歧说明**：t1 与 t2/t3 对 super-injector 的评价方向不同（t1 视其 context 注册 try/catch 模式为「其他插件未跟进的不统一」，t2 视其设置页为崩溃点）——两者互补不矛盾，已分别入 L7 与 H1。
6. 所有裁决均有文件路径/行号或 HTTP 实测依据；本报告未引用任何未经核验的断言。

## 七、审计范围说明

- 覆盖 13 个已装配插件：lab-kit、session-switcher、vision-toolkit、sage-mem、plugin-manager、conversation-share、better-sidebar、secure-context-polyfill、super-injector、smooth-stream、agent-teams、custom-thinking、synapse（+ wallpapers/目录选择器等辅助插件）。
- 三维度 = host 接口（路由/ctx/工具/peer 依赖）＋ client UI（侧边栏/设置页/快捷键/命令/slot/样式）＋ 上下文预设层（router presets/sage-mem/custom-thinking/agent-teams/super-injector 交互）。
- 本评审为只读审计 + 报告落盘（本文件）；未修改任何插件源码或装配配置。

---

## 八、修复记录（2026-08-19，评审后执行）

| # | 风险项 | 修复内容 | 状态 |
|---|---|---|---|
| H1 | super-injector 设置页崩溃 | `third-party/dsh-super-injector/src/client/index.ts` 重写：注册改为现代双参 `register(opts, Component)`；页面 DOM 构建逻辑移入 `mountPage(host)`，经薄 React 组件 `SuperInjectorPage`（useEffect + ref）挂载；已重建（tsdown → lib/client.js，与 profile 装载路径同 inode 自动同步）并热重载，host `/super-injector/api/list` 正常、client bundle 已服务新代码 | ✅ 已修复 |
| L1 | 设置页 label 重名「插件」 | 同上：label 改为 `'注入器'`（`src/client/index.ts` register 调用） | ✅ 已修复 |
| M3 | vision-toolkit peerDeps 声明失真 | `~/Workspace/dsh-vision-toolkit/package.json` peerDeps 全部对齐 v0.1.6 参考声明（`^0.1.0-rc.6` 系列 + `@deepseek-ai/cordis ^4.0.1`），删除旧 `cordis`/`schemastery` 裸键；link: 装载即时生效 | ✅ 已修复 |
| M7 | router-standard 残留旧 bootstrap | 删除 `~/.dsh/.agent-presets/router-standard/router-bootstrap.mjs`（agent.cordis.yml 已引用 v1，旧文件零引用，删除后目录仅剩 v1 + core） | ✅ 已修复 |
| H2 | router 预设 × agent-teams（条件性） | **按用户决策不修**：agent-teams 仅在 DSH 官方预设（standard/spec）下使用，router 预设组合不会激活 | ⏸ 有意保留 |

> 修复全部为声明/注册形态修正，未改变任何插件行为语义；H1/L1 涉及源码改动，M3/M7 为元数据与残留清理。

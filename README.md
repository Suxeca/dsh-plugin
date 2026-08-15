# dsh-plugin · DSH 个人插件合集

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的**个人插件合集**仓库：既包含本仓库自研并发布到 npm 的插件（`packages/`），也通过 git submodule 收录日常在用的第三方/自研插件（`third-party/`），一份 README 说清每个插件是什么、怎么装。

> 所有插件以 **bundle 形态**安装进 profile，无需修改或重新构建 DSH 本身：`dsh plugin --profile web add <包名>` 后重启 dsh web 即生效。

## 插件总览

| 插件 | 包名 / 来源 | 功能 | 安装方式 | 状态 |
|---|---|---|---|---|
| 会话切换面板 | `@suxeca/dsh-client-ui-session-switcher`（本仓库） | Ctrl+K 调色板切换对话，Ctrl+[ / ] 循环 + 布局快捷键（折叠/全屏各栏） | npm | ✅ 已发布 rc.5 |
| 插件管理器 | `@suxeca/dsh-plugin-manager`（本仓库） | `/plugin` 命令 + 设置页列出/安装/卸载插件 | npm | ✅ 已发布 rc.4 |
| 科研台 Lab Cockpit | `@deepseek-ai/dsh-lab-kit`（本仓库） | 侧边栏「研究台」扫描展示工作区研究项目 | 本地 link | ✅ 在用 |
| Better Sidebar 工作台 | [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) | 文件管理/编辑预览/PDF/终端/Git/浏览器/任务面板 | npm / GitHub | ✅ 在用 v0.12.x |
| 安全上下文补丁 | 私人本地插件（源码不入库） | 浏览器兼容补丁：polyfill 缺失的 `crypto.randomUUID` / `AbortSignal.timeout` / `AbortSignal.any` | 私人本地 link | ✅ 在用 |
| 视觉工具箱 | `@anionex/dsh-vision-toolkit`（[submodule](third-party/dsh-vision-toolkit)） | 原生视觉工具：识图、OCR、像素级定位、UI 还原 | npm | ✅ 在用（本地 link 0.1.2 · 上游 v0.1.6） |
| 记忆系统 | `sage-mem`（[submodule](third-party/sage-mem)） | 跨会话记忆：自动沉淀 + 检索注入，中文优先 | GitHub 源 | ✅ 在用（本地 link 0.1.1 · 上游 0.1.3） |
| 对话分享 | `@bill9109/dsh-conversation-share`（[submodule](third-party/dsh-conversation-share)） | 选取对话片段分享为品牌化 PNG 长图 | GitHub 源 | ✅ 在用 v0.1.1 |
| 超级模组注入器 | `@yjh051108/dsh-super-injector`（[submodule](third-party/dsh-super-injector)） | 运行时注入任意插件包，免重启；热重载/自重载/卸载即净 | GitHub 源 | ✅ 在用 v0.3.1 |
| 推理模式路由 | [`presets/router-standard`](presets/router-standard) + [`presets/router-opencode-go`](presets/router-opencode-go)（本仓库） | 任务感知路由：spec/react/weak 模式、首轮工具裁剪、模型自适应 | 复制到 `~/.dsh/.agent-presets/` | ✅ 在用 v2 |

## 自研插件（本仓库 `packages/`）

### 1. dsh-client-ui-session-switcher · 会话快速切换面板

会话调色板 + 键盘流切换 + **布局快捷键**（联动 DSH 左侧栏与 better-sidebar 工作台）：

- `Ctrl+K` / `Alt+K` 打开调色板：↑↓ 选择、`N` 新建、`A` 归档、`T` 归档视图 + `U` 取消归档、`R` 重命名、`S` 搜索、皮肤切换（深色/浅色/高对比）
- `Ctrl+[` / `Ctrl+]` 在面板关闭时按**左侧栏可见顺序**循环切换对话（工作区显示序 → 区内最近活动在前 → 未分组垫底）
- 布局快捷键（VSCode 风格，Mac 自动 ⌘ 化；Ctrl+K 面板 → ⚙ 快捷键 可全部改键）：

| 功能 | 默认键位 | 联动 |
|---|---|---|
| 折叠/展开左侧栏（会话列表） | `Ctrl+B` | DSH `ctx.layout` |
| 折叠/展开右侧栏（工作台） | `Ctrl+Shift+B` | better-sidebar `ctx.betterSidebar` |
| 折叠/展开底栏 | `Ctrl+J` | better-sidebar `ctx.betterSidebar` |
| 左侧栏全屏 / 还原 | `Alt+Shift+L` | DSH `ctx.layout` |
| 右侧栏全屏 / 还原 | `Alt+Shift+R` | better-sidebar `ctx.betterSidebar` |
| 退出全屏（固定，不可改） | `Esc` | 两者同时退出 |

  中文输入法组合键受 IME 防护（不误触发）；工作台侧基于 better-sidebar v0.12 的 `panelControl` 服务能力（`togglePanel` / `toggleBottomPanel` / `setFullscreen` / `toggleFullscreen`），服务缺失时对应键位静默 no-op。
- 面板按工作区分节，打开时默认选中当前会话，滚动跟随

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add @suxeca/dsh-client-ui-session-switcher
```

npm: `@suxeca/dsh-client-ui-session-switcher@0.1.0-rc.5`（tag `dsh-v*` 触发 CI 自动发布并提升 latest）。布局快捷键回归脚本：[`scripts/verify-shortcuts.mjs`](scripts/verify-shortcuts.mjs)（无头 Chrome E2E，13 项断言）。

### 2. dsh-plugin-manager · 插件管理器

- `/plugin` 人类命令：`list` / `install` / `uninstall` / `status`
- 设置页「插件管理」：列表 / 卸载 / 安装 / 刷新
- `/plugin-manager/*` JSON 路由 + `ctx.pluginManager` 服务；host 半原生 Node 直读写 `~/.dsh/profiles/web/package.json`
- 设计原则：**故意不注册模型工具**——激活/重载不击穿 turn 内前缀缓存；安装/卸载 = 改 profile 后重启生效

```sh
pnpm dsh plugin --profile web add @suxeca/dsh-plugin-manager
```

npm: `@suxeca/dsh-plugin-manager@0.1.0-rc.4`。

### 3. dsh-lab-kit · 科研台 Lab Cockpit

侧边栏「研究台」入口：扫描工作区目录（识别 `.git` 或 `.summary.md`），按最近修改排序展示研究项目列表；host 经 `/lab-kit/projects` 路由提供 JSON。

```sh
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-lab-kit
```

本地 link 安装（`private`，未发布 npm）。

### 4. 浏览器兼容补丁（🔒 私人使用，源码不入库）

纯 Client 私人插件；本仓库**只记录原理，不收录源码、包名、安装路径或网络部署信息**。DSH 前端直接调用若干较新的浏览器 Web API，在部分访问环境下缺失会导致目录选择器、附件草稿与 RPC 调用等功能崩溃：

- `crypto.randomUUID` —— **secure-context-only** API（仅 HTTPS / loopback 存在），纯 HTTP 非本机地址下为 `undefined`
- `AbortSignal.timeout`（2022）、`AbortSignal.any`（2023）—— 旧引擎 / 嵌入式 WebView 缺失

**原理**：插件在浏览器侧按原生语义安装等价实现，幂等（原生存在时跳过）：
- `crypto.randomUUID` → `crypto.getRandomValues` 构造 RFC 4122 UUID v4（version/variant 位正确）
- `AbortSignal.timeout(ms)` → 一次性定时器 + `AbortController`，abort 时 reason 为 `TimeoutError`，abort 后清除定时器
- `AbortSignal.any(signals)` → `AbortController` 组合，任一输入 abort 即 abort，reason 取首个 abort 输入

对应上游社区讨论：[#514](https://github.com/deepseek-ai/deepseek-harness/discussions/514) / [#1050](https://github.com/deepseek-ai/deepseek-harness/discussions/1050)。上游原生兼容后可移除该私人补丁。

## 收录插件（`third-party/` submodule）

### 5. dsh-vision-toolkit · 视觉工具箱

把 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) 带入 DSH 的原生 Profile Bundle：给纯文本 agent 装上眼睛——意图感知识图问答、OCR、原始像素定位、UI 还原、像素级验证、Artifact 管理与 Web 设置，10 个独立工具，按需渐进暴露。

- 上游：<https://github.com/Anionex/dsh-vision-toolkit>（v0.1.6，MIT，162 测试）
- 安装：`dsh plugin --profile web add @anionex/dsh-vision-toolkit`

### 6. sage-mem · DSH 记忆系统

跨会话记忆：监听 DSH 事件流，工具调用自动沉淀，LLM 压缩为结构化记忆（事实/摘要，中文输出）；新会话启动自动检索注入。**中文优先**——worker 用 trigram 分词 + 短词 LIKE 兜底，中文检索全命中（FTS5 默认分词器对中文 0 命中）。fork 自 [claude-mem](https://github.com/thedotmack/claude-mem)（Apache-2.0）加中文修复，DSH 侧仅一个轻量桥接插件。

- 上游：<https://github.com/gezi-wen/sage-mem>
- 架构：DSH 插件 → HTTP → Bun 常驻 worker → SQLite（FTS5 trigram）
- 安装：`dsh plugin --profile web add github:gezi-wen/sage-mem`（另需按上游说明常驻 worker 服务）

### 7. dsh-conversation-share · 对话分享

在 DSH Web 会话流中选取一段对话范围（可拖拽、磁吸对齐的范围标记），一键导出为**品牌化 PNG 长图**分享——适合把关键对话/结论发到飞书、微信、汇报材料。

- 上游：<https://github.com/bill9109/dsh-conversation-share>（v0.1.1，GitHub 源安装，未发布 npm）
- 安装：`dsh plugin --profile web add github:bill9109/dsh-conversation-share`

### 8. dsh-better-sidebar · 文件预览与右侧工作台

VSCode 风格右侧栏 + 底部面板：文件树、文本/Markdown/图片/PDF 预览与编辑、真实终端、Git、内嵌浏览器、后台任务和第三方 Tab/文件查看器扩展接口。

- 上游：<https://github.com/omdsh-dev/DSH-better-sidebar>（本机使用 v0.12.x）
- 安装：`dsh plugin --profile web add dsh-better-sidebar`
- **高权限边界**：Host 侧具备文件读写、PTY shell、Git 和浏览器能力；它不是只读预览器。仅应安装在受信任的 DSH 实例和严格受控的网络访问边界内。
- 本机当前目录含一份行为修订快照；README 只记录官方 GitHub 上游，不把该不可移植的本地 root commit 作为 submodule 发布。

### 9. dsh-super-injector · 超级模组注入器

DSH 生态的 **BepInEx 式模组注入入口**：运行时把任意本地插件包注入运行中的 web，不碰 patch / package.json / bundles 列表、不重启进程。**注入即完整生效（host 工具 + client UI）**。自带热重载、自重载（失败自动 rollback）、卸载即净、一键自检。

- 上游：<https://github.com/yjh051108/dsh-super-injector>（v0.3.1，按 [docs/SPEC.md](third-party/dsh-super-injector/docs/SPEC.md) 源码契约重构）
- 安装（引导一次，之后万物皆可运行时注入）：`dsh plugin --profile web add github:yjh051108/dsh-super-injector`
- **高权限边界**：注入器以进程内代码执行能力运行任意插件包——仅应安装在受信任的 DSH 实例上。

### 10. 推理模式路由 presets（`presets/`）

DSH 的 [dsh-agent-presets](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/preset/agent-presets) 扫描 `~/.dsh/.agent-presets/<id>/agent.cordis.yml` 发现本地 preset，每个目录即一个可选「推理模式」预设。本仓库收录**本机在用的两个路由 preset**（会话首条用户消息 → 任务分类 → 注入对应 persona + 首轮核心工具集；首个工具调用后暴露完整工具目录，模式从持久会话事件推导，resume 不丢）：

- **`router-standard`** — 通用任务感知路由：spec（plan-first）/ react（doer）/ weak（模型自路由）/ mixed 四模式，连续轴映射三稳定行为区（实测：spec [0, 0.15]、过渡带 [0.2, 0.45] 需显式 opt-in、react [0.5, 1.0]）。派生自 [yjh051108/dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)（MIT，含论文与 P1–P23 实验数据）；本地 v2 补丁：`sessionModeUser` 过滤 plugin/系统注入消息（sage-mem 记忆注入文本会把「你好」会话污染成 spec），只分类真实用户消息
- **`router-opencode-go`** — provider 限定变体（opencode-go / deepseek-v4-flash），实测三项适配：flash 模型恒定 weak 路由（+91% 推理）、WEAK_FLASH 携带深度思考锚（+50%）、移除失效的近场引导；provider 路由只记录不硬门控（装配期 `variables` 与真实请求可能不一致）

安装（两个 preset 各自一个目录）：

```sh
mkdir -p ~/.dsh/.agent-presets
cp -r presets/router-standard ~/.dsh/.agent-presets/
cp -r presets/router-opencode-go ~/.dsh/.agent-presets/
# 重启 DSH 后新建会话，选择 Router Standard / Router Opencode-Go
```

⚠️ 安装副本须保持唯一模块文件名（loader 按 URL 缓存 ESM 模块，原地覆盖会拿到旧缓存）；升级时先删旧目录再复制。

**运维（`router-opencode-go`）**：完整运维模型见 [`presets/router-opencode-go/OPERATIONS.md`](presets/router-opencode-go/OPERATIONS.md)（安装链：注入器自重载确认 → `dev_self_test` 8/8 → 装预设 → discovery → 冒烟；ESM 缓存更新规则；故障诊断矩阵；已知环境坑）。一键健康检查：

```sh
bash presets/router-opencode-go/scripts/verify.sh   # 注入器活性 + 预设 discovery + 文件完整性 + 环境体检
```

> 注入器（dsh-super-injector）是安装/运维层的"手术台"：预设运行时**不依赖**它（走官方 agent-presets 通道），但按作者指导先确保注入器自重载可用再装预设，问题归因时也先查注入器再查预设。

路由本身对 agent 可见：`dev_router_status` 查看当前模式/路由，`dev_router_mode` 调整（band 名 / 0-100 / 0.0-1.0），`dev_mode_subagent` 以隔离模式执行子任务。

**同类项目对比**：本仓库 `router-opencode-go` 与 [SheberDavid/v4-flash-godmode-opencode-go](https://github.com/SheberDavid/v4-flash-godmode-opencode-go)（V4 Flash 神模式）同源于 yjh051108/dsh-router-standard。主要差别：provider 架构（本仓库手动选模型 + 实际路由记录 vs 对方全局改默认模型）、sage-mem 污染修复（本仓库 `sessionModeUser` 对非 flash 同样生效）、`dev_mode_subagent` 实际路由、完整运维体系。详见 [`docs/compare-v4-godmode.md`](docs/compare-v4-godmode.md)。

## 目录结构

```
packages/                  # 本仓库自研插件（monorepo，tsdown 构建 + vitest）
  dsh-client-ui-session-switcher/
  dsh-plugin-manager/
  dsh-lab-kit/
third-party/               # 收录的在用插件（公开上游用 submodule；本地修订快照会被忽略）
  dsh-vision-toolkit/
  sage-mem/
  dsh-conversation-share/
  dsh-super-injector/
  dsh-better-sidebar/      # 本机修订快照（gitignored；官方上游见插件说明）
presets/                   # 推理模式路由 presets（复制到 ~/.dsh/.agent-presets/ 安装）
  router-standard/         #   通用路由（上游 yjh051108 派生 + v2 补丁；含 MIT LICENSE）
  router-opencode-go/      #   opencode-go provider 限定变体（本机自研）
docs/DEVELOPMENT.md        # 插件开发指南（新建包、构建、安装、扩展点速查）
dsh-architecture-map.html  # DSH 架构地图（zoom-out 交互可视化）
dsh-venn.html              # Profile · Bundle · Patch 维恩图
```

## 安装与使用

本机 dsh 位于 npx 缓存，标准调用在 harness 仓库下执行：

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add <包名或 link: 路径>
# 重启 dsh web 后生效
```

⚠️ 同一插件不能同时以两个来源留在 bundles（link 版 + npm 版会 duplicate loader entry id 导致功能消失）——换源必须先卸载旧条目。

## 开发

```sh
pnpm install
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓单测
pnpm build          # 构建全部插件
```

发版流程：改版本号 → `git tag dsh-vX.Y.Z && git push origin dsh-vX.Y.Z` → GitHub Actions 自动发布到 npm（`@suxeca` scope）并提升 `latest`。

## 相关文档

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 插件开发指南
- [`dsh-architecture-map.html`](dsh-architecture-map.html) / [`dsh-venn.html`](dsh-venn.html) — DSH 架构可视化
- 上游参考：deepseek-harness `docs/`（cordis 教程、extension-cookbook、capability-seams）

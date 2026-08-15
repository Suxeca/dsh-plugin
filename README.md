# dsh-plugin · DSH 个人插件合集

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的**个人插件合集**仓库：自研插件（`packages/`）+ 常用第三方/自研插件收录（`third-party/` submodule）+ 推理模式路由预设（`presets/`），一份 README 说清每个组件是什么、怎么装。

> **安装形态**：所有插件以 **bundle 形态**装进 profile，无需修改或重建 DSH 本身。
> 通用命令：`dsh plugin --profile web add <包名>` → 重启 dsh web 生效（详见 [安装与使用](#安装与使用)）。

## 目录

- [插件总览](#插件总览)
- [自研插件（`packages/`）](#自研插件packages)
- [收录插件（`third-party/`）](#收录插件third-party)
- [推理模式路由预设（`presets/`）](#推理模式路由预设presets)
- [目录结构](#目录结构)
- [安装与使用](#安装与使用)
- [开发](#开发)
- [相关文档](#相关文档)

---

## 插件总览

| 组件 | 包名 / 来源 | 功能 | 安装 | 状态 |
|---|---|---|---|---|
| 会话切换面板 | `@suxeca/dsh-client-ui-session-switcher`（自研） | Ctrl+K 调色板切对话、键盘循环、布局快捷键 | npm | ✅ rc.5 |
| 插件管理器 | `@suxeca/dsh-plugin-manager`（自研） | `/plugin` 命令 + 设置页管理插件 | npm | ✅ rc.4 |
| 科研台 Lab Cockpit | `@deepseek-ai/dsh-lab-kit`（自研） | 侧边栏「研究台」扫描展示研究项目 | 本地 link | ✅ 在用 |
| Better Sidebar 工作台 | [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) | 文件/预览/终端/Git/浏览器/任务面板 | npm / GitHub | ✅ v0.12.x |
| 浏览器兼容补丁 | 私人本地（源码不入库） | polyfill `crypto.randomUUID` / `AbortSignal.*` | 私人 link | ✅ 在用 |
| 视觉工具箱 | `@anionex/dsh-vision-toolkit`（[submodule](third-party/dsh-vision-toolkit)） | 识图、OCR、像素级定位、UI 还原 | npm | ✅ 在用 |
| 记忆系统 | `sage-mem`（[submodule](third-party/sage-mem)） | 跨会话记忆：自动沉淀 + 检索注入 | GitHub 源 | ✅ 在用 |
| 对话分享 | `@bill9109/dsh-conversation-share`（[submodule](third-party/dsh-conversation-share)） | 对话片段导出品牌化 PNG 长图 | GitHub 源 | ✅ v0.1.1 |
| 超级模组注入器 | `@yjh051108/dsh-super-injector`（[submodule](third-party/dsh-super-injector)） | 运行时注入插件包，免重启、热重载、自愈 | GitHub 源 | ✅ v0.3.1 |
| 推理模式路由 | [`presets/router-standard`](presets/router-standard) + [`presets/router-opencode-go`](presets/router-opencode-go) | 任务感知路由：spec/react/weak + 首轮工具裁剪 | 复制到 `.agent-presets/` | ✅ v2 |

---

## 自研插件（`packages/`）

### 1. dsh-client-ui-session-switcher · 会话快速切换面板

会话调色板 + 键盘流切换 + VSCode 风格布局快捷键（联动 DSH 左侧栏与 better-sidebar 工作台）。

**能力**

- `Ctrl+K` / `Alt+K` 调色板：↑↓ 选择、`N` 新建、`A` 归档、`T` 归档视图 + `U` 取消归档、`R` 重命名、`S` 搜索、皮肤切换
- `Ctrl+[` / `Ctrl+]` 按左侧栏可见顺序循环切换对话
- 布局快捷键（Mac 自动 ⌘ 化；面板 → ⚙ 可改键）：

| 功能 | 默认键位 | 联动 |
|---|---|---|
| 折叠/展开左侧栏 | `Ctrl+B` | DSH `ctx.layout` |
| 折叠/展开右侧栏 | `Ctrl+Shift+B` | better-sidebar `ctx.betterSidebar` |
| 折叠/展开底栏 | `Ctrl+J` | better-sidebar `ctx.betterSidebar` |
| 左侧栏全屏/还原 | `Alt+Shift+L` | DSH `ctx.layout` |
| 右侧栏全屏/还原 | `Alt+Shift+R` | better-sidebar `ctx.betterSidebar` |
| 退出全屏（固定） | `Esc` | 两者同时退出 |

- 中文输入法组合键受 IME 防护；工作台侧基于 better-sidebar v0.12 `panelControl` 服务，缺失时静默 no-op
- 面板按工作区分节，打开时选中当前会话，滚动跟随

**安装**

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add @suxeca/dsh-client-ui-session-switcher
```

**参考**

- npm：`@suxeca/dsh-client-ui-session-switcher@0.1.0-rc.5`（`git tag dsh-v*` 触发 CI 自动发布）
- 回归脚本：[`scripts/verify-shortcuts.mjs`](scripts/verify-shortcuts.mjs)（无头 Chrome E2E，13 项断言）

### 2. dsh-plugin-manager · 插件管理器

**能力**

- `/plugin` 人类命令：`list` / `install` / `uninstall` / `status`
- 设置页「插件管理」：列表 / 卸载 / 安装 / 刷新
- `/plugin-manager/*` JSON 路由 + `ctx.pluginManager` 服务；host 半原生 Node 直读写 `~/.dsh/profiles/web/package.json`

**设计原则**

- 故意不注册模型工具——激活/重载不击穿 turn 内前缀缓存
- 安装/卸载 = 改 profile 后重启生效

**安装**

```sh
pnpm dsh plugin --profile web add @suxeca/dsh-plugin-manager
```

**参考**：npm `@suxeca/dsh-plugin-manager@0.1.0-rc.4`。

### 3. dsh-lab-kit · 科研台 Lab Cockpit

侧边栏「研究台」入口：扫描工作区目录（识别 `.git` 或 `.summary.md`），按最近修改排序展示研究项目；host 经 `/lab-kit/projects` 路由提供 JSON。

**安装**

```sh
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-lab-kit
```

**参考**：本地 link 安装（`private`，未发布 npm）。

### 4. 浏览器兼容补丁（🔒 私人使用，源码不入库）

纯 Client 私人插件；本仓库**只记录原理**，不收录源码、包名、安装路径或网络部署信息。DSH 前端依赖的浏览器 API 在部分访问环境下缺失，会导致目录选择器、附件草稿与 RPC 调用崩溃。

**缺失 API**

- `crypto.randomUUID` —— secure-context-only（仅 HTTPS / loopback 存在）
- `AbortSignal.timeout`（2022）、`AbortSignal.any`（2023）—— 旧引擎 / 嵌入式 WebView 缺失

**原理**（浏览器侧按原生语义安装等价实现，幂等：原生存在时跳过）

- `crypto.randomUUID` → `crypto.getRandomValues` 构造 RFC 4122 UUID v4
- `AbortSignal.timeout(ms)` → 一次性定时器 + `AbortController`，abort reason 为 `TimeoutError`
- `AbortSignal.any(signals)` → `AbortController` 组合，reason 取首个 abort 输入

**参考**：上游社区讨论 [#514](https://github.com/deepseek-ai/deepseek-harness/discussions/514) / [#1050](https://github.com/deepseek-ai/deepseek-harness/discussions/1050)；上游原生兼容后可移除。

---

## 收录插件（`third-party/`）

### 5. dsh-vision-toolkit · 视觉工具箱

把 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) 带入 DSH 的原生 Profile Bundle：给纯文本 agent 装上眼睛。

**能力**：意图感知识图问答、OCR、原始像素定位、UI 还原、像素级验证、Artifact 管理、Web 设置 —— 10 个独立工具，按需渐进暴露。

**参考**

- 上游：<https://github.com/Anionex/dsh-vision-toolkit>（v0.1.6，MIT，162 测试）
- 安装：`dsh plugin --profile web add @anionex/dsh-vision-toolkit`

### 6. sage-mem · DSH 记忆系统

跨会话记忆：监听 DSH 事件流，工具调用自动沉淀，LLM 压缩为结构化记忆（事实/摘要，中文输出）；新会话启动自动检索注入。**中文优先**——worker 用 trigram 分词 + 短词 LIKE 兜底（FTS5 默认分词器对中文 0 命中）。

**参考**

- 上游：<https://github.com/gezi-wen/sage-mem>（fork 自 [claude-mem](https://github.com/thedotmack/claude-mem)，Apache-2.0 + 中文修复）
- 架构：DSH 插件 → HTTP → Bun 常驻 worker → SQLite（FTS5 trigram）
- 安装：`dsh plugin --profile web add github:gezi-wen/sage-mem`（另需按上游说明常驻 worker）

### 7. dsh-conversation-share · 对话分享

在会话流中选取一段对话范围（可拖拽、磁吸对齐），一键导出为**品牌化 PNG 长图**分享——适合发飞书、微信、汇报材料。

**参考**

- 上游：<https://github.com/bill9109/dsh-conversation-share>（v0.1.1，未发布 npm）
- 安装：`dsh plugin --profile web add github:bill9109/dsh-conversation-share`

### 8. dsh-better-sidebar · 文件预览与右侧工作台

VSCode 风格右侧栏 + 底部面板。

**能力**：文件树、文本/Markdown/图片/PDF 预览与编辑、真实终端、Git、内嵌浏览器、后台任务、第三方 Tab/文件查看器扩展接口。

**参考**

- 上游：<https://github.com/omdsh-dev/DSH-better-sidebar>（本机 v0.12.x）
- 安装：`dsh plugin --profile web add dsh-better-sidebar`
- ⚠️ **高权限边界**：Host 侧具备文件读写、PTY shell、Git 与浏览器能力，不是只读预览器——仅应装在受信任的 DSH 实例和严格受控的网络边界内
- 本机目录含行为修订快照（gitignored）；README 只记录官方上游

### 9. dsh-super-injector · 超级模组注入器

DSH 生态的 **BepInEx 式模组注入入口**：运行时把任意本地插件包注入运行中的 web，不碰 patch / package.json / bundles、不重启。**注入即完整生效（host 工具 + client UI）**。

**能力**：热重载、自重载（失败自动 rollback）、卸载即净、一键自检（`dev_self_test` 8 项）、开发侧挂区（staging）转正。

**参考**

- 上游：<https://github.com/yjh051108/dsh-super-injector>（v0.3.1，按 [docs/SPEC.md](third-party/dsh-super-injector/docs/SPEC.md) 源码契约重构）
- 安装（引导一次，之后万物皆可运行时注入）：`dsh plugin --profile web add github:yjh051108/dsh-super-injector`
- ⚠️ **高权限边界**：注入器以进程内代码执行能力运行任意插件包——仅应装在受信任的 DSH 实例上

---

## 推理模式路由预设（`presets/`）

DSH 的 [dsh-agent-presets](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/preset/agent-presets) 扫描 `~/.dsh/.agent-presets/<id>/agent.cordis.yml` 发现本地 preset。本仓库收录**本机在用的两个路由预设**，机制一致：

- 会话首条**真实用户消息** → 任务分类 → 注入对应 persona + 首轮核心工具集
- 首个工具调用后暴露完整工具目录；模式从持久会话事件推导，resume 不丢

### router-standard · 通用路由

- **定位**：通用任务感知路由（上游 [yjh051108/dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)，MIT，含论文与 P1–P23 实验数据）
- **模式**：spec（plan-first）/ react（doer）/ weak（模型自路由）/ mixed，连续轴映射三稳定行为区（spec [0, 0.15]、过渡带 [0.2, 0.45] 需显式 opt-in、react [0.5, 1.0]）
- **本地 v2 补丁**：`sessionModeUser` 只分类真实用户消息——过滤 sage-mem 等 plugin 注入（其文本会把「你好」会话污染成 spec）

### router-opencode-go · opencode-go 限定变体

- **定位**：opencode-go / deepseek-v4-flash provider 限定（本机自研）
- **实测适配**（三组对照实验，同任务/同模型/reasoningEffort=max）：
  - Flash 恒定 weak 路由（+91% 推理）
  - WEAK_FLASH 携带深度思考锚（+50% 推理、验证矩阵翻倍）
  - 移除失效的近场引导（rc.6 上 `session/event` 收不到），深度引导静态并入 persona
- **provider 路由只记录不硬门控**（装配期 `variables` 与真实请求 provider 可能不一致，硬门控会误判）

### 安装

```sh
mkdir -p ~/.dsh/.agent-presets
cp -r presets/router-standard ~/.dsh/.agent-presets/
cp -r presets/router-opencode-go ~/.dsh/.agent-presets/
# 重启 DSH 后新建会话，选择 Router Standard / Router Opencode-Go
```

> ⚠️ 安装副本须保持**唯一模块文件名**（loader 按 URL 缓存 ESM 模块，原地覆盖会拿到旧缓存）；升级时先删旧目录再复制。

### 运维（router-opencode-go）

完整运维模型见 [`presets/router-opencode-go/OPERATIONS.md`](presets/router-opencode-go/OPERATIONS.md)：

- 安装链：注入器自重载确认 → `dev_self_test` 8/8 → 装预设 → discovery → 冒烟
- ESM 缓存更新规则、故障诊断矩阵、已知环境坑

一键健康检查：

```sh
bash presets/router-opencode-go/scripts/verify.sh   # 注入器活性 + 预设 discovery + 文件完整性 + 环境体检
```

> 注入器（dsh-super-injector）是安装/运维层的"手术台"：预设运行时**不依赖**它（走官方 agent-presets 通道），但按作者指导先确保注入器自重载可用再装预设，问题归因也先查注入器再查预设。

**agent 可见工具**：`dev_router_status`（当前模式/路由）、`dev_router_mode`（调整 band / 数值）、`dev_mode_subagent`（隔离模式子任务）。

**同类项目对比**：与 [SheberDavid/v4-flash-godmode-opencode-go](https://github.com/SheberDavid/v4-flash-godmode-opencode-go)（V4 Flash 神模式）的差异（provider 架构、sage-mem 修复、subagent 路由、运维体系等）详见 [`docs/compare-v4-godmode.md`](docs/compare-v4-godmode.md)。

---

## 目录结构

```
packages/                  # 自研插件（monorepo，tsdown 构建 + vitest）
  dsh-client-ui-session-switcher/
  dsh-plugin-manager/
  dsh-lab-kit/
third-party/               # 收录的在用插件（公开上游 submodule；本地修订快照忽略）
  dsh-vision-toolkit/
  sage-mem/
  dsh-conversation-share/
  dsh-super-injector/
  dsh-better-sidebar/      # 本机修订快照（gitignored；官方上游见插件说明）
presets/                   # 推理模式路由预设（复制到 ~/.dsh/.agent-presets/ 安装）
  router-standard/         #   通用路由（上游派生 + v2 补丁；含 MIT LICENSE）
  router-opencode-go/      #   opencode-go 限定变体（本机自研）
docs/                      # 文档
  DEVELOPMENT.md           #   插件开发指南
  compare-v4-godmode.md    #   与 v4godmode 差异对比
scripts/                   # 工具脚本
  verify-shortcuts.mjs     #   会话切换快捷键回归（无头 Chrome E2E）
dsh-architecture-map.html  # DSH 架构地图（zoom-out 交互可视化）
dsh-venn.html              # Profile · Bundle · Patch 维恩图
```

---

## 安装与使用

本机 dsh 位于 npx 缓存，标准调用在 harness 仓库下执行：

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add <包名或 link: 路径>
# 重启 dsh web 后生效
```

**注意事项**

- ⚠️ 同一插件不能同时以两个来源留在 bundles（link 版 + npm 版会 `duplicate loader entry id` 导致功能消失）——换源必须先卸载旧条目
- 每个插件的具体安装命令见对应章节；preset 走复制安装（见[上文](#安装)）

---

## 开发

```sh
pnpm install
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓单测
pnpm build          # 构建全部插件
```

**发版流程**

1. 改版本号
2. `git tag dsh-vX.Y.Z && git push origin dsh-vX.Y.Z`
3. GitHub Actions 自动发布到 npm（`@suxeca` scope）并提升 `latest`

---

## 相关文档

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 插件开发指南（新建包、构建、安装、扩展点速查）
- [`docs/compare-v4-godmode.md`](docs/compare-v4-godmode.md) — 与 v4-flash-godmode-opencode-go 差异对比
- [`dsh-architecture-map.html`](dsh-architecture-map.html) / [`dsh-venn.html`](dsh-venn.html) — DSH 架构可视化
- 上游参考：deepseek-harness `docs/`（cordis 教程、extension-cookbook、capability-seams）

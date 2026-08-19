# dsh-plugin · DSH 个人插件合集

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的**个人插件合集**：仓库内维护的插件（`packages/`）+ 常用插件收录（`third-party/`）+ 推理模式路由预设（`presets/`）。

> **安装形态**：所有插件以 **bundle 形态**装进 profile，无需修改或重建 DSH 本身。通用命令 `dsh plugin --profile web add <包名>` → 重启生效（见 [安装与使用](#安装与使用)）。

## 目录

- [插件总览](#插件总览)
- [仓库内插件（`packages/`）](#仓库内插件packages)
- [收录插件（`third-party/`）](#收录插件third-party)
- [推理模式路由预设（`presets/`）](#推理模式路由预设presets)
- [目录结构](#目录结构)
- [安装与使用](#安装与使用)
- [开发](#开发)
- [相关文档](#相关文档)

---

## 插件总览

| 组件　　 | 类型 | 功能 | 安装 | 状态 |
| --- | --- | --- | --- | --- |
| 会话切换面板 | 仓库内　 | Ctrl+K 调色板切对话、键盘循环、布局快捷键 | npm | ✅ rc.6 |
| 科研台 Lab Cockpit | 仓库内　 | 侧边栏「研究台」扫描展示研究项目 | 本地 link | ✅ 在用 |
| 超级模组注入器 | 收录　 | 运行时注入插件包，免重启、热重载、自愈 | GitHub 源 | ✅ v0.3.3 |
| 丝滑流式 | 收录　 | 流式渲染平滑（typewriter/teleprompter） | 本地 link | ✅ v0.3.2+fix |
| Agent Teams | 收录　 | 多 agent 团队协作（captain + 成员） | 本地 link | ✅ v0.1.7 |
| 画布工作区 | 收录　 | 会话/工作区画布投影 | 本地 link | ✅ v0.3.0 |
| 壁纸引擎 | 收录　 | Wallpaper Engine 壁纸集成 | 本地 link | ✅ v0.2.2 |
| Better Sidebar 工作台 | 收录　 | 文件/预览/终端/Git/浏览器/任务面板 | npm / GitHub | ✅ v0.12.x |
| 视觉工具箱　　 | 收录　 | 识图、OCR、像素级定位、UI 还原 | npm | ✅ 在用 |
| 记忆系统　　 | 收录　 | 跨会话记忆：自动沉淀 + 检索注入 | GitHub 源 | ✅ 在用 |
| 对话分享　　 | 收录　 | 对话片段导出品牌化 PNG 长图 | GitHub 源 | ✅ v0.1.1 |
| 浏览器兼容补丁 | 私人　 | polyfill `crypto.randomUUID` / `AbortSignal.*` | 私人 link | ✅ 在用 |
| 推理模式路由 | 预设　 | 任务感知路由：spec/react/weak + 首轮工具裁剪 | 复制安装 | ✅ v2 |

---

## 仓库内插件（`packages/`）

### 1. dsh-client-ui-session-switcher · 会话快速切换面板

| 功能　　 | 说明 |
| --- | --- |
| 调色板　　 | `Ctrl+K` / `Alt+K`：↑↓ 选择、`N` 新建、`A` 归档、`T` 归档视图、`U` 取消归档、`R` 重命名、`S` 搜索、皮肤切换 |
| 对话循环　　 | `Ctrl+[` / `Ctrl+]` 按左侧栏可见顺序切换 |
| 布局快捷键　　 | VSCode 风格（Mac 自动 ⌘ 化；面板 → ⚙ 可改键） |
| IME 防护 | 中文输入法组合键不误触发 |

| 布局快捷键　　 | 默认键位 | 联动 |
| --- | --- | --- |
| 折叠/展开左侧栏 | `Ctrl+B` | DSH `ctx.layout` |
| 折叠/展开右侧栏 | `Ctrl+Shift+B` | better-sidebar `ctx.betterSidebar` |
| 折叠/展开底栏 | `Ctrl+J` | better-sidebar `ctx.betterSidebar` |
| 左侧栏全屏/还原 | `Alt+Shift+L` | DSH `ctx.layout` |
| 右侧栏全屏/还原 | `Alt+Shift+R` | better-sidebar `ctx.betterSidebar` |
| 退出全屏（固定） | `Esc` | 两者同时退出 |

**安装**

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add @suxeca/dsh-client-ui-session-switcher
```

**参考**

| 项　　 | 值 |
| --- | --- |
| npm　　 | `@suxeca/dsh-client-ui-session-switcher@0.1.0-rc.6`（`git tag dsh-v*` 触发 CI 发布） |
| 回归脚本　　 | [`scripts/verify-shortcuts.mjs`](scripts/verify-shortcuts.mjs)（无头 Chrome E2E，13 项断言） |

### 2. dsh-lab-kit · 科研台 Lab Cockpit

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 侧边栏「研究台」：扫描工作区（识别 `.git` / `.summary.md`），按最近修改排序展示项目 |
| 数据流　　 | host 经 `/lab-kit/projects` 路由提供 JSON |

**安装**

```sh
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-lab-kit
```

**参考**：本地 link 安装（`private`，未发布 npm）。

### 3. dsh-custom-thinking · 自定义思考插件

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 运行时注入的思考/推理行为自定义插件 |
| 形态　　 | 注入式（`dev_inject_plugin` 装配，见超级模组注入器） |

**安装**（通过注入器）

```sh
dev_inject_plugin <repo>/packages/dsh-custom-thinking
```

### 4. 浏览器兼容补丁（🔒 私人使用，源码不入库）

纯 Client 私人插件；本仓库**只记录原理**，不收录源码、包名、安装路径或部署信息。缺失 API 会导致目录选择器、附件草稿与 RPC 调用崩溃。

| 缺失 API | 场景 |
| --- | --- |
| `crypto.randomUUID` | secure-context-only（仅 HTTPS / loopback 存在） |
| `AbortSignal.timeout` / `AbortSignal.any` | 旧引擎 / 嵌入式 WebView 缺失 |

| 实现原理　　 | 说明（幂等：原生存在时跳过） |
| --- | --- |
| `randomUUID` | `crypto.getRandomValues` 构造 RFC 4122 UUID v4 |
| `timeout(ms)` | 一次性定时器 + `AbortController`，reason 为 `TimeoutError` |
| `any(signals)` | `AbortController` 组合，reason 取首个 abort 输入 |

**参考**：上游讨论 [#514](https://github.com/deepseek-ai/deepseek-harness/discussions/514) / [#1050](https://github.com/deepseek-ai/deepseek-harness/discussions/1050)；上游原生兼容后可移除。

---

## 收录插件（`third-party/`）

### 5. dsh-super-injector · 超级模组注入器

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | DSH 生态 **BepInEx 式模组注入入口**：运行时注入本地插件包，不碰 patch / package.json / bundles、不重启；注入即完整生效（host 工具 + client UI） |
| 能力　　 | 热重载、自重载（失败自动 rollback）、卸载即净、一键自检（`dev_self_test` 8 项）、开发侧挂区（staging）转正 |
| 上游　　 | <https://github.com/yjh051108/dsh-super-injector>（v0.3.3；本地含 DSH_HOME 支持 + purge 顺序修复 + inject 记账修复） |
| 安装　　 | `dsh plugin --profile web add github:yjh051108/dsh-super-injector`（引导一次，之后万物皆可运行时注入） |
| ⚠️ 高权限边界 | 以进程内代码执行能力运行任意插件包——仅装受信任实例 |

### 6. dsh-smooth-stream · 丝滑流式渲染

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 流式渲染平滑：文字跟着模型走、换行滑入、不闪 |
| 能力　　 | typewriter（打字机）/ teleprompter（提词器）双模式、三种节拍 preset、滚动跟随、FPS 守卫 |
| 上游　　 | <https://github.com/Laplace-bit/dsh-smooth-stream>（v0.3.2；**本地修复：glide 位移钳制防 CJK 字符重叠**，PR #6 已提交上游） |
| 本地修复　 | `teleprompterGlide.ts` 新增 `clampLag()`：位移 ≤ 一行高（28px），杜绝中文/长路径跨行重叠；见 [`FIX-NOTES.md`](third-party/dsh-smooth-stream/FIX-NOTES.md) |
| 安装　　 | `dsh plugin --profile web add dsh-smooth-stream`（本机为 `link:` 本地构建版） |

### 7. dsh-agent-teams · Agent 团队协作

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 多 agent 团队：captain 建队、成员分工、任务依赖调度、消息协作 |
| 能力　　 | 角色成员（researcher/engineer/reviewer）、任务看板、依赖编排、mailbox 直连 |
| 上游　　 | <https://github.com/nanmicoder/dsh-agent-teams>（v0.1.7） |
| 安装　　 | `dsh plugin --profile web add @nanmicoder/dsh-agent-teams`（本机 `link:`） |

### 8. dsh-synapse · 画布工作区

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 会话/工作区画布投影：把 DSH 会话映射到可视化工作区 |
| 能力　　 | 自动投影（autoProjection）、手动拖入会话、本地持久化（workspaces.json） |
| 上游　　 | <https://github.com/liangmianya/dsh-synapse>（v0.3.0；本地含 loaded-sessions 持久化等增强，PR #5 已提交上游） |
| 安装　　 | `dsh plugin --profile web add dsh-synapse`（本机 `link:`） |

### 9. dsh-plugin-wallpaper-engine · 壁纸引擎

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 本地 Steam Wallpaper Engine workshop 目录集成 |
| 上游　　 | <https://github.com/>（v0.2.2） |
| 安装　　 | `dsh plugin --profile web add dsh-plugin-wallpaper-engine`（本机 `link:`） |

### 10. dsh-vision-toolkit · 视觉工具箱

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 把 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) 带入 DSH 的原生 Profile Bundle |
| 能力　　 | 意图感知识图问答、OCR、像素定位、UI 还原、像素验证、Artifact 管理、Web 设置（10 个独立工具，渐进暴露） |
| 上游　　 | <https://github.com/Anionex/dsh-vision-toolkit>（v0.1.6，MIT，162 测试） |
| 安装　　 | `dsh plugin --profile web add @anionex/dsh-vision-toolkit` |

### 11. sage-mem · DSH 记忆系统

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 跨会话记忆：事件流自动沉淀 → LLM 压缩为结构化记忆 → 新会话自动检索注入 |
| 中文优先　　 | worker 用 trigram 分词 + 短词 LIKE 兜底（FTS5 默认分词器对中文 0 命中） |
| 上游　　 | <https://github.com/gezi-wen/sage-mem>（fork 自 [claude-mem](https://github.com/thedotmack/claude-mem)，Apache-2.0 + 中文修复） |
| 架构　　 | DSH 插件 → HTTP → Bun 常驻 worker → SQLite（FTS5 trigram） |
| 安装　　 | `dsh plugin --profile web add github:gezi-wen/sage-mem`（另需按上游说明常驻 worker） |

### 12. dsh-conversation-share · 对话分享

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 会话流中选取一段对话范围（可拖拽、磁吸对齐），导出**品牌化 PNG 长图**（适合飞书/微信/汇报） |
| 上游　　 | <https://github.com/bill9109/dsh-conversation-share>（v0.1.1，未发布 npm） |
| 安装　　 | `dsh plugin --profile web add github:bill9109/dsh-conversation-share` |

### 13. dsh-better-sidebar · 文件预览与右侧工作台

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | VSCode 风格右侧栏 + 底部面板 |
| 能力　　 | 文件树、文本/Markdown/图片/PDF 预览与编辑、真实终端、Git、内嵌浏览器、后台任务、第三方 Tab 扩展接口 |
| 上游　　 | <https://github.com/omdsh-dev/DSH-better-sidebar>（本机 v0.12.x） |
| 安装　　 | `dsh plugin --profile web add dsh-better-sidebar` |
| ⚠️ 高权限边界 | Host 侧具备文件读写、PTY shell、Git、浏览器能力，非只读预览器——仅装受信任实例 |

> 本机目录含行为修订快照（gitignored）；README 只记录官方上游。

---

## 推理模式路由预设（`presets/`）

DSH 的 [dsh-agent-presets](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/preset/agent-presets) 扫描 `~/.dsh/.agent-presets/<id>/agent.cordis.yml` 发现本地 preset。本仓库收录**本机在用的路由预设**（routing-suite 范式，不再依赖 v4-flash-godmode）。

| 机制　　 | 说明 |
| --- | --- |
| 路由　　 | 会话首条**真实用户消息** → 任务分类 → 注入对应 persona + 首轮核心工具集 |
| 解锁　　 | 首个工具调用后暴露完整工具目录；模式从持久会话事件推导，resume 不丢 |
| agent 可见 | `dev_router_status`（模式/路由）、`dev_router_mode`（调整 band/数值）、`dev_mode_subagent`（隔离模式子任务） |

| 维度　　 | router-standard |
| --- | --- |
| 定位　　 | 通用任务感知路由（routing-suite 范式） |
| 来源　　 | 派生自 [yjh051108/dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)（MIT，含论文 P1–P30） |
| 模式　　 | 四模式 · 三稳定带（spec / 过渡 / react）+ weak 内部路由 |
| 本地补丁　　 | `sessionModeUser` 只分类真实用户消息（防 sage-mem 注入污染） |
| 适用　　 | deepseek-official 日常 |

**安装**

```sh
mkdir -p ~/.dsh/.agent-presets
cp -r presets/router-standard ~/.dsh/.agent-presets/
# 重启 DSH 后新建会话，选择 Router Standard
```

> ⚠️ 安装副本须保持**唯一模块文件名**（loader 按 URL 缓存 ESM 模块，原地覆盖拿到旧缓存）；升级先删旧目录再复制。

> 注入器（dsh-super-injector）是运维层"手术台"：预设运行时**不依赖**它（走官方 agent-presets 通道），但安装链与故障归因按作者指导先注入器后预设。

---

## 目录结构

```
packages/                  # 仓库内维护插件（monorepo，tsdown 构建 + vitest）
  dsh-client-ui-session-switcher/
  dsh-lab-kit/
  dsh-custom-thinking/
  dsh-secure-context-polyfill/   # 🔒 私人，gitignored
third-party/               # 收录的在用插件（公开上游 submodule / 本地快照）
  dsh-super-injector/      #   submodule（本地修复 commit）
  dsh-vision-toolkit/      #   submodule
  sage-mem/                #   submodule
  dsh-conversation-share/  #   submodule
  dsh-smooth-stream/       #   本地修复版（clampLag，PR #6）
  dsh-agent-teams/         #   本地快照
  dsh-synapse/             #   本地快照（PR #5）
  dsh-wallpaper-engine/    #   本地快照
  dsh-better-sidebar/      # 本机修订快照（gitignored；官方上游见插件说明）
presets/                   # 推理模式路由预设（复制到 ~/.dsh/.agent-presets/ 安装）
  router-standard/         #   通用路由（routing-suite 范式；含 MIT LICENSE）
docs/                      # 文档
  DEVELOPMENT.md           #   插件开发指南
  UPDATE-PLAN.md           #   大更新盘点与决策记录
scripts/                   # 工具脚本
  verify-*.mjs             #   无头 Chrome E2E 回归脚本
shared/                    # 共享构建配置
  tsdown.client.ts         #   client bundle 协议
  web-platform.ts
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

| 注意事项　　 | 说明 |
| --- | --- |
| 重复来源　　 | 同一插件不能同时以 link 版 + npm 版留在 bundles（`duplicate loader entry id` 功能消失）——换源先卸载旧条目 |
| 本地开发版　 | 有本地修复的插件（smooth-stream 等）以 `link:` 装本地目录，重启后保持修复版 |
| 各插件命令　　 | 见对应章节；preset 走复制安装（见[推理模式路由预设](#推理模式路由预设presets)） |

---

## 开发

```sh
pnpm install
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓单测
pnpm build          # 构建全部插件
```

| 发版步骤　　 | 操作 |
| --- | --- |
| 1. 版本　　 | 改版本号 |
| 2. 标签　　 | `git tag dsh-vX.Y.Z && git push origin dsh-vX.Y.Z` |
| 3. 发布　　 | GitHub Actions 自动发布 npm（`@suxeca` scope）并提升 `latest` |

---

## 相关文档

| 文档　　 | 内容 |
| --- | --- |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | 插件开发指南（新建包、构建、安装、扩展点速查） |
| [`docs/UPDATE-PLAN.md`](docs/UPDATE-PLAN.md) | 大更新盘点与决策记录 |
| [`third-party/dsh-smooth-stream/FIX-NOTES.md`](third-party/dsh-smooth-stream/FIX-NOTES.md) | smooth-stream CJK 重叠修复记录（根因/验证/PR） |
| [`dsh-architecture-map.html`](dsh-architecture-map.html) / [`dsh-venn.html`](dsh-venn.html) | DSH 架构可视化 |
| deepseek-harness `docs/` | 上游参考（cordis 教程、extension-cookbook、capability-seams） |

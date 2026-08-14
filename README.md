# dsh-plugin · DSH 个人插件合集

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的**个人插件合集**仓库：既包含本仓库自研并发布到 npm 的插件（`packages/`），也通过 git submodule 收录日常在用的第三方/自研插件（`third-party/`），一份 README 说清每个插件是什么、怎么装。

> 所有插件以 **bundle 形态**安装进 profile，无需修改或重新构建 DSH 本身：`dsh plugin --profile web add <包名>` 后重启 dsh web 即生效。

## 插件总览

| 插件 | 包名 / 来源 | 功能 | 安装方式 | 状态 |
|---|---|---|---|---|
| 会话切换面板 | `@suxeca/dsh-client-ui-session-switcher`（本仓库） | Ctrl+K 调色板切换对话，Ctrl+[ / ] 按侧边栏顺序循环 | npm | ✅ 已发布 rc.3 |
| 插件管理器 | `@suxeca/dsh-plugin-manager`（本仓库） | `/plugin` 命令 + 设置页列出/安装/卸载插件 | npm | ✅ 已发布 rc.4 |
| 科研台 Lab Cockpit | `@deepseek-ai/dsh-lab-kit`（本仓库） | 侧边栏「研究台」扫描展示工作区研究项目 | 本地 link | ✅ 在用 |
| 视觉工具箱 | `@dsh-external/dsh-vision-toolkit`（[submodule](third-party/dsh-vision-toolkit)） | 原生视觉工具：识图、OCR、像素级定位、UI 还原 | 本地 link | ✅ 在用 v0.1.6 |
| 记忆系统 | `sage-mem`（[submodule](third-party/sage-mem)） | 跨会话记忆：自动沉淀 + 检索注入，中文优先 | 本地 link | ✅ 在用 |
| 对话分享 | `@bill9109/dsh-conversation-share`（[submodule](third-party/dsh-conversation-share)） | 选取对话片段分享为品牌化 PNG 长图 | GitHub 源 | ✅ 在用 v0.1.1 |

## 自研插件（本仓库 `packages/`）

### 1. dsh-client-ui-session-switcher · 会话快速切换面板

会话调色板 + 键盘流切换：

- `Ctrl+K` / `Alt+K` 打开调色板：↑↓ 选择、`N` 新建、`A` 归档、`T` 归档视图 + `U` 取消归档、`R` 重命名、`S` 搜索、皮肤切换（深色/浅色/高对比）
- `Ctrl+[` / `Ctrl+]` 在面板关闭时按**左侧栏可见顺序**循环切换对话（工作区显示序 → 区内最近活动在前 → 未分组垫底）
- 面板按工作区分节，打开时默认选中当前会话，滚动跟随

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add @suxeca/dsh-client-ui-session-switcher
```

npm: `@suxeca/dsh-client-ui-session-switcher@0.1.0-rc.3`（tag `dsh-v*` 触发 CI 自动发布并提升 latest）。

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
pnpm dsh plugin --profile web add link:~/Workspace/dsh-plugin/packages/dsh-lab-kit
```

本地 link 安装（`private`，未发布 npm）。

## 收录插件（`third-party/` submodule）

### 4. dsh-vision-toolkit · 视觉工具箱

把 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) 带入 DSH 的原生 Profile Bundle：给纯文本 agent 装上眼睛——意图感知识图问答、OCR、原始像素定位、UI 还原、像素级验证、Artifact 管理与 Web 设置，10 个独立工具，按需渐进暴露（本机经本地 CLI Proxy API `127.0.0.1:8317` + `gpt-5.6-luna` 驱动）。

- 上游：<https://github.com/Anionex/dsh-vision-toolkit>（v0.1.6，MIT，162 测试）
- 安装：`dsh plugin --profile web add @anionex/dsh-vision-toolkit`

### 5. sage-mem · DSH 记忆系统

跨会话记忆：监听 DSH 事件流，工具调用自动沉淀，LLM 压缩为结构化记忆（事实/摘要，中文输出）；新会话启动自动检索注入。**中文优先**——worker 用 trigram 分词 + 短词 LIKE 兜底，中文检索全命中（FTS5 默认分词器对中文 0 命中）。fork 自 [claude-mem](https://github.com/thedotmack/claude-mem)（Apache-2.0）加中文修复，DSH 侧仅一个轻量桥接插件。

- 上游：<https://github.com/gezi-wen/sage-mem>
- 架构：DSH 插件 → HTTP → Bun 常驻 worker → SQLite（FTS5 trigram）

### 6. dsh-conversation-share · 对话分享

在 DSH Web 会话流中选取一段对话范围（可拖拽、磁吸对齐的范围标记），一键导出为**品牌化 PNG 长图**分享——适合把关键对话/结论发到飞书、微信、汇报材料。

- 上游：<https://github.com/bill9109/dsh-conversation-share>（v0.1.1，GitHub 源安装，未发布 npm）
- 安装：`dsh plugin --profile web add github:bill9109/dsh-conversation-share`

## 目录结构

```
packages/                  # 本仓库自研插件（monorepo，tsdown 构建 + vitest）
  dsh-client-ui-session-switcher/
  dsh-plugin-manager/
  dsh-lab-kit/
third-party/               # git submodule：收录的在用插件
  dsh-vision-toolkit/
  sage-mem/
  dsh-conversation-share/
docs/DEVELOPMENT.md        # 插件开发指南（新建包、构建、安装、扩展点速查）
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
- [`PLUGIN-HANDOFF.md`](PLUGIN-HANDOFF.md) — 会话切换/插件管理器/科研台交付与踩坑记录
- 上游参考：deepseek-harness `docs/`（cordis 教程、extension-cookbook、capability-seams）

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
| 画布工作区 | 收录　 | 会话/工作区画布投影 | 本地 link | ✅ v0.3.0 |
| 壁纸引擎 | 收录　 | Wallpaper Engine 壁纸集成 | 本地 link | ✅ v0.2.2 |
| Better Sidebar 工作台 | 收录　 | 文件/预览/终端/Git/浏览器/任务面板 | npm / GitHub | ✅ v0.12.x |
| 记忆系统　　 | 收录　 | 跨会话记忆：自动沉淀 + 检索注入 | GitHub 源 | ✅ 在用 |
| 对话分享　　 | 收录　 | 对话片段导出品牌化 PNG 长图 | GitHub 源 | ✅ v0.1.1 |
| 配额仪表盘 | 仓库内　 | CPA / Command Code / DeepSeek / agy 多模型配额环 | 本地 link | ✅ v0.1.0 |
| 移动端润色 | 仓库内　 | 移动端紧凑布局与对话全宽样式润色 | 本地 link | ✅ v0.1.0 |
| PDF 拖放直传 | 仓库内　 | PDF/文档拖拽上传并在输入框注入引用 | 本地 link | ✅ v0.1.0 |
| 笔记看板　　 | 仓库内　 | 会话绑定的 Markdown 笔记：KaTeX 渲染 + 每轮注入 + 增量播报 | 本地 link | ✅ v0.2.0 |
| 鲸鱼下潜动画 | 收录　 | DeepSeek 灵感鲸鱼潜水状态指示动画 | 本地 link | ✅ v0.3.0 |
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
| 折叠/展开左侧栏 | `Ctrl+B` | DSH `ctx.layout.toggleSidebar()` |
| 折叠/展开右侧栏 | `Ctrl+Shift+B` | DSH 原生右侧栏 `ctx.sidebarRight.toggleExpanded()` |
| 收起右侧栏（固定） | `Esc` | 同上；已收起时不动作 |

> 0.1.5-rc.1 已移除 `ILayout` 的全屏三件套（`isLeftFullscreen` / `setLeftFullscreen` /
> `toggleLeftFullscreen`），原生右侧栏也未在 `ctx.sidebarRight` 暴露全屏方法，因此
> 原先的 `Alt+Shift+L` / `Alt+Shift+R` 全屏键与 `Ctrl+J` 底栏键（better-sidebar）
> 已一并移除，避免按下即抛错或空操作。

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

### 2. ~~dsh-lab-kit~~ · 已于 2026-09-10 卸载删除

| 项　　 | 说明 |
| --- | --- |
| 状态　　 | **已卸载并删除**（`packages/dsh-lab-kit/` 已 `git rm`；profile 无挂点） |
| 卸载原因 | 用户决定不再维护；它此前已处于 disabled（不在 `dsh.profile.bundles`、不在注入 registry），无实际挂载 |
| 定位（原） | 侧边栏「研究台」：扫描工作区（识别 `.git` / `.summary.md`），按最近修改排序展示项目 |
| 数据流（原） | host 经 `/lab-kit/projects` 路由提供 JSON |
| 历史保全 | `~/Workspace/.backups/dsh-plugin-removal-20260910_2130/dsh-lab-kit-src.tgz` |
| 上游　　 | **无**（已确认本地独有：npm 404 + GitHub 搜索 0 命中） |

### 3. dsh-custom-thinking · 自定义思考插件

> **构建已标准化（2026-09-10）**：原先用手工 symlink 树（`scripts/build.sh` 从工作区
> `.pnpm` store 里 `link_pkg`）解析依赖——store 一变就静默断链（本轮升级已经断过两次）。
> 现已改为 **pnpm 管理的 devDependencies**：`scripts/` 已删除，`tsconfig.json` 继承
> 仓库 base，`tsdown.config.ts` 复用 `shared/tsdown.client.ts`，脚本为
> `tsc -b && tsdown`。转换后 `lib/client.js` 与转换前**逐字节一致**（23141B）。


| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 运行时注入的思考/推理行为自定义插件 |
| 形态　　 | 注入式（`dev_inject_plugin` 装配，见超级模组注入器） |

**安装**（通过注入器）

```sh
dev_inject_plugin <repo>/packages/dsh-custom-thinking
```

### 4. dsh-quota-meter · 多模型配额与余额仪表盘

> ⚠️ **本地独占，未收录进本仓库**：`packages/dsh-quota-meter/` 已 gitignore。源码内含 Antigravity 公开 OAuth client secret，GitHub 推送保护会拦截。本机通过 link 安装不受影响。

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 输入框上方动态配额环：支持 CPA Codex 周额度、Command Code 周额度、DeepSeek 余额以及 agy 配额实时轮询 |
| 数据流　　 | host 端经 `/quota-meter/query` 路由代理查询并缓存 |

**安装**

```sh
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-quota-meter
```

### 5. dsh-mobile-polish · 移动端紧凑布局润色

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 针对手机/平板竖屏优化：全宽对话容器、单行紧凑输入框、防遮挡与 safe-area 适配 |

**安装**

```sh
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-mobile-polish
```

### 6. dsh-pdf-drop · PDF 拖拽直传与引用注入

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 拖入 PDF/文档直接上传到**当前会话工作区**，并自动在输入框插入 `@path/to/file.pdf` 引用 |
| 数据流　　 | client 用 XHR 以 `application/octet-stream` 流式上传（带进度、无 base64 膨胀）→ host `/pdf-drop/upload` 落到会话 `cwd`（sessionId 优先，其次校验过的 cwd，最后回退进程目录并显式告警） |
| 输入框写入 | 走 DSH 自己的 paste 通道（向 `[data-composer-input]` 派发 `paste` + `text/plain`），回退 `execCommand('insertText')` 与旧版 textarea，每条路径都用草稿文本校验，杜绝「静默失败」 |
| 兼容性　　 | 不依赖安全上下文 API，纯 HTTP 局域网 / NetBird / Tailscale 远端同样可用；含路径穿越防护与 cross-site 拒绝 |

**安装**

```sh
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-pdf-drop
```

### 7. 浏览器兼容补丁（🔒 私人使用，源码不入库）

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

### 8. dsh-note-board · 笔记看板

对话视图的**第三个标签页**：把一份 Markdown 笔记按**会话**绑定、用平台自带 KaTeX 渲染、并每轮注入系统提示。
笔记里写什么它不关心——任何「值得每轮注入、且需要人工确认过才算数」的 Markdown 都适用。

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | `对话 | 轨迹 | 笔记看板`，三页签：笔记目录 / 笔记正文 / 审计判决 |
| 绑定　　 | 按会话解析：显式附加 → 从会话工作目录逐级向上发现 → **无**（缺席不回退到别的笔记，否则会话互相渗漏） |
| 注入　　 | 挂 `system-prompt/assemble` waterfall 前插 `note-ledger`；内容变化时先发 `[LEDGER DELTA]` 点名变动的节并声明旧版本作废 |
| 增量基线 | 持久化到 `note-board-fingerprints.json`：DSH 停机期间的编辑，在恢复后的第一轮依然会被播报 |
| 服务　　 | `ctx.provide('noteLedgers')` → `resolve(sessionId, cwd?)` / `read(...)`，同部署的其它插件共用同一份解析器 |
| 可配置　 | 9 个键全部可覆盖；部署相关路径（`scanRoots` / `ledgerFiles` / `auditInboxName`）留在**本机 profile patch 层**，不进包内 patch |
| 测试　　 | 66 条 / 5 文件：React `ref` prop 陷阱、cwd 持久化兜底、跨重启指纹基线、i18n 键集一致性、路由鉴权/有界读/挂载回滚 |

```sh
cd <repo>/packages/dsh-note-board && npm run build
pnpm dsh plugin --profile web add link:<repo>/packages/dsh-note-board
```

**文档**：[packages/dsh-note-board/README.md](./packages/dsh-note-board/README.md)（含英文概览）

---

## 收录插件（`third-party/`）

### 9. dsh-super-injector · 超级模组注入器

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | DSH 生态 **BepInEx 式模组注入入口**：运行时注入本地插件包，不碰 patch / package.json / bundles、不重启；注入即完整生效（host 工具 + client UI） |
| 能力　　 | 热重载、自重载（失败自动 rollback）、卸载即净、一键自检（`dev_self_test` 8 项）、开发侧挂区（staging）转正 |
| 上游　　 | <https://github.com/yjh051108/dsh-super-injector>（v0.3.3；本地含 DSH_HOME 支持 + purge 顺序修复 + inject 记账修复） |
| 安装　　 | `dsh plugin --profile web add github:yjh051108/dsh-super-injector`（引导一次，之后万物皆可运行时注入） |
| ⚠️ 高权限边界 | 以进程内代码执行能力运行任意插件包——仅装受信任实例 |

### 10. dsh-smooth-stream · 丝滑流式渲染

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 流式渲染平滑：文字跟着模型走、换行滑入、不闪 |
| 能力　　 | typewriter（打字机）/ teleprompter（提词器）双模式、三种节拍 preset、滚动跟随、FPS 守卫 |
| 上游　　 | <https://github.com/Laplace-bit/dsh-smooth-stream>（v0.3.2；**本地修复：glide 位移钳制防 CJK 字符重叠**，PR #6 已提交上游） |
| 本地修复　 | `teleprompterGlide.ts` 新增 `clampLag()`：位移 ≤ 一行高（28px），杜绝中文/长路径跨行重叠；见 [`FIX-NOTES.md`](third-party/dsh-smooth-stream/FIX-NOTES.md) |
| 安装　　 | `dsh plugin --profile web add dsh-smooth-stream`（本机为 `link:` 本地构建版） |

### 11. dsh-agent-teams · Agent 团队协作（已卸载删除 2026-09-08）

> 已于 2026-09-08 从本机彻底删除：`third-party/dsh-agent-teams/`（11,916 文件 / 211 MB 本地快照）、
> 运行时状态归档 `.agent-teams/`（4 次审计的团队 inbox 与 final-report）、以及 profile junction
> `~/.dsh/profiles/web/node_modules/@nanmicoder/`。删除前该插件**未在 loader 中挂载**，无运行期影响。
> 连带修复：profile 的 `@types/node`、`@types/react` 两个 junction 原先指向该插件的 node_modules，
> 已重指向工作区内同版本副本（24.13.3 / 18.3.31）。
> 备注：它是社区插件（`@nanmicoder/dsh-agent-teams`，作者 NanmiCoder），与 DSH 官方的
> `@deepseek-ai/dsh-experimental-agent-team`（`packages/experimental/agent-team`，官方标注
> "excluded from official releases"）不是同一实现；后者本机从未启用。
> 如需重建：`git clone https://github.com/NanmiCoder/dsh-agent-teams.git`（上游已到 0.1.15+，已适配宿主 alpha.2 的 `dsh-client-runtime` 移除）后 `dsh plugin --profile web add @nanmicoder/dsh-agent-teams`。

### 12. dsh-synapse · 画布工作区

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 会话/工作区画布投影：把 DSH 会话映射到可视化工作区 |
| 能力　　 | 自动投影（autoProjection）、手动拖入会话、本地持久化（workspaces.json） |
| 上游　　 | <https://github.com/liangmianya/dsh-synapse>（v0.3.0；本地含 loaded-sessions 持久化等增强，PR #5 已提交上游） |
| 安装　　 | `dsh plugin --profile web add dsh-synapse`（本机 `link:`） |

### 13. dsh-plugin-wallpaper-engine · 壁纸引擎

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 本地 Steam Wallpaper Engine workshop 目录集成 |
| 上游　　 | <https://github.com/>（v0.2.2） |
| 安装　　 | `dsh plugin --profile web add dsh-plugin-wallpaper-engine`（本机 `link:`） |

### 14. dsh-whale-animation · 鲸鱼潜水状态指示动画

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | DeepSeek 风格的鲸鱼潜水与波纹动效，直观指示当前会话的 turn 状态与思考进程 |
| 上游　　 | <https://github.com/LeemanCheung/dsh-whale-animation>（v0.3.0） |
| 安装　　 | `dsh plugin --profile web add dsh-whale-animation`（本机 `link:`） |

### 15. dsh-vision-toolkit · 视觉工具箱（已卸载删除 2026-09-08）

> 已于 2026-09-08 彻底删除，四个位置全部清空：
> ① `third-party/dsh-vision-toolkit/`（submodule 工作树，`@anionex/dsh-vision-toolkit@0.1.6`，217 文件 / 5.75 MB）；
> ② `~/Workspace/dsh-vision-toolkit/`（link 装载源，`@dsh-external/dsh-vision-toolkit@0.1.2`，228 文件 / 9.53 MB，含未提交的 package.json 改动）；
> ③ `dsh-plugin/.dsh-vision-toolkit/`（识图/OCR/crop/pixel-diff 制品，9 文件 / 0.54 MB）；
> ④ `~/.dsh/cache/dsh-vision-toolkit/`（managed 模式下载的 Python runtime，**2,243 文件 / 159.06 MB**，是本次最大的一项）。
> 同时清掉 profile 残留：`profiles/web/pnpm-lock.yaml` 的 `link:` 条目与 `node_modules/.package-map.json` 的依赖映射。
> 删除前该插件**未在 loader 中挂载**（patch 里只有注释「vision-toolkit removed (native vision enabled)」），
> 且已改用原生视觉模型，故卸载无功能回退。源码快照（两个副本的 src/docs/scripts/tests/vendor/assets/examples）
> 已存于 `/tmp/vt-deletion-snapshot/`（197 文件 / 8.93 MB），需要时可取回。
> 收尾需你补一条命令：父仓 index 仍留有 gitlink，请执行
> `git rm --cached third-party/dsh-vision-toolkit && git commit -m "chore: drop dsh-vision-toolkit submodule"`
> （`.gitmodules` 与 `.git/config` 的条目已移除；重装上游命令：`git clone https://github.com/Anionex/dsh-vision-toolkit.git`）


### 16. sage-mem · DSH 记忆系统

| 项　　 | 说明 |
| --- | --- |
| 定位　　 | 跨会话记忆：事件流自动沉淀 → LLM 压缩为结构化记忆 → 新会话自动检索注入 |
| 中文优先　　 | worker 用 trigram 分词 + 短词 LIKE 兜底（FTS5 默认分词器对中文 0 命中） |
| 上游　　 | <https://github.com/gezi-wen/sage-mem>（fork 自 [claude-mem](https://github.com/thedotmack/claude-mem)，Apache-2.0 + 中文修复） |
| 架构　　 | DSH 插件 → HTTP → Bun 常驻 worker → SQLite（FTS5 trigram） |
| 安装　　 | `dsh plugin --profile web add github:gezi-wen/sage-mem`（另需按上游说明常驻 worker） |

### 17. ~~dsh-conversation-share~~ · 已于 2026-09-10 卸载删除

| 项　　 | 说明 |
| --- | --- |
| 状态　　 | **已卸载并删除**（源码目录、submodule 登记、`.git/modules` 对象库全部清除；profile 无挂点） |
| 卸载原因 | 用户决定不再维护；且它所属的 `@bill9109/…` 作用域**已从 npm 消失**（404），维护版改用无 scope 的 `dsh-conversation-share` |
| 定位（原） | 会话流中选取一段对话范围（可拖拽、磁吸对齐），导出**品牌化 PNG 长图** |
| 历史保全 | `~/Workspace/.backups/dsh-plugin-removal-20260910_2130/`：`dsh-conversation-share-src.tgz`、`dsh-conversation-share-history.bundle`（含 `main`/`v0.1.1` 等全部 ref）、`dsh-conversation-share-uncommitted.patch` |
| 想装回来 | 用维护版而非旧作用域：`dsh plugin --profile web add dsh-conversation-share@0.1.5` |

### 18. ~~dsh-better-sidebar~~ · 已于 2026-09-10 卸载（改用官方原生侧边栏）

| 项　　 | 说明 |
| --- | --- |
| 状态　　 | **已卸载 / 已删除**（源码目录与 profile 挂载全部移除，释放 609MB） |
| 卸载原因 | DSH 0.1.5-rc.1 起官方自带可扩展的右侧 Sidebar（`ctx.sidebarRight` + `ctx.sidebarRightTabs`，含文件树、Markdown/代码/HTML/PDF/图片预览、多标签、分栏、全屏），不再需要第三方实现 |
| 上游　　 | <https://github.com/omdsh-dev/DSH-better-sidebar>（卸载时为 v0.19.0） |
| 历史保全 | `~/Workspace/.backups/dsh-upgrade-20260910_185827/dsh-better-sidebar-history.bundle`（含 `preserve/local-v0.12.1-custom` 分支，即卸载前那份 +1321 行的本地修订）与 `…/dsh-better-sidebar-stash.patch` |
| 重新安装 | `dsh plugin --profile web add dsh-better-sidebar@latest`（需 DSH ≥ 0.1.5-rc.1） |

> **已知副作用（仅 3 个键位）**：`session-switcher` 的 `Ctrl+J`（底栏）、`Alt+Shift+R`（右栏全屏）以及 `Ctrl+Shift+B` 原先经 `ctx.betterSidebar` 联动，现改由 DSH 原生 `ctx.sidebarRight` 承担；该插件对 `ctx.get('betterSidebar')` 返回 `undefined` 已做优雅降级，不会报错。`wallpaper-engine` 里针对 `[data-dsh-better-sidebar]` 的玻璃拟态 CSS 规则变为未命中（无副作用）。`custom-thinking` 仅在注释中提到它。

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
  dsh-custom-thinking/
  dsh-external-dirs/       #   官方侧边栏「外部目录」tab（2026-09-10 新增）
  dsh-mobile-polish/
  dsh-pdf-drop/
  dsh-quota-meter/         #   🔒 本地独占，gitignored（含 Antigravity 公开凭据）
  dsh-secure-context-polyfill/   # 🔒 私人，gitignored
third-party/               # 收录的在用插件（公开上游 submodule / 本地快照）
  dsh-super-injector/      #   submodule（本地修复 commit）
  dsh-smooth-stream/       #   本地修复版（clampLag，PR #6）
  dsh-synapse/             #   本地快照（PR #5）
  dsh-wallpaper-engine/    #   本地快照
  dsh-agy/                 #   🔒 本地独占，gitignored（含 Antigravity 公开凭据）
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

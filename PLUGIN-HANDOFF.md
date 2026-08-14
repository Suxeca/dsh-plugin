# DSH 会话管理插件 — 交接文档 (PLUGIN-HANDOFF)

> 生成于 2026-08-13。本会话（<session-id>，cwd=~/Workspace）完成了 DSH Web GUI 的会话管理增强，因 dsh 架构中会话绑定创建时 cwd、无法迁移工作区，此文档把全部工作沉淀到 dsh-plugin 工作区，供后续会话无缝继续与分享。

## 1. 交付内容总览

| 功能 | 状态 | 入口 |
|---|---|---|
| 快速切换面板（快捷键） | ✅ 可运行 | `Ctrl+Shift+K` / `Alt+K`（悬浮「对话」按钮已移除，见 §7） |
| `Ctrl+[` / `Ctrl+]` 上下切换对话 | ✅ | 面板关闭时全局生效，循环；顺序=左侧栏可见顺序（工作区显示序+区内按最近活动，未分组垫底） |
| 新建对话 | ✅ | 面板内 `N` |
| 归档对话 | ✅ | 面板内 `A`（`workspace.archiveSession`，官方已有） |
| 取消归档（**本次新增**） | ✅ | 归档视图 `T` 进入，`U` 取消 |
| 面板工作区分组（**v2 新增**） | ✅ | 管理模式按工作区标题分节，与左侧栏一致；打开面板默认选中当前会话 |
| 面板皮肤（深色/浅色/高对比） | ✅ | 面板右上角皮肤按钮，localStorage 持久化 |
| 面板内重命名 | ✅ | `R`（`session.rename`） |
| 双模式交互 | ✅ | 管理模式（快捷键）/ 搜索模式（`S` 进入） |

## 2. 架构说明

### 2.1 客户端插件 `dsh-client-ui-session-switcher`

- **位置**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-session-switcher/`（**真实目录**，非符号链接——这是刻意设计，见 §4）；**标准化源（本仓库）**：`~/Workspace/dsh-plugin/packages/dsh-client-ui-session-switcher/`——2026-08-13 起手写 bundle 已移植为 TS/TSX 源码 + CSS Module（皮肤走 CSS 变量）+ tsdown 构建 + cordis.patch.yml 注册 + 33 个 vitest 单测（见 §7 第 4 项）
- **结构**：`package.json`（`dsh.client` 声明 + `exports["./client"]`）、`lib/index.js`（host 侧空 apply）、`lib/client.js`（浏览器 bundle，手写纯 JS，仅依赖 react/react-dom/client 平台模块）
- **加载机制**：web profile 的 `cordis.patch.yml` 注册行 → host loader 加载 → `dsh-client-modules` 扫描 `dsh.client` 声明 → 编译 boot manifest → 浏览器按 `/plugins/<id>/client.js?rev=…` 拉取执行。**改 client.js 后刷新页面即生效，无需重启 harness**（服务端 no-cache 直供文件内容）。
- **数据源**：`ctx.sessions.list`（快照形状 `{ids, byId, current, phase, …}`，条目字段 `id`/`displayTitle`/`parentId`/`origin`/`projectionValues`——**没有 `items` 字段**，与 npm 版不同！）与 `ctx.workspaces.list`（`{items, archivedSessionIds, phase, …}`）。
- **服务注入**：`exports.inject = ["sessions", "workspaces"]`（bundle 导出的是**服务名**；package.json `dsh.client.inject` 是插件边，仅信息性）。

### 2.2 Host 端取消归档 RPC 链路（新增的完整接线）

```
浏览器 ctx.workspaces.unarchiveSession(sessionId)
  → dsh-client-connection bundle（callUnary "workspace.unarchiveSession"）
  → apiproxy fetch handler（methodFor → RpcMethodMap → invoke api.workspace.unarchiveSession）
  → workspace 域处理器 → ctx.workspaceRegistry.unarchiveSession(sessionId)
  → dsh-workspace：archivedSessionIds 移除（幂等）→ 持久化 → domain/changed
  → host/archived-sessions-changed 帧广播回所有浏览器
```

**接线点共 6 处**（漏掉 `RpcMethodMap` 的 `invoke` 表会导致 404——这是踩过的坑）：
workspace 域 handler、内联 schema、`RpcMethodMap`（invoke 表）、`UNARY_VALUE_SCHEMAS`、fetch client 方法、client-connection 的 schema/method/dispatch/fixture。

## 3. 改动文件清单

### 3.1 GitHub 仓库版（当前运行，tsx 源码直跑，加载 **lib/** 构建产物）

| 文件 | 改动 |
|---|---|
| `packages/workspace/workspace/src/index.ts` + `lib/index.js` | `unarchiveSession()` 方法 |
| `packages/host/apiproxy/src/api-proxy.ts` + `lib/index.js` | `workspace.unarchiveSession` RPC handler |
| `packages/host/apiproxy/src/api/workspace.ts` | 域 API 接口方法 |
| `packages/host/apiproxy/src/api/workspace.schema.ts` + `lib/types/api/…js` | request/value schema |
| `packages/host/apiproxy/src/api/rpc-map.ts` | RpcMethodMap 类型行 |
| `packages/host/apiproxy/src/fetch/handler.ts` + `lib/types/fetch/…js` | 方法分发表 |
| `packages/host/apiproxy/src/fetch/client.ts` + `lib/types/fetch/…js` | 客户端方法 + schema 表 |
| `packages/client/connection/src/client/fixture.ts` + `lib/client.js` | fixture + dispatch case（**fixture 里用 splice 不是重赋值——变量是 const**） |
| `packages/client/runtime/src/client/workspaces/{manager,service}.ts` + `lib/client.js` | `unarchiveSession` 两端 |

### 3.2 npm 缓存副本（旧版 dsh，备用）

`~/.npm/_npx/<npx-cache-id>/node_modules/@deepseek-ai/` 下 dsh-workspace / dsh-host-apiproxy / dsh-client-connection / dsh-client-runtime 同样打过补丁（仓库版是主，此副本可能被 npm 清理，不再维护）。

### 3.3 Profile 层

- `~/.dsh/profiles/web/cordis.patch.yml`：注册 `ui-session-switcher` 行 + MCP server 行
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-session-switcher/`：插件本体

## 4. 维护注意事项（踩过的坑，务必读）

1. **不要用 npm/pnpm 重装 profile 树**。插件包是 profile node_modules 里的本地真实目录；npm exec 启动 dsh 会剪除 npx 缓存里"依赖树之外"的包（曾导致 ERR_MODULE_NOT_FOUND 崩溃）。启动用直接二进制：
   `node ~/.npm/_npx/<npx-cache-id>/node_modules/.bin/dsh web`（或 `pnpm dsh web`，但别在 npx 缓存里放额外包）。
2. **仓库版改 host 代码后要重启 harness 才生效**；改 client bundle（浏览器端）刷新页面即可。
3. **改 lib 必须同步改 src**：仓库构建会从 src 重新生成 lib；只改 lib 的话 `pnpm run build` 后丢失。改完跑 `pnpm --filter <pkg> exec tsc -b tsconfig.json` 验证。
4. **RPC 加方法必须接全 6 处**（含 RpcMethodMap invoke 表），否则路由 404。
5. **面板数据源用 `ids`/`byId`**（仓库版），不要用 `items`（npm 版才有）。初始快照无 `items` 字段，读取必须兜底 `?? []`，否则首帧渲染崩溃（TypeError: Cannot read properties of undefined (reading 'filter')——实际踩过）。
6. **Chrome 劫持 `Ctrl+K`**（地址栏），页面收不到；`Ctrl+Shift+K` / `Alt+K` 可用。Mac 上 `Cmd+[`/`]` 是浏览器前进后退，会被劫持。
7. 归档后会话从所有视图消失但保留 workspace 席位，取消归档自动还原位置（host 设计如此）。

## 5. 键位速查

```
全局（面板关闭）：Ctrl+Shift+K / Alt+K 开面板 · Ctrl+] 下一个对话 · Ctrl+[ 上一个对话
（上下切换按左侧栏可见顺序走：工作区显示序 → 区内最近活动在前 → 未分组垫底；当前是子会话时以根会话位置为锚）
面板管理模式：↑↓ 选择 · Enter 打开 · S 搜索 · N 新建 · A 归档 · R 重命名
               T 归档视图 · U 取消归档 · Esc 关闭
               打开面板默认选中当前会话；列表按工作区分节（标题分组头+计数），未分组垫底
面板搜索模式：打字过滤 · Enter 打开 · Esc 返回管理
```

## 6. 验证方法（RPC 冒烟）

```bash
SID="<session-id>"
curl -s -X POST http://127.0.0.1:3080/api/workspace.unarchiveSession \
  -H "content-type: application/json" \
  -d "{\"type\":\"client-request\",\"rpcId\":\"t\",\"method\":\"workspace.unarchiveSession\",\"payload\":{\"sessionId\":\"$SID\"}}"
# → {"result":{"ok":true,"value":{"archivedSessionIds":[...]}}}
```

## 7. 待办/改进清单（未做项）

- [ ] 接入 composer `/` 斜杠命令体系（`/会话` 打开面板，需接 ui-commands 服务）
- [ ] 面板内多工作区新建选择（当前 `N` 固定建在当前工作区）
- [ ] 归档视图显示会话原属工作区
- [x] 把插件正式移植进仓库（已落 `~/Workspace/dsh-plugin/packages/dsh-client-ui-session-switcher/`：包骨架 + tsdown + cordis.patch.yml 注册 + 42 个 vitest 单测；profile 树手写 bundle 不再维护。激活方式：`dsh plugin --profile web add ~/Workspace/dsh-plugin/packages/dsh-client-ui-session-switcher` 后重启 dsh web）
- [x] 移除悬浮「对话」按钮（用户反馈：Web 右键被页面自身菜单优先占用，按钮无实际用途；只留一次性 ready toast，文案改为纯快捷键）
- [x] Ctrl+[ / Ctrl+] 改为严格按左侧栏可见顺序循环（v2：去掉「当前工作区优先」，改为工作区显示序 + 区内最近活动在前 + 未分组垫底；子会话以根会话位置为锚）
- [x] 面板 v2：管理视图按工作区分节（分组头 + 计数），打开时默认选中当前会话
- [x] 面板滚动跟随：↑↓ 选择（含打开时定位当前会话）自动滚动列表让选中行保持可见
- [x] 部署进 profile（2026-08-14 直接在 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-session-switcher/lib/` 覆盖 `client.js`/`client.js.map`/`index.js`——走 §2.1「改 client.js 刷新即生效」机制，无需重启 harness；浏览器 Ctrl+Shift+R 强刷即可）。如需走正式安装，仍可用 `dsh plugin --profile web add ~/Workspace/dsh-plugin/packages/dsh-client-ui-session-switcher` 后重启
- [ ] 为 unarchiveSession 补仓库单测（CI per-file 100% 覆盖率）
- [ ] 移除 ready toast 逻辑或改为配置项（现已 localStorage 一次）
- [ ] 面板内操作失败提示已做（红字 4s）；可再加成功提示

## 8. 相关仓库

- 官方：`~/Workspace/deepseek-harness`（36 个 client 插件；无同类会话切换插件，本插件是独一份）
- 全家桶：`~/Workspace/dsh-web-ui`（dsh-ssh / task-board / git-graph / pet / live-stats / remote-web-ui / **skins 皮肤全家桶**——应用级皮肤，与面板级皮肤互补）
- 本仓库（外部插件 monorepo）：`~/Workspace/dsh-plugin`（bundle 形态插件标准模板 + 会话切换器标准化版；模板说明见 `docs/DEVELOPMENT.md`）

## 9. npm 发布状态（2026-08-14 更新）

- 包名已改为 **`@suxeca/dsh-client-ui-session-switcher`**（用户自有 npm scope，可自行发布；原 `@deepseek-ai/...` 是官方 org，外部账号无发布权）
- 发布流水线：仓库 `Suxeca/dsh-plugin`，`dsh-v*` tag → GitHub Actions 自动 install/build/test/publish（对齐 harness release.yml 惯例）；CI 已验证 install/build/test 全绿，发布步只差 `NPM_TOKEN` secret
- 本地 profile 部署仍用 `@deepseek-ai/dsh-client-ui-session-switcher` 目录与旧 bundle id，**不受改名影响**，继续工作；将来用 `dsh plugin --profile web add @suxeca/dsh-client-ui-session-switcher` 从 npm 安装后即可切换
- 发布后安装路径（官方 publish 文档）：`dsh plugin add <npm包名>` 装的是发布时构建好的 lib/

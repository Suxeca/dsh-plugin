# dsh-plugin · DSH 自定义插件开发模板

面向科研工作流的 DeepSeek Harness（DSH）插件全家桶。本仓库是**独立于 deepseek-harness 源码**的外部插件 monorepo：插件以 **bundle** 形态打包，通过 `dsh plugin --profile <name> add` 安装进 profile，无需改任何 DSH 源码。

## 目录结构

```
dsh-plugin/
├── package.json            # 根脚本：build / typecheck / new:package
├── pnpm-workspace.yaml     # packages/* 工作区；peer API 运行时从 profile 解析
├── tsconfig.base.json      # 共享 TS 编译选项（host+client 同程）
├── shared/
│   ├── tsdown.client.ts    # clientBundle 构建助手（host 半 + 浏览器半 + CSS Modules）
│   └── web-platform.ts     # 浏览器平台模块表（react / cordis / slots 等 externals）
├── docs/DEVELOPMENT.md     # 本文档
└── packages/
    ├── dsh-lab-kit/                    # 示例插件：科研台 Lab Cockpit（第一个插件，照抄它起步）
    └── dsh-client-ui-session-switcher/ # 会话切换面板：Ctrl+Shift+K 调色板（纯 client 插件范例，带 vitest 单测）
```

## 插件形态：一个包，两半

每个插件包同时包含：

| 半 | 入口 | 运行位置 | 作用 |
|---|---|---|---|
| **host 半** | `src/index.ts`（exports `.`） | DSH 宿主进程（Node） | 注册工具、HTTP 路由、事件钩子、服务、systemPrompt 宣布 |
| **client 半** | `src/client/index.ts`（exports `./client`） | Web GUI 浏览器 | 侧边栏入口、面板、设置卡片，经 `/plugins/<id>/client.js` 提供 |

`package.json` 的 `dsh.bundle` 声明 patch 文件（把插件行插入 profile 组合）；`dsh.client` 声明浏览器半的运行时依赖与平台。

## 从零新建一个插件包

### 1. 复制模板

```sh
cp -r packages/dsh-lab-kit packages/dsh-my-plugin
```

按需改名 `@deepseek-ai/dsh-my-plugin`（package.json、cordis.patch.yml、tsdown.config.ts 三处）。

### 2. 包内文件

```
packages/dsh-my-plugin/
├── package.json          # dsh.bundle.patch + dsh.client 声明；exports . 与 ./client
├── cordis.patch.yml      # - insert: [{ id: my-plugin, name: '@deepseek-ai/dsh-my-plugin' }]
├── tsconfig.json         # extends ../../tsconfig.base.json
├── tsdown.config.ts      # clientBundle('@deepseek-ai/dsh-my-plugin', ['src/index.ts'], …)
└── src/
    ├── index.ts          # host 半：export const inject / apply(ctx)
    ├── host/             # host 侧服务与路由
    └── client/
        ├── index.ts      # client 半：export function apply(ctx)
        ├── css-modules.d.ts   # *.module.css 类型 shim
        └── *.module.css       # 样式（CSS Modules，自动注入 <style> 标签）
```

### 3. 构建

```sh
pnpm --filter @deepseek-ai/dsh-my-plugin build   # tsc -b && tsdown
```

产出 `lib/index.js`（host 半）+ `lib/client.js`（浏览器 bundle）+ `lib/types/`（d.ts）。

### 4. 安装进 profile

```sh
# 在 deepseek-harness checkout 里执行（或 dsh CLI 已入 PATH 时直接执行）
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add ~/Workspace/dsh-plugin/packages/dsh-my-plugin
```

验证图层：

```sh
pnpm dsh --profile web --dump-config | grep my-plugin
```

然后**重启 dsh web**（Ctrl-C 后重新 `pnpm dsh --profile web`）让插件生效。

### 5. 卸载

```sh
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-my-plugin
```

## 常用扩展点速查

| 想做什么 | 扩展点 | 参考实现 |
|---|---|---|
| 注册 HTTP 路由（client 可 fetch） | `ctx.webServer.register({ kind: 'prefix'\|'exact', path, handler })` | `dsh-lab-kit/src/host/routes.ts` |
| 读取当前工作区 | `ctx.workspaceRegistry.list()` | `dsh-lab-kit/src/host/projects-service.ts` |
| 向模型宣布插件存在 | `ctx.systemPrompt.section({ name, order, text })` | `dsh-lab-kit/src/index.ts` |
| 注册模型可见工具 | `ctx.tools.register()` / `defineTool` | deepseek-harness `packages/tool-*/` |
| 工具调用前钩子（权限门禁） | `ctx.on('tools/pre-execute', …)` | cookbook：钩子插件 |
| 监听会话事件流 | `ctx.on('session/event', …)` | cookbook：UI 插件 |
| 侧边栏入口（DOM 注入自愈） | `[data-pane="sidebar"]` + MutationObserver | `dsh-lab-kit/src/client/sidebar-entry.ts` |
| 中心列面板（覆盖聊天区） | `[data-pane="conversation"]` + html 属性切换 | `dsh-lab-kit/src/client/cockpit-mount.tsx` |
| 全局快捷键 + 独立 React root | `window.addEventListener('keydown')` + `createRoot` | `dsh-client-ui-session-switcher/src/client/index.ts` |
| 设置卡片（设置 > 插件配置） | `ctx.slots.inject('web-ui.plugin.item', …)` | dsh-task-board / dsh-live-stats |
| 中文语言包 | `ctx.locale.register(NS, { zh, en })` | dsh-task-board/src/client/locales.ts |
| 注册模型工具以外的服务 | `export class X extends Service`（类插件） | cordis 教程第 3 章 |

## 构建与运行时约定

- **peer API 不本地安装**：`@deepseek-ai/dsh-*`、`@deepseek-ai/cordis`、react 是运行时从 DSH profile 树解析的（`autoInstallPeers: false`）；仓库里只装 devDependencies 供类型检查。
- **bundle purity gate**：client 半禁止 import 平台模块表之外的 `@deepseek-ai/*` 值（跨插件协作走 cordis 服务）；类型导入会被擦除，不受限。
- **CSS Modules**：import `x.module.css` 得到哈希类名映射，样式文本自动注入 `<style data-plugin>` 标签，插件卸载时移除。皮肤类多套配色推荐 CSS 变量 + `data-skin` 属性切换（见 session-switcher 的 `switcher.module.css`）。
- **失败策略**：client apply 抛错会让整个 Web GUI 启动失败——外部插件的 DOM 挂载问题一律 log 不 throw。
- **测试**：`pnpm --filter <pkg> test` 跑 vitest 单测（纯函数与 store 逻辑）；根 `pnpm -r test` 汇总。client 入口 `export const inject = [服务名…]` 是 bundle 级服务注入声明（package.json 的 `dsh.client.inject` 为模块名，仅信息性）。

## 下一步路线（科研工作流方向）

- [ ] 研究台面板增强：点击项目 → 在右侧面板打开 `.summary.md` / 最新日志
- [ ] 六阶段流水线看板（文献→设计→实现→计算→分析→报告）
- [ ] 论文管线助手（arXiv → paper-brain → 阅读笔记）
- [ ] 实验追踪器（参数/命令/日志/结果归档与对比）
- [ ] 设置卡片 + 语言包体系接入

# dsh-plugin · DSH 自定义插件

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Web GUI 插件仓库。

本仓库是独立于 DSH 源码的外部插件 monorepo：插件以 bundle 形态打包，通过 `dsh plugin add` 安装进 profile 即可加载，不需要修改或重新构建 DSH 本身。

> **当前可用状态：只有 `dsh-client-ui-session-switcher`（会话切换面板）可用。** `dsh-lab-kit` 是开发模板示例，尚未完成验证，请勿安装使用。

## 快速开始（安装会话切换面板）

```sh
# 从 npm 安装（推荐，自动拿最新版）
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add @suxeca/dsh-client-ui-session-switcher

# 重启 dsh web 后：
#   Ctrl+K       打开/关闭切换面板（Alt+K 兜底）
#   Ctrl+] / Ctrl+[  下一个/上一个对话（按左侧栏顺序循环）
```

## 插件清单

| 包 | 说明 | 状态 |
|---|---|---|
| `packages/dsh-client-ui-session-switcher` | 会话快速切换面板：Ctrl+K 调色板（新建/归档/取消归档/重命名/搜索/皮肤/工作区分组）、Ctrl+[ / ] 按侧边栏顺序循环、面板内快捷键自定义（localStorage 持久化，Alt+K 兜底） | ✅ 可用（npm: `@suxeca/dsh-client-ui-session-switcher`） |
| `packages/dsh-lab-kit` | 科研台 Lab Cockpit：扫描工作区研究项目并在侧边栏展示（host 路由 + client 面板全链路示例） | ⚠️ 模板示例，未完成验证 |

## 开发

```sh
pnpm install
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓单测
pnpm build          # 构建全部插件
```

发版流程：改版本号 → `git tag dsh-vX.Y.Z && git push origin dsh-vX.Y.Z` → GitHub Actions 自动发布到 npm（`@suxeca` scope）并提升 `latest`。

## 文档

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 插件开发指南（新建包、构建、安装、扩展点速查）
- 上游参考：deepseek-harness `docs/`（cordis 教程、extension-cookbook、capability-seams）
- 全家桶参考：dsh-web-ui（dsh-ssh / dsh-task-board / dsh-aionui-panel 等）

# dsh-plugin · DSH 自定义插件开发模板

面向科研工作流的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件全家桶。

本仓库是独立于 DSH 源码的外部插件 monorepo：插件以 bundle 形态打包，通过 `dsh plugin add` 安装进 profile 即可加载，不需要修改或重新构建 DSH 本身。

## 快速开始

```sh
# 1. 安装依赖
pnpm install

# 2. 构建全部插件
pnpm build

# 3. 安装示例插件到 web profile（在 deepseek-harness checkout 中执行）
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add ~/Workspace/dsh-plugin/packages/dsh-lab-kit

# 4. 重启 dsh web 后，侧边栏出现「研究台」入口
```

## 插件清单

| 包 | 说明 | 状态 |
|---|---|---|
| `packages/dsh-lab-kit` | 科研台 Lab Cockpit：扫描工作区研究项目并在侧边栏展示（host 路由 + client 面板全链路示例） | ✅ 可用 |
| `packages/dsh-client-ui-session-switcher` | 会话快速切换面板：Ctrl+K 调色板（新建/归档/取消归档/重命名/搜索/皮肤）、Ctrl+[ / ] 按侧边栏顺序循环、工作区分组视图、面板内快捷键自定义（localStorage 持久化，Alt+K 兜底） | ✅ 可用 |

## 文档

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 插件开发指南（新建包、构建、安装、扩展点速查）
- 上游参考：deepseek-harness `docs/`（cordis 教程、extension-cookbook、capability-seams）
- 全家桶参考：dsh-web-ui（dsh-ssh / dsh-task-board / dsh-aionui-panel 等）

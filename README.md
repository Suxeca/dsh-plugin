# dsh-plugin · DeepSeek Harness (DSH) 插件矩阵

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![](https://img.shields.io/badge/Cordis-Plugin-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![](https://img.shields.io/badge/plugins-36_(21%20%7C%2015)-2ea44f?style=flat-square)](#插件矩阵--plugin-catalog36)
[![](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![](https://img.shields.io/badge/i18n-zh--CN%20%7C%20en--US-8957e5?style=flat-square)](#english)

**中文** | [**English**](#english)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的**插件矩阵与生产力套件**：**36 个 Cordis Plugin**（21 个自研 `packages/` + 15 个收录增强 `third-party/`），覆盖安全审计与供应链防护、科研推演流水线、插件开发工程生产线、界面交互增强、跨会话记忆与推理路由。

每个插件都是以 **Cordis Plugin** 形态装配在 DSH 的 Cordis 内核上的独立单元：既可以运行时注入热调试，也可以作为 bundle 常驻 profile。整套矩阵由同一个 **AI Agent** 宿主驱动，插件之间通过 Cordis 服务总线（`ctx.*`）而非硬编码耦合协作。

> 🏛️ **历史插件归档**：此前退役、卸载或由 DSH 原生功能替代的插件（如 `dsh-better-sidebar`、`dsh-lab-kit`、`dsh-vision-toolkit` 等）已全数迁移至 **[历史与退役插件归档](docs/HISTORICAL-PLUGINS.md)**，首页仅保留在用与最新演进成果。

---

## 一键安装：4 个独立可直装插件

下列插件已发布到**独立只读镜像仓**，**一条命令装好，无需 clone、无需构建**：

```sh
# 旗舰：GitHub 假星 / 供应链审计器
dsh plugin add github:Suxeca/dsh-plugin-repo-auditor

# 科研：思维演化地图编译器
dsh plugin add github:Suxeca/dsh-science-map

# 科研：文献书签与本地研究知识库
dsh plugin add github:Suxeca/dsh-literature-library

# UI：Ctrl+K 会话快速切换
dsh plugin add github:Suxeca/dsh-client-ui-session-switcher
```

| 插件 | 独立仓 | 一键安装 | 审计 |
|---|---|---|---|
| **仓库审计器** `0.2.0` | [Suxeca/dsh-plugin-repo-auditor](https://github.com/Suxeca/dsh-plugin-repo-auditor) | `dsh plugin add github:Suxeca/dsh-plugin-repo-auditor` | **A · 100/100 · 0 flags** |
| **思维演化地图** `0.1.0` | [Suxeca/dsh-science-map](https://github.com/Suxeca/dsh-science-map) | `dsh plugin add github:Suxeca/dsh-science-map` | **A · 100/100 · 0 flags** |
| **文献研究库** `0.0.1` | [Suxeca/dsh-literature-library](https://github.com/Suxeca/dsh-literature-library) | `dsh plugin add github:Suxeca/dsh-literature-library` | **A · 100/100 · 0 flags** |
| **会话快速切换** `0.1.0-rc.7` | [Suxeca/dsh-client-ui-session-switcher](https://github.com/Suxeca/dsh-client-ui-session-switcher) | `dsh plugin add github:Suxeca/dsh-client-ui-session-switcher` | **A · 100/100 · 0 flags** |

安装审计器后，可在任意会话中直接调用原生工具：

```text
audit_github_repos({ repos: ["owner/repo", "https://github.com/owner/repo"] })
```

| | |
|---|---|
| **镜像仓库** | [github.com/Suxeca/dsh-plugin-repo-auditor](https://github.com/Suxeca/dsh-plugin-repo-auditor) |
| **镜像性质** | 自动生成的**只读镜像**：内含编译产物（`lib/`）、`package.json`、`cordis.patch.yml` 与 locale，**开箱即可加载，无需构建步骤** |
| **唯一真源** | 本仓库 [`packages/dsh-plugin-repo-auditor`](packages/dsh-plugin-repo-auditor) —— 所有开发与修复都在这里发生，镜像随后同步 |
| **为何需要镜像** | GitHub 无法从 monorepo 根目录解析出单个插件的 `package.json`，因此 `dsh plugin add github:...` 无法直接指向本仓库根；独立镜像把**可加载的包根**暴露出来，让 `dsh plugin add` 有明确目标 |

> ℹ️ 本仓库根 `package.json` 的 `name` 是 `dsh-plugin`（工作区根，不是可加载插件）。要安装矩阵中的其他插件，请使用下方的「方式 B / C / D」。

---

## 真实度与安全徽章

矩阵中每个插件都带有**真实度 / 安全**标记。这不是装饰 —— 判据公开、可复现。

| 徽章 | 含义 | 判据 |
|---|---|---|
| ✅ **Audited / 真实** | 位于**已审计仓库**内的自研插件 | 仓库级 `audit_github_repos` 判定 **100/100 分，评级 A，0 flags**（2026-10-14） |
| 🚀 **Standalone / 独立可直装** | 已发布到**独立只读镜像仓**，可一条命令安装 | `dsh plugin add github:Suxeca/<pkg>`；镜像内含预编译 `lib/`，**无需 clone、无需构建**（见下方「一键安装」） |
| 📦 **Third-party 收录** | 上游开源项目，本地收录并增强 | 见[第三方收录索引](#第三方收录索引--vendored-third-party)；`third-party/` 各自保留上游许可证 |
| 🔒 **Local-only / 本地独占** | **不建议公开安装**：内含本机凭据 / 绝对路径 / 私有端点假设 | 绑定本机环境，迁移后不可用 |
| ⚠️ **Install-gated / 安装需审批** | 触及 `credentials` / `child_process` / `tools/pre-execute` 等敏感特权 | 安装时审计器**弹出 DSH 原生审批卡**，列出具体风险，经你确认后才放行 |
| 🌐 **npm-publishable** | `package.json` **未声明** `private: true`，可公开发布 | 全仓仅 3 个满足：`dsh-science-map`、`dsh-client-ui-session-switcher`、`dsh-secure-context-polyfill` |

**关于 ✅ 的诚实边界**：`100/100 · A · 0 flags` 是**仓库级**审计结论，不是对 36 个插件逐个跑出的独立评分。审计器对每个插件仍会在**安装时刻**独立复检（见下）。

### 为什么矩阵里要放一个审计器

近年 GitHub 上出现大规模 **fake stars** 现象：CMU 的研究 *Six Million (Suspected) Fake Stars in GitHub*（[arXiv:2412.13459](https://arxiv.org/abs/2412.13459)，即 **CMU StarScout** 一类的假星检测研究路线）系统刻画了点星水军、脉冲式增星与空壳仓库。与此同时，**npm supply chain attack** 已从投毒依赖升级为在生命周期脚本里直接外联下载并执行载荷 —— 一个星数好看、README 漂亮的仓库，可能在 `postinstall` 里就跑掉了你的 `GITHUB_TOKEN`。

因此本仓库的默认姿态是：**不信任星数，先审计，再安装。**

---

## 插件矩阵 / Plugin Catalog（36）

### 🛡️ 安全审计与供应链 (Security & Supply Chain)

| 插件 | 目录 / 包名 | 版本 | 核心能力 | 真实度 / 安全 |
|---|---|---|---|---|
| **仓库审计器** | [`packages/dsh-plugin-repo-auditor`](packages/dsh-plugin-repo-auditor)<br/>`@suxeca/dsh-plugin-repo-auditor`<br/>🚀 [独立仓](https://github.com/Suxeca/dsh-plugin-repo-auditor) | `0.2.0` | GitHub 假星 / 水军 / 空壳项目审计 + 供应链投毒静态预检 + `tools/pre-execute` 安装门禁 | ✅ ⚠️ 🚀 |
| **代理链路守卫** | [`third-party/dsh-proxy-guard`](third-party/dsh-proxy-guard)<br/>`@dsh-external/dsh-proxy-guard` | `0.0.1` | 挂在 `tools/pre-execute`，硬拦截会切断 DSH 自身代理链路（`127.0.0.1:7897`）的 Bash 命令 | 📦 ⚠️ |
| **GPT 兼容守卫** | [`third-party/dsh-gpt-compat`](third-party/dsh-gpt-compat)<br/>`dsh-gpt-compat` | `0.2.3` | 对 GPT/Codex 冗余沙箱提权参数做 **fail-closed** 守卫，消除提权歧义 | 📦 |
| **搜索凭据网关** | [`packages/dsh-search-gateway`](packages/dsh-search-gateway)<br/>`@suxeca/dsh-search-gateway` | `0.0.1` | 统一搜索凭据网关：密钥失效自动转移、限流即停，**绝不为绕过配额而换号** | ✅ ⚠️ |
| **非安全上下文补丁** | [`packages/dsh-secure-context-polyfill`](packages/dsh-secure-context-polyfill)<br/>`@suxeca/dsh-secure-context-polyfill` | `0.1.0-rc.2` | 纯 HTTP 局域网 / NetBird 等非安全上下文下，用 `crypto.getRandomValues` 为 `crypto.randomUUID` 提供 UUID v4 polyfill | 🔒 🌐 |

### 🔬 科研学术与推演 (Science & Research)

| 插件 | 目录 / 包名 | 版本 | 核心能力 | 真实度 / 安全 |
|---|---|---|---|---|
| **科研核心** | [`packages/dsh-research-core`](packages/dsh-research-core)<br/>`@suxeca/dsh-research-core` | `0.0.2` | 证据驱动科研研读与文献综述：四库检索、原文取证、独立模型复核、写作交接 | ✅ |
| **学术 Beamer 引擎** | [`packages/dsh-academic-beamer`](packages/dsh-academic-beamer)<br/>`@suxeca/dsh-academic-beamer` | `0.0.1` | 学术 Beamer 流水线：叙事解构 → 16:9 深蓝模板生成 → 代数/数字门禁 → Tectonic 编译 | ✅ |
| **第一性原理推导审查** | [`packages/dsh-physics-derivation`](packages/dsh-physics-derivation)<br/>`@suxeca/dsh-physics-derivation` | `0.0.1` | 推导审查 + 对抗同行评议：逐等号闭合性、四步法定级、公理起点检验、拒稿挑刺 | ✅ |
| **科研写作核心** | [`packages/dsh-writing-core`](packages/dsh-writing-core)<br/>`@suxeca/dsh-writing-core` | `0.2.0` | 科研写作微单元：来源引文绑定、提纲/起稿、审稿回复、跨单元一致性复核 | ✅ |
| **思维演化地图** | [`packages/dsh-science-map`](packages/dsh-science-map)<br/>`@suxeca/dsh-science-map`<br/>🚀 [独立仓](https://github.com/Suxeca/dsh-science-map) | `0.1.0` | 科研思维与计算流演化地图编译器 + 认知门禁验证器 | ✅ 🌐 🚀 |
| **会话笔记看板** | [`packages/dsh-note-board`](packages/dsh-note-board)<br/>`@suxeca/dsh-note-board` | `0.2.1` | 对话视图第三页签「笔记看板」：KaTeX 渲染、每轮增量注入系统提示、对抗审计判决 | ✅ |
| **文献研究库** | [`packages/dsh-literature-library`](packages/dsh-literature-library)<br/>`@suxeca/dsh-literature-library`<br/>🚀 [独立仓](https://github.com/Suxeca/dsh-literature-library) | `0.0.1` | 文献书签与本地研究知识库：鉴权持久化书签，供 radar briefing 复用 | ✅ 🚀 |

### 🛠️ 插件开发与工程生产线 (Plugin Dev & Engineering)

| 插件 | 目录 / 包名 | 版本 | 核心能力 | 真实度 / 安全 |
|---|---|---|---|---|
| **超级模组注入器** | [`third-party/dsh-super-injector`](third-party/dsh-super-injector)<br/>`@dsh-external/dsh-super-injector` | `0.3.3` | BepInEx 式运行时注入：**免重启**加载任意本地插件包、确定性热重载、staging 侧挂转正、一键卸载 | 📦 ⚠️ |
| **插件开发生产线** | [`packages/dsh-dev-pipeline`](packages/dsh-dev-pipeline)<br/>`@suxeca/dsh-dev-pipeline` | `0.0.1` | lint 规范检查 + 7 接触点测试门禁 + 重依赖/二进制扩展审计 + 发版安全门禁 | ✅ |
| **开发期探针** | [`packages/dsh-dev-probes`](packages/dsh-dev-probes)<br/>`@suxeca/dsh-dev-probes` | `0.0.1` | preset parse / client boot graph / profile preflight 三探针，**重启前**证伪启动崩溃 | ✅ |
| **工程工具箱** | [`packages/dsh-engineering-toolkit`](packages/dsh-engineering-toolkit)<br/>`@suxeca/dsh-engineering-toolkit` | `0.0.1` | TDD 执行器 + 严格六步根因诊断状态机 + 架构审计 + 结构化交接单 | ✅ |
| **内联可视化** | [`third-party/dsh-visualize`](third-party/dsh-visualize)<br/>`@dsh-external/dsh-visualize` | `0.1.2` | `visualize` 工具 + 配套 skill：模型直接渲染交互式 HTML 卡片 | 📦 |
| **Codex 桥** | [`third-party/dsh-codex-bridge`](third-party/dsh-codex-bridge)<br/>`@dsh-external/dsh-codex-bridge` | `0.0.1` | 把官方 Codex app-server 暴露为 DSH subagent 工具（`subagent_codex`） | 📦 ⚠️ |
| **Codex 固定模型** | [`third-party/dsh-codex-gpt55`](third-party/dsh-codex-gpt55)<br/>`@dsh-external/dsh-codex-gpt55` | `0.0.1` | Codex subagent provider 固定到账号已接受的模型，避免模型漂移 | 📦 |
| **TypeSafe 语义服务** | [`packages/dsh-typesafe`](packages/dsh-typesafe)<br/>`@suxeca/dsh-typesafe` | `0.1.0` | TypeSafe System One (Jev) 封装为 Cordis 单例服务 `ctx.typesafe` + `typesafe_eval` 工具，密钥零明文 | ✅ ⚠️ |

### 🎨 界面与交互增强 (UI & Experience)

| 插件 | 目录 / 包名 | 版本 | 核心能力 | 真实度 / 安全 |
|---|---|---|---|---|
| **会话快速切换** | [`packages/dsh-client-ui-session-switcher`](packages/dsh-client-ui-session-switcher)<br/>`@suxeca/dsh-client-ui-session-switcher`<br/>🚀 [独立仓](https://github.com/Suxeca/dsh-client-ui-session-switcher) | `0.1.0-rc.7` | `Ctrl+K` 调色板（新建/归档/重命名/搜索/皮肤/工作区分组）、`Ctrl+[` `Ctrl+]` 循环切会话、快捷键自定义 | ✅ 🌐 🚀 |
| **外部目录 Tab** | [`packages/dsh-external-dirs`](packages/dsh-external-dirs)<br/>`@suxeca/dsh-external-dirs` | `0.0.1` | 官方侧边栏「外部目录」Tab：只读浏览会话工作区之外的目录，点击文件复用官方预览 | ✅ |
| **PDF 拖放直传** | [`packages/dsh-pdf-drop`](packages/dsh-pdf-drop)<br/>`@suxeca/dsh-pdf-drop` | `0.1.1` | 拖放 PDF/文档到输入框：流式上传进当前会话工作区 + 自动注入 `@file` 引用 | ✅ |
| **移动端润色** | [`packages/dsh-mobile-polish`](packages/dsh-mobile-polish)<br/>`@suxeca/dsh-mobile-polish` | `0.1.0` | Android/移动端焦点布局：全宽对话容器 + 紧凑单行输入控件 + 安全区对齐 | ✅ |
| **自定义思考强度** | [`packages/dsh-custom-thinking`](packages/dsh-custom-thinking)<br/>`@dsh-external/dsh-custom-thinking` | `0.0.1` | 为手写自定义 Provider 写入 `reasoningEfforts`，让模型选择器显示思考等级 | ✅ |
| **表达风格开关** | [`packages/dsh-expression-mode`](packages/dsh-expression-mode)<br/>`@suxeca/dsh-expression-mode` | `0.2.0` | 会话级中英语言选择 + 独立简明风格开关，兼顾命令、界面与科学保真规范 | ✅ |
| **多模型配额环** | [`packages/dsh-quota-meter`](packages/dsh-quota-meter)<br/>`@suxeca/dsh-quota-meter` | `0.1.0` | 输入框上方动态配额环：CPA Codex 周配额 / Command Code 周配额 / DeepSeek 余额轮询 | 🔒 |
| **丝滑流式渲染** | [`third-party/dsh-smooth-stream`](third-party/dsh-smooth-stream)<br/>`dsh-smooth-stream` | `0.3.3` | 打字机/提词器平滑渲染，无闪烁；含本地 **CJK 跨行重叠位移修复** | 📦 |
| **非线性画布** | [`third-party/dsh-synapse`](third-party/dsh-synapse)<br/>`dsh-synapse` | `0.3.0` | 非线性可视化会话工作区：画布投影 + 持久化工作区 | 📦 |
| **鲸鱼下潜动画** | [`third-party/dsh-whale-animation`](third-party/dsh-whale-animation)<br/>`dsh-whale-animation` | `0.3.0` | DeepSeek 灵感鲸鱼下潜与反应式水波动效，实时反映 turn 状态 | 📦 |
| **启动加载动画** | [`third-party/dsh-boot-animation`](third-party/dsh-boot-animation)<br/>`dsh-boot-animation` | `0.2.0` | 全窗口启动影片覆盖内核 boot 页并溶解进入；点击进入、多片随机、失败有兜底，**不改 DSH 本体源码** | 📦 |
| **壁纸引擎** | [`third-party/dsh-wallpaper-engine`](third-party/dsh-wallpaper-engine)<br/>`dsh-plugin-wallpaper-engine` | `1.3.1` | 把本地 Wallpaper Engine 壁纸渲染在对话区背后（Scene / Web / WebWallGL） | 📦 |

### 🧠 记忆与路由 (Memory & Routing)

| 插件 | 目录 / 包名 | 版本 | 核心能力 | 真实度 / 安全 |
|---|---|---|---|---|
| **deja 记忆召回** | [`third-party/dsh-deja`](third-party/dsh-deja)<br/>`dsh-deja` | `0.20.6` | 24+ 编程 Agent 的会话历史召回记忆：可检索、可复用的既有工程经验 | 📦 |
| **sage-mem** | [`third-party/sage-mem`](third-party/sage-mem)<br/>`sage-mem` | `0.1.3` | 跨会话长期记忆，**Chinese-first** FTS5 trigram 全文检索（git submodule） | 📦 ⚠️ |
| **MemSearch** | [`third-party/dsh-memsearch`](third-party/dsh-memsearch)<br/>`@zilliz/memsearch-dsh` | `0.1.4` | 跨 agent 共享 markdown 记忆：捕获、步前上下文注入与检索 | 📦 |
| **Antigravity 接入** | [`third-party/dsh-agy`](third-party/dsh-agy)<br/>`dsh-agy` | `0.4.5` | Google Antigravity OAuth 授权与模型接入：多账号池、429 轮换 | 📦 ⚠️ |

---

## 第三方收录索引 / Vendored Third-Party

`third-party/` 下的 15 个插件是**上游开源项目**，在本仓库内被收录、本地修复或增强。它们各自保留上游许可证；本仓库的 MIT 不覆盖它们。

| 插件 | 版本 | 本地增强 / 收录说明 |
|---|---|---|
| [dsh-super-injector](third-party/dsh-super-injector) | `0.3.3` | git submodule → [yjh051108/dsh-super-injector](https://github.com/yjh051108/dsh-super-injector) |
| [sage-mem](third-party/sage-mem) | `0.1.3` | git submodule → [gezi-wen/sage-mem](https://github.com/gezi-wen/sage-mem) |
| [dsh-smooth-stream](third-party/dsh-smooth-stream) | `0.3.3` | 含本地 CJK 跨行修复，记录见 [FIX-NOTES.md](third-party/dsh-smooth-stream/FIX-NOTES.md) |
| [dsh-wallpaper-engine](third-party/dsh-wallpaper-engine) | `1.3.1` | 包名 `dsh-plugin-wallpaper-engine`；`publishConfig.access: public` |
| [dsh-proxy-guard](third-party/dsh-proxy-guard) | `0.0.1` | 本地代理自毁防护，挂 `tools/pre-execute` |
| [dsh-visualize](third-party/dsh-visualize) | `0.1.2` | 内联可视化卡片 + bundled skill |
| [dsh-codex-bridge](third-party/dsh-codex-bridge) | `0.0.1` | Codex app-server → subagent 工具 |
| [dsh-codex-gpt55](third-party/dsh-codex-gpt55) | `0.0.1` | Codex provider 固定模型 |
| [dsh-agy](third-party/dsh-agy) | `0.4.5` | Google Antigravity OAuth 接入 |
| [dsh-deja](third-party/dsh-deja) | `0.20.6` | 多 Agent 会话历史召回 |
| [dsh-memsearch](third-party/dsh-memsearch) | `0.1.4` | 包名 `@zilliz/memsearch-dsh` |
| [dsh-synapse](third-party/dsh-synapse) | `0.3.0` | 非线性画布工作区 |
| [dsh-whale-animation](third-party/dsh-whale-animation) | `0.3.0` | 鲸鱼状态动画 |
| [dsh-boot-animation](third-party/dsh-boot-animation) | `0.2.0` | 启动加载动画（含 `AGENTS.md` 维护者简报与 `verify/` 套件） |
| [dsh-gpt-compat](third-party/dsh-gpt-compat) | `0.2.3` | fail-closed 沙箱提权守卫；`publishConfig.access: public` |

---

## 核心插件指南

### 1. 仓库审计器 `@suxeca/dsh-plugin-repo-auditor` `0.2.0` — GitHub Fake Star Detector

本矩阵的旗舰条目，也是唯一提供**一键独立安装**的插件。启发式指标源自 CMU 论文 *Six Million (Suspected) Fake Stars in GitHub*（[arXiv:2412.13459](https://arxiv.org/abs/2412.13459)，**CMU StarScout** 研究路线），在 DSH 的 Cordis 架构上本地原生实现。

**六层检测**：

| # | 检测层 | 关键判据 |
|---|---|---|
| 1 | 互动比率异常 | Fork/Star < 0.05 扣分，< 0.02 判 `CRITICAL_LOW_FORK_RATIO`；Watcher/Star 基准 ≥ 0.5%，大仓（>50k★）动态校准 |
| 2 | 体积与时间序列 | ★≥100 且体积 < 30 KB → `HOLLOW_REPO_SIZE`；★≥200 且活跃跨度 < 2 天 → `SHORT_LIFESPAN_SPIKE` |
| 3 | 点星水军抽样 | 并发抽检 Stargazers：三无空白号 + 注册 <30 天闪电号；占比 ≥25%/≥50% 分级扣分 |
| 4 | **供应链投毒预检** | 生命周期脚本含 `curl`/`wget`/`eval`/`base64`/`GITHUB_TOKEN` 读取 → 直接判 **F 级** |
| 5 | DSH 特权扫描 | 识别 `dsh.bundle` / `cordis.patch.yml`，扫描 `inject` 声明的 `credentials` / `child_process` / `plugin_manager` |
| 6 | 提示词注入检测 | 扫描系统提示词中是否潜藏 `SKIP_REPO_AUDIT` 等越狱词汇 |

**Pre-Execute Gate（安装门禁）**：审计器挂在 `tools/pre-execute` 扩展点，实时监听 `plugin_manager`（`install_bundle`）与 `bash`（`git clone` / `npm install github:...`）。双轨触发 —— **轨迹一**星数信度低（D/F 级或空壳告警），**轨迹二**供应链/敏感权限中高风险 —— 命中即弹出 DSH 原生 `{ kind: 'ask' }` 审批卡，列明具体风险，**由你决定放行与否**。紧急通道：`SKIP_REPO_AUDIT=1`。

**配额自愈设计**：GitHub Raw CDN 零配额静态拉取 `package.json` / `cordis.patch.yml`，**绝不消耗 REST 配额**；四级凭据自动探测（`config.token` → DSH `credentials` → `GITHUB_TOKEN` → 本地环境文件）；健康仓库（≥85 分）严格只花 **1 次** API 请求；10 分钟 TTL 缓存，`forceRefresh: true` 可穿透。

**配置**（DSH 设置面板或 `cordis.patch.yml`）：

```yaml
- insert:
    - id: repo-auditor
      name: '@suxeca/dsh-plugin-repo-auditor'
      config:
        token: ""              # GitHub PAT（可选，会自动从环境或 ~/.bashrc 读取）
        sampleSize: 5          # 水军账号抽样数（默认 5）
        enableInstallGate: true # 是否开启安装拦截门禁（默认 true）
```

### 2. 开发期探针 `@suxeca/dsh-dev-probes` `0.0.1`

常驻 `dsh.profile.bundles`。三类改动**无法用常规手段自证正确**，探针在**重启之前**给出判决：

| 时机 | 探针 | 通过标准 |
|---|---|---|
| 改完任何 agent preset 的 `agent.cordis.yml`，**重启 DSH 之前** | `dsh_preset_parse_check` | `verdict: "PARSES"` —— 磁盘字节可挂载 |
| 想知道某 preset 装了什么 / 为什么坏 | `dsh_preset_probe` | `broken` 为 `null` 即健康（附 `rowCount`） |
| 装 / 重载 / 注入任何客户端插件之后 | `dsh_client_graph_probe` | `present: true` —— 前端会真的加载它 |
| **往 `dsh.profile.bundles` 加包之后、重启之前** | `dsh_profile_preflight` | `verdict: "PASS"` —— 下次启动能过 bundle 层 |

理由不是"更方便"，而是**代价不对称**：`dsh.profile.bundles` 是启动路径，loader 对其中每一项都要求 `dsh.bundle.patch`，缺了就在启动时 `throw` —— 只是"装了个包"，却变成"关掉 DSH 之后再也起不来"。四个探针**全部只读**。

### 3. 超级模组注入器 `@dsh-external/dsh-super-injector` `0.3.3`

运行时插件加载引擎，免重启即时调试：

- **运行时注入**：`dev_inject_plugin <插件绝对路径>`
- **确定性热重载**：`dev_reload_package <包名子串>`
- **安全卸载**：`dev_uninject_plugin <包名子串>`
- **全链路自检**：`dev_self_test`（验证注入、重载、回滚与防崩溃）

### 4. 会话快速切换 `@suxeca/dsh-client-ui-session-switcher` `0.1.0-rc.7`

- **呼出面板**：`Ctrl+K` / `Alt+K`，支持拼音与文本模糊搜索，按 `Enter` 切入。
- **对话循环**：`Ctrl+[` / `Ctrl+]` 按侧边栏顺序前后循环。
- **布局联动**：`Ctrl+B` 左栏、`Ctrl+Shift+B` 官方右栏、`Esc` 快速收起。

---

## 安装与装配方式

### 方式 A：一键安装独立插件（推荐 —— 4 个已发布插件）

```sh
dsh plugin add github:Suxeca/dsh-plugin-repo-auditor          # 审计器
dsh plugin add github:Suxeca/dsh-science-map                  # 思维演化地图
dsh plugin add github:Suxeca/dsh-literature-library           # 文献研究库
dsh plugin add github:Suxeca/dsh-client-ui-session-switcher   # 会话快速切换
```

只读镜像自带编译产物（`lib/`），**无需 clone、无需构建**。真源分别是本仓库的 `packages/dsh-plugin-repo-auditor`、`packages/dsh-science-map`、`packages/dsh-literature-library`、`packages/dsh-client-ui-session-switcher` —— 开发与修复都在母仓发生，镜像随后同步。

其余插件（如 `dsh-note-board`、科研核心、界面增强等）尚未发布独立仓，请使用下方方式 B / C / D 装配。

### 方式 B：超级模组注入（推荐开发调试，即时生效）

在当前会话中即时加载本地插件，**无需重启**：

```sh
dev_inject_plugin /path/to/dsh-plugin/packages/xxx
```

### 方式 C：Profile 常驻安装（重启后常驻）

以 bundle 形式装配到指定 profile：

```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add link:/path/to/dsh-plugin/packages/xxx
# 重启 dsh web 生效
```

> ⚠️ 往 `dsh.profile.bundles` 加包之后、重启之前，**先跑 `dsh_profile_preflight`**。

### 方式 D：预设安装 (Presets)

```sh
mkdir -p ~/.dsh/.agent-presets
cp -r presets/router-standard ~/.dsh/.agent-presets/
# 重启 DSH 后在新建会话中选择 Router Standard
```

---

## 仓库结构

```text
dsh-plugin/
├── packages/                        # 21 个自研插件（MIT，tsdown + vitest）
│   ├── dsh-plugin-repo-auditor/     #   🛡️ 假星审计 + 供应链预检 + 安装门禁
│   ├── dsh-research-core/           #   🔬 证据驱动科研研读底座
│   ├── dsh-academic-beamer/         #   🔬 学术 Beamer 流水线
│   ├── dsh-physics-derivation/      #   🔬 第一性原理推导审查
│   ├── dsh-writing-core/            #   🔬 科研写作微单元
│   ├── dsh-science-map/             #   🔬 思维演化地图编译器 (🌐 public)
│   ├── dsh-note-board/              #   🔬 会话笔记看板 (KaTeX)
│   ├── dsh-literature-library/      #   🔬 文献书签与本地研究库
│   ├── dsh-dev-pipeline/            #   🛠️ 插件开发全链路生产线
│   ├── dsh-dev-probes/              #   🛠️ 开发期验证探针
│   ├── dsh-engineering-toolkit/     #   🛠️ TDD / 根因诊断 / 交接单
│   ├── dsh-typesafe/                #   🛠️ TypeSafe 语义判断服务
│   ├── dsh-client-ui-session-switcher/ # 🎨 Ctrl+K 会话调色板 (🌐 public)
│   ├── dsh-external-dirs/           #   🎨 侧边栏「外部目录」Tab
│   ├── dsh-pdf-drop/                #   🎨 PDF 拖放直传 + @file 注入
│   ├── dsh-mobile-polish/           #   🎨 移动端全宽布局润色
│   ├── dsh-custom-thinking/         #   🎨 自定义 Provider 思考强度
│   ├── dsh-expression-mode/         #   🎨 语言与简明表达风格开关
│   ├── dsh-quota-meter/             #   🎨 🔒 多模型配额环
│   ├── dsh-search-gateway/          #   🛡️ 统一搜索凭据网关
│   └── dsh-secure-context-polyfill/ #   🛡️ 🔒 非安全上下文 crypto polyfill (🌐 public)
├── third-party/                     # 15 个收录 / 本地增强的上游插件
│   ├── dsh-super-injector/          #   [submodule] 运行时注入器
│   ├── dsh-proxy-guard/             #   代理链路自毁拦截
│   ├── dsh-visualize/               #   内联可视化卡片
│   ├── dsh-codex-bridge/            #   Codex → subagent 工具
│   ├── dsh-codex-gpt55/             #   Codex 固定模型 provider
│   ├── dsh-agy/                     #   Google Antigravity 接入
│   ├── dsh-deja/                    #   多 Agent 会话历史召回
│   ├── sage-mem/                    #   [submodule] Chinese-first 长期记忆
│   ├── dsh-memsearch/               #   跨 agent 共享 markdown 记忆
│   ├── dsh-smooth-stream/           #   丝滑流式渲染（含 CJK 修复）
│   ├── dsh-synapse/                 #   非线性画布工作区
│   ├── dsh-whale-animation/         #   鲸鱼下潜状态动画
│   ├── dsh-boot-animation/          #   启动加载动画
│   ├── dsh-gpt-compat/              #   fail-closed 沙箱提权守卫
│   └── dsh-wallpaper-engine/        #   壁纸引擎集成
├── presets/                         # 推理模式路由预设
│   └── router-standard/             #   通用任务感知路由
├── shared/                          # 构建预设：tsdown.client.ts / web-platform.ts
├── scripts/                         # 验证脚本（快捷键、会话地图、预览等）
├── docs/                            # 设计与规范文档
│   ├── HISTORICAL-PLUGINS.md        #   🏛️ 历史与退役插件归档
│   ├── DEVELOPMENT.md               #   插件开发指南
│   └── UPDATE-PLAN.md               #   演进计划
├── LICENSE                          # MIT (c) 2026 Suxeca
└── README.md
```

---

## 开发与构建

```sh
pnpm install
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓单元测试
pnpm build          # 构建全部包
```

开发任何插件前请先读 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)；发版前跑 `pipeline_release_gate`。

---

## 关键词 / Keywords

为了让需要它的人找到这里，本仓库明确对应以下检索意图：

**内核与形态**：DeepSeek Harness · DSH · Cordis · Cordis Plugin · AI Agent · dsh-plugin · [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) · DeepSeek Harness 插件 · DSH 插件开发

**安装与分发**：`dsh plugin add` · `dsh plugin add github:Suxeca/dsh-plugin-repo-auditor` · Cordis patch / bundle · profile bundles · 运行时插件注入

**安全与真实度**：GitHub Fake Star Detector · fake stars · CMU StarScout · 假星检测 · 水军识别 · 空壳仓库 · [arXiv:2412.13459](https://arxiv.org/abs/2412.13459) · Supply Chain Security · 供应链投毒 · npm supply chain attack · 生命周期脚本投毒 · Pre-Execute Gate · 安装门禁 · 审批卡拦截 · fail-closed 沙箱守卫

**科研**：证据驱动文献综述 · 引文核验 · 对抗同行评议 · Beamer 生成 · 第一性原理推导审查 · 科研写作

---

## 历史归档与相关文档

- 🏛️ **已退役插件历史记录**：参见 [`docs/HISTORICAL-PLUGINS.md`](docs/HISTORICAL-PLUGINS.md)（含 `dsh-better-sidebar`、`dsh-lab-kit`、`dsh-conversation-share`、`dsh-agent-teams`、`dsh-vision-toolkit` 的卸载原因、存储释放数据与源码归档路径）。
- 📘 **插件开发指南**：参见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
- 🔧 **平滑流式 CJK 修复记录**：参见 [`third-party/dsh-smooth-stream/FIX-NOTES.md`](third-party/dsh-smooth-stream/FIX-NOTES.md)。

---

## 开源许可

- 本仓库自有代码（`packages/`、`presets/`、`scripts/`、`shared/`）采用 [MIT License](LICENSE)。
- `third-party/` 收录的第三方插件遵循各自上游的开源许可证（详见各子目录内的 `LICENSE` 与 `package.json`）。

---
---

# English

**DeepSeek Harness (DSH) plugin matrix** — a bilingual, production-grade collection of **36 Cordis Plugin** packages for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI: **21 first-party plugins** in `packages/` plus **15 vendored or locally enhanced upstream plugins** in `third-party/`.

Every entry is a **Cordis Plugin** — an isolated unit mounted on DSH's Cordis kernel. Each can be injected at runtime for zero-restart debugging, or installed as a bundle into a profile for persistence. Plugins collaborate over the Cordis service bus (`ctx.*`) rather than through hardcoded coupling, which is what lets a single **AI Agent** host drive the whole matrix.

## Install a standalone plugin in one command

Four plugins are published as standalone, read-only mirror repositories, so each installs without cloning or building anything:

```sh
dsh plugin add github:Suxeca/dsh-plugin-repo-auditor          # fake-star + supply-chain auditor
dsh plugin add github:Suxeca/dsh-science-map                  # research evolution-map compiler
dsh plugin add github:Suxeca/dsh-literature-library           # literature bookmarks / research library
dsh plugin add github:Suxeca/dsh-client-ui-session-switcher   # Ctrl+K session switcher
```

The headline capability of this repo is **GitHub Fake Star Detector** — an auditor for fake stars, stargazer bot farms, hollow repositories, and poisoned install scripts. Then call the native tool from any session:

```text
audit_github_repos({ repos: ["owner/repo"] })
```

| Standalone repository | Install command | Audit |
|---|---|---|
| [dsh-plugin-repo-auditor](https://github.com/Suxeca/dsh-plugin-repo-auditor) | `dsh plugin add github:Suxeca/dsh-plugin-repo-auditor` | A · 100/100 · 0 flags |
| [dsh-science-map](https://github.com/Suxeca/dsh-science-map) | `dsh plugin add github:Suxeca/dsh-science-map` | A · 100/100 · 0 flags |
| [dsh-literature-library](https://github.com/Suxeca/dsh-literature-library) | `dsh plugin add github:Suxeca/dsh-literature-library` | A · 100/100 · 0 flags |
| [dsh-client-ui-session-switcher](https://github.com/Suxeca/dsh-client-ui-session-switcher) | `dsh plugin add github:Suxeca/dsh-client-ui-session-switcher` | A · 100/100 · 0 flags |

| | |
|---|---|
| **Mirror** | [github.com/Suxeca/dsh-plugin-repo-auditor](https://github.com/Suxeca/dsh-plugin-repo-auditor) |
| **What the mirror is** | An **auto-generated, read-only mirror** containing compiled artifacts (`lib/`), `package.json`, `cordis.patch.yml` and locale files — **ready to load, no build step** |
| **Source of truth** | [`packages/dsh-plugin-repo-auditor`](packages/dsh-plugin-repo-auditor) in this monorepo. Development and fixes happen here; the mirror is synced afterwards |
| **Why a mirror exists** | GitHub cannot resolve a single plugin's `package.json` from the root of a monorepo, so `dsh plugin add github:...` cannot point at this repository root. The standalone mirror exposes a **loadable package root** as an explicit install target |

To install any other plugin, use runtime injection or a profile link — see the Chinese section above for the exact commands.

## Why this repo leads with an auditor

The GitHub ecosystem now has a measurable **fake stars** problem. CMU's *Six Million (Suspected) Fake Stars in GitHub* ([arXiv:2412.13459](https://arxiv.org/abs/2412.13459)) — the research line behind tooling such as **CMU StarScout** — documents coordinated stargazer bot networks, pulse-shaped star growth, and hollow repositories that exist only to look popular. In parallel, an **npm supply chain attack** no longer needs to poison a dependency: a `postinstall` hook can fetch and execute a remote payload, and exfiltrate your `GITHUB_TOKEN`, before you ever read the source.

So the default posture here is: **do not trust the star count — audit first, install second.**

## Supply Chain Security

The auditor `@suxeca/dsh-plugin-repo-auditor` `0.2.0` implements six detection layers natively on Cordis:

| # | Layer | Signal |
|---|---|---|
| 1 | Engagement-ratio anomalies | Fork/Star < 0.05 penalised; < 0.02 flagged `CRITICAL_LOW_FORK_RATIO`; Watcher/Star baseline ≥ 0.5%, dynamically calibrated above 50k stars |
| 2 | Size & time-series anomalies | ★≥100 with < 30 KB of code → `HOLLOW_REPO_SIZE`; ★≥200 with < 2 days of activity span → `SHORT_LIFESPAN_SPIKE` |
| 3 | Stargazer bot sampling | Concurrent sampling of recent stargazers: empty accounts and accounts younger than 30 days; ≥25% / ≥50% bot ratios score progressively worse |
| 4 | **Install-hook poisoning** | Lifecycle scripts containing `curl` / `wget` / `eval` / `base64` / `GITHUB_TOKEN` reads are judged **grade F** outright |
| 5 | DSH privilege scan | Detects `dsh.bundle` / `cordis.patch.yml` and scans `inject` declarations for `credentials`, `child_process`, `plugin_manager` |
| 6 | Prompt-injection detection | Scans plugin system prompts for jailbreak vocabulary such as `SKIP_REPO_AUDIT` |

### Pre-Execute Gate

The **Pre-Execute Gate** hooks DSH's `tools/pre-execute` extension point and watches `plugin_manager` (`install_bundle`) and `bash` (`git clone`, `npm install github:...`) in real time. It fires on two independent tracks — (1) low star credibility (grade D/F, or a hollow-repo alert), and (2) medium/high supply-chain or privilege risk — and raises a native DSH `{ kind: 'ask' }` approval card that names the specific risk. **Nothing is installed until you approve it.** Emergency bypass: `SKIP_REPO_AUDIT=1`.

Quota discipline is a design constraint, not an afterthought: `package.json` and `cordis.patch.yml` are fetched statically over the GitHub Raw CDN so the REST quota is **never** consumed; credentials are auto-discovered in four tiers (`config.token` → DSH `credentials` → `GITHUB_TOKEN` → local env files); healthy repositories (score ≥ 85) cost exactly **one** API request; and results are cached for 10 minutes with a `forceRefresh: true` escape hatch.

### Verified trust signal

This repository itself was scored by `audit_github_repos` on **2026-10-14**: **100/100, grade A, 0 flags** ("Healthy and credible open-source repository."). That is a **repo-level** verdict covering the first-party `packages/` tree — it is not a per-plugin score, and the auditor re-checks every plugin independently at install time.

## Authenticity & security badges

| Badge | Meaning | Basis |
|---|---|---|
| ✅ **Audited** | First-party plugin inside the audited repository | Repo-level `audit_github_repos` verdict: 100/100, grade A, 0 flags (2026-10-14) |
| 🚀 **Standalone installable** | Published to its own read-only mirror repo | `dsh plugin add github:Suxeca/<pkg>` — the mirror ships prebuilt `lib/`, so no clone and no build step |
| 📦 **Third-party vendored** | Upstream open-source project, vendored and enhanced locally | `third-party/` retains each upstream license |
| 🔒 **Local-only** | **Not intended for public install** — assumes local credentials, absolute paths, or private endpoints | Bound to this machine's environment |
| ⚠️ **Install-gated** | Touches `credentials` / `child_process` / `tools/pre-execute` | The auditor raises an approval card before install |
| 🌐 **npm-publishable** | `package.json` does **not** declare `private: true` | Only 3 of 36: `dsh-science-map`, `dsh-client-ui-session-switcher`, `dsh-secure-context-polyfill` |

## What's in the matrix

| Group | Plugins | Highlights |
|---|---|---|
| 🛡️ **Security & Supply Chain** | 5 | Repo auditor + Pre-Execute Gate, proxy-link guard, fail-closed sandbox-escalation guard, unified search-credential gateway, non-secure-context crypto polyfill |
| 🔬 **Science & Research** | 7 | Evidence-bound literature review, arXiv TeX extraction, adversarial peer review, Beamer pipeline with algebraic/numeric gates, writing micro-units, science-map compiler, KaTeX note board |
| 🛠️ **Plugin Dev & Engineering** | 8 | Runtime super-injector, lint + 7-touchpoint release gate, preset/client-graph/profile preflight probes, TDD + six-step root-cause diagnosis, inline visualization, Codex bridge |
| 🎨 **UI & Experience** | 12 | Ctrl+K session palette, external-dirs sidebar tab, PDF drag-and-drop with `@file` injection, mobile layout polish, smooth streaming with a CJK fix, non-linear canvas, whale/boot animations, Wallpaper Engine backgrounds |
| 🧠 **Memory & Routing** | 4 | Cross-session recall over 24+ coding-agent histories, Chinese-first FTS5 trigram memory, shared markdown memory, Google Antigravity OAuth model access |

The complete per-plugin table — with **exact versions**, package names, directories, one-line capabilities and badges — is in [插件矩阵 / Plugin Catalog](#插件矩阵--plugin-catalog36) above.

## Repository layout

```text
dsh-plugin/
├── packages/       # 21 first-party plugins (MIT, tsdown + vitest)
├── third-party/    # 15 vendored / enhanced upstream plugins (upstream licenses)
├── presets/        # router-standard inference-routing preset
├── shared/         # build presets (tsdown.client.ts, web-platform.ts)
├── scripts/        # verification scripts
├── docs/           # DEVELOPMENT.md, HISTORICAL-PLUGINS.md, UPDATE-PLAN.md
├── LICENSE         # MIT (c) 2026 Suxeca
└── README.md
```

## Build

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm build
```

## Documentation

- 🏛️ **Retired plugins** — [`docs/HISTORICAL-PLUGINS.md`](docs/HISTORICAL-PLUGINS.md)
- 📘 **Plugin development guide** — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- 🔧 **Smooth-stream CJK fix record** — [`third-party/dsh-smooth-stream/FIX-NOTES.md`](third-party/dsh-smooth-stream/FIX-NOTES.md)

## License

- First-party code (`packages/`, `presets/`, `scripts/`, `shared/`) is [MIT licensed](LICENSE).
- Plugins under `third-party/` retain their respective upstream licenses — see each subdirectory's `LICENSE` and `package.json`.

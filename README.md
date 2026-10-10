# dsh-plugin · DSH 个人插件合集

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的**个人插件合集与生产力套件**：涵盖界面与交互增强、科研推演流水线、插件开发与自愈体系、跨会话记忆以及推理模式路由预设。

> 🏛️ **历史插件归档**：此前退役、卸载或由 DSH 原生功能替代的插件（如 `dsh-better-sidebar`、`dsh-lab-kit`、`dsh-vision-toolkit` 等）已全数迁移至 **[历史与退役插件归档](docs/HISTORICAL-PLUGINS.md)**，首页仅保留在用与最新演进成果。

---

## 插件与组件总览

### 🎨 交互与界面增强 (UI & Experience)

| 插件 / 模块 | 目录 / 标识 | 核心功能与亮点 | 形态 |
|---|---|---|---|
| **会话快速切换** | `packages/dsh-client-ui-session-switcher` | `Ctrl+K` 调色板切对话/新建/归档/搜索、`Ctrl+[`/`]` 循环切会话、VSCode 风格布局快捷键 | npm / link |
| **丝滑流式渲染** | `third-party/dsh-smooth-stream` | 打字机 / 提词器平滑渲染动效；含本地 CJK 字符跨行重叠位移修复补丁（PR #6） | 本地 link |
| **壁纸引擎** | `third-party/dsh-wallpaper-engine` | 本地 Wallpaper Engine 集成，Scene/Web WebWallGL 实时渲染与液态玻璃质感 | 本地 link |
| **画布工作区** | `third-party/dsh-synapse` | 非线性画布投影：多会话画布映射与持久化工作区 | 本地 link |
| **鲸鱼下潜动画** | `third-party/dsh-whale-animation` | DeepSeek 灵感鲸鱼下潜与波纹动效，实时反映 turn 状态与思考流 | 本地 link |
| **移动端润色** | `packages/dsh-mobile-polish` | 手机/平板紧凑布局适配：全宽对话容器、紧凑单行输入框与安全区对齐 | 本地 link |

### 🔬 科研学术与推演 (Science & Research)

| 插件 / 模块 | 目录 / 标识 | 核心功能与亮点 | 形态 |
|---|---|---|---|
| **科研学术核心** | `packages/dsh-research-core` | 4 库权威学术检索硬印证、arXiv 原版 TeX 源码提取、论文全景解剖、PRL 级对抗同行评议 | 注入 / link |
| **学术 Beamer 引擎** | `packages/dsh-academic-beamer` | 全自动多团队对抗化 Beamer 流水线：叙事大纲解构、16:9 深蓝模板生成、Tectonic 极速编译 | 注入 / link |
| **第一性原理推导审查** | `packages/dsh-physics-derivation` | 符号与量纲闭合性四步法定级、公理起点检验、Hostile Reviewer 拒稿挑刺与 Claim 边界核验 | 注入 / link |
| **思维演化地图** | `packages/dsh-science-map` | 科研思维流与计算单元演化地图编译器、认知门禁验证器与可视化 | 注入 / link |
| **会话笔记看板** | `packages/dsh-note-board` | 第三页签 Markdown 笔记看板：KaTeX 渲染、每轮增量注入系统提示、对抗审计判决 | 本地 link |
| **文献研究库** | `packages/dsh-literature-library` | 持久化文献书签与本地研究知识库管理 | 本地 link |

### 🛠️ 插件开发与工程生产线 (Dev & Engineering)

| 插件 / 模块 | 目录 / 标识 | 核心功能与亮点 | 形态 |
|---|---|---|---|
| **超级模组注入器** | `third-party/dsh-super-injector` | DSH BepInEx 式模组入口：免重启运行时注入、热重载/自重载、staging 侧挂转正、一键自检 | GitHub / link |
| **插件开发生产线** | `packages/dsh-dev-pipeline` | 规范检查、7 接触点测试门禁、重依赖/二进制扩展审计、安全发版流水线 | 注入 / link |
| **开发期安全探针** | `packages/dsh-dev-probes` | Preset composition 挂载检查、Client boot graph 存在性探针、Profile preflight 重启防崩溃预检 | 常驻 bundle |
| **工程工具箱** | `packages/dsh-engineering-toolkit` | TDD 测试驱动执行器、严格六步根因诊断状态机、架构审计与结构化交接单生成 | 注入 / link |
| **侧边栏外部目录** | `packages/dsh-external-dirs` | 原生右侧栏「外部目录」Tab：只读浏览会话工作区外路径，无缝复用官方预览能力 | 本地 link |
| **TypeSafe 语义服务** | `packages/dsh-typesafe` | TypeSafe System One (Jev) 语义判断服务与单例评估工具 | 本地 link |

### 🛡️ 基础设施与环境扩展 (Infra & Enhancement)

| 插件 / 模块 | 目录 / 标识 | 核心功能与亮点 | 形态 |
|---|---|---|---|
| **代理链路守卫** | `third-party/dsh-proxy-guard` | 挂载于 `tools/pre-execute`，硬拦截破坏本地代理（127.0.0.1:7897）的危险 Bash 命令 | 常驻 bundle |
| **PDF 拖放直传** | `packages/dsh-pdf-drop` | 拖放文件流式上传至当前会话工作区，并自动在输入框注入 `@file` 引用 | 本地 link |
| **自定义思考强度** | `packages/dsh-custom-thinking` | 为自定义 Provider 模型写入 reasoningEfforts，支持前端选择思考等级 | 注入 / link |
| **记忆系统体系** | `sage-mem` / `dsh-deja` | 跨会话长期记忆沉淀（Chinese-first FTS5 trigram）与 24+ 编程 Agent 历史经验召回 | 混合装配 |
| **任务路由预设** | `presets/router-standard` | 通用任务感知路由（routing-suite 范式）：首轮分类 + 动态 persona 与工具解锁 | Preset 复制 |
| **安全上下文补丁** | `packages/dsh-secure-context-polyfill` | 纯 HTTP 远端/局域网访问时为 `crypto.randomUUID` 等提供 polyfill（🔒 私人使用） | 本地 link |
| **多模型配额仪表盘** | `packages/dsh-quota-meter` | 输入框上方动态配额环（CPA / Command Code / DeepSeek 余额轮询，🔒 本地独占） | 本地 link |

---

## 核心插件指南

### 1. 会话快速切换面板 (`dsh-client-ui-session-switcher`)
- **呼出面板**：`Ctrl+K` / `Alt+K`，支持拼音与文本模糊搜索，按 `Enter` 快速切入。
- **对话循环**：`Ctrl+[` / `Ctrl+]` 按照侧边栏顺序平滑前后循环切换会话。
- **布局联动**：
  - `Ctrl+B`：折叠 / 展开左侧栏（调用原生 `ctx.layout.toggleSidebar()`）
  - `Ctrl+Shift+B`：折叠 / 展开官方原生右侧栏（调用原生 `ctx.sidebarRight.toggleExpanded()`）
  - `Esc`：快速收起右侧栏

### 2. 超级模组注入器 (`dsh-super-injector`)
运行时插件加载引擎，无需重启 DSH 即可即时调试与加载插件：
- **运行时注入**：`dev_inject_plugin <插件绝对路径>`
- **确定性热重载**：`dev_reload_package <包名子串>`
- **安全卸载**：`dev_uninject_plugin <包名子串>`
- **全链路自检**：`dev_self_test`（验证注入、重载、回滚与防崩溃）

### 3. 开发期安全预检探针 (`dsh-dev-probes`)
常驻于 `dsh.profile.bundles`，在开发和配置变更时提供关键安全保护：
- `dsh_preset_parse_check`：改动 `agent.cordis.yml` 后验证磁盘配置是否可挂载。
- `dsh_profile_preflight`：修改 profile bundle 列表后预检下次启动是否会触发 loader 崩溃。
- `dsh_client_graph_probe`：检查前端插件是否真实进入 Client Boot Graph。

---

## 安装与装配方式

### 方式 A：超级模组注入（推荐开发调试，即时生效）
通过注入器在当前会话中即时加载本地插件（无需重启）：
```sh
dev_inject_plugin /path/to/dsh-plugin/packages/xxx
```

### 方式 B：Profile 常驻安装（重启后常驻）
在 harness 目录下以 bundle 形式装配到指定 profile：
```sh
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add link:/path/to/dsh-plugin/packages/xxx
# 重启 dsh web 生效
```

### 方式 C：预设安装 (Presets)
```sh
mkdir -p ~/.dsh/.agent-presets
cp -r presets/router-standard ~/.dsh/.agent-presets/
# 重启 DSH 后在新建会话中选择 Router Standard
```

---

## 目录结构

```
packages/                  # 仓库内维护插件（Monorepo，tsdown + vitest）
  dsh-academic-beamer/     #   全自动学术 Beamer 演示文稿生成
  dsh-client-ui-session-switcher/ # 会话快速切换面板 (Ctrl+K)
  dsh-custom-thinking/     #   自定义模型思考强度
  dsh-dev-pipeline/        #   DSH 插件开发全链路生产线
  dsh-dev-probes/          #   开发期安全预检探针 (Preflight/Graph)
  dsh-engineering-toolkit/ #   工程工具箱 (TDD/根因诊断/移交)
  dsh-expression-mode/     #   语言与简明表达风格开关
  dsh-external-dirs/       #   原生侧边栏「外部目录」Tab
  dsh-literature-library/  #   文献书签与本地研究库
  dsh-mobile-polish/       #   移动端全宽布局润色
  dsh-note-board/          #   会话笔记看板 (KaTeX/增量注入)
  dsh-pdf-drop/            #   PDF 拖放直传与引用注入
  dsh-physics-derivation/  #   第一性原理推导审查与对抗同行评议
  dsh-quota-meter/         #   🔒 多模型配额环（本地独占）
  dsh-research-core/       #   学术科研核心底座 (4库检索/TeX/解剖)
  dsh-science-map/         #   科研思维演化地图编译器
  dsh-secure-context-polyfill/ # 🔒 局域网非安全上下文补丁（本地独占）
  dsh-typesafe/            #   TypeSafe System One 语义评估
third-party/               # 收录与本地增强的第三方插件
  dsh-super-injector/      #   超级模组注入器
  dsh-smooth-stream/       #   丝滑流式渲染（含 CJK 修复）
  dsh-wallpaper-engine/    #   壁纸引擎
  dsh-synapse/             #   非线性画布工作区
  dsh-whale-animation/     #   鲸鱼潜水状态指示动画
  dsh-proxy-guard/         #   代理链路自毁拦截
  sage-mem/                #   跨会话长文本记忆
  dsh-deja/                #   Agent 历史开发经验召回
presets/                   # 推理模式路由预设
  router-standard/         #   通用任务感知路由
docs/                      # 项目设计、规范与历史归档
  HISTORICAL-PLUGINS.md    #   🏛️ 历史与退役插件归档
  DEVELOPMENT.md           #   插件开发指南
```

---

## 开发与构建

```sh
pnpm install
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓单元测试
pnpm build          # 构建全部包
```

---

## 历史归档与相关文档

- 🏛️ **已退役插件历史记录**：参见 [`docs/HISTORICAL-PLUGINS.md`](docs/HISTORICAL-PLUGINS.md)（含 `dsh-better-sidebar`、`dsh-lab-kit`、`dsh-conversation-share`、`dsh-agent-teams`、`dsh-vision-toolkit` 的卸载原因、存储释放数据与源码归档路径）。
- 📘 **插件开发指南**：参见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
- 🔧 **平滑流式 CJK 修复记录**：参见 [`third-party/dsh-smooth-stream/FIX-NOTES.md`](third-party/dsh-smooth-stream/FIX-NOTES.md)。

---

## 开源许可

- 本仓库自有代码（`packages/`、`presets/`、`scripts/`、`shared/`）采用 [MIT License](LICENSE)。
- `third-party/` 收录的第三方插件遵循各自上游的开源许可证（详见各子目录内的 `LICENSE` 与 `package.json`）。

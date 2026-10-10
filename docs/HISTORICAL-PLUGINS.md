# 历史与退役插件归档 (Historical & Deprecated Plugins)

本文档归档记录了曾收录或维护于本仓库、现已退役、卸载或由官方原生功能替代的插件历史档案。  
包含退役原因、原功能定位、历史备份位置及重新安装指引。

---

## 退役清单一览

| 插件名称 | 原类型 | 退役/卸载时间 | 退役原因与替代方案 | 历史备份 / 恢复指引 |
|---|---|---|---|---|
| **dsh-better-sidebar** | 第三方收录 | 2026-09-10 | DSH 0.1.5-rc.1 起官方原生右侧栏自带完整能力，移除释放 609MB | 历史 bundle 归档；可安装官方最新版 |
| **dsh-lab-kit** | 仓库内插件 | 2026-09-10 | 用户决定不再维护，已被原生侧边栏及 external-dirs 等替代 | 源码 tar 包保全 |
| **dsh-conversation-share** | 第三方收录 | 2026-09-10 | 上游 `@bill9109` scope 废弃下线（404） | 源码 tar 包保全；重装需改用无 scope 维护版 |
| **dsh-agent-teams** | 第三方收录 | 2026-09-08 | 移除非 loader 挂载的本地快照（释放 211MB），改用原生多 agent 调度 | 清理 profile junction 与快照 |
| **dsh-vision-toolkit** | 第三方收录 | 2026-09-08 | 官方模型原生支持多模态视觉，无需本地 Python 运行环境（释放 159MB） | 制品快照保全 |
| **dsh-plugin-manager** | 仓库内插件 | 历史版本 | 功能已完全被更强大的 `dsh-super-injector`（超级模组注入器）替代 | 已从 profiles 卸载 |

---

## 插件详细归档档案

### 1. dsh-better-sidebar · 第三方工作台侧边栏

- **原功能定位**：为 DSH Web GUI 提供多功能侧边栏（文件树、Markdown/代码/HTML/PDF/图片预览、内置终端、任务面板、Git 状态与浏览器面板）。
- **退役时间**：2026-09-10
- **退役原因**：DeepSeek Harness 自 `0.1.5-rc.1` 版本起，官方内核原生内置了高扩展性的右侧 Sidebar（`ctx.sidebarRight` 与 `ctx.sidebarRightTabs`），支持原生文件树、全屏模式与多标签页预览。继续使用第三方 Better Sidebar 存在架构冗余与样式冲突，卸载后释放了约 609MB 存储空间。
- **历史保全位置**：
  - Bundle 归档：`~/Workspace/.backups/dsh-upgrade-20260910_185827/dsh-better-sidebar-history.bundle`（含 `preserve/local-v0.12.1-custom` 分支，保留了卸载前的 +1321 行本地定制）。
  - 本地补丁：`~/Workspace/.backups/dsh-upgrade-20260910_185827/dsh-better-sidebar-stash.patch`
- **上游仓库**：<https://github.com/omdsh-dev/DSH-better-sidebar>
- **如需重新启用**：
  ```bash
  cd ~/Workspace/deepseek-harness
  pnpm dsh plugin --profile web add dsh-better-sidebar@latest
  ```

---

### 2. dsh-lab-kit · 科研台 Lab Cockpit

- **原功能定位**：侧边栏「研究台」视图，自动扫描工作区目录（识别 `.git` 与 `.summary.md`），按最近修改时间排序聚合展示活跃研究项目，host 端经 `/lab-kit/projects` 提供数据支持。
- **退役时间**：2026-09-10
- **退役原因**：此插件此前已长期处于 disabled 状态（不在 `dsh.profile.bundles`、不在注入器 registry），无实际运行挂载。现已由更专业的 `dsh-research-core`、`dsh-science-map` 以及官方原生侧边栏「外部目录」（`dsh-external-dirs`）承接相关工作流。
- **历史保全位置**：
  - 源码打包备份：`~/Workspace/.backups/dsh-plugin-removal-20260910_2130/dsh-lab-kit-src.tgz`
- **上游情况**：无上游，为早期本地试验性实现。

---

### 3. dsh-conversation-share · 对话长图分享

- **原功能定位**：在对话流中交互式选取一段对话范围（支持自由拖拽与磁吸对齐），渲染并导出带品牌水印的高清 PNG 长图。
- **退役时间**：2026-09-10
- **退役原因**：原上游 `@bill9109/dsh-conversation-share` 所属的 npm scope 已失效下线（返回 404 无法拉取），且该插件在日常科研与开发流中极少使用，故清理源码目录、submodule 登记与 `.git/modules` 存储。
- **历史保全位置**：
  - 备份目录：`~/Workspace/.backups/dsh-plugin-removal-20260910_2130/`
  - 备份制品：`dsh-conversation-share-src.tgz`、`dsh-conversation-share-history.bundle`、`dsh-conversation-share-uncommitted.patch`
- **重新安装（若需使用）**：
  必须使用社区新的无 scope 维护版本：
  ```bash
  cd ~/Workspace/deepseek-harness
  pnpm dsh plugin --profile web add dsh-conversation-share@0.1.5
  ```

---

### 4. dsh-agent-teams · 多 Agent 协作（NanmiCoder 版）

- **原功能定位**：基于社区实现（NanmiCoder）的 Agent 多团队分工协同插件，提供独立团队 inbox 与报告归档机制。
- **退役时间**：2026-09-08
- **退役原因**：由于插件体积过大（快照包含 11,916 个文件 / 211 MB），且未在实际 loader 中挂载运行，同时与 DSH 新架构存在一定兼容性维护成本。清理后消除了对 profile junction 的多余依赖。
- **上游仓库**：<https://github.com/NanmiCoder/dsh-agent-teams>
- **重新安装**：
  ```bash
  git clone https://github.com/NanmiCoder/dsh-agent-teams.git third-party/dsh-agent-teams
  cd ~/Workspace/deepseek-harness
  pnpm dsh plugin --profile web add @nanmicoder/dsh-agent-teams
  ```

---

### 5. dsh-vision-toolkit · 视觉多模态工具箱

- **原功能定位**：提供独立 OCR、图像裁剪、识图、像素比对（pixel-diff）工具集，底层依赖托管下载的独立 Python runtime。
- **退役时间**：2026-09-08
- **退役原因**：新代多模态大语言模型（如 DeepSeek-VL、Gemini 等）原生具备出色的图像理解与代码提取能力；且该插件自身携带庞大的 Python 运行环境缓存（`~/.dsh/cache/dsh-vision-toolkit/` 达 159 MB），维护成本高，因此全面由原生多模态视觉方案替代。
- **历史保全位置**：
  - 临时快照：`/tmp/vt-deletion-snapshot/`
- **上游仓库**：<https://github.com/Anionex/dsh-vision-toolkit>

---

### 6. dsh-plugin-manager · 早期插件管理器

- **原功能定位**：早期基于 web profile patch 的 DSH 插件列表与开关控制面板。
- **退役原因**：已被功能更完备、具备免重启热装配、热重载、自愈与自检能力的 `dsh-super-injector`（超级模组注入器）完全取代。

# dsh-synapse 生态准入与社区推广材料套件

本文档汇总了 `dsh-synapse` 申请接入 **dsh-TUI 官方生态**、**dsh-ecosystem-spec 准入清单** 及各社区渠道的准备材料与 PR 模版。

---

## 1. 提交至 `T-Auto/dsh-ecosystem-spec` 准入清单

* **仓库链接**：[https://github.com/T-Auto/dsh-ecosystem-spec](https://github.com/T-Auto/dsh-ecosystem-spec)
* **提交类型**：Issue (Plugin Admission) 或 PR (添加插件描述至 registry/市场)

### 📋 准入申请模板

```markdown
### Plugin Admission Request: dsh-synapse

**Plugin Identity:**
- **Name:** dsh-synapse
- **ID:** `com.suxeca.dsh-synapse`
- **Version:** `0.3.0`
- **Repository:** https://github.com/Suxeca/dsh-synapse
- **License:** MIT
- **Category:** Visualization / Workspace Management

**Spec Compliance:**
- **Baseline:** Community Draft v0.15 (`dsh-std`)
- **Manifest:** [dsh-plugin.json](https://github.com/Suxeca/dsh-synapse/blob/main/dsh-plugin.json)
- **Facets:** `facets.host` (apiVersion: `v1alpha1`, entry: `index.js`)
- **Contracts Required:** `commands.dsh/v1alpha1#Command` (optional, with fallback)
- **Soft Detection (#183):** Implemented for `webServer`, `sessions`, and `tuiStatus` (graceful no-op in non-web/headless environments).

**Verification & Conformance Evidence:**
- Conformance validator output:
  ```json
  {"manifest":"dsh-plugin.json","host":"registry/host-descriptor.tui.example.json","valid":true,"decision":"compatible","missingOptional":[]}
  ```
- Unit tests: 73/73 passed (including plugin lifecycle, soft-probe degradation, and SSE cleanup tests).

**Description:**
A visual, non-linear conversation workspace plugin for DeepSeek Harness. Turns related sessions, follow-ups, and forks into an explorable conversation canvas with multi-device map synchronization and TUI status companion support.
```

---

## 2. 提交至 `ccch1mneyyy/dsh-TUI` 友情链接 PR

* **仓库链接**：[https://github.com/ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)
* **目标文件**：`docs/links.md`

### 📋 PR 标题与改动

* **PR Title**: `docs: add dsh-synapse to community links`
* **PR Body**:
```markdown
Add [dsh-synapse](https://github.com/Suxeca/dsh-synapse) (Conversation Canvas & Session Map Plugin) to `docs/links.md`.

`dsh-synapse` has been upgraded to comply with `dsh-std v0.15` and `dsh-ecosystem-spec`, featuring seamless TUI status seam (`tuiStatus`) support and multi-device real-time sync.
```

* **`docs/links.md` 改动行**：
```markdown
| [dsh-synapse](https://github.com/Suxeca/dsh-synapse) | 可视化非线性会话地图：将 DSH 会话、追问与分支组织为交互画布，支持跨设备同步与 TUI 伴随协同 |
```

---

## 3. `dshfind` 插件市场收录

1. 访问 [https://dshfind.com](https://dshfind.com)；
2. 提交 GitHub 仓库地址：`https://github.com/Suxeca/dsh-synapse`；
3. 在 README 顶部嵌入动态展示卡片：
   ```markdown
   [![dshfind](https://dshfind.com/api/card/Suxeca/dsh-synapse?lang=zh)](https://dshfind.com/Suxeca/dsh-synapse)
   ```

---

## 4. 社区群与公众号分享文案

### 💬 社区推介文案（微信群 / QQ 群 / 论坛）

```text
🎉 【DSH 插件推荐】会话地图插件 dsh-synapse v0.3.0 现已全面升级！

做复杂科研或代码重构时，追问多轮后经常迷失在漫长会话流里？
dsh-synapse 将同一工作区内的对话、追问和分支实时投影为一张「非线性对话地图」：

🗺️ 【功能亮点】：
1. 🌿 分支清晰可见：基于 DSH 原生 fork 机制，自动按分叉点连线拓扑图；
2. ✨ 画布直发新对话：在任意空白处起草，直接开启新主题；
3. 📚 地图书架管理：支持多命名地图，为不同项目管理独立画布；
4. ⚡ 双端伴随协同：在 dsh-TUI 终端极速打字，在副屏浏览器看全局地图实时推流更新；
5. 🛡️ 遵循生态规范：100% 遵从 dsh-std v0.15 规范与 #183 软探测纪律，绝不拖垮宿主启动。

🔗 体验与安装：
dsh plugin --profile web add github:Suxeca/dsh-synapse
开源仓库：https://github.com/Suxeca/dsh-synapse
欢迎大家体验并提出宝贵意见 🐋
```

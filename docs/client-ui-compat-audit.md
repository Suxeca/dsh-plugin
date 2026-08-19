# Client 侧 UI 兼容性审计（dsh-plugin 生态）

- 审计人：client-auditor（team plugin-compat-review，task t2）
- 日期：2026-08-19
- 范围：侧边栏 Tab / 设置页 / 快捷键 / 命令 / UI slot / 样式，共 13 个已装配插件的 client half
- 基线：deepseek-harness（本机 checkout）当前 web 运行时，ui-slots rc.6+ API

## 0. 审计对象（client half 清单）

| 插件 | client UI 面 | 结论 |
|---|---|---|
| dsh-lab-kit | 侧边栏 DOM 注入 + 中列 cockpit（React root） | ✅ 兼容（DOM seam） |
| dsh-client-ui-session-switcher | 全局快捷键 + 会话切换 palette | ✅ 兼容 |
| dsh-vision-toolkit | tool.call.toolview ×9、settings.section、paste dock、样式注入 | ✅ 兼容 |
| dsh-plugin-manager | settings.section（插件管理）、/plugin 命令 | ✅ 兼容 |
| dsh-custom-thinking | settings.section（思考强度） | ✅ 兼容 |
| dsh-better-sidebar | 右工作台 portal、turnTail 拦截、settings.section、IME 守卫、layout.css | ✅ 兼容（脆弱点见 R3） |
| dsh-conversation-share | 会话头分享按钮 + 范围标记 + 截图 modal | ✅ 兼容（DOM seam） |
| dsh-agent-teams | conversation.chat.node key=agent-teams + 右上角 floater | ✅ 兼容 |
| dsh-super-injector | settings.section（插件管理页） | ❌ **不兼容（R1）** |
| dsh-smooth-stream | conversation.chat.node 全量包装 + settings.plugin.item | ⚠️ 侵入式（R2） |
| dsh-secure-context-polyfill | 无 UI（Web API polyfill） | ✅ |
| sage-mem | host-only，无 client | ✅ |
| dsh-custom-thinking host API /custom-thinking/state | 已探活 ✓ | ✅ |

## 1. 兼容性矩阵

### 1.1 设置页 settings.section（list 槽）

内置：general(0) / models(10) / plugins(15) / agent-presets(20)。
外部注册（id / order 全部唯一，无冲突）：

| registrant | id | order | label | API 形态 |
|---|---|---|---|---|
| dsh-custom-thinking | custom-thinking | 12 | 思考强度 | 现代双参 register ✓ |
| dsh-vision-toolkit | vision-toolkit | 30 | Vision | 现代双参 ✓ |
| dsh-plugin-manager | plugin-manager | 40 | 插件管理 | 现代双参 ✓（slots 经 ctx.get 惰性解析，缺服务时降级） |
| dsh-super-injector | super-injector-plugins | 50 | **插件** | ❌ 单参 legacy register({component}) |
| dsh-better-sidebar | better-sidebar | 100 | 侧边卡片 | 现代双参 ✓ |

**R1（高）super-injector 设置页在当前 slots 运行时无法渲染。**
`ctx.slots.register({name, id, order, label, component: () => ({render(){...}})})` 只传一个参数；当前
`SlotCore.register(options, component)` 不读取 `options.component`，entry.component 为 undefined →
渲染期 `React.createElement(undefined)` 抛错 → scoped-slots 边界捕获并 abdicate 该 entry →
设置面板显示错误条而非插件管理 UI（导航行「插件」仍在，因为 label 单独解析）。整个 harness 无 legacy
适配层（api-catalog / runtime slots.ts 均确认）。修复：改为双参 `register(opts, Component)`，或
`inject` + 现代组件形态。

**R4（低）设置页导航重名**：ui-settings-plugins 内置「插件」与 super-injector 的「插件」label 重复（zh），
导航出现两个同名入口，UX 混淆（不崩溃）。

### 1.2 UI slot 占用核对（无 id/key 冲突）

- `conversation.chat.node`（keyed）：内置 tool-call / workflow-run / command-input；外部 agent-teams(key=agent-teams)；
  smooth-stream 以 priority -100 影子注册 assistant-step（合法 shadowing，与内置 0 级不冲突）。✓
- `tool.call.toolview`（keyed）：内置 grep/glob/skill/todo_write/ask_user_question/edit/write/read/bash/
  web_search/web_fetch/cordis_define；外部 vision_ground/vision_detect/vision_trace/vision_pixel_diff/
  vision_crop/vision_long_screenshot_ocr/vision_extract_foreground/vision_html_screenshot/vision_dominant_colors。✓ 零重叠
- `conversation.input.dock`（list）：内置 queue / todo；外部 vision-toolkit-pasted-images(order 6)。✓
- `settings.plugin.item`：smooth-stream id=smooth-stream(order 30)。✓
- 单占用槽（sidebar.workspaces / sidebar.settings / conversation / conversation.view / settings.trigger 等）外部插件
  全部未触碰，改用 DOM seam —— 符合当前「声明即占用」模型。✓

### 1.3 快捷键（全局键盘）

- session-switcher 是唯一全局 chord 持有者（window capture）：Ctrl+K（toggle，可重绑）、Alt+K（固定兜底）、
  Ctrl+] / Ctrl+[（切换会话）、Ctrl+B（左栏）、Ctrl+Shift+B（右工作台）、Ctrl+J（底栏）、Alt+Shift+L/R（全屏）、Esc（退全屏）。
  - 与 DSH 内核无冲突：壳层无 Ctrl+K/Alt+K/Ctrl+B 全局绑定（仅 composer 内 Enter/Esc/Ctrl+Z/Ctrl+Y、
    Modal/Menu/ImageLightbox 的 Esc，均 bubble 阶段且目标限定）。
  - 与 better-sidebar 通过服务调用协作（togglePanel/toggleFullscreen/toggleBottomTerminal 均有
    typeof 能力守卫 + 缺服务 console.warn 降级）✓
  - IME：session-switcher 自带 isComposing/keyCode229 检查（window capture 先于 better-sidebar 的
    document capture 守卫），双保险无冲突 ✓
- 风险点（低）：DSH 无「快捷键仲裁注册表」，未来若有插件再绑 Ctrl+K 会双触发；当前生态无此冲突。

### 1.4 命令

- 仅 plugin-manager 注册 `/plugin` human 命令（host 侧 ctx.get('commands') 可选注入，缺服务跳过）。
  名称无重复（commands.register 对重名抛错，当前可加载说明无冲突）。✓

### 1.5 DOM seam（侧边栏/对话区）

- lab-kit：`[data-slot="sidebar"]` firstElementChild + 「New Session」按钮后插行，MutationObserver 自愈；
  中列 `[class*="centerCol"]` 追加容器 + `html[data-dsh-labkit-active]` 隐藏对话子树。CSS 全部插件自有
  data-attr 作用域，不泄漏 ✓（脆弱点：selector 依赖 css-module 后缀，见 R6）
- conversation-share：会话头 utilities 行首插分享按钮（自愈），标记 overlay 覆盖对话流。✓
- agent-teams：body portal 右上角 floater（z-index 未声明，默认 stacking）。
- better-sidebar：body portal 右工作台（z-index 50-60）+ layout.css 全局推挤 `#root` margin。
- session-switcher：body portal palette（z-index 998/1000/2147483000，高于工作台 50-60）✓

**R3（中）better-sidebar layout.css 结构选择器脆弱**：`#root > div[data-slot="root"] > div > div:nth-child(2)`
硬编码 AppFrame 三层结构（sidebarCol/centerCol/detailsCol 的第 2 子项）。web 壳结构一改即静默失效
（面板从「推挤布局」退化为「悬浮覆盖」）。已有 body[data-dsh-sidebar-collapsed] 属性替代方案，建议扩展。

**R5（低）右上角视觉重叠**：agent-teams floater 与 better-sidebar 折叠态 toggle cluster 同处右上角；
lab-kit cockpit 打开时隐藏对话子树，better-sidebar 的 `[data-slot="conversation"]` 几何探测读到 0 尺寸，
面板几何可能短暂错位。均为视觉级，无功能破坏。

### 1.6 样式 / CSS 变量命名空间

- 当前内核 token：`--dsw-alias-*`（design-platform.css，158 个）+ `--dsw-font-*` + `--ds-*`。
  web 壳 base.css `@import` design-platform.css —— 运行期必然存在 ✓
- vision-toolkit / better-sidebar / lab-kit / smooth-stream：全部使用当前 `--dsw-alias-*` 命名空间 ✓
  （vision-toolkit 的 var() **无 fallback** —— 若 design-platform.css 改名/移除则整页样式静默丢失，R6）
- super-injector：legacy `--theme-*` 但**全部带硬编码 fallback** ✓（旧命名空间已不存在，靠 fallback 存活）
- conversation-share：运行时 getComputedStyle 读 token + fallback ✓（build 无关，最稳）
- session-switcher：自包含 `--sw-*` ✓

## 2. 重点风险清单（合并定级建议）

| # | 级别 | 风险 | 涉及插件 | 建议 |
|---|---|---|---|---|
| R1 | **高** | settings.section 单参 legacy register，设置页渲染即崩（错误条），导航残留 | dsh-super-injector | 改现代双参 register + 函数组件 |
| R2 | **中** | 直接改写他人 entry.component（conversation.chat.node 全量包装），非声明 API；HMR 重载后重复包装叠加（WeakSet 每次激活新建）；与 agent-teams 卡片/未来渲染器变更耦合 | dsh-smooth-stream | 建议改为「chain/list 槽」或包装渲染层（如 conversation.view 链），避免改他人 entry |
| R3 | 中 | layout.css 硬编码 AppFrame 结构选择器，壳结构变更即静默失效 | dsh-better-sidebar | 用 data 属性/槽位替代 nth-child 路径 |
| R4 | 低 | 设置页导航重名「插件」×2 | super-injector / ui-settings-plugins | super-injector 改 label 或并入 plugins tab |
| R5 | 低 | 右上角 floater 与折叠 toggle cluster 视觉重叠；cockpit 打开时对话区探测 0 尺寸 | agent-teams / better-sidebar / lab-kit | 显式 z-index 分层 + 尺寸探测回退 |
| R6 | 低 | 无 fallback 的 --dsw-alias-* 依赖 + css-module 后缀 selector 依赖 | vision-toolkit / lab-kit | 关键样式加 fallback；selector 优先 data-slot seam |
| R7 | 信息 | 4 个插件在 body 挂 MutationObserver（lab-kit×2、conversation-share×1）+ 多 body portal；观测树全量 subtree，大 DOM 下有小性能开销 | lab-kit / conversation-share | 可接受；建议 observer 挂到目标子树 |

## 3. 结论

- 除 R1（super-injector 设置页）外，当前生态 client 侧**无崩溃级兼容问题**：所有 slots 注册 id/key 唯一、
  无同优先级抢占；快捷键、命令、样式命名空间均无冲突；多数插件采用「现代双参 register + slots.inject 等声明」
  与「DOM seam + 自愈 MutationObserver」两条正确路径。
- 生态共性风险：单占用槽迫使外部插件走 DOM 注入（lab-kit / conversation-share / agent-teams / better-sidebar
  都如此），互相之间仅视觉重叠，无功能冲突；smooth-stream 的 entry 篡改是唯一违反 slot 所有权模型的用例。

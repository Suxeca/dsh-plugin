# DSH Expression Mode · 会话语言与表达开关

v0.2.0 将**语言**与**简明风格**分开。会话可以固定中文、固定 English，或跟随原有语言策略；简明表达（STE-inspired）独立开启/关闭。日常对话可以直接看中文，不必进入科研式回答模板。

默认：语言跟随原有策略，简明风格关闭。只调整模型自己的解释文字，不改笔记、冻结公式、模型、计算参数或工具权限。不声称严格 ASD-STE100 合规或认证。

## 使用

刷新现有 DSH 页面，输入框上方会显示两个独立控件：

- **语言**：跟随原有策略 / 中文 / English。
- **简明表达 · STE-inspired**：开 / 关，适用于选定的语言。

| 目的 | 命令 |
|---|---|
| 固定当前会话为中文，保留当前风格 | `/expression zh` |
| 固定为 English，保留当前风格 | `/expression en` |
| 取消固定语言，保留当前风格 | `/expression auto` |
| 开启简明表达，保留语言 | `/expression style ste` |
| 关闭简明表达，保留语言 | `/expression style default` |
| 查看真实保存状态 | `/expression status` |
| 兼容旧捷径：English + 简明表达 | `/expression ste` |
| 重置语言与风格到原有策略 | `/expression default` |

也支持 `/expression lang zh|en|auto`。`/ste-explain` + 当前问题仍是**单次任务的简明英语**入口，不修改持久语言或风格。

普通中文聊天：选“中文”，简明表达关。中文简明解释：选“中文”，简明表达开。英语科研解释：选“English”，按需开启简明表达。

设置按会话保存，不影响其他会话。命令直接处理，不依靠模型推断切换意图。切换在下一次模型步骤生效，不重写已发出的请求或历史回答。明确要求其它语言的具体交付优先于会话默认，完成该交付后继续会话设置。

## 规范与迁移

- `rules/ste-research.md`：唯一的语言中立表达规范源；插件启动/热载读取并计算内容版本。中文借用清晰表达原则，不冒称受控英语认证。科研护栏仅在任务涉及相应科学对象时适用，普通聊天不强加科研模板。
- `skills/ste-explain/SKILL.md`：可移植的单次英语任务入口。运行时注册的 skill 已展开同一份完整规范，仅供用户显式调用。
- `${DSH_HOME:-~/.dsh}/expression-mode/sessions.json`：按会话保存语言、风格、修订号和时间，不保存科研正文或凭据。原子写入、权限 0600；语言/风格 patch 在同一写入队列内合并，未指定的维度保持不变。
- 兼容 v1：原 `ste` 映射为 `language=en, mode=ste`；原 `default` 映射为 `language=auto, mode=default`。只读加载不写文件；首次修改后保存为 v2。不清空旧选择，不自动把全部会话改成中文。
- 损坏或保存失败明确报错，不假装切换成功。v0.1 客户端不认识新增语言字段，升级后应刷新页面。v2 状态文件不能直接交给 v0.1 插件读取。

通过官方 `agent/pre-step` 可等待入口写入有来源的当前语言/风格快照。设置变化、规范变化或快照被压缩隐藏后会重新提供；语言或简明风格有显式选择时，新的人类问题得到提醒，工具续步不重复追加。恢复原有策略会明确作废旧的持续要求，但不取消当前任务显式调用的 skill。真人问题及其它插件消息原样保留。

设置状态、指令投递与模型实际遵循是三个不同层次。此插件不是输出后处理器，不能承诺模型百分之百遵循，仍需真实使用验证。

## UI 与安全

GUI 使用官方 `conversation.input.dock` 加法注册，不替换输入框。命令与 GUI 共用一个 Host store。只有 Host 确认才更新显示；保存中禁用两个控件，错误可见且可重试；过期响应不会写到另一会话。

`GET/POST /expression-mode/api/state` 先经过 DSH connection 认证和 Host/Origin 信任检查，服务缺失则拒绝。POST 接受 sessionId 与 mode/language 的非空部分更新；严格拒绝任意路径及额外字段，检查会话存在，限制 JSON 大小。

停止插件移除命令、路由、skill、UI，并向持有活动语言/风格快照的活跃会话发撤销通知。持久偏好保留以支持重启/热载；不删除历史消息。卸载后应通过新会话或确认撤销通知避免冷会话中旧指令残留。

## 构建与测试

```sh
npm run test
npm run build
```

客户端复用仓库 `shared/tsdown.client.ts`，遵循 DSH ModuleLoader factory 协议。本工作区构建复用已安装的 note-board SDK 依赖；独立开发可安装 package.json 中的 devDependencies。bundle 已持久安装到 web profile，版本更新通过超级模组注入器热载，无需重启现有 GUI。

没有运行 `dev:web` 时不承诺源码自动重编译；更新完成后刷新已有 DSH 页面。

## 参考

- [Karpathy 原推文](https://x.com/karpathy/status/2105819303471976479)
- [ASD-STE100 FAQ](https://asd-ste100.org/STE_faq.html)

本插件独立实现，不代表 Karpathy、ASD 或 STEMG 的认可。

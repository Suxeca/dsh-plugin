# @dsh-external/dsh-custom-thinking

自定义提供商思考强度（Thinking Effort for Custom Providers）。

## 解决的问题

DSH 编曲器（对话输入框）的模型选择器只有在模型带 `reasoning` 元数据时才显示
「思考强度」下拉。手写自定义提供商（pi-ai 路由，OpenAI 兼容网关等）的模型默认
**没有**该元数据，因此无法选择思考强度——官方设置页刻意不为 provider 级提供思考
控件（思考是 per-MODEL 能力）。

根因在 `llm-pi-ai` 适配器：只有模型的 `reasoningEfforts`（可选思考档 + wire 拼写）
被声明时，适配器才暴露 reasoning 元数据。本插件为这条原生配置通道提供 UI：
在设置面板新增「思考强度」区块，为自定义提供商的每个模型声明思考等级。

保存后**原生生效**（无需改动官方 UI 或适配器）：

- 编曲器模型选择器为该模型显示「思考强度」下拉（提供方默认 / 关闭 / 各档）；
- 请求按各档 wire 值发送（OpenAI 兼容网关通常为 `reasoning_effort` 的
  low / medium / high；`off` 不发送参数）；
- 配置写入 `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.<route>.models[].reasoningEfforts`，
  重启后保留；写入经 llm-pi-ai 的 schema 与 `assertServiceable` 校验，非法即拒。

## 使用

1. 打开 DSH Web GUI → 设置 → **思考强度**。
2. 对自定义提供商：
   - 「为全部模型启用标准思考（低/中/高）」一键开启；「全部禁用」一键关闭；
   - 每个模型可单独勾选等级并编辑 wire 值，保存本模型；
   - 「路由默认思考等级」设置默认档；
   - （仅 openai-completions 协议）「强制请求携带 reasoning_effort」高级开关。
3. 回到对话，点开模型选择器 → 该模型现在有「思考强度」菜单。

## 构建与注入

```bash
bash scripts/build.sh        # host tsc（依赖从 dsh-plugin 工作区 store 链接）
npm run build:client         # tsdown → lib/client.js
# 注入器环境内：dev_build_plugin → dev_inject_plugin <本目录>（或 dev_reload_package 热重载）
```

## 结构

- `src/index.ts` / `src/host/` — host 半：`/custom-thinking` JSON API
  （GET state 读取 + POST apply 写入 settings path ops，浏览器信任围栏保护）。
- `src/client/` — client 半：`settings.section`「思考强度」区块。
- `src/shared/types.ts` — host/client 共享 DTO（各自内联）。

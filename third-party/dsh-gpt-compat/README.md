# dsh-gpt-compat

[English](README.en.md) | 中文

[![CI](https://github.com/YaoaY/dsh-gpt-compat/actions/workflows/ci.yml/badge.svg)](https://github.com/YaoaY/dsh-gpt-compat/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-gpt-compat.svg)](https://www.npmjs.com/package/dsh-gpt-compat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

面向 DeepSeek Harness 的 GPT/Codex 沙箱提权参数兼容插件。

部分模型会在普通写操作中习惯性附带：

```json
{
  "sandbox_permissions": "workspace-write",
  "justification": "not used"
}
```

DSH 将这两个字段定义为沙箱拒绝后的单次提权重试。同级或更窄的请求会在工具执行前被拒绝。本插件只在能够证明请求冗余时删除这两个字段，让工具按当前会话策略执行。

## 使用效果

<table>
  <thead>
    <tr>
      <th>使用前：冗余参数导致工具调用反复失败</th>
      <th>使用后：工具按当前沙箱策略正常执行</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="./A3.png" alt="使用插件前，工具调用因冗余沙箱提权参数反复失败" /></td>
      <td><img src="./B3.png" alt="使用插件后，工具调用按当前沙箱策略正常执行" /></td>
    </tr>
  </tbody>
</table>

## 安全边界

插件采用 fail-closed 规则：

- 只处理 `providers` 和 `tools` 同时允许的调用。
- 注册工具的 schema 必须同时声明 DSH 的 `sandbox_permissions` 枚举和 `justification` 字段。
- 只删除完整或可证明冗余的请求：已知目标模式且不严格扩权时，即使理由为空、缺失或格式异常，也只会删除这两个提权字段；
- 真正扩权的请求必须带非空理由并保持不变，继续进入 DSH 原生审批流程。
- 孤立字段、空理由的扩权请求、未知模式、策略解析失败保持不变，由 DSH 核心验证或拒绝。
- 当前请求 provider 取自 session request header，无法取得时才回退到 agent 初始 provider。

该边界避免插件仅凭参数名修改 MCP 或第三方工具。配置 `tools` 时仍应只列出实现 DSH 原生提权契约的工具。

## 兼容性

- Node.js 20 或更高版本
- `@deepseek-ai/cordis` 4.x
- `@deepseek-ai/dsh-tools` 0.1.0-rc.7 或兼容版本
- `@deepseek-ai/dsh-sandbox-policy` 0.1.0-rc.7 或兼容版本

## 安装

将插件安装到目标 DSH profile：

```bash
dsh plugin --profile web add dsh-gpt-compat
```

这个包声明了 `dsh.bundle.patch`，DSH 会在安装后把它加入 profile 的 bundle 列表。本地开发可从插件目录执行：

```bash
dsh plugin --profile web add .
```

## 配置

默认 bundle 配置：

```yaml
providers: ["*"]
tools: ["bash", "pwsh", "write", "edit"]
```

| 字段        | 类型       | 默认值                              | 含义                                                                   |
| ----------- | ---------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `providers` | `string[]` | `[]`                                | 允许处理的 provider id。空数组停用插件；显式 `'*'` 表示所有 provider。 |
| `tools`     | `string[]` | `['bash', 'pwsh', 'write', 'edit']` | 允许处理的 DSH 原生提权工具名。空数组停用插件。                        |

通过 profile 或 home 级 `cordis.patch.yml` 覆盖时，需要重述完整配置：

```yaml
- id: gpt-compat
  config:
    providers: ["your-gpt-provider"]
    tools: ["bash", "write", "edit"]
```

## API

主入口导出 Cordis 插件的 `name`、`inject`、`Config`、`apply`，以及以下纯函数和类型：

- `resolveConfig()`：标准化直接调用者提供的部分配置。
- `classifyEscalation()`：返回 `none`、`strip` 或带原因的 `preserve` 决策。
- `SANDBOX_MODES`、`ESCALATION_TARGETS`：只读模式词汇。
- `Config`、`SandboxMode`、`EscalationTarget`：TypeScript 类型。

纯决策层也可从 `dsh-gpt-compat/escalation-guard` 导入。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm pack:check
```

`pnpm run check` 依次检查格式、lint、类型、覆盖率、发布结构、声明文件，并在空白临时项目中安装和导入真实 tarball。CI 在 Node.js 20 与 22 上运行同一套门禁。

## 故障排查

- 日志显示 `inactive`：`providers` 或 `tools` 为空。
- 参数没有被删除：检查当前 session route 的 provider、工具名以及注册 schema 是否声明完整提权字段。
- 畸形扩权请求仍然失败：这是预期行为；插件不会将缺少非空理由的扩权请求降级为普通调用。
- 普通调用仍失败：检查当前请求的 `sandbox_permissions` 是否是已知模式且不严格宽于当前会话策略；这类冗余字段会被插件删除。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

# AGENTS.md

本仓库的通用 agent 指令，适用于 DSH、Codex、opencode 等一切在此工作的 agent。

## 长期记忆纪律

本工作区（`~/Workspace/`）维护一套本地记忆体系，位于 `../.agent-memory/`（主账本）与 `../.agent-platform/`（工具与策略）：

1. `../.agent-memory/canonical/` 是已批准长期记忆的**唯一主账本，只读**。
2. agent 不得直接修改 canonical；发现值得沉淀的稳定事实、工作流规则、失败教训时，将候选记忆写入 `../.agent-memory/staging/`（用 `../.agent-platform/cli/agent_memory.py propose`），由人工 validate/approve 后进入 canonical。
3. 没有明确可复用价值的内容不要写入记忆。

## 安全规则

- 禁止在记忆、日志、导出文件中写入完整 key/secret/token/password；一律使用 `env:NAME`、`vault:path` 或 `secret_ref:name` 引用。
- 开始修改代码前，先确认 `../.agent-memory/canonical/` 中相关的 project_constraint、workflow_rule、failure_lesson。

## 参考策略

- 记忆策略：`../.agent-platform/policies/memory_policy.md`
- 密钥策略：`../.agent-platform/policies/secret_policy.md`

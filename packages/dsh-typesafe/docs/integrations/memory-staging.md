# 集成：记忆候选的 advisory 预筛（不用插件形态）

本文件说明如何把 TypeSafe 语义判断接到**本地记忆体系**的候选写入路径上：
在候选记忆进入 staging 之前给出一条带概率的标注。结论先行：

- 它**不是** DSH 插件，也不应该是；
- 它**只作标注**，不参与候选的保留与晋升决策；
- 判断失败或超时**绝不阻塞**候选写入。

相关事实来源：`~/Workspace/.agent-platform/cli/agent_memory.py` 与
`~/Workspace/.agent-platform/policies/memory_policy.md`。

## 1. 为什么不能做成 DSH 插件

**写入者不是 DSH 一个进程。** 记忆账本的候选写入者是多个异构入口：
Claude Code 会话、opencode / Cline 等入口，以及人工操作，它们都通过
`agent_memory.py` 的 CLI 写 staging。策略文件明确说明 `.agent-platform/generated/`
下的派生视图是供 opencode / Cline / Claude Code 等入口读取的
（`memory_policy.md` 第 11 行）。DSH 插件只在一个 DSH 进程里存在：把它做成插件，
预筛就只对从 DSH 出发的那条写入路径生效，其余入口静默绕过——
同一个账本会因为入口不同而得到不同待遇，这比没有预筛更糟。

**策略禁止自动晋升。** 策略规定 agent 默认只能写 staging、不能静默写 canonical
（`memory_policy.md` 第 15 行）；进入 canonical 需要满足一组条件
（含 `review_status` 由 `proposed` 改为 `approved`，第 17–24 行），
并由人工或高权限 agent 再执行 `validate` 与 `approve`（第 77 行）。
把语义判断做成插件式门禁，等于把一个**概率判断**塞进了写入路径的关键位置，
很容易演化成「不予写入 / 自动裁定」——那就是静默的自动晋升或静默丢弃，
正是策略要禁止的动作。

**生命周期与依赖面也不匹配。** 插件跟随 DSH 重启与热重载，而记忆写入是长期账本操作，
不该被 GUI 重启影响；CLI 侧保持零第三方依赖（`agent_memory.py` 为纯标准库实现），
引入 TS 插件形态反而会给写入路径加上编译期依赖。

反过来，DSH 侧本来就把 HTTP 当作宿主外工具的通道：`/typesafe` 前缀路由的存在理由
之一就是「`agent_memory.py` 这类宿主外工具按需调用」（见 `src/host/routes.ts`
模块注释）。所以正确的形态是**宿主外工具主动调用 HTTP 接口**，而不是插件内嵌。

## 2. 接缝在哪

在 `agent_memory.py` 的 propose 路径上，具体位置是 `cmd_propose()` 里
**构造完 item、调用 `validate_item(item, canonical=False)` 之前**
（该调用在第 352 行；staging 落盘在 `unique_path(memory_dir(root) / "staging" / ...)`
之后，第 386 行）。

也就是：

```
cmd_propose(args)
  ├─ 组装 item（id / type / content / review_status='proposed' …）
  │   ← ★ 接缝：在这里发一次 advisory 判断，拿到标注
  ├─ errors, warnings = validate_item(item, canonical=False)
  ├─ errors 非空 → 记 audit 并退出（与预筛无关，保持原判定）
  └─ 写入 staging，audit_event(...)
```

约束：

1. 预筛**必须**发生在 `validate_item` 之前只是为了避免多做无用功
   （注定不合规的候选不必花钱判断）；它**不改变** `validate_item` 的结果。
2. 结果写入 `audit_event(root, 'propose', item_id, status, details={...})` 的
   `details`，或写成候选对象上的 `advisory` 字段。
3. **不改**任何决策字段：`review_status` 仍是 `proposed`，绝不调用
   `cmd_approve` / `cmd_validate`，也不因标注结果调整 exit code。

## 3. 可直接粘贴的调用

路由是 `GET /typesafe/status`、`POST /typesafe/eval` 等，前缀 `/typesafe`；
所有响应都是统一信封 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`。
`POST /typesafe/eval` 的请求体是 `{ state, questions, model? }`，
成功时 `value` 是 `EvalOutcome`：`{ response: { model, answers, usage }, cached, latencyMs }`。

下面这一组问题表是给「候选记忆」用的具体配置：一个 `choice`（该不该进账本、
属于哪一类）加两个 `noul`（密钥泄漏、可复用性）。

**调用方不携带任何密钥**：`/typesafe` 由 host 侧的 `Keyring` 自己解析
`env:TYPESAFE_API_KEY` 或 DSH credentials 里的同名字段，密钥只出现在 host
发往 TypeSafe 的那一次请求头里。给本路由传 `authorization` 头既没用、也没必要
——host 不读它。

```bash
# 把 state 换成候选记忆的 content 原文；预算 2 秒，失败即放弃
curl -sS --max-time 2 \
  -X POST http://127.0.0.1:3080/typesafe/eval \
  -H 'content-type: application/json' \
  -d '{
    "state": "本项目所有 DSH 插件的构建必须先运行 npm run link:deps，否则 @deepseek-ai/dsh-tools 会解析到仓库根目录那份不完整的副本。",
    "questions": {
      "kind": {
        "type": "choice",
        "instructions": "这条候选记忆属于哪一类？",
        "criteria": {
          "project_constraint": "项目边界、禁止动作或资源约束",
          "workflow_rule": "应当遵守的操作流程或步骤顺序",
          "failure_lesson": "一次失败的原因与后续规避办法",
          "other": "以上都不贴切，或只是一次性上下文"
        }
      },
      "secret_leak": {
        "type": "noul",
        "instructions": "候选内容里是否包含可直接使用的密钥、令牌或口令原文？",
        "criteria": {
          "true": "出现了完整可复制的密钥值或 token 原文",
          "false": "只出现 env:NAME、vault:path、secret_ref:name 这类引用，或完全没有密钥"
        }
      },
      "reusable": {
        "type": "noul",
        "instructions": "这条内容是否具有跨会话可复用价值（而不是一次性上下文）？",
        "criteria": {
          "true": "未来其它会话仍会用到这条事实或规则",
          "false": "只对当下这一次任务有意义"
        }
      }
    }
  }'
```

返回示例（`answers` 的 key 与请求一致）：

```json
{
  "ok": true,
  "value": {
    "cached": false,
    "latencyMs": 412,
    "response": {
      "model": "jev-1.13.0",
      "usage": { "input_tokens": 512, "output_tokens": 96 },
      "answers": {
        "kind": { "type": "choice", "choice": "project_constraint", "probabilities": { "project_constraint": 0.86, "workflow_rule": 0.11, "failure_lesson": 0.02, "other": 0.01 }, "confidence": 0.86 },
        "secret_leak": { "type": "noul", "noul": 0.01 },
        "reusable": { "type": "noul", "noul": 0.93 }
      }
    }
  }
}
```

在 propose 里落成标注（示意，不引入新 API）：

```python
advisory = call_typesafe(content)          # 返回 dict 或 None
if advisory is not None:
    audit_event(root, "propose", item_id, "proposed", {"advisory": advisory})
    item["advisory"] = advisory            # 仅供人工 review 时参考
# 无论 advisory 是 None 还是 dict，下面的流程一字不变：
errors, warnings = validate_item(item, canonical=False)
```

`secret_leak.noul` 偏高时**不要**自动删除候选——按第 4 节处理：
标注「疑似含密钥，需人工确认」，并把内容里的密钥替换成 `env:` / `secret_ref:` 引用后
再交给人工决定。密钥本身永远不写进记忆、日志或导出文件。

## 4. 失败策略：advisory only

1. **失败或超时绝不阻塞候选。** 非 `ok` 信封、HTTP 错误、连接超时、JSON 解析失败、
   答案形状不符——全部当成「没有标注」继续走原流程。建议 `--max-time 2`
   （或等价的 1500–2000ms 预算），与门禁的 fail-open 同口径。
2. **只标注，不丢弃，不晋升。** 标注写进 audit `details` 或候选的 `advisory` 字段；
   `review_status` 保持 `proposed`；绝不自动调用 `validate` / `approve`，
   也绝不因为判断结果为负而跳过 staging 落盘。
3. **不改 exit code、不改 validate 结果。** 预筛与 `validate_item` 是两条独立通道：
   前者是概率建议，后者是确定性规则。
4. **阈值只能用于提示文案。** 例如 `secret_leak.noul >= 0.5` 时在 audit details 里
   标记 `needs_human_check`；`confidence` 偏低时干脆不标注（宁缺勿滥）。
5. **可随时整体关闭。** 预筛是调用方的开关（环境变量或 CLI flag），
   关掉之后 propose 的行为与接入前逐字节一致。

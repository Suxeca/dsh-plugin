# 集成：危险命令语义预审（preflight gate）

门禁挂在 DSH 的 `tools/pre-execute` 扩展点上：在 `bash` 工具真正执行之前，
用一次 TypeSafe `choice` 判断这条命令的「爆炸半径」。它默认关闭，因为它是
**唯一会给每一次 bash 调用加上网络往返**的功能。

## 1. 打开与调参

设置命名空间 `typesafe` 下：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `preflight.enabled` | `false` | 总开关 |
| `preflight.timeoutMs` | `1500` | 门禁预算，超时一律放行 |
| `preflight.minConfidence` | `0.9` | 判为危险所需的最低 confidence |

```bash
curl -sS -X POST http://127.0.0.1:3080/typesafe/settings \
  -H 'content-type: application/json' \
  -d '{"patch":{"preflight":{"enabled":true}}}'
```

## 2. 判定流程

1. `preflight.enabled` 为假 → 直接 `next()`；
2. `exec.name !== 'bash'` → 直接 `next()`；
3. 取 `exec.arguments.command`，空串 → 直接 `next()`；
4. 粗筛 `RISKY_COMMAND`（不匹配就放行，绝大多数命令走这条路径，零成本）：
   `rm`、`mkfs`、`dd`、`truncate`、`shred`、`DROP TABLE`、`DELETE FROM`、
   `git reset --hard`、`git clean -f`、`git push --force` / `-f`、
   `docker rm` / `rmi` / `system prune`、`kubectl delete`、
   `terraform destroy` / `apply -auto-approve`、`chmod -R` / `chown -R`、
   `curl | sh` / `wget | sh`、`sudo`、`mv ... /`、`rsync --delete`、
   `systemctl stop/disable/mask`、`pkill`、`killall`、`kill -9`；
5. 命中粗筛才发起语义判断，三档判据：
   - `safe` —— 只读，或影响范围限于当前工作区的可逆操作（`ls`、`cat`、`git status`…）；
   - `risky` —— 会修改文件 / 远端 / 系统状态，但影响可逆、可控
     （`git reset --hard`、`git clean`、`chmod -R`、`docker rm`、重启服务…）；
   - `destructive` —— 不可逆地销毁数据或整机状态：删除非临时目录、覆写块设备、
     `DROP` / `TRUNCATE` 生产表、`terraform destroy`、强推覆盖远端历史。
6. 只有 `choice === 'destructive'` **且** `confidence >= preflight.minConfidence`
   才返回 `{ kind: 'deny', reason }`；其余（含 `risky` 与低置信度）一律放行。

调用参数固定为 `label: 'preflight:bash'`、`timeoutMs = preflight.timeoutMs`、
`maxRetries: 0`、`cache: false`、`signal: AbortSignal.timeout(budget)`。
`cache: false` 是刻意的：门禁要看当下这条命令的真实判断，不复用历史结论。

## 3. 失败策略：一律放行（fail-open）

判断失败（无密钥、网络错误、超时、应答不合形状）时，门禁记一条 warn 级日志：

```
typesafe preflight: 放行（判断失败）: <脱敏且截断的消息>
```

然后原样 `next()`。理由：门禁是一次概率判断，不是安全边界。把不可用的判断
当成拒绝会让整个 agent 因为一次网络抖动而无法执行任何命令。

## 4. 被拒绝时会发生什么

拒绝的 `reason` 会明确写出：这条命令被按爆炸半径分类为「不可逆破坏」、
置信度与阈值分别是多少、**这是来自 TypeSafe Jev 的概率判断而不是确定性拦截**，
以及两条出路——在设置页关掉预审，或改成影响面更小的写法后重试。
这样模型可以自我修正，而不是陷入无解释的拒绝循环。

## 5. 注意事项

- 粗筛正则只是**性能前置**，不是判据本体；命中粗筛不等于危险，未命中也不等于安全
  （例如自定义脚本里的破坏性逻辑不可能被正则覆盖）。
- `minConfidence` 调低会明显增加误拦，调高则接近失效；`0.9` 是刻意保守的取值。
- 门禁只作用于 `bash`。其它具备破坏力的工具需要在各自的扩展点上单独处理。
- 观测记录里 label 是 `preflight:bash`，可在 `/typesafe/status` 的 `recent`
  与 `totals` 里看到它的调用量与失败率。
- 需要彻底关闭时把 `preflight.enabled` 设为 `false`：监听仍在（常挂），
  但每次调用只读一次设置就放行，不产生网络往返。

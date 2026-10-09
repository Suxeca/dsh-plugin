/**
 * @suxeca/dsh-typesafe — `tools/pre-execute` 语义预审门禁（**默认关闭**）。
 *
 * 与 `@dsh-external/dsh-proxy-guard` 的分工：proxy-guard 是**确定性硬拦截**
 * （正则命中即拒，覆盖代理链路自毁这类不能出错的操作）；这里是**概率语义补充**，
 * 用来兜住正则写不出来的危险——同一个 `rm -rf` 打在临时目录和打在数据集目录上
 * 是完全不同的两件事。
 *
 * 三条自我约束：
 * 1. **默认关**：它挂在每一次 bash 调用前，是唯一会把网络往返引入工具执行路径的功能。
 * 2. **先过便宜的正则预筛**：明显无害的命令（绝大多数）连判都不判，零延迟开销。
 * 3. **fail-open**：超时、网络错、key 没配、confidence 不够——一律放行并记一条日志。
 *    只有「判为不可逆破坏 **且** 置信度 ≥ 阈值」才拒绝。
 *
 * @module @suxeca/dsh-typesafe/host/preflight
 */
import type { EntryType, TypesafeSettings } from '../shared.ts'
import { clampText, redactSecrets } from '../shared.ts'
import type { TypesafeService } from './service.ts'

/** 门禁只需要事件注册面（结构类型）。 */
export interface GateContext {
  on(event: 'tools/pre-execute', handler: (exec: ToolExecutionLike, next: () => Promise<PreToolDecisionLike>) => Promise<PreToolDecisionLike>): () => void
}

/** 事件载荷的最小结构。 */
export interface ToolExecutionLike {
  readonly name: string
  readonly arguments?: unknown
}

/** 决策联合（与 DSH 的 PreToolDecision 同形）。 */
export type PreToolDecisionLike =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'ask'; readonly reason?: string }

/** 装配层注入。 */
export interface PreflightDeps {
  readonly service: TypesafeService
  readonly getSettings: () => TypesafeSettings
  readonly logger?: { warn(message: string): void }
}

/**
 * 便宜的危险信号预筛。
 *
 * 只放那些「可能造成不可逆影响」的命令形状进来：删除、覆盖设备、强推、破坏性基础设施操作。
 * 命中的命令才值得花一次判断；不命中就是零开销。
 */
export const RISKY_COMMAND = /(?:\brm\b|\bmkfs|\bdd\s|\btruncate\b|\bshred\b|\bDROP\s+(?:TABLE|DATABASE)\b|\bDELETE\s+FROM\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|push\s+-f)\b|\b(?:docker|podman)\s+(?:rm|rmi|system\s+prune)\b|\bkubectl\s+delete\b|\bterraform\s+(?:destroy|apply\s+-auto-approve)\b|\b(?:chmod|chown)\s+-R\b|\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b|\bsudo\b|\bmv\b[^\n]*\s\/(?:\s|$)|\brsync\b[^\n]*--delete\b|\b(?:systemctl|service)\s+(?:stop|disable|mask)\b|\bpkill\b|\bkillall\b|\bkill\s+-9\b)/i

/** 判据：把「爆炸半径」讲清楚，而不是让模型猜「危险」是什么意思。 */
const CRITERIA: Readonly<Record<string, EntryType>> = {
  safe: '只读操作，或者影响范围限于当前工作区的可逆操作（例如 ls、cat、git status、只写临时文件）',
  risky: '会修改文件、远程状态或系统状态，但影响是可逆的、可控的（例如 git reset --hard、git clean、chmod -R、docker rm、重启服务）',
  destructive: '不可逆地销毁数据或整机状态：删除非临时目录、覆写块设备、DROP/TRUNCATE 生产表、terraform destroy、强推覆盖远端历史',
}

/** 判断文本：把命令与它的工作目录一起给模型（同一命令换个目录性质就变了）。 */
function instructionsFor(command: string, cwd: string | undefined): string {
  const where = cwd === undefined || cwd === '' ? '（未知目录）' : cwd
  return [
    '下面是一条即将在本机执行的 shell 命令。它的工作目录是 `cwd`。',
    '请按爆炸半径分类：这条命令真的执行下去，最坏情况会不可逆地破坏什么？',
    '只依据命令本身与实际工作目录判断，不要因为命令长、包含 sudo 或看起来专业就升级等级。',
    '',
    'cwd: ' + where,
    '命令：',
    '```sh',
    clampText(command, 1200),
    '```',
  ].join('\n')
}

/**
 * 单次判断的预算信号。
 *
 * 不直接用 `AbortSignal.timeout`：某些运行时/打包形态缺少这个静态工厂，
 * 而这里抛错会被 fail-open 的 catch 吃掉——门禁会**静默变成永不判断**。
 * 缺项时退回 AbortController + 定时器，保证预算一定存在。
 *
 * @param ms - 预算毫秒数。
 * @returns 到点即 abort 的信号。
 */
function budgetSignal(ms: number): AbortSignal {
  const timeout = (AbortSignal as unknown as { timeout?: (milliseconds: number) => AbortSignal }).timeout
  if (typeof timeout === 'function') {
    try {
      return timeout(ms)
    } catch {
      // 落到手工实现（例如毫秒数非法）。
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(new Error('typesafe preflight 预算耗尽')) }, ms)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  return controller.signal
}

/**
 * 挂载门禁。返回的注销器由 `ctx.on` 提供（fiber dispose 即净）。
 *
 * @param ctx - 事件总线上下文。
 * @param deps - 服务、设置读取器与日志。
 * @returns 注销器。
 */
export function registerPreflightGate(ctx: GateContext, deps: PreflightDeps): () => void {
  return ctx.on('tools/pre-execute', async (exec, next) => {
    const settings = deps.getSettings()
    if (!settings.preflight.enabled) return next()
    if (exec.name !== 'bash') return next()
    const args = exec.arguments as { command?: unknown; cwd?: unknown } | undefined
    const command = typeof args?.command === 'string' ? args.command : ''
    if (command === '') return next()
    // 零开销路径：正则没命中就不花一次判断（也意味着默认状态下几乎所有命令不受影响）。
    if (!RISKY_COMMAND.test(command)) return next()
    const cwd = typeof args?.cwd === 'string' ? args.cwd : undefined
    const budget = settings.preflight.timeoutMs
    // ⚠️ 只有「判断本身」被 try 包住，`next()` **绝不能**进 try：
    // 下游 handler 抛错会被 catch 当成「判断失败」再调一次 next()，
    // 于是下游链（审批、其它门禁、执行）跑两遍——一条命令有被执行两次的路径。
    let judged: Awaited<ReturnType<TypesafeService['choice']>>
    try {
      judged = await deps.service.choice(command, instructionsFor(command, cwd), CRITERIA, {
        label: 'preflight:bash',
        timeoutMs: budget,
        maxRetries: 0,
        // 门禁要看的是「这条命令此刻」的判断，缓存命中会让判断停留在旧结论上。
        cache: false,
        signal: budgetSignal(budget),
      })
    } catch (error) {
      // fail-open：判断失败永远不该挡住正常工作。
      deps.logger?.warn(`typesafe preflight: 放行（判断失败）: ${clampText(redactSecrets(error instanceof Error ? error.message : String(error)), 160)}`)
      return next()
    }
    const { choice, confidence } = judged.answer
    if (choice === 'destructive' && confidence >= settings.preflight.minConfidence) {
      return {
        kind: 'deny',
        reason: [
          `语义预审拒绝：把这条命令按爆炸半径分类为「不可逆破坏」（置信度 ${confidence.toFixed(2)} ≥ ${settings.preflight.minConfidence}）。`,
          '这条判断来自 TypeSafe Jev，属于概率判断，不是确定性拦截。',
          '如果确认它可以执行：在设置页把「危险命令语义预审」关掉，或改成影响面更小的写法后重试。',
        ].join('\n'),
      }
    }
    return next()
  })
}

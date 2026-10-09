/**
 * @dsh-external/dsh-proxy-guard — 代理链路自毁防护。
 *
 * 背景：DSH host 及其子进程继承 `~/.bashrc` 导出的
 * `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY=http://127.0.0.1:7897`（Clash Verge 的
 * mixed port），模型请求本身就是走这条代理出去的。因此任何让 7897 抖动、
 * 拥塞或消失的操作，都会直接掐断当前对话——这就是"用测试把自己跑死"的机制。
 *
 * 本插件挂在 DSH 自己的 `tools/pre-execute` 扩展点上，在命令执行之前就拦下它，
 * 而不是等会话断了之后回头翻日志。
 *
 * 规范：拦截点用 ctx.on 注册，随 fiber dispose 自动注销（热重载/卸载即净）。
 */
import type { Context } from 'cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = '@dsh-external/dsh-proxy-guard'

export const inject = ['tools']

export interface Config {
  /** 关掉后不拦任何命令。仅调试用，正常保持开启。 */
  enabled: boolean
}

export const Config = z.object({
  enabled: z.boolean().default(true),
})

/**
 * 逃生口令。仅当 YG 在对话里明确要求执行某个被拦下的动作时才使用；
 * 不用于"我觉得这次没关系"的自我放行。
 */
const BYPASS = /PROXY_GUARD_BYPASS=1/

/** 命中即说明这条命令在跟 mihomo 内核的控制面说话。 */
const MIHOMO_API = /(verge-mihomo\.sock|127\.0\.0\.1:(?:9090|9097)|\/(?:proxies|configs|group)\b)/

/** HTTP 写方法：curl -X / --request，以及 python 里的字符串字面量。 */
const WRITE_METHOD = /(-X\s*(?:PUT|PATCH|POST|DELETE)\b|--request\s+(?:PUT|PATCH|POST|DELETE)\b|['"](?:PUT|PATCH|POST|DELETE)['"])/i

/** 并发或循环结构。 */
const BULK = /(ThreadPoolExecutor|concurrent\.futures|asyncio\.gather|\bfor\s+\w+\s+in\b|\bwhile\s|(?<![\w-])xargs\b|(?<![\w-])parallel\b)/

/** 运行配置文件名。 */
const CONFIG_FILE = /(?:clash-verge\.yaml|Merge\.yaml|verge\.yaml|profiles\/[A-Za-z0-9]+\.yaml)/

const HEAD = '已阻止：这条命令会切断 DSH 自身赖以通信的代理链路（模型请求走 127.0.0.1:7897），执行下去当前会话会直接掉线。'

interface Rule {
  readonly id: string
  readonly hit: (command: string) => boolean
  readonly reason: string
}

const RULES: readonly Rule[] = [
  {
    id: 'mihomo-write',
    hit: (c) => MIHOMO_API.test(c) && WRITE_METHOD.test(c),
    reason: `${HEAD}通过内核 API 切节点 / 改配置会重置全部活跃连接。换节点请在 Clash Verge 界面里点。`,
  },
  {
    id: 'full-group-probe',
    hit: (c) => /\/group\//.test(c) && /delay/.test(c),
    reason: `${HEAD}全组测速会一次性发起几十条并发握手，直接打满链路。要测就测单个节点。`,
  },
  {
    id: 'bulk-probe',
    hit: (c) => /delay/.test(c) && BULK.test(c),
    reason: `${HEAD}循环或并发地跑节点延迟测试会打满链路。单节点、单次可以。`,
  },
  {
    id: 'speedtest',
    hit: (c) => /(__down\?bytes=|speed\.cloudflare\.com|speedtest\.|iperf|fast\.com|proof\.ovh\.net\/files)/i.test(c),
    reason: `${HEAD}带宽测速会独占整条专线若干秒，共享出口 IP 上还会触发对方限流。测速交给 YG 手动做。`,
  },
  {
    id: 'large-download',
    hit: (c) => /bytes=\d{7,}/.test(c),
    reason: `${HEAD}单次请求超过 10MB 会长时间占满专线。`,
  },
  {
    id: 'kernel-restart',
    hit: (c) =>
      /(systemctl\s+(?:restart|reload|stop|start)|(?<![\w-])(?:pkill|killall|kill)\b)/i.test(c)
      && /(mihomo|clash-verge|verge-mihomo)/i.test(c),
    reason: `${HEAD}重启或杀掉代理内核会立刻断开所有连接。`,
  },
  {
    id: 'sysproxy-toggle',
    hit: (c) => /gsettings\s+set\s+org\.gnome\.system\.proxy/.test(c),
    reason: `${HEAD}改系统代理接管开关会让所有 GUI 程序瞬间失联。请在 Clash Verge 界面里切。`,
  },
  {
    id: 'proxy-config-write',
    hit: (c) => CONFIG_FILE.test(c)
      && /(>>?\s*\S*?(?:clash-verge\.yaml|Merge\.yaml|verge\.yaml|profiles\/[A-Za-z0-9]+\.yaml)|sed\s+-i\b|(?<![\w-])tee\b|(?<![\w-])(?:cp|mv)\b)/.test(c),
    reason: `${HEAD}改写运行配置会触发内核重载。改配置请用文件编辑工具，重载由 YG 在界面里做。`,
  },
]

/** 逐条规则匹配，返回第一条命中的拒绝理由。 */
function reasonFor(command: string): string | undefined {
  for (const rule of RULES) {
    if (rule.hit(command)) return rule.reason
  }
  return undefined
}

export function apply(ctx: Context, config: Config): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    if (!config.enabled) return next()
    if (exec.name !== 'bash') return next()
    const args = exec.arguments as { command?: unknown } | undefined
    const command = typeof args?.command === 'string' ? args.command : ''
    if (!command || BYPASS.test(command)) return next()
    const reason = reasonFor(command)
    if (reason) return { kind: 'deny', reason }
    return next()
  })
}

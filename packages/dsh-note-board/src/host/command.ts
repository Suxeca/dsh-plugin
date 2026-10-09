/**
 * The `/note-board` slash command: the injection switch and a text status,
 * reachable *before* the first message.
 *
 * The board's own binding bar carries the same switch, and the entry above the
 * composer carries it too, but both live inside the conversation UI — a slash
 * command is the one entry point that works from the composer itself, and the
 * status reply is the one channel that still answers when the board's tab fails
 * to render. All three write the same state: the registry's `off` list.
 *
 * `status` deliberately reports the *binding and the section census*, not just
 * on/off. "注入：开" alone was the same silent-policy defect the board was built
 * to remove: a human could not tell which note, from where, or what it costs
 * against the soft budget without opening a pane that might be the thing that
 * is broken.
 *
 * The command registry is reached structurally rather than through a package
 * dependency. It is an optional service at runtime — a deployment with no
 * command adapter must simply get no `/note-board` — and only these two shapes
 * cross the boundary, so the module declares what it uses instead of requiring
 * every deployment to resolve the whole package.
 *
 * @module @suxeca/dsh-note-board/host/command
 */
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { injectionOffNotice } from './inject.ts'
import { resolveLedger, setInjection, type LedgerDeps } from './ledgers.ts'
import { sectionRows } from './budget.ts'
import { readBoundedFile } from './read.ts'
import { DEFAULT_PINNED_SECTIONS, DEFAULT_RUN_LOG_SECTIONS, injectionPlan, selectNote } from '../sections.ts'
import type { LedgerRef } from '../shared.ts'

/** Usage text, shared by the hint and the error so they cannot drift. */
const USAGE = '用法：/note-board off | on | status'

/** Everything `status` reads. A structural subset of the plugin's own deps. */
export interface CommandDeps extends LedgerDeps {
  /** Per-file read cap, in characters: the status census never exceeds it. */
  readonly maxBytes: number
  /** Soft target for resident knowledge, reported so "超预算" is visible here. */
  readonly injectBudget: number
  readonly pinnedSections?: readonly string[]
  readonly runLogSections?: readonly string[]
}

/** What a command handler may return. */
type CommandResult = { readonly kind: 'success', readonly text?: string } | { readonly kind: 'error', readonly text: string }

/** The slice of one command invocation this module reads. */
interface CommandInvocation {
  /** Agent whose UI received the command, so the switch is per session. */
  readonly agent: {
    readonly session: { readonly id: string }
    inject(message: UserMessage): void
  }
  /** Exact text after the command name, separator whitespace included. */
  readonly rawInput: string
}

/** The slice of the command registry this module registers into. */
interface CommandsService {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint?: string }
    readonly recordInput?: boolean
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
  }): () => void
}

/** How the binding was reached, in one word. */
function sourceWord(ref: LedgerRef): string {
  if (ref.source === 'attached') return '手动附加'
  if (ref.source === 'discovered') return '自动发现'
  if (ref.source === 'off') {
    // The switch is not a binding of its own: name what it is hiding, so a
    // switched-off session still says which note it switched off.
    if (ref.underlying === 'attached') return '手动附加（已被开关覆盖）'
    if (ref.underlying === 'discovered') return '自动发现（已被开关覆盖）'
    return '无（本会话原本没有可注入的笔记）'
  }
  return '无'
}

/**
 * One text reply describing this session's note and switch.
 *
 * Everything here is read on demand: the census is a single bounded file read,
 * and a failure to read is reported as a missing file rather than as an error —
 * a moved note is a state the human can fix, not a broken command.
 */
async function statusText(deps: CommandDeps, sessionId: string): Promise<string> {
  const ref = await resolveLedger(deps, sessionId)
  const off = ref.source === 'off'
  const lines: string[] = [off ? '笔记注入：关（本会话）' : '笔记注入：开（本会话）']
  if (ref.source === 'none') {
    lines.push('未绑定：本会话的工作目录向上没有找到笔记；可在「笔记看板 → 笔记目录」附加，或用 /note-board off 明确关闭。')
    return lines.join('\n')
  }
  lines.push(`绑定：${sourceWord(ref)} · ${ref.title}${ref.path === '' ? '' : ` · ${ref.path}`}`)
  if (off) {
    lines.push('说明：关闭的只是注入；看板仍显示这份笔记，历史里已注入的副本已作废。')
  }
  if (ref.path === '') {
    lines.push('范围：没有可读的笔记文件。')
    return lines.join('\n')
  }
  try {
    const read = await readBoundedFile(ref.path, deps.maxBytes)
    const selection = selectNote(
      read.text,
      deps.pinnedSections ?? DEFAULT_PINNED_SECTIONS,
      deps.runLogSections ?? DEFAULT_RUN_LOG_SECTIONS,
    )
    const plan = injectionPlan(selection, deps.injectBudget, read.truncated)
    lines.push(
      read.truncated
        ? `范围：文件超过读取上限（${deps.maxBytes}），本次统计不完整。`
        : `范围：常驻 ${plan.pinnedIds.length} 节 ${plan.residentChars} 字符 · 软预算 ${plan.budget}`
          + `${plan.overBudget ? '（超预算，仍完整提供，不截断）' : ''}`
          + ` · 按需 ${plan.onDemandIds.length} 节（用 note_board_read 按 id 读取）`
          + ` · 运行日志 ${plan.logIds.length} 节（不自动注入）`,
    )
    // The same census the board shows, because this reply is the channel that
    // still works when the board's renderer is what broke.
    const { rows, baselineAt } = await sectionRows(deps, sessionId, ref, read.text, selection)
    const resident = rows.filter(row => row.cls === 'resident').sort((a, b) => b.chars - a.chars).slice(0, 3)
    if (resident.length > 0) {
      lines.push(`最大常驻：${resident.map(row => `${row.id} ${row.chars}`).join(' · ')}`)
    }
    const moved = rows.filter(row => row.changed).map(row => row.id)
    lines.push(
      baselineAt === null
        ? '变更：本会话尚无注入基线（第一次注入提交后才会标出哪些节在变）。'
        : moved.length === 0
          ? '变更：自上次注入以来没有节发生变化。'
          : `变更：${moved.join('、')}（与上次注入不同；反复出现的节通常是被当成日志在写，`
            + '把过程写进 ## RUN-LOG … 节它就不会被注入）',
    )
    // The role boundary, reported where a human can act on it: a section that
    // reads like one run's record becomes a constraint on every later turn.
    const suspected = rows.filter(row => row.smell !== undefined).map(row => row.id)
    if (suspected.length > 0) {
      lines.push(`疑似过程记录：${suspected.join('、')}`
        + '（正文里混着过程叙述：若这些实测是某条判决的证据，保留是对的；纯过程记录才该去 ## RUN-LOG … 或 deja / memsearch。本插件不会自动改你的笔记）')
    }
  } catch {
    lines.push('范围：笔记文件缺失或不可读。')
  }
  return lines.join('\n')
}

/**
 * Register the session-level injection switch and its status line.
 * @param ctx - host context.
 * @param deps - the resolver, the registry the switch lives in, and the budget.
 * @returns the exact disposer, or a no-op when no command service is mounted.
 */
export function registerBoardCommand(ctx: Context, deps: CommandDeps): () => void {
  const commands = ctx.get('commands') as unknown as CommandsService | undefined
  if (commands === undefined) return () => {}
  return commands.register({
    name: 'note-board',
    description: 'show this note binding, or switch whether this session injects it (off | on | status)',
    input: { hint: 'off | on | status' },
    // The switch is durable state, not a payload: there is nothing to replay
    // from the log, and the registry already owns the fact.
    recordInput: false,
    handler: async (invocation) => {
      const sessionId = invocation.agent.session.id
      const argument = invocation.rawInput.trim().toLowerCase()
      if (argument === '' || argument === 'status') {
        return { kind: 'success', text: await statusText(deps, sessionId) }
      }
      if (argument !== 'off' && argument !== 'on') return { kind: 'error', text: USAGE }
      const changed = await setInjection(deps.registryPath, sessionId, argument === 'on')
      // Switching off cannot unwrite a body already committed to this session's
      // history, so it revokes it. See `injectionOffNotice`.
      if (changed && argument === 'off') invocation.agent.inject(injectionOffNotice())
      return {
        kind: 'success',
        text: argument === 'off'
          ? `本会话已关闭笔记注入；此前注入的副本已作废。\n${await statusText(deps, sessionId)}`
          : await statusText(deps, sessionId),
      }
    },
  })
}

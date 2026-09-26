/**
 * The `/note-board` slash command: the injection switch, reachable *before* the
 * first message.
 *
 * The board's own binding bar already carries this switch, but that bar lives in
 * the board's tab — which a new session only has once the session exists. A
 * slash command is the one entry point available from the composer itself, so a
 * human can decide *not* to inject before the first turn has already read the
 * note. Both paths write the same state: the registry's `off` list.
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
import { injectionEnabled, setInjection } from './ledgers.ts'

/** Usage text, shared by the hint and the error so they cannot drift. */
const USAGE = '用法：/note-board off | on | status'

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

/**
 * Register the session-level injection switch as a slash command.
 * @param ctx - host context.
 * @param deps - the registry the switch is persisted in.
 * @returns the exact disposer, or a no-op when no command service is mounted.
 */
export function registerBoardCommand(ctx: Context, deps: { registryPath: string }): () => void {
  const commands = ctx.get('commands') as unknown as CommandsService | undefined
  if (commands === undefined) return () => {}
  return commands.register({
    name: 'note-board',
    description: 'toggle whether this session injects its note (off | on | status)',
    input: { hint: 'off | on | status' },
    // The switch is durable state, not a payload: there is nothing to replay
    // from the log, and the registry already owns the fact.
    recordInput: false,
    handler: async (invocation) => {
      const sessionId = invocation.agent.session.id
      const argument = invocation.rawInput.trim().toLowerCase()
      if (argument === '' || argument === 'status') {
        const enabled = await injectionEnabled(deps.registryPath, sessionId)
        return { kind: 'success', text: enabled ? '笔记注入：开（本会话）' : '笔记注入：关（本会话）' }
      }
      if (argument !== 'off' && argument !== 'on') return { kind: 'error', text: USAGE }
      const changed = await setInjection(deps.registryPath, sessionId, argument === 'on')
      // Switching off cannot unwrite a body already committed to this session's
      // history, so it revokes it. See `injectionOffNotice`.
      if (changed && argument === 'off') invocation.agent.inject(injectionOffNotice())
      return {
        kind: 'success',
        text: argument === 'off'
          ? '本会话已关闭笔记注入；此前注入的副本已作废'
          : '本会话已恢复笔记注入',
      }
    },
  })
}

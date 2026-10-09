/**
 * @dsh-external/dsh-codex-bridge — expose the injected `codex` subagent provider
 * (from `@deepseek-ai/dsh-subagent-codex`) as a model-facing tool.
 *
 * The official provider delegates through the Codex `app-server --stdio` protocol;
 * `@deepseek-ai/dsh-tool-subagent` would give the same thing, but this deployment
 * mounts delegation tools from a per-session agent preset in which the codex row
 * stays disabled. Registering the consumer on the host plane sidesteps the preset.
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = '@dsh-external/dsh-codex-bridge'
export const inject = ['tools']

/** Deployment-owned provider name and model-facing tool name. */
export interface Config {
  /**
   * Registered `ctx.subagents` provider names to delegate to, in preference order.
   * `codex-gpt55` is the official provider pinned to an account-accepted model;
   * plain `codex` inherits `~/.codex/config.toml`.
   */
  providers: string[]
  /** Model-facing tool name. */
  toolName: string
}

export const Config: z<Config> = z.object({
  providers: z.array(z.string()).default(['codex-gpt55', 'codex']),
  toolName: z.string().default('subagent_codex'),
})

interface ToolArgs {
  prompt: string
  description?: string
}

function textOf(blocks: readonly unknown[]): string {
  return blocks
    .map(block => {
      const b = block as { type?: string; text?: string }
      return b.type === 'text' && typeof b.text === 'string' ? b.text : ''
    })
    .filter(text => text.length > 0)
    .join('\n')
}

export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: config.toolName,
    description:
      'Delegate one self-contained task to a Codex (OpenAI) child agent running in this workspace. '
      + 'The child starts fresh, keeps no memory of this conversation, cannot delegate further, and '
      + 'edits files directly in the working directory. Returns its final answer.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Complete, standalone task for the Codex child; include all context it needs.',
      },
      description: {
        type: 'string',
        description: 'Short (3-5 word) label for display.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: ToolArgs, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('subagent_codex requires a calling agent (exec.agent was undefined)')
      const subagents = ctx.get('subagents')
      if (!subagents) throw new Error('subagent_codex: the `subagents` service is unavailable')
      const provider = config.providers.find(candidate => subagents.getProvider(candidate) !== undefined)
      if (provider === undefined) {
        throw new Error(
          `subagent_codex: no Codex provider is registered (wanted ${config.providers.join(', ')}; have ${subagents.list().join(', ')})`
          + ' — inject @deepseek-ai/dsh-subagent-codex first',
        )
      }
      const run = await subagents.start(provider, {
        label: args.description,
        prompt: [{ type: 'text', text: args.prompt }],
        parent,
        signal: exec.signal,
      })
      try {
        const result = await run.result
        const output = textOf(result.output)
        const diagnostic = result.diagnostic === undefined ? '' : `\n[${result.stopReason}] ${result.diagnostic}`
        return output.length > 0
          ? output + diagnostic
          : `codex child produced no output via provider "${provider}" (stopReason: ${result.stopReason})${diagnostic}`
      } finally {
        await run.dispose()
      }
    },
  })), '@dsh-external/dsh-codex-bridge: subagent_codex tool')
}

/**
 * @dsh-external/dsh-codex-gpt55 — the official Codex subagent provider pinned to a
 * model this ChatGPT account accepts.
 *
 * `@deepseek-ai/dsh-subagent-codex` registers the provider with an optional `model`
 * config; omitted, the Codex child inherits `~/.codex/config.toml`, which on this
 * machine selects a model the account rejects with HTTP 400. Spread the upstream
 * schema and default that one field rather than re-implementing the provider.
 */
import type { Context } from 'cordis'
import z from 'schemastery'
import * as upstream from '@deepseek-ai/dsh-subagent-codex'

export const name = '@dsh-external/dsh-codex-gpt55'
export const inject = upstream.inject

export type Config = upstream.Config

export const Config: z<Config> = z.object({
  ...upstream.Config.dict,
  model: z.string().default('gpt-5.5'),
  providerName: z.string().default('codex-gpt55'),
})

export function apply(ctx: Context, config: Config = {} as Config): void {
  upstream.apply(ctx as any, {
    ...config,
    providerName: config?.providerName ?? 'codex-gpt55',
    model: config?.model ?? 'gpt-5.5',
  })
}

import type { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { PLUGIN_NAME } from './shared.ts'
import { ExpressionStore } from './host/state.ts'
import { registerExpressionCommand } from './host/command.ts'
import { registerExpressionInjection } from './host/inject.ts'
import { registerRoutes } from './host/routes.ts'

export const name = PLUGIN_NAME
export const inject = ['commands', 'webServer', 'connection', 'sessionQuery', 'agents']

interface Skills {
  register(skill: {
    name: string; description: string; content: string; source: 'runtime'
    invocation: { modelInvocable: boolean; userInvocable: boolean }
    resourceBase: { kind: 'directory'; path: string }
  }): () => void
}

export async function apply(ctx: Context): Promise<void> {
  const rulesPath = new URL('../rules/ste-research.md', import.meta.url)
  const rules = readFileSync(rulesPath, 'utf8').trim()
  if (rules.length === 0 || rules.length > 32768) throw new Error('Invalid bounded expression rules')
  const ruleVersion = createHash('sha256').update(rules).digest('hex').slice(0, 12)
  const home = process.env.DSH_HOME || resolve(homedir(), '.dsh')
  const store = await ExpressionStore.open(resolve(home, 'expression-mode', 'sessions.json'), ruleVersion)

  // Registered first, disposed last: drain admitted writes before a replacement
  // generation opens the same durable state file.
  ctx.effect(() => () => store.close(), 'expression-mode: state writer lifetime')
  ctx.effect(() => registerExpressionCommand(ctx, store), 'expression-mode: command')
  ctx.effect(() => registerRoutes(ctx, store), 'expression-mode: authenticated state routes')
  ctx.effect(() => registerExpressionInjection(ctx, store, rules), 'expression-mode: model delivery')

  const skills = ctx.get('skills') as unknown as Skills | undefined
  if (skills !== undefined) ctx.effect(() => skills.register({
    name: 'ste-explain',
    source: 'runtime',
    description: 'Explain the current research task in STE-inspired plain English; preserve frozen formulas and evidence. One task only, no persistent mode change.',
    invocation: { modelInvocable: false, userInvocable: true },
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../rules/', import.meta.url)) },
    content: `# One-task plain-English explanation\nUse plain English for this explicitly requested task. Apply the following style to this task only. Do not change the session's persistent expression mode. Existing frozen-definition and evidence obligations take priority.\n\n${rules}`,
  }), 'expression-mode: explicit one-task skill')
}

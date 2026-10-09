import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { MESSAGE_PLUGIN, type ExpressionState, type ModeStore } from '../shared.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'expression-mode': {
      kind: 'expression-mode'
      plugin?: string
      form: 'snapshot'
      sections: readonly { name: string; text: string }[]
    }
  }
}

/** Read only our latest visible leaf; log presence is not proof of admission. */
export function expressionText(message: UserMessage): string | null {
  const source = message.source as Record<string, unknown> | undefined
  if (!source) return null
  const isMatch = source.kind === MESSAGE_PLUGIN || (source.kind === 'plugin' && source.plugin === MESSAGE_PLUGIN)
  if (!isMatch || source.form !== 'snapshot') return null
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('')
}

export function latestExpression(agent: Agent): string | null {
  const nodes = agent.session.surface.nodes
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = agent.session.eventAt(nodes[index])
    if (event?.type !== 'user/message') continue
    const text = expressionText(event.data)
    if (text !== null) return text
  }
  return null
}

export function modeText(state: ExpressionState, rules: string): string {
  const header = `[EXPRESSION MODE] session=${state.sessionId} mode=${state.mode} language=${state.language} revision=${state.revision} rules=${state.ruleVersion}`
  const language = state.language === 'zh'
    ? 'Use Chinese (中文) for your own explanatory prose, including everyday and non-research conversations. Earlier English-only defaults are revoked. Keep quotations, formulas and code identifiers unchanged.'
    : state.language === 'en'
      ? 'Use English for your own explanatory prose. Keep quotations, formulas and code identifiers unchanged.'
      : 'No persistent language override is selected. Follow the current human request and original language policy; earlier forced-language preferences are revoked.'
  const boundary = 'A specific human request for a different language or verbatim deliverable takes priority for that deliverable. This does not cancel a skill explicitly invoked for the current task. Frozen definitions and scientific evidence obligations remain unchanged. Do not impose a research template on everyday conversations. This is a mode notice, not a new task.'
  const framing = `${header}\nThis is the current session's expression policy. It supersedes earlier expression-mode snapshots. Continue the actual human task.\n${language}\n${boundary}`
  if (state.mode === 'default') return `${framing}\nThe persistent STE-inspired clarity style is OFF. Use the original expression style in the selected language. Earlier simplified-style requirements are revoked.`
  return `${framing}\nThe STE-inspired clarity style is ON. Apply its principles in the selected language; Chinese adaptation is not certified STE English.\n\n${rules}`
}

export function modeMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'expression-mode',
      plugin: MESSAGE_PLUGIN,
      form: 'snapshot',
      sections: [{ name: 'expression-mode', text }],
    },
  })
}

/** A pure admission planner, shared by runtime and regression tests. */
export function planExpression(
  decision: PreStepDecision, initialMessages: readonly UserMessage[], step: number, aborted: boolean,
  state: ExpressionState, rules: string, latest: string | null,
): PreStepDecision {
  if (decision.kind === 'reject' || aborted) return decision
  // Do not revive a message batch intentionally consumed by another listener.
  if (decision.messages.length === 0 && (step === 1 || initialMessages.length > 0)) return decision
  const rest = decision.messages.filter(message => expressionText(message) === null)
  if (state.mode === 'default' && state.language === 'auto' && state.revision === 0 && latest === null) {
    return rest.length === decision.messages.length ? decision : { ...decision, messages: rest }
  }
  const text = modeText(state, rules)
  // Fresh human questions get an active-mode reminder. Continuation steps do not
  // append copies. Hidden snapshots after compaction are reconstructed on demand.
  const humanQuestion = (state.mode === 'ste' || state.language !== 'auto') && rest.some(message => message.source.kind === 'user')
  const needed = latest !== text || humanQuestion
  return { ...decision, messages: needed ? [modeMessage(text), ...rest] : rest }
}

export function registerExpressionInjection(ctx: Context, store: ModeStore, rules: string): () => void {
  let active = true
  const unregister = ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const decision = await next()
    if (!active || decision.kind === 'reject' || signal.aborted) return decision
    const state = await store.get(agent.session.id)
    if (!active || signal.aborted) return decision
    return planExpression(decision, messages, step, signal.aborted, state, rules, latestExpression(agent))
  })
  return () => {
    active = false
    unregister()
    // History is append-only. Unloading revokes retained instructions for live
    // agents, while saved preferences remain available for restart/hot reload.
    const agents = ctx.get('agents') as { list(): readonly Agent[] } | undefined
    if (agents !== undefined) {
      for (const agent of agents.list()) {
        const latest = latestExpression(agent)
        if (latest === null || (!latest.includes(' mode=ste ') && !/ language=(zh|en) /.test(latest))) continue
        agent.inject(modeMessage('[EXPRESSION MODE] The expression-mode plugin has been unloaded. Its earlier persistent language and style instructions are revoked. Follow the current human request and original language/expression policy; preserve all scientific and frozen-definition obligations.'))
      }
    }
  }
}

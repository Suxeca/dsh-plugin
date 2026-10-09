import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { modeText, modeMessage, planExpression, expressionText, registerExpressionInjection } from '../src/host/inject.ts'
import type { ExpressionState, ExpressionLanguage } from '../src/shared.ts'

const rules = 'Preserve frozen formulas. Use the selected language.'
const state = (mode: 'default' | 'ste', revision = 1, language: ExpressionLanguage = mode === 'ste' ? 'en' : 'auto'): ExpressionState => ({ sessionId: 'a', mode, language, revision, updatedAt: 1, ruleVersion: 'v' })
const human = () => createUserMessage({ content: [{ type: 'text', text: 'Explain the result.' }], source: { kind: 'user' } })
const other = () => createUserMessage({ content: [{ type: 'text', text: 'Frozen formula' }], source: { kind: 'plugin', plugin: 'note-ledger', form: 'notice', summary: 'knowledge' } })
const enter = (messages: ReturnType<typeof human>[]) => ({ kind: 'enter' as const, messages })

describe('expression admission', () => {
  it('adds nothing to an untouched default session', () => {
    const decision = enter([human()])
    expect(planExpression(decision, decision.messages, 1, false, state('default', 0), rules, null)).toBe(decision)
  })
  it('delivers before a fresh human question, preserving all other messages by identity', () => {
    const messages = [other(), human()]; const result = planExpression(enter(messages), messages, 1, false, state('ste'), rules, null)
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return
    expect(expressionText(result.messages[0])).toContain(rules)
    expect(result.messages.slice(1)).toEqual(messages)
    expect(result.messages[1]).toBe(messages[0]); expect(result.messages[2]).toBe(messages[1])
  })
  it('does not duplicate on continuation steps, but restores after compaction', () => {
    const current = state('ste'); const text = modeText(current, rules)
    const result = planExpression(enter([]), [], 2, false, current, rules, text)
    expect(result).toEqual(enter([]))
    const restored = planExpression(enter([]), [], 2, false, current, rules, null)
    expect(restored.kind === 'enter' && restored.messages).toHaveLength(1)
  })
  it('reminds active mode on the next human turn', () => {
    const current = state('ste'); const messages = [human()]
    const result = planExpression(enter(messages), messages, 1, false, current, rules, modeText(current, rules))
    expect(result.kind === 'enter' && result.messages).toHaveLength(2)
  })
  it('revokes old English snapshots on default without canceling explicit one-task skills', () => {
    const messages = [human()]; const result = planExpression(enter(messages), messages, 1, false, state('default', 2), rules, modeText(state('ste'), rules))
    if (result.kind !== 'enter') throw new Error('unexpected rejection')
    const text = expressionText(result.messages[0])!
    expect(text).toContain('OFF'); expect(text).toContain('does not cancel a skill explicitly invoked')
    expect(text).not.toContain(rules)
  })
  it('handles A → default → A as a new revision and replaces only pending own messages', () => {
    const stale = modeMessage(modeText(state('ste', 1), rules)); const user = human(); const note = other()
    const messages = [stale, note, user]
    const result = planExpression(enter(messages), messages, 1, false, state('ste', 3), rules, modeText(state('ste', 1), rules))
    if (result.kind !== 'enter') throw new Error('unexpected rejection')
    expect(result.messages).toHaveLength(3)
    expect(expressionText(result.messages[0])).toContain('revision=3')
    expect(result.messages[1]).toBe(note); expect(result.messages[2]).toBe(user)
  })
  it('respects reject, cancellation and consumed batches', () => {
    const rejected = { kind: 'reject' as const }; const messages = [human()]; const decision = enter(messages)
    expect(planExpression(rejected, messages, 1, false, state('ste'), rules, null)).toBe(rejected)
    expect(planExpression(decision, messages, 1, true, state('ste'), rules, null)).toBe(decision)
    expect(planExpression(enter([]), messages, 1, false, state('ste'), rules, null)).toEqual(enter([]))
  })
  it('does not treat an uncommitted candidate as delivered', () => {
    const messages = [human()]
    const first = planExpression(enter(messages), messages, 1, false, state('ste'), rules, null)
    const retried = planExpression(enter(messages), messages, 1, false, state('ste'), rules, null)
    expect(first.kind === 'enter' && expressionText(first.messages[0])).toBe(retried.kind === 'enter' && expressionText(retried.messages[0]))
  })
  it.each([
    ['default', 'auto'], ['default', 'zh'], ['default', 'en'],
    ['ste', 'auto'], ['ste', 'zh'], ['ste', 'en'],
  ] as const)('keeps style %s independent from language %s', (mode, language) => {
    const text = modeText(state(mode, 1, language), rules)
    expect(text).toContain(`mode=${mode} language=${language}`)
    if (language === 'zh') {
      expect(text).toContain('Use Chinese (中文)')
      expect(text).toContain('everyday and non-research')
      expect(text).not.toContain('Use English for your own')
    } else if (language === 'en') expect(text).toContain('Use English for your own')
    else expect(text).toContain('No persistent language override')
    expect(text.includes(rules)).toBe(mode === 'ste')
    expect(text).toContain('Do not impose a research template')
  })
  it('keeps Chinese active when the clarity switch is off and reminds new questions', () => {
    const current = state('default', 3, 'zh'); const messages = [human()]
    const text = modeText(current, rules)
    const result = planExpression(enter(messages), messages, 1, false, current, rules, text)
    if (result.kind !== 'enter') throw new Error('unexpected rejection')
    expect(result.messages).toHaveLength(2)
    expect(expressionText(result.messages[0])).toContain('Use Chinese (中文)')
    expect(expressionText(result.messages[0])).toContain('style is OFF')
  })
  it('restores a language-only snapshot after compaction', () => {
    const result = planExpression(enter([]), [], 2, false, state('default', 2, 'zh'), rules, null)
    if (result.kind !== 'enter') throw new Error('unexpected rejection')
    expect(result.messages).toHaveLength(1)
    expect(expressionText(result.messages[0])).toContain('language=zh')
  })
  it('revokes a forced language on unload even if simple style is off', () => {
    const injected: unknown[] = []
    const text = modeMessage(modeText(state('default', 2, 'zh'), rules))
    const agent = { session: { surface: { nodes: [1] }, eventAt: () => ({ type: 'user/message', data: text }) }, inject: (message: unknown) => injected.push(message) }
    const ctx = { on: () => () => {}, get: () => ({ list: () => [agent] }) }
    const store = { get: async () => state('default', 2, 'zh'), set: async () => state('default'), update: async () => state('default') }
    registerExpressionInjection(ctx as never, store, rules)()
    expect(injected).toHaveLength(1)
    expect(expressionText(injected[0] as never)).toContain('language and style instructions are revoked')
  })
  it('removes the listener and revokes active live sessions on unload', () => {
    const injected: unknown[] = []; let unregistered = false
    const text = modeMessage(modeText(state('ste'), rules))
    const agent = { session: { surface: { nodes: [1] }, eventAt: () => ({ type: 'user/message', data: text }) }, inject: (message: unknown) => injected.push(message) }
    const ctx = { on: () => () => { unregistered = true }, get: () => ({ list: () => [agent] }) }
    const store = { get: async () => state('ste'), set: async () => state('ste'), update: async () => state('ste') }
    const dispose = registerExpressionInjection(ctx as never, store, rules)
    dispose()
    expect(unregistered).toBe(true); expect(injected).toHaveLength(1)
    expect(expressionText(injected[0] as never)).toContain('unloaded')
  })
})

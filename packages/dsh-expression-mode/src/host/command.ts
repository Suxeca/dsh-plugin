import type { Context } from '@deepseek-ai/cordis'
import { isExpressionLanguage, isExpressionMode, type ModeStore, type ExpressionState, type ExpressionPatch } from '../shared.ts'

interface Commands {
  register(definition: {
    name: string; description: string; input: { hint: string }; recordInput: boolean
    handler(invocation: { agent: { session: { id: string } }; rawInput: string }): Promise<{ kind: 'success' | 'error'; text: string }>
  }): () => void
}
const USAGE = '用法：/expression zh | en | auto | style ste | style default | ste | default | status'

export function statusText(state: ExpressionState): string {
  const language = state.language === 'zh' ? '中文' : state.language === 'en' ? 'English' : '跟随原有策略'
  return `语言：${language}\n简明表达 · STE-inspired：${state.mode === 'ste' ? '已开启' : '已关闭（原有风格）'}\n范围：仅当前会话；从下一次模型步骤生效，已发出的请求不重写。\n语言与风格独立；冻结公式、原文引用和科研证据要求不变。\n规范版本：${state.ruleVersion}`
}

export function registerExpressionCommand(ctx: Context, store: ModeStore): () => void {
  const commands = ctx.get('commands') as unknown as Commands | undefined
  if (commands === undefined) throw new Error('Expression mode requires the command registry')
  return commands.register({
    name: 'expression',
    description: '会话语言 zh/en/auto；简明风格 style ste/default；兼容 ste/default；status',
    input: { hint: 'zh | en | auto | style ste | style default | ste | default | status' },
    recordInput: false,
    handler: async ({ agent, rawInput }) => {
      const argument = rawInput.trim().toLowerCase()
      const words = argument.split(/\s+/)
      let patch: ExpressionPatch | undefined
      let legacy: 'ste' | 'default' | undefined
      if (argument === '' || argument === 'status') { /* read-only */ }
      else if (isExpressionLanguage(argument)) patch = { language: argument }
      else if (isExpressionMode(argument)) legacy = argument
      else if (words.length === 2 && words[0] === 'lang' && isExpressionLanguage(words[1])) patch = { language: words[1] }
      else if (words.length === 2 && words[0] === 'style' && isExpressionMode(words[1])) patch = { mode: words[1] }
      else return { kind: 'error', text: USAGE }
      try {
        const state = legacy !== undefined ? await store.set(agent.session.id, legacy)
          : patch !== undefined ? await store.update(agent.session.id, patch)
            : await store.get(agent.session.id)
        return { kind: 'success', text: statusText(state) }
      } catch {
        return { kind: 'error', text: '表达设置未保存或无法读取。原有已保存状态未被替换；请检查插件存储后重试。' }
      }
    },
  })
}

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ExpressionBar } from './ExpressionBar.tsx'

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'expression-mode',
      order: 70,
      inject: (sessionId) => ({ sessionId }),
    }, ExpressionBar)),
    '@suxeca/dsh-expression-mode: composer expression switch',
  )
}

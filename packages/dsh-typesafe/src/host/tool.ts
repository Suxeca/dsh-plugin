/**
 * @suxeca/dsh-typesafe — Agent 工具 `typesafe_eval`。
 *
 * 为什么要有这个工具：当模型面对几十个候选项要重排 / 分类 / 打标时，让它自己
 * 逐条慢想是最贵也最不稳的做法。Jev 是专门做这件事的小模型——毫秒级返回带概率的
 * 类型化答案。所以这个工具把「一次请求问多个问题」这个官方推荐用法直接暴露给模型。
 *
 * 参数 schema 刻意做浅：`criteria` 用 `type: 'json'` 而不是深嵌套对象。原因是
 * 工具目录按字符计费进首轮 prefill，深嵌套 schema 换来的只是更早的类型报错——
 * 真正的校验在服务层的 `assertPayload` 里，报错同样清楚。
 *
 * @module @suxeca/dsh-typesafe/host/tool
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { EntryType, Question, Questions } from '../shared.ts'
import { clampText, redactSecrets } from '../shared.ts'
import { TypesafeError } from './transport.ts'
import type { TypesafeService } from './service.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 工具定义里的一行问题（扁平结构，便于模型稳定生成）。 */
export interface ToolQuestionInput {
  readonly id: string
  readonly type: 'choice' | 'noul' | 'score'
  readonly instructions: string
  /** choice: { 选项: 判据 }；score: [等级…]；noul: { true, false }（可选）。 */
  readonly criteria?: unknown
}

/** 工具入参。 */
export interface TypesafeEvalArgs {
  readonly state: string
  readonly questions: readonly ToolQuestionInput[]
  readonly model?: string
}

/** 把一行扁平输入翻成协议里的 `Question`；形状不对就抛，消息指到具体那一行。 */
function toQuestion(input: ToolQuestionInput, index: number): Question {
  const where = `questions[${String(index)}]（id=${input.id || '空'}）`
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new TypesafeError('invalid-request', `${where}: id 不能为空`, { retryable: false })
  if (typeof input.instructions !== 'string' || input.instructions.trim() === '') throw new TypesafeError('invalid-request', `${where}: instructions 不能为空`, { retryable: false })
  if (input.type === 'noul') {
    const criteria = input.criteria
    if (criteria === undefined || criteria === null) return { type: 'noul', instructions: input.instructions }
    if (typeof criteria !== 'object' || Array.isArray(criteria)) throw new TypesafeError('invalid-request', `${where}: noul 的 criteria 必须是 { true, false } 对象`, { retryable: false })
    const pair = criteria as { true?: unknown; false?: unknown }
    if (pair.true === undefined || pair.false === undefined) throw new TypesafeError('invalid-request', `${where}: noul 的 criteria 需要同时给 true 与 false`, { retryable: false })
    return { type: 'noul', instructions: input.instructions, criteria: { true: pair.true as EntryType, false: pair.false as EntryType } }
  }
  if (input.type === 'score') {
    const criteria = input.criteria
    if (!Array.isArray(criteria)) throw new TypesafeError('invalid-request', `${where}: score 的 criteria 必须是等级数组`, { retryable: false })
    return { type: 'score', instructions: input.instructions, criteria: criteria as EntryType[] }
  }
  const criteria = input.criteria
  if (typeof criteria !== 'object' || criteria === null || Array.isArray(criteria)) {
    throw new TypesafeError('invalid-request', `${where}: choice 的 criteria 必须是 { 选项: 判据 } 对象`, { retryable: false })
  }
  return { type: 'choice', instructions: input.instructions, criteria: criteria as Record<string, EntryType> }
}

/** 构造 `typesafe_eval` 的工具定义（注册与否由装配层按设置决定）。 */
export function createTypesafeEvalTool(service: TypesafeService): ToolDefinition {
  return defineTool({
    name: 'typesafe_eval',
    description: [
      'Semantic judgment via TypeSafe Jev (System One): turn natural language or app state into typed,',
      'probability-bearing answers in one fast call. Use it to classify, score, or rerank many candidates,',
      'or when you need a calibrated yes/no probability. Prefer ONE call with several questions over many calls.',
      'types: choice={选一个}, noul={yes 概率}, score={有序等级打分}.',
      'criteria: choice -> {"option": "rubric"}, score -> ["level1","level2"], noul -> {"true":"...","false":"..."} optional.',
      'Returns JSON: { model, answers:{id:{...}}, usage } — choice gives {choice,probabilities,confidence},',
      'noul gives {noul} (probability, no confidence), score gives {score,legend,probabilities,confidence}.',
    ].join(' '),
    parameters: {
      state: {
        type: 'string',
        required: true,
        description: 'The content to judge: raw text, or a JSON string when several parts must be referenced by name.',
      },
      questions: {
        type: 'array',
        required: true,
        description: 'One entry per independent judgment (max 256). All of them run in parallel over the same state.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Caller-chosen key; the answer comes back under it. Not sent to the model.' },
            type: { type: 'string', required: true, enum: ['choice', 'noul', 'score'], description: 'Primitive.' },
            instructions: { type: 'string', required: true, description: 'The judgment itself, stated completely.' },
            criteria: { type: 'json', description: 'choice: {"option":"rubric"}; score: ["level",...] (2-10 levels); noul: {"true":"...","false":"..."}.' },
          },
        },
      },
      model: { type: 'string', description: 'Optional model override; default comes from plugin settings (jev-latest).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: TypesafeEvalArgs): Promise<string> {
      const seen = new Set<string>()
      const questions: Record<string, Question> = {}
      try {
        if (!Array.isArray(args.questions) || args.questions.length === 0) {
          throw new TypesafeError('invalid-request', 'questions 不能为空', { retryable: false })
        }
        args.questions.forEach((input, index) => {
          const question = toQuestion(input, index)
          if (seen.has(input.id)) throw new TypesafeError('invalid-request', `问题 id "${input.id}" 重复`, { retryable: false })
          seen.add(input.id)
          questions[input.id] = question
        })
        const outcome = await service.evaluate({
          state: args.state,
          questions: questions as Questions,
          ...typeof args.model === 'string' && args.model !== '' ? { model: args.model } : {},
        }, { label: 'tool:typesafe_eval' })
        return JSON.stringify({
          model: outcome.response.model,
          cached: outcome.cached,
          latencyMs: Math.round(outcome.latencyMs),
          usage: outcome.response.usage,
          answers: outcome.response.answers,
        })
      } catch (error) {
        const code = error instanceof TypesafeError ? error.code : 'error'
        return JSON.stringify({
          ok: false,
          error: { code, message: clampText(redactSecrets(error instanceof Error ? error.message : String(error)), 300) },
        })
      }
    },
  })
}

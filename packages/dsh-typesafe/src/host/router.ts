/**
 * @suxeca/dsh-typesafe — 任务模式分流适配器（**默认关闭**）。
 *
 * 背景：`presets/router-standard` 现在用本地正则给会话首条消息分流
 * （react = 动手做 / spec = 先规划 / chat = 问答）。正则在边界样例上会抖，
 * 而这件事恰好是 Jev 最擅长的：一句话进、一个带概率的选项出。
 *
 * 为什么不是一个服务依赖注入进 preset：那份 preset 是**测量调优过**的，
 * 它必须在「没有本插件」时行为逐字节不变。所以这里只**提供一个可选服务**
 * （`ctx.typesafeRouter`），由 preset 的副本用 `ctx.get('typesafeRouter')`
 * 软探测：拿不到就退回自己原来的正则，拿得到就用概率分流并在超时时降级。
 *
 * 因此本模块**不改任何 preset 文件**，只把能力摆在总线上。
 *
 * @module @suxeca/dsh-typesafe/host/router
 */
import type { EntryType, TypesafeSettings } from '../shared.ts'
import type { TypesafeService } from './service.ts'

/** 内置的编码模式档位用到的模式 key（与 router-standard 的既有词汇一致）。 */
export type TaskMode = 'react' | 'spec' | 'chat'

/**
 * 一个分流档位：把问题、判据和「怎么问」打包递给判断服务。
 *
 * 存在的理由：模式轴不是通用的。编码 agent 关心 react / spec / chat；
 * 一个理论物理 preset 关心的是「本轮属于例行改动还是形式审计」——轴不同、
 * 判据不同、连提问语言都不同。所以档位由**调用方**（preset 行）提供，
 * 插件只负责加预算、降级路径与概率。
 */
export interface RouterProfile {
  /** 档位标识（日志、状态与自检用）。 */
  readonly id: string
  /** 交给模型的提问正文（本轮文本会被追加在最后）。 */
  readonly instructions: string
  /** 模式 key → 判据描述；至少 2 项。 */
  readonly criteria: Readonly<Record<string, EntryType>>
}

/** 一次分流判断。 */
export interface RouterVerdict {
  /** 命中的模式 key（由档位定义，不限于内置的三种）。 */
  readonly mode: string
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
  /** 命中本地缓存（同样的消息不重复付费）。 */
  readonly cached: boolean
  readonly model: string
  /** 实际使用的档位 id。 */
  readonly profile: string
}

/** 分流调用选项。 */
export interface ClassifyOptions {
  readonly signal?: AbortSignal
  /** 覆盖默认档位（缺省用内置的 `coding` 档）。 */
  readonly profile?: RouterProfile
}

/** 挂在总线上的可选服务面。 */
export interface TypesafeRouterService {
  /**
   * 给一条用户消息分流。
   *
   * @param text - 待分流的用户消息（通常是本轮最新一条）。
   * @param options - 档位与取消信号。
   * @returns 判断结果；任何失败都返回 undefined（调用方必须保留自己的降级路径）。
   */
  classify(text: string, options?: ClassifyOptions): Promise<RouterVerdict | undefined>
  /** 内置档位 id 列表。 */
  readonly profiles: readonly string[]
}

/** 装配层注入。 */
export interface RouterDeps {
  readonly service: TypesafeService
  readonly getSettings: () => TypesafeSettings
}

/** 判据：把三种模式的区别讲成「用户想要什么产出」，而不是技术名词。 */
const CRITERIA: Readonly<Record<string, EntryType>> = {
  react: '用户要的是**直接动手做出来**：新功能、新脚本、新目录、新插件，先看到能跑的东西再迭代',
  spec: '用户要的是**先搞清楚再动手**：修复一个已存在的缺陷、排查失败、按既有约束改现有系统，需要先读代码/复现/定位',
  chat: '用户要的是**解释、比较、判断或闲聊**：概念问答、方案讨论、代码评审意见、数据解读，不需要改动仓库',
}

/** 分流指令：明确「按产出分类」，并给出边界样例，减少模型在混合请求上犹豫。 */
const INSTRUCTIONS = [
  '下面是一条用户发给编程 agent 的请求。请判断它属于哪种工作模式。',
  '分类依据是**用户真正想要的产出**，不是里面出现了什么词：',
  '- 提到某个文件不必然是 spec（可能只是让你在那里加功能）；',
  '- 提到 bug 但要求的是解释原因，属于 chat；',
  '- 混合请求按「第一步该做什么」归类。',
  '',
  '用户消息：',
  '```text',
].join('\n')

/** 内置档位：通用编码 agent 的模式轴。 */
export const CODING_PROFILE: RouterProfile = {
  id: 'coding',
  instructions: INSTRUCTIONS,
  criteria: CRITERIA,
}

/** 档位表：目前只有内置的编码档，preset 可以自带档位覆盖它。 */
const BUILTIN_PROFILES: readonly RouterProfile[] = [CODING_PROFILE]

/** 档位合法性：至少要两个互斥选项，且提问正文非空。 */
function usableProfile(profile: RouterProfile | undefined): RouterProfile | undefined {
  if (profile === undefined) return CODING_PROFILE
  if (profile.id.trim() === '' || profile.instructions.trim() === '') return undefined
  if (Object.keys(profile.criteria).length < 2) return undefined
  return profile
}

/**
 * 造一个分流服务。
 *
 * @param deps - 判断服务与设置读取器。
 * @returns 可直接 `ctx.provide('typesafeRouter', ...)` 的服务。
 */
export function createRouterService(deps: RouterDeps): TypesafeRouterService {
  return {
    profiles: BUILTIN_PROFILES.map(profile => profile.id),
    async classify(text: string, options?: ClassifyOptions): Promise<RouterVerdict | undefined> {
      const trimmed = text.trim()
      if (trimmed === '') return undefined
      const profile = usableProfile(options?.profile)
      if (profile === undefined) return undefined
      const budget = deps.getSettings().router.timeoutMs
      try {
        const judged = await deps.service.choice(
          `${profile.instructions}\n${trimmed.slice(0, 4000)}\n\`\`\``,
          '这条请求属于哪种工作模式？',
          profile.criteria,
          {
            label: `router:${profile.id}`,
            timeoutMs: budget,
            maxRetries: 0,
            signal: options?.signal ?? AbortSignal.timeout(budget),
          },
        )
        const { choice, confidence, probabilities } = judged.answer
        // 只接受档位里声明过的模式 key：服务端不该冒出第五个选项。
        if (!(choice in profile.criteria)) return undefined
        return {
          mode: choice,
          confidence,
          model: judged.model,
          cached: judged.cached,
          profile: profile.id,
          probabilities: Object.fromEntries(
            Object.keys(profile.criteria).map(key => [key, probabilities[key] ?? 0]),
          ),
        }
      } catch {
        // 分流失败必须让调用方无感：返回 undefined，调用方用回自己的降级路径。
        return undefined
      }
    },
  }
}

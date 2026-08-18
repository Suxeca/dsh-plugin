/**
 * @suxeca/dsh-custom-thinking — host 半：/custom-thinking JSON API。
 * 读取 llm-pi-ai 配置下自定义提供商的模型思考配置，把设置页操作折叠为
 * settings path ops 落盘；浏览器半（exports "./client"）注册设置区块。
 *
 * 问题根源：编曲器模型选择器只在模型带 reasoning 元数据时才显示「思考强度」，
 * 而手写自定义提供商的路由 pi-ai 不对模型推断推理能力——除非配置在其模型条目上
 * 写 `reasoningEfforts`（可选的思考档 + wire 拼写）。本插件为这条路提供 UI。
 *
 * 资源全部挂 ctx.effect（卸载/热重载自动清理）。
 * @module @suxeca/dsh-custom-thinking
 */
import type { Context } from 'cordis'
import type { HostContext } from './host/api.ts'
import { registerCustomThinkingRoutes } from './host/api.ts'

/** 插件 id（name 会被 loader 用作 registry 键）。 */
export const name = '@suxeca/dsh-custom-thinking'

/** 硬依赖：路由表和 settings 服务（llm / webRuntime 通过 ctx.get 可选读）。 */
export const inject = ['webServer', 'settings']

/**
 * 挂载 /custom-thinking 路由。
 * @param ctx - 注入 webServer/settings 的 host 上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => registerCustomThinkingRoutes(ctx as unknown as HostContext),
    '@suxeca/dsh-custom-thinking: /custom-thinking routes',
  )
}

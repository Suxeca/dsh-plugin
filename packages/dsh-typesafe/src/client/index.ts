/**
 * @suxeca/dsh-typesafe — client 半：把设置区块挂进设置面板。
 *
 * 「设置强度」这类插件 UI 的既有做法是：host 侧暴露一个同源 JSON 路由，
 * 浏览器半只负责把组件挂进 `settings.section` 槽位，数据读写全在宿主。
 * 这里沿用同一形状——组件（TypesafeSection）通过 `/typesafe/*` 读写密钥状态与预算，
 * 密钥值只上行不下行。
 *
 * ⚠️ 两个必坑（沿用仓库既有实测结论）：
 * ① 要用 `ctx.slots` 必须 `export const inject = ['slots']`；
 * ② `register` 必须带 `name` 字段（= 槽位名），缺了会报 "slot undefined is not declared"。
 *
 * @module @suxeca/dsh-typesafe/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { TypesafeSection } from './TypesafeSection.tsx'

/** client slots 服务面（结构类型：rc.1 的 ui-slots 没有导出 SlotsService）。 */
interface ClientSlotsService {
  register(
    options: {
      name: string
      id?: string
      order?: number
      label?: string | (() => string)
      inject?: () => Record<string, unknown>
    },
    component: unknown,
  ): () => void
  /** 在槽位声明周期内运行回调（声明未出现时为 no-op）。 */
  inject(key: string, callback: () => () => void): () => void
}

/** client 上下文（slots 已注入）。 */
type SlotsContext = {
  slots: ClientSlotsService
  effect(callback: () => void | (() => void), label?: string): void
}

/** 插件级 DI 声明：不写这一行，`ctx.slots` 不会被解析。 */
export const inject = ['slots']

/**
 * 挂载设置区块：设置面板 → TypeSafe (Jev)。
 *
 * @param ctx - client 上下文。
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx as unknown as SlotsContext
  scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({
    name: 'settings.section',
    id: 'typesafe',
    order: 30,
    label: () => 'TypeSafe (Jev)',
    inject: () => ({}),
  }, TypesafeSection)), '@suxeca/dsh-typesafe: settings section')
}

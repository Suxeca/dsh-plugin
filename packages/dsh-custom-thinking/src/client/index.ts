/**
 * @suxeca/dsh-custom-thinking — client 半：注册「思考强度」设置区块。
 * 构建：npm run build:client（tsdown，产物 lib/client.js，ModuleLoader.load 注册）。
 * ⚠️ 两个必坑（2026-08 实测）：① apply 用 ctx.slots 必须 export const inject
 * = ['slots']（服务注入声明）；② register 必须带 name 字段（= slot 名，
 * 如 settings.section）——缺 name 报 "slot undefined is not declared"。
 *
 * 区块内容（ThinkingSection）经 /custom-thinking JSON API 读写 llm-pi-ai 配置，
 * 数据与写路径全部在宿主；此处只负责把组件挂进设置面板的列表槽位。
 */
import { ThinkingSection } from './ThinkingSection.tsx'

/** client slots 服务面（结构类型；rc.6 的 ui-slots 无 SlotsService 导出，参照 better-sidebar）。 */
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
type ClientContext = {
  slots: ClientSlotsService
  effect(callback: () => void | (() => void), label?: string): void
}

export const inject = ['slots']

/**
 * 挂载设置区块：设置面板 → 思考强度。
 * @param ctx - client 上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'custom-thinking',
      order: 12,
      label: () => '思考强度',
      inject: () => ({}),
    }, ThinkingSection),
  ), '@suxeca/dsh-custom-thinking: settings section')
}

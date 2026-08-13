/**
 * @deepseek-ai/dsh-lab-kit — host half: the workspace-gated project scanner
 * and the /lab-kit/* HTTP routes (JSON operations) on the shared webserver.
 * The browser half (exports "./client") is served by client-modules from the
 * same package's dsh.client declaration.
 *
 * The host half also announces the plugin to every agent through the
 * system-prompt section mechanism, so agents know the research cockpit
 * exists and how to cooperate with it.
 * @module @deepseek-ai/dsh-lab-kit
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerLabKitRoutes } from './host/routes.ts'

/** Required services: the route registry, the workspace registry, and the prompt band. */
export const inject = ['webServer', 'workspaceRegistry', 'systemPrompt']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 220

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const LAB_KIT_GUIDANCE =
  '本机已安装 dsh-lab-kit 插件（DSH Web GUI 的科研台 Lab Cockpit）：侧边栏「研究台」入口展示工作区下的研究项目列表（识别 .git 或 .summary.md 的目录，按最近修改排序）。数据源为当前会话工作区的真实目录扫描，宿主进程经 /lab-kit/projects 路由提供 JSON。用户提到「研究台 / 项目列表 / 项目扫描」时即指本插件，请据此协作。'

/**
 * Mount the project scanner and its routes.
 * @param ctx - context carrying webServer, workspaceRegistry, systemPrompt.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerLabKitRoutes(ctx), 'dsh-lab-kit: /lab-kit routes')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'plugin:lab-kit',
    order: SECTION_ORDER,
    text: LAB_KIT_GUIDANCE,
  }), 'dsh-lab-kit: prompt section')
}

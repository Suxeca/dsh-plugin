/**
 * @suxeca/dsh-plugin-manager — host half: the /plugin-manager/* JSON routes,
 * the pluginManager service, and the /plugin human command. The browser half
 * (exports "./client") renders the 插件管理 settings page.
 *
 * The plugin intentionally registers NO model tool: human commands and HTTP
 * routes never enter the model-visible tool set, so activating or reloading
 * this plugin cannot invalidate prompt-cache prefixes mid-turn.
 * @module @suxeca/dsh-plugin-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-commands'
import { registerPluginCommand } from './host/command.ts'
import { installBundle, listBundles, uninstallBundle } from './host/manager.ts'
import { registerPluginManagerRoutes } from './host/routes.ts'

/** Required services: the route registry. */
export const inject = ['webServer']

/**
 * Mount the plugin manager: routes, service and command.
 * @param ctx - context carrying webServer (and optionally commands).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerPluginManagerRoutes(ctx), 'plugin-manager: /plugin-manager routes')

  // Public service for other plugins and future model tools (same shape as
  // the dynamic prototype's ctx.pluginManager).
  ctx.effect(
    () => ctx.provide('pluginManager', { list: listBundles, install: installBundle, uninstall: uninstallBundle }),
    'plugin-manager: pluginManager service',
  )

  const commands = ctx.get('commands')
  if (commands !== undefined) {
    ctx.effect(() => registerPluginCommand(commands), 'plugin-manager: /plugin command')
  }
}

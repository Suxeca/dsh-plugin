/**
 * Client bundle entry: the 插件管理 settings page (settings.section slot).
 * Reads /plugin-manager/list and posts install/uninstall to the host routes.
 *
 * Failure policy: registration problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 * @module @suxeca/dsh-plugin-manager/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement, type ReactNode } from 'react'
import { PluginManagerPage } from './page.tsx'

/** Mount the settings section entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const slots = ctx.get('slots') as
      | {
          inject(key: string, callback: () => unknown): () => void
          register(registration: { name: string; id: string; order?: number; label?: string | (() => string) }, renderer: () => unknown): unknown
        }
      | undefined
    if (slots === undefined) {
      ctx.logger.warn('plugin-manager: slots service unavailable, settings page not mounted')
      return () => {}
    }
    return slots.inject('settings.section', () =>
      slots.register(
        { name: 'settings.section', id: 'plugin-manager', order: 40, label: () => '插件管理' },
        (): ReactNode => createElement(PluginManagerPage, null),
      ),
    )
  }, 'plugin-manager: settings page')
}

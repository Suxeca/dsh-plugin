/**
 * The /plugin human command: list / install / uninstall / status for the web
 * profile's bundle plugins. Registered through ctx.commands, so it executes
 * without a model turn (and never enters the model-visible tool set — the
 * prompt-cache prefix stays stable, see discussion #935).
 * @module dsh-plugin-manager/host/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import { defaultProfilePath, installBundle, listBundles, uninstallBundle } from './manager.ts'

const USAGE = [
  'usage: /plugin <verb>',
  '  list                       - list installed bundles',
  '  install <pkg>[@version]   - add a bundle to the profile',
  '  uninstall <pkg>           - remove a bundle from the profile',
  '  status                    - show manager status',
].join('\n')

/**
 * Register the /plugin command on the commands registry.
 * @param commands - the commands service (ctx.get('commands')).
 * @returns the command disposer.
 */
export function registerPluginCommand(commands: Context['commands']): () => void {
  return commands.register({
    name: 'plugin',
    description: 'manage installed plugins (list / install / uninstall / status)',
    input: { hint: 'list | install <pkg>[@ver] | uninstall <pkg> | status' },
    recordInput: false,
    handler: async (invocation) => {
      const input = (invocation.rawInput ?? '').trim()
      const parts = input.split(/\s+/).filter(Boolean)
      const verb = parts[0] ?? ''
      const arg = parts.slice(1).join(' ')
      if (!verb || verb === 'help') return { kind: 'success', text: USAGE }
      if (verb === 'status') {
        return { kind: 'success', text: `plugin-manager: running — profile ${defaultProfilePath()}` }
      }
      if (verb === 'list') {
        const result = await listBundles()
        if (!result.ok) return { kind: 'error', text: result.error.message }
        const lines = [`Profile: ${result.value.path}`]
        if (result.value.bundles.length === 0) lines.push('(no bundles listed)')
        for (const bundle of result.value.bundles) {
          lines.push(`- ${bundle.name}${bundle.version ? `@${bundle.version}` : ''}`)
        }
        return { kind: 'success', text: lines.join('\n') }
      }
      if (verb === 'install') {
        if (!arg) return { kind: 'error', text: 'usage: /plugin install <package>[@version]' }
        const at = arg.lastIndexOf('@')
        const name = at > 0 ? arg.slice(0, at) : arg
        const version = at > 0 ? arg.slice(at + 1) : undefined
        const result = await installBundle(name, version)
        return result.ok ? { kind: 'success', text: result.value } : { kind: 'error', text: result.error.message }
      }
      if (verb === 'uninstall') {
        if (!arg) return { kind: 'error', text: 'usage: /plugin uninstall <package>' }
        const result = await uninstallBundle(arg)
        return result.ok ? { kind: 'success', text: result.value } : { kind: 'error', text: result.error.message }
      }
      return { kind: 'error', text: `unknown verb: ${verb}\n${USAGE}` }
    },
  })
}

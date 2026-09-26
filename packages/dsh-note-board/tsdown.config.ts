/**
 * tsdown preset for @suxeca/dsh-note-board.
 *
 * The client bundle reuses the repository's shared preset
 * (`shared/tsdown.client.ts`), so this plugin converges on the same protocol as
 * every other local UI plugin: a closure factory registered through
 * `window.__ModuleLoader__.load({ id, factory })` that resolves externals from
 * the loader's module table.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-right` deliberately does NOT appear in the
 * externals list: this package imports only *types* from it, which the compiler
 * erases. It is still declared in `dsh.client.inject` so the loader orders it
 * before this bundle at runtime.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` IS a platform module, so the KaTeX
 * Markdown renderer arrives from the shell's module table rather than being
 * bundled — that is the whole reason the board can render TeX without shipping
 * katex itself.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@suxeca/dsh-note-board', ['src/index.ts'])

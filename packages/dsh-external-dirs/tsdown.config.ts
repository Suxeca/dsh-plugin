/**
 * tsdown preset for @suxeca/dsh-external-dirs.
 *
 * The client bundle reuses the repository's shared preset
 * (`shared/tsdown.client.ts`) so every local UI plugin converges on one
 * protocol: a CommonJS closure factory that registers itself through
 * `window.__ModuleLoader__.load({ id, factory })` and resolves externals from
 * the loader's module table. The host half is emitted by `tsc`, not here, and
 * never leaks into the browser bundle (only `type` imports cross, and those
 * erase).
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-right` deliberately does NOT appear in
 * the externals list: this package imports only *types* from it, which the
 * compiler removes, so the client bundle has no runtime edge to it. The
 * package is still declared in `dsh.client.inject` so the loader orders it
 * correctly at runtime.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@suxeca/dsh-external-dirs', ['src/index.ts'])

/**
 * tsdown preset for @dsh-external/dsh-custom-thinking.
 *
 * The browser bundle reuses the repository's shared preset, so this plugin
 * emits the same closure-factory protocol as every other local UI plugin: a
 * CommonJS artifact that registers itself through
 * `window.__ModuleLoader__.load({ id, factory })` and resolves its externals
 * from the loader's module table.
 *
 * Converted from a hand-rolled config during the pnpm-devDependencies
 * migration (2026-09-10). The build previously leaned on a symlink tree that
 * `scripts/build.sh` assembled out of the workspace store, which broke
 * silently whenever that store changed; the dependencies are now declared in
 * `package.json` and installed by pnpm.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@dsh-external/dsh-custom-thinking', ['src/index.ts'])

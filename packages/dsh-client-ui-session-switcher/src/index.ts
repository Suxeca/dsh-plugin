/**
 * @suxeca/dsh-client-ui-session-switcher — host half: intentionally
 * empty. This is a pure UI plugin: the browser half (exports "./client")
 * ships through the package.json `dsh.client` declaration and is served by
 * client-modules from the same package. The empty apply exists so the
 * plugin appears in the host cordis roster / Loader.
 * @module @suxeca/dsh-client-ui-session-switcher
 */

import type { Context } from '@deepseek-ai/cordis'

/** Host plugin body — no host-side behavior for the session switcher plugin. */
export function apply(_ctx: Context): void {}

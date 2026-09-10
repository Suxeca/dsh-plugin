/**
 * @suxeca/dsh-external-dirs — host half.
 *
 * Registers the plugin's persisted settings namespace (the list of external
 * roots) and mounts the listing routes. The routes read the settings scope
 * lazily per request, so adding a root in the UI takes effect immediately.
 *
 * @module @suxeca/dsh-external-dirs
 */
import type { Context } from "@deepseek-ai/cordis"
import Schema from "@deepseek-ai/schemastery"
import { registerExternalDirRoutes } from "./host/routes.ts"

export const name = "@suxeca/dsh-external-dirs"

/**
 * The services this plugin needs. `webServer` and `connection` are what the
 * route module reads through Cordis accessors, so they must be declared here —
 * an accessor only resolves on a context that declared it. `settings` is a
 * hard dependency too: the roots list lives there.
 */
export const inject = ["settings", "webServer", "connection"]

/**
 * Settings namespace owned by this plugin. The provider validates namespaces
 * against /^[a-z][a-z0-9-]*$/, so this is kebab-case — a camelCase name is
 * rejected at register() time and the plugin silently loses its roots store.
 */
export const SETTINGS_NS = "external-dirs"

/** Composition-time configuration for this plugin's row. */
export interface Config {
  /** Namespace the roots list is persisted under. */
  namespace: string
}

export const Config: Schema<Config> = Schema.object({
  namespace: Schema.string().default(SETTINGS_NS),
})

/** Persisted user-layer shape, and its runtime validator. */
const SettingsSchema = Schema.object({
  roots: Schema.array(Schema.string()).default([]),
})

/** Settings scope face this plugin consumes. */
interface SettingsScopeLike {
  get(): { roots?: string[] | undefined }
  update(patch: object): Promise<void>
}

/**
 * Mount the external-directory browser.
 * @param ctx - host context carrying `settings` and `webServer`.
 * @param config - the plugin row's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Routes are registered from the OUTER context, matching how `dsh-pdf-drop`
  // and the official `dsh-host-open-in-app` do it: `webServer` is a Cordis
  // accessor that only resolves on a context whose own injection set declared
  // it, and the outer context is that context here. (Registering from a nested
  // `ctx.inject([...])` callback instead silently yields no accessor and the
  // routes never bind — the plugin still loads, so nothing errors.)
  let scope: SettingsScopeLike | undefined

  ctx.effect(
    () => registerExternalDirRoutes(ctx, { settings: () => scope }),
    "@suxeca/dsh-external-dirs: routes",
  )

  // Settings are a separate concern: the routes read the scope lazily per
  // request, so registering them before `settings` is live is fine, and a
  // deployment that never provides `settings` still gets a mountable plugin
  // rather than an unparked one.
  ctx.inject(["settings"], (settingsCtx) => {
    try {
      scope = (settingsCtx as unknown as {
        settings: { register(ns: string, schema: unknown, options?: object): SettingsScopeLike }
      }).settings.register(config.namespace, SettingsSchema, { applies: "live" })
    } catch (error) {
      // `register` validates the namespace against /^[a-z][a-z0-9-]*$/ and the
      // schema shape. Failing silently here costs the plugin its roots store
      // while everything else keeps working, so say it out loud.
      console.error(
        "[dsh-external-dirs] settings registration failed — external roots will not persist:",
        error instanceof Error ? error.message : String(error),
      )
    }
  })
}

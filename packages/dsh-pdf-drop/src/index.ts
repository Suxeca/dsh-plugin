import type { Context } from "@deepseek-ai/cordis"
import { registerPdfDropRoutes, type HostContext } from "./host/routes.ts"

export const name = "@suxeca/dsh-pdf-drop"
export const inject = ["webServer"]

export function apply(ctx: Context): void {
  ctx.effect(() => registerPdfDropRoutes(ctx as HostContext), "pdf-drop: /pdf-drop/upload route")
}

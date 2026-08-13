/**
 * /lab-kit/* route layer: JSON envelope (ok/error) for the project scan.
 * The service owns scanning; this layer owns HTTP shape.
 * @module dsh-lab-kit/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ProjectSummary } from './projects-service.ts'
import { scanProjects } from './projects-service.ts'

/** The JSON envelope every lab-kit route answers with. */
export type LabKitEnvelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** The /lab-kit/projects payload. */
export interface ProjectsValue {
  /** Absolute root paths of the scanned workspaces. */
  roots: string[]
  /** Scanned research projects, newest first. */
  projects: ProjectSummary[]
}

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: LabKitEnvelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Register the /lab-kit routes on the shared webserver.
 * @param ctx - context carrying the webServer service.
 * @returns the route disposers (unwound on plugin unload).
 */
export function registerLabKitRoutes(ctx: Context): () => void {
  const handler = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const projects = await scanProjects(ctx)
      json(res, {
        ok: true,
        value: {
          roots: ctx.workspaceRegistry.list().map((workspace) => workspace.path),
          projects,
        },
      })
    } catch (error: unknown) {
      ctx.logger.warn(`dsh-lab-kit: project scan failed: ${String(error)}`)
      json(res, { ok: false, error: { code: 'scan-failed', message: String(error) } }, 500)
    }
  }
  return ctx.webServer.register({ kind: 'prefix', path: '/lab-kit', handler })
}

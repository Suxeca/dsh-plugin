/**
 * /plugin-manager/* HTTP route layer: JSON envelope around the manager core,
 * consumed by the browser settings page (fetch) and anything else that can
 * reach the local web server.
 *
 * Trust boundary: these routes are unauthenticated, like every other local
 * GUI route — deployments must only expose the host gateway to trusted
 * parties (see the message-feedback contract's own caller-boundary note).
 * @module dsh-plugin-manager/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installBundle, listBundles, uninstallBundle } from './manager.ts'

/** The JSON envelope every plugin-manager route answers with. */
export type PmEnvelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: PmEnvelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** Collect and parse a small JSON request body. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Register the /plugin-manager routes on the shared webserver.
 * @param ctx - context carrying the webServer service.
 * @returns the route disposers (unwound on plugin unload).
 */
export function registerPluginManagerRoutes(ctx: Context): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = url.pathname.replace(/^\/plugin-manager/, '') || '/'
      if (req.method === 'GET' && pathname === '/list') {
        const result = await listBundles()
        if (result.ok) json(res, { ok: true, value: { path: result.value.path, bundles: result.value.bundles } })
        else json(res, { ok: false, error: result.error }, 500)
        return
      }
      if (req.method === 'POST' && (pathname === '/install' || pathname === '/uninstall')) {
        const body = await readBody(req)
        const name = typeof body.name === 'string' ? body.name : ''
        const version = typeof body.version === 'string' && body.version ? body.version : undefined
        const result = pathname === '/install' ? await installBundle(name, version) : await uninstallBundle(name)
        if (result.ok) json(res, { ok: true, value: { message: result.value } })
        else json(res, { ok: false, error: result.error }, 400)
        return
      }
      json(res, { ok: false, error: { code: 'not-found', message: `no such route: ${req.method} ${pathname}` } }, 404)
    } catch (error: unknown) {
      ctx.logger.warn(`dsh-plugin-manager: route failed: ${String(error)}`)
      json(res, { ok: false, error: { code: 'internal', message: String(error) } }, 500)
    }
  }
  return ctx.webServer.register({ kind: 'prefix', path: '/plugin-manager', handler })
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LiteratureLibrary, loadCatalog } from './library.js'

interface Route { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }
interface PluginContext {
  get(name: 'webServer'): { register(route: Route): () => void }
  get(name: 'connection'): { requestRejection(req: IncomingMessage): 401 | 403 | undefined }
  effect(factory: () => () => void): void
}
export const name = '@suxeca/dsh-literature-library'
export const inject = ['webServer', 'connection']
export interface Config { libraryRoot?: string; catalogPath?: string; pagePath?: string }
/** The three paths after resolution; every field is concrete. */
export interface ResolvedPaths { libraryRoot: string; catalogPath: string; pagePath: string }

/**
 * Resolve the library paths at runtime, so no machine-specific absolute path is
 * ever baked into the shipped bundle patch. Priority:
 *
 *   1. an explicit config key, then DSH_LITERATURE_ROOT for the whole root
 *   2. ~/Workspace/docs/literature, when it already exists on disk (the layout
 *      this plugin was authored against, so an existing install is untouched)
 *   3. ~/.dsh/literature, the portable default for a fresh machine
 */
export function resolvePaths(config: Config = {}): ResolvedPaths {
  const home = homedir()
  const envRoot = process.env.DSH_LITERATURE_ROOT
  const authoredRoot = join(home, 'Workspace', 'docs', 'literature')
  const portableRoot = join(home, '.dsh', 'literature')
  const root = envRoot !== undefined && envRoot.length > 0
    ? envRoot
    : existsSync(authoredRoot) ? authoredRoot : portableRoot
  return {
    libraryRoot: config.libraryRoot ?? join(root, 'library'),
    catalogPath: config.catalogPath ?? join(root, 'library', 'catalog.json'),
    pagePath: config.pagePath ?? join(root, 'library-page.html'),
  }
}

function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}
/** Bounded JSON parser; caller may select catalog ids but never supply paths. */
async function body(req: IncomingMessage): Promise<{ id: string; selected: boolean }> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('JSON required')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2048) throw new Error('Request too large')
    chunks.push(buffer)
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!data || typeof data.id !== 'string' || typeof data.selected !== 'boolean'
    || Object.keys(data).some(key => !['id', 'selected'].includes(key))) throw new Error('Invalid request')
  return data
}
/** Authenticated first-party page: visualization iframes intentionally cannot call network APIs. */
export async function apply(ctx: PluginContext, config: Config = {}): Promise<void> {
  const paths = resolvePaths(config)
  let library: LiteratureLibrary
  try {
    library = new LiteratureLibrary(paths.libraryRoot, await loadCatalog(paths.catalogPath))
  } catch (error) {
    // A machine without a catalog must not take the host down with it: report the
    // resolved paths and register nothing, so the fix is obvious and local.
    const reason = error instanceof Error ? error.message : String(error)
    console.error(
      '@suxeca/dsh-literature-library: catalog unavailable at ' + paths.catalogPath
      + ' (' + reason + '). Set DSH_LITERATURE_ROOT or the libraryRoot/catalogPath/pagePath'
      + ' config keys to an existing library; this plugin is inactive until then.',
    )
    return
  }
  const server = ctx.get('webServer')
  const connection = ctx.get('connection')
  const authenticate = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return true
    send(res, rejection, { ok: false, error: 'Authentication required' })
    return false
  }
  ctx.effect(() => server.register({ kind: 'exact', path: '/literature-library/state', handler: async (req, res) => {
    if (!authenticate(req, res)) return
    try {
      if (req.method === 'GET') { send(res, 200, { ok: true, data: await library.snapshot() }); return }
      if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'GET or POST required' }); return }
      const origin = req.headers.origin
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin !== undefined && new URL(origin).host !== req.headers.host)) {
        send(res, 403, { ok: false, error: 'Cross-origin write denied' }); return
      }
      const data = await body(req)
      send(res, 200, { ok: true, data: await library.select(data.id, data.selected) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Library operation failed'
      send(res, /Invalid|Unknown|JSON required|too large/.test(message) ? 400 : 500, { ok: false, error: message })
    }
  } }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/literature-library', handler: async (req, res) => {
    if (!authenticate(req, res)) return
    if (req.method !== 'GET') { send(res, 405, { ok: false }); return }
    try {
      const page = await readFile(paths.pagePath, 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'" })
      res.end(page)
    } catch { send(res, 503, { ok: false, error: 'Library page unavailable' }) }
  } }))
}

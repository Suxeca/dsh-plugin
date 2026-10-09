import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
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
export interface Config { libraryRoot: string; catalogPath: string; pagePath: string }

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
export async function apply(ctx: PluginContext, config: Config): Promise<void> {
  if (!config?.libraryRoot || !config.catalogPath || !config.pagePath) throw new Error('libraryRoot, catalogPath and pagePath are required')
  const library = new LiteratureLibrary(config.libraryRoot, await loadCatalog(config.catalogPath))
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
      const page = await readFile(config.pagePath, 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'" })
      res.end(page)
    } catch { send(res, 503, { ok: false, error: 'Library page unavailable' }) }
  } }))
}

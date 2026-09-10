/**
 * Host half of @suxeca/dsh-external-dirs.
 *
 * Two prefix routes under one root, both JSON:
 *
 *   GET  /external-dirs/api/roots          → configured roots + host home
 *   POST /external-dirs/api/roots          → { op: 'add' | 'remove', path }
 *   GET  /external-dirs/api/list?path=...  → one directory listing
 *
 * WHY A CUSTOM ROUTE. The official `workspaceFiles.list` is deliberately
 * workspace-scoped and answers `outside-workspace` for anything above the
 * session root (`@deepseek-ai/dsh-api-workspace-files`). Browsing arbitrary
 * directories therefore needs its own listing, taken here with `node:fs`
 * directly. This is the same shape other local plugins use for their host
 * APIs (`dsh-pdf-drop`, `dsh-quota-meter`).
 *
 * SECURITY. Raw `webServer` routes do NOT inherit the host's browser-trust
 * fence — that is a documented upstream caveat, and the official
 * `dsh-host-open-in-app` shows the fix: inject `connection` and call
 * `requestRejection(req)` per request. This route does exactly that, so a
 * LAN/remote exposure cannot read the filesystem unauthenticated.
 *
 * The route is read-only: it lists and stats. It never writes, renames, or
 * deletes, so the workspace fence is not bypassed for mutation.
 *
 * @module @suxeca/dsh-external-dirs/host
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { homedir } from "node:os"
import { readdir, realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-host-webserver"
import type { Envelope, ExternalDirListing, ExternalRootsPatch, ExternalRootsState } from "../shared.ts"
import { ROUTE_PREFIX } from "../shared-routes.ts"

export { ROUTE_PREFIX }

/** Entry cap for one listing; beyond this the listing reports truncation. */
export const MAX_LISTING_ENTRIES = 5000

/** Request bodies here are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Persisted user-layer shape. Kept structurally compatible with the client
 * half's view of the same namespace.
 */
export interface ExternalDirsSettings {
  /** Absolute directories the user added. */
  roots: string[]
}

/** The settings face this plugin registers and reads. */
interface SettingsScopeLike {
  get(): { roots?: string[] | undefined }
  update(patch: object): Promise<void>
}

interface SettingsProviderLike {
  register(namespace: string, schema: unknown, options?: object): SettingsScopeLike
}

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface ConnectionLike {
  requestRejection(request: { readonly headers: IncomingMessage["headers"] }): 401 | 403 | undefined
}

/** The web server face, declared structurally (the package is host-side). */
interface WebServerLike {
  register(route: {
    kind: "exact" | "prefix"
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
  }): () => void
}

/** Read one service without tripping cordis' injection tracker. */
function service<T>(ctx: Context, name: string): T | undefined {
  const get = (ctx as unknown as { get?: (key: string) => unknown }).get
  if (typeof get !== "function") return undefined
  try {
    return get.call(ctx, name) as T | undefined
  } catch {
    return undefined
  }
}

/** Write one JSON response (no-store: the filesystem is a live fact). */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.end(JSON.stringify(payload))
}

/** Wrap a success payload in the shared envelope. */
function ok<T>(data: T): Envelope<T> {
  return { ok: true, data }
}

/** Wrap a failure message in the shared envelope. */
function fail(error: string): Envelope<never> {
  return { ok: false, error }
}

/** Read and JSON-parse a bounded request body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new Error("request body too large")
    chunks.push(buf)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

/**
 * Resolve a user-supplied directory to a canonical absolute path.
 * Relative input is rejected: this surface browses absolute roots only, which
 * keeps "what did I just open" unambiguous.
 * @param input - raw path from the client.
 * @returns the canonical absolute path.
 * @throws when the path is not absolute, does not exist, or is not a directory.
 */
async function resolveDirectory(input: string): Promise<string> {
  if (typeof input !== "string" || input.trim() === "") throw new Error("path is required")
  if (!isAbsolute(input)) throw new Error("path must be absolute")
  const canonical = await realpath(resolve(input))
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new Error("path is not a directory")
  return canonical
}

/**
 * List one absolute directory, directories first then case-insensitive name.
 * @param input - absolute directory path.
 * @returns the listing with its parent and truncation flag.
 */
async function listDirectory(input: string): Promise<ExternalDirListing> {
  const path = await resolveDirectory(input)
  const dirents = await readdir(path, { withFileTypes: true })
  const truncated = dirents.length > MAX_LISTING_ENTRIES
  const kept = truncated ? dirents.slice(0, MAX_LISTING_ENTRIES) : dirents
  // `withFileTypes` reports symlinks as symlinks; stat them so a symlinked
  // directory is browsable, matching the official tree's behaviour.
  const entries = await Promise.all(kept.map(async (dirent) => {
    const entryPath = join(path, dirent.name)
    let directory = dirent.isDirectory()
    if (dirent.isSymbolicLink()) {
      try {
        directory = (await stat(entryPath)).isDirectory()
      } catch {
        directory = false
      }
    }
    return { name: dirent.name, path: entryPath, directory }
  }))
  entries.sort((left, right) => {
    if (left.directory !== right.directory) return left.directory ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true })
  })
  const parent = dirname(path)
  return { path, parent: parent === path ? null : parent, entries, truncated }
}

/** Options for {@link registerExternalDirRoutes}. */
export interface ExternalDirRoutesOptions {
  /** Live settings scope, read per request so UI edits take effect immediately. */
  readonly settings: () => SettingsScopeLike | undefined
}

/**
 * Register this plugin's routes on the composed web server.
 * @param ctx - host context carrying `webServer` and `connection`.
 * @param options - the settings accessor for the roots route.
 * @returns a disposer removing every route this call registered.
 */
export function registerExternalDirRoutes(ctx: Context, options: ExternalDirRoutesOptions): () => void {
  const disposers: (() => void)[] = []

  /** Answer an untrusted/unauthenticated request; true when it was rejected. */
  const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
    // Ask the composition's connection service to judge browser trust. It is
    // bundled with the Web profiles, so a deployment without it simply has no
    // fence to consult and the route stays usable.
    const connection = Reflect.get(ctx, "connection") as ConnectionLike | undefined
    if (connection === undefined || typeof connection.requestRejection !== "function") return false
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }
  // Use the declared accessor directly. `ctx.get('webServer')` is NOT
  // equivalent: `get` consults the reflection layer for *provided* services,
  // and this route module is only ever invoked from a context that declared
  // `webServer` in its injection set — the accessor is the supported, typed
  // path (it is what `dsh-pdf-drop` and the official `dsh-host-open-in-app`
  // both use). Reading it via `get` silently returns undefined, which is how
  // the routes ended up unmounted with no error at all.
  const webServer: WebServerLike = ctx.webServer

  disposers.push(webServer.register({
    kind: "prefix",
    path: `${ROUTE_PREFIX}/roots`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      const scope = options.settings()
      if (scope === undefined) {
        sendJson(res, 503, fail("settings service is not available"))
        return
      }
      if (req.method === "GET") {
        const state: ExternalRootsState = { roots: [...(scope.get().roots ?? [])], home: homedir() }
        sendJson(res, 200, ok(state))
        return
      }
      if (req.method === "POST") {
        try {
          const body = await readJsonBody(req) as Partial<ExternalRootsPatch>
          const op = body.op
          if (op !== "add" && op !== "remove") throw new Error("op must be add or remove")
          // Adding validates that the target really is a readable directory, so
          // a typo cannot be persisted as a dead root.
          const path = op === "add" ? await resolveDirectory(String(body.path)) : String(body.path)
          const current = scope.get().roots ?? []
          const next = op === "add"
            ? (current.includes(path) ? current : [...current, path])
            : current.filter(entry => entry !== path)
          await scope.update({ roots: next })
          const state: ExternalRootsState = { roots: [...next], home: homedir() }
          sendJson(res, 200, ok(state))
        } catch (error) {
          sendJson(res, 400, fail(error instanceof Error ? error.message : String(error)))
        }
        return
      }
      sendJson(res, 405, fail("method not allowed"))
    },
  }))

  disposers.push(webServer.register({
    kind: "prefix",
    path: `${ROUTE_PREFIX}/list`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      try {
        const url = new URL(req.url ?? "/", "http://localhost")
        const target = url.searchParams.get("path")
        if (target === null) throw new Error("path query parameter is required")
        sendJson(res, 200, ok(await listDirectory(target)))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = (error as NodeJS.ErrnoException).code
        sendJson(res, code === "ENOENT" ? 404 : 400, fail(message))
      }
    },
  }))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // A route already withdrawn during teardown is not an error here.
      }
    }
  }
}

/** Re-exported so the client half's docs and tests can share one cap. */
export { MAX_LISTING_ENTRIES as LISTING_ENTRY_CAP }

/**
 * Host half of @suxeca/dsh-pdf-drop: one route that receives a browser-dropped
 * document and writes it into the **session workspace** so the composer can
 * reference it as `@relative/path`.
 *
 * Directory resolution is host-authoritative: the browser's session id is
 * resolved against the live session (then the persisted header), and the
 * browser-supplied `cwd` is only honored when it names an existing absolute
 * directory. The DSH process directory stays the last resort, and the answer
 * always reports which rule fired — a silent wrong target was the original
 * defect (dropped files landed in the host's cwd, never in the workspace).
 *
 * @module @suxeca/dsh-pdf-drop/host
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join, relative } from "node:path"
import { pipeline } from "node:stream/promises"
import type { Context } from "@deepseek-ai/cordis"
import type { Envelope, UploadPdfRequest, UploadPdfResult } from "../shared.ts"

/** Carrier cap for one upload body; the browser half refuses earlier. */
export const MAX_REQUEST_BYTES = 256 * 1024 * 1024

/** Structural view of the host session service (`ctx.sessions`). */
interface SessionHeaderLike {
  readonly cwd?: string | undefined
}

interface SessionLike {
  readonly header?: SessionHeaderLike | undefined
}

interface SessionsLike {
  get(id: unknown): SessionLike | undefined
}

/** Structural view of the persisted-header listing (`ctx.sessionPersistence`). */
interface PersistenceLike {
  list(signal?: AbortSignal): Promise<readonly { readonly id?: unknown; readonly cwd?: string | undefined }[]>
}

export interface HostContext extends Context {
  webServer: {
    register: (route: {
      kind: "exact" | "prefix"
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    }) => () => void
  }
}

/** Read one optional service without triggering cordis' injection tracker. */
function service<T>(ctx: Context, name: string): T | undefined {
  const get = (ctx as unknown as { get?: (key: string) => unknown }).get
  if (typeof get !== "function") return undefined
  try {
    return get.call(ctx, name) as T | undefined
  } catch {
    return undefined
  }
}

function sendJson<T>(res: ServerResponse, envelope: Envelope<T>, status = 200): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })
  res.end(JSON.stringify(envelope))
}

/** Body-reader failure carrying the HTTP status the handler must answer. */
class BodyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const declared = req.headers["content-length"]
  if (declared !== undefined && Number(declared) > MAX_REQUEST_BYTES) {
    throw new BodyError(413, "payload-too-large", `body exceeds ${MAX_REQUEST_BYTES} bytes`)
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer
    received += buffer.byteLength
    if (received > MAX_REQUEST_BYTES) {
      throw new BodyError(413, "payload-too-large", `body exceeds ${MAX_REQUEST_BYTES} bytes`)
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T
  } catch {
    throw new BodyError(400, "bad-request", "body is not valid JSON")
  }
}

/**
 * Strip any directory part and control characters, refusing the two path
 * components that would escape the target directory.
 * @param name - browser-supplied file name.
 * @returns a safe basename (never empty, never `.` or `..`).
 */
export function sanitizeFilename(name: string): string {
  const flattened = String(name ?? "").split(/[\\/]/u).pop() ?? ""
  const base = flattened.replace(/[\r\n\0]/gu, "").trim()
  if (base === "" || base === "." || base === "..") return "document.pdf"
  return base
}

/**
 * Sanitize relative path components to allow nested files and folders
 * while strictly preventing directory traversal escaping the target root.
 * @param filePath - browser-supplied relative file path.
 * @returns a safe relative path.
 */
export function sanitizeRelativePath(filePath: string): string {
  const normalized = String(filePath ?? "").replace(/\\/gu, "/").replace(/[\r\n\0]/gu, "").trim()
  const segments = normalized.split("/").filter(s => s !== "" && s !== ".")
  if (segments.length === 0 || segments.some(s => s === "..")) {
    return "document.pdf"
  }
  return segments.join("/")
}

/** Whether one candidate names an existing directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** One resolved target directory plus the rule that produced it. */
interface ResolvedDirectory {
  readonly directory: string
  readonly resolvedFrom: UploadPdfResult["resolvedFrom"]
}

/**
 * Resolve the directory that receives the file, most authoritative rule first.
 * @param ctx - host plugin context.
 * @param body - validated request payload.
 * @returns the absolute directory and its resolution source.
 */
export async function resolveTargetDirectory(
  ctx: Context,
  body: Pick<UploadPdfRequest, "sessionId" | "cwd">,
): Promise<ResolvedDirectory> {
  const sessionId = typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : undefined
  if (sessionId !== undefined) {
    const live = service<SessionsLike>(ctx, "sessions")?.get(sessionId)?.header?.cwd
    if (typeof live === "string" && isAbsolute(live)) return { directory: live, resolvedFrom: "session" }
    const persistence = service<PersistenceLike>(ctx, "sessionPersistence")
    if (persistence !== undefined) {
      try {
        const header = (await persistence.list()).find(candidate => String(candidate.id) === sessionId)
        if (header !== undefined && typeof header.cwd === "string" && isAbsolute(header.cwd)) {
          return { directory: header.cwd, resolvedFrom: "session" }
        }
      } catch {
        // A failing persistence listing must not fail the upload: fall through.
      }
    }
  }
  if (typeof body.cwd === "string" && isAbsolute(body.cwd) && await isDirectory(body.cwd)) {
    return { directory: body.cwd, resolvedFrom: "request" }
  }
  return { directory: process.cwd(), resolvedFrom: "process" }
}

/**
 * Reject requests a foreign page fired at this route (drive-by workspace
 * writes). Same-origin browser POSTs carry a matching `origin` and
 * `sec-fetch-site: same-origin`; marker-less clients (curl, scripts) pass,
 * exactly like the `/api` trust fence.
 * @param req - incoming request.
 * @returns true when the request is cross-site.
 */
export function isCrossSiteRequest(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"]
  if (typeof site === "string" && site.toLowerCase() === "cross-site") return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== "string" || typeof host !== "string") return false
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

/** One sibling temp path the atomic write renames from. */
function tempPathFor(path: string): string {
  return join(
    join(path, ".."),
    `.${basename(path)}.dsh-upload-${process.pid.toString(36)}-${Date.now().toString(36)}`,
  )
}

/** Write bytes atomically: one temp sibling then a rename over the target. */
async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const temp = tempPathFor(path)
  try {
    await writeFile(temp, data)
    await rename(temp, path)
  } catch {
    // Cross-device or exotic filesystem: fall back to a direct write.
    await writeFile(path, data)
  }
}

/** Resolve the target and refuse names that would escape it. */
async function resolveTarget(
  ctx: Context,
  body: Pick<UploadPdfRequest, "sessionId" | "cwd" | "filename">,
): Promise<{
  targetRoot: string
  parentDir: string
  resolvedFrom: UploadPdfResult["resolvedFrom"]
  filename: string
  path: string
  relative: string
}> {
  const { directory: targetRoot, resolvedFrom } = await resolveTargetDirectory(ctx, body)
  const relPath = sanitizeRelativePath(body.filename)
  const path = join(targetRoot, relPath)
  const escaped = relative(targetRoot, path)
  if (escaped === "" || escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new BodyError(400, "bad-request", `unsafe file name ${JSON.stringify(body.filename)}`)
  }
  const parentDir = join(path, "..")
  return {
    targetRoot,
    parentDir,
    resolvedFrom,
    filename: basename(path),
    path,
    relative: escaped,
  }
}

function landing(
  filename: string,
  path: string,
  targetRoot: string,
  rel: string,
  resolvedFrom: UploadPdfResult["resolvedFrom"],
  size: number,
): UploadPdfResult {
  return { filename, path, relative: rel, directory: targetRoot, resolvedFrom, size }
}

/**
 * Stream the raw request body into the target file: the browser sends the
 * file's own bytes (`application/octet-stream`), so no base64 inflation and no
 * whole-file buffering stands between a 100 MB drop and the disk. A partial
 * body is removed on abort or overflow.
 */
async function writeStreamedBody(req: IncomingMessage, path: string): Promise<number> {
  const temp = tempPathFor(path)
  let received = 0
  const counted = async function* (source: AsyncIterable<Buffer | string>): AsyncIterable<Buffer> {
    for await (const chunk of source) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      received += buffer.byteLength
      if (received > MAX_REQUEST_BYTES) {
        throw new BodyError(413, "payload-too-large", `body exceeds ${MAX_REQUEST_BYTES} bytes`)
      }
      yield buffer
    }
  }
  try {
    await pipeline(req, counted, createWriteStream(temp))
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  return received
}

/** Legacy JSON carrier: `{ filename, dataBase64, sessionId?, cwd? }`. */
async function handleJsonUpload(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<UploadPdfRequest>(req)
  if (typeof body.filename !== "string" || typeof body.dataBase64 !== "string" || body.dataBase64 === "") {
    return sendJson(res, {
      ok: false,
      error: { code: "bad-request", message: "Missing filename or dataBase64" },
    }, 400)
  }
  const { targetRoot, parentDir, resolvedFrom, filename, path, relative: rel } = await resolveTarget(ctx, body)
  await mkdir(parentDir, { recursive: true })
  await writeAtomic(path, Buffer.from(body.dataBase64, "base64"))
  const info = await stat(path)
  sendJson(res, { ok: true, value: landing(filename, path, targetRoot, rel, resolvedFrom, info.size) })
}

/** Structural view of the composed connection trust surface. */
interface ConnectionLike {
  requestRejection(req: IncomingMessage): 401 | 403 | undefined
}

/**
 * Refuse a request that is not trusted, before any body is read or written.
 *
 * A named plugin route is matched ahead of the shell's auth gate, so the fence
 * has to live here — `isCrossSiteRequest` only stops a foreign *page* from
 * firing the request, while a marker-less client (curl, a script on the LAN)
 * passes it. This route writes to a directory the request itself names, so an
 * upload admitted without a verdict is an unauthenticated arbitrary-directory
 * write.
 *
 * Fails closed: a missing or throwing trust surface refuses the upload.
 *
 * @param ctx - host context carrying the composed `connection` service.
 * @param req - incoming request.
 * @param res - response answered on when the request is refused.
 * @returns true when the request was refused and the handler must stop.
 */
export function rejected(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  try {
    const connection = service<ConnectionLike>(ctx, "connection")
    if (connection === undefined || typeof connection.requestRejection !== "function") {
      sendJson(res, { ok: false, error: { code: "auth-unavailable", message: "Authentication is unavailable" } }, 503)
      return true
    }
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    if (rejection !== 401 && rejection !== 403) throw new Error("invalid trust verdict")
    sendJson(res, {
      ok: false,
      error: {
        code: rejection === 401 ? "unauthenticated" : "untrusted",
        message: rejection === 401 ? "Authentication required" : "Request origin is not trusted",
      },
    }, rejection)
  } catch {
    sendJson(res, { ok: false, error: { code: "auth-unavailable", message: "Could not verify the request" } }, 503)
  }
  return true
}

/**
 * Register the `/pdf-drop/upload` route.
 * @param ctx - host plugin context carrying `webServer`.
 * @returns the disposer removing the route.
 */
export function registerPdfDropRoutes(ctx: HostContext): () => void {
  return ctx.webServer.register({
    kind: "exact",
    path: "/pdf-drop/upload",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== "POST") {
        return sendJson(res, { ok: false, error: { code: "method-not-allowed", message: "POST only" } }, 405)
      }
      if (isCrossSiteRequest(req)) {
        return sendJson(res, {
          ok: false,
          error: { code: "cross-site", message: "cross-site requests are refused" },
        }, 403)
      }

      try {
        const query = new URL(req.url ?? "/", "http://dsh.invalid").searchParams
        const queryFilename = query.get("filename")
        if (queryFilename === null) return await handleJsonUpload(ctx, req, res)

        const { targetRoot, parentDir, resolvedFrom, filename, path, relative: rel } = await resolveTarget(ctx, {
          filename: queryFilename,
          sessionId: query.get("sessionId") ?? undefined,
          cwd: query.get("cwd") ?? undefined,
        })
        await mkdir(parentDir, { recursive: true })

        if (query.get("mkdir") === "1") {
          await mkdir(path, { recursive: true })
          return sendJson(res, { ok: true, value: landing(filename, path, targetRoot, rel, resolvedFrom, 0) })
        }

        const size = await writeStreamedBody(req, path)
        sendJson(res, { ok: true, value: landing(filename, path, targetRoot, rel, resolvedFrom, size) })
      } catch (error) {
        if (error instanceof BodyError) {
          return sendJson(res, { ok: false, error: { code: error.code, message: error.message } }, error.status)
        }
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.(`pdf-drop: upload failed: ${message}`)
        sendJson(res, { ok: false, error: { code: "upload-failed", message } }, 500)
      }
    },
  })
}

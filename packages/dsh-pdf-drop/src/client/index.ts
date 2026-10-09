/**
 * @suxeca/dsh-pdf-drop client half: global drag-and-drop intake for the DSH
 * Web UI. Dropped PDFs and other non-image documents are streamed to the
 * host's `/pdf-drop/upload` route, which writes them into the **current
 * session workspace**, and the returned path is inserted into the composer as
 * an `@mention` so the agent can read the file.
 *
 * Two facts drive the implementation:
 *
 * 1. The current DSH composer is a Lexical `contenteditable` carrying
 *    `data-composer-input`, not a `<textarea>`. Writing `.value` there is a
 *    no-op, so insertion goes through the composer's own paste path (a
 *    synthetic `paste` event with `text/plain`, the exact gesture the bar
 *    handles), with `document.execCommand('insertText')` and the legacy
 *    textarea setter as ordered fallbacks — each verified against the live
 *    draft text before the next one runs.
 * 2. The host cannot know which session a browser tab is looking at, so the
 *    browser sends the current session id (and its workspace directory) with
 *    every upload. Without it the host falls back to its process directory —
 *    the old behavior that silently parked dropped files outside the
 *    workspace.
 *
 * @module @suxeca/dsh-pdf-drop/client
 */
import type { Envelope, UploadPdfResult } from "../shared.ts"

export const STYLE_ID = "@suxeca/dsh-pdf-drop/styles"

/** Largest file the browser half will send (host carrier cap is 256 MiB of body). */
export const MAX_UPLOAD_BYTES = 160 * 1024 * 1024

const TOAST_CSS = `
.dsh-pdf-drop-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(70vw, 460px);
  padding: 10px 16px;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #f0f4fc;
  background: #1c2230;
  border: 1px solid #3b4866;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  animation: dsh-pdf-drop-fade-in 0.2s ease-out;
  cursor: pointer;
  user-select: none;
  word-break: break-all;
}
.dsh-pdf-drop-toast:hover {
  background: #242c3d;
  border-color: #4f6188;
}
.dsh-pdf-drop-toast-error {
  border-color: #e06c6c;
  color: #ffd6d6;
  background: #2a1818;
}
.dsh-pdf-drop-toast-error:hover {
  background: #361f1f;
  border-color: #f08282;
}
@keyframes dsh-pdf-drop-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
`

/** Toast severity, deciding the accent class. */
type ToastKind = "info" | "error"

/** Live toast handle: the progress toasts are sticky and dismissed explicitly or after timeout. */
interface ToastHandle {
  update(message: string, kind?: ToastKind, durationMs?: number): void
  dismiss(): void
}

/**
 * Show one toast. `durationMs = 0` keeps it on screen until dismissed or updated with a duration.
 * Clicking the toast dismisses it immediately.
 * @param message - text to display.
 * @param kind - severity accent.
 * @param durationMs - auto-dismiss delay in ms; 0 = sticky.
 * @returns the live handle.
 */
function showToast(message: string, kind: ToastKind = "info", durationMs = 3000): ToastHandle {
  let element: HTMLDivElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const dismiss = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (element === null) return
    element.style.opacity = "0"
    element.style.transform = "translateY(8px)"
    element.style.transition = "opacity 0.25s ease, transform 0.25s ease"
    const el = element
    element = null
    setTimeout(() => { el.remove() }, 300)
  }
  const arm = (ms: number): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (ms > 0) timer = setTimeout(dismiss, ms)
  }

  try {
    element = document.createElement("div")
    element.className = `dsh-pdf-drop-toast ${kind === "error" ? "dsh-pdf-drop-toast-error" : ""}`
    element.textContent = message
    element.title = "点击关闭"
    element.onclick = () => { dismiss() }
    document.body.appendChild(element)
    arm(durationMs)
  } catch {
    return { update: () => {}, dismiss: () => {} }
  }

  return {
    update: (next, nextKind = "info", nextDurationMs = 3500) => {
      if (element === null) return
      element.textContent = next
      element.className = `dsh-pdf-drop-toast ${nextKind === "error" ? "dsh-pdf-drop-toast-error" : ""}`
      arm(nextDurationMs)
    },
    dismiss,
  }
}

/** Check whether a file is a document/code/data format that shouldn't go to chat image attachment */
export function isDocumentFile(file: { name: string; type?: string }): boolean {
  const type = file.type?.toLowerCase() ?? ""
  if (type.startsWith("image/") && !type.includes("svg")) return false
  const name = file.name.toLowerCase()
  if (/\.(png|jpe?g|webp|gif|bmp|ico)$/i.test(name)) return false
  return true
}

/**
 * Compose the composer mention for one workspace-relative path, following the
 * shared `@file` grammar: whitespace needs the quoted `@"path"` form.
 * @param relativePath - path returned by the host, relative to the workspace.
 * @returns the text to insert.
 */
export function formatFileMention(relativePath: string): string {
  const path = relativePath.replace(/\\/gu, "/")
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`
}

/** Human-readable byte count for toasts. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Structural view of the client sessions service (`ctx.sessions`). */
interface SessionRowLike {
  readonly id?: string | undefined
  readonly cwd?: string | undefined
  readonly retainedBy?: { readonly mainView?: number | undefined } | undefined
}

interface SessionsSnapshotLike {
  readonly current?: string | undefined
  readonly ids?: readonly string[] | undefined
  readonly byId?: Record<string, SessionRowLike | undefined> | undefined
}

interface SessionsLike {
  readonly list?: { getSnapshot(): SessionsSnapshotLike } | undefined
}

/** Structural view of the client context this bundle is applied with. */
export interface ClientContextLike {
  effect?: ((setup: () => () => void) => unknown) | undefined
  get?: ((name: string) => unknown) | undefined
}

/** One upload's addressing: which session and which workspace directory. */
interface UploadTarget {
  sessionId?: string
  cwd?: string
}

/**
 * Resolve the current session and its workspace directory from the client
 * sessions store. Missing services degrade to an unaddressed upload instead of
 * failing the drop.
 * @param ctx - client plugin context.
 * @returns the addressing the host resolves against.
 */
export function resolveUploadTarget(ctx: ClientContextLike | undefined): UploadTarget {
  try {
    const sessions = (ctx?.get?.("sessions") ?? (ctx as Record<string, unknown> | undefined)?.sessions) as SessionsLike | undefined
    const snapshot = sessions?.list?.getSnapshot()

    // Test/mock backwards compatibility
    if (snapshot && typeof snapshot.current === "string" && snapshot.current !== "") {
      const legacyId = snapshot.current
      const legacyCwd = snapshot.byId?.[legacyId]?.cwd
      return typeof legacyCwd === "string" && legacyCwd !== ""
        ? { sessionId: legacyId, cwd: legacyCwd }
        : { sessionId: legacyId }
    }

    if (snapshot?.byId !== undefined) {
      const byId = snapshot.byId

      // 1. Session currently in mainView (retainedBy.mainView > 0)
      const mainSession = Object.values(byId).find(
        s => s !== undefined && (s.retainedBy?.mainView ?? 0) > 0,
      )
      if (mainSession?.id !== undefined) {
        return typeof mainSession.cwd === "string" && mainSession.cwd !== ""
          ? { sessionId: mainSession.id, cwd: mainSession.cwd }
          : { sessionId: mainSession.id }
      }

      // 2. Active session from uiSession adapter
      const uiSession = (ctx?.get?.("uiSession") ?? (ctx as Record<string, unknown> | undefined)?.uiSession) as {
        adapter?: { current?: { getSnapshot(): { key?: string } } }
      } | undefined
      const activeKey = uiSession?.adapter?.current?.getSnapshot()?.key
      if (activeKey !== undefined && byId[activeKey] !== undefined) {
        const active = byId[activeKey]!
        const id = active.id ?? activeKey
        return typeof active.cwd === "string" && active.cwd !== ""
          ? { sessionId: id, cwd: active.cwd }
          : { sessionId: id }
      }

      // 3. First session from snapshot.ids
      const firstId = Array.isArray(snapshot.ids) ? snapshot.ids[0] : undefined
      if (firstId !== undefined && byId[firstId] !== undefined) {
        const first = byId[firstId]!
        const id = first.id ?? firstId
        return typeof first.cwd === "string" && first.cwd !== ""
          ? { sessionId: id, cwd: first.cwd }
          : { sessionId: id }
      }

      // 4. Any session from byId
      const anySession = Object.values(byId).find(s => s !== undefined && (s.id !== undefined || s.cwd !== undefined))
      if (anySession !== undefined) {
        const id = anySession.id ?? Object.keys(byId)[0]
        return typeof anySession.cwd === "string" && anySession.cwd !== ""
          ? { sessionId: id, cwd: anySession.cwd }
          : { sessionId: id }
      }
    }

    return {}
  } catch {
    return {}
  }
}

/** The composer's Lexical host element, when the bar is mounted and editable. */
function findComposerRoot(): HTMLElement | null {
  const node = document.querySelector<HTMLElement>("[data-composer-input]")
  if (node === null) return null
  return node.isContentEditable ? node : null
}

/** Normalized composer draft text used to verify an insertion actually landed. */
function composerText(): string {
  const root = findComposerRoot()
  return (root?.textContent ?? "").replace(/\s+/gu, " ").trim()
}

/** Wait for Lexical to reconcile the DOM, then report whether the text is present. */
async function waitForComposerText(needle: string, before: string): Promise<boolean> {
  const probe = needle.replace(/\s+/gu, " ").trim()
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const now = composerText()
    if (now !== before && now.includes(probe)) return true
    await new Promise<void>(resolve => { setTimeout(resolve, 16) })
  }
  return false
}

/** Paste-path insertion: the composer's own PASTE_COMMAND handler owns the edit. */
function tryPasteIntoComposer(root: HTMLElement, text: string): boolean {
  if (typeof DataTransfer !== "function" || typeof ClipboardEvent !== "function") return false
  try {
    const data = new DataTransfer()
    data.setData("text/plain", text)
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
    // dispatchEvent returns false when the bar consumed the gesture.
    return root.dispatchEvent(event) === false
  } catch {
    return false
  }
}

/** Legacy insertion: the browser's own editing command, observed by Lexical. */
function tryExecIntoComposer(root: HTMLElement, text: string): boolean {
  try {
    root.focus({ preventScroll: true })
    return document.execCommand("insertText", false, text)
  } catch {
    return false
  }
}

/** Pre-Lexical DSH composer: a plain textarea that React controls. */
function tryInsertIntoTextarea(text: string): boolean {
  try {
    const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"))
      .filter(area => area.offsetParent !== null)
    const area = candidates.find(candidate => candidate.placeholder.includes("发消息"))
      ?? candidates.find(candidate => candidate.placeholder.toLowerCase().includes("message"))
    if (area === undefined) return false
    const start = area.selectionStart ?? area.value.length
    const end = area.selectionEnd ?? area.value.length
    const current = area.value
    const prefix = current.slice(0, start)
    const suffix = current.slice(end)
    const separatorBefore = prefix.length > 0 && !/\s$/u.test(prefix) ? " " : ""
    const separatorAfter = suffix.length > 0 && !/^\s/u.test(suffix) ? " " : ""
    const next = `${prefix}${separatorBefore}${text}${separatorAfter}${suffix}`
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
    if (setter !== undefined) setter.call(area, next)
    else area.value = next
    const caret = start + separatorBefore.length + text.length + separatorAfter.length
    area.setSelectionRange(caret, caret)
    area.dispatchEvent(new Event("input", { bubbles: true }))
    area.focus()
    return true
  } catch {
    return false
  }
}

/**
 * Insert one mention into the composer, verifying each strategy against the
 * live draft so a silent no-op never masquerades as success.
 * @param text - mention text to insert.
 * @returns whether the draft now contains it.
 */
export async function insertIntoComposer(text: string): Promise<boolean> {
  const before = composerText()
  const root = findComposerRoot()
  if (root !== null) {
    if (tryPasteIntoComposer(root, text) && await waitForComposerText(text, before)) return true
    if (tryExecIntoComposer(root, text) && await waitForComposerText(text, before)) return true
  }
  return tryInsertIntoTextarea(text)
}

/** One collected file item with relative path inside dropped tree. */
export interface FileEntryItem {
  readonly file: File
  readonly relativePath: string
}

/**
 * Traverse dropped items and directories via standard webkitGetAsEntry API,
 * falling back to flat files.
 */
export async function collectEntries(
  items: readonly DataTransferItem[],
  fallbackFiles: readonly File[],
): Promise<{ files: FileEntryItem[]; directories: string[] }> {
  const result: FileEntryItem[] = []
  const directories: string[] = []

  async function traverse(entry: any, currentPath: string): Promise<void> {
    if (!entry) return
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            result.push({
              file,
              relativePath: currentPath ? `${currentPath}/${file.name}` : file.name,
            })
            resolve()
          },
          () => { resolve() },
        )
      })
    } else if (entry.isDirectory) {
      const dirPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
      directories.push(dirPath)
      const reader = entry.createReader()
      const readAll = async (): Promise<any[]> => {
        const batch: any[] = []
        while (true) {
          const chunk: any[] = await new Promise((resolve) => {
            reader.readEntries(resolve, () => resolve([]))
          })
          if (!chunk || chunk.length === 0) break
          batch.push(...chunk)
        }
        return batch
      }
      const children = await readAll()
      for (const child of children) {
        await traverse(child, dirPath)
      }
    }
  }

  let hasEntryApi = false
  for (const item of items) {
    if (typeof (item as any).webkitGetAsEntry === "function") {
      const entry = (item as any).webkitGetAsEntry()
      if (entry) {
        hasEntryApi = true
        await traverse(entry, "")
      }
    }
  }

  if (!hasEntryApi) {
    for (const file of fallbackFiles) {
      result.push({ file, relativePath: file.name })
    }
  }

  return { files: result, directories }
}

/** Create one remote directory in current workspace. */
function createRemoteDirectory(
  dirPath: string,
  target: UploadTarget,
): Promise<UploadPdfResult> {
  return new Promise<UploadPdfResult>((resolve, reject) => {
    const params = new URLSearchParams({ filename: dirPath, mkdir: "1" })
    if (target.sessionId !== undefined) params.set("sessionId", target.sessionId)
    if (target.cwd !== undefined) params.set("cwd", target.cwd)
    const request = new XMLHttpRequest()
    request.open("POST", `/pdf-drop/upload?${params.toString()}`)
    request.setRequestHeader("accept", "application/json")
    request.onload = () => {
      let parsed: Envelope<UploadPdfResult> | undefined
      try {
        parsed = JSON.parse(request.responseText) as Envelope<UploadPdfResult>
      } catch {
        parsed = undefined
      }
      if (request.status < 200 || request.status >= 300 || parsed === undefined || !parsed.ok) {
        const detail = parsed !== undefined && !parsed.ok ? parsed.error.message : `HTTP ${request.status}`
        reject(new Error(detail))
        return
      }
      resolve(parsed.value)
    }
    request.onerror = () => { reject(new Error("网络中断，创建文件夹失败")) }
    request.send()
  })
}

/**
 * Stream one file to the host route. The raw bytes travel as the request body
 * (no base64 inflation, no giant strings) and XHR reports upload progress.
 * @param file - dropped browser file.
 * @param relativePath - relative landing path inside workspace.
 * @param target - session addressing resolved from the client store.
 * @param onProgress - fraction in [0, 1].
 * @returns the host's landing record.
 */
function uploadFile(
  file: File,
  relativePath: string,
  target: UploadTarget,
  onProgress: (fraction: number) => void,
): Promise<UploadPdfResult> {
  return new Promise<UploadPdfResult>((resolve, reject) => {
    const params = new URLSearchParams({ filename: relativePath })
    if (target.sessionId !== undefined) params.set("sessionId", target.sessionId)
    if (target.cwd !== undefined) params.set("cwd", target.cwd)
    const request = new XMLHttpRequest()
    request.open("POST", `/pdf-drop/upload?${params.toString()}`)
    request.setRequestHeader("content-type", "application/octet-stream")
    request.setRequestHeader("accept", "application/json")
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      let parsed: Envelope<UploadPdfResult> | undefined
      try {
        parsed = JSON.parse(request.responseText) as Envelope<UploadPdfResult>
      } catch {
        parsed = undefined
      }
      if (request.status < 200 || request.status >= 300 || parsed === undefined || !parsed.ok) {
        const detail = parsed !== undefined && !parsed.ok ? parsed.error.message : `HTTP ${request.status}`
        reject(new Error(detail))
        return
      }
      resolve(parsed.value)
    }
    request.onerror = () => { reject(new Error("网络中断，上传失败")) }
    request.ontimeout = () => { reject(new Error("上传超时")) }
    request.onabort = () => { reject(new Error("上传已取消")) }
    request.send(file)
  })
}

/**
 * Apply the client half: one capture-phase drop intake on the window plus the
 * toast stylesheet.
 * @param ctx - client plugin context (cordis), used to read the current session.
 */
export function apply(ctx?: ClientContextLike): void {
  const install = (): (() => void) => {
    let styleTag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
    const styleOwned = styleTag === null
    if (styleTag === null) {
      styleTag = document.createElement("style")
      styleTag.dataset.plugin = "@suxeca/dsh-pdf-drop"
      styleTag.dataset.pluginCss = STYLE_ID
      styleTag.textContent = TOAST_CSS
      document.head.appendChild(styleTag)
    }

    const resetDragOverlay = (): void => {
      try {
        window.dispatchEvent(new Event("dragend"))
      } catch {
        // ignore
      }
    }

    const onDrop = (event: DragEvent): void => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes("Files")) return

      const rawFiles = Array.from(dataTransfer.files ?? [])
      const items = Array.from(dataTransfer.items ?? [])

      const hasDirectories = items.some((item) => {
        try {
          return (item as any).webkitGetAsEntry?.()?.isDirectory === true
        } catch {
          return false
        }
      })
      const hasDocuments = rawFiles.some(isDocumentFile)

      // Only pass through if purely individual raster images without any directories
      if (!hasDirectories && !hasDocuments) return

      // Intercept dropped documents & folders before the composer's native image intake.
      event.preventDefault()
      event.stopPropagation()
      resetDragOverlay()

      const target = resolveUploadTarget(ctx)
      if (target.sessionId === undefined && target.cwd === undefined) {
        showToast("请先打开或新建一个会话，再拖入文件（无法确定工作区目录）", "error", 6000)
        return
      }

      void (async () => {
        const { files: collected, directories } = await collectEntries(items, rawFiles)

        // Handle empty directory drops
        if (collected.length === 0 && directories.length > 0) {
          for (const dir of directories) {
            try {
              await createRemoteDirectory(dir, target)
              showToast(`📁 文件夹 ${dir} 已在工作区创建`, "info", 3500)
            } catch (error) {
              showToast(`创建文件夹 ${dir} 失败: ${error instanceof Error ? error.message : String(error)}`, "error", 5000)
            }
          }
          return
        }

        const toUpload = collected.filter((item) => isDocumentFile(item.file))
        if (toUpload.length === 0) return

        const mentions: string[] = []
        for (const item of toUpload) {
          const file = item.file
          if (file.size > MAX_UPLOAD_BYTES) {
            showToast(`${item.relativePath} 超过 ${formatSize(MAX_UPLOAD_BYTES)}，请改用工作区上传`, "error", 8000)
            continue
          }
          const toast = showToast(`正在上传 ${item.relativePath}（${formatSize(file.size)}）…`, "info", 0)
          try {
            const result = await uploadFile(file, item.relativePath, target, (fraction) => {
              const percent = Math.min(100, Math.round(fraction * 100))
              toast.update(`正在上传 ${item.relativePath}（${formatSize(file.size)}）… ${percent}%`, "info", 0)
            })
            if (result.resolvedFrom === "process") {
              toast.update(
                `⚠️ 未找到会话工作区，已保存到宿主进程目录 ${result.directory}；请手动把文件移入工作区`,
                "error",
                7000,
              )
              continue
            }
            mentions.push(formatFileMention(result.relative))
            toast.update(`📄 ${result.relative} 已保存到工作区`, "info", 3000)
          } catch (error) {
            toast.update(
              `上传 ${item.relativePath} 失败: ${error instanceof Error ? error.message : String(error)}`,
              "error",
              6000,
            )
          }
        }

        if (mentions.length > 0) {
          const allMentions = mentions.join(" ")
          const inserted = await insertIntoComposer(allMentions)
          if (!inserted) {
            console.warn("[dsh-pdf-drop] composer insertion failed", { mentions: allMentions })
          }
        }
      })()
    }

    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") resetDragOverlay()
    }

    window.addEventListener("dragover", onDragOver, { capture: true })
    window.addEventListener("drop", onDrop, { capture: true })
    window.addEventListener("keydown", onKeyDown, { capture: true })

    return () => {
      window.removeEventListener("dragover", onDragOver, { capture: true })
      window.removeEventListener("drop", onDrop, { capture: true })
      window.removeEventListener("keydown", onKeyDown, { capture: true })
      if (styleOwned) styleTag?.remove()
    }
  }

  if (ctx?.effect !== undefined) ctx.effect(install)
  else install()
}

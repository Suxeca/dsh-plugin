import { describe, it, expect } from "vitest"
import { mkdtemp, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isCrossSiteRequest, resolveTargetDirectory, sanitizeFilename, sanitizeRelativePath } from "../src/host/routes.ts"
import { formatFileMention, isDocumentFile, resolveUploadTarget } from "../src/client/index.ts"

describe("PDF Drop Plugin Host", () => {
  it("sanitizes filename to prevent directory traversal", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd")
    expect(sanitizeFilename("foo/bar/paper.pdf")).toBe("paper.pdf")
    expect(sanitizeFilename("simple.pdf")).toBe("simple.pdf")
    expect(sanitizeFilename("")).toBe("document.pdf")
  })

  it("sanitizes relative paths preserving subdirectories while refusing traversal", () => {
    expect(sanitizeRelativePath("folder/paper.pdf")).toBe("folder/paper.pdf")
    expect(sanitizeRelativePath("a/b/c/test.py")).toBe("a/b/c/test.py")
    expect(sanitizeRelativePath("../../../etc/passwd")).toBe("document.pdf")
    expect(sanitizeRelativePath("folder/../../escape")).toBe("document.pdf")
    expect(sanitizeRelativePath("")).toBe("document.pdf")
  })

  it("refuses path components that would escape the target directory", () => {
    expect(sanitizeFilename("..")).toBe("document.pdf")
    expect(sanitizeFilename(".")).toBe("document.pdf")
    expect(sanitizeFilename("C:\\Users\\me\\paper.pdf")).toBe("paper.pdf")
    expect(sanitizeFilename("line\nbreak.pdf")).toBe("linebreak.pdf")
  })

  it("resolves the session workspace before the request cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "pdf-drop-"))
    try {
      const workspace = join(root, "workspace")
      const other = join(root, "other")
      await mkdir(workspace)
      await mkdir(other)
      const ctx = {
        get: (name: string) => name === "sessions"
          ? { get: (id: unknown) => (String(id) === "s1" ? { header: { cwd: workspace } } : undefined) }
          : undefined,
      } as never
      await expect(resolveTargetDirectory(ctx, { sessionId: "s1", cwd: other }))
        .resolves.toEqual({ directory: workspace, resolvedFrom: "session" })
      await expect(resolveTargetDirectory(ctx, { cwd: other }))
        .resolves.toEqual({ directory: other, resolvedFrom: "request" })
      await expect(resolveTargetDirectory(ctx, { cwd: join(root, "missing") }))
        .resolves.toEqual({ directory: process.cwd(), resolvedFrom: "process" })
      await expect(resolveTargetDirectory(ctx, { cwd: "relative/dir" }))
        .resolves.toEqual({ directory: process.cwd(), resolvedFrom: "process" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("falls back to persisted headers for a session that is not live", async () => {
    const root = await mkdtemp(join(tmpdir(), "pdf-drop-"))
    try {
      const ctx = {
        get: (name: string) => name === "sessionPersistence"
          ? { list: async () => [{ id: "s2", cwd: root }] }
          : name === "sessions" ? { get: () => undefined } : undefined,
      } as never
      await expect(resolveTargetDirectory(ctx, { sessionId: "s2" }))
        .resolves.toEqual({ directory: root, resolvedFrom: "session" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("refuses cross-site uploads but allows same-origin and marker-less clients", () => {
    const headers = (value: Record<string, string>) => ({ headers: value }) as never
    expect(isCrossSiteRequest(headers({ "sec-fetch-site": "cross-site" }))).toBe(true)
    expect(isCrossSiteRequest(headers({ origin: "http://evil.example", host: "127.0.0.1:3080" }))).toBe(true)
    expect(isCrossSiteRequest(headers({ origin: "http://100.98.198.73:3080", host: "100.98.198.73:3080" }))).toBe(false)
    expect(isCrossSiteRequest(headers({ host: "100.98.198.73:3080" }))).toBe(false)
  })
})

describe("PDF Drop Plugin Client", () => {
  it("identifies document files vs image files", () => {
    expect(isDocumentFile({ name: "research.pdf", type: "application/pdf" })).toBe(true)
    expect(isDocumentFile({ name: "PAPER.PDF", type: "" })).toBe(true)
    expect(isDocumentFile({ name: "doc.docx" })).toBe(true)
    expect(isDocumentFile({ name: "archive.zip" })).toBe(true)
    expect(isDocumentFile({ name: "notes.md", type: "" })).toBe(true)
    expect(isDocumentFile({ name: "main.py", type: "" })).toBe(true)
    expect(isDocumentFile({ name: "index.ts", type: "" })).toBe(true)
    expect(isDocumentFile({ name: "photo.png", type: "image/png" })).toBe(false)
    expect(isDocumentFile({ name: "photo.jpg", type: "image/jpeg" })).toBe(false)
  })

  it("formats mentions with the shared @file grammar", () => {
    expect(formatFileMention("paper.pdf")).toBe("@paper.pdf")
    expect(formatFileMention("docs/1.2 测量长度和时间.pptx")).toBe('@"docs/1.2 测量长度和时间.pptx"')
    expect(formatFileMention("docs\\paper.pdf")).toBe("@docs/paper.pdf")
  })

  it("reads the current session workspace from the client sessions store", () => {
    // 1. Mock compatibility: snapshot.current
    const legacySnapshot = {
      current: "s1",
      byId: { s1: { cwd: "/home/me/workspace" }, s2: {} },
    }
    const legacyCtx = { get: (name: string) => name === "sessions" ? { list: { getSnapshot: () => legacySnapshot } } : undefined }
    expect(resolveUploadTarget(legacyCtx)).toEqual({ sessionId: "s1", cwd: "/home/me/workspace" })
    expect(resolveUploadTarget({ get: () => ({ list: { getSnapshot: () => ({ current: "s2", byId: { s2: {} } }) } }) }))
      .toEqual({ sessionId: "s2" })
    expect(resolveUploadTarget({ get: () => undefined })).toEqual({})
    expect(resolveUploadTarget(undefined)).toEqual({})

    // 2. Real DSH runtime: retainedBy.mainView
    const realSnapshot = {
      ids: ["s1", "s2"],
      byId: {
        s1: { id: "s1", cwd: "/home/suxeca/Workspace/repo1", retainedBy: {} },
        s2: { id: "s2", cwd: "/home/suxeca/Workspace/repo2", retainedBy: { mainView: 1 } },
      },
    }
    const realCtx = { get: (name: string) => name === "sessions" ? { list: { getSnapshot: () => realSnapshot } } : undefined }
    expect(resolveUploadTarget(realCtx)).toEqual({ sessionId: "s2", cwd: "/home/suxeca/Workspace/repo2" })

    // 3. Fallback when mainView is not set: first session in ids
    const fallbackSnapshot = {
      ids: ["s1", "s2"],
      byId: {
        s1: { id: "s1", cwd: "/home/suxeca/Workspace/repo1", retainedBy: {} },
        s2: { id: "s2", cwd: "/home/suxeca/Workspace/repo2", retainedBy: {} },
      },
    }
    const fallbackCtx = { get: (name: string) => name === "sessions" ? { list: { getSnapshot: () => fallbackSnapshot } } : undefined }
    expect(resolveUploadTarget(fallbackCtx)).toEqual({ sessionId: "s1", cwd: "/home/suxeca/Workspace/repo1" })
  })
})

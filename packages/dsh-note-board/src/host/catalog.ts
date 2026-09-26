/**
 * The ledger catalogue: what ledgers exist on this machine, and what is in them.
 *
 * Discovery answers "which ledger does *this* session use". That is the right
 * question for injection but the wrong one for a human, who cannot attach a
 * ledger they cannot see. The catalogue answers "what is available", which is
 * what the board's entry screen needs.
 *
 * Scanning is bounded three ways — a configured root list, a maximum depth, and
 * pruning of directories that never hold a ledger — and the result is cached,
 * because the answer changes when a human edits a file, not when a view polls.
 * An unbounded walk of a home directory is the kind of feature that works
 * perfectly until the day it does not.
 *
 * @module @suxeca/dsh-note-board/host/catalog
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve as resolvePath } from 'node:path'
import type { LedgerEntry } from '../shared.ts'
import { auditInboxFor, ledgerTitle, readRegistry } from './ledgers.ts'
import { readBoundedFile } from './read.ts'

export type { LedgerEntry }

/** Catalogue inputs, supplied by the plugin entry. */
export interface CatalogDeps {
  /** Directories to scan, already absolute. */
  scanRoots: readonly string[]
  /** How many levels below each root to descend. 0 scans the roots only. */
  maxDepth: number
  /** How long a scan result is reused, in milliseconds. */
  cacheTtlMs: number
  /** Attachment registry, for ledgers the human has used before. */
  registryPath: string
  /** Relative paths that identify a note at any scanned level. */
  ledgerFiles: readonly string[]
  /** Audit-inbox directory name, created beside a note. */
  auditInboxName: string
  /** Character cap on the per-entry read used to count sections. */
  maxBytes: number
}

/**
 * Directories that never contain a project note but do contain thousands of
 * files. Descending into them would dominate the scan's cost for no result.
 *
 * Kept to names that ship with a language or toolchain: a personal or
 * deployment-specific directory name here would say more about the machine this
 * was written on than about the scan.
 */
const PRUNE = new Set([
  'node_modules', '.git', '.pnpm-store', '.venv', 'venv', '__pycache__',
  'target', 'build', 'dist', 'out', '.next', '.cache', '.julia',
])

/** Cached scan, keyed by the root list so a config change invalidates it. */
let scanCache: { key: string, at: number, paths: string[] } = { key: '', at: 0, paths: [] }

/**
 * Find every ledger under the configured roots.
 *
 * Symlink policy, stated once because it differs by object:
 *
 *   · **directories are not followed** — otherwise a link inside a scan root
 *     could walk the scan out of the roots it was given;
 *   · **candidate files and inboxes are followed** — a note may legitimately be
 *     a symlink, and every consumer of its contents goes through
 *     `readBoundedFile`, which types the *opened* handle.
 *
 * @returns absolute paths, de-duplicated. A fresh array, never the cache's own.
 */
export async function scanLedgers(deps: CatalogDeps): Promise<string[]> {
  // The file list is part of the key: it decides which candidates are probed,
  // so a config change must invalidate the scan rather than reuse stale paths.
  const key = `${deps.scanRoots.join('\u0000')}|${deps.maxDepth}|${deps.ledgerFiles.join('\u0000')}`
  const now = Date.now()
  if (scanCache.key === key && now - scanCache.at < deps.cacheTtlMs) return [...scanCache.paths]

  const found = new Set<string>()
  for (const root of deps.scanRoots) {
    const start = resolvePath(root)
    if (!existsSync(start)) continue
    // Breadth-first with an explicit depth cap. A recursive walk with a
    // "don't go deeper" check reads the same but is much easier to get wrong.
    let level = [start]
    for (let depth = 0; depth <= deps.maxDepth && level.length > 0; depth++) {
      const next: string[] = []
      for (const dir of level) {
        for (const relative of deps.ledgerFiles) {
          const candidate = join(dir, relative)
          if (existsSync(candidate)) found.add(candidate)
        }
        if (depth === deps.maxDepth) continue
        let entries: import('node:fs').Dirent[]
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          continue // unreadable directory: skip it, never fail the whole scan
        }
        for (const entry of entries) {
          // Directories only, and only real ones: following a symlinked
          // directory would let the scan walk out of the configured roots, and
          // this endpoint enumerates paths to any trusted caller.
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue
          if (entry.name.startsWith('.')) continue
          if (PRUNE.has(entry.name)) continue
          next.push(join(dir, entry.name))
        }
      }
      level = next
    }
  }
  const paths = [...found].sort()
  scanCache = { key, at: now, paths }
  // A copy in both branches: the cache is module-global, so handing out its own
  // array would let one caller's mutation become every later caller's result.
  return [...paths]
}

/** Count `## ` sections by id prefix. Cheap: a ledger is a few kB. */
function sectionCounts(text: string): { sections: number, frozen: number, verdicts: number, open: number } {
  let sections = 0
  let frozen = 0
  let verdicts = 0
  let open = 0
  for (const match of text.matchAll(/^##\s+(\S+)/gm)) {
    sections += 1
    const id = match[1].toUpperCase()
    if (id.startsWith('FROZEN')) frozen += 1
    else if (id.startsWith('VERDICT')) verdicts += 1
    else if (id.startsWith('OPEN')) open += 1
  }
  return { sections, frozen, verdicts, open }
}

/** How many un-consumed verdicts wait in a ledger's inbox. */
async function pendingAudits(ledgerPath: string, inboxName: string): Promise<number> {
  try {
    const names = await readdir(auditInboxFor(ledgerPath, inboxName))
    // `.md` is a verdict the writer has not fed back yet; `.md.consumed` is done.
    return names.filter(name => name.endsWith('.md')).length
  } catch {
    return 0
  }
}

/**
 * Build the catalogue for one session.
 * @param deps - scan, cache and registry inputs.
 * @param sessionId - used to mark which entry is already bound.
 * @param boundPath - the session's resolved ledger, or `''`.
 * @returns entries, newest modified first.
 */
export async function buildCatalog(deps: CatalogDeps, boundPath: string): Promise<LedgerEntry[]> {
  const scanned = await scanLedgers(deps)
  const known = (await readRegistry(deps.registryPath)).known
  // Known-but-unscanned ledgers are still shown: a human attached it once, so it
  // is real, and hiding it because it sits outside the scan roots would make the
  // scan root list silently authoritative over their own history.
  const all = [...new Set([...scanned, ...known, ...(boundPath === '' ? [] : [boundPath])])].sort()

  const entries: LedgerEntry[] = []
  for (const path of all) {
    let bytes = 0
    let mtime = 0
    let text = ''
    let present = true
    try {
      // Bounded: section counts only describe the part of the note that could
      // ever be injected, and the catalogue reads one entry per scanned path.
      const read = await readBoundedFile(path, deps.maxBytes)
      bytes = read.bytes
      mtime = read.mtimeMs
      text = read.text
    } catch {
      present = false // in the registry but gone from disk, or not a regular file
    }
    entries.push({
      path,
      title: ledgerTitle(path),
      bytes,
      mtime,
      ...sectionCounts(text),
      pendingAudits: present ? await pendingAudits(path, deps.auditInboxName) : 0,
      bound: path === boundPath,
      present,
    })
  }
  // Newest first: the ledger you just edited is the one you are most likely
  // reaching for. Missing files sort last rather than first.
  entries.sort((a, b) => (b.present ? b.mtime : 0) - (a.present ? a.mtime : 0) || a.title.localeCompare(b.title))
  return entries
}

/** The basename shown when a ledger has no better label. */
export function fallbackTitle(path: string): string {
  return basename(path)
}

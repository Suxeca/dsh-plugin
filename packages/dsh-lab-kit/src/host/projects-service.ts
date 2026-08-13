/**
 * Lab-kit project scanner: enumerate research projects under every
 * registered workspace root.
 *
 * A directory counts as a research project when it carries at least one
 * marker of the repo's conventions: a `.git` directory (versioned work) or
 * a `.summary.md` navigation file (the monorepo's per-project navigation
 * convention). Hidden and file entries are skipped.
 * @module dsh-lab-kit/host/projects-service
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'

/** One scanned research project. */
export interface ProjectSummary {
  /** Directory basename. */
  name: string
  /** Absolute directory path. */
  path: string
  /** Whether the project is a git repository. */
  isGit: boolean
  /** Whether the project ships a .summary.md navigation file. */
  hasSummary: boolean
  /** Directory mtime in epoch milliseconds (last meaningful change). */
  mtimeMs: number
  /** Name of the owning workspace root (relative display hint). */
  workspace: string}

/** Marker entries that qualify a directory as a research project. */
const GIT_MARKER = '.git'
const SUMMARY_MARKER = '.summary.md'

/**
 * Scan one workspace root for research projects.
 * @param root - the workspace directory to scan.
 * @param workspaceName - display name of the owning workspace.
 * @returns the qualifying project summaries (sorted by mtime, newest first).
 */
async function scanWorkspace(root: string, workspaceName: string): Promise<ProjectSummary[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const projects: ProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    const isGit = names.includes(GIT_MARKER)
    const hasSummary = names.includes(SUMMARY_MARKER)
    if (!isGit && !hasSummary) continue
    const st = await stat(dir).catch(() => null)
    projects.push({
      name: entry.name,
      path: dir,
      isGit,
      hasSummary,
      mtimeMs: st?.mtimeMs ?? 0,
      workspace: workspaceName,
    })
  }
  projects.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return projects
}

/**
 * Scan every registered workspace for research projects.
 * @param ctx - context carrying the workspace registry.
 * @returns the merged, newest-first project list.
 */
export async function scanProjects(ctx: Context): Promise<ProjectSummary[]> {
  const workspaces = ctx.workspaceRegistry.list()
  const all: ProjectSummary[] = []
  for (const workspace of workspaces) {
    all.push(...await scanWorkspace(workspace.path, workspace.title))
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return all
}

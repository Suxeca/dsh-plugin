/**
 * Plugin-manager core: read, install and uninstall bundle rows in the web
 * profile's package.json (the `dsh.profile.bundles` array plus the matching
 * `dependencies` entries).
 *
 * The host half runs in the real Node process, so it reads the environment
 * directly (no /proc tricks) and writes with node:fs — unlike the dynamic
 * Cordis prototype, the static plugin is NOT subject to the file sandbox.
 *
 * Semantics follow the harness composition rules: a patch row is identified
 * by package name, installs append the bundle and a dependency entry
 * (version defaults to `latest`), uninstalls remove both. Both operations
 * take effect only after a dsh restart — the tool set must stay stable
 * within a turn so prompt-cache prefixes stay warm (see discussion #935).
 * @module dsh-plugin-manager/host/manager
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The web profile manifest as the manager reads and rewrites it. */
export interface ProfileJson {
  name?: string
  dependencies?: Record<string, string>
  dsh?: {
    profile?: {
      bundles?: string[]
    }
  }
}

/** One installed bundle row with its dependency version (when present). */
export interface BundleEntry {
  name: string
  version?: string
}

/** Successful manager result. */
export interface ManagerOk<T> {
  ok: true
  value: T
}

/** Failed manager result with a stable error code for UI mapping. */
export interface ManagerErr {
  ok: false
  error: { code: string; message: string }
}

export type ManagerResult<T> = ManagerOk<T> | ManagerErr

/** Profile location: $DSH_HOME (or $HOME) + .dsh/profiles/web/package.json. */
export function defaultProfilePath(): string {
  const home = process.env.DSH_HOME || homedir()
  return join(home, '.dsh', 'profiles', 'web', 'package.json')
}

/** Read and parse the profile manifest. */
export async function readProfile(
  path = defaultProfilePath(),
): Promise<ManagerResult<{ path: string; json: ProfileJson }>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: 'profile-not-found',
        message: `cannot read profile ${path}: ${String(error)}`,
      },
    }
  }
  try {
    return { ok: true, value: { path, json: JSON.parse(text) as ProfileJson } }
  } catch (error: unknown) {
    return {
      ok: false,
      error: { code: 'profile-invalid-json', message: `profile ${path} is not valid JSON: ${String(error)}` },
    }
  }
}

/** Write the profile manifest back (parents are created defensively). */
async function writeProfile(path: string, json: ProfileJson): Promise<ManagerErr | null> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    return null
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: 'profile-write-failed',
        message: `cannot write ${path}: ${String(error)}. Manual fallback: edit the file yourself, then restart dsh.`,
      },
    }
  }
}

/** List the installed bundles of the web profile. */
export async function listBundles(
  path = defaultProfilePath(),
): Promise<ManagerResult<{ path: string; bundles: BundleEntry[] }>> {
  const profile = await readProfile(path)
  if (!profile.ok) return profile
  const { path: realPath, json } = profile.value
  const bundles = (json.dsh?.profile?.bundles ?? []).slice()
  const deps = json.dependencies ?? {}
  return {
    ok: true,
    value: {
      path: realPath,
      bundles: bundles.map((name) => ({ name, version: deps[name] })),
    },
  }
}

/** Add a bundle row plus its dependency entry to the web profile. */
export async function installBundle(
  name: string,
  version?: string,
  path = defaultProfilePath(),
): Promise<ManagerResult<string>> {
  const clean = name.trim()
  if (!clean) {
    return { ok: false, error: { code: 'name-required', message: 'package name required' } }
  }
  const profile = await readProfile(path)
  if (!profile.ok) return profile
  const { path: realPath, json } = profile.value
  json.dsh = json.dsh ?? {}
  json.dsh.profile = json.dsh.profile ?? {}
  const bundles = (json.dsh.profile.bundles = json.dsh.profile.bundles ?? [])
  json.dependencies = json.dependencies ?? {}
  if (bundles.includes(clean)) {
    return { ok: false, error: { code: 'already-installed', message: `${clean} is already in profile bundles` } }
  }
  bundles.push(clean)
  if (!(clean in json.dependencies!)) json.dependencies![clean] = version ?? 'latest'
  const failure = await writeProfile(realPath, json)
  if (failure) return failure
  return {
    ok: true,
    value:
      `${clean}@${version ?? 'latest'} added to ${realPath} — restart dsh to load it ` +
      `(keeps the tool set stable within a turn, so prompt cache stays warm)`,
  }
}

/** Remove a bundle row and its dependency entry from the web profile. */
export async function uninstallBundle(
  name: string,
  path = defaultProfilePath(),
): Promise<ManagerResult<string>> {
  const clean = name.trim()
  if (!clean) {
    return { ok: false, error: { code: 'name-required', message: 'package name required' } }
  }
  const profile = await readProfile(path)
  if (!profile.ok) return profile
  const { path: realPath, json } = profile.value
  const bundles = json.dsh?.profile?.bundles
  const index = bundles ? bundles.indexOf(clean) : -1
  if (index === -1) {
    return { ok: false, error: { code: 'not-installed', message: `${clean} is not in profile bundles` } }
  }
  bundles!.splice(index, 1)
  if (json.dependencies && clean in json.dependencies) delete json.dependencies[clean]
  const failure = await writeProfile(realPath, json)
  if (failure) return failure
  return { ok: true, value: `${clean} removed from ${realPath} — restart dsh to unload it` }
}

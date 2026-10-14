// Complete a staged plugin tree so the published entry can never have a missing
// import.
//
// WHY: the release stages only installable artifacts. A blanket "exclude src/" is
// right for compiled packages, but WRONG for a hand-written package whose runtime
// lives in src/*.mjs and whose lib/index.js is a thin Cordis wrapper around it:
// dsh-science-map is exactly that, and excluding src/ published an entry that
// threw ERR_MODULE_NOT_FOUND on load.
//
// Files are tracked by PACKAGE-RELATIVE path, because the staged tree mirrors the
// package layout exactly. Anything the entry reaches that is not staged yet is
// copied in from the source package; anything unresolvable fails the release.
//
//   node scripts/stage-reachable.mjs <stagedDir> <sourcePkgDir>
import { readFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs"
import { join, dirname, normalize, sep } from "node:path"

const [stagedDir, pkgDir] = process.argv.slice(2)
if (!stagedDir || !pkgDir) {
  console.error("usage: node scripts/stage-reachable.mjs <stagedDir> <sourcePkgDir>")
  process.exit(2)
}

const RELATIVE_IMPORT = new RegExp("(?:from|import)\\s*\\(?\\s*[\"\u0027](\\.[^\"\u0027]+)[\"\u0027]", "g")
const EXTS = ["", ".js", ".mjs", ".cjs", ".json"]
const INDEXES = ["index.js", "index.mjs"]

const pkg = JSON.parse(readFileSync(join(stagedDir, "package.json"), "utf8"))
const entry = String(pkg.main || "./lib/index.js").replace(/^\.\//, "")

const posix = (p) => p.split(sep).join("/")
const isFile = (p) => existsSync(p) && statSync(p).isFile()
const stagedPath = (rel) => join(stagedDir, rel)
const sourcePath = (rel) => join(pkgDir, rel)

/** Candidate package-relative paths a specifier may resolve to. */
function candidates(rel, spec) {
  const base = posix(normalize(join(dirname(rel), spec)))
  if (base.startsWith("..")) return []
  const out = EXTS.map((e) => base + e)
  for (const idx of INDEXES) out.push(posix(join(base, idx)))
  return out
}

function specifiersOf(file) {
  const out = []
  RELATIVE_IMPORT.lastIndex = 0
  let m
  const src = readFileSync(file, "utf8")
  while ((m = RELATIVE_IMPORT.exec(src)) !== null) out.push(m[1])
  return out
}

const visited = new Set()
const added = []
const missing = []
const queue = [entry]

while (queue.length) {
  const rel = queue.pop()
  if (visited.has(rel)) continue
  visited.add(rel)

  let abs = null
  if (isFile(stagedPath(rel))) {
    abs = stagedPath(rel)
  } else if (isFile(sourcePath(rel))) {
    const dest = stagedPath(rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(sourcePath(rel), dest)
    added.push(rel)
    abs = dest
  } else {
    missing.push(rel)
    continue
  }

  for (const spec of specifiersOf(abs)) {
    const hit = candidates(rel, spec).find((c) => isFile(stagedPath(c)) || isFile(sourcePath(c)))
    if (hit) queue.push(hit)
    else missing.push(rel + "  ->  " + spec)
  }
}

if (missing.length) {
  console.error("unresolved relative imports reachable from " + entry + ":")
  for (const m of [...new Set(missing)].sort()) console.error("  " + m)
  process.exit(3)
}

if (added.length) {
  console.log("    staged " + added.length + " runtime file(s) reachable from " + entry + ": " + added.slice().sort().join(", "))
} else {
  console.log("    reachable closure complete (" + visited.size + " file(s))")
}
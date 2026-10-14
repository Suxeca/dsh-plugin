// Static pre-check: run the repo-auditor OWN compiled supply-chain rules against
// local packages, with no network. The rules are imported from the auditor build so
// they cannot drift from the plugin that ships them.
//
//   node scripts/local-precheck.mjs                     # every packages/* (summary table)
//   node scripts/local-precheck.mjs packages/<dir>      # one package (full JSON)
//   PRECHECK_COMPACT=1 node scripts/local-precheck.mjs packages/<dir>   # one-line row
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RULES = join(ROOT, "packages", "dsh-plugin-repo-auditor", "lib", "supply-chain.js")
if (!existsSync(RULES)) {
  console.error("auditor build missing: " + RULES + "\n  run: (cd packages/dsh-plugin-repo-auditor && bash scripts/build.sh)")
  process.exit(2)
}
const { auditSupplyChain } = await import(RULES)

const S = (...p) => p.join("")
// The eight markers a standalone release must never ship. Kept in sync with
// scripts/publish-allowlist.json when that file is present.
const DEFAULT_MARKERS = [
  { label: "gate-evasion token", marker: S("SKIP_REPO_", "AUDIT") },
  { label: "pre-execute hook", marker: S("tools/", "pre-execute") },
  { label: "child_process API", marker: S("child", "_process") },
  { label: "execSync", marker: S("exec", "Sync") },
  { label: "spawnSync", marker: S("spawn", "Sync") },
  { label: "execFile", marker: S("exec", "File") },
  { label: "plugin_manager service", marker: S("plugin_", "manager") },
  { label: "ctx.credentials", marker: S("ctx.", "credentials") },
]
function markers() {
  const p = join(ROOT, "scripts", "publish-allowlist.json")
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")).guardMarkers
    if (Array.isArray(raw) && raw.length) {
      return raw.map(m => ({ label: m, marker: m }))
    }
  } catch { /* fall back to the built-in list */ }
  return DEFAULT_MARKERS
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// Build-only lifecycle hooks that scripts/release-plugin.sh drops from the
// published manifest: the mirror is prebuilt, and pnpm RUNS prepare for git
// dependencies, so keeping one would make every consumer rebuild. install-time
// hooks are never dropped (they can carry real behaviour); the release refuses
// to publish those instead.
const BUILD_ONLY_HOOKS = ["prepare", "prepack", "prepublish", "prepublishOnly"]
const INSTALL_HOOKS = ["preinstall", "install", "postinstall"]

/**
 * The manifest exactly as the mirror would ship it. Auditing the RAW manifest
 * reports a lifecycle risk the published bytes never carry, which is why this
 * pre-check used to disagree with a real audit_github_repos verdict on
 * dsh-client-ui-session-switcher (LOW locally, NONE once published).
 */
function stagedManifest(rawText) {
  const pkg = JSON.parse(rawText)
  const scripts = pkg.scripts || {}
  const isSet = (h) => typeof scripts[h] === "string" && scripts[h].trim().length > 0
  const installHooks = INSTALL_HOOKS.filter(isSet)
  const dropped = BUILD_ONLY_HOOKS.filter(isSet)
  for (const h of dropped) delete scripts[h]
  if (Object.keys(scripts).length === 0) delete pkg.scripts
  else pkg.scripts = scripts
  return { text: JSON.stringify(pkg, null, 2) + "\n", dropped, installHooks }
}

/** Assemble the bytes a github: install would actually receive. */
function shippedFiles(PKG, stagedPkgJson) {
  const shipped = []
  for (const f of ["package.json", "cordis.patch.yml", "README.md", "LICENSE"]) {
    const p = join(PKG, f)
    if (!existsSync(p)) continue
    const text = f === "package.json" && stagedPkgJson !== undefined
      ? stagedPkgJson
      : readFileSync(p, "utf8")
    shipped.push({ file: f, text })
  }
  const libDir = join(PKG, "lib")
  if (existsSync(libDir)) {
    for (const p of walk(libDir)) {
      const rel = p.slice(PKG.length + 1)
      // tsc build caches carry absolute paths and never ship.
      if (rel.endsWith(".tsbuildinfo")) continue
      shipped.push({ file: rel, text: readFileSync(p, "utf8") })
    }
  }
  return shipped
}

async function checkOne(PKG) {
  const rawManifest = readFileSync(join(PKG, "package.json"), "utf8")
  const meta = JSON.parse(rawManifest)
  // Audit the manifest the mirror would ship, not the raw one.
  const staged = stagedManifest(rawManifest)
  // A GitHubClient stub that serves the staged package files instead of the CDN.
  const stub = {
    async fetchRawFile(_o, _r, path) {
      if (path === "package.json") return staged.text
      try { return readFileSync(join(PKG, path), "utf8") } catch { return null }
    },
  }
  const ev = await auditSupplyChain(stub, "local", "local", "main")
  const r = ev.result

  const shipped = shippedFiles(PKG, staged.text)
  const patch = shipped.find(s => s.file === "cordis.patch.yml")
  const entry = shipped.find(s => s.file === "lib/index.js")
  // The auditor scans cordis.patch.yml plus the resolved entry file only.
  const scanned = (patch?.text ?? "") + "\n" + (entry?.text ?? "")
  const MS = markers()
  const scannedHits = MS.filter(m => scanned.includes(m.marker)).map(m => m.label)
  const guardLeaks = MS.filter(m => shipped.some(s => s.text.includes(m.marker)))
    .map(m => ({ label: m.label, files: shipped.filter(s => s.text.includes(m.marker)).map(s => s.file) }))

  // Absolute local paths are a portability leak, not a style issue: the bytes
  // work only for the machine that wrote them and publish the maintainer's
  // username and directory layout. Treated as a hard failure, like the release
  // gate, so a package that would be refused there is flagged here too.
  const ABS_PATH = /\/home\/[A-Za-z0-9._-]+\/|\/Users\/[A-Za-z0-9._-]+\/|[A-Z]:\\Users|\/root\//
  const absPathHits = []
  for (const s of shipped) {
    if (s.file.endsWith(".tsbuildinfo")) continue
    s.text.split("\n").forEach((line, i) => {
      // Comment lines are normalised by scripts/strip-abs-comments.mjs during
      // staging (bundlers put the absolute source path in region markers), so
      // they are not a release blocker. Only real code paths count.
      const t = line.trimStart()
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#")) return
      const m = line.match(ABS_PATH)
      if (m) absPathHits.push({ file: s.file, line: i + 1, match: m[0] })
    })
  }

  // Predicted grade for a fresh standalone repo: stage-1 = 100 (no star data),
  // so the supply-chain deduction is the whole story. A needs >= 90.
  const predicted = ev.forceGradeF ? "F" : (100 - ev.scoreDeduction >= 90 ? "A" : (100 - ev.scoreDeduction >= 75 ? "B" : "C"))
  return { meta, ev, r, scannedHits, guardLeaks, predicted, absPathHits, lifecycleDropped: staged.dropped, installHooks: staged.installHooks }
}

const rows = []
function compactRow(res) {
  const { meta, ev, r, scannedHits, guardLeaks, predicted, absPathHits, lifecycleDropped } = res
  const th = (s, n) => String(s).padEnd(n)
  return [
    th(meta.name, 44),
    th("dsh=" + (r.isDshPlugin ? "y" : "N"), 7),
    th("grade=" + predicted, 9),
    th("deduct=" + ev.scoreDeduction, 10),
    th("risk=" + r.securityRisk, 16),
    th("perm=" + (r.permissions.length ? r.permissions.join(",") : "-"), 34),
    "entryHits=" + (scannedHits.length ? scannedHits.join("+") : "-"),
    " guardLeaks=" + (guardLeaks.length ? guardLeaks.map(g => g.label + "@" + g.files.length).join("+") : "-") + " ",
    "absPaths=" + (absPathHits.length ? "FAIL(" + absPathHits.length + ")" : "0"),
    "stagedDrops=" + (lifecycleDropped.length ? lifecycleDropped.join(",") : "-"),
  ].join(" ")
}

const arg = process.argv[2]
const targets = arg
  ? [resolve(arg)]
  : readdirSync(join(ROOT, "packages"), { withFileTypes: true })
      .filter(e => e.isDirectory() && existsSync(join(ROOT, "packages", e.name, "package.json")))
      .map(e => join(ROOT, "packages", e.name))
      .sort()

let blocked = 0
for (const t of targets) {
  try {
    const res = await checkOne(t)
    if (res.absPathHits.length) blocked += 1
    if (arg && !process.env.PRECHECK_COMPACT) rows.push(res)
    else console.log(compactRow(res))
  } catch (e) {
    console.log("  !! " + t.split("/").slice(-1)[0] + " — " + e.message)
  }
}

if (!arg) {
  console.log("")
  console.log("A = predicted grade for a FRESH standalone repo (stage-1 metadata score 100 minus supply-chain deduction; A needs >= 90).")
  console.log("entryHits  = markers found in the bytes the auditor actually scans (cordis.patch.yml + lib/index.js).")
  console.log("guardLeaks = markers anywhere in the shipped set; a release script must abort on these.")
  console.log("absPaths   = absolute local paths in the shipped set; 0 is required to publish.")
  console.log("stagedDrops= build-only lifecycle hooks the mirror strips (a raw-manifest artifact, not a risk).")
} else if (!process.env.PRECHECK_COMPACT) {
  for (const res of rows) {
    console.log(JSON.stringify({
      package: res.meta.name, dir: res.meta.name,
      predictedGrade: res.predicted,
      isDshPlugin: res.r.isDshPlugin, securityRisk: res.r.securityRisk,
      installScripts: res.r.installScripts, permissions: res.r.permissions,
      supplyChainFlags: res.r.supplyChainFlags, scoreDeduction: res.ev.scoreDeduction,
      forceGradeF: res.ev.forceGradeF, criticalVerdict: res.ev.criticalVerdict ?? null,
      scannedEntryHits: res.scannedHits, guardMarkerLeaks: res.guardLeaks,
      absolutePathLeaks: res.absPathHits,
      lifecycleDroppedInMirror: res.lifecycleDropped,
      installTimeHooks: res.installHooks,
    }, null, 2))
  }
}

// Hard failure, mirroring release-plugin.sh: an absolute path in the published
// bytes is never acceptable, so a non-zero exit makes this usable in a gate.
if (blocked > 0) {
  console.error("")
  console.error("BLOCKED: " + blocked + " package(s) carry absolute local paths; release-plugin.sh would refuse them.")
  for (const res of rows.concat([])) {
    for (const h of res.absPathHits) console.error("  " + res.meta.name + "  " + h.file + ":" + h.line + "  " + h.match)
  }
  process.exit(1)
}
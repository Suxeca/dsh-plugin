#!/usr/bin/env node
/**
 * profile 启动预检：复刻 `loadProfileDirectory` 对 bundles 的硬校验。
 *
 * 为什么需要它：`packages/boot/app-boot/src/profile.ts:789-796` 对
 * `dsh.profile.bundles` 里**每一项**都要求 `dsh.bundle.patch`，缺了就 throw，
 * 而 throw 发生在 DSH 启动过程中 —— 结果是**关掉就再也起不来**。
 *
 * 现有三个探针都不覆盖这条路径：
 *   · dsh_preset_parse_check  只验 agent preset
 *   · dsh_preset_probe        只验 preset 行
 *   · dsh_client_graph_probe  只在**已经起来之后**验前端
 * 「profile 能不能启动」此前没有任何前置检查，而它恰恰是最贵的一种失败：
 * 它把一次改动变成一次无法自举。
 *
 * 用法：
 *   node profile-preflight.mjs [profileName] [--with <pkg>]
 * `--with` 把某个包临时当作 bundles 成员来检查（用于"我准备加它"的场景）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const withIndex = args.indexOf('--with')
const extra = withIndex >= 0 ? args[withIndex + 1] : null
const profileName = args.find(a => !a.startsWith('--') && a !== extra) ?? 'web'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(home, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

/**
 * The dsh application directory, which is the FIRST anchor `resolveBundleDir`
 * consults. In-box bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`)
 * resolve from here and are legitimately absent from the profile's
 * `node_modules` — a checker that only looked at the profile would report them
 * as broken, and a check that cries wolf is worse than no check, because it
 * teaches you to ignore it.
 */
function dshAppDir() {
  const fromEnv = process.env.DSH_CHECKOUT
  if (fromEnv !== undefined && fromEnv !== '') {
    const candidate = join(fromEnv, 'apps', 'cli')
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  try {
    // The `dsh` on PATH is a shim: `exec node <appDir>/lib/bin.js "$@"`.
    const shim = readFileSync(execSync('command -v dsh', { encoding: 'utf8' }).trim(), 'utf8')
    const match = /node\s+(\S+)/.exec(shim)
    if (match !== null) {
      let dir = dirname(match[1])
      while (dir !== '/' && dir !== '.') {
        if (existsSync(join(dir, 'package.json'))) return dir
        dir = dirname(dir)
      }
    }
  } catch {
    // No shim on PATH is fine — the profile anchor below still gets checked.
  }
  return null
}

/** Mirror `resolveBundleDir`: installation anchor first, profile second. */
function resolveBundle(packageName) {
  const anchors = []
  const app = dshAppDir()
  if (app !== null) anchors.push(join(app, 'package.json'))
  anchors.push(join(profileDir, 'package.json'))
  for (const anchor of anchors) {
    let paths
    try {
      paths = createRequire(anchor).resolve.paths(packageName) ?? []
    } catch {
      continue
    }
    for (const searchPath of paths) {
      const candidate = join(searchPath, packageName)
      if (existsSync(join(candidate, 'package.json'))) return { dir: candidate, anchor: dirname(anchor) }
    }
  }
  return null
}

if (!existsSync(manifestPath)) {
  console.error(`ERROR: profile 不存在: ${profileDir}`)
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []
const list = extra !== null && !bundles.includes(extra) ? [...bundles, extra] : bundles
const app = dshAppDir()

console.log(`profile: ${profileName}   bundles: ${list.length} 项${extra !== null && !bundles.includes(extra) ? `（+ 预演 ${extra}）` : ''}`)
console.log(`安装锚点: ${app ?? '（未找到，仅检查 profile 本地）'}\n`)

let failed = 0
for (const name of list) {
  const resolved = resolveBundle(name)
  if (resolved === null) {
    console.log(`  FAIL  ${name}\n          两个锚点都解析不到 —— loader 会 throw`)
    failed++
    continue
  }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(resolved.dir, 'package.json'), 'utf8'))
  } catch (error) {
    console.log(`  FAIL  ${name}\n          package.json 解析失败: ${error.message}`)
    failed++
    continue
  }
  const declared = pkg.dsh?.bundle?.patch
  if (declared === undefined) {
    // 本次真实事故的形态：包能解析、能 link，但没有 bundle 声明，
    // loader 在**启动路径**上直接 throw —— 结果是关掉就再也起不来。
    console.log(`  FAIL  ${name}\n          缺 dsh.bundle.patch —— loader 会 throw，DSH 起不来`)
    failed++
    continue
  }
  const patchPath = join(resolved.dir, declared)
  if (!existsSync(patchPath)) {
    console.log(`  FAIL  ${name}\n          声明了 dsh.bundle.patch=${declared} 但文件不存在`)
    failed++
    continue
  }
  if (readFileSync(patchPath, 'utf8').trim() === '') {
    console.log(`  FAIL  ${name}\n          ${declared} 是空文件`)
    failed++
    continue
  }
  console.log(`  ok    ${name}  →  ${declared}`)
}

// profile 自己的 patch 层（可选存在）
const ownPatch = join(profileDir, 'cordis.patch.yml')
console.log(`\nprofile 自身 patch: ${existsSync(ownPatch) ? 'cordis.patch.yml 存在' : '（无）'}`)

if (failed > 0) {
  console.log(`\n判决: FAIL — ${failed} 项会让 profile 启动失败。**不要重启 DSH。**`)
  process.exit(1)
}
console.log('\n判决: PASS — 这一层不会阻止 profile 启动。')
